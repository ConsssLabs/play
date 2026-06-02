// Cloudflare Pages Function — same-origin edge proxy.
//
// Two jobs, both so the browser only ever talks to play.conssswars.com:
//
//  1. /index.wasm, /index.pck — the engine binaries are too big for CF Pages
//     (25 MiB/file) so they live as GitHub Release assets. A plain redirect to
//     GitHub fails CORS (release-assets.githubusercontent.com sends no ACAO,
//     verified 2026-06-02), so we fetch them server-side and stream them back
//     same-origin. /releases/latest/download/ tracks the newest release.
//
//  2. /rpc — Sui JSON-RPC proxy. The Tatum API key is a SERVER-SIDE secret
//     (CF Pages env var TATUM_API_KEY); it is never shipped to the browser.
//     The browser's SuiClient POSTs to /rpc; we add the x-api-key header,
//     forward to Tatum, and fall back to the public Sui fullnode on any
//     failure. (mint() signs through the player's wallet, not this path.)
//
// Everything else falls through to the static assets in public/ via next().

const RELEASE_BASE =
  'https://github.com/ConsssLabs/play/releases/latest/download';

const PROXIED = {
  '/index.wasm': 'application/wasm',
  '/index.pck': 'application/octet-stream',
};

// Testnet defaults; override via CF Pages env vars if you switch networks.
const DEFAULT_TATUM_RPC = 'https://sui-testnet.gateway.tatum.io';
const DEFAULT_PUBLIC_RPC = 'https://fullnode.testnet.sui.io:443';

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/rpc') return handleRpc(context);

  const contentType = PROXIED[url.pathname];
  if (!contentType) return next(); // static asset

  const resp = await fetch(`${RELEASE_BASE}${url.pathname}`, { redirect: 'follow' });
  if (!resp.ok || !resp.body) {
    return new Response(`Upstream ${resp.status} for ${url.pathname}`, { status: 502 });
  }
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=3600');
  const len = resp.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  return new Response(resp.body, { status: 200, headers });
}

// --- /rpc : Tatum-keyed Sui JSON-RPC with public-fullnode fallback ---------
async function handleRpc(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await request.arrayBuffer(); // reused for both upstreams
  const key = env.TATUM_API_KEY;
  const tatumUrl = env.TATUM_RPC_URL || DEFAULT_TATUM_RPC;
  const publicUrl = env.PUBLIC_RPC_URL || DEFAULT_PUBLIC_RPC;

  // Try Tatum first (only if a key is configured).
  if (key) {
    try {
      const r = await fetch(tatumUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body,
      });
      if (r.ok) return jsonPassthrough(r);
    } catch (_) {
      // fall through to public RPC
    }
  }

  // Fallback: public Sui fullnode (no key, reads are idempotent).
  const r2 = await fetch(publicUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return jsonPassthrough(r2);
}

function jsonPassthrough(resp) {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(resp.body, { status: resp.status, headers });
}
