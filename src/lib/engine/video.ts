/**
 * TruthLens engine — video-specific temporal forensics.
 *
 * Given per-frame measurements (noise floor, luma, spectral slope, face
 * score), compute flicker, lighting-jump and face-jitter statistics, a
 * per-second manipulation timeline, and the combined video score.
 */

import { clamp, mean, median, ramp, stdDev } from "./dsp";
import { BANDS, WEIGHTS } from "./forensics";
import type { FrameResult, TemporalStats, TimelinePoint } from "./types";

export interface FrameInput {
  t: number;
  noise: number;
  luma: number;
  slope: number;
  peak: number;
  hfRatio: number;
  faceScore: number | null;
  faces: number;
}

/** Frame-level synthetic lean using the same bands as image analysis. */
export function frameLean(f: FrameInput): number {
  const sNoise = 1 - ramp(f.noise, BANDS.noiseSmooth.lo, BANDS.noiseSmooth.hi);
  const x = -f.slope;
  const sSpec = clamp(
    0.6 * ramp(x, BANDS.spectralSlope.steep, BANDS.spectralSlope.steep + 1.1) +
      0.4 * ramp(f.peak, BANDS.spectralPeak.lo, BANDS.spectralPeak.hi),
    0,
    1,
  );
  if (f.faceScore !== null) {
    return clamp(0.4 * sNoise + 0.25 * sSpec + 0.35 * f.faceScore, 0, 1);
  }
  return clamp(0.6 * sNoise + 0.4 * sSpec, 0, 1);
}

export function analyzeTemporal(
  frames: FrameInput[],
  faceJitter: number,
): { stats: TemporalStats; frameResults: FrameResult[] } {
  const results: FrameResult[] = frames.map((f, i) => ({
    index: i,
    t: f.t,
    score: frameLean(f),
    faceScore: f.faceScore,
    faces: f.faces,
    metrics: { noise: f.noise, luma: f.luma, freq: f.slope },
  }));

  let cuts = 0;
  let lightJumps = 0;
  const noiseDeltas: number[] = [];
  const medNoise = median(frames.map((f) => f.noise)) || 1;
  for (let i = 1; i < frames.length; i++) {
    const dl = Math.abs(frames[i].luma - frames[i - 1].luma);
    if (dl > 18) {
      cuts++; // scene change — excluded from flicker statistics
      continue;
    }
    if (dl > 7) lightJumps++;
    noiseDeltas.push(Math.abs(frames[i].noise - frames[i - 1].noise) / medNoise);
  }
  const flicker = noiseDeltas.length ? median(noiseDeltas) : 0;
  const scores = results.map((r) => r.score);
  const scoreCv = scores.length > 1 ? stdDev(scores) / (mean(scores) + 1e-6) : 0;
  const noFaceRatio = frames.length
    ? frames.filter((f) => f.faces === 0).length / frames.length
    : 1;

  return {
    stats: { flicker, scoreCv, lightJumps, cuts, faceJitter, noFaceRatio },
    frameResults: results,
  };
}

/**
 * Combined video score: weighted average of frame leans, plus a temporal
 * term — flickering noise, unstable face geometry and inconsistent lighting
 * are core deepfake signals.
 */
export function combineVideo(
  frameResults: FrameResult[],
  temporal: TemporalStats,
  hasFaces: boolean,
): number {
  if (!frameResults.length) return 0.5;
  const base = mean(frameResults.map((r) => r.score));

  const sFlicker = ramp(temporal.flicker, 0.06, 0.3);
  const sCv = ramp(temporal.scoreCv, 0.12, 0.38);
  const sJitter = hasFaces ? ramp(temporal.faceJitter, 0.04, 0.18) : 0;
  const sLights = ramp(temporal.lightJumps, 1, 6) * 0.5;
  const temporalLean = clamp(
    (hasFaces ? 0.35 * sFlicker + 0.3 * sCv + 0.25 * sJitter + 0.1 * sLights
      : 0.45 * sFlicker + 0.35 * sCv + 0.2 * sLights),
    0,
    1,
  );

  const temporalWeight = hasFaces ? 0.34 : 0.26;
  return clamp(base * (1 - temporalWeight) + temporalLean * temporalWeight, 0, 1);
}

/** Per-second timeline: highest frame score inside each whole second. */
export function buildTimeline(frameResults: FrameResult[], durationSec: number): TimelinePoint[] {
  if (!frameResults.length) return [];
  const seconds = Math.max(1, Math.min(Math.ceil(durationSec), 600));
  const buckets: number[] = new Array(seconds).fill(-1);
  for (const r of frameResults) {
    const s = clamp(Math.floor(r.t), 0, seconds - 1);
    buckets[s] = Math.max(buckets[s], r.score);
  }
  // carry forward gaps so the curve is continuous
  let last = 0.5;
  return buckets.map((v, i) => {
    if (v < 0) v = last;
    else last = v;
    return { t: i, score: Math.round(v * 1000) / 1000 };
  });
}

/** Weighted mean of per-face scores (larger faces count more). */
export function combineFaceScores(scores: Array<{ score: number; weight: number }>): number | null {
  if (!scores.length) return null;
  const w = scores.reduce((a, s) => a + s.weight, 0);
  if (w <= 0) return mean(scores.map((s) => s.score));
  return scores.reduce((a, s) => a + s.score * s.weight, 0) / w;
}

export { WEIGHTS };
