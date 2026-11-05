#!/bin/sh
# Bundles the add-on with the app into dist/quran_finder/. Copy that folder into
# Home Assistant's /addons share, then install it from the add-on store
# (Local add-ons).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist/quran_finder"
rm -rf "$out"
mkdir -p "$out"
cp -r "$root/homeassistant/quran_finder/." "$out/"
cp -r "$root/package.json" "$root/package-lock.json" "$root/server" "$root/lib" "$root/public" "$out/"
# The add-on's version is package.json's, so Home Assistant offers each new one as an update
version=$(node -p "require('$root/package.json').version")
sed -i.bak "s/^version: .*/version: \"$version\"/" "$out/config.yaml" && rm "$out/config.yaml.bak"
echo "Built $out"
