#!/usr/bin/env bash
# Signs the macOS desktop bundles with a Developer ID and the hardened runtime, notarizes and staples them (ADR 0008, feature K4). Runs on a Mac:
# the certificate stays in the maintainer's Keychain, so the release workflow builds the bundles signed ad hoc and leaves the release a draft.
#   scripts/sign-macos.sh v<x.y.z>           download the two macOS zips of the draft release, sign and notarize them, upload them back with a new
#                                            SHA256SUMS, publish the release and update the Homebrew cask (kleash/homebrew-tap, Casks/activiti-modeler.rb)
#   scripts/sign-macos.sh --local <zip>...   sign and notarize these zips in place; publishes nothing
# One-time setup: Xcode > Settings > Accounts > Manage Certificates > + > Developer ID Application, then
#   xcrun notarytool store-credentials activiti-modeler-notary --apple-id <Apple ID> --team-id <team ID>
# NOTARY_PROFILE names another notarytool profile. Needs gh, signed in with write access to the repository and the tap.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO=kleash/activiti-modeler
TAP=kleash/homebrew-tap
APP_NAME="Activiti Modeler"
profile="${NOTARY_PROFILE:-activiti-modeler-notary}"

case "${1:-}" in
  --local) shift; [ $# -gt 0 ] || { echo "usage: $0 --local <zip>..." >&2; exit 2; }; tag=""; zips=("$@") ;;
  v[0-9]*) [ $# -eq 1 ] || { echo "usage: $0 v<x.y.z>" >&2; exit 2; }; tag="$1" ;;
  *) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

[ "$(uname -s)" = Darwin ] || { echo "this runs on macOS only" >&2; exit 1; }
identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)"
[ -n "$identity" ] || { echo "no \"Developer ID Application\" identity in the Keychain: see the top of $0" >&2; exit 1; }
xcrun notarytool history --keychain-profile "$profile" >/dev/null || { echo "no notarytool profile \"$profile\": see the top of $0" >&2; exit 1; }
entitlements="$ROOT/packaging/macos/entitlements.plist"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ -n "$tag" ]; then
  version="${tag#v}"
  [ "$(gh release view "$tag" --repo "$REPO" --json isDraft --jq .isDraft)" = true ] || { echo "$tag is not a draft release: it is already published" >&2; exit 1; }
  zips=()
  for arch in arm64 x64; do
    gh release download "$tag" --repo "$REPO" --pattern "activiti-modeler-$version-macos-$arch.zip" --dir "$work/download"
    zips+=("$work/download/activiti-modeler-$version-macos-$arch.zip")
  done
fi

sign() { # sign <zip>: replaces the zip with one that holds the signed, notarized and stapled app
  local zip="$1" dir="$work/$(basename "$1" .zip)"
  local app="$dir/$APP_NAME.app"
  echo "==> $(basename "$zip")"
  mkdir -p "$dir" && ditto -x -k "$zip" "$dir"
  [ -d "$app" ] || { echo "no $APP_NAME.app in $zip" >&2; exit 1; }
  # inside out: every Mach-O file of the runtime and the launcher, then the runtime bundle, then the app
  while IFS= read -r -d '' file; do
    if file -b "$file" | grep -q 'Mach-O'; then
      if [ -x "$file" ] && ! file -b "$file" | grep -q 'dynamically linked shared library'; then
        codesign --force --options runtime --timestamp --entitlements "$entitlements" --sign "$identity" "$file"
      else
        codesign --force --options runtime --timestamp --sign "$identity" "$file"
      fi
    fi
  done < <(find "$app/Contents/runtime" "$app/Contents/MacOS" -type f -print0)
  codesign --force --options runtime --timestamp --sign "$identity" "$app/Contents/runtime"
  codesign --force --options runtime --timestamp --entitlements "$entitlements" --sign "$identity" "$app"
  codesign --verify --deep --strict "$app"
  ditto -c -k --keepParent "$app" "$work/notarize.zip"
  echo "    notarizing (a few minutes)"
  xcrun notarytool submit "$work/notarize.zip" --keychain-profile "$profile" --wait --timeout 30m | tee "$work/notary.log"
  grep -q 'status: Accepted' "$work/notary.log" || { echo "notarization was not accepted: xcrun notarytool log <id> --keychain-profile $profile" >&2; exit 1; }
  xcrun stapler staple "$app"
  spctl --assess --type execute --verbose=2 "$app"
  # the same layout as scripts/package-desktop.sh: the app and the licence files at the top of the zip
  rm -f "$zip"
  (cd "$dir" && zip -qry "$zip" .)
}
for zip in "${zips[@]}"; do sign "$(cd "$(dirname "$zip")" && pwd)/$(basename "$zip")"; done

[ -n "$tag" ] || { echo "Signed and notarized: ${zips[*]}"; exit 0; }

echo "==> the release: the signed zips, a new SHA256SUMS, published"
gh release download "$tag" --repo "$REPO" --pattern SHA256SUMS --dir "$work/download"
for zip in "${zips[@]}"; do
  name="$(basename "$zip")"
  grep -v "  $name\$" "$work/download/SHA256SUMS" > "$work/sums" || true
  (cd "$work/download" && shasum -a 256 "$name") >> "$work/sums"
  sort -k2 "$work/sums" > "$work/download/SHA256SUMS"
done
(cd "$work/download" && shasum -a 256 -c SHA256SUMS --ignore-missing)
gh release upload "$tag" --repo "$REPO" --clobber "${zips[@]}" "$work/download/SHA256SUMS"
gh release edit "$tag" --repo "$REPO" --draft=false

echo "==> the Homebrew cask"
sha_arm="$(shasum -a 256 "$work/download/activiti-modeler-$version-macos-arm64.zip" | cut -d' ' -f1)"
sha_intel="$(shasum -a 256 "$work/download/activiti-modeler-$version-macos-x64.zip" | cut -d' ' -f1)"
cat > "$work/cask.rb" <<EOF
cask "activiti-modeler" do
  arch arm: "arm64", intel: "x64"

  version "$version"
  sha256 arm:   "$sha_arm",
         intel: "$sha_intel"

  url "https://github.com/$REPO/releases/download/v#{version}/activiti-modeler-#{version}-macos-#{arch}.zip"
  name "Activiti Modeler"
  desc "BPMN and DMN modeler for Activiti, with an embedded engine to run the models"
  homepage "https://github.com/$REPO"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on :macos

  app "Activiti Modeler.app"

  uninstall quit: "io.github.kleash.activiti.modeler"

  zap trash: "~/Library/Saved Application State/io.github.kleash.activiti.modeler.savedState"

  caveats <<~EOS
    Your projects are in ~/ActivitiModeler; neither uninstall nor zap deletes them.
  EOS
end
EOF
path=Casks/activiti-modeler.rb
old_sha="$(gh api "repos/$TAP/contents/$path" --jq .sha 2>/dev/null || true)"
args=(-f message="activiti-modeler $version" -f content="$(base64 < "$work/cask.rb" | tr -d '\n')")
[ -z "$old_sha" ] || args+=(-f sha="$old_sha")
gh api -X PUT "repos/$TAP/contents/$path" "${args[@]}" --jq .commit.html_url
echo
echo "Published $tag with the signed macOS apps. Install with:  brew install kleash/tap/activiti-modeler"
