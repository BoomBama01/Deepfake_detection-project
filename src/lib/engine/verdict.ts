/**
 * TruthLens engine — verdict decision.
 *
 * Deterministic: thresholds depend only on the sensitivity setting and the
 * measured checks. Four documented rules shape the combined score:
 *
 *  1. WEAK-AUTHENTICITY FLOOR — a check that simply *passes* only rules
 *     fakery out weakly (a measurement inside the natural range can also be
 *     forged to look natural). Passing checks contribute a mild authentic
 *     lean (0.30) instead of strong certainty.
 *  2. STRUCTURAL EVIDENCE — a direct, high-confidence signal (known
 *     generator signatures embedded in metadata) floors the score at 0.72,
 *     because such evidence does not need statistical corroboration.
 *  3. FLAG VETO — a check that actively fired (status "flag") can never be
 *     averaged away into "Real": the score is floored just above the
 *     decision midpoint (the AI side), and decisive face evidence (worst
 *     face measurement ≥ 0.80) floors at the synthetic threshold, yielding
 *     Likely deepfake.
 *  4. EVIDENCE QUALITY — when the file is heavily recompressed (JPEG ≤ 65)
 *     or blurred/resampled (p90 gradient < 95), absence of manipulation
 *     signals proves nothing, so the Real call is capped at 50% confidence
 *     and marked low-confidence instead of being reported as a firm pass.
 *  5. BINARY VERDICT — the verdict is always "Real" or an AI-side verdict
 *     (likely_ai / likely_deepfake); there is no third answer. Scores that
 *     land between the thresholds are resolved to the side of the midpoint
 *     and capped at 50% confidence. Uncertainty is carried by the
 *     confidence number (40–60% uncertain band), never by withholding a
 *     verdict.
 *
 * Confidence reflects distance from the decision boundary plus agreement
 * between checks, and is capped below 100 — no detector is perfect.
 */

import { clamp } from "./dsp";
import { combineChecks } from "./forensics";
import type { Check, Sensitivity, Verdict } from "./types";

export const OK_SCORE_FLOOR = 0.3;
export const STRUCTURAL_FLOOR = 0.72;
/** confidence range that is reported as "Uncertain" rather than a firm number */
export const UNCERTAIN_BAND = { lo: 40, hi: 60 } as const;

export const THRESHOLDS: Record<Sensitivity, { real: number; fake: number }> = {
  low: { real: 0.3, fake: 0.75 },
  balanced: { real: 0.38, fake: 0.62 },
  high: { real: 0.45, fake: 0.52 },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  real: "Real — no manipulation signals",
  /** legacy scans only — the engine no longer produces this verdict */
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
  /**
   * Evidence-quality assessment (measured sharpness + compression level).
   * When the evidence base is compromised the verdict may not be "Real":
   * absence of manipulation signals in a washed-out file proves nothing.
   */
  evidence?: { degraded: boolean; reasons: string[] };
}

export interface VerdictDecision {
  verdict: Verdict;
  confidence: number;
  /** combined score after floor/override rules — the number shown in the UI */
  score: number;
  /** confidence sits inside the 40–60% band: label is provisional */
  uncertainBand: boolean;
  explanation: string[];
}

export function decideVerdict(input: VerdictInput): VerdictDecision {
  return decideCore(input, THRESHOLDS[input.sensitivity], input.sensitivity);
}

/**
 * Decision core with explicit thresholds, exported so the calibration
 * script (scripts/calibrate.ts) can sweep (real, fake) pairs through the
 * *exact* production logic — including the flag-veto floors, which depend
 * on the thresholds themselves.
 */
export function decideCore(
  input: Omit<VerdictInput, "sensitivity">,
  t: { real: number; fake: number },
  label: string,
): VerdictDecision {
  const { checks, faceScore, kind } = input;
  const active = checks.filter((c) => c.weight > 0 && c.status !== "skip");

  const explanation: string[] = [];

  if (active.length < 3) {
    return {
      verdict: "error",
      confidence: 0,
      score: 0.5,
      uncertainBand: false,
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

  /* rule 3 — a flagged check vetoes "Real".
     Before this rule a single strong flag (e.g. face edge density 0.85) was
     averaged with a dozen passing checks and the file still came back
     "Real" with high confidence. Passing checks can never outweigh a
     measurement that actively fired. */
  const flags = active.filter((c) => c.status === "flag");
  let faceDecisive = false;
  if (flags.length > 0) {
    const faceFlag = flags.find((c) => c.group === "face");
    const decisiveFace = flags.find((c) => c.group === "face" && c.raw >= 0.8);
    if (decisiveFace) {
      faceDecisive = true;
      score = Math.max(score, t.fake);
      explanation.push(
        `Decisive face evidence: ${decisiveFace.finding} A face measurement at ${decisiveFace.raw.toFixed(2)} (≥ 0.80) is direct manipulation evidence, so the score is floored at the ${label} synthetic threshold (${t.fake.toFixed(2)}).`,
      );
    } else {
      const floor = (t.real + t.fake) / 2 + 0.01;
      score = Math.max(score, floor);
      if (faceFlag) {
        explanation.push(
          `Flagged face measurement: ${faceFlag.finding} The score is floored to ${floor.toFixed(2)} — the AI side of the decision midpoint — so the call becomes AI at low confidence rather than a pass.`,
        );
      } else {
        explanation.push(
          `Flagged measurement(s): ${flags.map((c) => c.label).join(", ")} — a check that actively fired vetoes a “Real” verdict, so the score is floored to the AI side of the midpoint at ${floor.toFixed(2)}.`,
        );
      }
    }
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

  /* binary resolution: every score resolves to Real or an AI-side verdict.
     Scores past either threshold are firm calls; scores inside the
     undecided middle resolve to the side of the midpoint and are marked
     low-confidence (rule 5). */
  const midpoint = (t.real + t.fake) / 2;
  const faceHeavy =
    faceDecisive ||
    (faceScore !== null && faceScore >= Math.min(t.fake + 0.02, score + 0.05));

  let verdict: Verdict;
  let lowConfidenceCall = false;
  if (score >= t.fake) {
    verdict = faceHeavy ? "likely_deepfake" : "likely_ai";
    explanation.push(
      `Combined synthetic-lean score ${score.toFixed(2)} is above the ${label} threshold of ${t.fake.toFixed(2)} for this run.`,
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
    if (input.evidence?.degraded) {
      verdict = "real";
      lowConfidenceCall = true;
      score = Math.max(score, t.real + 0.02);
      explanation.push(
        `Evidence degraded — ${input.evidence.reasons.join("; ")}. ` +
          "In these conditions ‘no manipulation signals found’ does not prove authenticity, so this is reported as a low-confidence Real call: confidence is capped at 50% — treat it as a lean, not a pass.",
      );
    } else {
      verdict = "real";
      explanation.push(
        `Combined synthetic-lean score ${score.toFixed(2)} is below the ${label} threshold of ${t.real.toFixed(2)}; active checks sit within ranges expected from camera-sourced media.`,
      );
    }
  } else {
    lowConfidenceCall = true;
    const side = score >= midpoint;
    verdict = side ? (faceHeavy ? "likely_deepfake" : "likely_ai") : "real";
    explanation.push(
      `Combined score ${score.toFixed(2)} falls between the authentic (${t.real.toFixed(2)}) and synthetic (${t.fake.toFixed(2)}) thresholds — it sits ${side ? "on the AI side" : "on the authentic side"} of the decision midpoint (${midpoint.toFixed(2)}), so the call is ${side ? "AI" : "Real"}, reported at low confidence (capped at 50%).`,
    );
    if (verdict === "likely_deepfake") {
      explanation.push(
        `Face-region measurements (mean ${(faceScore ?? 0).toFixed(2)}) are the strongest signal, so the manipulation is concentrated in the face — the pattern of a face swap or face reenactment.`,
      );
    }
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
  if (lowConfidenceCall) confidence = Math.min(confidence, 50);
  const rounded = Math.round(confidence * 10) / 10;
  const uncertainBand =
    rounded >= UNCERTAIN_BAND.lo && rounded <= UNCERTAIN_BAND.hi;
  if (uncertainBand) {
    explanation.push(
      `Confidence ${rounded}% sits inside the ${UNCERTAIN_BAND.lo}–${UNCERTAIN_BAND.hi}% uncertain band: the verdict above is a low-confidence lean, not a firm call.`,
    );
  }
  if (lowConfidenceCall && !uncertainBand) {
    explanation.push(
      `Confidence ${rounded}% is low: the verdict above is a lean forced by borderline or degraded evidence, not a firm call.`,
    );
  }
  return {
    verdict,
    confidence: rounded,
    score,
    uncertainBand,
    explanation,
  };
}
