#!/usr/bin/env bash
# Builds the modeler server jar with the modeler web app inside:
#   1. npm ci && npm run build in modeler/   (npm ci only when node_modules is missing, or with --ci)
#   2. mvn package -Pbundle-modeler          (copies modeler/app/dist into the jar as classpath:/static)
# Result: java/activiti-modeler-server/target/activiti-modeler-server-<version>-exec.jar - run it with ./run.sh or `java -jar <jar>`.
# (./build.sh at the repository root is the one-command build for people who have no Node or Maven; this script is for the test suites and
# for developers who have them.)
#
#   scripts/build-server.sh [--ci] [--skip-modeler] [--with-tests]
#     --ci            always run `npm ci` (a clean install from package-lock.json)
#     --skip-modeler  do not build the app; use the modeler/app/dist that is there
#     --with-tests    run the Java tests too (default: -DskipTests; `mvn verify` runs them)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

force_ci=0
skip_modeler=0
skip_tests=1
for argument in "$@"; do
  case "$argument" in
    --ci) force_ci=1 ;;
    --skip-modeler) skip_modeler=1 ;;
    --with-tests) skip_tests=0 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $argument (see --help)" >&2; exit 2 ;;
  esac
done

command -v java >/dev/null || { echo "java not found. Run scripts/setup-jdk.sh" >&2; exit 1; }
command -v mvn >/dev/null || { echo "mvn not found" >&2; exit 1; }

if [ "$skip_modeler" -eq 0 ]; then
  command -v npm >/dev/null || { echo "npm not found (Node 22 or newer is needed to build the modeler app)" >&2; exit 1; }
  echo "==> Building the modeler app (modeler/app/dist)"
  cd "$ROOT/modeler"
  if [ "$force_ci" -eq 1 ] || [ ! -d node_modules ]; then
    npm ci
  fi
  npm run build
fi

if [ ! -f "$ROOT/modeler/app/dist/index.html" ]; then
  echo "modeler/app/dist/index.html is missing: build the app (run this script without --skip-modeler)" >&2
  exit 1
fi

echo "==> Building the server jar with the app inside"
# the app was built above (or --skip-modeler asked for the one that is there): do not let the profile build it again
mvn_arguments=(-B -f "$ROOT/java/pom.xml" -pl activiti-modeler-server -am package -Pbundle-modeler -Dmodeler.skipFrontend=true)
if [ "$skip_tests" -eq 1 ]; then
  mvn_arguments+=(-DskipTests)
fi
mvn "${mvn_arguments[@]}"

jar="$(ls "$ROOT"/java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar | head -1)"
echo
echo "Built $jar"
echo "Run:  ./run.sh   or   java -jar $jar        (http://127.0.0.1:8080 or a free port, user modeler / password modeler)"
