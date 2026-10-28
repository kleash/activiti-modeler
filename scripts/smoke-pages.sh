#!/usr/bin/env bash
# Smoke test of the browser-only build under a sub-path, the way GitHub Pages serves it (ADR 0008, feature K6): serves the folder that
# scripts/build-pages.sh made with `vite preview --base=<base>` and drives it with Chromium (modeler/scripts/smoke-pages.mjs).
#   scripts/smoke-pages.sh [--base=/activiti-modeler/] [--dir=dist-pages]     (builds the folder first when it does not exist)
# Needs `npm ci` in modeler/ and the Playwright Chromium (npx playwright install chromium).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

base="/activiti-modeler/"
dir="$ROOT/dist-pages"
for argument in "$@"; do
  case "$argument" in
    --base=*) base="${argument#--base=}" ;;
    --dir=*) dir="${argument#--dir=}" ;;
    -h|--help) sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $argument (see --help)" >&2; exit 2 ;;
  esac
done
case "$dir" in /*) ;; *) dir="$(pwd)/$dir" ;; esac
[ -f "$dir/index.html" ] || "$ROOT/scripts/build-pages.sh" --base="$base" --out="$dir"

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
LOG="$(mktemp)"
cd "$ROOT/modeler/app"
# the vite binary directly (one process to stop), not through npm
"$ROOT/modeler/node_modules/.bin/vite" preview --host 127.0.0.1 --port "$PORT" --strictPort --base="$base" --outDir="$dir" >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT${base}" >/dev/null 2>&1; then break; fi
  kill -0 "$PID" 2>/dev/null || { echo "vite preview stopped:"; cat "$LOG"; exit 1; }
  sleep 1
done
cd "$ROOT/modeler"
node scripts/smoke-pages.mjs "http://127.0.0.1:$PORT$base"
