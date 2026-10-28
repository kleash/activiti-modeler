#!/usr/bin/env bash
# Smoke test of a desktop bundle zip made by scripts/package-desktop.sh, on the operating system it was built for (ADR 0008, feature K4/K7):
# unzips it into a temporary folder, starts the launcher WITHOUT arguments the way a double-click does (only the home folder, the browser and the
# window are redirected through environment variables so that nothing opens and the real home is untouched), waits for the URL in the log, runs
# the checks of scripts/smoke-lib.sh, and stops the app.
#   scripts/smoke-bundle.sh <activiti-modeler-<version>-<os>-<arch>.zip>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# smoke-lib.sh is the only part of the repository this needs, besides the zip
# shellcheck source=scripts/smoke-lib.sh
source "$ROOT/scripts/smoke-lib.sh"

ZIP="${1:-}"
[ -f "$ZIP" ] || { echo "usage: scripts/smoke-bundle.sh <bundle.zip>" >&2; exit 2; }
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) echo "unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac

WORK="$(mktemp -d)"
# Windows (Git Bash): Windows-style paths (C:/...), which the native launcher, Java and 7z understand
if [ "$os" = windows ]; then
  WORK="$(cygpath -m "$WORK")"
  ZIP="$(cygpath -m "$ZIP")"
fi
LOG="$WORK/home/logs/activiti-modeler.log"
OUT="$WORK/launcher-output.log"
PID=""
cleanup() {
  stop_app
  if [ "${SMOKE_KEEP_LOG:-0}" != 1 ]; then rm -rf "$WORK"; else echo "kept $WORK"; fi
}
trap cleanup EXIT

# --- unzip -------------------------------------------------------------------------------------------------------------------------
mkdir -p "$WORK/unzipped"
if command -v unzip >/dev/null 2>&1; then unzip -q "$ZIP" -d "$WORK/unzipped"
elif command -v 7z >/dev/null 2>&1; then (cd "$WORK/unzipped" && 7z x -y -bso0 "$ZIP")
elif command -v tar >/dev/null 2>&1; then (cd "$WORK/unzipped" && tar -xf "$ZIP")
else (cd "$WORK/unzipped" && jar xf "$ZIP"); fi

if [ "$os" = macos ]; then
  bundle="$WORK/unzipped/Activiti Modeler.app"; launcher="$bundle/Contents/MacOS/Activiti Modeler"
elif [ "$os" = windows ]; then
  bundle="$WORK/unzipped/Activiti Modeler"; launcher="$bundle/Activiti Modeler.exe"
else
  bundle="$WORK/unzipped/Activiti Modeler"; launcher="$bundle/bin/Activiti Modeler"
fi
[ -f "$launcher" ] || { echo "FAIL launcher not found: $launcher"; (cd "$WORK/unzipped" && find . -maxdepth 3 | head -30); exit 1; }
echo "ok   the zip holds the launcher: ${launcher#$WORK/unzipped/}"
[ "$os" = windows ] || [ -x "$launcher" ] || { echo "FAIL the launcher is not executable (the zip lost the file permissions)"; exit 1; }

for notice in LICENSE NOTICE THIRD-PARTY-NOTICES.md; do
  found="$(find "$bundle" -type f -name "$notice" -not -path '*/runtime/*' | head -1)"
  [ -n "$found" ] || { echo "FAIL $notice is not in the bundle"; exit 1; }
  echo "ok   $notice is in the bundle (${found#$WORK/unzipped/})"
done
java_in_bundle="$(find "$bundle" -type f \( -name java -o -name java.exe \) -path '*runtime*' -path '*bin*' | head -1)"
[ -n "$java_in_bundle" ] || { echo "FAIL no Java runtime in the bundle"; exit 1; }
runtime_modules="$("$java_in_bundle" --list-modules 2>/dev/null | sed -E 's/@.*//' | tr '\n' ' ')"
case "$runtime_modules" in *java.desktop*) echo "ok   the bundled runtime has java.desktop (status window); modules: $runtime_modules" ;; *) echo "FAIL the bundled runtime lacks java.desktop: $runtime_modules"; exit 1 ;; esac
if [ "$os" != windows ]; then
  size="$(du -sk "$bundle" | awk '{printf "%.0f", $1/1024}')"
  echo "ok   unpacked size: ${size} MB"
fi

# --- start: no arguments, as a double-click ------------------------------------------------------------------------------------------
stop_app() {
  [ -n "${PID:-}" ] || return 0
  if [ "$os" = windows ]; then
    local winpid
    winpid="$(netstat -ano 2>/dev/null | tr -d '\r' | grep -E "[:.]${PORT:-0} .*LISTENING" | awk '{print $NF}' | head -1)"
    if [ -n "$winpid" ]; then taskkill //F //T //PID "$winpid" >/dev/null 2>&1 || true; fi
    kill "$PID" 2>/dev/null || true
  else
    kill "$PID" 2>/dev/null || true
    local i
    for i in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
    kill -9 "$PID" 2>/dev/null || true
  fi
  wait "$PID" 2>/dev/null || true
  PID=""
}

export MODELER_HOME="$WORK/home"                      # instead of ~/ActivitiModeler
export MODELER_SERVER_OPEN_BROWSER=false              # a CI machine has a display; do not open a browser or a window
export MODELER_SERVER_STATUS_WINDOW=false
"$launcher" >"$OUT" 2>&1 &
PID=$!

URL=""
for _ in $(seq 1 240); do
  if [ -f "$LOG" ]; then
    URL="$(grep -ao 'running at http://[^ ]*' "$LOG" 2>/dev/null | head -1 | sed 's/running at //' | tr -d '\r' || true)"
    [ -n "$URL" ] && break
  fi
  if [ "$os" != windows ] && ! kill -0 "$PID" 2>/dev/null; then echo "FAIL the app stopped before it was up:"; cat "$OUT" 2>/dev/null | tail -30; tail -30 "$LOG" 2>/dev/null; exit 1; fi
  sleep 1
done
[ -n "$URL" ] || { echo "FAIL no 'running at' line in the log after 240 s"; tail -30 "$OUT" 2>/dev/null; tail -30 "$LOG" 2>/dev/null; exit 1; }
BASE="${URL%/}"
PORT="${BASE##*:}"
echo "ok   started without arguments; it printed its address: $URL"
smoke_wait_health "$BASE" 0 120

smoke_check "the workspace folder was created in the home folder" test -d "$MODELER_HOME/workspace"
smoke_check "the log file is in the home folder" test -s "$MODELER_HOME/logs/activiti-modeler.log"
smoke_check "the port is 8080 or a free one (here $PORT)" test -n "$PORT"
smoke_checks "$BASE" modeler:modeler "$PORT"
smoke_check "the workspace file landed in the default workspace" test -f "$MODELER_HOME/workspace/smoke/a.json"

# --- stop --------------------------------------------------------------------------------------------------------------------------
stop_app
sleep 1
smoke_check "the app is stopped" bash -c "! curl -fsS -m 3 '$BASE/api/health' >/dev/null 2>&1"
echo "smoke test passed ($(basename "$ZIP"))"
