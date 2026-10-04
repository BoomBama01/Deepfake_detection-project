import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, internalMutation } from "./_generated/server";
import { sha256Hex } from "../lib/sha256";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // requests per key per minute

function newSecret(): string {
  // 256 bits from WebCrypto (available in the Convex runtime), no fallback
  // randomness for secrets.
  const id = () => crypto.randomUUID().replace(/-/g, "");
  return `tl_${id()}${id()}`;
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to create API keys.");
    const name = args.name.trim().slice(0, 60) || "Untitled key";
    const secret = newSecret();
    const id = await ctx.db.insert("apiKeys", {
      userId,
      name,
      keyHash: sha256Hex(new TextEncoder().encode(secret)),
      prefix: `${secret.slice(0, 11)}…`,
      createdAt: Date.now(),
      requestCount: 0,
      windowStart: Date.now(),
    });
    return { id, secret }; // the secret is returned exactly once
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return rows.map((k) => ({
      _id: k._id,
      name: k.name,
      prefix: k.prefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      requestCount: k.requestCount,
    }));
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const key = await ctx.db.get(args.id);
    if (!userId || !key || key.userId !== userId) throw new Error("Key not found.");
    await ctx.db.patch(args.id, { revokedAt: Date.now() });
  },
});

/**
 * Internal: called by HTTP routes with the bearer token. Validates the key
 * and applies a fixed-window rate limit atomically.
 */
export const authenticate = internalMutation({
  args: { bearer: v.string() },
  handler: async (ctx, args) => {
    const hash = sha256Hex(new TextEncoder().encode(args.bearer));
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", hash))
      .unique();
    if (!key) return { ok: false as const, reason: "Invalid API key." };
    if (key.revokedAt) return { ok: false as const, reason: "API key revoked." };

    const now = Date.now();
    const inWindow = now - key.windowStart < RATE_WINDOW_MS;
    const count = inWindow ? key.requestCount + 1 : 1;
    if (!inWindow) {
      await ctx.db.patch(key._id, { windowStart: now, requestCount: count });
    } else {
      await ctx.db.patch(key._id, { requestCount: count });
    }
    await ctx.db.patch(key._id, { lastUsedAt: now });

    if (count > RATE_MAX) {
      return {
        ok: false as const,
        reason: `Rate limit exceeded: ${RATE_MAX} requests per minute.`,
      };
    }
    return {
      ok: true as const,
      keyId: key._id,
      userId: key.userId,
      remaining: RATE_MAX - count,
    };
  },
});

/** Internal: attribute an API-submitted scan to the key's owner. */
export const recordAudit = internalMutation({
  args: { userId: v.id("users"), action: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      action: args.action,
      createdAt: Date.now(),
    });
  },
});
