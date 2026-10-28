#!/usr/bin/env bash
# Smoke test of the Docker image (ADR 0008, feature K5). The image is built FROM scratch (musl and the Java runtime; no shell, no package manager, no
# id, no test), so everything is checked from outside: docker inspect, docker top, docker cp. Builds the image unless an image name is given, then
# runs it three times:
#   1. with MODELER_PASSWORD set: that password works, the demo passwords do not, the checks of scripts/smoke-lib.sh pass (they include a DMN
#      evaluation and a scenario run with a JavaScript script task and a mail task), the process is not root, the image has no shell and no package
#      manager, and a project written to the /data volume is still there after the container is replaced;
#   2. without it: a random password is printed in the container's output and works, "modeler"/"modeler" does not, the container reports healthy;
#   3. hardened as the documentation says: --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges, on a new volume: the same checks
#      again, which write the workspace, run the engine, the scenario and the mail server, and the container reports healthy.
# The port is published on 127.0.0.1 only, as the documentation says.
#   scripts/smoke-docker.sh [image]      (default: build ./Dockerfile as activiti-modeler:smoke)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/smoke-lib.sh
source "$ROOT/scripts/smoke-lib.sh"

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  IMAGE="activiti-modeler:smoke"
  echo "==> docker build $IMAGE"
  docker build -t "$IMAGE" "$ROOT"
fi
docker image inspect "$IMAGE" --format 'image size: {{.Size}} bytes' 

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
BASE="http://127.0.0.1:$PORT"
NAME="activiti-modeler-smoke-$$"
VOLUME="activiti-modeler-smoke-data-$$"
WORK="$(mktemp -d)"
LOG="$WORK/container.log"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
start() { # start [docker run arguments before the image]
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" -v "$VOLUME:/data" "$@" "$IMAGE" >/dev/null
}
wait_up() {
  local i
  for ((i = 0; i < 240; i++)); do
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then return 0; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then docker logs "$NAME" >"$LOG" 2>&1; echo "the container stopped:"; tail -40 "$LOG"; return 1; fi
    sleep 1
  done
  docker logs "$NAME" >"$LOG" 2>&1; echo "the container did not come up in 240 s:"; tail -40 "$LOG"; return 1
}
fail_with_log() { docker logs "$NAME" >"$LOG" 2>&1 || true; tail -40 "$LOG"; return 1; }

echo "==> run 1: MODELER_PASSWORD set"
start -e MODELER_PASSWORD='s3cret{pass}word'
wait_up
docker logs "$NAME" >"$LOG" 2>&1
smoke_check "the password is not printed when it was chosen" bash -c "! grep -q 's3cret' '$LOG'"
smoke_check "the demo password modeler/modeler is refused" test "$(smoke_status -u modeler:modeler "$BASE/api/engine")" = 401
smoke_check "alice/alice is refused" test "$(smoke_status -u alice:alice "$BASE/api/engine")" = 401
smoke_check "the chosen password is accepted" test "$(smoke_status -u 'modeler:s3cret{pass}word' "$BASE/api/engine")" = 200
smoke_checks "$BASE" 'modeler:s3cret{pass}word'
smoke_check "the image is configured to run as a non-root user id" bash -c "u=\$(docker inspect -f '{{.Config.User}}' '$IMAGE'); [ -n \"\$u\" ] && [ \"\${u%%:*}\" != 0 ] && [ \"\${u%%:*}\" != root ]"
smoke_check "the server process is not root" bash -c "uids=\$(docker top '$NAME' | tail -n +2 | awk '{print \$1}'); [ -n \"\$uids\" ] && ! echo \"\$uids\" | grep -qx 0"
smoke_check "the image has no shell" bash -c "! docker exec '$NAME' /bin/sh -c true >/dev/null 2>&1 && ! docker exec '$NAME' /bin/bash -c true >/dev/null 2>&1"
smoke_check "the image has no package manager and no busybox, wget or curl" bash -c "for f in /sbin/apk /bin/busybox /bin/sh /usr/bin/wget /usr/bin/curl /usr/bin/apt /usr/bin/dpkg; do ! docker cp '$NAME:'\$f - >/dev/null 2>&1 || { echo \$f is in the image; exit 1; }; done"
smoke_check "the workspace is the /data volume" bash -c "docker cp '$NAME:/data/smoke/a.json' - >/dev/null"
smoke_check "the licence files are in the image" bash -c "for f in LICENSE NOTICE THIRD-PARTY-NOTICES.md; do [ \"\$(docker cp \"$NAME:/app/\$f\" - | tar -xO | wc -c)\" -gt 0 ] || exit 1; done"
docker rm -f "$NAME" >/dev/null

echo "==> run 2: a new container on the same volume, no password given"
start
wait_up
docker logs "$NAME" >"$LOG" 2>&1
GENERATED="$(grep -ao 'with the password [A-Za-z0-9]*' "$LOG" | head -1 | awk '{print $NF}')"
smoke_check "a generated password is printed" test "${#GENERATED}" -ge 16
smoke_check "the printed password is accepted" test "$(smoke_status -u "modeler:$GENERATED" "$BASE/api/engine")" = 200
smoke_check "the demo password modeler/modeler is refused" test "$(smoke_status -u modeler:modeler "$BASE/api/engine")" = 401
smoke_check "the project of the first container is still in the volume" test "$(smoke_status -u "modeler:$GENERATED" "$BASE/api/dev/workspace/smoke/a.json")" = 200
smoke_check "the container reports healthy within its start period" bash -c "for i in \$(seq 1 40); do s=\$(docker inspect -f '{{.State.Health.Status}}' '$NAME'); [ \"\$s\" = healthy ] && exit 0; sleep 3; done; exit 1"
docker rm -f "$NAME" >/dev/null

echo "==> run 3: hardened (--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges), on a new volume"
docker volume rm -f "$VOLUME" >/dev/null
start -e MODELER_PASSWORD='s3cret{pass}word' --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges
wait_up
smoke_check "the root file system is read-only" bash -c "[ \"\$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' '$NAME')\" = true ]"
smoke_checks "$BASE" 'modeler:s3cret{pass}word'
smoke_check "the container reports healthy" bash -c "for i in \$(seq 1 40); do s=\$(docker inspect -f '{{.State.Health.Status}}' '$NAME'); [ \"\$s\" = healthy ] && exit 0; sleep 3; done; exit 1"
echo "smoke test passed ($IMAGE)"
