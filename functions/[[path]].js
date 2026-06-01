// Cloudflare Pages Function — same-origin proxy for the large engine binaries.
//
// Why this exists: index.wasm / index.pck are too big for CF Pages (25 MiB
// limit) so they live as GitHub Release assets. A plain redirect to GitHub
// fails because GitHub's release-asset host (release-assets.githubusercontent.com)
// does NOT send Access-Control-Allow-Origin, so the browser blocks the
// cross-origin fetch (verified 2026-06-02).
//
// This Function runs at Cloudflare's edge and fetches the asset SERVER-side
// (no browser CORS involved), then streams it back from play.conssswars.com
// itself — same-origin, so the browser is happy. /releases/latest/download/
// always resolves to the newest release, so new builds need no change here.
//
// Everything else falls through to the static assets in public/ via next().

const RELEASE_BASE =
  'https://github.com/ConsssLabs/play/releases/latest/download';

const PROXIED = {
  '/index.wasm': 'application/wasm',
  '/index.pck': 'application/octet-stream',
};

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const contentType = PROXIED[url.pathname];

  // Not a big binary → serve the static shell normally.
  if (!contentType) return next();

  const upstream = `${RELEASE_BASE}${url.pathname}`;
  const resp = await fetch(upstream, { redirect: 'follow' });

  if (!resp.ok || !resp.body) {
    return new Response(`Upstream ${resp.status} for ${url.pathname}`, {
      status: 502,
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=3600');
  const len = resp.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  // Same-origin response → no CORS needed. Stream the body straight through.
  return new Response(resp.body, { status: 200, headers });
}
