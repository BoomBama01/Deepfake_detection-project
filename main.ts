import { Hono } from "hono";
import { serveStatic } from "hono/deno";

const app = new Hono();

// Fingerprinted build output can be cached forever (the hash changes on every
// deploy); the SPA shell must never be cached so a reload always picks up the
// latest chunk manifest.
const SHELL_CACHE = "no-cache, no-store, must-revalidate";
const ASSET_CACHE = "public, max-age=31536000, immutable";

// 1) Fingerprinted chunks under /assets/*: served from dist/, cached forever.
//    NOTE: root must be "./dist" (serveStatic joins root + request path), and a
//    MISS must fall through to the hard 404 below — never to index.html. Serving
//    HTML with status 200 for a missing JS module is what makes browsers report
//    "Failed to fetch dynamically imported module" after a redeploy.
app.use(
  "/assets/*",
  serveStatic({
    root: "./dist",
    onFound: (_path, c) => {
      c.header("Cache-Control", ASSET_CACHE);
    },
  }),
);
// Reached only when the asset above was not found.
app.all("/assets/*", (c) => c.text("Not found", 404));

// 2) Any other real file in dist/ (logo, models, vision wasm, samples…).
//    NOTE: hono's directory fallback makes this serve dist/index.html for GET /,
//    so the shell's no-cache header must be applied here as well.
app.use(
  "*",
  serveStatic({
    root: "./dist",
    onFound: (path, c) => {
      if (path.endsWith("index.html")) {
        c.header("Cache-Control", SHELL_CACHE);
      }
    },
  }),
);

// 3) SPA shell — page routes only. Paths whose last segment contains a dot are
//    file requests that were not found above; they get a 404 so no missing file
//    is ever answered with HTML.
app.get("*", async (c) => {
  const pathname = c.req.path;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) {
    return c.text("Not found", 404);
  }
  c.header("Cache-Control", SHELL_CACHE);
  const shell = await serveStatic({ path: "./dist/index.html" })(c, async () => undefined);
  if (shell) return shell;
  // dist/index.html missing entirely (build not run) — surface it clearly.
  return c.text("Build output missing: run the production build first.", 500);
});

Deno.serve(app.fetch);
