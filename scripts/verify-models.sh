#!/usr/bin/env bash
# Verifies a folder of Activiti models against its scenarios, without any Java:
#
#   scripts/verify-models.sh <dir> [--mode auto|programmatic|both] [--project <id-prefix>[,...]]
#
# <dir> holds processes/ (BPMN, *-extensions.json, DMN) and scenarios/ (*.scenario.json, optionally
# model-expect.json next to them) - one project - or sub folders that do (for example corpus/). Every project gets its own
# Spring context and in-memory H2 database and is deployed in both deploy modes; one line is printed per check and the
# exit status is 0 when everything passed. Needs JDK 25 (scripts/setup-jdk.sh) and Maven; the first run builds the
# runner and the harness (a minute), later runs reuse the build (set REBUILD=1 to rebuild after changing the Java code).
#
# Same thing through Maven, from the repository root:
#   mvn -B -f java/pom.xml -pl verification-harness -am package -DskipTests
#   mvn -B -f java/pom.xml -pl verification-harness exec:java -Dexec.args="my-models --mode auto"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

if [ "$#" -eq 0 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

MODULE="$ROOT/java/verification-harness"
CLASSPATH_FILE="$MODULE/target/verify-classpath.txt"

if [ "${REBUILD:-0}" = "1" ] || [ ! -f "$CLASSPATH_FILE" ] || [ ! -d "$MODULE/target/classes" ]; then
  echo "Building the scenario runner and the verification harness ..." >&2
  mvn -B -q -f "$ROOT/java/pom.xml" -pl verification-harness -am package dependency:build-classpath \
    -DskipTests -Dmdep.includeScope=runtime -Dmdep.outputFile="$CLASSPATH_FILE" >&2
fi

exec java -cp "$MODULE/target/classes:$(cat "$CLASSPATH_FILE")" io.github.kleash.activiti.harness.VerifyCli "$@"
