/**
 * Reference static SPA server for the TruthLens frontend.
 *
 * It implements the exact routing and caching rules every host must apply so the
 * "Failed to fetch dynamically imported module" redeploy bug cannot recur:
 *
 *  - /index.html and / (and any page route that falls back to the shell) are sent
 *    with `Cache-Control: no-cache, no-store, must-revalidate`.
 *  - /assets/* are sent with `Cache-Control: public, max-age=31536000, immutable`
 *    and return 404 when the file does not exist — they never fall back to
 *    index.html (a 200 HTML response for a JS chunk request is the root cause of
 *    the browser's "Failed to fetch dynamically imported module" error).
 *  - All other paths fall back to index.html for client-side routing.
 *
 * Run against a build:   node server.js
 * Programmatic use (tests): import { createStaticHandler } from "./server.js"
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");

const MIME = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SHELL_CACHE = "no-cache, no-store, must-revalidate";
const ASSET_CACHE = "public, max-age=31536000, immutable";

/** True when the request path targets the fingerprinted build output. */
function isAssetPath(pathname) {
  return pathname === "/assets" || pathname.startsWith("/assets/");
}

/**
 * Resolve a request path to a file inside dist, or null when it escapes the root.
 * NOTE: path.resolve(ROOT, pathname) would be wrong for pathname starting with "/"
 * (absolute segments replace the base) — always strip the leading slash first.
 */
function resolveInRoot(pathname) {
  const rel = pathname.replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

/**
 * Create a request handler implementing the SPA routing + caching rules.
 * Exported so tests can exercise it without binding a long-lived server.
 */
export function createStaticHandler() {
  return function handler(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad request");
      return;
    }

    const filePath = resolveInRoot(pathname);
    if (!filePath) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    const serveShell = () => {
      fs.readFile(path.join(ROOT, "index.html"), (err, data) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal server error");
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME[".html"],
          "Cache-Control": SHELL_CACHE,
        });
        res.end(data);
      });
    };

    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const headers = { "Content-Type": MIME[ext] ?? "application/octet-stream" };
        if (isAssetPath(pathname)) headers["Cache-Control"] = ASSET_CACHE;
        else if (pathname === "/" || pathname === "/index.html") headers["Cache-Control"] = SHELL_CACHE;
        fs.readFile(filePath, (readErr, data) => {
          if (readErr) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal server error");
            return;
          }
          res.writeHead(200, headers);
          res.end(data);
        });
        return;
      }

      // Missing asset under /assets/ → hard 404, never the shell page.
      if (isAssetPath(pathname)) {
        res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": ASSET_CACHE });
        res.end("Not found");
        return;
      }

      // Page routes (and any other non-asset path) get the SPA shell, uncached.
      serveShell();
    });
  };
}

// Only bind when executed directly (not when imported by a test).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
  http.createServer(createStaticHandler()).listen(PORT, () => {
    console.log(`TruthLens static server: http://localhost:${PORT}`);
    console.log(`  root: ${ROOT}`);
    console.log("  / and page routes -> index.html, Cache-Control: no-cache, no-store, must-revalidate");
    console.log("  /assets/*         -> immutable cache, 404 when missing (no shell fallback)");
  });
}
