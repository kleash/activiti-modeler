#!/usr/bin/env bash
# Downloads the pinned OSV-Scanner and refuses to use it unless its SHA-256 matches the one stored in this repository
# (scripts/osv-scanner.sha256, the osv-scanner_SHA256SUMS file of the release). Prints the path of the verified binary on stdout.
#   scripts/install-osv-scanner.sh [directory]      (default: .tools/osv-scanner-<version>)
# To update: change VERSION, replace scripts/osv-scanner.sha256 with the new release's osv-scanner_SHA256SUMS, run it, and run scripts/cve-scan.sh.
# The checksum file comes from the same release as the binary, so it proves the download is intact and is the one that was reviewed, not that the
# release is authentic; the repository copy is what a pull request reviews.
set -euo pipefail

VERSION="v2.7.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${1:-$ROOT/.tools/osv-scanner-$VERSION}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "install-osv-scanner.sh: unsupported operating system $(uname -s) (Linux and macOS; on Windows use WSL or a Linux container)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "install-osv-scanner.sh: unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac
asset="osv-scanner_${os}_${arch}"
expected="$(awk -v a="$asset" '$2 == a { print $1 }' "$ROOT/scripts/osv-scanner.sha256")"
[ -n "$expected" ] || { echo "install-osv-scanner.sh: no checksum for $asset in scripts/osv-scanner.sha256" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

bin="$dir/osv-scanner"
if [ -x "$bin" ] && [ "$(sha256 "$bin")" = "$expected" ]; then
  echo "$bin"
  exit 0
fi
mkdir -p "$dir"
tmp="$(mktemp "$dir/download.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
echo "install-osv-scanner.sh: downloading OSV-Scanner $VERSION ($asset)" >&2
curl -fsSL --retry 3 -o "$tmp" "https://github.com/google/osv-scanner/releases/download/$VERSION/$asset"
actual="$(sha256 "$tmp")"
if [ "$actual" != "$expected" ]; then
  echo "install-osv-scanner.sh: SHA-256 MISMATCH for $asset: expected $expected, got $actual. Not using the download." >&2
  exit 1
fi
chmod +x "$tmp"
mv "$tmp" "$bin"
trap - EXIT
echo "install-osv-scanner.sh: $asset verified ($expected)" >&2
echo "$bin"
