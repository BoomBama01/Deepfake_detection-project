import { v } from "convex/values";
import { query, mutation, type ActionCtx } from "./_generated/server";
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
      status: "done",
      verdict: args.verdict,
      confidence: args.confidence,
      settings: args.settings,
      resultJson: args.resultJson,
      isPublic: args.isPublic ?? false,
      createdAt: now,
      expiresAt,
    };
    return ctx.db.insert("scans", doc);
  },
});

export const getById = query({
  args: { id: v.id("scans") },
  handler: (ctx, args) => ctx.db.get(args.id),
});

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: (ctx, args) =>
    ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50),
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

export const getPublicById = query({
  args: { id: v.id("scans") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.isPublic !== true) return null;
    return doc;
  },
});
