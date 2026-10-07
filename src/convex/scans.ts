import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { auth } from "./auth";
import { verdictValidator } from "./schema";

export const add = mutation({
  args: {
    userId: v.optional(v.id("users")),
    deviceId: v.optional(v.string()),
    type: v.union(v.literal("image"), v.literal("video")),
    source: v.union(v.literal("upload"), v.literal("url"), v.literal("sample")),
    fileName: v.string(),
    fileHash: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    verdict: v.optional(verdictValidator),
    confidence: v.optional(v.number()),
    settings: v.string(),
    resultJson: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = (await getAuthUserId(ctx)) as any;
    if (!userId) throw new Error("Sign in first.");
    if (args.userId && args.userId !== userId) throw new Error("Not your scan.");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 60 * 60 * 24 * 30;
    const doc = {
      userId,
      deviceId: args.deviceId,
      type: args.type,
      source: args.source,
      fileName: args.fileName,
      fileHash: args.fileHash,
      fileSize: args.fileSize,
      status: "done" as const,
      verdict: args.verdict,
      confidence: args.confidence,
      settings: args.settings,
      resultJson: args.resultJson,
      isPublic: args.isPublic ?? false,
      createdAt: now,
      expiresAt,
    };
    return ctx.db.insert("scans", doc as any);
  },
});

export const getById = query({
  args: { id: v.id("scans") },
  handler: (ctx, args) => ctx.db.get(args.id),
});

export const get = query({
  args: { id: v.id("scans") },
  handler: (ctx, args) => ctx.db.get(args.id),
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
      .withIndex("by_device_day", (q) => q.eq("deviceId", args.deviceId).eq("day", day))
      .unique();
    if (!existing) {
      return { used: 0, limit: 25, plan: "free" };
    }
    const used = (existing as any).count ?? 0;
    const user = await ctx.db.get(userId);
    const planLimit = user?.plan === "pro" ? 500 : user?.plan === "team" ? 2000 : 25;
    return { used, limit: planLimit, plan: user?.plan ?? "free" };
  },
});

export const getPublicById = query({
  args: { id: v.id("scans") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.isPublic !== true) return null;
    return doc;
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
    const doc = await ctx.db.get(args.scanId);
    if (!doc) return { status: "missing" as const, scan: null as any, message: "not found" };
    if ((doc as any).userId !== args.userId) {
      return { status: "forbidden" as const, scan: null as any, message: "belongs to another account" };
    }
    return { status: "ok" as const, scan: doc as any, message: "owned" };
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
      .withIndex("by_device_day", (q) => q.eq("deviceId", userId).eq("day", day))
      .unique();
    if (!existing) {
      // read-only path: caller should have seeded this via mutation before reading
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
