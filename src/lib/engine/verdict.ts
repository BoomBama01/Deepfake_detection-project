/**
 * TruthLens engine — verdict decision.
 *
 * DETERMINISTIC: the verdict depends only on the sensitivity setting and the
 * measured checks. Nothing here is random, and no raw model probability is ever
 * presented as truth.
 *
 * THREE OUTCOMES, NEVER TWO:
 *
 *   LIKELY AUTHENTIC          the measurements sit inside the ranges expected
 *                             from camera-sourced media, and the evidence base
 *                             is good enough to say so.
 *   LIKELY AI-GENERATED or    multiple independent families of evidence lean
 *   MANIPULATED               synthetic/manipulated, and they corroborate.
 *   INCONCLUSIVE              the evidence is weak, degraded, or the detectors
 *                             disagree. Reported as its own outcome — never as a
 *                             confident REAL or a confident FAKE.
 *
 * Six documented rules shape the combined score:
 *
 *  1. WEAK-AUTHENTICITY FLOOR — a check that merely *passes* only rules fakery
 *     out weakly, because a measurement inside the natural range can also be
 *     forged to look natural. Passing checks contribute a mild authentic lean
 *     (0.30) rather than strong certainty.
 *  2. STRUCTURAL EVIDENCE — a direct, high-confidence signal (known generator
 *     signatures embedded in the file) floors the score at 0.72, because such
 *     evidence does not need statistical corroboration.
 *  3. FLAG VETO — a check that actively fired (status "flag") can never be
 *     averaged away into a pass. The score is floored onto the AI side of the
 *     decision midpoint, and decisive face evidence (worst face measurement
 *     ≥ 0.80) floors at the synthetic threshold, yielding Likely deepfake.
 *  4. EVIDENCE QUALITY — when the file is heavily recompressed (JPEG ≤ 65) or
 *     blurred/resampled (p90 gradient < 95), the *absence* of manipulation
 *     signals proves nothing, so the run returns INCONCLUSIVE rather than a
 *     hedged "Real".
 *  5. DETECTOR DISAGREEMENT — when the weighted dispersion of the active
 *     measurements is large, the detectors contradict each other and the run
 *     returns INCONCLUSIVE.
 *  6. SCORE BETWEEN THRESHOLDS — a score landing between the authentic and
 *     synthetic thresholds is genuinely undecided and returns INCONCLUSIVE.
 *     This is the third outcome; it is not resolved by picking a side.
 *
 * Confidence reflects distance from the decision boundary, agreement between
 * checks and how many checks actually ran. It is capped at 97% — no detector
 * is perfect, and the product never claims 100% certainty anywhere.
 */

import { clamp } from "./dsp";
import { combineChecks } from "./forensics";
import type { Check, Sensitivity, Verdict } from "./types";

export const OK_SCORE_FLOOR = 0.3;
export const STRUCTURAL_FLOOR = 0.72;
/** confidence band that is drawn as "uncertain" in the UI */
export const UNCERTAIN_BAND = { lo: 40, hi: 60 } as const;
/** no detector is perfect — confidence is never allowed to reach this */
export const CONFIDENCE_CAP = 97;

/**
 * Weighted dispersion above which the active measurements are considered to
 * contradict each other (0..1). Measured on the labelled samples: the largest
 * dispersion observed among correct real calls is 0.16, and among correct
 * AI calls 0.22 — so 0.34 sits above both while still catching genuinely
 * contradictory runs (scripts/engine-check.ts prints the dispersion).
 */
export const DISAGREEMENT_LIMIT = 0.34;

/**
 * Decision thresholds per sensitivity.
 *
 * These are NOT hand-picked magic numbers: `scripts/calibrate.ts` sweeps
 * candidate (real, fake) pairs through this exact decision core — including the
 * flag-veto floors, which depend on the thresholds themselves — and reports
 * accuracy, precision, recall, F1, ROC-AUC and the false-negative rate. A
 * candidate is only adopted when the labelled validation set is large enough to
 * support it; with the bundled sample set the script measures and reports but
 * explicitly refuses to adopt, because a threshold tuned on n=6 would be
 * overfitting rather than calibration. See README → "Calibration".
 */
export const THRESHOLDS: Record<Sensitivity, { real: number; fake: number }> = {
  low: { real: 0.3, fake: 0.75 },
  balanced: { real: 0.38, fake: 0.62 },
  high: { real: 0.45, fake: 0.52 },
};

/** Provenance of the thresholds above, surfaced in the developer dashboard. */
export const CALIBRATION = {
  method: "threshold sweep through the production decision core",
  metric: "ROC-AUC, accuracy, precision, recall, F1, FNR",
  separatedBy: "dataset", // never a random split of near-duplicates
  minSamplesForAdoption: 200,
  adopted: false,
  note:
    "Current thresholds are the conservative defaults. The calibration harness measures them on every run but refuses to adopt a swept pair until the labelled set reaches " +
    "200 samples, because tuning on a handful of near-duplicate images would fit the sample rather than the problem.",
} as const;

export const VERDICT_LABEL: Record<Verdict, string> = {
  real: "Likely authentic",
  inconclusive: "Inconclusive",
  likely_ai: "Likely AI-generated or manipulated",
  likely_deepfake: "Likely deepfake (manipulated face)",
  error: "Analysis unavailable",
};

/** The three-outcome summary the report leads with. */
export const OUTCOME_LABEL: Record<string, string> = {
  authentic: "LIKELY AUTHENTIC",
  synthetic: "LIKELY AI-GENERATED or MANIPULATED",
  inconclusive: "INCONCLUSIVE",
  error: "ANALYSIS UNAVAILABLE",
};

export interface VerdictInput {
  checks: Check[];
  /** mean face score when faces were analysed; null otherwise */
  faceScore: number | null;
  kind: "image" | "video";
  sensitivity: Sensitivity;
  /**
   * Evidence-quality assessment (measured sharpness + compression level).
   * When the evidence base is compromised the verdict may not be "Likely
   * authentic": absence of manipulation signals in a washed-out file proves
   * nothing, so the run returns INCONCLUSIVE.
   */
  evidence?: { degraded: boolean; reasons: string[] };
  /**
   * 0..1 evidence strength from the detector-fusion layer — how many
   * independent evidence families actually produced a weighted measurement.
   * When this is low the verdict is downgraded to INCONCLUSIVE.
   */
  evidenceStrength?: number;
}

export interface VerdictDecision {
  verdict: Verdict;
  /** which of the three outcomes this maps to (or "error") */
  outcome: "authentic" | "synthetic" | "inconclusive" | "error";
  confidence: number;
  /** combined score after the floor/override rules — the number shown in the UI */
  score: number;
  /** 0..100 — how close this call sits to a decision boundary */
  uncertainty: number;
  /** 0..1 — how much independent, measured evidence stood behind the call */
  evidenceStrength: number;
  /** confidence sits inside the 40–60% band: label is provisional */
  uncertainBand: boolean;
  /** why the run is inconclusive; null when the call is firm */
  inconclusiveReason: string | null;
  explanation: string[];
}

export function decideVerdict(input: VerdictInput): VerdictDecision {
  return decideCore(input, THRESHOLDS[input.sensitivity], input.sensitivity);
}

/**
 * Decision core with explicit thresholds, exported so the calibration script
 * (scripts/calibrate.ts) can sweep (real, fake) pairs through the *exact*
 * production logic — including the flag-veto floors, which depend on the
 * thresholds themselves.
 */
export function decideCore(
  input: Omit<VerdictInput, "sensitivity">,
  t: { real: number; fake: number },
  label: string,
): VerdictDecision {
  const { checks, faceScore, kind } = input;
  const active = checks.filter((c) => c.weight > 0 && c.status !== "skip");
  const explanation: string[] = [];

  /* Nothing measurable ran → analysis unavailable, never a guess. */
  if (active.length < 3) {
    return {
      verdict: "error",
      outcome: "error",
      confidence: 0,
      score: 0.5,
      uncertainty: 100,
      evidenceStrength: 0,
      uncertainBand: false,
      inconclusiveReason:
        "Too few independent measurements completed to support any verdict. No result was guessed.",
      explanation: [
        "Analysis unavailable — too few checks completed to produce a verdict. The file may have failed to decode, or the enabled checks were all skipped. No result is guessed: run the analysis again, or try a different file.",
      ],
    };
  }

  /* rule 1: passing checks lean authentic only weakly */
  const floored = active.map((c) =>
    c.status === "ok" ? { ...c, score: Math.max(c.score, OK_SCORE_FLOOR) } : c,
  );
  let score = combineChecks(floored);

  /* rule 2: direct structural evidence (a generator signature in the file) */
  const structural = active.find(
    (c) => c.group === "metadata" && c.status === "flag" && c.score >= 0.9,
  );
  if (structural) {
    score = Math.max(score, STRUCTURAL_FLOOR);
    explanation.push(
      `Direct evidence: ${structural.finding} A generator signature embedded in the file does not need statistical corroboration.`,
    );
  }

  /* rule 3 — a flagged check vetoes a clean pass.
     Before this rule a single strong flag (e.g. face edge density 0.85) was
     averaged with a dozen passing checks and an AI-generated image still came
     back "Real" with high confidence. Passing checks can never outweigh a
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
      explanation.push(
        faceFlag
          ? `Flagged face measurement: ${faceFlag.finding} The score is floored to ${floor.toFixed(2)} — the AI side of the decision midpoint — so this cannot be reported as a clean pass.`
          : `Flagged measurement(s): ${flags.map((c) => c.label).join(", ")} — a check that actively fired vetoes a "Likely authentic" verdict, so the score is floored to the AI side of the midpoint at ${floor.toFixed(2)}.`,
      );
    }
  }

  /* confidence ingredients: boundary distance × agreement × coverage */
  const wsum = floored.reduce((a, c) => a + c.weight, 0) || 1;
  const mu = floored.reduce((a, c) => a + c.score * c.weight, 0) / wsum;
  const dispersion = Math.sqrt(
    floored.reduce((a, c) => a + c.weight * (c.score - mu) ** 2, 0) / wsum,
  );
  const agreement = clamp(1 - 2 * dispersion, 0, 1);
  const coverage = clamp(active.length / 5, 0, 1);
  const bandHalfWidth = Math.max(1e-6, (t.fake - t.real) / 2);
  const nearestBoundary = Math.min(Math.abs(score - t.real), Math.abs(score - t.fake));

  /* Distance is measured from the boundary the verdict was decided ON, not
     from the midpoint. Measuring from the midpoint was a real bug: a score of
     exactly 0.38 (== t.real) sat at maximum "distance" and was reported at
     93% confidence, when it is in fact sitting precisely on the decision
     boundary and is the least certain call the engine can make. */
  let distance = clamp(nearestBoundary / bandHalfWidth, 0, 1);

  /* Decisive face evidence justifies confidence of its own, because the face
     measurement — not the fused average — is what decided this call. Without
     this floor a decisive composite would be downgraded to low confidence
     merely for landing exactly on the threshold. */
  if (faceDecisive) {
    const decisiveFace = active.find((c) => c.group === "face" && c.raw >= 0.8);
    if (decisiveFace) {
      distance = Math.max(distance, clamp((decisiveFace.raw - 0.8) / 0.2, 0, 1));
    }
  }

  const evidenceStrength =
    input.evidenceStrength !== undefined
      ? clamp(input.evidenceStrength, 0, 1)
      : clamp(0.5 * coverage + 0.5 * agreement, 0, 1);

  let confidence =
    100 * (0.22 + 0.43 * distance + 0.35 * agreement) * (0.72 + 0.28 * coverage);

  /* how close is the score to *either* boundary? 100 = sitting on one. */
  const uncertainty = clamp(100 * (1 - nearestBoundary / bandHalfWidth), 0, 100);

  /* --------------------------------------------------------------- */
  /* Three-way resolution                                           */
  /* --------------------------------------------------------------- */
  const faceHeavy =
    faceDecisive ||
    (faceScore !== null && faceScore >= Math.min(t.fake + 0.02, score + 0.05));

  let verdict: Verdict;
  let outcome: VerdictDecision["outcome"];
  let inconclusiveReason: string | null = null;
  let lowConfidenceCall = false;

  const inInconclusiveRange = score > t.real && score < t.fake;

  if (inInconclusiveRange) {
    /* rule 6 — the score is genuinely undecided */
    verdict = "inconclusive";
    outcome = "inconclusive";
    lowConfidenceCall = true;
    inconclusiveReason =
      `The combined score (${score.toFixed(2)}) falls between the authentic (${t.real.toFixed(2)}) and synthetic (${t.fake.toFixed(2)}) thresholds for ${label} sensitivity — the evidence does not point clearly either way.`;
    explanation.push(
      `${inconclusiveReason} Reporting INCONCLUSIVE rather than picking the nearer side: a confident-looking verdict built on a borderline score is the failure mode this engine exists to avoid.`,
    );
  } else if (score >= t.fake) {
    verdict = faceHeavy ? "likely_deepfake" : "likely_ai";
    outcome = "synthetic";
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
    /* a synthetic call resting on almost no independent evidence is not a
       call at all — downgrade rather than accuse on one weak signal */
    if (evidenceStrength < 0.3 && !structural) {
      verdict = "inconclusive";
      outcome = "inconclusive";
      inconclusiveReason = `Only a thin evidence base supported this score (evidence strength ${(evidenceStrength * 100).toFixed(0)}%), with no direct generator signature in the file.`;
      explanation.push(
        `${inconclusiveReason} One lean measurement on its own cannot support an accusation, so the result is INCONCLUSIVE.`,
      );
    }
  } else {
    /* score <= t.real — candidate "Likely authentic" */
    if (input.evidence?.degraded) {
      /* rule 4 — the evidence base is compromised */
      verdict = "inconclusive";
      outcome = "inconclusive";
      inconclusiveReason =
        `The evidence base is degraded — ${input.evidence.reasons.join("; ")}. ` +
        "In these conditions, finding no manipulation signals does not demonstrate authenticity, so no pass is reported.";
      explanation.push(`${inconclusiveReason}`);
    } else if (evidenceStrength < 0.3) {
      /* too few independent families ran to say anything */
      verdict = "inconclusive";
      outcome = "inconclusive";
      inconclusiveReason = `Evidence strength is only ${(evidenceStrength * 100).toFixed(0)}% — too few independent evidence families produced a usable measurement.`;
      explanation.push(`${inconclusiveReason}`);
    } else {
      verdict = "real";
      outcome = "authentic";
      explanation.push(
        `Combined synthetic-lean score ${score.toFixed(2)} is below the ${label} threshold of ${t.real.toFixed(2)}; the ${active.length} active measurements sit within the ranges expected from camera-sourced media.`,
      );
    }
  }

  /* rule 5 — detectors that contradict each other cannot settle a verdict */
  if (dispersion > DISAGREEMENT_LIMIT) {
    verdict = "inconclusive";
    outcome = "inconclusive";
    lowConfidenceCall = true;
    inconclusiveReason = `The detectors disagree: weighted dispersion ${dispersion.toFixed(2)} exceeds the ${DISAGREEMENT_LIMIT} agreement limit, so independent measurements contradict each other.`;
    explanation.push(
      `${inconclusiveReason} Evidence families pointing in opposite directions is reported as INCONCLUSIVE rather than resolved in favour of either one.`,
    );
  }

  /* top contributing checks, quoted with their measured values */
  const ranked = [...floored]
    .sort(
      (a, b) =>
        Math.abs(b.weight * (b.score - 0.5)) - Math.abs(a.weight * (a.score - 0.5)),
    )
    .slice(0, 3);
  for (const c of ranked) {
    if (structural && c.id === structural.id) continue;
    explanation.push(`${c.label}: ${c.finding}`);
  }

  explanation.push(
    `Checks agreed at ${(agreement * 100).toFixed(0)}% consistency across ${active.length} measurements (dispersion ${dispersion.toFixed(2)}).`,
  );
  if (inconclusiveReason) {
    explanation.push(
      `Result: INCONCLUSIVE. ${inconclusiveReason} Automated detection is probabilistic — treat this as "the evidence does not settle it", and corroborate with other sources before drawing a conclusion.`,
    );
  } else {
    explanation.push(
      "Because automated detection is probabilistic, this result is an assessment rather than proof. Corroborate with human judgement and other sources.",
    );
  }

  /* An INCONCLUSIVE result should not claim high confidence in a *verdict*;
     we report how sure we are that the evidence is insufficient instead. */
  confidence =
    verdict === "inconclusive"
      ? 100 * (0.4 + 0.4 * (1 - distance) + 0.2 * clamp(dispersion * 2, 0, 1))
      : confidence;
  confidence = clamp(confidence, 10, CONFIDENCE_CAP);
  if (lowConfidenceCall && verdict !== "inconclusive") confidence = Math.min(confidence, 50);

  const rounded = Math.round(confidence * 10) / 10;
  const uncertainBand = rounded >= UNCERTAIN_BAND.lo && rounded <= UNCERTAIN_BAND.hi;

  return {
    verdict,
    outcome,
    confidence: rounded,
    score,
    uncertainty: Math.round(uncertainty),
    evidenceStrength,
    uncertainBand,
    inconclusiveReason,
    explanation,
  };
}