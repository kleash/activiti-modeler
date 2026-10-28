#!/usr/bin/env bash
# Builds the desktop bundle of the modeler for THIS operating system and CPU (ADR 0008, feature K4): an app image made by `jpackage` that holds
# the executable jar and a Java runtime trimmed with `jdeps` and `jlink` (scripts/build-runtime.sh), so the person who downloads it needs no Java. The result is zipped as
#   dist-desktop/activiti-modeler-<version>-<os>-<arch>.zip      (os: linux, macos, windows; arch: x64, arm64)
# Unzipped, it holds   Activiti Modeler/   (Linux, Windows)  or  Activiti Modeler.app   (macOS), and next to the launcher folder or the .app the files
# LICENSE, NOTICE and THIRD-PARTY-NOTICES.md (they are inside the app too).
#
#   scripts/package-desktop.sh [--jar <executable jar>] [--version <x.y.z>] [--out <folder>]
#     --jar      the jar to package (default: the one ./build.sh built)
#     --version  the version in the file name and the app (default: the jar's version; a release passes the tag without the "v")
#     --out      where the zip goes (default: dist-desktop/)
# Needs a full JDK 25 (jlink, jdeps, jpackage), which ./build.sh installs into .tools/jdk-25. It cannot cross-build: run it on each operating system
# (the release workflow does). Smoke-test the result with scripts/smoke-bundle.sh. Windows: run it from Git Bash (CI does); package-desktop.ps1 starts it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

APP_NAME="Activiti Modeler"
jar=""; version=""; out="$ROOT/dist-desktop"
while [ $# -gt 0 ]; do
  case "$1" in
    --jar) jar="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) echo "unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64|AMD64) arch=x64 ;;
  aarch64|arm64|ARM64) arch=arm64 ;;
  *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

for tool in java jar jlink jdeps jpackage; do
  command -v "$tool" >/dev/null || { echo "$tool not found: a full JDK 25 is needed (run ./build.sh, or scripts/setup-jdk.sh then source scripts/env.sh)" >&2; exit 1; }
done
major="$(java -version 2>&1 | awk -F'"' '/ version "/ { split($2, v, "."); print v[1]; exit }')"
[ "${major:-0}" -ge 25 ] || { echo "JDK 25 or newer is needed, found ${major:-unknown}" >&2; exit 1; }

if [ -z "$jar" ]; then
  jar="$(ls "$ROOT"/java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar 2>/dev/null | head -1 || true)"
fi
[ -f "$jar" ] || { echo "jar not found (build it first with ./build.sh): ${jar:-none}" >&2; exit 1; }
# absolute: build-runtime.sh unpacks it from another directory
jar="$(cd "$(dirname "$jar")" && pwd)/$(basename "$jar")"
jar_version="$(basename "$jar" .jar)"; jar_version="${jar_version#activiti-modeler-server-}"; jar_version="${jar_version%-exec}"
version="${version:-$jar_version}"
# jpackage wants 1 to 3 numbers; "1.0.0-SNAPSHOT" becomes "1.0.0"
app_version="$(echo "$version" | sed -E 's/^([0-9]+(\.[0-9]+){0,2}).*/\1/')"
echo "$app_version" | grep -Eq '^[0-9]+(\.[0-9]+){0,2}$' || { echo "cannot derive a numeric app version from '$version'; pass --version x.y.z" >&2; exit 1; }

work="$(mktemp -d)"
# Under Git Bash, native tools (jdeps, jlink, jpackage, 7z) need Windows-style paths (C:/...), not /tmp/...
if [ "$os" = windows ]; then
  work="$(cygpath -m "$work")"
  jar="$(cygpath -m "$jar")"
fi
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"
echo "==> Packaging $jar ($version) for $os-$arch"

# 1. A trimmed runtime: jdeps finds the Java modules the application uses, jlink links them (scripts/build-runtime.sh, shared with the Docker image).
"$ROOT/scripts/build-runtime.sh" --jar "$jar" --out "$work/runtime"

# 3. The app image: launcher + jar + runtime + the licence files. The licence files travel in the input folder, so jpackage puts them
# next to the jar inside the app (lib/app, app\, Contents/app): a place that is part of the app on every operating system, also where the
# app is signed.
echo "==> jpackage: building the app image"
mkdir -p "$work/input" "$work/legal" "$work/image"
cp "$jar" "$work/input/activiti-modeler.jar"
for file in LICENSE NOTICE THIRD-PARTY-NOTICES.md; do
  [ -f "$ROOT/$file" ] || { echo "$file is missing in the repository root" >&2; exit 1; }
  cp "$ROOT/$file" "$work/legal/$file"
  cp "$ROOT/$file" "$work/input/$file"
done
# the app icon in the format of this operating system (packaging/icons/, drawn from activiti-modeler.svg)
case "$os" in macos) icon=icns ;; windows) icon=ico ;; *) icon=png ;; esac
icon="$ROOT/packaging/icons/activiti-modeler.$icon"
if [ "$os" = windows ]; then icon="$(cygpath -m "$icon")"; fi
# macOS: the bundle identifier, which jpackage would otherwise take from the main class (org.springframework.boot.loader.launch)
mac_options=()
if [ "$os" = macos ]; then mac_options=(--mac-package-identifier io.github.kleash.activiti.modeler); fi
run_jpackage() { # run_jpackage <app version>
  jpackage --type app-image --name "$APP_NAME" --app-version "$1" --vendor "Activiti Modeler contributors" \
    --description "Modeler for BPMN and DMN that runs on Activiti 9" --copyright "Activiti Modeler contributors, Apache License 2.0" \
    --input "$work/input" --main-jar activiti-modeler.jar --runtime-image "$work/runtime" --icon "$icon" \
    "${mac_options[@]}" --dest "$work/image"
}
if ! run_jpackage "$app_version"; then
  if [ "$os" = macos ] && [ "${app_version%%.*}" = 0 ]; then
    # macOS wants a first version number of 1 or more
    echo "jpackage refused version $app_version on macOS; retrying with 1.${app_version#*.}"
    rm -rf "$work/image" && mkdir -p "$work/image"
    run_jpackage "1.${app_version#*.}"
  else
    exit 1
  fi
fi
if [ "$os" = macos ]; then bundle="$APP_NAME.app"; else bundle="$APP_NAME"; fi
[ -e "$work/image/$bundle" ] || { echo "jpackage produced no $bundle in $work/image" >&2; ls "$work/image" >&2; exit 1; }

# The licence files also where a person who unzips looks first: next to the launcher folder (Linux, Windows) or next to the .app (macOS; a file
# added inside the .app after jpackage would break its signature).
if [ "$os" = macos ]; then
  for file in LICENSE NOTICE THIRD-PARTY-NOTICES.md; do cp "$work/legal/$file" "$work/image/$file"; done
  # Apple silicon refuses code without a signature; an ad-hoc one (no certificate) is enough to run, and jpackage's own may be missing.
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$work/image/$bundle" || echo "warning: ad-hoc codesign failed; the app may be refused on Apple silicon" >&2
  fi
else
  for file in LICENSE NOTICE THIRD-PARTY-NOTICES.md; do cp "$work/legal/$file" "$work/image/$bundle/$file"; done
fi

# 4. Zip it. `zip -y` keeps symbolic links and the executable bit, which macOS and Linux need.
zip_name="activiti-modeler-$version-$os-$arch.zip"
rm -f "$out/$zip_name"
echo "==> zip: $out/$zip_name"
out_abs="$(cd "$out" && { pwd -W 2>/dev/null || pwd; })"   # pwd -W: the Windows spelling of the path under Git Bash, for 7z and PowerShell
if command -v zip >/dev/null 2>&1; then
  (cd "$work/image" && zip -qry "$out_abs/$zip_name" .)
elif command -v 7z >/dev/null 2>&1; then
  (cd "$work/image" && 7z a -tzip -mx=6 -bso0 "$out_abs/$zip_name" .)
elif command -v powershell >/dev/null 2>&1; then
  (cd "$work/image" && powershell -NoProfile -Command "Compress-Archive -Path '*' -DestinationPath '$out_abs/$zip_name' -CompressionLevel Optimal")
else
  echo "no zip, 7z or powershell to make the archive" >&2; exit 1
fi
ls -l "$out/$zip_name" | awk '{printf "    %s bytes\n", $5}'
echo
echo "Built $out/$zip_name"
echo "Test it with:  scripts/smoke-bundle.sh $out/$zip_name"
