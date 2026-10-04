/**
 * URL analysis support: server-side fetch with SSRF protection.
 *
 * The browser cannot download arbitrary image URLs because of CORS, so the
 * file is fetched here, validated (scheme, host, private-IP ranges, content
 * type, size cap) and returned to the client as base64. The client then runs
 * the exact same analysis pipeline as a direct upload. Video-by-URL is not
 * supported in v1 and returns a clear error instead of a half-result.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";

const MAX_BYTES = 9 * 1024 * 1024; // stay under Convex payload limits
const FETCH_TIMEOUT_MS = 20_000;

export class UrlRejected extends Error {}

function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UrlRejected("That is not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UrlRejected("Only http(s) URLs are allowed.");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80")
  ) {
    throw new UrlRejected("Private/local hosts are blocked (SSRF protection).");
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const priv =
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a === 0;
    if (priv) throw new UrlRejected("Private IP ranges are blocked (SSRF protection).");
  }
  return u;
}

function b64(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? chars[c & 63] : "=";
  }
  return out;
}

const MAGIC: Array<{ test: (b: Uint8Array) => boolean; mime: string; ext: string }> = [
  {
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    mime: "image/jpeg",
    ext: "jpg",
  },
  {
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    mime: "image/png",
    ext: "png",
  },
  {
    test: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
    mime: "image/webp",
    ext: "webp",
  },
];

export const fetchRemoteMedia = action({
  args: { url: v.string() },
  handler: async (_ctx, args) => {
    const u = assertSafeUrl(args.url);
    if (/youtu\.be|youtube\.com|instagram\.com|tiktok\.com|(^|\.)x\.com|twitter\.com/i.test(u.hostname)) {
      throw new UrlRejected(
        "Social-platform links (YouTube/Instagram/X) are not supported in v1 — download the media and upload it directly.",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(u.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "TruthLensBot/1.0 (+forensics)" },
      });
      if (!res.ok) throw new UrlRejected(`Upstream responded ${res.status}.`);
      // re-validate after redirects: a redirect could point at an internal host
      assertSafeUrl(res.url);
      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      if (ctype.startsWith("video/")) {
        throw new UrlRejected(
          "Video-by-URL is not supported in v1. Download the file and upload it directly to run full video analysis.",
        );
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) throw new UrlRejected("File exceeds the 9 MB URL limit.");

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new UrlRejected("File exceeds the 9 MB URL limit.");
      const kind = MAGIC.find((m) => m.test(buf));
      if (!kind) {
        throw new UrlRejected(
          "The URL did not return a JPEG, PNG or WebP image (checked by file signature, not extension).",
        );
      }
      const nameFromUrl = decodeURIComponent(u.pathname.split("/").pop() || "remote-image");
      const fileName = nameFromUrl.includes(".") ? nameFromUrl : `${nameFromUrl}.${kind.ext}`;
      return {
        fileName: fileName.slice(0, 120),
        mime: kind.mime,
        bytes: buf.length,
        base64: b64(buf),
      };
    } catch (err) {
      if (err instanceof UrlRejected) throw new Error(err.message);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("The URL timed out after 20 seconds.");
      }
      throw new Error(
        `Could not fetch that URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  },
});
