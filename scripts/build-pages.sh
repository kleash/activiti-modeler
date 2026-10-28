#!/usr/bin/env bash
# Builds the static, browser-only modeler (ADR 0008, feature K6): the same web app as in the jar, with Vite's `base` set to the path it is served
# from. On GitHub Pages that is /<repository>/. Projects stay in the browser (IndexedDB); the run features show "connect to a server".
#   scripts/build-pages.sh [--base=/activiti-modeler/] [--out=dist-pages]
#     --base  the URL path of the site, with a slash at both ends (default /activiti-modeler/; "/" for a custom domain)
#     --out   the folder to write (default dist-pages/ in the repository root)
# Needs the npm packages installed (cd modeler && npm ci). The test API of the e2e suite (VITE_MODELER_TEST_API) is NOT switched on.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

base="/activiti-modeler/"
out="$ROOT/dist-pages"
for argument in "$@"; do
  case "$argument" in
    --base=*) base="${argument#--base=}" ;;
    --out=*) out="${argument#--out=}" ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $argument (see --help)" >&2; exit 2 ;;
  esac
done
case "$base" in /*/|/) ;; *) echo "--base must start and end with a slash, for example /activiti-modeler/ (got: $base)" >&2; exit 2 ;; esac
case "$out" in /*) ;; *) out="$(pwd)/$out" ;; esac

[ -d "$ROOT/modeler/node_modules" ] || { echo "modeler/node_modules is missing: run 'npm ci' in modeler/ first" >&2; exit 1; }
cd "$ROOT/modeler"
unset VITE_MODELER_TEST_API
rm -rf "$out"
# the app's build script is "tsc -p tsconfig.json && vite build"; the arguments after -- go to vite
npm run build -w app -- --base="$base" --outDir="$out" --emptyOutDir
touch "$out/.nojekyll"
# a page that is not found gets the app (the app has no routes of its own; this keeps a stale bookmark from a 404)
cp "$out/index.html" "$out/404.html"
echo
echo "Built the browser-only modeler in $out (base $base)"
du -sh "$out" | awk '{print "size: " $1}'
