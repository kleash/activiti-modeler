#!/usr/bin/env bash
# Prints the CHANGELOG.md section of a version, for the notes of a GitHub Release (ADR 0008, feature K7).
#   scripts/release-notes.sh <version> [--allow-unreleased]
# <version> is without the "v" (1.0.0). The section is the one headed "## [1.0.0]" (optionally followed by " - date") up to the next "## [".
# A release needs its section: the script fails when it is missing or empty. --allow-unreleased (a dry run) falls back to "## [Unreleased]".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${1:-}"
[ -n "$version" ] || { echo "usage: scripts/release-notes.sh <version> [--allow-unreleased]" >&2; exit 2; }
allow_unreleased=0
[ "${2:-}" = "--allow-unreleased" ] && allow_unreleased=1

section() { # section <heading name>
  awk -v name="$1" '
    BEGIN { found = 0 }
    /^## \[/ { if (found) exit; if (index($0, "## [" name "]") == 1) { found = 1; next } }
    found { print }
  ' "$ROOT/CHANGELOG.md"
}

notes="$(section "$version")"
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  if [ "$allow_unreleased" -eq 1 ]; then
    notes="$(section "Unreleased")"
    echo "(no CHANGELOG section for $version: showing [Unreleased])" >&2
  fi
fi
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no section '## [$version]' with content. Rename [Unreleased] to [$version] before tagging." >&2
  exit 1
fi
printf '%s\n' "$notes"
