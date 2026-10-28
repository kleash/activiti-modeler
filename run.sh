#!/usr/bin/env bash
# Starts the Activiti Modeler that ./build.sh built. Arguments go to the server, for example:
#   ./run.sh                          projects in ~/ActivitiModeler/workspace, port 8080 (or a free one), the browser opens
#   ./run.sh --workspace=my-projects --no-open
#   ./run.sh --help
# Windows: run.cmd.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

jar="$(ls "$ROOT"/java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar 2>/dev/null | head -1 || true)"
if [ -z "$jar" ]; then
  echo "Nothing to run yet: build the modeler first with ./build.sh" >&2
  exit 1
fi
if command -v unzip >/dev/null 2>&1 && ! unzip -l "$jar" 2>/dev/null | grep -q 'static/assets/'; then
  echo "Note: $jar was built without the web app (a placeholder page will show). Use ./build.sh." >&2
fi

if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then java_bin="$JAVA_HOME/bin/java"; else java_bin="$(command -v java || true)"; fi
if [ -z "$java_bin" ]; then
  echo "Java 25 not found. Run ./build.sh (it installs one into .tools/jdk-25), or install Java 25." >&2
  exit 1
fi
version="$("$java_bin" -version 2>&1 | awk -F'"' '/ version "/ { print $2; exit }')"
major="${version%%.*}"
if [ "${major:-0}" -lt 25 ] 2>/dev/null; then
  echo "Java 25 or newer is needed, found $version ($java_bin). ./build.sh installs one into .tools/jdk-25." >&2
  exit 1
fi
exec "$java_bin" -jar "$jar" "$@"
