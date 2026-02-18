# Macro Tracker PWA

Privacy-first calorie and macro tracker built as a static Web App / PWA for iPhone Safari install.

## Status
This repository currently contains **Commit 8** scope:
- Persons CRUD with cascade deletes
- Daily dashboard totals
- Manual add with favorites/recent
- Export / Import / Delete-all tools
- PWA manifest + service worker offline shell
- Barcode scanning + Open Food Facts integration with local cache
- Photo workflow (manual via ChatGPT prompt copy)

## Architecture overview (Commit 8)
- **Frontend**: vanilla JavaScript (ES modules), no framework.
- **Storage**: IndexedDB (`src/storage.js`) for persons, entries, products cache, favorites, recents, and meta.
- **Barcode stack**:
  - `src/scanner.js` for camera scanning via ZXing-js.
  - `src/offClient.js` for Open Food Facts product lookup and nutrition normalization.
- **Photo workflow**:
  - local image capture/select for preview only.
  - user-driven ChatGPT app workflow via copied prompt (no automated AI recognition).
- **PWA layer**:
  - `manifest.json` for install metadata.
  - `service-worker.js` for offline shell caching and runtime strategies.

## Photo workflow (Commit 8)
Photo tab includes:
- take/select photo from camera or gallery
- local preview in app
- **Copy ChatGPT Prompt** button with exact prompt text
- instructions:
  1. Open ChatGPT app
  2. Upload photo
  3. Paste prompt
  4. Return and log manually

Manual logging supports source label:
- `Photo (manual via ChatGPT)`

## Barcode flow (Commit 7)
1. Open **Scan** tab and start camera scanning.
2. On EAN/UPC detection, app checks local `productsCache`.
3. If online, app fetches OFF product data:
   - `product_name`, `brands`, `image_front_small_url`
   - per-100g kcal (or converted from kJ), protein, carbs, fat
4. Normalized per-100g nutrition is cached locally.
5. User can log product via portion picker with source label:
   - `Barcode (Open Food Facts)`

Offline behavior:
- Cached barcode works offline.
- If barcode not cached and offline, app shows:
  - `Needs internet for first lookup.`

## Local run
Because this is an ES module app, run from a static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Basic tests
Run helper unit tests:

```bash
node --test math.test.js
```

## Playwright smoke checks

For Linux/CI runners:

```bash
npx playwright install --with-deps
```

Run offline smoke validation (WebKit authoritative + Chromium best-effort fallback):

```bash
node playwright/smoke-offline.mjs
```


## Local smoke validation

```bash
npm install
npx playwright install
npm run smoke:offline
```

Linux CI/container runners can use:

```bash
npm run playwright:install:deps
```

Notes:
- WebKit is authoritative for iPhone/Safari behavior.
- Chromium smoke uses hardened launch flags for container stability.


## Restricted environments (CDN 403)

In some locked-down CI/container environments, Playwright browser downloads can be blocked (for example `403 Domain forbidden`).

In that case:
- `npm run playwright:install` prints guidance and soft-fails for recognized blocked-download errors.
- `npm run smoke:offline` auto-skips only when browser binaries are missing.
- Other app checks/tests continue to run normally.

To run smoke tests on a local machine with download access:

```bash
npm install
npx playwright install
npm run smoke:offline
```

WebKit remains the primary/authoritative target for iPhone Safari behavior.


## Running UI Smoke Tests in Constrained Environments

Use the deterministic smoke runner:

```bash
npm run ui:smoke
```

What it does:
- starts a deterministic local server (`python3 -m http.server 4173`) via `child_process.spawn`
- performs health checks against both `http://127.0.0.1:4173` and `http://localhost:4173`
- runs a **browser sanity test** (`about:blank` + static HTML screenshot) before app navigation
- uses navigation strategy fallback in order: HTTP (opt-in), FILE (`file://`), INLINE (`setContent`) to survive remote-browser namespace issues
- records selected strategy and fallback reason in diagnostics

Artifacts are written to `artifacts/ui-smoke/`:
- `screenshot.png` (app UI), `sanity.png` (browser sanity)
- `trace.zip`
- `diagnostics.json` (console/pageerror/requestfailed + classification)
- `server.log`

Failure classification emitted by runner:
- `application-failure` (page JS errors/console runtime errors)
- `browser-runtime-failure` (browser process crashes / closed unexpectedly)
- `connectivity-failure` (server not reachable / navigation connectivity)
- `binary-installation-failure` (Playwright missing or browser binaries unavailable)

Behavior by environment:
- Local dev (normal): smoke runs fully and fails only for real app/connectivity errors.
- Constrained CI/sandbox (e.g. CDN 403 for browser downloads): runner reports binary/install issue and skips as best-effort (non-blocking), while unit/static checks continue.

Troubleshooting:

```bash
npm install
npx playwright install
npm run ui:smoke
```

If installs are blocked in your environment, run smoke locally on a machine with browser download access.
WebKit remains authoritative for iPhone Safari behavior.


Expected screenshot path: `artifacts/ui-smoke/screenshot.png`.

By default HTTP navigation is disabled for robustness in remote-browser sandboxes. Set `UI_SMOKE_ALLOW_HTTP=1` to try HTTP first.

If browser installation fails with blocked network/CDN policy, the runner reports:

`Browser binary download blocked by environment (CDN restriction).`


Strict mode (always fail when browser binaries are missing):

```bash
npm run ui:smoke:strict
```
