import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { auth } from "./auth";

export const scans = {
  add: mutation({
    args: {
      userId: v.optional(v.id("users")),
      deviceId: v.optional(v.string()),
      type: v.union(v.literal("image"), v.literal("video")),
      source: v.union(v.literal("upload"), v.literal("url"), v.literal("sample")),
      fileName: v.string(),
      fileHash: v.optional(v.string()),
      fileSize: v.optional(v.number()),
      verdict: v.optional(v.string()),
      confidence: v.optional(v.number()),
      settings: v.string(),
      resultJson: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
      const userId = await auth.verifyClientId(ctx, args.userId);
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
  }),
  getById: query({
    args: { id: v.id("scans") },
    handler: (ctx, args) => ctx.db.get(args.id),
  }),
  listByUser: query({
    args: { userId: v.id("users") },
    handler: (ctx, args) =>
      ctx.db
        .query("scans")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(50),
  }),
  listPublic: query({
    args: {},
    handler: (ctx) =>
      ctx.db
        .query("scans")
        .withIndex("by_created", (q) => q.eq("isPublic", true))
        .order("desc")
        .take(20),
  }),
  getPublicById: query({
    args: { id: v.id("scans") },
    handler: async (ctx, args) => {
      const doc = await ctx.db.get(args.id);
      if (!doc || doc.isPublic !== true) return null;
      return doc;
    },
  }),
};
