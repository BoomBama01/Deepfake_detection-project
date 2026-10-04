/**
 * TruthLens engine — container/metadata forensics.
 *
 * Byte-level parsing only (no DOM): JPEG/PNG/WebP/MP4/GIF markers, EXIF IFD
 * tags, JPEG quantisation quality estimation, C2PA / Content-Credentials
 * markers and known AI-tool signatures embedded by generators. Everything is
 * read from the actual file bytes; absent metadata is reported as absent.
 */

import type { MetadataFindings } from "./types";

export type MediaFormat = "jpeg" | "png" | "webp" | "gif" | "mp4" | "webm" | "avi" | "unknown";

const AI_SIGNATURES: Array<{ re: RegExp; label: string }> = [
  { re: /stable[\s_-]?diffusion/i, label: "Stable Diffusion marker" },
  { re: /automatic1111/i, label: "Automatic1111 marker" },
  { re: /\bcomfyui\b/i, label: "ComfyUI marker" },
  { re: /midjourney/i, label: "Midjourney marker" },
  { re: /dall[\s-]?e/i, label: "DALL·E marker" },
  { re: /novelai/i, label: "NovelAI marker" },
  { re: /sampling steps|denoising strength|cfg scale|prompt\s*:/i, label: "Diffusion prompt parameters" },
  { re: /chatgpt|openai/i, label: "OpenAI marker" },
  { re: /google[\s_-]?imagen/i, label: "Google Imagen marker" },
  { re: /adobe[\s_-]?firefly|\bfirefly\b/i, label: "Adobe Firefly marker" },
  { re: /leonardo\.ai/i, label: "Leonardo marker" },
  { re: /deepfacelab|facefusion|insightface|\bsimswap\b|\breface\b|faceapp/i, label: "Face-swap tool marker" },
  { re: /synthesia|heygen|\bd-id\b|d_id/i, label: "AI video presenter marker" },
  { re: /runwayml|gen-?3|pika labs/i, label: "Generative video marker" },
  { re: /text-to-image|txt2img|img2img/i, label: "Text-to-image pipeline marker" },
];

const FACE_SIG_RE = /deepfacelab|facefusion|insightface|\bsimswap\b|\breface\b|faceapp/i;
const GEN_VIDEO_RE = /synthesia|heygen|\bd-id\b|d_id|runwayml|gen-?3|pika labs/i;

export function isFaceSwapSignature(findings: MetadataFindings): boolean {
  return findings.aiSignatures.some((s) => FACE_SIG_RE.test(s));
}
export function isGenerativeVideoSignature(findings: MetadataFindings): boolean {
  return findings.aiSignatures.some((s) => GEN_VIDEO_RE.test(s));
}

export function sniffFormat(bytes: Uint8Array): MediaFormat {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes.length > 12 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "webm";
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x41 &&
    bytes[9] === 0x56 &&
    bytes[10] === 0x49
  )
    return "avi";
  if (bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79)
    return "mp4";
  return "unknown";
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Case-insensitive ASCII search across raw bytes. */
function findAscii(haystack: Uint8Array, needle: string): number {
  const n = needle.length;
  const lower = needle.toLowerCase();
  const limit = haystack.length - n;
  for (let i = 0; i <= limit; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const c = haystack[i + j];
      const lc = c >= 0x41 && c <= 0x5a ? c + 32 : c;
      if (lc !== lower.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function asciiAround(bytes: Uint8Array, idx: number, radius = 120): string {
  const start = Math.max(0, idx - radius);
  const end = Math.min(bytes.length, idx + radius);
  let out = "";
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

const STD_LUMA_Q50 = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_LUMA_AVG = STD_LUMA_Q50.reduce((a, b) => a + b, 0) / 64;

/** Estimate JPEG quality factor from the luma quantisation table (1..100). */
export function estimateJpegQuality(qt: Uint8Array): number | null {
  if (qt.length < 64) return null;
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += qt[i];
  const avg = sum / 64;
  if (avg <= 0) return null;
  const avgFor = (q: number) =>
    ((q < 50 ? 5000 / q : 200 - 2 * q) * STD_LUMA_AVG) / 100;
  let lo = 1;
  let hi = 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (avgFor(mid) > avg) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/* ------------------------------------------------------------------ */
/* EXIF (TIFF IFD0)                                                    */
/* ------------------------------------------------------------------ */

const EXIF_TAGS: Record<number, string> = {
  0x010f: "Make",
  0x0110: "Model",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x8298: "Copyright",
  0xa434: "LensModel",
};

function parseExifTiff(buf: Uint8Array, off: number, tags: Record<string, string>): boolean {
  if (off + 8 > buf.length) return false;
  const le = ascii(buf, off, 2) === "II";
  const u16 = (o: number) =>
    le ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1];
  const u32 = (o: number) =>
    le
      ? ((buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0)
      : ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  if (u16(off + 2) !== 42) return false;
  const ifd = off + u32(off + 4);
  if (ifd + 2 > buf.length) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > buf.length) break;
    const tag = u16(e);
    const type = u16(e + 2);
    const num = u32(e + 4);
    const name = EXIF_TAGS[tag];
    if (!name) continue;
    let valOff = e + 8;
    const bytesPer = type === 2 ? 1 : type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : 0;
    if (!bytesPer) continue;
    if (bytesPer * num > 4) {
      const rel = u32(e + 8);
      valOff = off + rel;
    }
    if (valOff + bytesPer * num > buf.length) continue;
    if (type === 2) {
      const s = ascii(buf, valOff, num).replace(/\0+$/, "").trim();
      if (s) tags[name] = s;
    } else if (type === 3) {
      tags[name] = String(u16(valOff));
    } else if (type === 4) {
      tags[name] = String(u32(valOff));
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Format-specific walkers                                             */
/* ------------------------------------------------------------------ */

function parseJpeg(bytes: Uint8Array, tags: Record<string, string>): { qf: number | null; icc: boolean } {
  let qf: number | null = null;
  let icc = false;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    const segStart = i + 4;
    const segEnd = i + 2 + len;
    if (marker === 0xdb) {
      // DQT — first table is usually the luma table
      let p = segStart;
      while (p < segEnd) {
        const pq = bytes[p] >> 4;
        const tq = bytes[p] & 15;
        const size = pq === 0 ? 64 : 128;
        if (tq === 0 && size === 64 && qf === null) {
          qf = estimateJpegQuality(bytes.subarray(p + 1, p + 65));
        }
        p += 1 + size;
      }
    } else if (marker === 0xe1 && segEnd <= bytes.length) {
      const head = ascii(bytes, segStart, 6);
      if (head === "Exif\0\0") parseExifTiff(bytes, segStart + 6, tags);
    } else if (marker === 0xe2) {
      if (ascii(bytes, segStart, 12) === "ICC_PROFILE") icc = true;
    } else if (marker === 0xfe && segEnd <= bytes.length) {
      const comment = ascii(bytes, segStart, Math.min(200, segEnd - segStart));
      if (comment.trim()) tags["Comment"] = comment.trim();
    }
    i = segEnd;
  }
  return { qf, icc };
}

function parsePng(bytes: Uint8Array, tags: Record<string, string>): void {
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len =
      ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    const type = ascii(bytes, p + 4, 4);
    const dataStart = p + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) break;
    if (type === "tEXt" || type === "iTXt") {
      const raw = ascii(bytes, dataStart, Math.min(len, 4096));
      const z = raw.indexOf("\0");
      if (z > 0) {
        const key = raw.slice(0, z);
        let value = raw.slice(z + 1);
        if (type === "iTXt") {
          // keyword\0 compressionFlag(1) compressionMethod(1) lang\0 translated\0 text
          const rest = raw.slice(z + 1);
          const parts = rest.split("\0");
          value = parts.slice(2).join(" ").trim();
        }
        if (value && value !== "\0") tags[key] = value.slice(0, 1000);
      }
    } else if (type === "eXIf") {
      parseExifTiff(bytes, dataStart, tags);
    }
    p = dataEnd + 4;
  }
}

function parseWebp(bytes: Uint8Array, tags: Record<string, string>): void {
  let p = 12;
  while (p + 8 <= bytes.length) {
    const type = ascii(bytes, p, 4);
    const len = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
    const start = p + 8;
    if (start + len > bytes.length) break;
    if (type === "EXIF") parseExifTiff(bytes, start, tags);
    if (type === "VP8X" && len >= 1) {
      const flags = bytes[start];
      if (flags & 0x08) tags["ExifPresent"] = "true";
      if (flags & 0x20) tags["XmpPresent"] = "true";
    }
    p = start + len + (len % 2);
  }
}

function parseMp4(bytes: Uint8Array, tags: Record<string, string>): void {
  // top-level box walk for ftyp brand; deeper structures are covered by the
  // raw signature scan below.
  if (bytes.length >= 12) {
    const brand = ascii(bytes, 8, 4).trim();
    if (brand) tags["MajorBrand"] = brand;
    const compat = ascii(bytes, 12, Math.min(32, bytes.length - 12));
    if (compat.trim()) tags["CompatibleBrands"] = compat.replace(/[^\w ]/g, "").trim();
  }
  const lavf = findAscii(bytes, "Lavf");
  if (lavf >= 0) tags["Encoder"] = asciiAround(bytes, lavf, 60);
  const qt = findAscii(bytes, "QuickTime");
  if (qt >= 0 && !tags["Encoder"]) tags["Encoder"] = "QuickTime";
  const apple = findAscii(bytes, "com.apple.quicktime");
  if (apple >= 0) tags["QuickTimeMetadata"] = asciiAround(bytes, apple, 80);
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export function parseMetadata(bytes: Uint8Array, format: MediaFormat): MetadataFindings {
  const tags: Record<string, string> = {};
  const warnings: string[] = [];
  let qf: number | null = null;

  try {
    if (format === "jpeg") {
      const r = parseJpeg(bytes, tags);
      qf = r.qf;
      if (r.icc) tags["ICCProfile"] = "present";
    } else if (format === "png") {
      parsePng(bytes, tags);
    } else if (format === "webp") {
      parseWebp(bytes, tags);
    } else if (format === "mp4") {
      parseMp4(bytes, tags);
    }
  } catch {
    warnings.push("Metadata parser could not fully walk the container; results are partial.");
  }

  // C2PA / Content Credentials markers (JUMBF boxes carry "c2pa" / "jumb")
  const c2paIdx = Math.max(findAscii(bytes, "c2pa"), findAscii(bytes, "Content Credentials"));
  const jumbIdx = findAscii(bytes, "JUMBF");
  const c2pa = c2paIdx >= 0 || jumbIdx >= 0;
  const c2paDetail = c2pa
    ? asciiAround(bytes, c2paIdx >= 0 ? c2paIdx : jumbIdx, 100)
    : null;

  // Known generator/tool signatures anywhere in the byte stream (chunked so
  // markers are found no matter where a chunk/segment sits).
  const aiSignatures: string[] = [];
  const scanned = Math.min(bytes.length, 8_000_000); // first 8 MB is plenty
  const CHUNK = 262144;
  for (let off = 0; off < scanned; off += CHUNK - 128) {
    const src = ascii(bytes, off, Math.min(CHUNK, scanned - off));
    for (const { re, label } of AI_SIGNATURES) {
      if (!aiSignatures.includes(label) && re.test(src)) aiSignatures.push(label);
    }
  }

  const hasExif = Object.keys(tags).some((k) =>
    ["Make", "Model", "Software", "DateTime", "Artist", "Copyright", "LensModel"].includes(k),
  );

  if (!hasExif && (format === "jpeg" || format === "webp")) {
    warnings.push(
      "No camera EXIF found — common for web-resaved or edited images, and for renders. Not proof of manipulation on its own.",
    );
  }
  if (qf !== null && qf < 40) {
    warnings.push(`Heavy JPEG compression estimated (quality ≈ ${qf}); fine forensic signals are degraded.`);
  }

  if (qf !== null) tags["EstimatedJpegQuality"] = String(qf);

  return {
    format: format.toUpperCase(),
    hasExif,
    software: tags["Software"] ?? null,
    cameraMake: tags["Make"] ?? null,
    cameraModel: tags["Model"] ?? null,
    dateTime: tags["DateTime"] ?? null,
    c2pa,
    c2paDetail,
    aiSignatures,
    warnings,
    tags,
  };
}
