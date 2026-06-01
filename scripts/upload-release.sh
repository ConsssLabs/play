#!/usr/bin/env bash
set -euo pipefail
#
# Upload the Godot Web export's large binaries (index.wasm ~38 MB,
# index.pck ~316 MB) as a GitHub Release on ConsssLabs/play.
#
# Why: these exceed CF Pages' 25 MiB/file limit AND GitHub's 100 MB-in-git
# limit, so they ship as Release ASSETS instead. public/_redirects points
# /index.wasm and /index.pck at releases/latest/download/, so whichever
# release is newest is what play.conssswars.com serves — no edit needed here
# when you ship a new build, just run this again.
#
# Usage:
#   scripts/upload-release.sh [EXPORT_DIR] [TAG]
#     EXPORT_DIR  dir holding index.wasm + index.pck (default ../app/exports/web)
#     TAG         release tag (default web-YYYYMMDD-HHMM)
#
# Requires: gh (authenticated), and a Godot Web export already produced in app.

EXPORT_DIR="${1:-../app/exports/web}"
TAG="${2:-web-$(date +%Y%m%d-%H%M)}"
REPO="ConsssLabs/play"

WASM="$EXPORT_DIR/index.wasm"
PCK="$EXPORT_DIR/index.pck"
for f in "$WASM" "$PCK"; do
  [ -f "$f" ] || { echo "ERROR: missing $f — run the Godot Web export first." >&2; exit 1; }
done

echo "Uploading to $REPO as release '$TAG':"
ls -lh "$WASM" "$PCK"
echo

gh release create "$TAG" "$WASM" "$PCK" \
  --repo "$REPO" \
  --title "Web build $TAG" \
  --notes "Godot HTML5 engine binaries (index.wasm + index.pck) for play.conssswars.com. Served via public/_redirects → releases/latest/download/."

echo
echo "Done. This is now the latest release; play.conssswars.com will serve these binaries."
