#!/usr/bin/env bash
# Starts the modeler server (http://localhost:8080) and the modeler dev server (http://localhost:5173).
# Builds the server jar first when it does not exist. Stop both with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

JAR="$ROOT/java/activiti-modeler-server/target/activiti-modeler-server-1.0.0-SNAPSHOT-exec.jar"
if [ ! -f "$JAR" ]; then
  echo "Building the modeler server ..."
  mvn -B -q -f "$ROOT/java/pom.xml" -pl activiti-modeler-server -am -DskipTests package
fi

java -jar "$JAR" --no-open --no-window &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

cd "$ROOT/modeler"
[ -d node_modules ] || npm ci
npm run dev
