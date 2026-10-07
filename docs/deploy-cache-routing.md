# SPA caching and routing for TruthLens

This document explains the configuration choices for serving the built frontend so
that chunk-load failures after redeploy do not recur.

## The problem

The app ships hashed chunks under `/assets/*` (for example
`/assets/Results-d2f1-VCm.js`). After a deploy the hash changes, but visitors who
still have the old page in cache can request the old chunk path. If the host falls
back to `index.html` for unknown paths (as single-page applications often do), the
browser receives a `200` page response for what it expects to be a JS module. Vite
then throws:

> Failed to fetch dynamically imported module: /assets/Results-XXXX.js

## What we configured

### 1. The shell page is not cached

`index.html` (and `/` served as `index.html`) must be cache-inert so the browser
always fetches the latest manifest of hashed chunk URLs:

- `Cache-Control: no-cache, no-store, must-revalidate`

We apply this to the following host-specific rules:

- Vercel: `vercel.json` rewrites only non-`/assets` paths to `/index.html` (a
  negative lookahead), so a missing chunk returns Vercel's 404 instead of a 200
  HTML page, and declares explicit `headers` with no-cache on page routes and
  immutable caching on `/assets/*`.
- Netlify: `netlify.toml` puts a `/assets/*` → 404 rule *before* the SPA catch-all
  (Netlify evaluates rules top to bottom), and sets the same no-cache header on
  `/index.html` and `"/"`.
- nginx: `nginx.conf` has an explicit `location ~* ^/assets/` block with
  `try_files $uri =404` that runs before the SPA fallback, `location = /index.html`
  and `location = /` blocks set no-cache, while the catch-all SPA route also uses
  `try_files /index.html =404`.
- Caddy: `caddyfile` uses `handle /assets/*` (NOT `handle_path`, which would strip
  the prefix) with `try_files {path} =404`, and a `handle` block serves the
  no-cache shell for everything else.

### 2. Assets are cached forever

Hashed assets under `/assets/*` are safe to cache indefinitely because the filename
changes on every deploy:

- `Cache-Control: public, max-age=31536000, immutable`

This applies to JS, CSS, images, the web manifest, and WASM files in every
host config above. A 404 on an unknown asset is correct: the browser should retry
the new deploy rather than receive a cached shell page.

Every config in this repo implements this. `server.js` is a dependency-free
reference implementation of the same rules (run `node server.js` after a build);
its handler is exported so it can be exercised in a test without binding a
long-lived port.

### 3. Missing assets must not fall back to index.html

The host must return `404` for unknown `/assets/*` paths, never `index.html`. Each
host config above sets `try_files $uri =404` (nginx/Caddy) or equivalent routing
rules that only rewrite real application routes, not unknown asset requests, to the
shell page.

### 4. The app defends itself at runtime

Even with correct host headers, some visitors may have stale intermediate caches or
be behind a proxy that serves the old shell page anyway. The frontend adds two layers
of defense in `src/main.tsx`:

- A global `window.addEventListener("vite:preloadError", …)` listener that reloads the
  page once a Vite preload error is detected.
- Every `React.lazy` route is wrapped in a retry helper that tries the dynamic import
  twice, then reloads the page once, using a `sessionStorage` flag so a reload loop
  cannot repeat.

## Choosing which config file to use

Drop only the file that matches your host into the repository root before deployment.
They are not cumulative — pick one.

- **Vercel**: keep `vercel.json` and remove the others.
- **Netlify**: keep `netlify.toml` and remove the others.
- **nginx**: keep `nginx.conf` and remove the others.
- **Caddy**: keep `caddyfile` and remove the others.

If you deploy to a host not covered here, mirror the same two rules: no-cache on the
shell page and immutable long-term caching on fingerprinted assets, with a 404 (not a
shell-page fallback) for unknown asset paths.

## Testing

1. Run `bun run build` and confirm the output includes files under `dist/assets/`.
2. Serve the `dist/` directory from one of the configured hosts (or locally with the
   matching server config).
3. Open the app, navigate to `/results/<id>`, and confirm the Results chunk loads.
4. Simulate a stale deployment by requesting an old asset path directly and confirm
   the server returns a 404, not `index.html`.
5. Put a long cache lifetime on an old `index.html` in a proxy, reload, and confirm
   the `vite:preloadError` listener plus the lazy retry reload bring the page back.

## Note on other hosts

Some platforms (for example Cloudflare Pages, GitHub Pages) already serve SPAs with
a cached shell page problem. If you use one of those, add the equivalent
no-cache header on the shell page and immutable caching on hashed assets through the
platform's header configuration, and keep the in-app runtime guards in `src/main.tsx`.

