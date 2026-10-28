#!/usr/bin/env bash
# Keeps docker/jdk-alpine.env (the Temurin 25 Alpine JDK that the Docker image's Java runtime is linked from) current.
#
#   scripts/update-jdk-alpine.sh            report: is the pinned build the newest Temurin 25 GA? Is the pinned checksum the one the Adoptium API publishes?
#   scripts/update-jdk-alpine.sh --write    rewrite the version and both checksums in docker/jdk-alpine.env with the newest build
#
# Exit status: 0 when the pin is current, when a newer build exists (that is only a warning: on GitHub Actions it is printed as a "::warning::"
# annotation), and when the API cannot be reached (also a warning, so that an outage of api.adoptium.net does not block a release); 1 when the API
# publishes a DIFFERENT checksum for the pinned version (the archive was replaced: look at it before building anything); 2 for a wrong option.
# Needs curl and python3. The OSV scan does not cover a JDK, so this check is how the image's Java stays current.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="$ROOT/docker/jdk-alpine.env"
write=0
case "${1:-}" in
  "") ;;
  --write) write=1 ;;
  -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
esac

warn() { # warn <title> <message>
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::warning title=$1::$2"; else echo "warning: $1: $2" >&2; fi
}

# shellcheck source=docker/jdk-alpine.env
. "$PIN"

api() { # api <x64|aarch64> -> "<semver> <sha256>" of the newest GA build, one line
  curl -fsS --retry 3 --max-time 60 \
    "https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=$1&image_type=jdk&os=alpine-linux&vendor=eclipse" \
    | python3 -I -c '
import json, sys
releases = json.load(sys.stdin)
if len(releases) != 1:
    sys.exit("expected one release, the API returned %d" % len(releases))
binary = releases[0]["binary"]
if binary["os"] != "alpine-linux" or binary["image_type"] != "jdk" or binary["package"]["name"].find("alpine-linux") < 0:
    sys.exit("the API returned something else than an Alpine JDK: " + binary["package"]["name"])
name = releases[0]["release_name"]
if not name.startswith("jdk-25."):
    sys.exit("unexpected release name " + name)
print(name[len("jdk-"):], binary["package"]["checksum"])
'
}

if ! latest_x64="$(api x64)" || ! latest_aarch64="$(api aarch64)"; then
  warn "Temurin 25 check skipped" "the Adoptium API could not be read; docker/jdk-alpine.env pins Temurin $TEMURIN_VERSION"
  exit 0
fi
version_x64="${latest_x64% *}"; sha_x64="${latest_x64#* }"
version_aarch64="${latest_aarch64% *}"; sha_aarch64="${latest_aarch64#* }"
if [ "$version_x64" != "$version_aarch64" ]; then
  warn "Temurin 25 check skipped" "the newest Alpine builds differ per architecture (x64 $version_x64, aarch64 $version_aarch64): wait until both exist"
  exit 0
fi
echo "pinned: Temurin $TEMURIN_VERSION    newest Temurin 25 GA for Alpine: $version_x64"

if [ "$write" = 1 ]; then
  tmp="$(mktemp)"
  sed -e "s|^TEMURIN_VERSION=.*|TEMURIN_VERSION=$version_x64|" \
      -e "s|^TEMURIN_SHA256_X64=.*|TEMURIN_SHA256_X64=$sha_x64|" \
      -e "s|^TEMURIN_SHA256_AARCH64=.*|TEMURIN_SHA256_AARCH64=$sha_aarch64|" "$PIN" >"$tmp"
  cat "$tmp" >"$PIN"; rm -f "$tmp"
  echo "docker/jdk-alpine.env now pins Temurin $version_x64; rebuild the image and run the smoke test and the image scan before committing"
  exit 0
fi

if [ "$version_x64" = "$TEMURIN_VERSION" ]; then
  if [ "$sha_x64" != "$TEMURIN_SHA256_X64" ] || [ "$sha_aarch64" != "$TEMURIN_SHA256_AARCH64" ]; then
    echo "error: the Adoptium API publishes another SHA-256 for Temurin $TEMURIN_VERSION than docker/jdk-alpine.env pins:" >&2
    echo "  x64      pinned $TEMURIN_SHA256_X64" >&2; echo "           API    $sha_x64" >&2
    echo "  aarch64  pinned $TEMURIN_SHA256_AARCH64" >&2; echo "           API    $sha_aarch64" >&2
    echo "the archive of a release was replaced; do not build the image before you know why" >&2
    exit 1
  fi
  echo "docker/jdk-alpine.env is current"
else
  warn "A newer Temurin 25 exists" "the image pins Temurin $TEMURIN_VERSION, the newest is $version_x64: run scripts/update-jdk-alpine.sh --write, test, and commit (docker/jdk-alpine.env)"
fi
