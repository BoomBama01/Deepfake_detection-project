import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";

/** "Report incorrect result" feedback — saved for model review. */
export const submit = mutation({
  args: {
    scanId: v.id("scans"),
    isCorrect: v.boolean(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) throw new Error("Result not found.");
    const comment = args.comment?.slice(0, 1000);
    const userId = await getAuthUserId(ctx);
    await ctx.db.insert("feedback", {
      scanId: args.scanId,
      userId: userId ?? undefined,
      isCorrect: args.isCorrect,
      comment,
      status: "new",
      createdAt: Date.now(),
    });
  },
});

/** Feedback already given to a scan by the current signed-in user. */
export const forScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .take(20);
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return rows
      .filter((r) => r.userId === userId)
      .map((r) => ({ isCorrect: r.isCorrect, comment: r.comment, createdAt: r.createdAt }));
  },
});
