/**
 * TruthLens engine — configuration layer.
 *
 * Decision thresholds, evidence-strength floor and the low-confidence band are
 * read once per process from the environment (or fall back to conservative
 * documented defaults). Nothing in the verdict or UI layers hard-codes a
 * threshold any more.
 */

import type { Sensitivity, Verdict } from "./types";

/**
 * The three-way outcome the engine reports.
 *
 *   real             — camera-sourced media explains the measurements
 *   likely_ai        — whole-frame synthetic indicators dominate
 *   likely_deepfake  — face / temporal manipulation evidence dominates
 *   inconclusive     — the evidence does not settle the question
 */
export type VerdictKey = Verdict;

/**
 * Low-confidence band: a verdict inside this band is reported honestly as
 * provisional, never as a confident finding.
 */
export const INCONCLUSIVE_BAND = { lo: 40, hi: 60 } as const;

/**
 * No detector is perfect; confidence is capped below 100 to stop misleading
 * certainty. The low-confidence floor keeps borderline calls from looking
 * more certain than the evidence supports.
 */
export const CONFIDENCE_CAP = 97;

export const DISAGREEMENT_LIMIT = 0.34;

export const OK_SCORE_FLOOR = 0.3;
export const STRUCTURAL_FLOOR = 0.72;

export interface Thresholds {
  real: number;
  fake: number;
}

/**
 * Decision thresholds per sensitivity.
 *
 * These come from offline calibration on a labelled validation set (see
 * scripts/benchmark.ts). Each pair is the honest boundary the decision core
 * uses: scores below `real` lean authentic, scores above `fake` lean
 * synthetic, and anything between is INCONCLUSIVE.
 */
export const DEFAULT_THRESHOLDS: Record<Sensitivity, Thresholds> = {
  low: { real: 0.3, fake: 0.75 },
  balanced: { real: 0.38, fake: 0.62 },
  high: { real: 0.45, fake: 0.52 },
};

/**
 * Evidence-strength floor: when fewer independent families produced a
 * measurement than this, the verdict is downgraded to INCONCLUSIVE rather
 * than decided on a thin base.
 */
export const EVIDENCE_STRENGTH_MIN = 0.3;

/**
 * Conserve evidence by default: only a model prediction with enough
 * independent corroboration may move a verdict off the middle.
 */
export const CONSERVATIVE_EVIDENCE_MIN = 0.3;

/**
 * Report low-confidence warnings when a result sits inside the inconclusive
 * band or is otherwise near a decision boundary.
 */
export const REPORT_MUST_FLAG_LOW_CONFIDENCE = true;

/**
 * Read thresholds from the environment. `REAL_THRESHOLD`/`AI_THRESHOLD` are
 * the single-pair overrides; the `*_LOW` / `*_HIGH` variants build a
 * three-sensitivity profile (low / balanced / high) for the decision core.
 *
 * All values are 0..1. Anything malformed falls back to the documented
 * defaults instead of crashing or guessing.
 */
export interface LoadConfigEnv {
  REAL_THRESHOLD?: string;
  AI_THRESHOLD?: string;
  REAL_THRESHOLD_LOW?: string;
  AI_THRESHOLD_LOW?: string;
  REAL_THRESHOLD_BALANCED?: string;
  AI_THRESHOLD_BALANCED?: string;
  INCONCLUSIVE_BAND_LO?: string;
  INCLOSIVE_BAND_HI?: string;
  CONSERVATIVE_EVIDENCE_MIN?: string;
  CONFIDENCE_CAP?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): /**
 * TruthLens engine — configuration layer.
 *
 * Decision thresholds, evidence-strength floor and the low-confidence band are
 * read once per process from the environment (or fall back to conservative
 * documented defaults). Nothing in the verdict or UI layers hard-codes a
 * threshold any more.
 */

import type { Sensitivity, Verdict } from "./types";

/**
 * The three-way outcome the engine reports.
 *
 *   real             — camera-sourced media explains the measurements
 *   likely_ai        — whole-frame synthetic indicators dominate
 *   likely_deepfake  — face / temporal manipulation evidence dominates
 *   inconclusive     — the evidence does not settle the question
 */
export type VerdictKey = Verdict;

/**
 * Low-confidence band: a verdict inside this band is reported honestly as
 * provisional, never as a confident finding.
 */
export const INCONCLUSIVE_BAND = { lo: 40, hi: 60 } as const;

/**
 * No detector is perfect; confidence is capped below 100 to stop misleading
 * certainty. The low-confidence floor keeps borderline calls from looking
 * more certain than the evidence supports.
 */
export const CONFIDENCE_CAP = 97;

export const DISAGREEMENT_LIMIT = 0.34;

export const OK_SCORE_FLOOR = 0.3;
export const STRUCTURAL_FLOOR = 0.72;

export interface Thresholds {
  real: number;
  fake: number;
}

/**
 * Decision thresholds per sensitivity.
 *
 * These come from offline calibration on a labelled validation set (see
 * scripts/benchmark.ts). Each pair is the honest boundary the decision core
 * uses: scores below `real` lean authentic, scores above `fake` lean
 * synthetic, and anything between is INCONCLUSIVE.
 */
export const DEFAULT_THRESHOLDS: Record<Sensitivity, Thresholds> = {
  low: { real: 0.3, fake: 0.75 },
  balanced: { real: 0.38, fake: 0.62 },
  high: { real: 0.45, fake: 0.52 },
};

/**
 * Evidence-strength floor: when fewer independent families produced a
 * measurement than this, the verdict is downgraded to INCONCLUSIVE rather
 * than decided on a thin base.
 */
export const EVIDENCE_STRENGTH_MIN = 0.3;

/**
 * Conserve evidence by default: only a model prediction with enough
 * independent corroboration may move a verdict off the middle.
 */
export const CONSERVATIVE_EVIDENCE_MIN = 0.3;

/**
 * Report low-confidence warnings when a result sits inside the inconclusive
 * band or is otherwise near a decision boundary.
 */
export const REPORT_MUST_FLAG_LOW_CONFIDENCE = true;

/**
 * Read thresholds from the environment. `REAL_THRESHOLD`/`AI_THRESHOLD` are
 * the single-pair overrides; the `*_LOW` / `*_HIGH` variants build a
 * three-sensitivity profile (low / balanced / high) for the decision core.
 *
 * All values are 0..1. Anything malformed falls back to the documented
 * defaults instead of crashing or guessing.
 */
export interface LoadConfigEnv {
  REAL_THRESHOLD?: string;
  AI_THRESHOLD?: string;
  REAL_THRESHOLD_LOW?: string;
  AI_THRESHOLD_LOW?: string;
  REAL_THRESHOLD_BALANCED?: string;
  AI_THRESHOLD_BALANCED?: string;
  INCONCLUSIVE_BAND_LO?: string;
  INCLOSIVE_BAND_HI?: string;
  CONSERVATIVE_EVIDENCE_MIN?: string;
  CONFIDENCE_CAP?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): {
  thresholds: Record<Sensitivity, Thresholds>;
  inconclusiveBand: typeof INCONCLUSIVE_BAND;
  evidenceMin: number;
  confidenceCap: number;
} {
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };

  const realHigh = num(env.REAL_THRESHOLD, DEFAULT_THRESHOLDS.balanced.real);
  const aiHigh = num(env.AI_THRESHOLD, DEFAULT_THRESHOLDS.balanced.fake);
  const realLow = num(env.REAL_THRESHOLD_LOW, DEFAULT_THRESHOLDS.low.real);
  const aiLow = num(env.AI_THRESHOLD_LOW, DEFAULT_THRESHOLDS.low.fake);

  const balancedReal = num(env.REAL_THRESHOLD_BALANCED, DEFAULT_THRESHOLDS.balanced.real);
  const balancedFake = num(env.AI_THRESHOLD_BALANCED, DEFAULT_THRESHOLDS.balanced.fake);

  const thresholds: Record<Sensitivity, Thresholds> = {
    low: { real: Math.min(realLow, realHigh), fake: Math.max(aiLow, aiHigh) },
    balanced: { real: balancedReal, fake: balancedFake },
    high: { real: Math.min(realHigh, realLow), fake: Math.max(aiHigh, aiLow) },
  };

  // Guarantee the band is sane: fake is always above real.
  for (const s of Object.keys(thresholds) as Sensitivity[]) {
    const t = thresholds[s];
    if (t.fake <= t.real) {
      thresholds[s] = { real: t.real - 0.01, fake: t.real + 0.01 };
  return {
    confidenceCap: num(env.CONFIDENCE_CAP, CONFIDENCE_CAP),
  };
}
/**
 * The single threshold profile the production decision core uses. Hardening
 * for the public deployment: a fixed, conservative pair (balanced) so a
 * regression in any value is explicit and reviewable.
 */

{
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };

  const realHigh = num(env.REAL_THRESHOLD, DEFAULT_THRESHOLDS.balanced.real);
  const aiHigh = num(env.AI_THRESHOLD, DEFAULT_THRESHOLDS.balanced.fake);
  const realLow = num(env.REAL_THRESHOLD_LOW, DEFAULT_THRESHOLDS.low.real);
  const aiLow = num(env.AI_THRESHOLD_LOW, DEFAULT_THRESHOLDS.low.fake);

  const balancedReal = num(env.REAL_THRESHOLD_BALANCED, DEFAULT_THRESHOLDS.balanced.real);
  const balancedFake = num(env.AI_THRESHOLD_BALANCED, DEFAULT_THRESHOLDS.balanced.fake);

  const thresholds: Record<Sensitivity, Thresholds> = {
    low: { real: Math.min(realLow, realHigh), fake: Math.max(aiLow, aiHigh) },
    balanced: { real: balancedReal, fake: balancedFake },
    high: { real: Math.min(realHigh, realLow), fake: Math.max(aiHigh, aiLow) },
  };

  // Guarantee the band is sane: fake is always above real.
  for (const s of Object.keys(thresholds) as Sensitivity[]) {
    const t = thresholds[s];
    if (t.fake <= t.real) {
      thresholds[s] = { real: t.real - 0.01, fake: t.real + 0.01 };
    }
  }

  return {
    thresholds,
    inconclusiveBand: {
      lo: INCONCLUSIVE_BAND.lo,
      hi: INCONCLUSIVE_BAND.hi,
    },
    evidenceMin: num(env.CONSERVATIVE_EVIDENCE_MIN, CONSERVATIVE_EVIDENCE_MIN),
    confidenceCap: num(env.CONFIDENCE_CAP, CONFIDENCE_CAP),
  };
}

export const PRODUCTION_THRESHOLDS: Thresholds = {
  real: 0.38,
  fake: 0.62,
};

export const DEFAULT_DECISION_CONTEXT = {
  thresholds: PRODUCTION_THRESHOLDS,
  inconclusiveBand: INCONCLUSIVE_BAND,
  evidenceMin: EVIDENCE_STRENGTH_MIN,
  confidenceCap: CONFIDENCE_CAP,
};
