/**
 * TruthLens — forensic report serializer.
 *
 * Turns an `Analysis` into a self-describing report document: the three-way
 * outcome, the confidence and *why* it is what it is, every evidence category
 * with its measured values, provenance kept separate from detection, the
 * engine and model versions, and the calibration provenance for the thresholds
 * that produced the call.
 *
 * Two rules the format enforces:
 *
 *  1. NOTHING IS ROUNDED UP. Confidence is capped at CONFIDENCE_CAP and the
 *     report repeats that cap, so a downstream consumer of the JSON cannot
 *     read "97% sure this is AI" as "97% sure this is a forgery".
 *  2. DETECTION ≠ PROVENANCE. Provenance lives in its own block. A file with no
 *     content credentials is reported as *provenance absent*, never as evidence
 *     that the file is synthetic — and a missing EXIF is called out as weak
 *     evidence in its own right.
 *
 * The output is plain JSON so it can be archived, diffed, or fed to another
 * tool, and it carries the same numbers the UI shows — the report is not a
 * second opinion, it is a serialisation of the one that was rendered.
 */
import { CALIBRATION, CONFIDENCE_CAP, UNCERTAIN_BAND } from "./verdict";
import { HEURISTIC_BACKEND } from "./detectors";
import type {
  Analysis,
  Check,
  EvidenceCategoryReport,
  ImageAnalysis,
  Verdict,
  VideoAnalysis,
} from "./types";

/** Standing language that must accompany every report, in any consumer. */
export const REPORT_DISCLAIMER =
  "Results are probabilistic and may be wrong. Do not use as sole evidence. No detector is 100% accurate — always corroborate with human judgement and other sources. This is an assessment, not proof.";

export interface ReportProvenance {
  /** content credentials present in the file? */
  contentCredentials: boolean;
  detail: string | null;
  /** camera EXIF present? */
  cameraExif: boolean;
  camera: string | null;
  software: string | null;
  /**
   * The inference, stated as an inference. This is the field a careless
   * consumer would mistake for detection evidence, so it is named to make the
   * distinction obvious at the point of use.
   */
  inferenceNote: string;
  /** explicitly: absence of provenance is not evidence of generation */
  absenceIsNeutral: boolean;
}

export interface ReportEvidenceCategory {
  id: string;
  label: string;
  /** "not-measured" | "within-range" | "elevated" | "flagged" */
  strength: "not-measured" | "within-range" | "elevated" | "flagged";
  signals: Array<{
    label: string;
    measured: string;
    lean: number;
    confidence: number;
    weight: number;
    ran: boolean;
    detector: string | null;
    detectorVersion: string | null;
    evidence: string;
  }>;
}

export interface ForensicReport {
  reportVersion: string;
  generatedAt: string;
  disclaimer: string;

  verdict: {
    /** the three-way outcome */
    outcome: "LIKELY AUTHENTIC" | "LIKELY AI-GENERATED or MANIPULATED" | "INCONCLUSIVE" | "ANALYSIS UNAVAILABLE";
    verdict: Verdict;
    /** 0..100, never 100 */
    confidence: number;
    /** 0..100 — how close the call sits to a decision boundary */
    uncertainty: number;
    /** 0..1 — how much independent measured evidence stood behind the call */
    evidenceStrength: number;
    /** 0..1 combined synthetic-leaning score */
    score: number;
    /** true when confidence sits in the 40–60% band */
    uncertainBand: boolean;
    /** why the verdict is inconclusive; null otherwise */
    inconclusiveReason: string | null;
    confidenceCap: number;
    uncertaintyBand: { lo: number; hi: number };
  };

  subject: {
    kind: "image" | "video";
    dimensions: { width: number; height: number };
    /** only for video */
    durationSec?: number;
    frameCount?: number;
    /** SHA-256 of the analysed bytes */
    contentHash: string | null;
  };

  /** plain-language reasoning, in the order the engine produced it */
  narrative: string[];

  evidence: ReportEvidenceCategory[];

  /** every measured check with its real numbers — nothing hidden */
  checks: Array<{
    id: string;
    label: string;
    group: string;
    measured: string;
    lean: number;
    weight: number;
    status: string;
    finding: string;
  }>;

  provenance: ReportProvenance | null;

  /** video-only sections */
  temporal?: {
    flicker: number;
    scoreDispersion: number;
    lightingJumps: number;
    sceneCuts: number;
    faceJitter: number;
    framesWithoutFace: number;
    /** suspicious segments, so a reviewer can seek to them */
    suspiciousSegments: Array<{ t: number; score: number }>;
  };
  audio?: {
    durationSec: number;
    sampleRate: number;
    clippingRatio: number;
    dcOffset: number;
    silenceRatio: number;
    loudnessUniformity: number;
    spectralCentroid: number;
    note: string;
    scopeNote: string;
  };

  models: {
    engine: string;
    engineVersion: string;
    faceDetector: { name: string; status: string; detail?: string };
    /**
     * The generation classifier. `modelBacked: false` is load-bearing: it says
     * no trained weights produced this number.
     */
    generationClassifier: {
      id: string;
      version: string;
      modelBacked: boolean;
      note: string;
    };
    neuralClassifierDisclosure: string;
  };

  calibration: typeof CALIBRATION;

  limitations: string[];
}

/** Categories where the engine is explicitly out of scope. */
export const REPORT_LIMITATIONS = [
  "Detection is probabilistic. This report is an assessment, never a proof.",
  "No trained image-authenticity classifier is bundled: the score comes from measured physical and encoding signals, not from a neural fake/real probability.",
  "Absence of EXIF or of C2PA content credentials is NOT evidence of AI generation. It is reported as absent and carries zero weight in the authentic direction.",
  "Error Level Analysis requires a re-encode; where the environment could not re-encode, ELA is reported as not measured rather than estimated.",
  "Face checks are relative to the surrounding frame, so they are skipped on portrait frames where the face fills the image; no face score is invented for those.",
  "Voice-clone classification is not implemented. The audio section is a signal profile only.",
  "Very heavily recompressed or heavily downscaled media loses the high-frequency evidence these checks depend on; such runs return INCONCLUSIVE rather than a guess.",
] as const;

function categoryStrength(cat: EvidenceCategoryReport): ReportEvidenceCategory["strength"] {
  const active = cat.signals.filter((s) => s.weight > 0);
  if (active.length === 0) return "not-measured";
  const worst = Math.max(...active.map((s) => s.score));
  if (worst >= 0.65) return "flagged";
  if (worst >= 0.4) return "elevated";
  return "within-range";
}

function toEvidenceCategories(cats: EvidenceCategoryReport[] | undefined): ReportEvidenceCategory[] {
  return (cats ?? []).map((cat) => ({
    id: cat.id,
    label: cat.label,
    strength: categoryStrength(cat),
    signals: cat.signals.map((s) => ({
      label: s.label,
      measured: s.raw,
      lean: Math.round(s.score * 1000) / 1000,
      confidence: s.confidence,
      weight: s.weight,
      ran: s.weight > 0,
      detector: s.detector ?? null,
      detectorVersion: s.detectorVersion ?? null,
      evidence: s.evidence,
    })),
  }));
}

function toChecks(checks: Check[]) {
  return checks.map((c) => ({
    id: c.id,
    label: c.label,
    group: c.group,
    measured: c.display,
    lean: Math.round(c.score * 1000) / 1000,
    weight: c.weight,
    status: c.status,
    finding: c.finding,
  }));
}

function toProvenance(a: Analysis): ReportProvenance | null {
  const md = a.metadata;
  if (!md) return null;
  return {
    contentCredentials: md.c2pa,
    detail: md.c2paDetail,
    cameraExif: md.hasExif,
    camera: [md.cameraMake, md.cameraModel].filter(Boolean).join(" ") || null,
    software: md.software,
    inferenceNote:
      md.aiSignatures.length > 0
        ? `The file names AI tooling (${md.aiSignatures.join(", ")}). This is a claim the file makes about itself, and it is corroborated by the pixel-level detectors.`
        : "No generator signature was found in this file. Nothing about provenance was inferred from a missing EXIF — that would be backwards.",
    absenceIsNeutral: true,
  };
}

/** The three-way outcome label, with an explicit fallback chain for legacy rows. */
export type OutcomeLabel =
  | "LIKELY AUTHENTIC"
  | "LIKELY AI-GENERATED or MANIPULATED"
  | "INCONCLUSIVE"
  | "ANALYSIS UNAVAILABLE";

/**
 * Legacy rows stored before the three-way engine carry no `outcome`, so the
 * verdict itself is the fallback. Anything still unrecognised reports
 * INCONCLUSIVE rather than defaulting to authentic — failing closed.
 */
export function resolveOutcomeLabel(a: Pick<Analysis, "verdict" | "outcome">): OutcomeLabel {
  const key = a.verdict === "error" ? "error" : (a.outcome ?? inferOutcome(a.verdict));
  const map: Record<string, OutcomeLabel> = {
    authentic: "LIKELY AUTHENTIC",
    synthetic: "LIKELY AI-GENERATED or MANIPULATED",
    inconclusive: "INCONCLUSIVE",
    error: "ANALYSIS UNAVAILABLE",
  };
  return map[key] ?? "INCONCLUSIVE";
}

function inferOutcome(v: Verdict): string {
  if (v === "error") return "error";
  if (v === "inconclusive") return "inconclusive";
  if (v === "real") return "authentic";
  return "synthetic";
}

export function buildReport(a: Analysis, generatedAt = new Date()): ForensicReport {
  const isVideo = a.kind === "video";

  const report: ForensicReport = {
    reportVersion: "1.0.0",
    generatedAt: generatedAt.toISOString(),
    disclaimer: REPORT_DISCLAIMER,

    verdict: {
      outcome: resolveOutcomeLabel(a),
      verdict: a.verdict,
      confidence: a.confidence,
      uncertainty: a.uncertainty ?? 0,
      evidenceStrength: Math.round((a.evidenceStrength ?? 0) * 1000) / 1000,
      score: Math.round(a.score * 1000) / 1000,
      uncertainBand: a.uncertainBand ?? false,
      inconclusiveReason: a.inconclusiveReason ?? null,
      confidenceCap: CONFIDENCE_CAP,
      uncertaintyBand: { lo: UNCERTAIN_BAND.lo, hi: UNCERTAIN_BAND.hi },
    },

    subject: {
      kind: a.kind,
      dimensions: a.dimensions,
      ...(isVideo
        ? { durationSec: (a as VideoAnalysis).durationSec, frameCount: (a as VideoAnalysis).frameCount }
        : {}),
      contentHash: a.hash ?? null,
    },

    narrative: a.explanation,
    evidence: toEvidenceCategories(a.evidence?.categories),
    checks: toChecks(a.checks),
    provenance: toProvenance(a),

    models: {
      engine: a.engine.name,
      engineVersion: a.engine.version,
      faceDetector: {
        name: a.engine.faceDetector.name,
        status: a.engine.faceDetector.status,
        detail: a.engine.faceDetector.detail,
      },
      generationClassifier: {
        id: HEURISTIC_BACKEND.id,
        version: HEURISTIC_BACKEND.version,
        modelBacked: HEURISTIC_BACKEND.modelBacked,
        note:
          "The shipped generation classifier is a weighted blend of calibrated measurements, not a trained neural network. A trained backend can replace it without changing the report format or the decision layer.",
      },
      neuralClassifierDisclosure: a.engine.neuralClassifier.detail,
    },

    calibration: CALIBRATION,
    limitations: [...REPORT_LIMITATIONS],
  };

  if (isVideo) {
    const v = a as VideoAnalysis;
    report.temporal = {
      flicker: Math.round(v.temporal.flicker * 1000) / 1000,
      scoreDispersion: Math.round(v.temporal.scoreCv * 1000) / 1000,
      lightingJumps: v.temporal.lightJumps,
      sceneCuts: v.temporal.cuts,
      faceJitter: Math.round(v.temporal.faceJitter * 1000) / 1000,
      framesWithoutFace: Math.round(v.temporal.noFaceRatio * 1000) / 1000,
      suspiciousSegments: v.suspiciousFrames.map((f) => ({
        t: Math.round(f.t * 100) / 100,
        score: Math.round(f.score * 1000) / 1000,
      })),
    };
    if (v.audio) {
      report.audio = {
        durationSec: Math.round(v.audio.durationSec * 100) / 100,
        sampleRate: v.audio.sampleRate,
        clippingRatio: v.audio.clippingRatio,
        dcOffset: v.audio.dcOffset,
        silenceRatio: Math.round(v.audio.silenceRatio * 1000) / 1000,
        loudnessUniformity: Math.round(v.audio.uniformity * 1000) / 1000,
        spectralCentroid: v.audio.spectralCentroid,
        note: v.audio.note,
        scopeNote:
          "This is a measured audio profile. TruthLens does not classify cloned or synthetic voices.",
      };
    }
  }

  return report;
}

/** Convenience: the report as pretty-printed JSON, ready to download. */
export function serializeReport(a: Analysis, generatedAt = new Date()): string {
  return JSON.stringify(buildReport(a, generatedAt), null, 2);
}

/** Short, human-facing headline used above the report in the UI. */
export function headline(a: Pick<Analysis, "verdict" | "outcome" | "confidence" | "uncertainty">): string {
  const label = resolveOutcomeLabel(a);
  if (a.verdict === "error") return label;
  if (a.verdict === "inconclusive") {
    return `${label} — the evidence does not settle it (${Math.round(a.uncertainty ?? 0)}% uncertainty)`;
  }
  return `${label} — ${Math.round(a.confidence)}% confidence`;
}

/** True when the run should surface the low-confidence chip in the UI. */
export function shouldFlagLowConfidence(a: Analysis): boolean {
  if (a.verdict === "error") return false;
  if (a.verdict === "inconclusive") return true;
  return (
    (a.uncertainBand ?? false) ||
    a.confidence <= UNCERTAIN_BAND.hi ||
    (a.uncertainty ?? 0) >= 55
  );
}

/** Narrow an analysis to its image shape (used by report-only surfaces). */
export function asImage(a: Analysis): ImageAnalysis {
  if (a.kind !== "image") throw new Error("asImage called on a video analysis");
  return a;
}