#!/usr/bin/env bash
# End-to-end smoke test of the modeler server jar (build it first: ./build.sh or scripts/build-server.sh).
# Checks that the licence files are in the jar, starts it on a free port with a temporary workspace and home, checks health, the engine report, authentication, the bundled app, a
# workspace round trip, a validate and a decision call with curl (scripts/smoke-lib.sh), then stops the server.
#   scripts/smoke-server.sh [path-to-jar]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"
# shellcheck source=scripts/smoke-lib.sh
source "$ROOT/scripts/smoke-lib.sh"

JAR="${1:-$(ls "$ROOT"/java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar | head -1)}"
[ -f "$JAR" ] || { echo "jar not found: $JAR (run ./build.sh)" >&2; exit 1; }
for notice in LICENSE NOTICE THIRD-PARTY-NOTICES.md; do
  smoke_check "META-INF/$notice is in the jar" bash -c "unzip -l '$JAR' 'META-INF/$notice' | grep -q 'META-INF/$notice'"
done

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
WORK="$(mktemp -d)"
LOG="$WORK/server.log"
BASE="http://127.0.0.1:$PORT"

# MODELER_HOME keeps the log folder of the start-up defaults out of the real home directory; the explicit options keep it headless.
MODELER_HOME="$WORK/home" java -jar "$JAR" --server.port="$PORT" --workspace="$WORK/workspace" --no-open --no-window --modeler.server.mail.port=0 >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  if [ "${SMOKE_KEEP_LOG:-0}" != 1 ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

smoke_wait_health "$BASE" "$PID" 180
smoke_check "the server prints its URL" grep -q "running at $BASE/" "$LOG"
smoke_check "the log file is written to MODELER_HOME" test -s "$WORK/home/logs/activiti-modeler.log"
smoke_checks "$BASE" modeler:modeler "$PORT"
echo "smoke test passed ($JAR on port $PORT)"
