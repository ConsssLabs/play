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
//  3. /mint-voucher — signs an authority ed25519 voucher (anti-cheat) so the
//     player can mint a Chronicle. The authority private key is a SERVER-SIDE
//     secret (AUTHORITY_PRIVKEY_HEX). NOTE: this trusts the client-reported
//     hp_pct/battle_id — the inherent ceiling for a client-side game. Its value
//     is being the single chokepoint we control: it blocks the "craft a PTB and
//     mint directly" attack (the contract rejects any mint without a valid
//     voucher) and is where rate-limiting / deeper validation would be added.
//
// Everything else falls through to the static assets in public/ via next().

import * as ed from '@noble/ed25519';

const RELEASE_BASE =
  'https://github.com/ConsssLab/play/releases/latest/download';

// Part of the edge-cache key for /index.pck + /index.wasm. A new release reuses
// the same paths, so bumping this value instantly retires the old cached
// binaries — no Cloudflare Cache-Purge token scope required. scripts/deploy.sh
// stamps this with the unique release tag on every deploy (and restores the
// placeholder after), so cache-busting is automatic.
const ASSET_CACHE_VERSION = 'dev';

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
  if (url.pathname === '/mint-voucher') return handleMintVoucher(context);

  const contentType = PROXIED[url.pathname];
  if (!contentType) return next(); // static asset

  // Edge-cache the big binaries. Without this every page load re-proxies the
  // full 403 MB pck from GitHub through the Worker (cf-cache-status: DYNAMIC) —
  // slow, and brutal on regions whose CF↔GitHub path is poor. We key the cache
  // on the bare path (origin + pathname, no query/Range) so all visitors at a
  // PoP share one warmed copy. NOTE: /releases/latest/download/ means a NEW
  // release won't auto-invalidate this — purge /index.pck + /index.wasm on the
  // CF edge after each deploy (scripts/deploy.sh does this).
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}?cv=${ASSET_CACHE_VERSION}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const resp = await fetch(`${RELEASE_BASE}${url.pathname}`, { redirect: 'follow' });
  if (!resp.ok || !resp.body) {
    return new Response(`Upstream ${resp.status} for ${url.pathname}`, { status: 502 });
  }
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  // Modest browser TTL, NOT immutable: the URL is fixed but its bytes change
  // per release, so browsers must be able to revalidate (immutable would strand
  // them on an old pck for a day). Edge speed comes from the versioned Cache
  // API above, not from the browser.
  headers.set('Cache-Control', 'public, max-age=600');
  const len = resp.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  const out = new Response(resp.body, { status: 200, headers });
  // Populate the edge cache in the background so this first visitor isn't
  // blocked on the write; subsequent loads at this PoP are served from edge.
  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
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

// --- /mint-voucher : authority-signed voucher (anti-cheat) -----------------
const VOUCHER_TTL_MS = 10 * 60 * 1000;

async function handleMintVoucher(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return jsonOut({ error: 'POST only' }, 405);
  const pkHex = env.AUTHORITY_PRIVKEY_HEX;
  if (!pkHex) return jsonOut({ error: 'authority key not configured' }, 500);

  let b;
  try { b = await request.json(); } catch (_) { return jsonOut({ error: 'bad json' }, 400); }
  const player = String(b.player || '');
  const battle_id = Number(b.battle_id);
  const hero_id = Number(b.hero_id);
  const hp_pct = Number(b.hp_pct);
  if (!/^0x[0-9a-fA-F]{64}$/.test(player)) return jsonOut({ error: 'bad player address' }, 400);
  if (!(battle_id >= 1 && battle_id <= 3)) return jsonOut({ error: 'bad battle_id' }, 400);
  if (!(hero_id >= 1 && hero_id <= 20)) return jsonOut({ error: 'bad hero_id' }, 400);
  if (!Number.isInteger(hp_pct) || hp_pct < 0 || hp_pct > 100) return jsonOut({ error: 'bad hp_pct' }, 400);

  const nonce = new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0, true);
  const expiry_ms = BigInt(Date.now() + VOUCHER_TTL_MS);

  const msg = buildVoucherMessage(player, battle_id, hero_id, hp_pct, nonce, expiry_ms);
  const sig = await ed.signAsync(msg, hexToBytes(pkHex));

  return jsonOut({
    player, battle_id, hero_id, hp_pct,
    nonce: nonce.toString(),
    expiry_ms: expiry_ms.toString(),
    signature: '0x' + toHex(sig),
  });
}

// Canonical voucher message — must byte-match chronicle.move build_voucher_message:
// player:address(32) ++ battle_id:u8 ++ hero_id:u8 ++ hp_pct:u8 ++ nonce:u64(LE) ++ expiry:u64(LE)
function buildVoucherMessage(player, battle_id, hero_id, hp_pct, nonce, expiry_ms) {
  const m = new Uint8Array(32 + 1 + 1 + 1 + 8 + 8);
  m.set(hexToBytes(player.slice(2)), 0);
  m[32] = battle_id; m[33] = hero_id; m[34] = hp_pct;
  const dv = new DataView(m.buffer);
  dv.setBigUint64(35, nonce, true);
  dv.setBigUint64(43, expiry_ms, true);
  return m;
}

function hexToBytes(h) {
  h = h.replace(/^0x/, '');
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}
function toHex(u) { return Array.from(u).map((x) => x.toString(16).padStart(2, '0')).join(''); }
function jsonOut(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
