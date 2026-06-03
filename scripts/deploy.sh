#!/usr/bin/env bash
set -euo pipefail
#
# One-command MANUAL deploy for play.conssswars.com.
#
# Does the whole pipeline locally so nothing error-prone is copied by hand and
# NO Cloudflare token ever lives in GitHub:
#   1. copy the fresh Godot Web export's loader/worklets/icon into public/
#   2. build the wallet bridge (no secrets baked in — Tatum key is server-side)
#   3. upload index.wasm + index.pck to a GitHub Release (engine binaries)
#   4. wrangler pages deploy public/ -> consss-play
#   5. verify
#
# You run this when YOU decide a build is good (the manual gate). The CF token
# stays on this machine only and should be deleted after (see end).
#
# Prereqs (all local, none in GitHub):
#   - You exported the Web preset in Godot to app/exports/web/ first.
#   - ~/.cf_token         : a Cloudflare API token with Pages:Edit (deleted after).
#   - CLOUDFLARE_ACCOUNT_ID env var, or ~/.cf_account file holding the account id.
#   - gh authenticated (for the Release upload).
#
# Usage:  cd play && scripts/deploy.sh [EXPORT_DIR]
#         EXPORT_DIR defaults to ../app/exports/web

EXPORT_DIR="${1:-../app/exports/web}"
PROJECT="consss-play"
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # play/ root
cd "$HERE"

# --- credentials, all local ---
[ -f ~/.cf_token ] || { echo "ERROR: ~/.cf_token missing (Cloudflare token, Pages:Edit)." >&2; exit 1; }
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cat ~/.cf_account 2>/dev/null || true)}"
[ -n "$ACCOUNT_ID" ] || { echo "ERROR: set CLOUDFLARE_ACCOUNT_ID env or put the id in ~/.cf_account." >&2; exit 1; }

# --- check the export exists ---
for f in index.js index.audio.worklet.js index.audio.position.worklet.js index.icon.png index.wasm index.pck; do
  [ -f "$EXPORT_DIR/$f" ] || { echo "ERROR: missing $EXPORT_DIR/$f — run the Godot Web export first." >&2; exit 1; }
done

echo "==> 1/5 refresh shell loader/worklets/icon from $EXPORT_DIR"
cp "$EXPORT_DIR"/index.js "$EXPORT_DIR"/index.audio.worklet.js \
   "$EXPORT_DIR"/index.audio.position.worklet.js "$EXPORT_DIR"/index.icon.png public/

echo "==> 2/5 build bridge (no key in bundle)"
( cd bridge && npm install --silent && npm run build )

echo "==> 3/5 upload engine binaries to GitHub Release"
TAG="web-$(date +%Y%m%d-%H%M%S)"
gh release create "$TAG" "$EXPORT_DIR/index.wasm" "$EXPORT_DIR/index.pck" \
  --repo ConsssLab/play --title "$TAG" --notes "Manual deploy $TAG"

echo "==> 4/5 deploy public/ to Cloudflare Pages ($PROJECT)"
CLOUDFLARE_API_TOKEN="$(cat ~/.cf_token)" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" \
  npx -y wrangler@latest pages deploy public --project-name "$PROJECT" --branch main --commit-dirty=true

echo "==> 5/6 purge edge cache for the big binaries"
# functions/[[path]].js edge-caches /index.pck + /index.wasm with a long TTL.
# A new release reuses the SAME paths, so without a purge the CF edge keeps
# serving the OLD pck/wasm -> stale game. Best-effort: needs a token with
# Zone:Cache Purge + the zone id in ~/.cf_zone. If unavailable, purge manually:
#   CF dashboard -> conssswars.com -> Caching -> Configuration ->
#   Purge Custom URLs -> paste both URLs below.
ZONE_ID="$(cat ~/.cf_zone 2>/dev/null || true)"
if [ -n "$ZONE_ID" ]; then
  purge=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $(cat ~/.cf_token)" \
    -H "Content-Type: application/json" \
    --data '{"files":["https://play.conssswars.com/index.pck","https://play.conssswars.com/index.wasm"]}')
  echo "    purge response: $purge"
  case "$purge" in
    *'"success":true'*) echo "    edge cache purged OK" ;;
    *) echo "    !! purge FAILED (token lacks Cache Purge?) — purge manually in dashboard (see above)." ;;
  esac
else
  echo "    ~/.cf_zone not set — purge MANUALLY in dashboard, or the new build won't go live:"
  echo "      https://play.conssswars.com/index.pck"
  echo "      https://play.conssswars.com/index.wasm"
fi

echo "==> 6/6 verify"
sleep 6
for path in / /index.wasm /index.pck; do
  code=$(curl -s -o /dev/null -m 25 -w "%{http_code}" "https://play.conssswars.com$path" || echo "ERR")
  echo "    https://play.conssswars.com$path -> $code"
done

echo
echo "Done. Reminder: 'rm -f ~/.cf_token' and revoke the token when finished."
