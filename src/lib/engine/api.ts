// api.ts - server-side API security, validation and structured logging
import { createHash } from "crypto";

export const SECURITY = {
  imageMaxBytes: 30 * 1024 * 1024,
  videoMaxBytes: 200 * 1024 * 1024,
  remoteUrlMaxBytes: 9 * 1024 * 1024,
  remoteUrlTimeoutMs: 30000,
  videoMaxSeconds: 360,
  maxFrames: 180,
  minFrames: 2,
  rateWindowMs: 60000,
  rateMaxPerWindow: 60,
  maxMemoryBytes: 128 * 1024 * 1024,
} as const;

export type MediaKind = "image" | "video";
export type LogSeverity = "info" | "warn" | "error";

export interface LogEntry {
  requestId: string;
  caller: string;
  kind: MediaKind;
  fileSize: number;
  contentType: string;
  elapsedMs: number;
  modelVersion?: string;
  aiProbability?: number;
  confidence?: number;
  verdict: string;
  error?: string;
  stage?: string;
  ts: number;
}

const REQUEST_ID_HEADER = "X-Request-ID";

export function requestId(req: Request): string {
  return req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

export function log(entry: Omit<LogEntry, "ts">): string {
  return JSON.stringify({ ...entry, ts: Date.now() });
}

export interface AuditLog {
  requestId: string;
  caller: string;
  kind: MediaKind;
  fileName: string;
  fileSize: number;
  fileHash?: string;
  contentType: string;
  verdict: string;
  aiProbability?: number;
  confidence?: number;
  elapsedMs: number;
  modelVersion?: string;
  error?: string;
  ts: number;
}

export const IMAGE_SIGNATURES = [
  { test: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, mime: "image/jpeg", ext: "jpg" },
  { test: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, mime: "image/png", ext: "png" },
  { test: (b: Uint8Array) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, mime: "image/webp", ext: "webp" },
  { test: (b: Uint8Array) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46, mime: "image/gif", ext: "gif" },
];

export const VIDEO_SIGNATURES = [
  { test: (b: Uint8Array) => b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x00 && b[3] === 0x1c && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, mime: "video/mp4", ext: "mp4" },
  { test: (b: Uint8Array) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3, mime: "video/webm", ext: "webm" },
  { test: (b: Uint8Array) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x41 && b[9] === 0x56 && b[10] === 0x49, mime: "video/quicktime", ext: "mov" },
];

export function sniffMedia(bytes: Uint8Array, expected: MediaKind): { kind: MediaKind; mime: string; ext: string } {
  const chunk = bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes;
  const image = IMAGE_SIGNATURES.find(s => s.test(chunk));
  const video = VIDEO_SIGNATURES.find(s => s.test(chunk));

  if (expected === "image" && !image) {
    throw new Error("Unsupported or corrupt image - signature is not JPEG, PNG, WEBP or GIF.");
  }
  if (expected === "video" && !video) {
    throw new Error("That file does not look like a video container.");
  }
  return { kind: expected, mime: image?.mime ?? video?.mime ?? "unknown", ext: image?.ext ?? video?.ext ?? "" };
}

export function checkSize(kind: MediaKind, size: number, requestId: string): void {
  const max = kind === "image" ? SECURITY.imageMaxBytes : SECURITY.videoMaxBytes;
  if (size > max) {
    throw new Error("File is " + (size / 1024 / 1024).toFixed(1) + " MB - the " + kind + " limit is " + (max / 1024 / 1024) + " MB.");
  }
}

export function auditStart(requestId: string, caller: string, kind: MediaKind, fileName: string, fileSize: number, contentType: string): string {
  const entry: AuditLog = { requestId, caller, kind, fileName, fileSize, contentType, verdict: "pending", ts: Date.now() };
  console.log(log(entry));
  return requestId;
}

export function auditComplete(entry: Omit<AuditLog, "ts"> & { elapsedMs: number }): void {
  auditLog({ ts: Date.now(), ...entry });
}

export function auditError(requestId: string, caller: string, kind: MediaKind, stage: string, error: string, fileSize: number = 0, fileName: string = "", contentType: string = "unknown"): void {
  auditLog({ requestId, caller, kind, fileName, fileSize, contentType, verdict: "error", stage, error, ts: Date.now() });
}

export function auditLog(entry: AuditLog): void {
  console.log(log(entry));
}
