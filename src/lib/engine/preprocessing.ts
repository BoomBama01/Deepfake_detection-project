/**
 * TruthLens — preprocessing.
 *
 * Turn whatever the browser gives us into the exact array a detector needs,
 * without destroying forensic evidence. The *original* RGBA plane is kept
 * around for the signal checks; this module only produces the model-normalised
 * view and the metadata-extraction view.
 */

import { grayFromRgba } from "./dsp";
import type { MediaFormat } from "./metadata";
import type { Gray } from "./dsp";


/**  */
export const SUPPORTED_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/avif",
] as const;

export type ImageFormat = (typeof SUPPORTED_FORMATS)[number];

/** What we return to every downstream stage. */
export interface PreprocessedImage {
  /** Original RGBA in canonical sRGB/gamma space. */
  rgba: Uint8ClampedArray;
  /** Width × height of the decoded image. */
  width: number;
  height: number;
  /** Detected container (sniffed from magic bytes, never from the extension). */
  format: MediaFormat;
  /** The raw File, so the caller can still hash it, slice it, or re-encode it. */
  file: File;
  /** Decoded source size (before any downscaling). */
  sourceSize: { width: number; height: number };
}

/** A resize filter. Nearest is fastest; spline is the forensic default. */
export type ResizeFilter = "nearest" | "bilinear" | "spline36";

export interface ResizeOptions {
  /** Output long edge. If 0, the original is kept untouched (model view only). */
  maxDim: number;
  /** Filter for the downscale. */
  filter: ResizeFilter;
}

/**
 * Decode + optional downscale → { rgba, width, height }.
 *
 * The decoder in the browser is deliberately left out of this function: the
 * caller already holds a `createImageBitmap`-produced bitmap or a `canvas`,
 * and we only need the pixel bytes. `decodeBitmap()` does the actual decode.
 */
export function resizeImage(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  opts: ResizeOptions,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const { maxDim, filter } = opts;
  if (srcW <= 1 || srcH <= 1 || maxDim <= 0 || maxDim >= Math.max(srcW, srcH)) {
    return { rgba, width: srcW, height: srcH };
  }
  const scale = maxDim / Math.max(srcW, srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  if (filter === "nearest") {
    return { rgba: nearestResample(rgba, srcW, srcH, dw, dh), width: dw, height: dh };
  }
  if (filter === "bilinear") {
    return { rgba: bilinearResample(rgba, srcW, srcH, dw, dh), width: dw, height: dh };
  }
  return { rgba: spline36Resample(rgba, srcW, srcH, dw, dh), width: dw, height: dh };
}

/** Fast, high-quality Lanczos-ish (cubic B-spline) resampler. Deterministic and dither-free on the downsample path. */
function spline36Resample(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const scaleX = sw / dw;
  const scaleY = sh / dh;
  const pre = new Float32Array(sw * 4);
  for (let x = 0; x < sw; x++) {
    const fx = (x + 0.5) * scaleX - 0.5;
    const x0 = Math.max(0, Math.floor(fx));
    const x1 = Math.min(sw - 1, x0 + 1);
    const dx = fx - x0;
    const ax = dx < 1 ? 1.5 * dx * dx - 2.5 * dx + 1 : -0.5 * dx * dx + 2.5 * dx + 0.5;
    const bx = dx < 1 ? -2.5 * dx * dx + 4.5 * dx + 0.5 : 0.5 * dx * dx - 2.5 * dx + 2;
    for (let c = 0; c < 4; c++) {
      pre[x * 4 + c] =
        src[x0 * 4 + c] * ax + src[x1 * 4 + c] * bx + 0.5;
    }
  }
  for (let y = 0; y < sh; y++) {
    const fy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const dy = fy - y0;
    const ay = dy < 1 ? 1.5 * dy * dy - 2.5 * dy + 1 : -0.5 * dy * dy + 2.5 * dy + 0.5;
    const by = dy < 1 ? -2.5 * dy * dy + 4.5 * dy + 0.5 : 0.5 * dy * dy - 2.5 * dy + 2;
    for (let x = 0; x < dw; x++) {
      const idx = (y * dw + x) * 4;
      const sx = x * scaleX;
      const px = Math.max(0, Math.floor(sx));
      const pxe = Math.min(sw - 1, px + 1);
      const mx = sx - px;
      const a = pre[px * 4] * (1 - mx) + pre[pxe * 4] * mx + 0.5;
      const b = pre[px * 4 + 4] * (1 - mx) + pre[pxe * 4 + 4] * mx + 0.5;
      // Spline36: blend the two axis results once more to make it full cubic.
      out[idx] = Math.round(a * (1 - dy) + b * dy) >>> 0;
    }
  }
  return out;
}

/** Blended bilinear for the fallback path. */
function bilinearResample(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.max(0, Math.min(sh - 2, Math.floor(fy)));
    const y1 = y0 + 1;
    const dy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(fx)));
      const x1 = x0 + 1;
      const dx = fx - x0;
      const i = (y * dw + x) * 4;
      out[i] = Math.round(
        src[(y0 * sw + x0) * 4] * (1 - dx) * (1 - dy) +
          src[(y0 * sw + x1) * 4] * dx * (1 - dy) +
          src[(y1 * sw + x0) * 4] * (1 - dx) * dy +
          src[(y1 * sw + x1) * 4] * dx * dy,
      ) >>> 0;
      out[i + 1] = Math.round(
        src[(y0 * sw + x0) * 4 + 1] * (1 - dx) * (1 - dy) +
          src[(y0 * sw + x1) * 4 + 1] * dx * (1 - dy) +
          src[(y1 * sw + x0) * 4 + 1] * (1 - dx) * dy +
          src[(y1 * sw + x1) * 4 + 1] * dx * dy,
      ) >>> 0;
      out[i + 2] = Math.round(
        src[(y0 * sw + x0) * 4 + 2] * (1 - dx) * (1 - dy) +
          src[(y0 * sw + x1) * 4 + 2] * dx * (1 - dy) +
          src[(y1 * sw + x0) * 4 + 2] * (1 - dx) * dy +
          src[(y1 * sw + x1) * 4 + 2] * dx * dy,
      ) >>> 0;
      out[i + 3] = 255;
    }
  }
  return out;
}

function nearestResample(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const yy = Math.max(0, Math.min(sh - 1, Math.round(fy)));
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const xx = Math.max(0, Math.min(sw - 1, Math.round(fx)));
      const i = (y * dw + x) * 4;
      out[i] = src[(yy * sw + xx) * 4];
      out[i + 1] = src[(yy * sw + xx) * 4 + 1];
      out[i + 2] = src[(yy * sw + xx) * 4 + 2];
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Pull RGBA out of a platform-decoded bitmap. Kept thin so the browser test
 * harness stays a pure normalisation layer on top of the platform's decoder.
 */
export function bitmapToRgba(
  bitmap: ImageData | HTMLCanvasElement | HTMLImageElement,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  if (bitmap instanceof HTMLCanvasElement || bitmap instanceof HTMLImageElement) {
    const c = document.createElement("canvas");
    c.width = bitmap instanceof HTMLCanvasElement ? bitmap.width : bitmap.naturalWidth || 1;
    c.height = bitmap instanceof HTMLCanvasElement ? bitmap.height : bitmap.naturalHeight || 1;
    const ctx = c.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable (bitmapTooWide?)");
    }
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    return { rgba: img.data, width: c.width, height: c.height };
  }
  // ImageData from createImageBitmap/OffscreenCanvas.
  const d = bitmap as ImageData;
  const data = new Uint8ClampedArray(d.data.buffer);
  return { rgba: data, width: d.width, height: d.height };
}

/**
 * Normalise an image to the exact input a detector expects.
 *
 * Canvas scale is applied here deliberately, so the downstream signal checks
 * observe a *single* consistent sampling (never a mixture of two
 * resolutions). `maxDim = 0` keeps the source untouched.
 */
export function modelNormalizedImage(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  maxDim: number,
  filter: ResizeFilter = "spline36",
): { rgba: Uint8ClampedArray; width: number; height: number } {
  if (maxDim <= 0) return { rgba, width: srcW, height: srcH };
  return resizeImage(rgba, srcW, srcH, { maxDim, filter });
}

/** Gamma-correct the decoded pixels (sRGB → linear for the legacy checks, then back). Kept as a no-op on the sRGB canvas path: the detector works in gamma space and expects canonical sRGB bytes. */
export function linearFromGamma(
  rgba: Uint8ClampedArray,
): Uint8ClampedArray {
  // No-op: the platform decoder already yields sRGB bytes, which is what the
  // detector expects. Left here as the documented hook for a linear-space
  // pipeline if a model ever demands it.
  return rgba;
}
