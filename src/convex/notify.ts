"use node";

/**
 * Best-effort admin notification for contact-form submissions. Failures are
 * swallowed on purpose: the message is already saved in the database, and a
 * missing integration key must never break the form.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { vly } from "../lib/vly-integrations";

export const emailAdmin = internalAction({
  args: { name: v.string(), email: v.string(), message: v.string() },
  handler: async (_ctx, args) => {
    try {
      const to = process.env.ADMIN_EMAIL;
      if (!to) return;
      const res = await vly.email.send({
        to,
        subject: `TruthLens contact: ${args.name}`,
        html: `
          <div style="font-family: Georgia, serif; color: #2a2218">
            <h2>New contact message</h2>
            <p><strong>From:</strong> ${args.name} &lt;${args.email}&gt;</p>
            <p><strong>Message:</strong></p>
            <blockquote style="white-space: pre-wrap; border-left: 3px solid #c9b896; padding-left: 12px">
${args.message.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))}
            </blockquote>
          </div>`,
      });
      if (!res.success) console.warn("Contact email failed:", res.error);
    } catch (err) {
      console.warn("Contact email error:", err);
    }
  },
});
