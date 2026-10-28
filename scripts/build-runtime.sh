#!/usr/bin/env bash
# Builds the trimmed Java runtime that the desktop bundles and the Docker image run the server on: `jdeps` finds the Java modules the jar uses,
# `jlink` links only those (plus a fixed list that static analysis cannot see) into a runtime folder. One script, so that the bundles
# (scripts/package-desktop.sh) and the image (Dockerfile) ship the same runtime.
#
#   scripts/build-runtime.sh --jar <executable jar> --out <runtime folder>
# Needs a full JDK 25 on PATH (java, jar, jdeps, jlink); the runtime is a trimmed copy of THAT JDK, so it has that JDK's security level.
# The runtime folder must not exist. On Windows run it from Git Bash and pass paths that native tools understand (C:/...), as package-desktop.sh does.
set -euo pipefail

jar=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jar) jar="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -f "$jar" ] || { echo "build-runtime.sh: --jar is not a file: ${jar:-none}" >&2; exit 2; }
[ -n "$out" ] || { echo "build-runtime.sh: --out is required" >&2; exit 2; }
[ ! -e "$out" ] || { echo "build-runtime.sh: $out exists already" >&2; exit 2; }

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) os=windows; sep=";" ;;
  *) os=other; sep=":" ;;
esac
for tool in java jar jlink jdeps; do
  command -v "$tool" >/dev/null || { echo "$tool not found: a full JDK 25 is needed" >&2; exit 1; }
done
# on Linux, jlink --strip-debug calls objcopy
if [ "$(uname -s)" = Linux ]; then command -v objcopy >/dev/null || { echo "objcopy not found: install binutils (jlink --strip-debug needs it)" >&2; exit 1; }; fi
major="$(java -version 2>&1 | awk -F'"' '/ version "/ { split($2, v, "."); print v[1]; exit }')"
[ "${major:-0}" -ge 25 ] || { echo "JDK 25 or newer is needed, found ${major:-unknown}" >&2; exit 1; }

work="$(mktemp -d)"
# Under Git Bash, native tools (jdeps, jlink) need Windows-style paths (C:/...), not /tmp/...
if [ "$os" = windows ]; then work="$(cygpath -m "$work")"; fi
trap 'rm -rf "$work"' EXIT

# 1. Which Java modules does the application use? jdeps reads the application classes and every library inside the jar.
echo "==> jdeps: finding the Java modules the application needs"
mkdir -p "$work/unpacked"
(cd "$work/unpacked" && jar xf "$jar" BOOT-INF org)
classpath=""
for lib in "$work"/unpacked/BOOT-INF/lib/*.jar; do classpath="${classpath:+$classpath$sep}$lib"; done
detected="$(jdeps --multi-release "$major" --ignore-missing-deps -q --print-module-deps --class-path "$classpath" "$work/unpacked/BOOT-INF/classes" "$work/unpacked/org" 2>/dev/null | tail -1)"
[ -n "$detected" ] || { echo "jdeps found no modules" >&2; exit 1; }
# Added by hand because static analysis cannot see them: java.desktop is the status window; the others are loaded by name or as service providers.
extra="java.desktop,java.logging,java.management,java.naming,java.sql,java.xml,java.scripting,java.net.http,jdk.unsupported,jdk.charsets,jdk.management,jdk.crypto.ec,jdk.zipfs,jdk.dynalink"
available="$(java --list-modules | sed -E 's/@.*//')"
modules=""
for module in $(echo "$detected,$extra" | tr ',' '\n' | sort -u); do
  if echo "$available" | grep -qx "$module"; then modules="${modules:+$modules,}$module"; fi
done
# jdk.jdi and jdk.attach (a debugger and an attach API) are only referenced by libraries' optional code; the application never needs them.
modules="$(echo "$modules" | tr ',' '\n' | grep -Ev '^(jdk.jdi|jdk.attach)$' | paste -sd, -)"
echo "    modules: $modules"

# 2. A trimmed runtime.
echo "==> jlink: building the runtime"
jlink --add-modules "$modules" --strip-debug --no-header-files --no-man-pages --compress zip-6 --output "$out"
du -sh "$out" | awk '{print "    runtime size: " $1}'
echo "    runtime: $("$out/bin/java" -XshowSettings:properties -version 2>&1 | awk -F' = ' '/java.runtime.version/ { print $2; exit }') ($("$out/bin/java" -XshowSettings:properties -version 2>&1 | awk -F' = ' '/java.vendor.version/ { print $2; exit }'))"
