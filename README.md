<h1 align="center">ConSSS Wars: Echoes of Chainoa</h1>
<h3 align="center">鏈州英雄傳：鏈之迴響</h3>

<p align="center">
  A hand‑drawn, turn‑based tactics RPG set on the chain‑continent of <b>Chainoa</b> —
  where the battles you win become on‑chain <b>Chronicles</b> and the sagas you write are
  preserved forever on <b>Walrus</b>.
</p>

<p align="center">
  <a href="https://play.conssswars.com"><b>▶ Play now</b></a> ·
  <a href="https://conssswars.com">Website</a> ·
  <a href="https://consss.wal.app">Limited event</a>
</p>

<p align="center">
  <img alt="engine" src="https://img.shields.io/badge/engine-Godot%204.6-478cbf">
  <img alt="chain" src="https://img.shields.io/badge/chain-Sui%20(testnet)-6fbcf0">
  <img alt="storage" src="https://img.shields.io/badge/storage-Walrus-1f6feb">
  <img alt="host" src="https://img.shields.io/badge/host-Cloudflare%20Pages-f38020">
</p>

> Built for the **Tatum × Build on Sui with Walrus** hackathon.
> This repository hosts the **playable web build**; the game source lives in
> [`ConsssLab/app`](https://github.com/ConsssLab/app) (`godot/`).

---

## ✦ About

Lead a band of heroes through the battles of Chainoa in painterly, hand‑drawn
fights. **ConSSS Wars** is a browser game first and a web3 game second: you can
play the whole thing with no wallet — but connect one and your results stop
being throwaway. Clear a battle and you can mint a **Chronicle**: a Sui NFT that
records *which* battle, *how well* you fought, and a personal long‑form saga you
author, stored on Walrus.

## ⚔ Features

**Gameplay**
- Turn‑based tactical combat with multi‑phase boss battles and mid‑fight events.
- Hand‑drawn, painterly art direction (Sands‑of‑Salzaar inspired) and an original score.
- Fully playable in the browser — no install, no wallet required.

**On‑chain (optional, opt‑in)**
- **Connect any Sui wallet** (Slush and other Wallet‑Standard wallets) — first‑party page, no popup blocking.
- **Chronicle NFTs with tiers** — clearing a battle mints a Chronicle whose
  rank (Normal / Bronze / Silver / Gold) is computed **on‑chain** from a
  per‑battle clear‑rank counter and your remaining HP.
- **Mint integrity by design** — mints are gated by an authority‑signed ed25519
  voucher, so a Chronicle can't be granted by hand‑crafting a transaction.
- **Walrus sagas** — your written chronicle (battle log + long‑form text) is
  uploaded to Walrus and pinned to the NFT via its blob id.

## 🧱 Tech stack

| Layer | Tech |
|-------|------|
| Game engine | **Godot 4.6** → HTML5 (single‑threaded WebGL2) |
| Smart contracts | **Sui Move** (testnet) — Chronicle NFT + tiers + mint voucher |
| Decentralized storage | **Walrus** — chronicle saga blobs |
| Wallet | `@mysten/wallet-standard` (vanilla, no React) |
| Hosting | **Cloudflare Pages** + Pages Functions (edge) + **GitHub Releases** (engine binaries) |
| RPC | **Tatum** Sui gateway (server‑side key), public fullnode fallback |

## 🏗 Architecture

A Godot 4 HTML5 export produces two binaries that exceed normal hosting limits,
so the build is split across three free tiers and stitched back together at the
Cloudflare edge:

```
                       play.conssswars.com  (Cloudflare Pages)
  browser ───────────────────────┬──────────────────────────────
                                  │
  public/ (static shell, <1 MB)   │  functions/[[path]].js  (edge worker)
  • index.html  • loader/worklets  │  • /index.pck  ┐ proxied + edge‑cached from
  • dist/ wallet bridge bundle     │  • /index.wasm ┘ GitHub Releases (same‑origin)
                                  │  • /rpc          → Tatum (server key) → public RPC fallback
                                  │  • /mint-voucher → ed25519 mint voucher (server key)
                                  │
                   GitHub Releases: index.pck (~128 MB) + index.wasm (~38 MB)
```

Why each piece:

- **Static shell on Pages** — the HTML/loader/worklets/icon and the built wallet bridge.
- **Engine binaries on GitHub Releases** — `index.pck` (~128 MB, lossy‑WebP
  optimized) and `index.wasm` (~38 MB) are too big for Pages' 25 MiB/file limit.
- **Edge Function does the stitching** — a plain redirect to GitHub fails CORS
  (release assets send no `Access-Control-Allow-Origin`), so the Function fetches
  them server‑side and streams them back **same‑origin** with the correct
  `Content-Type` (so WASM streaming compilation works). It **edge‑caches** the
  binaries under a version‑stamped key (bumped per deploy) for fast repeat loads.
- **Single‑threaded export** — cross‑origin isolation is disabled
  (`ensureCrossOriginIsolationHeaders:false`), so no SharedArrayBuffer / COOP / COEP
  setup is required. *Keep the export single‑threaded or this model breaks.*

## 🔐 Security model

- **No secrets in the browser.** The Tatum API key and the mint‑voucher authority
  key are **Cloudflare Pages runtime secrets** (`TATUM_API_KEY`,
  `AUTHORITY_PRIVKEY_HEX`) read only inside the edge Function — never bundled.
  `config.public.js` holds public IDs/URLs only.
- **RPC proxy.** The browser's `SuiClient` POSTs to same‑origin `/rpc`; the
  Function attaches the Tatum key server‑side and forwards, falling back to the
  public Sui fullnode. Rotating the key is a dashboard change — no rebuild.
- **Mint voucher.** `/mint-voucher` signs an ed25519 voucher (player, battle, HP,
  nonce, expiry); the contract verifies the signature, sender, nonce
  (anti‑replay) and expiry, and computes the tier on‑chain. Players sign the mint
  with **their own** wallet — the server never holds player funds.

> Honest scope: this is a fully client‑side game with no authoritative server
> simulation, so the voucher proves *who* is minting, not that the reported HP/battle
> were truly earned. It blocks signature forgery, replay, and hand‑built‑PTB mints;
> server‑side rate‑limiting / progression checks are the next hardening step.

## 🚀 Build & deploy

Deploys are **manual by design** (your gate against shipping a bad build) and the
Cloudflare token never lives in GitHub.

```bash
# 1. In Godot (app/godot): export the "Web" preset → app/exports/web/
#    (keep thread_support = false)

# 2. One command does the rest:
cd play && scripts/deploy.sh
#    refresh shell → build bridge (no secrets) → upload binaries to a GitHub
#    Release → version‑stamp the edge cache → wrangler pages deploy → verify
```

**Prerequisites** (all local, none in GitHub):
- `~/.cf_token` — a Cloudflare API token with *Pages → Edit* (delete + revoke after use).
- `CLOUDFLARE_ACCOUNT_ID` env var, or `~/.cf_account`.
- `gh` authenticated (for the Release upload).

**One‑time Cloudflare setup:** create a Pages project `consss-play`, add the
`TATUM_API_KEY` and `AUTHORITY_PRIVKEY_HEX` secrets (dashboard or
`wrangler pages secret put …`), and point the custom domain
`play.conssswars.com` at it.

## 🗂 Repository layout

```
public/                      Cloudflare Pages output (static shell)
├── index.html               game shell (COI off, loads bridge + engine)
├── index.js                 Godot loader + audio worklets + icon
├── dist/                    built wallet bridge bundle (gitignored)
├── _headers · _redirects    edge cache / routing policy
functions/
└── [[path]].js              edge worker: binary proxy + /rpc + /mint-voucher
bridge/                      Sui + Walrus wallet bridge (esbuild → public/dist)
├── config.public.js         public ids/urls only — no secrets
└── src/                     wallet · sui-client · walrus · mint · chronicles · bridge
scripts/
└── deploy.sh                one‑command manual deploy
```

The built bridge (`public/dist/`) and the engine binaries are gitignored — the
bridge is built at deploy time, the binaries live in Releases.

## 📦 On‑chain deployments (Sui testnet)

| Object | ID |
|--------|----|
| Chronicle package | `0x5efb10426a8929e88510dbc80711e2bf371aca08b179167b3037e20d097f6980` |
| Chronicle registry (shared) | `0x19b9f0fe18ea27a56f75b6d6302e00e80a9bf1656c81f87eecbb82a4bc3109ee` |
| Witness registry (shared) | `0x7359529def5f8a225e6e7c460ff44ee4f276bdd5ce50c0c7b1e10faaa3e831d0` |
| Walrus (testnet) | publisher / aggregator `walrus-testnet.walrus.space` · 5 epochs |

Contract source: [`ConsssLab/contracts`](https://github.com/ConsssLab/contracts).

## 🌐 Sibling sites

| Site | Repo | Host |
|------|------|------|
| `conssswars.com` — official site | [`official-website`](https://github.com/ConsssLab/official-website) | Cloudflare Pages |
| `consss.wal.app` — limited event | [`official-limit-time-event`](https://github.com/ConsssLab/official-limit-time-event) | Walrus Sites |

## 👥 Credits

Made by the **ConsssLab** team for the Tatum × Build on Sui with Walrus
hackathon — engineering, narrative & contracts, and art & music.

## License

© ConsssLab. All rights reserved. Game art, music, and story are proprietary;
see the source repositories for any code‑specific licensing.
