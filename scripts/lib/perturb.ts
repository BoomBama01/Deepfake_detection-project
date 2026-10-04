/**
 * Perturbation helpers — simulate what real uploads go through on their way
 * to a detector (social-platform recompression, thumbnails, blur).
 * Shared by scripts/robustness-check.ts and the band-measurement runs.
 */
import jpeg from "jpeg-js";
import * as PNG_MOD from "pngjs";
import type { DecodedImage } from "./pipeline";

export function toRgba(img: DecodedImage): Uint8ClampedArray {
  return new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length);
}

/** Separable box blur, `passes` times (approximates a gaussian). */
export function blurRgba(img: DecodedImage, radius = 1, passes = 2): DecodedImage {
  const { width: w, height: h } = img;
  let src = toRgba(img);
  const win = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    const tmp = new Uint8ClampedArray(src.length);
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let k = -radius; k <= radius; k++) {
            const xx = Math.min(w - 1, Math.max(0, x + k));
            acc += src[(y * w + xx) * 4 + c];
          }
          tmp[(y * w + x) * 4 + c] = acc / win;
        }
        tmp[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let k = -radius; k <= radius; k++) {
            const yy = Math.min(h - 1, Math.max(0, y + k));
            acc += tmp[(yy * w + x) * 4 + c];
          }
          out[(y * w + x) * 4 + c] = acc / win;
        }
        out[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
      }
    }
    src = out;
  }
  return { data: src, width: w, height: h };
}

/** Bilinear downscale by `factor` and back up to the original size. */
export function resizeRoundTrip(img: DecodedImage, factor = 0.5): DecodedImage {
  const { width: w, height: h } = img;
  const dw = Math.max(8, Math.round(w * factor));
  const dh = Math.max(8, Math.round(h * factor));
  const src = toRgba(img);
  const small = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, Math.round((y * h) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.round((x * w) / dw));
      for (let c = 0; c < 4; c++) small[(y * dw + x) * 4 + c] = src[(sy * w + sx) * 4 + c];
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = (y * (dh - 1)) / Math.max(1, h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(dh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = (x * (dw - 1)) / Math.max(1, w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(dw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const top = small[(y0 * dw + x0) * 4 + c] * (1 - tx) + small[(y0 * dw + x1) * 4 + c] * tx;
        const bot = small[(y1 * dw + x0) * 4 + c] * (1 - tx) + small[(y1 * dw + x1) * 4 + c] * tx;
        out[(y * w + x) * 4 + c] = top * (1 - ty) + bot * ty;
      }
      out[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
    }
  }
  return { data: out, width: w, height: h };
}

export function encodeJpeg(img: DecodedImage, quality: number): Uint8Array {
  const rgba = toRgba(img);
  return jpeg.encode(
    {
      data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length),
      width: img.width,
      height: img.height,
    },
    quality,
  ).data;
}

/** Centre crop to `fraction` of each side, then re-encode. Simulates re-framing. */
export function cropRgba(img: DecodedImage, fraction = 0.8): DecodedImage {
  const { width: w, height: h } = img;
  const cw = Math.max(16, Math.round(w * fraction));
  const ch = Math.max(16, Math.round(h * fraction));
  const x0 = Math.floor((w - cw) / 2);
  const y0 = Math.floor((h - ch) / 2);
  const src = toRgba(img);
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const from = ((y0 + y) * w + x0) * 4;
    out.set(src.subarray(from, from + cw * 4), y * cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

/**
 * Simulate a screenshot: mild downscale, flat-region noise added back (real
 * captures always carry capture noise), then re-encode. Screenshots are the
 * single most common way real media reaches a detector, and they destroy most
 * high-frequency forensic signal — so this is the harshest realistic case.
 */
export function screenshotRgba(img: DecodedImage, noise = 1.6): DecodedImage {
  const scaled = resizeRoundTrip(img, 0.9);
  const out = new Uint8ClampedArray(scaled.data);
  // deterministic pseudo-noise (no Math.random — the harness must be repeatable)
  let seed = 0x9e3779b9;
  for (let i = 0; i < out.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = ((seed >>> 24) / 255 - 0.5) * noise;
    out[i] += n;
    out[i + 1] += n;
    out[i + 2] += n;
  }
  return { data: out, width: scaled.width, height: scaled.height };
}

/**
 * Strip metadata by re-encoding into a fresh PNG: EXIF, C2PA and generator
 * signatures are all discarded. This is the transform that turns "absent
 * provenance" into a strong-looking AI hint, so the harness measures whether
 * the verdict survives it.
 */
export function stripMetadata(img: DecodedImage): Uint8Array {
  const { PNG } = PNG_MOD;
  const rgba = toRgba(img);
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  return new Uint8Array(PNG.sync.write(png));
}
