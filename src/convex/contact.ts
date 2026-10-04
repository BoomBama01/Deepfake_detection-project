import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const submit = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim().slice(0, 80);
    const email = args.email.trim().toLowerCase().slice(0, 200);
    const message = args.message.trim().slice(0, 4000);
    if (!name || !EMAIL_RE.test(email) || message.length < 10) {
      throw new Error("Please provide your name, a valid email, and a message of at least 10 characters.");
    }
    // simple per-IP-less rate limit: max 5 messages from one address per day
    const dayStart = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const recent = await ctx.db
      .query("contactMessages")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .order("desc")
      .take(50);
    const mine = recent.filter((m) => m.email === email && m.createdAt >= dayStart);
    if (mine.length >= 5) {
      throw new Error("You have reached today's message limit. Please try again tomorrow.");
    }

    const id = await ctx.db.insert("contactMessages", {
      name,
      email,
      message,
      createdAt: Date.now(),
      status: "new",
    });
    await ctx.scheduler.runAfter(0, internal.notify.emailAdmin, {
      name,
      email,
      message,
    });
    return id;
  },
});
