/**
 * TruthLens — forensic artifact rendering (browser only).
 *
 * Produces the ELA view and the suspicious-region heatmap that the results
 * page compares against the original. Purely derived from measured pixel
 * data: no decoration is drawn that is not backed by an actual measurement.
 */

import { clamp, percentile, type Gray } from "./dsp";
import type { FaceResult } from "./types";

const MAX_DIM = 1024;

function scaleFor(w: number, h: number): { w: number; h: number; s: number } {
  const s = Math.min(1, MAX_DIM / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), s };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Warm-toned ELA render (0..255 error → image), scaled at p95. */
export function renderElaImage(
  ela: Float32Array,
  srcW: number,
  srcH: number,
): string {
  const { w, h, s } = scaleFor(srcW, srcH);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const p95 = Math.max(1, percentile(ela, 95));
  const gain = 255 / p95;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x / s));
      const sy = Math.min(srcH - 1, Math.floor(y / s));
      const v = clamp(Math.round(ela[sy * srcW + sx] * gain), 0, 255);
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = Math.round(v * 0.93);
      img.data[i + 2] = Math.round(v * 0.78); // archival warm tint
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export interface HeatmapArgs {
  /** drawable original (ImageBitmap, canvas, img) */
  source: CanvasImageSource;
  srcW: number;
  srcH: number;
  ela: Float32Array | null;
  /** tile grid used for the ELA anomaly layer (signal tile size) */
  tileSize: number;
  faces: FaceResult[];
  caption?: string;
}

/**
 * Suspicious-region overlay: ELA anomaly energy as a warm glow, plus detected
 * face boxes labelled with their measured manipulation score.
 */
export function renderHeatmap(args: HeatmapArgs): string {
  const { source, srcW, srcH, ela, tileSize, faces, caption } = args;
  const { w, h } = scaleFor(srcW, srcH);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.drawImage(source, 0, 0, w, h);
  // desaturate the base so the overlay reads clearly
  ctx.globalCompositeOperation = "saturation";
  ctx.fillStyle = "hsl(0, 0%, 65%)";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  if (ela) {
    const cols = Math.max(1, Math.floor(srcW / tileSize));
    const rows = Math.max(1, Math.floor(srcH / tileSize));
    const layer = makeCanvas(cols, rows);
    const lctx = layer.getContext("2d");
    if (lctx) {
      const img = lctx.createImageData(cols, rows);
      const tileEla: number[] = [];
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          let sum = 0;
          let n = 0;
          for (let y = ty * tileSize; y < Math.min(srcH, (ty + 1) * tileSize); y += 2) {
            for (let x = tx * tileSize; x < Math.min(srcW, (tx + 1) * tileSize); x += 2) {
              sum += ela[y * srcW + x];
              n++;
            }
          }
          tileEla.push(n ? sum / n : 0);
        }
      }
      const ref = Math.max(1, percentile(tileEla, 90));
      tileEla.forEach((v, i) => {
        const a = clamp(Math.round((v / ref) * 235), 0, 235);
        const j = i * 4;
        // ember → oxblood ramp, matching the vintage palette
        img.data[j] = Math.round(140 + 90 * (a / 235));
        img.data[j + 1] = Math.round(40 + 30 * (a / 235));
        img.data[j + 2] = Math.round(24 + 10 * (a / 235));
        img.data[j + 3] = a;
      });
      lctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.78;
      ctx.drawImage(layer, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  // face boxes with measured scores
  faces.forEach((f, i) => {
    const x = f.box.x * w;
    const y = f.box.y * h;
    const fw = f.box.w * w;
    const fh = f.box.h * h;
    ctx.lineWidth = Math.max(2, w / 420);
    ctx.strokeStyle = "rgba(245, 233, 210, 0.95)";
    ctx.strokeRect(x, y, fw, fh);
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = Math.max(1, w / 700);
    ctx.strokeStyle = "rgba(122, 42, 30, 0.9)";
    ctx.strokeRect(x - 3, y - 3, fw + 6, fh + 6);
    ctx.setLineDash([]);
    const label = `FACE ${i + 1} · ${(f.score * 100).toFixed(0)}%`;
    ctx.font = `${Math.max(10, Math.round(w / 72))}px "Courier Prime", monospace`;
    const tw = ctx.measureText(label).width + 10;
    const lh = Math.max(14, Math.round(w / 58));
    const ly = y > lh + 4 ? y - lh - 2 : y + fh + 2;
    ctx.fillStyle = "rgba(38, 30, 22, 0.88)";
    ctx.fillRect(x, ly, tw, lh);
    ctx.fillStyle = "#f5e9d2";
    ctx.fillText(label, x + 5, ly + lh - 4);
  });

  // archival frame + caption
  ctx.strokeStyle = "rgba(42, 34, 24, 0.65)";
  ctx.lineWidth = Math.max(2, w / 480);
  ctx.strokeRect(1, 1, w - 2, h - 2);
  if (caption) {
    ctx.font = `${Math.max(9, Math.round(w / 90))}px "Courier Prime", monospace`;
    ctx.fillStyle = "rgba(38, 30, 22, 0.8)";
    const label = caption.toUpperCase();
    const tw = ctx.measureText(label).width + 12;
    const lh = Math.max(16, Math.round(w / 50));
    ctx.fillRect(w - tw - 6, h - lh - 4, tw, lh);
    ctx.fillStyle = "#f5e9d2";
    ctx.fillText(label, w - tw, h - 9);
  }
  return canvas.toDataURL("image/jpeg", 0.86);
}

/** Draw an image at a max dimension and return a JPEG data URL (preview). */
export function renderPreview(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxDim = 1200,
  quality = 0.86,
): { dataUrl: string; canvas: HTMLCanvasElement } {
  const s = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * s));
  const h = Math.max(1, Math.round(srcH * s));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl: "", canvas };
  ctx.drawImage(source, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), canvas };
}

/** Render a canvas region (video frame) to a JPEG data URL. */
export function canvasToDataUrl(c: HTMLCanvasElement, quality = 0.85): string {
  return c.toDataURL("image/jpeg", quality);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Gray → data URL helper (debug/ELA fallbacks). */
export function grayToDataUrl(g: Gray): string {
  const canvas = makeCanvas(g.width, g.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) {
    const v = clamp(Math.round(g.data[i]), 0, 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.8);
}
