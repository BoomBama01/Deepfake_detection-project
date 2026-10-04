/**
 * TruthLens engine — verdict decision.
 *
 * Deterministic: thresholds depend only on the sensitivity setting and the
 * measured checks. Two documented rules shape the combined score:
 *
 *  1. WEAK-AUTHENTICITY FLOOR — a check that simply *passes* only rules
 *     fakery out weakly (a measurement inside the natural range can also be
 *     forged to look natural). Passing checks contribute a mild authentic
 *     lean (0.30) instead of strong certainty.
 *  2. STRUCTURAL EVIDENCE — a direct, high-confidence signal (known
 *     generator signatures embedded in metadata) floors the score at 0.72,
 *     because such evidence does not need statistical corroboration.
 *
 * Confidence reflects distance from the decision boundary plus agreement
 * between checks, and is capped below 100 — no detector is perfect.
 */

import { clamp } from "./dsp";
import { combineChecks } from "./forensics";
import type { Check, Sensitivity, Verdict } from "./types";

export const OK_SCORE_FLOOR = 0.3;
export const STRUCTURAL_FLOOR = 0.72;

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
  checks: Check[];
  /** mean face score when faces were analysed; null otherwise */
  faceScore: number | null;
  kind: "image" | "video";
  sensitivity: Sensitivity;
}

export interface VerdictDecision {
  verdict: Verdict;
  confidence: number;
  /** combined score after floor/override rules — the number shown in the UI */
  score: number;
  explanation: string[];
}

export function decideVerdict(input: VerdictInput): VerdictDecision {
  const { checks, faceScore, kind, sensitivity } = input;
  const t = THRESHOLDS[sensitivity];
  const active = checks.filter((c) => c.weight > 0 && c.status !== "skip");

  const explanation: string[] = [];

  if (active.length < 3) {
    return {
      verdict: "error",
      confidence: 0,
      score: 0.5,
      explanation: [
        "Too few checks completed to produce a verdict. The file may have failed to decode, or the enabled checks were skipped. No result is guessed — run the analysis again or try another file.",
      ],
    };
  }

  /* rule 1: passing checks lean authentic only weakly */
  const floored = active.map((c) =>
    c.status === "ok" ? { ...c, score: Math.max(c.score, OK_SCORE_FLOOR) } : c,
  );
  let score = combineChecks(floored);

  /* rule 2: direct structural evidence */
  const structural = active.find(
    (c) => c.group === "metadata" && c.status === "flag" && c.score >= 0.9,
  );
  if (structural) {
    score = Math.max(score, STRUCTURAL_FLOOR);
    explanation.push(
      `Direct evidence: ${structural.finding} Direct generator signatures override the statistical checks.`,
    );
  }

  /* confidence: distance from the boundary × agreement between checks */
  const wsum = floored.reduce((a, c) => a + c.weight, 0) || 1;
  const mu = floored.reduce((a, c) => a + c.score * c.weight, 0) / wsum;
  const disp = Math.sqrt(
    floored.reduce((a, c) => a + c.weight * (c.score - mu) ** 2, 0) / wsum,
  );
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
      `Combined synthetic-lean score ${score.toFixed(2)} is below the ${sensitivity} threshold of ${t.real.toFixed(2)}; active checks sit within ranges expected from camera-sourced media.`,
    );
  } else {
    verdict = "inconclusive";
    explanation.push(
      `Combined score ${score.toFixed(2)} falls between the authentic (${t.real.toFixed(2)}) and synthetic (${t.fake.toFixed(2)}) thresholds — the evidence does not clearly point either way.`,
    );
  }

  /* top contributing checks, quoted with their measured values */
  const ranked = [...floored]
    .sort((a, b) => Math.abs(b.weight * (b.score - 0.5)) - Math.abs(a.weight * (a.score - 0.5)))
    .slice(0, 3);
  for (const c of ranked) {
    if (structural && c.id === structural.id) continue;
    explanation.push(`${c.label}: ${c.finding}`);
  }

  explanation.push(
    `Checks agreed at ${(agreement * 100).toFixed(0)}% consistency across ${active.length} measurements.`,
  );

  confidence = clamp(confidence, 10, 97);
  return { verdict, confidence: Math.round(confidence * 10) / 10, score, explanation };
}
