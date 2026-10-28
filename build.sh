#!/usr/bin/env bash
# Builds the Activiti Modeler from source with one command. You need git and a shell; no Maven, no Node, and no particular Java:
#   1. JDK 25: used when `java` already is 25 or newer, otherwise Eclipse Temurin 25 is downloaded into .tools/jdk-25 (scripts/setup-jdk.sh)
#   2. the Maven wrapper (java/mvnw) downloads Maven, then its frontend plugin downloads Node 22 into .tools/node and builds the web app
#      (npm ci, npm run build in modeler/), and Maven builds the executable jar with the app inside
# Result: java/activiti-modeler-server/target/activiti-modeler-server-<version>-exec.jar. Start it with ./run.sh.
#
#   ./build.sh [--with-tests] [maven arguments...]
#     --with-tests   run the Java tests too (default: -DskipTests; scripts/verify-all.sh runs everything)
# Windows: build.cmd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

skip_tests=1
extra=()
for argument in "$@"; do
  case "$argument" in
    --with-tests) skip_tests=0 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) extra+=("$argument") ;;
  esac
done

# Prints the major version of a java binary, 0 when it cannot be run.
java_major() {
  local version
  version="$("$1" -version 2>&1 | awk -F'"' '/ version "/ { print $2; exit }')" || true
  case "$version" in 1.*) version="${version#1.}" ;; esac
  version="${version%%[^0-9]*}"
  echo "${version:-0}"
}

echo "==> JDK 25 (downloaded into .tools/jdk-25 when java on your path is older: about 200 MB, once)"
"$ROOT/scripts/setup-jdk.sh" | grep -Ev '^$|^JDK 25 is ready|^  source scripts/env.sh|^or:|^  export ' || true
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"
# A JAVA_HOME that points to an older JDK would win over the java on the PATH inside the Maven wrapper.
if [ -n "${JAVA_HOME:-}" ] && [ "$(java_major "$JAVA_HOME/bin/java")" -lt 25 ]; then
  unset JAVA_HOME
fi
java -version 2>&1 | head -1

# Puts the Node archive the frontend plugin needs where the plugin looks first (its download cache in ~/.m2): the plugin's own download has no
# timeout and no retry, and downloads from nodejs.org have been cut short or have stalled. Checked against nodejs.org's SHASUMS256.txt. Best
# effort: when anything here fails, the plugin downloads as before.
fetch_node() {
  local version os arch ext file cache url expected actual
  version="$(sed -n 's:.*<modeler.node.version>v\(.*\)</modeler.node.version>.*:\1:p' "$ROOT/java/activiti-modeler-server/pom.xml")"
  [ -n "$version" ] && command -v curl >/dev/null || return 0
  [ "$("$ROOT/.tools/node/node" --version 2>/dev/null)" = "v$version" ] && return 0
  case "$(uname -s)" in Linux) os=linux; ext=tar.gz ;; Darwin) os=darwin; ext=tar.gz ;; MINGW*|MSYS*|CYGWIN*) os=win; ext=zip ;; *) return 0 ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) return 0 ;; esac
  cache="$HOME/.m2/repository/com/github/eirslett/node/$version/node-$version-$os-$arch.$ext"
  [ -f "$cache" ] && return 0
  file="node-v$version-$os-$arch.$ext"
  url="https://nodejs.org/dist/v$version"
  mkdir -p "$(dirname "$cache")"
  expected="$(curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 --max-time 60 "$url/SHASUMS256.txt" | awk -v f="$file" '$2 == f { print $1 }')" || return 0
  curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 --max-time 600 -o "$cache.part" "$url/$file" || { rm -f "$cache.part"; return 0; }
  actual="$( (sha256sum "$cache.part" 2>/dev/null || shasum -a 256 "$cache.part") | awk '{ print $1 }')"
  if [ -n "$expected" ] && [ "$expected" = "$actual" ]; then mv "$cache.part" "$cache"; else rm -f "$cache.part"; fi
}

echo "==> Building the web app and the server jar (the first build downloads Maven, Node and the libraries: a few minutes)"
fetch_node
mvn_arguments=(-B -Pbundle-modeler -pl activiti-modeler-server -am package)
if [ "$skip_tests" -eq 1 ]; then
  mvn_arguments+=(-DskipTests)
fi
"$ROOT/java/mvnw" -f "$ROOT/java/pom.xml" "${mvn_arguments[@]}" ${extra[@]+"${extra[@]}"}

jar="$(ls "$ROOT"/java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar | head -1)"
echo
echo "Built $jar"
echo "Start it with:  ./run.sh"
