/**
 * Scans — persistence, quota, sharing and 24-hour media purge.
 *
 * Privacy model: the original file never reaches the server. Only a
 * downscaled preview and derived forensic artifacts (heatmap/ELA) are stored,
 * and they are deleted automatically after `expiresAt` (24 h) unless the owner
 * pins them. The result summary itself is kept until the owner deletes it.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type AnyCtx = QueryCtx;

export const GUEST_DAILY_LIMIT = 3;
export const PLAN_DAILY_LIMITS: Record<string, number> = {
  free: 25,
  pro: 500,
  team: 2000,
};
const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULT_BYTES = 900_000;

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

async function resolveOwnership(
  ctx: AnyCtx,
  deviceId?: string,
): Promise<{ userId: Id<"users"> | null; device: string | null }> {
  const userId = await getAuthUserId(ctx);
  if (userId) {
    const user = await ctx.db.get(userId);
    if (user?.banned) throw new Error("This account has been suspended.");
    return { userId, device: null };
  }
  if (deviceId && deviceId.length >= 8 && deviceId.length <= 64) {
    return { userId: null, device: deviceId };
  }
  return { userId: null, device: null };
}

async function usedToday(
  ctx: AnyCtx,
  userId: Id<"users"> | null,
  device: string | null,
): Promise<number> {
  const start = Date.parse(`${dayKey(Date.now())}T00:00:00.000Z`);
  if (userId) {
    const rows = await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId).gte("createdAt", start))
      .collect();
    return rows.length;
  }
  if (device) {
    const row = await ctx.db
      .query("guestQuota")
      .withIndex("by_device_day", (q) =>
        q.eq("deviceId", device).eq("day", dayKey(Date.now())),
      )
      .unique();
    return row?.count ?? 0;
  }
  return 0;
}

async function limitFor(
  ctx: AnyCtx,
  userId: Id<"users"> | null,
): Promise<{ limit: number; plan: string }> {
  if (!userId) return { limit: GUEST_DAILY_LIMIT, plan: "guest" };
  const user = await ctx.db.get(userId);
  const plan = user?.plan ?? "free";
  return { limit: PLAN_DAILY_LIMITS[plan] ?? PLAN_DAILY_LIMITS.free, plan };
}

export const quota = query({
  args: { deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId, device } = await resolveOwnership(ctx, args.deviceId);
    const { limit, plan } = await limitFor(ctx, userId);
    const used = await usedToday(ctx, userId, device);
    return { used, limit, plan };
  },
});

export const save = mutation({
  args: {
    type: v.union(v.literal("image"), v.literal("video")),
    source: v.union(v.literal("upload"), v.literal("url"), v.literal("sample")),
    fileName: v.string(),
    fileHash: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    verdict: v.optional(
      v.union(
        v.literal("real"),
        v.literal("inconclusive"),
        v.literal("likely_ai"),
        v.literal("likely_deepfake"),
        v.literal("error"),
      ),
    ),
    confidence: v.optional(v.number()),
    settings: v.string(),
    resultJson: v.string(),
    previewId: v.optional(v.id("_storage")),
    heatmapId: v.optional(v.id("_storage")),
    elaId: v.optional(v.id("_storage")),
    isPublic: v.optional(v.boolean()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.resultJson.length > MAX_RESULT_BYTES) {
      throw new Error("Result payload too large to store.");
    }
    const { userId, device } = await resolveOwnership(ctx, args.deviceId);
    const { limit } = await limitFor(ctx, userId);
    const used = await usedToday(ctx, userId, device);
    if (used >= limit) {
      throw new Error(
        `Daily scan limit reached (${limit}/${limit}). ${
          userId ? "Upgrade your plan or" : "Sign in to get"
        } more scans tomorrow.`,
      );
    }

    const now = Date.now();
    const scanId = await ctx.db.insert("scans", {
      userId: userId ?? undefined,
      deviceId: device ?? undefined,
      type: args.type,
      status: "done",
      source: args.source,
      fileName: args.fileName,
      fileHash: args.fileHash,
      fileSize: args.fileSize,
      previewId: args.previewId,
      heatmapId: args.heatmapId,
      elaId: args.elaId,
      verdict: args.verdict,
      confidence: args.confidence,
      settings: args.settings,
      resultJson: args.resultJson,
      isPublic: args.isPublic ?? false,
      createdAt: now,
      expiresAt: now + MEDIA_TTL_MS,
    });

    if (device) {
      const day = dayKey(now);
      const row = await ctx.db
        .query("guestQuota")
        .withIndex("by_device_day", (q) => q.eq("deviceId", device).eq("day", day))
        .unique();
      if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
      else await ctx.db.insert("guestQuota", { deviceId: device, day, count: 1 });
    }

    await ctx.db.insert("auditLogs", {
      userId: userId ?? undefined,
      action: `scan.save:${args.verdict ?? "unknown"}`,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      MEDIA_TTL_MS + 30_000,
      internal.scans.purgeArtifacts,
      { scanId },
    );
    return scanId;
  },
});

/** Delete stored media for one scan after its 24 h TTL (keeps the summary). */
export const purgeArtifacts = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan || scan.pinned) return;
    for (const id of [scan.previewId, scan.heatmapId, scan.elaId]) {
      if (id) await ctx.storage.delete(id);
    }
    let resultJson = scan.resultJson;
    if (resultJson) {
      try {
        const parsed = JSON.parse(resultJson) as {
          suspiciousFrames?: Array<{ imageId?: string; heatId?: string }>;
        };
        for (const f of parsed.suspiciousFrames ?? []) {
          if (f.imageId) await ctx.storage.delete(f.imageId as Id<"_storage">);
          if (f.heatId) await ctx.storage.delete(f.heatId as Id<"_storage">);
          delete f.imageId;
          delete f.heatId;
        }
        resultJson = JSON.stringify(parsed);
      } catch {
        /* keep original summary even if it fails to parse */
      }
    }
    await ctx.db.patch(args.scanId, {
      previewId: undefined,
      heatmapId: undefined,
      elaId: undefined,
      resultJson,
    });
  },
});

async function loadScanFor(
  ctx: AnyCtx,
  scanId: Id<"scans">,
  deviceId?: string,
) {
  const scan = await ctx.db.get(scanId);
  if (!scan) return null;
  const userId = await getAuthUserId(ctx);
  const isOwner =
    (userId && scan.userId === userId) ||
    (!userId && deviceId && scan.deviceId === deviceId && deviceId.length >= 8);
  if (!scan.isPublic && !isOwner) return null;
  return { scan, isOwner: Boolean(isOwner) };
}

export const get = query({
  args: { id: v.id("scans"), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const loaded = await loadScanFor(ctx, args.id, args.deviceId);
    if (!loaded) return null;
    const { scan } = loaded;
    const [previewUrl, heatmapUrl, elaUrl] = await Promise.all([
      scan.previewId ? ctx.storage.getUrl(scan.previewId) : null,
      scan.heatmapId ? ctx.storage.getUrl(scan.heatmapId) : null,
      scan.elaId ? ctx.storage.getUrl(scan.elaId) : null,
    ]);
    let frameUrls: Array<{ t: number; score: number; imageUrl: string | null; heatUrl: string | null }> = [];
    if (scan.resultJson) {
      try {
        const parsed = JSON.parse(scan.resultJson) as {
          suspiciousFrames?: Array<{
            t: number;
            score: number;
            imageId?: string;
            heatId?: string;
          }>;
        };
        frameUrls = await Promise.all(
          (parsed.suspiciousFrames ?? []).map(async (f) => ({
            t: f.t,
            score: f.score,
            imageUrl: f.imageId
              ? await ctx.storage.getUrl(f.imageId as Id<"_storage">)
              : null,
            heatUrl: f.heatId ? await ctx.storage.getUrl(f.heatId as Id<"_storage">) : null,
          })),
        );
      } catch {
        /* malformed legacy summary — expose no media */
      }
    }
    return {
      _id: scan._id,
      type: scan.type,
      status: scan.status,
      source: scan.source,
      fileName: scan.fileName,
      fileSize: scan.fileSize,
      verdict: scan.verdict,
      confidence: scan.confidence,
      settings: scan.settings,
      resultJson: scan.resultJson,
      isPublic: scan.isPublic ?? false,
      pinned: scan.pinned ?? false,
      createdAt: scan.createdAt,
      expiresAt: scan.expiresAt,
      isOwner: loaded.isOwner,
      previewUrl,
      heatmapUrl,
      elaUrl,
      frameUrls,
      mediaExpired: Date.now() > scan.expiresAt,
    };
  },
});

export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(args.limit ?? 200, 500));
    return rows.map((s) => ({
      _id: s._id,
      type: s.type,
      source: s.source,
      fileName: s.fileName,
      verdict: s.verdict,
      confidence: s.confidence,
      isPublic: s.isPublic ?? false,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      fileSize: s.fileSize,
    }));
  },
});

export const byHash = query({
  args: { fileHash: v.string(), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId, device } = await resolveOwnership(ctx, args.deviceId);
    const rows = await ctx.db
      .query("scans")
      .withIndex("by_hash", (q) => q.eq("fileHash", args.fileHash))
      .order("desc")
      .take(20);
    const match = rows.find(
      (s) =>
        (userId && s.userId === userId) || (device && s.deviceId === device),
    );
    if (!match) return null;
    return { id: match._id, verdict: match.verdict, createdAt: match.createdAt };
  },
});

async function removeScan(
  ctx: MutationCtx,
  scanId: Id<"scans">,
  deviceId?: string,
) {
  const loaded = await loadScanFor(ctx, scanId, deviceId);
  if (!loaded || !loaded.isOwner) throw new Error("Not allowed to modify this result.");
  const { scan } = loaded;
  for (const id of [scan.previewId, scan.heatmapId, scan.elaId]) {
    if (id) await ctx.storage.delete(id);
  }
  if (scan.resultJson) {
    try {
      const parsed = JSON.parse(scan.resultJson) as {
        suspiciousFrames?: Array<{ imageId?: string; heatId?: string }>;
      };
      for (const f of parsed.suspiciousFrames ?? []) {
        if (f.imageId) await ctx.storage.delete(f.imageId as Id<"_storage">);
        if (f.heatId) await ctx.storage.delete(f.heatId as Id<"_storage">);
      }
    } catch {
      /* ignore */
    }
  }
  await ctx.db.delete(scanId);
}

export const remove = mutation({
  args: { id: v.id("scans"), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await removeScan(ctx, args.id, args.deviceId);
  },
});

export const removeMany = mutation({
  args: { ids: v.array(v.id("scans")), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    for (const id of args.ids) await removeScan(ctx, id, args.deviceId);
  },
});

export const setVisibility = mutation({
  args: { id: v.id("scans"), isPublic: v.boolean(), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const loaded = await loadScanFor(ctx, args.id, args.deviceId);
    if (!loaded || !loaded.isOwner) throw new Error("Not allowed to modify this result.");
    await ctx.db.patch(args.id, { isPublic: args.isPublic });
  },
});

export const setPinned = mutation({
  args: { id: v.id("scans"), pinned: v.boolean(), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const loaded = await loadScanFor(ctx, args.id, args.deviceId);
    if (!loaded || !loaded.isOwner) throw new Error("Not allowed to modify this result.");
    await ctx.db.patch(args.id, { pinned: args.pinned });
  },
});
