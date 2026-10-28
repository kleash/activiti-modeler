#!/usr/bin/env bash
# Makes sure the JDK the build needs is available.
#   scripts/setup-jdk.sh                     JDK 25 (default): Activiti 9.x is compiled to Java 25 bytecode
#   ACTIVITI_LINE=8 scripts/setup-jdk.sh     JDK 21: the second target, Activiti 8.8.1 (build with -Pactiviti8)
#   REQUIRED_MAJOR=21 scripts/setup-jdk.sh   the same, by major version (so does a first argument: scripts/setup-jdk.sh 21)
#
# For 25, a `java` on the PATH that is already 25 or newer is enough and nothing is downloaded. For any other
# major (21), only exactly that JDK counts, so the 8.8.1 line is tested on the JDK it targets. Otherwise
# Eclipse Temurin <major> is downloaded into ./.tools/jdk-<major> (git-ignored). Safe to run repeatedly.
#
# Afterwards, run `source scripts/env.sh` (with ACTIVITI_LINE=8 for 21) or use the export lines this script prints.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${1:-}" ]; then
  REQUIRED_MAJOR="$1"
elif [ -z "${REQUIRED_MAJOR:-}" ]; then
  if [ "${ACTIVITI_LINE:-}" = "8" ]; then REQUIRED_MAJOR=21; else REQUIRED_MAJOR=25; fi
fi
case "$REQUIRED_MAJOR" in
  '' | *[!0-9]*) echo "REQUIRED_MAJOR must be a JDK major version such as 21 or 25, got: $REQUIRED_MAJOR" >&2; exit 1 ;;
esac
JDK_DIR="$ROOT/.tools/jdk-$REQUIRED_MAJOR"
ENV_HINT="source scripts/env.sh"
if [ "$REQUIRED_MAJOR" = "21" ]; then ENV_HINT="ACTIVITI_LINE=8 source scripts/env.sh"; fi

# Prints the major version of the given `java` binary, or 0 if it cannot be run.
java_major() {
  local version
  version="$("$1" -version 2>&1 | awk -F'"' '/ version "/ { print $2; exit }')" || true
  case "$version" in
    1.*) version="${version#1.}" ;;
  esac
  version="${version%%[^0-9]*}"
  echo "${version:-0}"
}

print_exports() {
  echo
  echo "JDK $REQUIRED_MAJOR is ready. Use it in this shell with:"
  echo "  $ENV_HINT"
  echo "or:"
  echo "  export JAVA_HOME=\"$1\""
  echo "  export PATH=\"\$JAVA_HOME/bin:\$PATH\""
}

if [ -x "$JDK_DIR/bin/java" ] && [ "$(java_major "$JDK_DIR/bin/java")" -ge "$REQUIRED_MAJOR" ]; then
  echo "Found the local JDK in $JDK_DIR"
  print_exports "$JDK_DIR"
  exit 0
fi

# 25 means "25 or newer"; any other major means exactly that JDK.
path_java_ok() {
  local java major
  java="$(command -v java)"
  # a JRE (no javac next to java, like Ubuntu's openjdk-21-jre-headless) cannot build
  [ -x "$(dirname "$(readlink -f "$java")")/javac" ] || return 1
  major="$(java_major "$java")"
  [ "$major" -eq "$REQUIRED_MAJOR" ] || { [ "$REQUIRED_MAJOR" -eq 25 ] && [ "$major" -gt 25 ]; }
}

if command -v java >/dev/null 2>&1 && path_java_ok; then
  echo "java on the PATH is already JDK $(java_major "$(command -v java)"); nothing to install."
  echo "Run: java -version"
  exit 0
fi

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=mac ;;
  *) echo "Unsupported OS: $(uname -s). Install a JDK $REQUIRED_MAJOR manually." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=aarch64 ;;
  *) echo "Unsupported CPU architecture: $(uname -m). Install a JDK $REQUIRED_MAJOR manually." >&2; exit 1 ;;
esac

url="https://api.adoptium.net/v3/binary/latest/$REQUIRED_MAJOR/ga/$os/$arch/jdk/hotspot/normal/eclipse"
mkdir -p "$ROOT/.tools"
work="$(mktemp -d "$ROOT/.tools/jdk-download.XXXXXX")"
trap 'rm -rf "$work"' EXIT

echo "Downloading Temurin $REQUIRED_MAJOR ($os/$arch) from $url"
curl -fsSL --retry 3 --retry-delay 2 -o "$work/jdk.tar.gz" "$url"
mkdir "$work/extracted"
tar -xzf "$work/jdk.tar.gz" -C "$work/extracted"

# Linux archives hold <jdk>/bin/java; macOS archives hold <jdk>/Contents/Home/bin/java.
home="$(find "$work/extracted" -maxdepth 5 -type f -path '*/bin/java' | head -n 1)"
if [ -z "$home" ]; then
  echo "The downloaded archive does not contain a JDK." >&2
  exit 1
fi
home="$(dirname "$(dirname "$home")")"

rm -rf "$JDK_DIR"
mv "$home" "$JDK_DIR"

if [ "$(java_major "$JDK_DIR/bin/java")" -lt "$REQUIRED_MAJOR" ]; then
  echo "Installed JDK is older than $REQUIRED_MAJOR:" >&2
  "$JDK_DIR/bin/java" -version >&2
  exit 1
fi
"$JDK_DIR/bin/java" -version
print_exports "$JDK_DIR"
