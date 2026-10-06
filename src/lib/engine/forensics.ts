/**
 * TruthLens engine — signal-forensic checks.
 *
 * Each check returns a *measured* raw value, a lean score in [0,1] and a
 * finding that quotes the real numbers. Scoring constants live in `WEIGHTS`
 * / `BANDS` and are surfaced verbatim in the "Technical details" tab so
 * nothing about a verdict is hidden. If a check cannot run it is returned
 * with status "skip" and weight 0 — never with an invented value.
 */

import {
  type Gray,
  clamp,
  grayFromRgba,
  highPass,
  logLogSlope,
  mean,
  median,
  percentile,
  powerSpectrum,
  radialProfile,
  ramp,
  resizeGray,
  sobelMag,
  stdDev,
  tileStats,
} from "./dsp";
import { type MediaFormat } from "./metadata";
import type { AnalysisSettings, Check, FaceBox, FaceResult, MetadataFindings } from "./types";

/** Contribution weights of each check to the combined score. */
export const WEIGHTS = {
  noise: 0.2,
  spectrum: 0.18,
  ela: 0.16,
  metadata: 0.16,
  grid: 0.1,
  histogram: 0.1,
  seam: 0.1,
  face: 0.26,
} as const;

/** Calibration bands. Documented as heuristics in the Technical tab. */
export const BANDS = {
  /** flat-region residual σ below this ⇒ unnaturally smooth */
  noiseSmooth: { lo: 0.15, hi: 0.55 },
  /** very low σ uniformity across flat tiles ⇒ synthetic noise field */
  noiseUniform: { lo: 0.13, hi: 0.05 },
  /** very high uniformity variation ⇒ local edits / compositing */
  noiseSpread: { lo: 0.6, hi: 1.2 },
  /** max adjacent band-to-band noise jump ⇒ splice seam */
  noiseJump: { lo: 0.5, hi: 1.2 },
  /** fraction of rows showing a strong edge at one column ⇒ vertical seam */
  seamCoherence: { lo: 0.45, hi: 0.75 },
  /** radially-averaged power slope (-β) — natural images sit around 2.0–3.6 */
  spectralSlope: { steep: 3.5, shallow: 2.1 },
  /** upsampling/checkerboard peak prominence over local average */
  spectralPeak: { lo: 2.2, hi: 4.2 },
  /** p90/median of per-tile ELA energy — localized anomalies stand out */
  elaLocalized: { lo: 1.6, hi: 3.5 },
  /** mean ELA energy — near-zero means the re-encode barely changed anything */
  elaSmooth: { lo: 0.5, hi: 1.4 },
  /** 8px JPEG block-grid phase consistency across image bands */
  gridPhase: { lo: 0.35, hi: 0.8 },
  gridStrength: { lo: 1.1, hi: 2.2 },
  /** mid-tone histogram gaps after smoothing */
  histGaps: { lo: 3, hi: 10 },
  histRun: { lo: 5, hi: 25 },
  histClip: { lo: 0.05, hi: 0.2 },
  faceNoiseRatio: { lo: 0.95, hi: 0.55 },
  faceElaDeficit: { lo: 0.85, hi: 0.3 },
  faceRing: { lo: 0.6, hi: 2.0 },
} as const;

export const ENGINE_INFO = {
  name: "TruthLens Signal Forensics",
  version: "1.0.0",
} as const;

export interface SignalAnalysis {
  gray: Gray;
  checks: Check[];
  /** per-pixel ELA error (0..255-ish) or null when ELA is disabled/unavailable */
  ela: Float32Array | null;
  residual: Float32Array;
  tiles: ReturnType<typeof tileStats>;
  noise: { sigmaFlat: number; flatCv: number; coverage: number; jump: number };
  spectrum: { slope: number; hfRatio: number; peak: number };
  grid: { phase: number; strength: number } | null;
  histogram: { gaps: number; longestRun: number; clipHigh: number; clipLow: number };
  /** p90 tile gradient — global sharpness/detail level (evidence quality) */
  sharpness: number;
  metadata: MetadataFindings | null;
}

/**
 * Evidence-quality bands — when these say the evidence base is compromised,
 * the verdict layer must not claim "Real" (absence of signals in a washed-out
 * file means nothing). Bands measured on the bundled samples plus simulated
 * social-media transforms (scripts/measure-bands.ts):
 *   natural photos p90-grad 102–182 · blurred 33–90 · down/up-scaled 41–135
 *   platform recompression sits at QF 75–90; ≤ 65 is aggressive re-encoding.
 * Soft-but-authentic images therefore never come back as a *confident*
 * Real — the call stays on the measured side but is capped at 50%
 * confidence and flagged low-confidence: a hedge, never a false accusation.
 */
export const EVIDENCE = {
  /** JPEG quality at/below which quantization destroys HF forensics */
  heavyJpegQf: 65,
  /** p90 tile gradient below which blur/resampling has washed the evidence */
  minSharpness: 95,
} as const;

export interface EvidenceQuality {
  degraded: boolean;
  reasons: string[];
}

/** Measure whether the pixel evidence is still trustworthy. */
export function evidenceQuality(
  sharpness: number,
  metadata: MetadataFindings | null,
): EvidenceQuality {
  const reasons: string[] = [];
  const raw = metadata?.tags["EstimatedJpegQuality"];
  const qf = raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : null;
  if (qf !== null && qf <= EVIDENCE.heavyJpegQf) {
    reasons.push(
      `heavy recompression (JPEG quality ≈ ${qf} ≤ ${EVIDENCE.heavyJpegQf}) has discarded most high-frequency detail the checks rely on`,
    );
  }
  if (sharpness < EVIDENCE.minSharpness) {
    reasons.push(
      `low sharpness (p90 tile gradient ${sharpness.toFixed(0)} < ${EVIDENCE.minSharpness}) — the frame is blurred or resampled and fine-grained evidence is washed out`,
    );
  }
  return { degraded: reasons.length > 0, reasons };
}

/**
 * JPEG quality at which “no EXIF + no content credentials” stops being
 * routine web compression and starts looking like programmatic output:
 * cameras and social platforms re-encode at ≈75–90, generator pipelines and
 * high-quality saves write ≥93. Inference about provenance, not proof.
 */
export const PROVENANCE_MIN_QF = 96;

function qualityFrom(metadata: MetadataFindings | null): number | null {
  const raw = metadata?.tags["EstimatedJpegQuality"];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function check(partial: Omit<Check, "score" | "weight" | "status"> & Partial<Check>): Check {
  return {
    score: partial.score ?? 0.5,
    weight: partial.weight ?? 0,
    status: partial.status ?? "ok",
    ...partial,
  } as Check;
}

/* ------------------------------------------------------------------ */

function noiseCheck(g: Gray, tiles: ReturnType<typeof tileStats>): {
  check: Check;
  stats: { sigmaFlat: number; flatCv: number; coverage: number; jump: number };
} {
  const flatThresh = 8;
  const flatIdx: number[] = [];
  for (let i = 0; i < tiles.grad.length; i++) if (tiles.grad[i] < flatThresh) flatIdx.push(i);
  if (flatIdx.length < 4) {
    for (let i = 0; i < tiles.grad.length; i++)
      if (tiles.grad[i] < flatThresh * 2 && !flatIdx.includes(i)) flatIdx.push(i);
  }
  const sigmas = flatIdx.map((i) => tiles.sigma[i]);
  const coverage = tiles.grad.length ? flatIdx.length / tiles.grad.length : 0;
  let sigmaFlat = median(sigmas);
  if (flatIdx.length < 4) sigmaFlat = percentile(tiles.sigma, 25);
  const flatCv = sigmas.length > 2 ? stdDev(sigmas) / (mean(sigmas) + 1e-6) : 0;

  /* band-to-band noise-field discontinuity: a splice boundary shows up as a
     step between neighbouring vertical bands even when global CV is low. */
  const bandCount = Math.min(8, Math.max(2, tiles.cols));
  const bandW = tiles.cols / bandCount;
  const bandSigma: number[] = [];
  for (let b = 0; b < bandCount; b++) {
    const vals: number[] = [];
    for (let ty = 0; ty < tiles.rows; ty++) {
      for (let tx = Math.floor(b * bandW); tx < Math.floor((b + 1) * bandW); tx++) {
        const idx = ty * tiles.cols + tx;
        if (tiles.grad[idx] < flatThresh * 2) vals.push(tiles.sigma[idx]);
      }
    }
    if (vals.length >= 2) bandSigma.push(median(vals));
  }
  let jump = 0;
  if (bandSigma.length >= 2) {
    for (let i = 1; i < bandSigma.length; i++) {
      jump = Math.max(jump, Math.abs(bandSigma[i] - bandSigma[i - 1]) / (sigmaFlat + 1e-6));
    }
  }

  const sSmooth = 1 - ramp(sigmaFlat, BANDS.noiseSmooth.lo, BANDS.noiseSmooth.hi);
  const sLowSpread = ramp(
    BANDS.noiseUniform.lo - flatCv,
    0,
    BANDS.noiseUniform.lo - BANDS.noiseUniform.hi,
  );
  const sHighSpread = ramp(flatCv, BANDS.noiseSpread.lo, BANDS.noiseSpread.hi);
  const sSpread = Math.max(sLowSpread, sHighSpread);
  const sJump = ramp(jump, BANDS.noiseJump.lo, BANDS.noiseJump.hi);
  const score = clamp(0.45 * sSmooth + 0.3 * sSpread + 0.25 * sJump, 0, 1);
  const status: Check["status"] =
    flatIdx.length < 4 ? "skip" : score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";

  const finding =
    flatIdx.length < 4
      ? "Too few flat regions to measure a reliable noise floor; check skipped."
      : `Flat-region noise σ = ${sigmaFlat.toFixed(2)}, spread across flat tiles CV = ${flatCv.toFixed(2)}, ` +
        `largest band-to-band noise step = ${jump.toFixed(2)}× the floor. ` +
        (sJump > 0.5
          ? "The noise field steps sharply across the frame — a classic compositing/splice seam."
          : sSmooth > 0.5
            ? "Noise floor is below what a JPEG of camera-sourced content retains — consistent with heavy denoising or synthesis."
            : sSpread > 0.5
              ? "Noise is unusually even (or uneven) between flat regions — consistent with a synthetic or locally edited noise field."
              : "Noise floor, spread and band continuity sit within ranges expected from camera-sourced images.");

  return {
    check: check({
      id: "noise",
      label: "Noise residual (sensor grain)",
      group: "signal",
      raw: sigmaFlat,
      display: `σ ${sigmaFlat.toFixed(2)} · CV ${flatCv.toFixed(2)} · jump ${jump.toFixed(2)}`,
      score,
      weight: status === "skip" ? 0 : WEIGHTS.noise,
      status,
      finding,
    }),
    stats: { sigmaFlat, flatCv, coverage, jump },
  };
}

function spectrumCheck(g: Gray): { check: Check; stats: { slope: number; hfRatio: number; peak: number } } {
  if (g.width < 96 || g.height < 96) {
    return {
      check: check({
        id: "spectrum",
        label: "Frequency spectrum",
        group: "spectral",
        raw: 0,
        display: "skipped",
        status: "skip",
        finding: "Image too small for spectral analysis; check skipped.",
      }),
      stats: { slope: 0, hfRatio: 0, peak: 0 },
    };
  }
  const small = resizeGray(g, 256, 256);
  // mean-subtract to keep DC out of the fit
  const m = mean(small.data);
  for (let i = 0; i < small.data.length; i++) small.data[i] -= m;
  const { power, n } = powerSpectrum(small);
  const prof = radialProfile(power, n);
  const slope = logLogSlope(prof, 8, 96);

  let hf = 0;
  let tot = 0;
  for (let r = 1; r < prof.length; r++) {
    tot += prof[r];
    if (r >= 96) hf += prof[r];
  }
  const hfRatio = tot > 0 ? hf / tot : 0;

  // peak prominence vs. local moving average (upsampling/checkerboard artefacts)
  let peak = 0;
  const lo = 16;
  const hi = Math.min(112, prof.length - 6);
  for (let r = lo; r <= hi; r++) {
    let acc = 0;
    let cnt = 0;
    for (let k = -5; k <= 5; k++) {
      if (k === 0) continue;
      acc += prof[r + k];
      cnt++;
    }
    const local = acc / (cnt || 1);
    if (local > 0) peak = Math.max(peak, prof[r] / local);
  }

  const x = -slope; // natural images: power ~ r^-x with x ≈ 2–3.6
  const sSteep = ramp(x, BANDS.spectralSlope.steep, BANDS.spectralSlope.steep + 1.1);
  const sShallow = ramp(BANDS.spectralSlope.shallow - x, 0, 0.7);
  const sPeak = ramp(peak, BANDS.spectralPeak.lo, BANDS.spectralPeak.hi);
  const sHf = ramp(0.05 - hfRatio, 0, 0.04);
  const score = clamp(0.5 * Math.max(sSteep, sShallow) + 0.3 * sPeak + 0.2 * sHf, 0, 1);
  const status: Check["status"] = score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";

  const finding =
    `Radial power-spectrum slope β = ${slope.toFixed(2)} (natural camera images sit near −2.0 to −3.6), ` +
    `strongest periodic peak ×${peak.toFixed(1)} over its neighbourhood, high-frequency energy share = ${(hfRatio * 100).toFixed(1)}%. ` +
    (sSteep > 0.5
      ? "Spectrum rolls off far faster than natural imagery — a signature of smoothing/generative upsampling."
      : sShallow > 0.5
        ? "Spectrum is abnormally flat — synthetic high-frequency artefacts (checkerboard/upsampling) are likely."
        : sPeak > 0.5
          ? "A narrow spectral peak suggests periodic upsampling artefacts from a generative model."
          : "Spectral shape falls inside the band expected from natural images.");

  return {
    check: check({
      id: "spectrum",
      label: "Frequency spectrum (FFT)",
      group: "spectral",
      raw: slope,
      display: `β ${slope.toFixed(2)} · peak ×${peak.toFixed(1)}`,
      score,
      weight: WEIGHTS.spectrum,
      status,
      finding,
    }),
    stats: { slope, hfRatio, peak },
  };
}

/**
 * JPEG block-grid forensics: quantify how consistently the 8×8 quantisation
 * grid lines up across the image. Resizing, upscaling or splicing breaks the
 * alignment; untouched single-compression JPEGs keep it.
 */
function gridCheck(
  residual: Float32Array,
  w: number,
  h: number,
  format: MediaFormat,
): { check: Check; stats: { phase: number; strength: number } | null } {
  if (format !== "jpeg") {
    return {
      check: check({
        id: "grid",
        label: "JPEG block-grid alignment",
        group: "compression",
        raw: 0,
        display: format.toUpperCase(),
        status: "skip",
        weight: 0,
        finding: `No JPEG grid in a ${format.toUpperCase()} container — check not applicable.`,
      }),
      stats: null,
    };
  }
  const bands = 4;
  const bandW = Math.floor(w / bands);
  if (bandW < 64) {
    return {
      check: check({
        id: "grid",
        label: "JPEG block-grid alignment",
        group: "compression",
        raw: 0,
        display: "skipped",
        status: "skip",
        weight: 0,
        finding: "Image too narrow to analyse block-grid alignment.",
      }),
      stats: null,
    };
  }
  const amps: number[] = [];
  const re: number[] = [];
  const im: number[] = [];
  for (let b = 0; b < bands; b++) {
    const col = new Float64Array(bandW);
    let n = 0;
    for (let x = b * bandW; x < (b + 1) * bandW; x++) {
      let s = 0;
      for (let y = 0; y < h; y += 2) s += Math.abs(residual[y * w + x]);
      col[x - b * bandW] = s;
      n++;
    }
    let mu = 0;
    for (let i = 0; i < n; i++) mu += col[i];
    mu /= n;
    let ar = 0;
    let ai = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / 8;
      ar += (col[i] - mu) * Math.cos(a);
      ai -= (col[i] - mu) * Math.sin(a);
    }
    ar = (2 / n) * ar;
    ai = (2 / n) * ai;
    amps.push(Math.sqrt(ar * ar + ai * ai) / (Math.abs(mu) + 1e-6));
    re.push(ar);
    im.push(ai);
  }
  const total = amps.reduce((a, b2) => a + b2, 0) + 1e-9;
  let cr = 0;
  let ci = 0;
  for (let b = 0; b < bands; b++) {
    const norm = amps[b] / total;
    // phase consistency: unit phasors weighted by amplitude
    const phase = Math.atan2(im[b], re[b]);
    cr += norm * Math.cos(phase);
    ci += norm * Math.sin(phase);
  }
  const phase = Math.sqrt(cr * cr + ci * ci); // 1 = perfectly aligned bands
  const strength = mean(amps);

  // Without a detectable grid (the content was resampled, or it never was a
  // JPEG) alignment cannot be measured — skip instead of guessing.
  if (strength < BANDS.gridStrength.lo) {
    return {
      check: check({
        id: "grid",
        label: "JPEG block-grid alignment",
        group: "compression",
        raw: strength,
        display: `not detectable (×${strength.toFixed(2)})`,
        status: "skip",
        weight: 0,
        score: 0.5,
        finding:
          "No 8-px block grid is detectable (content was likely resized/resampled at some point), so grid alignment cannot be measured. Neutral — not evidence either way.",
      }),
      stats: { phase, strength },
    };
  }

  const sPhase = 1 - ramp(phase, BANDS.gridPhase.lo, BANDS.gridPhase.hi);
  const score = clamp(sPhase, 0, 1);
  const status: Check["status"] = score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";
  const finding =
    `8-px block-grid detected (modulation ×${strength.toFixed(2)}): cross-band phase consistency = ${phase.toFixed(2)}. ` +
    (score >= 0.65
      ? "A strong grid that disagrees between regions means parts of this image were resampled or composited over an aligned original."
      : score >= 0.4
        ? "Grid alignment is partially degraded — some resampling in the pipeline is likely."
        : "Block-grid aligns cleanly across the frame, as expected from a single-compression JPEG.");

  return {
    check: check({
      id: "grid",
      label: "JPEG block-grid alignment",
      group: "compression",
      raw: phase,
      display: `phase ${phase.toFixed(2)} · ×${strength.toFixed(2)}`,
      score,
      weight: WEIGHTS.grid,
      status,
      finding,
    }),
    stats: { phase, strength },
  };
}

function histogramCheck(g: Gray): { check: Check; stats: { gaps: number; longestRun: number; clipHigh: number; clipLow: number } } {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.data.length; i++) {
    const v = clamp(Math.round(g.data[i]), 0, 255);
    hist[v]++;
  }
  const total = g.data.length;
  let clipLow = 0;
  let clipHigh = 0;
  for (let v = 0; v <= 1; v++) clipLow += hist[v];
  for (let v = 254; v <= 255; v++) clipHigh += hist[v];
  clipLow /= total;
  clipHigh /= total;

  // smooth twice so single-bin noise doesn't masquerade as gaps
  let sm = Array.from(hist);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Array(256).fill(0);
    for (let v = 0; v < 256; v++) {
      const a = sm[Math.max(0, v - 1)];
      const b = sm[v];
      const c = sm[Math.min(255, v + 1)];
      next[v] = (a + 2 * b + c) / 4;
    }
    sm = next;
  }
  let gaps = 0;
  let run = 0;
  let longest = 0;
  for (let v = 12; v <= 244; v++) {
    if (sm[v] < 1e-9) {
      gaps++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  const sGaps = ramp(gaps, BANDS.histGaps.lo, BANDS.histGaps.hi);
  const sRun = ramp(longest, BANDS.histRun.lo, BANDS.histRun.hi);
  const sClip = ramp(clipHigh + clipLow, BANDS.histClip.lo, BANDS.histClip.hi);
  const score = clamp(0.55 * sGaps + 0.3 * sRun + 0.15 * sClip, 0, 1);
  const status: Check["status"] = score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";
  const finding =
    `Luminance histogram: ${gaps} empty mid-tone bins after smoothing (longest run ${longest}), clipping low/high = ` +
    `${(clipLow * 100).toFixed(1)}% / ${(clipHigh * 100).toFixed(1)}%. ` +
    (score >= 0.65
      ? "Gaps and clipping are characteristic of heavy level/curve edits or synthetic tone distributions."
      : score >= 0.4
        ? "Some histogram gaps suggest moderate post-processing."
        : "Tone distribution looks continuous, as expected from untouched captures.");

  return {
    check: check({
      id: "histogram",
      label: "Histogram continuity",
      group: "signal",
      raw: gaps,
      display: `${gaps} gaps · clip ${(clipHigh * 100).toFixed(1)}%`,
      score,
      weight: WEIGHTS.histogram,
      status,
      finding,
    }),
    stats: { gaps, longestRun: longest, clipHigh, clipLow },
  };
}

/**
 * Vertical-seam detector: a hard splice leaves a column where a large share
 * of rows show a strong edge at the same time — something natural imagery
 * almost never does.
 */
function seamCheck(g: Gray): Check {
  const { data, width: w, height: h } = g;
  if (w < 64 || h < 64) {
    return check({
      id: "seam",
      label: "Vertical seam continuity",
      group: "compression",
      raw: 0,
      display: "skipped",
      status: "skip",
      weight: 0,
      score: 0.5,
      finding: "Image too small for seam analysis.",
    });
  }
  /* Two-tier measurement: a hard splice survives recompression with a strong
     (Δ>28) step, but after a downscale/blur the boundary softens to Δ≈12–28.
     The loose tier uses a stricter *fraction* band so natural vertical
     structure (door frames, horizons) never reaches it — measured: natural
     images peak at 39–51% of rows at Δ>12, a resized splice still shows 72%. */
  const strongThresh = 28;
  const looseThresh = 12;
  let bestStrong = 0;
  let bestLoose = 0;
  let bestCol = -1;
  let bestLooseCol = -1;
  for (let x = 1; x < w - 1; x++) {
    let hitsStrong = 0;
    let hitsLoose = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      const d = Math.abs(data[i] - data[i - 1]);
      if (d > strongThresh) hitsStrong++;
      if (d > looseThresh) hitsLoose++;
    }
    const fracS = hitsStrong / h;
    const fracL = hitsLoose / h;
    if (fracS > bestStrong) {
      bestStrong = fracS;
      bestCol = x;
    }
    if (fracL > bestLoose) {
      bestLoose = fracL;
      bestLooseCol = x;
    }
  }
  const sStrong = ramp(bestStrong, BANDS.seamCoherence.lo, BANDS.seamCoherence.hi);
  const sLoose = ramp(bestLoose, 0.5, 0.8);
  const score = clamp(Math.max(sStrong, sLoose), 0, 1);
  const status: Check["status"] = score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";
  const finding =
    `Strongest vertical edge column at x=${bestCol} affects ${(bestStrong * 100).toFixed(0)}% of rows (Δ>28); ` +
    `softest-grade version at x=${bestLooseCol} affects ${(bestLoose * 100).toFixed(0)}% of rows (Δ>12). ` +
    (sStrong >= 0.5
      ? "A near-continuous vertical discontinuity across the frame is the signature of a hard splice or pasted half."
      : sLoose >= 0.5
        ? "The boundary is softer (consistent with a resized or recompressed splice) but still crosses most rows — spatial continuity is broken."
        : "No column-wise discontinuity — content is spatially continuous.");
  return check({
    id: "seam",
    label: "Vertical seam continuity",
    group: "compression",
    raw: Math.max(bestStrong, bestLoose),
    display: `${(bestStrong * 100).toFixed(0)}% rows @ x=${bestCol} · soft ${(bestLoose * 100).toFixed(0)}%`,
    score,
    weight: WEIGHTS.seam,
    status,
    finding,
  });
}

function elaCheck(
  g: Gray,
  ela: Float32Array,
  qf: number | null,
  format: MediaFormat,
): { check: Check } {
  const w = g.width;
  const h = g.height;
  const m = mean(ela);

  // tile-level distribution: localized anomalies lift the tail even when a
  // thin seam barely moves whole-image statistics
  const tile = 32;
  const cols = Math.max(1, Math.floor(w / tile));
  const rows = Math.max(1, Math.floor(h / tile));
  const tileMeans: number[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      let sum = 0;
      let n = 0;
      for (let y = ty * tile; y < Math.min(h, (ty + 1) * tile); y += 2) {
        for (let x = tx * tile; x < Math.min(w, (tx + 1) * tile); x += 2) {
          sum += ela[y * w + x];
          n++;
        }
      }
      if (n) tileMeans.push(sum / n);
    }
  }
  const ratio = percentile(tileMeans, 90) / (median(tileMeans) + 0.3);
  const sLocal = ramp(ratio, BANDS.elaLocalized.lo, BANDS.elaLocalized.hi);

  // Absolute mean error only means something for a high-quality original:
  // a heavily-compressed source barely changes when re-encoded.
  const qualityGate = format === "jpeg" && qf !== null && qf >= 85;
  const sSmooth = qualityGate
    ? ramp(BANDS.elaSmooth.hi - m, 0, BANDS.elaSmooth.hi - BANDS.elaSmooth.lo)
    : 0;
  const score = clamp(qualityGate ? 0.6 * sLocal + 0.4 * sSmooth : sLocal, 0, 1);
  const status: Check["status"] = score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";
  const finding =
    `Error Level Analysis (re-encode q=0.9): mean error = ${m.toFixed(2)}, tile concentration p90/median = ${ratio.toFixed(1)}; ` +
    `original quality ≈ ${qf ?? "unknown"}${qualityGate ? "" : " (absolute ELA level not evaluated below QF 85)"}. ` +
    (sLocal > 0.5
      ? "Error energy concentrates in a small set of regions — the classic ELA signature of a pasted, retouched or regenerated area."
      : sSmooth > 0.5
        ? "Re-encoding a high-quality original barely changes it anywhere — content is unnaturally uniform, as seen in smoothed or generated imagery."
        : "Error energy follows edges evenly, as expected from a consistently encoded photograph.");

  return {
    check: check({
      id: "ela",
      label: "Error Level Analysis",
      group: "compression",
      raw: m,
      display: `mean ${m.toFixed(2)} · tile ×${ratio.toFixed(1)}`,
      score,
      weight: WEIGHTS.ela,
      status,
      finding,
    }),
  };
}

export function metadataCheck(md: MetadataFindings): Check {
  const editor = /photoshop|gimp|lightroom|snapseed|facetune|picsart|canva|capcut|premiere|final cut/i;
  const qf = qualityFrom(md);
  let score = 0.5;
  let status: Check["status"] = "warn";
  let finding: string;

  if (md.aiSignatures.length > 0) {
    score = 0.97;
    status = "flag";
    finding = `Known generator/tool signatures found in metadata: ${md.aiSignatures.join(", ")}. This is direct evidence of AI tooling on this file.`;
  } else if (md.cameraMake || md.cameraModel) {
    score = 0.15;
    status = "ok";
    finding = `Camera EXIF present (${[md.cameraMake, md.cameraModel].filter(Boolean).join(" ")}${md.software ? `, software: ${md.software}` : ""}). Camera-origin metadata supports authenticity, though it can be forged.`;
  } else if (md.software && editor.test(md.software)) {
    score = 0.62;
    status = "warn";
    finding = `Edited with “${md.software}”. Editing is not fakery by itself, but the file is post-processed and re-encoded.`;
  } else if (md.c2pa) {
    score = 0.45;
    status = "warn";
    finding = "C2PA Content Credentials detected. Verify the signed claims at contentcredentials.org — presence alone neither proves nor disproves generation.";
  } else if (!md.hasExif && !md.c2pa && qf !== null && qf >= PROVENANCE_MIN_QF) {
    score = 0.68;
    status = "flag";
    finding =
      "JPEG quantization tables show near-lossless encoding while the file carries no EXIF and no content credentials. " +
      "Cameras and social platforms re-encode at much lower quality and keep provenance — a stripped, near-lossless JPEG is the " +
      "signature of a programmatic render or a saved generator output. This is provenance inference, not proof of generation.";
  } else if (!md.hasExif) {
    score = 0.55;
    status = "warn";
    finding = "No camera EXIF or content-credentials markers found. Consistent with edits, screenshots, web-resaved files or renders — weak evidence on its own.";
  } else {
    score = 0.45;
    status = "ok";
    finding = "Metadata is present with no known AI-tool markers.";
  }

  if (md.tags["EstimatedJpegQuality"]) {
    finding += ` Estimated JPEG quality ≈ ${md.tags["EstimatedJpegQuality"]}.`;
  }

  return check({
    id: "metadata",
    label: "Metadata & provenance (EXIF / C2PA)",
    group: "metadata",
    raw: md.aiSignatures.length,
    display:
      `${md.format}` +
      (md.hasExif ? " · EXIF" : " · no EXIF") +
      (md.c2pa ? " · C2PA" : "") +
      (md.aiSignatures.length ? ` · ${md.aiSignatures.length} AI marker(s)` : ""),
    score,
    weight: WEIGHTS.metadata,
    status,
    finding,
  });
}

/* ------------------------------------------------------------------ */
/* Face crops                                                          */
/* ------------------------------------------------------------------ */

function cropRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  box: FaceBox,
): { data: Uint8ClampedArray; width: number; height: number } {
  const x0 = clamp(Math.floor(box.x * w), 0, w - 1);
  const y0 = clamp(Math.floor(box.y * h), 0, h - 1);
  const cw = clamp(Math.floor(box.w * w), 1, w - x0);
  const ch = clamp(Math.floor(box.h * h), 1, h - y0);
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((y0 + y) * w + x0) * 4;
    out.set(rgba.subarray(src, src + cw * 4), y * cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

/**
 * Grow a detector box by `rel` on every side before cropping. BlazeFace
 * returns a *tight* face box, but the evidence lives just outside it: the
 * hairline, the jaw/neck edge and — for composites — the paste boundary.
 * Clamped so the expanded crop never leaves the frame.
 */
export function expandBox(box: FaceBox, rel = 0.2, cap = 0.05): FaceBox {
  const mx = Math.min(box.w * rel, cap);
  const my = Math.min(box.h * rel, cap);
  let x = box.x - mx;
  let y = box.y - my;
  let w = box.w + 2 * mx;
  let h = box.h + 2 * my;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

/**
 * True when the face box covers most of the frame (portrait/headshot).
 * Every face check in this engine is *relative to the frame* — when the
 * frame is the face, each ratio collapses to ≈1 and would always report
 * "consistent with the surroundings". Those checks are skipped instead of
 * silently returning a fake all-clear.
 */
export function isPortraitFrame(box: FaceBox): boolean {
  return box.w * box.h >= 0.45;
}

export interface FaceCheckResult {
  score: number;
  confidence: number;
  checks: Check[];
}

/**
 * Per-face manipulation signals: over-smoothed skin relative to the rest of
 * the frame, blending-boundary rings in the ELA map, and detail deficiency in
 * the face spectrum.
 */
export function analyzeFace(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  box: FaceBox,
  global: SignalAnalysis,
  ela: Float32Array | null,
): FaceCheckResult {
  /* Measurement crops use the *tight* detector box: face-vs-frame ratios
     (edge density, skin noise) must stay face-local — diluting them with
     margin background measurably weakens a real composite flag (edge density
     0.85 → 0.50 when measured on a 40%-larger crop). The margin matters for
     boundary context, so the ELA ring/level regions below use `ebox`. */
  const ebox = expandBox(box);
  const crop = cropRgba(rgba, w, h, box);
  const cg = grayFromRgba(crop.data, crop.width, crop.height);
  const checks: Check[] = [];

  /* Portrait frames: face-vs-frame would compare the face with itself. */
  if (isPortraitFrame(box)) {
    return {
      score: 0.5,
      confidence: 0,
      checks: [
        check({
          id: "face-applicability",
          label: "Face-vs-frame comparison",
          group: "face",
          raw: box.w * box.h,
          display: `${Math.round(box.w * box.h * 100)}% of frame`,
          score: 0.5,
          weight: 0,
          status: "skip",
          finding:
            "The face occupies most of this frame (portrait/headshot), so face-vs-frame measurements would compare the face with itself and always claim consistency. Skipped — whole-frame checks and metadata carry this result instead.",
        }),
      ],
    };
  }

  if (crop.width < 40 || crop.height < 40) {
    return {
      score: 0.5,
      confidence: 20,
      checks: [
        check({
          id: "face-resolution",
          label: "Face resolution",
          group: "face",
          raw: Math.min(crop.width, crop.height),
          display: `${crop.width}×${crop.height}px`,
          score: 0.5,
          weight: 0,
          status: "skip",
          finding: "Face region too small for reliable forensic measurements; this face is skipped and does not vote.",
        }),
      ],
    };
  }

  /* 1 — noise ratio vs. the whole frame */
  const cres = highPass(cg);
  const cgrad = sobelMag(cg);
  const ctiles = tileStats(cg, cres, cgrad, 16);
  const flat: number[] = [];
  for (let i = 0; i < ctiles.grad.length; i++) if (ctiles.grad[i] < 10) flat.push(i);
  const faceSigma = flat.length >= 3 ? median(flat.map((i) => ctiles.sigma[i])) : percentile(ctiles.sigma, 30);
  const sigmaRatio = faceSigma / (global.noise.sigmaFlat + 1e-6);
  const sNoise = ramp(BANDS.faceNoiseRatio.lo - sigmaRatio, 0, BANDS.faceNoiseRatio.lo - BANDS.faceNoiseRatio.hi);
  checks.push(
    check({
      id: "face-noise",
      label: "Face skin noise vs. frame",
      group: "face",
      raw: sigmaRatio,
      display: `${(sigmaRatio * 100).toFixed(0)}% of frame σ`,        score: clamp(sNoise, 0, 1),
        weight: 0.28,
      status: sNoise >= 0.65 ? "flag" : sNoise >= 0.4 ? "warn" : "ok",
      finding:
        `Face noise floor is ${(sigmaRatio * 100).toFixed(0)}% of the frame's (face σ = ${faceSigma.toFixed(2)}, frame σ = ${global.noise.sigmaFlat.toFixed(2)}). ` +
        (sNoise >= 0.5
          ? "The face is far smoother than its surroundings — typical of synthetic skin or aggressive retouching."
          : "Face and background grain levels are consistent with one another."),
    }),
  );

  /* 2 — ELA blending-boundary ring */
  if (ela) {
    const gw = global.gray.width;
    const gh = global.gray.height;
    const bx0 = clamp(Math.floor(ebox.x * gw), 0, gw - 1);
    const by0 = clamp(Math.floor(ebox.y * gh), 0, gh - 1);
    const bw = clamp(Math.floor(ebox.w * gw), 2, gw - bx0);
    const bh = clamp(Math.floor(ebox.h * gh), 2, gh - by0);
    let ringSum = 0;
    let ringN = 0;
    let inSum = 0;
    let inN = 0;
    const mx = Math.max(2, Math.floor(bw * 0.12));
    const my = Math.max(2, Math.floor(bh * 0.12));
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const v = ela[(by0 + y) * gw + (bx0 + x)];
        const onRing = x < mx || y < my || x >= bw - mx || y >= bh - my;
        if (onRing) {
          ringSum += v;
          ringN++;
        } else if (x >= bw * 0.3 && x < bw * 0.7 && y >= bh * 0.3 && y < bh * 0.7) {
          inSum += v;
          inN++;
        }
      }
    }
    const globalMean = mean(ela);
    const ringRel = ringSum / (ringN || 1) / (globalMean + 0.5);
    const inRel = inSum / (inN || 1) / (globalMean + 0.5);
    const delta = ringRel - inRel;
    const sRing = ramp(delta, BANDS.faceRing.lo, BANDS.faceRing.hi);
    checks.push(
      check({
        id: "face-ring",
        label: "Face blending boundary (ELA)",
        group: "face",
        raw: delta,
        display: `ring/interior +${delta.toFixed(2)}`,
        score: clamp(sRing, 0, 1),
        weight: 0.2,
        status: sRing >= 0.65 ? "flag" : sRing >= 0.4 ? "warn" : "ok",
        finding:
          `ELA energy on the face border is ${ringRel.toFixed(2)}× the global mean vs ${inRel.toFixed(2)}× in its interior (Δ = ${delta.toFixed(2)}). ` +
          (sRing >= 0.5
            ? "A bright border ring with a quiet interior is the signature of a blended-in face or mask."
            : "No blending-boundary ring detected around this face."),
      }),
    );
  } else {
    checks.push(
      check({
        id: "face-ring",
        label: "Face blending boundary (ELA)",
        group: "face",
        raw: 0,
        display: "skipped",
        score: 0.5,
        weight: 0,
        status: "skip",
        finding: "ELA disabled for this run — blending-boundary check skipped.",
      }),
    );
  }

  /* 2b — ELA level vs the whole frame: a region pasted in from another
     source/compression history re-encodes very differently from its host. */
  if (ela) {
    const gw = global.gray.width;
    const gh = global.gray.height;
    const bx0 = clamp(Math.floor(ebox.x * gw), 0, gw - 1);
    const by0 = clamp(Math.floor(ebox.y * gh), 0, gh - 1);
    const bw = clamp(Math.floor(ebox.w * gw), 2, gw - bx0);
    const bh = clamp(Math.floor(ebox.h * gh), 2, gh - by0);
    let sum = 0;
    let n = 0;
    for (let y = by0; y < by0 + bh; y += 2) {
      for (let x = bx0; x < bx0 + bw; x += 2) {
        sum += ela[y * gw + x];
        n++;
      }
    }
    const globalMean = mean(ela);
    const rel = n ? sum / n / (globalMean + 0.3) : 1;
    const sDeficit = ramp(BANDS.faceElaDeficit.lo - rel, 0, BANDS.faceElaDeficit.lo - BANDS.faceElaDeficit.hi);
    checks.push(
      check({
        id: "face-ela-level",
        label: "Face compression history (ELA level)",
        group: "face",
        raw: rel,
        display: `${(rel * 100).toFixed(0)}% of frame ELA`,
        score: clamp(sDeficit, 0, 1),
        weight: 0.2,
        status: sDeficit >= 0.65 ? "flag" : sDeficit >= 0.4 ? "warn" : "ok",
        finding:
          `The face region re-encodes at ${(rel * 100).toFixed(0)}% of the frame's mean ELA error. ` +
          (sDeficit >= 0.5
            ? "A large compression-history mismatch means this region almost certainly came from a different source image than its surroundings."
            : "Face and surroundings share a consistent compression history."),
      }),
    );
  } else {
    checks.push(
      check({
        id: "face-ela-level",
        label: "Face compression history (ELA level)",
        group: "face",
        raw: 0,
        display: "skipped",
        score: 0.5,
        weight: 0,
        status: "skip",
        finding: "ELA disabled for this run — compression-history check skipped.",
      }),
    );
  }

  /* 3 — spectral detail deficiency inside the face */
  if (crop.width >= 64 && crop.height >= 64) {
    const small = resizeGray(cg, 128, 128);
    const mm = mean(small.data);
    for (let i = 0; i < small.data.length; i++) small.data[i] -= mm;
    const { power, n } = powerSpectrum(small);
    const prof = radialProfile(power, n);
    const cSlope = logLogSlope(prof, 6, 48);
    const deltaSlope = global.spectrum.slope - cSlope; // >0 ⇒ face steeper (less detail)
    const sDetail = ramp(deltaSlope - 0.4, 0, 1.2);
    checks.push(
      check({
        id: "face-spectrum",
        label: "Face detail spectrum",
        group: "face",
        raw: cSlope,
        display: `Δβ ${deltaSlope.toFixed(2)}`,
        score: clamp(sDetail, 0, 1),
        weight: 0.12,
        status: sDetail >= 0.65 ? "flag" : sDetail >= 0.4 ? "warn" : "ok",
        finding:
          `Face spectral slope β = ${cSlope.toFixed(2)} vs frame β = ${global.spectrum.slope.toFixed(2)}. ` +
          (sDetail >= 0.5
            ? "The face carries markedly less fine detail than the rest of the frame — consistent with replacement or generation."
            : "Face detail density is consistent with the rest of the frame."),
      }),
    );
  } else {
    checks.push(
      check({
        id: "face-spectrum",
        label: "Face detail spectrum",
        group: "face",
        raw: 0,
        display: "skipped",
        score: 0.5,
        weight: 0,
        status: "skip",
        finding: "Face crop too small for spectral analysis; check skipped.",
      }),
    );
  }

  /* 4 — gradient energy ratio */
  const faceGrad = mean(cgrad);
  const frameGrad = mean(
    Array.from({ length: global.tiles.grad.length }, (_, i) => global.tiles.grad[i]),
  );
  const gradRatio = faceGrad / (frameGrad + 1e-6);
  const sGrad = 1 - ramp(gradRatio, 0.4, 0.95);
  checks.push(
    check({
      id: "face-gradient",
      label: "Face edge density",
      group: "face",
      raw: gradRatio,
      display: `${(gradRatio * 100).toFixed(0)}% of frame`,
      score: clamp(sGrad, 0, 1),
      weight: 0.2,
      status: sGrad >= 0.65 ? "flag" : sGrad >= 0.4 ? "warn" : "ok",
      finding:
        `Edge density inside the face is ${(gradRatio * 100).toFixed(0)}% of the frame average. ` +
        (sGrad >= 0.5
          ? "Unusually low edge density — over-smoothed or synthesised facial texture."
          : "Facial texture density looks natural relative to the scene."),
    }),
  );

  const active = checks.filter((c) => c.weight > 0);
  const wsum = active.reduce((a, c) => a + c.weight, 0) || 1;
  const score = clamp(active.reduce((a, c) => a + c.score * c.weight, 0) / wsum, 0, 1);
  const scores = active.map((c) => c.score);
  const agreement = 1 - clamp(stdDev(scores) * 2, 0, 1);
  const sizeFactor = ramp(Math.min(crop.width, crop.height), 40, 160);
  const confidence = clamp(100 * (0.3 + 0.4 * agreement + 0.3 * sizeFactor), 15, 95);

  return { score, confidence, checks };
}

export interface FaceAggregate {
  /** area-weighted mean over *measured* faces, or null when none measured */
  faceScore: number | null;
  /** the combined "face" check to feed the verdict, or null when absent */
  check: Check | null;
  /** whether measured faces cover > 0.35 of the frame (reweight applies) */
  dominant: boolean;
}

/**
 * Combine per-face results into the single face check the verdict uses.
 * Faces whose inner checks are all skipped (portrait frames where
 * face-vs-frame is self-referential, or crops too small to measure) do not
 * vote: previously they injected a neutral score that diluted real evidence
 * and could drag the combined score toward "Real".
 */
export function buildFaceAggregate(faces: FaceResult[]): FaceAggregate {
  const measured = faces.filter((f) =>
    f.checks.some((c) => c.weight > 0 && c.status !== "skip"),
  );
  if (measured.length === 0) {
    return { faceScore: null, check: null, dominant: false };
  }
  const area = (f: FaceResult) => f.box.w * f.box.h;
  const tot = measured.reduce((a, f) => a + area(f), 0) || 1;
  const faceScore = measured.reduce((a, f) => a + f.score * area(f), 0) / tot;
  /* Status must also honour the *worst* sub-check: a decisive flag (e.g. face
     edge density 0.85) used to be averaged with four passing sub-checks into
     a harmless-looking 0.36 and never reached the verdict. */
  const worst = Math.max(
    0,
    ...measured.flatMap((f) =>
      f.checks
        .filter((c) => c.weight > 0 && c.status !== "skip")
        .map((c) => c.score),
    ),
  );
  const worstCheck = measured
    .flatMap((f) => f.checks)
    .filter((c) => c.weight > 0 && c.status !== "skip")
    .reduce<Check | null>((best, c) => (!best || c.score > best.score ? c : best), null);
  /* Status honours the *worst* sub-check at the engine's standard flag level
     (≥0.65): a decisive flag (e.g. face edge density 0.75 after a resize)
     used to be averaged into a harmless 0.25 and never reached the verdict.
     `raw` carries the worst sub-score so the verdict layer can tier it. */
  const status: Check["status"] =
    faceScore >= 0.65 || worst >= 0.65
      ? "flag"
      : faceScore >= 0.4 || worst >= 0.4
        ? "warn"
        : "ok";
  const check: Check = {
    id: "face",
    label: "Face manipulation signal",
    group: "face",
    raw: worst,
    display:
      worst >= 0.65 && worst > faceScore
        ? `${(faceScore * 100).toFixed(0)}% mean · ${worstCheck?.label ?? "sub-check"} ${(worst * 100).toFixed(0)}%`
        : `${(faceScore * 100).toFixed(0)}% lean across ${measured.length} face(s)`,
    score: faceScore,
    weight: WEIGHTS.face,
    status,
    finding:
      `Weighted across ${measured.length} measured face(s), face-level measurements lean ` +
      `${(faceScore * 100).toFixed(0)}% toward manipulation (per-face detail is in the Faces section). ` +
      (worst >= 0.4
        ? `Strongest single measurement: ${worstCheck?.label ?? "a face check"} at ${(worst * 100).toFixed(0)}%${
            worst >= 0.8 ? " — decisive evidence of face manipulation." : "."
          }`
        : "Face-level measurements sit inside expected ranges.") +
      (measured.length < faces.length
        ? ` ${faces.length - measured.length} detected face(s) were skipped (portrait frame or crop too small) and do not vote.`
        : ""),
  };
  return {
    faceScore,
    check,
    dominant: measured.reduce((a, f) => a + area(f), 0) > 0.35,
  };
}

/* ------------------------------------------------------------------ */
/* Full image signal analysis                                          */
/* ------------------------------------------------------------------ */

export function analyzeSignal(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  settings: AnalysisSettings,
  format: MediaFormat,
  elaReencoded: Uint8ClampedArray | Uint8Array | null,
  metadata: MetadataFindings | null,
): SignalAnalysis {
  const gray = grayFromRgba(rgba, width, height);
  const residual = highPass(gray);
  const grad = sobelMag(gray);
  const tiles = tileStats(gray, residual, grad, 32);
  const sharpness = percentile(tiles.grad, 90);

  const checks: Check[] = [];

  const n = noiseCheck(gray, tiles);
  checks.push(n.check);

  const s = spectrumCheck(gray);
  checks.push(s.check);

  const g = gridCheck(residual, width, height, format);
  checks.push(g.check);

  checks.push(seamCheck(gray));

  const hist = histogramCheck(gray);
  checks.push(hist.check);

  let ela: Float32Array | null = null;
  if (elaReencoded) {
    ela = new Float32Array(width * height);
    // max absolute channel difference between original and re-encoded pixels
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
      const dr = Math.abs(rgba[p] - elaReencoded[p]);
      const dg = Math.abs(rgba[p + 1] - elaReencoded[p + 1]);
      const db = Math.abs(rgba[p + 2] - elaReencoded[p + 2]);
      ela[i] = Math.max(dr, dg, db);
    }
    checks.push(elaCheck(gray, ela, qualityFrom(metadata), format).check);
  } else if (settings.enableEla) {
    checks.push(
      check({
        id: "ela",
        label: "Error Level Analysis",
        group: "compression",
        raw: 0,
        display: "unavailable",
        status: "skip",
        weight: 0,
        score: 0.5,
        finding: "Re-encode unavailable in this environment — ELA skipped (not estimated).",
      }),
    );
  }

  if (metadata) checks.push(metadataCheck(metadata));

  return {
    gray,
    checks,
    ela,
    residual,
    tiles,
    noise: n.stats,
    spectrum: s.stats,
    grid: g.stats,
    histogram: hist.stats,
    sharpness,
    metadata,
  };
}

/** Weighted combination of all active checks (0..1 synthetic-leaning). */
export function combineChecks(checks: Check[]): number {
  const active = checks.filter((c) => c.weight > 0 && c.status !== "skip");
  const wsum = active.reduce((a, c) => a + c.weight, 0);
  if (wsum <= 0) return 0.5;
  return clamp(active.reduce((a, c) => a + c.score * c.weight, 0) / wsum, 0, 1);
}

// EVIDENCE gains a runtime `degraded` flag so detection-layer code can read
// it without touching the immutable band limits. The band limits themselves
// stay `as const`; this member is computed-only and never serialised.
export const EVIDENCE_STATE = {
  heavyJpegQf: EVIDENCE.heavyJpegQf,
  minSharpness: EVIDENCE.minSharpness,
  degraded: false,
} as const;
