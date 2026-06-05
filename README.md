<h1 align="center">ConSSS Wars: Echoes of Chainoa</h1>
<h3 align="center">鏈州英雄傳：鏈之迴響</h3>

<p align="center">
  A hand-drawn, turn-based tactics RPG set on the chain-continent of <b>Chainoa</b> —
  where the battles you win become on-chain <b>Chronicles</b> and the sagas you write are
  preserved on <b>Walrus</b>.
</p>

<p align="center">
  <a href="https://play.conssswars.com"><b>▶ Play now</b></a> ·
  <a href="https://conssswars.com">Website</a> ·
  <a href="https://consss.wal.app">Limited event</a>
</p>

<p align="center">
  <img alt="engine" src="https://img.shields.io/badge/engine-Godot%204.6-478cbf">
  <img alt="chain" src="https://img.shields.io/badge/chain-Sui%20mainnet-6fbcf0">
  <img alt="storage" src="https://img.shields.io/badge/storage-Walrus-1f6feb">
  <img alt="host" src="https://img.shields.io/badge/host-Cloudflare%20Pages-f38020">
</p>

> This repository is the **deployment repo** for the playable web build at
> [play.conssswars.com](https://play.conssswars.com). The game source (Godot
> project, Move contracts) lives in sibling repos — see [Related repositories](#related-repositories).

---

## Overview

**ConSSS Wars** is a browser-first, web3-second tactics RPG. The full game plays
in any modern browser with no install and **no wallet required**. Connect a Sui
wallet and your results stop being throwaway: clear a battle and you can mint a
**Chronicle** — a Sui NFT that records *which* battle you cleared, *how well* you
fought (an on-chain tier), and a personal long-form saga you author, with the
saga text stored on **Walrus**.

This repo packages a [Godot 4.6](https://godotengine.org) HTML5 export together
with a vanilla-JS Sui + Walrus dApp bridge, and serves both from **Cloudflare
Pages** with a Pages Function handling the heavy lifting (binary streaming, an
RPC proxy, and an anti-cheat mint voucher).

## Features

**Gameplay**
- Turn-based tactical combat with multi-phase boss fights and mid-battle events.
- Painterly, hand-drawn art direction and an original score.
- Fully playable in the browser — no install, no wallet required.

**On-chain (optional, opt-in)**
- **Connect any Sui wallet** — Slush, Sui Wallet, Suiet and other
  [Wallet Standard](https://github.com/wallet-standard/wallet-standard) wallets.
  First-party page, no popup blocking.
- **Tiered Chronicle NFTs** — clearing a battle mints a Chronicle whose rank is
  computed **on-chain** from a per-battle clear counter and your remaining HP.
- **Mint integrity** — every mint is gated by an authority-signed ed25519
  voucher, so a Chronicle cannot be granted by hand-crafting a transaction.
- **Walrus sagas** — the chronicle JSON (battle log + long-form text) is uploaded
  to Walrus; only its blob id is pinned on-chain.

## Architecture

A Godot 4 HTML5 export produces two binaries far larger than Cloudflare Pages'
per-file limit, so the build is split across hosts and stitched back together at
the edge. The browser only ever talks to `play.conssswars.com`.

```
                         play.conssswars.com  (Cloudflare Pages)
   browser ──────────────────────────┬─────────────────────────────────
                                      │
   public/  (static shell, < 2 MB)    │  functions/[[path]].js  (Pages Function)
   • index.html                       │  • /index.wasm ┐ proxied + edge-cached
   • index.js loader + audio worklets │  • /index.pck  ┘ from GitHub Releases
   • dist/ wallet bridge bundle       │      (same-origin; fixes CORS + Content-Type)
   • _headers · _redirects            │  • /rpc          → Tatum (server key) → public RPC
                                      │  • /mint-voucher → ed25519 voucher (anti-cheat)
                                      │
            GitHub Releases (ConsssLab/play, releases/latest/download):
                       index.pck (~385 MB) + index.wasm (~36 MB)
```

What each piece does:

- **Static shell on Pages** — `index.html`, the Godot loader (`index.js`), the
  two audio worklets, the icon, and the built wallet bridge bundle.
- **Engine binaries on GitHub Releases** — `index.pck` (~385 MB) and
  `index.wasm` (~36 MB) exceed both Cloudflare Pages' 25 MiB/file limit and
  GitHub's 100 MB git limit, so each deploy uploads them as Release assets.
- **The Pages Function stitches it together** (`functions/[[path]].js`):
  - **Binary proxy** — a plain redirect to GitHub fails CORS (release assets send
    no `Access-Control-Allow-Origin`), so the Function fetches `index.wasm` /
    `index.pck` from `releases/latest/download/` server-side and streams them back
    **same-origin** with the correct `Content-Type` (so WASM streaming
    compilation works). It **edge-caches** them under a version-stamped key that
    the deploy script bumps per release, so repeat loads are fast and a new
    release retires the old cached bytes automatically.
  - **`/rpc`** — a Sui JSON-RPC proxy. The browser's `SuiClient` POSTs here; the
    Function injects the **Tatum** API key (`x-api-key`) server-side and forwards,
    falling back to the public Sui fullnode on any failure.
  - **`/mint-voucher`** — signs an authority ed25519 voucher binding the mint to
    `(player, battle, hero, hp_pct, nonce, expiry)` and this deployment's
    registry. See [Security model](#security-model).
- **Single-threaded export** — cross-origin isolation is intentionally disabled
  (`ensureCrossOriginIsolationHeaders: false`, no COOP/COEP), so no
  SharedArrayBuffer setup is needed and the cross-origin engine load is not
  blocked. *Keep the Godot export single-threaded or this hosting model breaks.*

### dApp bridge

`bridge/` builds a vanilla-JS (no React, no dapp-kit) bundle that exposes
`window.consss = { connect, mint, uploadToWalrus, readFromWalrus,
getOwnedChronicles }` so the Godot HTML5 shell can drive Sui + Walrus via
`JavaScriptBridge`. The mint flow is:

1. Upload the chronicle JSON to Walrus (publisher HTTP API) → get a blob id.
2. `POST /mint-voucher` with the clear report → get an authority-signed voucher.
3. Build and sign `chronicle::chronicle::mint_chronicle` with the player's own
   wallet; the tier is computed on-chain. The server never holds player funds.

`bridge/config.public.js` contains **only public on-chain data** (network,
package/registry IDs, Walrus endpoints) — no secrets — and is safe to commit and
ship in the browser bundle.

## Configuration

### Public config (committed)

`bridge/config.public.js` — network, RPC proxy path, on-chain IDs, and Walrus
endpoints. Public data only; bundled into the browser. See
[On-chain deployments](#on-chain-deployments).

### Server-side secrets (Cloudflare only)

Secrets live **only** as Cloudflare Pages environment variables / bindings on the
`consss-play` project and are read solely inside the Pages Function. They are
never bundled, never committed, never shipped to the browser.

| Variable | Required | Purpose |
|----------|----------|---------|
| `TATUM_API_KEY` | yes | Tatum Sui gateway key injected into `/rpc` (falls back to public RPC if unset/failing). |
| `AUTHORITY_PRIVKEY_HEX` | yes | ed25519 private key that signs `/mint-voucher` vouchers. |
| `CHRONICLE_REGISTRY_ID` | yes | Registry id the voucher is bound to (anti cross-deployment replay). |
| `CHRONICLE_TYPE` | optional | Chronicle struct type (`0x<pkg>::chronicle::Chronicle`) — enables the progression gate. |
| `MINT_KV` | optional | KV binding for the per-`(wallet, battle)` mint rate limit. |
| `TATUM_RPC_URL` / `PUBLIC_RPC_URL` | optional | Override the default mainnet Tatum / public fullnode endpoints. |

> Deploying also requires a Cloudflare API token at `~/.cf_token` (Pages → Edit)
> and the account id via `CLOUDFLARE_ACCOUNT_ID` or `~/.cf_account`. These are
> local-only and never enter git. The token should be deleted/revoked after use.

## Security model

- **No secrets in the browser.** The Tatum key and the voucher authority key are
  Cloudflare runtime secrets read only inside the Pages Function.
  `config.public.js` holds public IDs/URLs only.
- **RPC proxy.** The browser POSTs to same-origin `/rpc`; the Function attaches
  the Tatum key server-side and forwards, falling back to the public fullnode.
  Rotating the key is a dashboard change — no rebuild.
- **Mint voucher.** `/mint-voucher` signs an ed25519 voucher over `(registry,
  player, battle, hero, hp_pct, nonce, expiry)`. The on-chain contract verifies
  the signature, sender, nonce (anti-replay) and expiry, and computes the tier
  itself. Players sign the mint with their own wallet.
- **Layer-1 guards** on `/mint-voucher`: an origin check, a KV-backed per-`(wallet,
  battle)` rate limit, and a progression gate (battle *N* requires owning a
  battle *N-1* Chronicle). The rate limit and progression gate are graceful — they
  skip cleanly if `MINT_KV` / `CHRONICLE_TYPE` are unset.

> Honest scope: this is a fully client-side game with no authoritative server
> simulation, so the voucher proves *who* is minting and blocks signature forgery,
> replay, and hand-built-PTB mints — but it trusts the client-reported
> `hp_pct`/`battle_id`. Server-authoritative replay is the next hardening step.

## Local development

Prerequisites: Node 18+ and (for serving Functions locally) `wrangler`.

```bash
# Build the wallet bridge bundle into public/dist/
cd bridge
npm install
npm run build          # or: npm run build:watch

# Serve the static shell + Pages Function locally
cd ..
npx wrangler pages dev public
```

Notes:
- The engine binaries (`index.wasm`, `index.pck`) are **not** in this repo; they
  are served from GitHub Releases in production. To run the full game locally,
  drop a fresh Godot Web export's `index.wasm` / `index.pck` into `public/`.
- For the wallet/mint/RPC paths to work locally, provide the server env vars
  above to `wrangler pages dev` (e.g. via `--binding` / a `.dev.vars` file).

## Deployment

Deploys are **manual by design** — a human gate against shipping a bad build, and
the Cloudflare token never lives in GitHub. One command runs the whole pipeline:

```bash
# 1. In Godot: export the "Web" preset (keep thread support OFF) to
#    ../app/exports/web/  (override the path as an arg if different)

# 2. From this repo root:
scripts/deploy.sh [EXPORT_DIR]   # default EXPORT_DIR = ../app/exports/web
```

`scripts/deploy.sh` will:
1. Copy the fresh export's loader + audio worklets into `public/` (the committed
   `index.icon.png` is intentionally kept).
2. Build the wallet bridge (no secrets baked in).
3. Upload `index.wasm` + `index.pck` to a timestamped GitHub Release.
4. Stamp the Function's edge-cache version with the release tag (automatic
   cache-bust), then restore the working tree afterward.
5. `wrangler pages deploy public` → the `consss-play` project.
6. Verify `/`, `/index.wasm`, `/index.pck` over HTTPS.

**One-time setup:** create the `consss-play` Pages project, set the server env
vars from [Configuration](#configuration), and point the custom domain
`play.conssswars.com` at the project. Remember to `rm -f ~/.cf_token` and revoke
the token when finished.

## Repository layout

```
public/                      Cloudflare Pages output (static shell)
├── index.html               game shell (cross-origin isolation off; loads bridge + engine)
├── index.js                 Godot Web loader
├── index.audio*.worklet.js  audio worklets
├── index.icon.png           committed favicon
├── dist/                    built wallet bridge bundle (gitignored)
├── _headers · _redirects    edge caching / routing policy
functions/
└── [[path]].js              Pages Function: binary proxy + /rpc + /mint-voucher
bridge/                      Sui + Walrus wallet bridge (esbuild → public/dist)
├── config.public.js         public IDs / URLs only — no secrets
├── scripts/build.mjs        esbuild driver
└── src/                     index · bridge · wallet · sui-client · walrus · mint · chronicles
scripts/
└── deploy.sh                one-command manual deploy
```

The built bridge (`public/dist/`) and the engine binaries (`*.wasm`, `*.pck`)
are gitignored: the bridge is built at deploy time, the binaries live in Releases.

## On-chain deployments

**Network: Sui mainnet.** IDs below are public on-chain data (mirrored in
`bridge/config.public.js`).

| Object | ID |
|--------|----|
| Chronicle package | `0x5760b2685d41bd45e2991dedc242e866b1aca9ff3c3a5e193445751c2b8dfe4b` |
| Chronicle registry (shared) | `0x9ff1d9e50e8feca77ccddf5901bd774d3baa4732dac37ae261ca36b2352ced8b` |
| Finale registry (shared) | `0x2c752d82144701e2b476cd35fd8c5482c9f3aabfe27e155729b657b369493d19` |
| Walrus (mainnet) | publisher `walrus-publisher.rubynodes.io` · aggregator `aggregator.walrus-mainnet.walrus.space` · 5 epochs |

## Tech stack

| Layer | Tech |
|-------|------|
| Game engine | Godot 4.6 → HTML5 (single-threaded, WebGL2) |
| Smart contracts | Sui Move (mainnet) — Chronicle NFT, tiers, mint voucher |
| Decentralized storage | Walrus — chronicle saga blobs (HTTP publisher/aggregator) |
| Wallet | `@mysten/wallet-standard` (vanilla JS, no React) |
| Sui SDK | `@mysten/sui` · `@mysten/walrus` |
| Hosting | Cloudflare Pages + Pages Functions + GitHub Releases (engine binaries) |
| RPC | Tatum Sui gateway (server-side key) with public fullnode fallback |
| Bundler | esbuild |

## Related repositories

| Site / repo | URL | Host |
|-------------|-----|------|
| Game source (Godot + Move) | [`ConsssLab/app`](https://github.com/ConsssLab/app), [`ConsssLab/contracts`](https://github.com/ConsssLab/contracts) | — |
| `conssswars.com` — official site | [`official-website`](https://github.com/ConsssLab/official-website) | Cloudflare Pages |
| `consss.wal.app` — limited event | [`official-limit-time-event`](https://github.com/ConsssLab/official-limit-time-event) | Walrus Sites |

## License

© ConsssLab. All rights reserved. Game art, music, and story are proprietary;
see the individual source repositories for any code-specific licensing.
