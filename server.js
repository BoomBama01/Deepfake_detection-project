#!/usr/bin/env node
/**
 * Minimal static SPA server for the TruthLens frontend.
 *
 * This mirrors the production routing and caching rules we want every host to
 * implement, so the "Failed to fetch dynamically imported module" redeploy bug
 * cannot recur from host misconfiguration:
 *
 *  - /assets/* are served with immutable long-term cache headers and 404 on miss.
 *  - /index.html (and /) are served with no-cache headers so the browser always
 *    fetches the latest chunk manifest.
 *  - All other paths fall back to index.html for client-side routing.
 *  - Missing assets do NOT fall back to index.html.
 *
 * Run:  node server.js
 * Then visit http://localhost:3000 and repeat the upload -> scan -> Results flow.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "dist");
const INDEX = path.join(ROOT, "index.html");
const ASSETS_RE = /^\/assets\//;

const MIME = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".html": "text/html",
};

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  let filePath = path.resolve(ROOT, url === "/" ? "index.html" : url);

  // Security: keep requests inside the dist directory.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  // Only the shell page and the root are cache-inert.
  const isIndexPage = filePath === INDEX || url === "/";
  const assetHeaders = isIndexPage
    ? { "Cache-Control": "no-cache, no-store, must-revalidate" }
    : ASSETS_RE.test(url)
      ? { "Cache-Control": "public, max-age=31536000, immutable" }
      : {};

  // Asset requests must 404, not fall back to index.html.
  if (ASSETS_RE.test(url)) {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: only for non-asset routes.
      if (!ASSETS_RE.test(url)) {
        serveFile(INDEX, { "Cache-Control": "no-cache, no-store, must-revalidate" }, res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      ...assetHeaders,
    };
    serveFile(filePath, headers, res);
  });
});

function serveFile(filePath, headers, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
server.listen(PORT, () => {
  console.log(`TruthLens preview server: http://localhost:${PORT}`);
  console.log("  /assets/* -> immutable cache, 404 on miss");
  console.log("  /index.html and / -> no-cache");
  console.log("  other routes -> fallback to /index.html");
});
