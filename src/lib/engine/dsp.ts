/**
 * TruthLens engine — pure signal-processing primitives.
 * No DOM, no randomness: every function is deterministic and runs both in the
 * browser and in Convex (server) runtime.
 */

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

/** Rec.709 luma from RGBA bytes. */
export function grayFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Gray {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return { data: out, width, height };
}

export function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

export function stdDev(a: ArrayLike<number>): number {
  if (!a.length) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

export function median(a: ArrayLike<number>): number {
  if (!a.length) return 0;
  const c = Array.from(a as ArrayLike<number>).sort((x, y) => x - y);
  const mid = c.length >> 1;
  return c.length % 2 ? c[mid] : (c[mid - 1] + c[mid]) / 2;
}

export function percentile(a: ArrayLike<number>, p: number): number {
  if (!a.length) return 0;
  const c = Array.from(a as ArrayLike<number>).sort((x, y) => x - y);
  const idx = Math.min(c.length - 1, Math.max(0, Math.round((p / 100) * (c.length - 1))));
  return c[idx];
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Linear ramp: 0 at lo, 1 at hi (clamped). */
export function ramp(x: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  return clamp((x - lo) / (hi - lo), 0, 1);
}

/** Separable box blur with edge clamping. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** High-pass residual: image minus its blur (noise / detail carrier). */
export function highPass(g: Gray): Float32Array {
  const blurred = boxBlur(g.data, g.width, g.height, 1);
  const res = new Float32Array(g.data.length);
  for (let i = 0; i < res.length; i++) res[i] = g.data[i] - blurred[i];
  return res;
}

/** Gradient magnitude (3x3 Sobel), used to find flat vs textured tiles. */
export function sobelMag(g: Gray): Float32Array {
  const { data: s, width: w, height: h } = g;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -s[i - w - 1] - 2 * s[i - 1] - s[i + w - 1] + s[i - w + 1] + 2 * s[i + 1] + s[i + w + 1];
      const gy =
        -s[i - w - 1] - 2 * s[i - w] - s[i - w + 1] + s[i + w - 1] + 2 * s[i + w] + s[i + w + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Bilinear resample of a gray plane. */
export function resizeGray(g: Gray, dw: number, dh: number): Gray {
  const out = new Float32Array(dw * dh);
  const sx = g.width / dw;
  const sy = g.height / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(g.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(g.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(g.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(g.width - 1, x0 + 1);
      const wx = fx - x0;
      const a = g.data[y0 * g.width + x0];
      const b = g.data[y0 * g.width + x1];
      const c = g.data[y1 * g.width + x0];
      const d = g.data[y1 * g.width + x1];
      out[y * dw + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return { data: out, width: dw, height: dh };
}

/* ------------------------------------------------------------------ */
/* FFT (iterative radix-2, in-place, complex interleaved re/im)        */
/* ------------------------------------------------------------------ */

export function fft1d(re: Float32Array, im: Float32Array, inverse = false): void {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** 2D power spectrum of an N×N (N = power of two) gray plane. */
export function powerSpectrum(g: Gray): { power: Float32Array; n: number } {
  const n = g.width;
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) re[i] = g.data[i];
  const rowRe = new Float32Array(n);
  const rowIm = new Float32Array(n);
  for (let y = 0; y < n; y++) {
    rowRe.set(re.subarray(y * n, y * n + n));
    rowIm.set(im.subarray(y * n, y * n + n));
    fft1d(rowRe, rowIm);
    re.set(rowRe, y * n);
    im.set(rowIm, y * n);
  }
  const colRe = new Float32Array(n);
  const colIm = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      colRe[y] = re[y * n + x];
      colIm[y] = im[y * n + x];
    }
    fft1d(colRe, colIm);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = colRe[y];
      im[y * n + x] = colIm[y];
    }
  }
  const power = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return { power, n };
}

/** Radially averaged power spectrum, bins 1..n/2-1 (DC omitted). */
export function radialProfile(power: Float32Array, n: number): Float32Array {
  const bins = n / 2;
  const acc = new Float64Array(bins);
  const cnt = new Float64Array(bins);
  const half = n / 2;
  for (let y = 0; y < n; y++) {
    const fy = y <= half ? y : y - n;
    for (let x = 0; x < n; x++) {
      const fx = x <= half ? x : x - n;
      const r = Math.round(Math.sqrt(fx * fx + fy * fy));
      if (r > 0 && r < bins) {
        acc[r] += power[y * n + x];
        cnt[r]++;
      }
    }
  }
  const out = new Float32Array(bins);
  for (let r = 1; r < bins; r++) out[r] = cnt[r] ? acc[r] / cnt[r] : 0;
  return out;
}

/** Least-squares slope of log(power) vs log(r) over [rMin, rMax]. */
export function logLogSlope(profile: Float32Array, rMin: number, rMax: number): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const hi = Math.min(profile.length - 1, rMax);
  for (let r = Math.max(1, rMin); r <= hi; r++) {
    const p = profile[r];
    if (!(p > 0)) continue;
    const x = Math.log(r);
    const y = Math.log(p);
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < 4) return 0;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return 0;
  return (n * sxy - sx * sy) / denom;
}

/**
 * Amplitude of a series at period `period` px vs. neighbouring frequencies.
 * Returns prominence > 1 when there is a strong periodic structure
 * (e.g. an 8×8 JPEG block grid) at exactly that period.
 */
export function periodProminence(series: ArrayLike<number>, period: number): number {
  const n = series.length;
  if (n < period * 4) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) m += series[i];
  m /= n;
  const ampAt = (p: number) => {
    const f = 1 / p;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * f * i;
      re += (series[i] - m) * Math.cos(a);
      im -= (series[i] - m) * Math.sin(a);
    }
    return (2 / n) * Math.sqrt(re * re + im * im);
  };
  const target = ampAt(period);
  const floor = (ampAt(period - 1) + ampAt(period + 1) + ampAt(period - 2) + ampAt(period + 2)) / 4;
  const scale = Math.abs(m) + 1e-6;
  return (target / scale) / (floor / scale + 1e-6);
}

/** Per-tile statistics over a grid of `tile` px cells. */
export interface TileStats {
  cols: number;
  rows: number;
  sigma: Float32Array; // residual std per tile
  grad: Float32Array; // mean gradient per tile
  meanLuma: Float32Array;
}

export function tileStats(g: Gray, residual: Float32Array, grad: Float32Array, tile = 32): TileStats {
  const cols = Math.max(1, Math.floor(g.width / tile));
  const rows = Math.max(1, Math.floor(g.height / tile));
  const sigma = new Float32Array(cols * rows);
  const gr = new Float32Array(cols * rows);
  const lm = new Float32Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      let n = 0;
      let s = 0;
      let s2 = 0;
      let gs = 0;
      let ls = 0;
      for (let y = ty * tile; y < Math.min(g.height, (ty + 1) * tile); y++) {
        for (let x = tx * tile; x < Math.min(g.width, (tx + 1) * tile); x++) {
          const i = y * g.width + x;
          const v = residual[i];
          s += v;
          s2 += v * v;
          gs += grad[i];
          ls += g.data[i];
          n++;
        }
      }
      if (!n) continue;
      const idx = ty * cols + tx;
      const varr = s2 / n - (s / n) * (s / n);
      sigma[idx] = Math.sqrt(Math.max(0, varr));
      gr[idx] = gs / n;
      lm[idx] = ls / n;
    }
  }
  return { cols, rows, sigma, grad: gr, meanLuma: lm };
}
