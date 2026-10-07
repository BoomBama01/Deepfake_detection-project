/**
 * HTTP routes: Convex auth + the TruthLens REST API (v1).
 *
 * The API is read-only by design — detection runs in the visitor's browser,
 * so the server only *serves* results the key's account already produced.
 * Every endpoint except /health authenticates with `Authorization: Bearer tl_...`
 * and shares the 30 req/min per-key fixed-window rate limit.
 *
 * HTTP actions have no direct database access, so all reads go through the
 * internal queries in `scans.ts` (apiQuotaFor / apiListFor / apiGetFor),
 * which re-check ownership before returning anything.
 */
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

auth.addHttpRoutes(http);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "X-RateLimit-Remaining",
};

const DISCLAIMER =
  "Results are probabilistic and may be wrong. Do not use as sole evidence. No detector is 100% accurate — always corroborate with human judgement and other sources.";

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

type KeyOwner = { userId: Id<"users">; remaining: number };

/** Validate the bearer API key; returns either an error Response or the owner. */
async function requireKey(
  ctx: ActionCtx,
  req: Request,
): Promise<{ error: Response } | KeyOwner> {
  const header = req.headers.get("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!bearer) {
    return {
      error: json(
        { error: "Missing bearer token. Use: Authorization: Bearer tl_..." },
        401,
      ),
    };
  }
  const result = await ctx.runMutation(internal.apiKeys.authenticate, {
    bearer,
  });
  if (!result.ok) {
    const status = result.reason.startsWith("Rate limit") ? 429 : 401;
    return { error: json({ error: result.reason }, status) };
  }
  return { userId: result.userId, remaining: result.remaining };
}

/* ------------------------------------------------------------------ */
/* CORS preflight for the whole API surface                            */
/* ------------------------------------------------------------------ */
http.route({
  pathPrefix: "/api/v1/",
  method: "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});

/* ------------------------------------------------------------------ */
/* GET /api/v1/health — public liveness                                */
/* ------------------------------------------------------------------ */
http.route({
  path: "/api/v1/health",
  method: "GET",
  handler: httpAction(async () =>
    json({ ok: true, service: "truthlens", time: Date.now() }),
  ),
});

/* ------------------------------------------------------------------ */
/* GET /api/v1/quota — today's allowance for the key's account         */
/* ------------------------------------------------------------------ */
http.route({
  path: "/api/v1/quota",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const authResult = await requireKey(ctx, req);
    if ("error" in authResult) {
      return authResult.error;
    }

    const quota = await ctx.runQuery(internal.scans.apiListFor, {
      userId: authResult.userId,
    });
    const used = Array.isArray(quota) ? quota.length : 0;
    const limit = 2;
    return json(
      { used, limit },
      200,
      { "X-RateLimit-Remaining": String(authResult.remaining) },
    );
  }),
});

/* ------------------------------------------------------------------ */
/* GET /api/v1/scans       — list the key owner's scans (max 50)       */
/* GET /api/v1/scans/:id   — one scan with its full check breakdown     */
/* ------------------------------------------------------------------ */
const SCANS_PATH = "/api/v1/scans";

http.route({
  path: SCANS_PATH,
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const authResult = await requireKey(ctx, req);
    if ("error" in authResult) {
      return authResult.error;
    }

    const scans = await ctx.runQuery(internal.scans.apiListFor, {
      userId: authResult.userId,
    });
    return json({ scans }, 200, {
      "X-RateLimit-Remaining": String(authResult.remaining),
    });
  }),
});

http.route({
  pathPrefix: `${SCANS_PATH}/`,
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const authResult = await requireKey(ctx, req);
    if ("error" in authResult) {
      return authResult.error;
    }
    const rateHeaders = {
      "X-RateLimit-Remaining": String(authResult.remaining),
    };

    const url = new URL(req.url);
    const scanId = url.pathname.slice(SCANS_PATH.length + 1);
    const detail = await ctx.runQuery(internal.scans.apiGetFor, {
      userId: authResult.userId,
      scanId: scanId as any,
    });
    if (detail.status === "missing") {
      return json({ error: "Scan not found." }, 404, rateHeaders);
    }
    if (detail.status === "forbidden") {
      return json(
        { error: "This scan belongs to another account." },
        403,
        rateHeaders,
      );
    }

    let result: unknown = null;
    if (detail.scan.resultJson) {
      try {
        result = JSON.parse(detail.scan.resultJson);
      } catch {
        result = null;
      }
    }
    // resultJson is parsed above and returned as `result`, so strip the raw copy
    const { resultJson, ...scan } = detail.scan;
    void resultJson;
    return json(
      { ...scan, disclaimer: DISCLAIMER, result },
      200,
      rateHeaders,
    );
  }),
});

export default http;
