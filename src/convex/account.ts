/**
 * Account — plan selection (test mode, no card charged), profile updates and
 * GDPR-style data export / account deletion.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";

export const profile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      name: user.name ?? "",
      email: user.email ?? "",
      image: user.image ?? "",
      plan: user.plan ?? "free",
      role: user.role ?? "user",
      createdAt: user.createdAt ?? 0,
    };
  },
});

export const updateProfile = mutation({
  args: { name: v.string(), image: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    await ctx.db.patch(userId, {
      name: args.name.trim().slice(0, 80),
      image: args.image?.slice(0, 500),
    });
  },
});

/**
 * Plan selection. Checkout runs in test mode for v1 — no payment is taken;
 * limits update immediately so the plan UI is genuinely functional.
 */
export const setPlan = mutation({
  args: { plan: v.union(v.literal("free"), v.literal("pro"), v.literal("team")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    await ctx.db.patch(userId, { plan: args.plan });
    await ctx.db.insert("auditLogs", {
      userId,
      action: `plan.set:${args.plan}`,
      createdAt: Date.now(),
    });
  },
});

/** First account may claim admin when no admin exists yet (seed path). */
export const claimAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .take(1);
    if (admins.length > 0) throw new Error("An admin already exists.");
    await ctx.db.patch(userId, { role: "admin" });
    await ctx.db.insert("auditLogs", { userId, action: "admin.claim", createdAt: Date.now() });
  },
});

/** Download my data: full scan summaries + feedback as JSON. */
export const exportData = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    const feedback = await ctx.db.query("feedback").take(100);
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    const payload = {
      exportedAt: new Date().toISOString(),
      scans: scans.map((s) => ({
        id: s._id,
        type: s.type,
        fileName: s.fileName,
        verdict: s.verdict,
        confidence: s.confidence,
        settings: s.settings,
        resultJson: s.resultJson,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      feedback: feedback.filter((f) => f.userId === userId),
      apiKeys: keys.map((k) => ({ name: k.name, prefix: k.prefix, createdAt: k.createdAt })),
    };
    await ctx.db.insert("auditLogs", { userId, action: "data.export", createdAt: Date.now() });
    return JSON.stringify(payload, null, 2);
  },
});

/** Delete account: removes all scans (and their media), feedback, keys, user. */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");

    const scans = await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const s of scans) {
      for (const id of [s.previewId, s.heatmapId, s.elaId]) {
        if (id) await ctx.storage.delete(id);
      }
      await ctx.db.delete(s._id);
    }

    const fb = await ctx.db.query("feedback").take(500);
    for (const f of fb.filter((x) => x.userId === userId)) await ctx.db.delete(f._id);

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const k of keys) await ctx.db.delete(k._id);

    await ctx.db.delete(userId);
  },
});
