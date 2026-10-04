/**
 * TruthLens engine — verdict decision.
 *
 * Deterministic: thresholds depend only on the sensitivity setting and the
 * measured combined score. Confidence reflects how far the score sits from the
 * decision boundary plus how much the individual checks agree — it is capped
 * below 100 because no detector is perfect.
 */

import { clamp, mean, stdDev } from "./dsp";
import type { Check, Sensitivity, Verdict } from "./types";

export const THRESHOLDS: Record<Sensitivity, { real: number; fake: number }> = {
  low: { real: 0.3, fake: 0.75 },
  balanced: { real: 0.38, fake: 0.62 },
  high: { real: 0.45, fake: 0.52 },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  real: "Real — no manipulation signals",
  inconclusive: "Inconclusive",
  likely_ai: "Likely AI-generated",
  likely_deepfake: "Likely deepfake (manipulated face)",
  error: "Analysis failed",
};

export interface VerdictInput {
  score: number;
  checks: Check[];
  /** mean face score when faces were analysed; null otherwise */
  faceScore: number | null;
  kind: "image" | "video";
  sensitivity: Sensitivity;
}

export interface VerdictDecision {
  verdict: Verdict;
  confidence: number;
  explanation: string[];
}

export function decideVerdict(input: VerdictInput): VerdictDecision {
  const { score, checks, faceScore, kind, sensitivity } = input;
  const t = THRESHOLDS[sensitivity];
  const active = checks.filter((c) => c.weight > 0 && c.status !== "skip");

  const explanation: string[] = [];

  if (active.length < 3) {
    return {
      verdict: "error",
      confidence: 0,
      explanation: [
        "Too few checks completed to produce a verdict. The file may have failed to decode, or the enabled checks were skipped. No result is guessed — run the analysis again or try another file.",
      ],
    };
  }

  /* confidence: distance from the boundary × agreement between checks */
  const wsum = active.reduce((a, c) => a + c.weight, 0) || 1;
  const mu = active.reduce((a, c) => a + c.score * c.weight, 0) / wsum;
  const disp = Math.sqrt(active.reduce((a, c) => a + c.weight * (c.score - mu) ** 2, 0) / wsum);
  const agreement = clamp(1 - 2 * disp, 0, 1);
  const distance = clamp(Math.abs(score - 0.5) * 2, 0, 1);
  const coverage = clamp(active.length / 5, 0, 1);
  let confidence = 100 * (0.22 + 0.43 * distance + 0.35 * agreement) * (0.72 + 0.28 * coverage);

  let verdict: Verdict;
  if (score >= t.fake) {
    const faceHeavy = faceScore !== null && faceScore >= Math.min(t.fake + 0.02, score + 0.05);
    verdict = faceHeavy ? "likely_deepfake" : "likely_ai";
    explanation.push(
      `Combined synthetic-lean score ${score.toFixed(2)} is above the ${sensitivity} threshold of ${t.fake.toFixed(2)} for this run.`,
    );
    if (verdict === "likely_deepfake") {
      explanation.push(
        `Face-region measurements (mean ${(faceScore ?? 0).toFixed(2)}) are the strongest signal, so the manipulation is concentrated in the face rather than the whole frame — the pattern of a face swap or face reenactment.`,
      );
    } else {
      explanation.push(
        `Whole-frame measurements dominate: ${kind === "video" ? "frame statistics" : "image statistics"} behave like synthesised content rather than an optically captured scene.`,
      );
    }
  } else if (score <= t.real) {
    verdict = "real";
    explanation.push(
      `Combined synthetic-lean score ${score.toFixed(2)} is below the ${sensitivity} threshold of ${t.real.toFixed(2)}; every active check sits within ranges expected from camera-sourced media.`,
    );
  } else {
    verdict = "inconclusive";
    explanation.push(
      `Combined score ${score.toFixed(2)} falls between the authentic (${t.real.toFixed(2)}) and synthetic (${t.fake.toFixed(2)}) thresholds — the evidence does not clearly point either way.`,
    );
  }

  /* top contributing checks, quoted with their measured values */
  const ranked = [...active]
    .sort((a, b) => Math.abs(b.weight * (b.score - 0.5)) - Math.abs(a.weight * (a.score - 0.5)))
    .slice(0, 3);
  for (const c of ranked) {
    explanation.push(`${c.label}: ${c.finding}`);
  }

  explanation.push(
    `Checks agreed at ${(agreement * 100).toFixed(0)}% consistency across ${active.length} measurements.`,
  );

  confidence = clamp(confidence, 10, 97);
  return { verdict, confidence: Math.round(confidence * 10) / 10, explanation };
}

/** Mean of check scores, used for quick aggregates (video frames etc.). */
export function averageScore(scores: number[]): number {
  return scores.length ? mean(scores) : 0.5;
}

export function dispersion(scores: number[]): number {
  return scores.length ? stdDev(scores) : 0;
}
