import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { auth } from "./auth";
import { verdictValidator } from "./schema";

/** Guest fallback device id from headers, for device-scoped quota when not signed in. */
async function getDeviceIdFallback(ctx: any): Promise<string | null> {
  try {
    const header =
      ctx.req.headers.get("x-truthlens-device-id") ?? ctx.req.headers.get("x-device-id");
    if (header) return header;
  } catch {
    /* no req / no headers */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resilient scan profile returned to the client.
//
// Convex query handlers can be async. We await ctx.db.get() here so the
// generated types resolve the doc shape properly. Storage URLs are NOT fetched
// in the query (storage is only available in mutations/actions), so we return
// the stored ids and let the Results page turn them into URLs with a client
// useMemo. This keeps `scans.get` never throwing and centralises storage URL
// derivation where URLs are actually consumed.
// ---------------------------------------------------------------------------

/** id / URL pairs for the derived artifacts the results page renders. */
export interface ArtifactIds {
  previewId: string | null;
  heatmapId: string | null;
  elaId: string | null;
}

/** One stored video frame artifact. */
export interface FrameArtifactRow {
  t: number;
  imageStorageId: string | null;
  heatStorageId: string | null;
}

/** Derived, client-safe view of a scan row. */
export interface ScanProfile {
  id: string;
  type: "image" | "video";
  source: "upload" | "url" | "sample";
  fileName: string;
  status: "pending" | "processing" | "done" | "error";
  verdict: string | null;
  confidence: number | null;
  settings: string | null;
  resultJson: string | null;
  createdAt: number;
  expiresAt: number;
  isPublic: boolean;
  pinned: boolean;
  /** a stable, opaque message for failed / not-yet-done runs */
  note: string | null;
  artifacts: ArtifactIds;
  /** whether the stored media artifacts are past expiry (privacy purge) */
  mediaExpired: boolean;
  /** for video: per-frame artifact rows, when they were stored */
  frameUrls: FrameArtifactRow[];
}

/** Derive whether the media artifacts are past expiry. */
function mediaExpiredAt(expiresAt: number | null | undefined): boolean {
  if (expiresAt == null) return true;
  return Date.now() > expiresAt * 1000;
}

/** Map the raw status string (including legacy/"failed") onto the client enum. */
function normalizeStatus(raw: unknown): ScanProfile["status"] {
  if (raw === "processing") return "processing";
  if (raw === "pending") return "pending";
  if (raw === "done") return "done";
  // legacy rows, failed mutations, or anything else we don't recognise
  // are surfaced as error with a friendly note rather than crashing.
  return "error";
}

/** Friendly note for non-"done" rows. */
function statusNote(
  status: ScanProfile["status"],
  hasResult: boolean,
  hasError: boolean,
): string | null {
  if (status === "done") return null;
  if (status === "error") {
    return hasError ? "Analysis did not complete." : "This result is unavailable.";
  }
  if (status === "processing") return "Analysis is still running.";
  if (status === "pending") return "This scan has not been processed yet.";
  return null;
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/** Fully-shaped, never-throwing query used by the Results page. */
export const get = query({
  args: { id: v.id("scans") },
  handler: async (ctx, args) => {
    try {
      const doc = await ctx.db.get(args.id);
      if (!doc) return null;

      const status = normalizeStatus(doc.status);
      const hasResult = !!doc.resultJson;
      const hasError = !!doc.errorMessage;

      const artifacts: ArtifactIds = {
        previewId: doc.previewId ?? null,
        heatmapId: doc.heatmapId ?? null,
        elaId: doc.elaId ?? null,
      };

      const frameUrls: FrameArtifactRow[] = (doc.frameUrls ?? []).map(
        (f: any) => ({
          t: Number(f?.t ?? 0),
          imageStorageId: f?.imageStorageId ?? null,
          heatStorageId: f?.heatStorageId ?? null,
        }),
      );

      return {
        id: args.id,
        type: doc.type as ScanProfile["type"],
        source: doc.source as ScanProfile["source"],
        fileName: doc.fileName,
        status,
        verdict: doc.verdict ?? null,
        confidence: doc.confidence ?? null,
        settings: doc.settings ?? null,
        resultJson: doc.resultJson ?? null,
        createdAt: Number(doc.createdAt ?? 0),
        expiresAt: Number(doc.expiresAt ?? 0),
        isPublic: Boolean(doc.isPublic),
        pinned: Boolean(doc.pinned),
        note: statusNote(status, hasResult, hasError),
        artifacts,
        mediaExpired: mediaExpiredAt(doc.expiresAt),
        frameUrls,
      } as ScanProfile;
    } catch (err) {
      console.error("[scans.get] failed for", args.id, err);
      return null;
    }
  },
});

/** Legacy passthrough kept for internal callers that want the raw doc. */
export const getById = query({
  args: { id: v.id("scans") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const listByUser = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: (ctx, args) =>
    ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 50),
});

export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const listPublic = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("scans")
      .filter((q) => q.eq(q.field("isPublic"), true))
      .order("desc")
      .take(20),
});

export const quota = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { used: 0, limit: 2, plan: "free" };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const day = today.toISOString().slice(0, 10);
    let existing = await ctx.db
      .query("guestQuota")
      .withIndex("by_device_day", (q) =>
        q.eq("deviceId", args.deviceId).eq("day", day),
      )
      .unique();
    if (!existing) {
      return { used: 0, limit: 25, plan: "free" };
    }
    const used = (existing as any).count ?? 0;
    const user = await ctx.db.get(userId);
    const planLimit =
      user?.plan === "pro" ? 500 : user?.plan === "team" ? 2000 : 25;
    return { used, limit: planLimit, plan: user?.plan ?? "free" };
  },
});

export const getPublicById = query({
  args: { id: v.id("scans") },
  handler: async (ctx, args) => {
    try {
      const doc = await ctx.db.get(args.id);
      if (!doc || doc.isPublic !== true) return null;
      return doc;
    } catch (err) {
      console.error("[scans.getPublicById] failed for", args.id, err);
      return null;
    }
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Return a short-lived upload URL the client can POST a blob to.
 *  The POST response body is `{ storageId: Id<"_storage"> }`.
 *  Client then saves that storage id alongside the scan row. */
export const getUploadUrl = mutation({
  args: { contentType: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    try {
      return { url: await ctx.storage.generateUploadUrl() } as const;
    } catch (err) {
      console.error("[getUploadUrl] failed", err);
      throw new Error("Could not get an upload URL.");
    }
  },
});

/** Partial update for a scan after the analysis completes. */
export const finishScan = mutation({
  args: {
    id: v.id("scans"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("error"),
    ),
    resultJson: v.optional(v.string()),
    verdict: v.optional(verdictValidator),
    confidence: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    previewId: v.optional(v.id("_storage")),
    heatmapId: v.optional(v.id("_storage")),
    elaId: v.optional(v.id("_storage")),
    frameUrls: v.optional(
      v.array(
        v.object({
          t: v.number(),
          imageStorageId: v.optional(v.id("_storage")),
          heatStorageId: v.optional(v.id("_storage")),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    try {
      const scan = await ctx.db.get(args.id);
      if (!scan) throw new Error("Scan not found.");
      const status = args.status ?? scan.status;
      if (status === "done" && !args.resultJson) {
        console.warn(
          "[finishScan] done scan updated without resultJson for",
          args.id,
        );
      }
      if (status === "error" && !args.errorMessage) {
        console.warn(
          "[finishScan] error scan updated without errorMessage for",
          args.id,
        );
      }
      await ctx.db.patch(args.id, {
        status,
        resultJson: args.resultJson,
        verdict: args.verdict,
        confidence: args.confidence,
        errorMessage: args.errorMessage,
        previewId: args.previewId ?? scan.previewId,
        heatmapId: args.heatmapId ?? scan.heatmapId,
        elaId: args.elaId ?? scan.elaId,
        frameUrls: args.frameUrls ?? scan.frameUrls,
      });
      console.info("[finishScan] updated", args.id, "status=" + status);
    } catch (err) {
      console.error("[finishScan] failed", args.id, err);
      throw err;
    }
  },
});

/** ---------------------------------------------------------------------------

/** Create a scan row. Always writes status + createdAt + expiresAt. */
export const add = mutation({
  args: {
    userId: v.optional(v.id("users")),
    deviceId: v.optional(v.string()),
    type: v.union(v.literal("image"), v.literal("video")),
    source: v.union(v.literal("upload"), v.literal("url"), v.literal("sample")),
    fileName: v.string(),
    fileHash: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("done"),
        v.literal("error"),
      ),
    ),
    verdict: v.optional(verdictValidator),
    confidence: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    settings: v.string(),
    resultJson: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    previewId: v.optional(v.id("_storage")),
    heatmapId: v.optional(v.id("_storage")),
    elaId: v.optional(v.id("_storage")),
    frameUrls: v.optional(
      v.array(
        v.object({
          t: v.number(),
          imageStorageId: v.optional(v.id("_storage")),
          heatStorageId: v.optional(v.id("_storage")),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    try {
      const guestDeviceId = args.deviceId ?? (await getDeviceIdFallback(ctx)) as any;
      const userId = (await getAuthUserId(ctx)) as any;
      if (!userId && !guestDeviceId) throw new Error("Sign in first.");
      if (args.userId && userId && args.userId !== userId) throw new Error("Not your scan.");

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 60 * 60 * 24 * 30;

      const status = args.status ?? "pending";
      if (status === "done" && !args.resultJson) {
        console.warn(
          "[scans.add] done scan written without resultJson for",
          args.fileName,
        );
      }
      if (status === "error" && !args.errorMessage) {
        console.warn(
          "[scans.add] error scan written without errorMessage for",
          args.fileName,
        );
      }

      const doc = {
        userId: userId ?? null,
        deviceId: guestDeviceId,
        type: args.type,
        source: args.source,
        fileName: args.fileName,
        fileHash: args.fileHash,
        fileSize: args.fileSize,
        status,
        verdict: args.verdict,
        confidence: args.confidence,
        errorMessage: args.errorMessage,
        settings: args.settings,
        resultJson: args.resultJson,
        isPublic: args.isPublic ?? false,
        previewId: args.previewId,
        heatmapId: args.heatmapId,
        elaId: args.elaId,
        frameUrls: args.frameUrls,
        createdAt: now,
        expiresAt,
      };
      const inserted = await ctx.db.insert("scans", doc as any);
      console.info("[scans.add] created", inserted, "status=" + status);
      return inserted;
    } catch (err) {
      console.error("[scans.add] failed", err);
      throw err;
    }
  },
});

export const setVisibility = mutation({
  args: { id: v.id("scans"), isPublic: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const scan = await ctx.db.get(args.id);
    if (!scan) throw new Error("Scan not found.");
    if (scan.userId !== userId) throw new Error("Not your scan.");
    await ctx.db.patch(args.id, { isPublic: args.isPublic });
  },
});

export const setPinned = mutation({
  args: { id: v.id("scans"), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const scan = await ctx.db.get(args.id);
    if (!scan) throw new Error("Scan not found.");
    if (scan.userId !== userId) throw new Error("Not your scan.");
    await ctx.db.patch(args.id, { pinned: args.pinned });
  },
});

export const remove = mutation({
  args: { id: v.id("scans") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const scan = await ctx.db.get(args.id);
    if (!scan) throw new Error("Scan not found.");
    if (scan.userId !== userId) throw new Error("Not your scan.");
    for (const id of [scan.previewId, scan.heatmapId, scan.elaId]) {
      if (id) await ctx.storage.delete(id);
    }
    await ctx.db.delete(args.id);
  },
});

export const removeMany = mutation({
  args: { ids: v.array(v.id("scans")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    for (const id of args.ids) {
      const scan = await ctx.db.get(id);
      if (scan && scan.userId === userId) {
        for (const sid of [scan.previewId, scan.heatmapId, scan.elaId]) {
          if (sid) await ctx.storage.delete(sid);
        }
        await ctx.db.delete(id);
      }
    }
  },
});

// ---- internal helpers for the read-only REST API (http.ts) ----

/** List every scan this account owns, most recent first. For the public API. */
export const apiListFor = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, args) =>
    ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50),
});

/** Look up a single scan by id and re-check that it belongs to the requester. */
export const apiGetFor = internalQuery({
  args: { userId: v.id("users"), scanId: v.id("scans") },
  handler: async (ctx, args) => {
    try {
      const doc = await ctx.db.get(args.scanId);
      if (!doc) {
        return {
          status: "missing" as const,
          scan: null as any,
          message: "not found",
        };
      }
      if ((doc as any).userId !== args.userId) {
        return {
          status: "forbidden" as const,
          scan: null as any,
          message: "belongs to another account",
        };
      }
      return { status: "ok" as const, scan: doc as any, message: "owned" };
    } catch (err) {
      console.error("[scans.apiGetFor] failed", args, err);
      return {
        status: "error" as const,
        scan: null as any,
        message: "internal error",
      };
    }
  },
});

/** Current-day scan count for the guest quota (device-scoped). */
export const apiQuotaFor = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const userId = args.userId;
    if (!userId) return { used: 0, limit: 0 };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const day = today.toISOString().slice(0, 10);
    let existing = await ctx.db
      .query("guestQuota")
      .withIndex("by_device_day", (q) =>
        q.eq("deviceId", userId).eq("day", day),
      )
      .unique();
    if (!existing) {
      return { used: 0, limit: 2 };
    }
    const used = (existing as any).count ?? 0;
    const limit = 2;
    return { used, limit };
  },
});

export const scans = {
  add,
  getById,
  get,
  listByUser,
  listMine,
  listPublic,
  getPublicById,
  quota,
  setVisibility,
  setPinned,
  remove,
  removeMany,
  apiListFor,
  apiGetFor,
  apiQuotaFor,
};
