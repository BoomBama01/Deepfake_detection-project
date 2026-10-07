import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const planValidator = v.union(
  v.literal("free"),
  v.literal("pro"),
  v.literal("team"),
);
export type Plan = Infer<typeof planValidator>;

export const verdictValidator = v.union(
  v.literal("real"),
  v.literal("inconclusive"),
  v.literal("likely_ai"),
  v.literal("likely_deepfake"),
  v.literal("error"),
);
export type Verdict = Infer<typeof verdictValidator>;

export const mediaTypeValidator = v.union(
  v.literal("image"),
  v.literal("video"),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
      plan: v.optional(planValidator), // subscription plan (free default)
      banned: v.optional(v.boolean()), // abusive users are blocked from scanning
      createdAt: v.optional(v.number()),
    })
      .index("email", ["email"]) // for the email. do not remove or modify
      .index("by_role", ["role"]),

    // One row per analysis. The media itself is never persisted — only a
    // downscaled preview plus derived forensic artifacts, all purged after
    // `expiresAt` while the result summary is kept.
    scans: defineTable({
      userId: v.optional(v.id("users")),
      deviceId: v.optional(v.string()), // guest ownership for the 3/day quota
      type: mediaTypeValidator,
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("done"),
        v.literal("error"),
      ),
      source: v.union(v.literal("upload"), v.literal("url"), v.literal("sample")),
      fileName: v.string(),
      fileHash: v.optional(v.string()), // SHA-256 of the original bytes
      fileSize: v.optional(v.number()),
      previewId: v.optional(v.id("_storage")), // downscaled original, for display
      heatmapId: v.optional(v.id("_storage")), // suspicious-region overlay
      elaId: v.optional(v.id("_storage")), // error-level-analysis view
      verdict: v.optional(verdictValidator),
      confidence: v.optional(v.number()), // 0..100
      settings: v.string(), // JSON of the settings used for this run
      resultJson: v.optional(v.string()), // full engine output
      errorMessage: v.optional(v.string()), // why a run is in "error" status
      isPublic: v.optional(v.boolean()),
      pinned: v.optional(v.boolean()), // keep media artifacts past expiry
      frameUrls: v.optional(
        v.array(
          v.object({
            t: v.number(),
            imageStorageId: v.optional(v.id("_storage")),
            heatStorageId: v.optional(v.id("_storage")),
          }),
        ),
      ), // video frame artifacts
      createdAt: v.number(),
      expiresAt: v.number(), // media artifacts are deleted at this point
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_device", ["deviceId", "createdAt"])
      .index("by_hash", ["fileHash"])
      .index("by_created", ["createdAt"]),

    feedback: defineTable({
      scanId: v.id("scans"),
      userId: v.optional(v.id("users")),
      isCorrect: v.boolean(),
      comment: v.optional(v.string()),
      status: v.union(v.literal("new"), v.literal("reviewed")),
      createdAt: v.number(),
    })
      .index("by_scan", ["scanId"])
      .index("by_status", ["status"]),

    apiKeys: defineTable({
      userId: v.id("users"),
      name: v.string(),
      keyHash: v.string(), // sha256 of the secret; the secret itself is never stored
      prefix: v.string(), // display prefix, e.g. tl_live_ab12
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      requestCount: v.number(),
      windowStart: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_hash", ["keyHash"]),

    contactMessages: defineTable({
      name: v.string(),
      email: v.string(),
      message: v.string(),
      createdAt: v.number(),
      status: v.union(v.literal("new"), v.literal("replied")),
    }).index("by_status", ["status"]),

    auditLogs: defineTable({
      userId: v.optional(v.string()),
      action: v.string(),
      ip: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

    // Guest scan quota: 3 free scans per device per UTC day.
    guestQuota: defineTable({
      deviceId: v.string(),
      day: v.string(), // YYYY-MM-DD
      count: v.number(),
    }).index("by_device_day", ["deviceId", "day"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
