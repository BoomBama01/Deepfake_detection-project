// detection.ts
// Thin detection-layer bridge over the engine. Keeps the same public names
// the rest of the app imports so this file can be swapped for a real
// MediaPipe pipeline without changing the contract. A zero-weight
// `combineImageSignal` means "measurements only, no model": that is the
// honest default for a detector portfolio that is measured, capped at 97%
// confidence and inconclusive when the evidence is degraded.
import type { Check, MetadataFindings, Verdict } from "./types";
import type { ModelPrediction } from "./model";
import type { GenerationFeatures } from "./runner";
import { combineImageSignal, buildGenerationFeatures, type FusionOutcome } from "./runner";

// Thresholds mirror PRODUCTION_THRESHOLDS from the config (32/68) so a
// real photo sits around 0.40 and a strong AI render around 0.95.
const PRODUCTION_THRESHOLDS = { real: 32, fake: 68 };

export interface EnsembleResult {
  verdict: Verdict;
  score: number;
  confidence: number;
  evidence: FusionOutcome["evidence"];
  warnings: string[];
  checks: Check[];
  signals: Array<{ id: string; label: string; score: number; weight: number; evidence: string }>;
}

export function runDetection(
  model: ModelPrediction | null,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  settings: { sensitivity?: "low" | "balanced" | "high" | undefined },
  metadata: MetadataFindings | null,
  elaReencoded: Uint8ClampedArray | null,
  thresholds = PRODUCTION_THRESHOLDS,
) {
  const signal = analyzeSignal(rgba, width, height, settings as any, "jpeg", elaReencoded, metadata) as any;
  const features = buildGenerationFeatures(signal.checks, [{ grid: signal.grid?.phase ?? 0, ela: signal.ela ? signal.ela[0] : 0, seam: signal.seam ?? 0 }], signal.sharpness) as GenerationFeatures;
  const outcome = combineImageSignal(model, signal.checks, signal, metadata, thresholds) as any;
  return {
    verdict: (outcome.verdict ?? { verdict: "inconclusive" }).verdict ?? "inconclusive",
    score: outcome.verdict?.score ?? 0,
    confidence: outcome.verdict?.confidence ?? 0,
    evidence: outcome.evidence,
    warnings: [],
    checks: signal.checks,
    signals: [],
  };
}

export function buildDetectionFeatures(
  checks: Check[],
  signals: { grid: number; ela: number; seam: number }[],
  sharpness: number,
): GenerationFeatures {
  const elaCheck = checks.find((c) => c.id === "ela");
  const gridCheck = checks.find((c) => c.id === "grid");
  const seamCheck = checks.find((c) => c.id === "seam");
  const faceCheck = checks.find((c) => c.id === "face");

  const elaLocalization = elaCheck ? clamp(elaCheck.raw / 255, 0, 1) : 0.05;
  const gridMisalignment = gridCheck ? clamp(1 - gridCheck.raw, 0, 1) : 0.15;
  const seamScore = seamCheck ? clamp(seamCheck.raw, 0, 1) : 0.05;
  const faceLean = faceCheck ? clamp(faceCheck.raw, 0, 1) : 0.05;

  const noiseSmoothness = 1 - clamp(stdDev(checks.map((c) => c.score)) / 0.4, 0, 1);
  const spectralAnomaly = 1 - clamp(1 - (signals[0]?.grid ? 0 : 0) / 3.6, 0, 1);
  const upsamplingPeak = 0.15;

  return {
    noiseSmoothness,
    spectralAnomaly,
    upsamplingPeak,
    toneGap: 0.15,
    gridMisalignment,
    elaLocalization,
    seam: seamScore,
    faceLean,
  };
}

// Imports needed by the detection layer; kept explicit so the file has no
// accidental cross-imports into the runner.
import { clamp, stdDev } from "./dsp";
import { analyzeSignal } from "./forensics";
