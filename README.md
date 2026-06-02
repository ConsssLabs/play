# play — ConSSS Wars: Echoes of Chainoa 鏈州英雄傳：鏈之迴響

Hosting repo for the **playable web build** at **https://play.conssswars.com**.

This repo serves a *small* static shell from **Cloudflare Pages** and pulls the
*large* Godot engine binaries from **GitHub Releases**. The game source lives in
[`ConsssLabs/app`](https://github.com/ConsssLabs/app) (`godot/`); this repo only
hosts the exported build.

## Why this split exists

A Godot 4 HTML5 export produces two files that are too big for normal hosting:

| File | Size | GitHub (100 MB/file) | CF Pages (25 MiB/file) |
|------|------|----------------------|------------------------|
| `index.pck` | ~316 MB | ❌ rejected | ❌ rejected |
| `index.wasm` | ~38 MB | ✅ | ❌ rejected |
| everything else (html/js/worklets/icon) | < 1 MB | ✅ | ✅ |

So: the shell goes on **CF Pages** (free), the two big files become **GitHub
Release assets** (free, 2 GB/file limit), and a **Cloudflare Pages Function**
(`functions/[[path]].js`) serves them **same-origin** by proxying
`releases/latest/download/` at the edge.

> A plain redirect to GitHub does **not** work: GitHub's release-asset host
> sends no `Access-Control-Allow-Origin`, so the browser blocks the
> cross-origin fetch (verified 2026-06-02). The edge Function sidesteps this —
> it fetches server-side (no browser CORS) and returns the bytes from
> `play.conssswars.com` itself. It also sets `Content-Type: application/wasm`
> so streaming compilation works.

The build is **single-threaded**, so we disable cross-origin isolation
(`ensureCrossOriginIsolationHeaders:false` in `public/index.html`) — no
SharedArrayBuffer is needed.

## Layout

```
public/                         ← Cloudflare Pages output directory
├── index.html                  ← shell (COI off, loads bridge + engine)
├── index.js                    ← Godot loader
├── index.audio*.worklet.js     ← audio worklets (must stay same-origin)
├── index.icon.png              ← favicon
├── _redirects                  ← (no rules; binaries handled by the Function)
└── _headers                    ← cache policy (no COOP/COEP)
functions/                      ← Cloudflare Pages Functions (repo root, not public/)
└── [[path]].js                 ← same-origin proxy for /index.wasm + /index.pck
bridge/                         ← Sui + Walrus wallet bridge (built into public/dist)
├── config.public.js            ← PUBLIC ids/urls; Tatum key injected from env
├── package.json
├── scripts/build.mjs           ← esbuild; reads TATUM_API_KEY env var
└── src/                        ← bridge source (mirrors app/godot/web/src)
scripts/upload-release.sh       ← uploads index.wasm + index.pck to a Release
```

`public/dist/` (the built bridge) and the engine binaries are **gitignored** —
the bridge is built by CF Pages at deploy time; the binaries live in Releases.

## Deploy

### 1. Export the game (in the app repo)
In Godot, export the **Web** preset from `app/godot` → `app/exports/web/`
(`index.html`, `index.js`, `index.wasm`, `index.pck`, worklets, icon).
Keep `variant/thread_support=false` so the single-threaded / no-COI model holds.

### 2. Upload the big binaries to a GitHub Release
```bash
cd play
scripts/upload-release.sh            # defaults to ../app/exports/web
```
This creates a new release; `releases/latest/download/` (used by `_redirects`)
auto-points at it, so no further edits are needed for new builds.

### 3. Refresh the small shell files (only if the export's loader changed)
```bash
cp ../app/exports/web/index.js                        public/
cp ../app/exports/web/index.audio.worklet.js          public/
cp ../app/exports/web/index.audio.position.worklet.js public/
cp ../app/exports/web/index.icon.png                  public/
git add public && git commit -m "chore: refresh web shell" && git push
```
(The custom `public/index.html` is maintained here, not overwritten by export.)

### 4. Cloudflare Pages (one-time)
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** →
   pick `ConsssLabs/play`.
2. Build settings:
   - **Build command:** `cd bridge && npm install && npm run build`
   - **Build output directory:** `public`
   - (No framework preset.)
3. **Environment variables → add** `TATUM_API_KEY` = your Tatum key (optional —
   without it the game falls back to the public Sui RPC, so it still runs).
4. Deploy. You'll get a `*.pages.dev` URL — open it and confirm the game loads.
5. **Custom domains → Set up a custom domain → `play.conssswars.com`** (Cloudflare
   adds the CNAME automatically if `conssswars.com` is on this account).

> Want to validate the risky part first? You can deploy with **no build command**
> (just output `public`) to test pure game loading; the wallet bridge 404s
> harmlessly and the game still runs. Add the build command afterwards.

### 5. Test in a browser
- Game canvas loads past the "Loading…" screen (proves wasm + pck fetched).
- Open DevTools → Network: `index.wasm` and `index.pck` should be `200`
  (after the 302 to GitHub). DevTools → Console: no CORS errors.
- Wallet connect / X / Discord buttons respond (top-level page → no iframe
  popup blocking).

## How the binaries are served (and the CORS gotcha)

`functions/[[path]].js` is the mechanism — it is **required**, not a fallback.
GitHub release assets do not send CORS headers, so the browser cannot fetch
them cross-origin; the edge Function proxies them same-origin instead. It runs
on the CF Pages Functions free tier (shares the Workers 100k req/day allowance;
streaming the body uses negligible CPU, and `Cache-Control` lets the edge/browser
cache repeat loads).

If a future build re-enables `thread_support`, this whole model breaks (threads
need cross-origin isolation, which then blocks even the same-origin proxy unless
every response carries the right COOP/COEP/CORP headers). Keep the export
single-threaded.

## Sibling sites (not this repo)

- `conssswars.com` → [`official-website`](https://github.com/ConsssLabs/official-website) (CF Pages)
- `consss.wal.app` → [`official-limit-time-event`](https://github.com/ConsssLabs/official-limit-time-event) (Walrus Sites)
