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
// LAYER 1 anti-abuse (raises the bar against "skip the game, just POST here";
// the real "no-play-no-mint" guarantee is server-authoritative replay — Layer 2):
//   a) origin guard      — only the game page may request (lazy filter)
//   b) rate limit (KV)   — per (wallet, battle) cooldown; needs MINT_KV binding
//   c) progression gate  — battle N requires an owned battle N-1 Chronicle;
//                          needs CHRONICLE_TYPE env (= "0x<pkg>::chronicle::Chronicle")
// (b)/(c) are graceful: if MINT_KV / CHRONICLE_TYPE are unset they're skipped.
const VOUCHER_TTL_MS = 10 * 60 * 1000;
const VOUCHER_COOLDOWN_SEC = 60;            // per (wallet, battle) min gap
const ALLOWED_ORIGIN = 'https://play.conssswars.com';

async function handleMintVoucher(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return jsonOut({ error: 'POST only' }, 405);

  // (a) origin guard — browsers send Origin; a no-Origin curl or a foreign site
  // is rejected. Spoofable, but filters casual scripting cheaply.
  const origin = request.headers.get('Origin') || '';
  if (origin !== ALLOWED_ORIGIN) return jsonOut({ error: 'forbidden origin' }, 403);

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

  // (b) per-(wallet, battle) rate limit.
  const rlKey = `rl:${player}:${battle_id}`;
  if (env.MINT_KV && (await env.MINT_KV.get(rlKey))) {
    return jsonOut({ error: 'rate limited — try again shortly' }, 429);
  }

  // (c) progression gate — must already own the previous battle's Chronicle.
  if (battle_id >= 2 && env.CHRONICLE_TYPE) {
    const ok = await ownsChronicleForBattle(env, player, battle_id - 1);
    if (!ok) return jsonOut({ error: `must clear battle ${battle_id - 1} first` }, 403);
  }

  const nonce = new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0, true);
  const expiry_ms = BigInt(Date.now() + VOUCHER_TTL_MS);

  const msg = buildVoucherMessage(player, battle_id, hero_id, hp_pct, nonce, expiry_ms);
  const sig = await ed.signAsync(msg, hexToBytes(pkHex));

  if (env.MINT_KV) {
    context.waitUntil(env.MINT_KV.put(rlKey, '1', { expirationTtl: VOUCHER_COOLDOWN_SEC }));
  }

  return jsonOut({
    player, battle_id, hero_id, hp_pct,
    nonce: nonce.toString(),
    expiry_ms: expiry_ms.toString(),
    signature: '0x' + toHex(sig),
  });
}

// Does `player` own a Chronicle for `battle`? Queries the public Sui RPC by the
// Chronicle struct type (so only Chronicles come back). Fails OPEN on RPC error
// so an infra hiccup never blocks a legit player.
async function ownsChronicleForBattle(env, player, battle) {
  const rpc = env.PUBLIC_RPC_URL || DEFAULT_PUBLIC_RPC;
  try {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'suix_getOwnedObjects',
        params: [player, { filter: { StructType: env.CHRONICLE_TYPE }, options: { showContent: true } }, null, 50],
      }),
    });
    const j = await r.json();
    const items = (j && j.result && j.result.data) || [];
    for (const it of items) {
      const f = it && it.data && it.data.content && it.data.content.fields;
      if (f && Number(f.battle_id) === battle) return true;
    }
    return false;
  } catch (_) {
    return true; // fail-open
  }
}

// Domain prefix — MUST byte-match chronicle.move VOUCHER_DOMAIN.
const VOUCHER_DOMAIN = new TextEncoder().encode('ConSSSWars/chronicle-voucher/v1');

// Canonical voucher message — must byte-match chronicle.move build_voucher_message:
// VOUCHER_DOMAIN ++ player:address(32) ++ battle_id:u8 ++ hero_id:u8 ++ hp_pct:u8
//   ++ nonce:u64(LE) ++ expiry:u64(LE)
function buildVoucherMessage(player, battle_id, hero_id, hp_pct, nonce, expiry_ms) {
  const d = VOUCHER_DOMAIN.length;
  const m = new Uint8Array(d + 32 + 1 + 1 + 1 + 8 + 8);
  m.set(VOUCHER_DOMAIN, 0);
  m.set(hexToBytes(player.slice(2)), d);
  m[d + 32] = battle_id; m[d + 33] = hero_id; m[d + 34] = hp_pct;
  const dv = new DataView(m.buffer);
  dv.setBigUint64(d + 35, nonce, true);
  dv.setBigUint64(d + 43, expiry_ms, true);
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
