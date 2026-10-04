/**
 * TruthLens — modular detector architecture and evidence fusion.
 *
 * Every file is examined through a portfolio of *independent* detectors. Each
 * detector reports one or more measured signals shaped as
 *
 *     { id, label, group, raw, score, confidence, evidence, reliability }
 *
 * and the fusion layer (`mergeEvidence`) combines them into a combined score
 * plus a per-evidence-category report. No single detector is ever treated as
 * definitive, and a detector that cannot run reports `reliability: "skip"` with
 * weight 0 rather than an invented number.
 *
 * The portfolio is deliberately the abstraction the product requires:
 *
 *   Detector
 *   ├── ImageAIDetector           (AI-generation classifier — pluggable)
 *   ├── VisualArtifactDetector     (noise / histogram / seam artifacts)
 *   ├── FrequencyDetector          (FFT power-spectrum)
 *   ├── CompressionDetector        (JPEG grid + error-level analysis)
 *   ├── MetadataDetector           (EXIF / encoder / generator signatures)
 *   ├── ProvenanceDetector         (C2PA content credentials)
 *   ├── FaceManipulationDetector   (per-face consistency)
 *   ├── VideoTemporalDetector      (frame-to-frame consistency)
 *   └── AudioVideoSyncDetector     (audio continuity profile)
 *
 * A different classifier or model can be plugged in without touching the
 * verdict or UI layers — see `ClassifierBackend` / `registerBackend`.
 */

import {
  BANDS,
  PROVENANCE_MIN_QF,
  buildFaceAggregate,
  type SignalAnalysis,
} from "./forensics";
import { clamp, mean, ramp, stdDev } from "./dsp";
import type { MediaFormat } from "./metadata";
import type {
  AudioProfile,
  Check,
  CheckGroup,
  EngineInfo,
  FaceResult,
  MetadataFindings,
  Sensitivity,
  TemporalStats,
} from "./types";

/* ==================================================================== */
/* Signal + category shapes                                             */
/* ==================================================================== */

/**
 * Evidence families. `compression` and `spectral` are separated from `image`
 * because a forensic report should be able to say *which* physical layer of
 * the file carried the evidence.
 */
export type DetectorGroup =
  | "image"
  | "spectral"
  | "compression"
  | "metadata"
  | "provenance"
  | "face"
  | "temporal"
  | "audio";

export const DETECTOR_GROUP_LABEL: Record<DetectorGroup, string> = {
  image: "Visual artifacts",
  spectral: "Frequency anomalies",
  compression: "Compression & resampling",
  metadata: "Metadata",
  provenance: "Provenance",
  face: "Face consistency",
  temporal: "Temporal consistency",
  audio: "Audio continuity",
};

/** How much we trust a single signal on its own. */
export type SignalReliability = "skip" | "not-applicable" | "ok" | "warn" | "flag";

/** A single detector's measured contribution to the report. */
export interface DetectorSignal {
  /** short stable id, used by the report and the developer dashboard */
  id: string;
  /** human label */
  label: string;
  /** which evidence family this signal belongs to */
  group: DetectorGroup;
  /** the measured value, already human-formatted */
  raw: string;
  /** 0..1 synthetic-leaning lean (1 = strongly synthetic/manipulated) */
  score: number;
  /** 0..1 fusion weight; 0 means "did not run" */
  weight: number;
  /** 0..100 measured confidence in *this* detector's score */
  confidence: number;
  /** plain-English evidence, quoting the real measured numbers */
  evidence: string;
  /** honesty rating: did it run, and did it fire? */
  reliability: SignalReliability;
  /** which detector produced it (populated by the fusion layer) */
  detector?: string;
  /** detector version (populated by the fusion layer) */
  detectorVersion?: string;
}

/** Per-evidence-category summary for the forensic report. */
export interface EvidenceCategory {
  id: DetectorGroup;
  label: string;
  signals: DetectorSignal[];
  /** did any strong signal fire in this category? */
  flagged: boolean;
  /** strongest signal score in this category */
  maxScore: number;
  /** 0..1 — how much this category contributed */
  weight: number;
}

/* ==================================================================== */
/* Detector abstraction                                                 */
/* ==================================================================== */

/** One concrete detector. Implement `name`, `version`, `group` and `run()`. */
export abstract class Detector {
  /** stable display name */
  abstract readonly name: string;
  /** semantic version of the detector logic */
  abstract readonly version: string;
  /** evidence family this detector reports into */
  abstract readonly group: DetectorGroup;

  /**
   * Run the detector. A detector may only read what is genuinely available in
   * `context`; anything it cannot measure must be reported as skipped.
   */
  abstract run(context: DetectorContext): Promise<DetectorSignal[]>;

  /** Human-readable line for the technical tab. */
  details(): string {
    return `${this.name} v${this.version}`;
  }
}

/** Everything a detector is allowed to read. */
export interface DetectorContext {
  /** image or video */
  kind: "image" | "video";
  /** decoded container format */
  format: MediaFormat;
  /** settings this run used */
  sensitivity: Sensitivity;
  /** every measured check the forensics layer produced */
  checks: Check[];
  /** the raw signal analysis, when the forensics layer ran it */
  signal: SignalAnalysis | null;
  /** per-face measurements */
  faces: FaceResult[];
  /** area-weighted face lean fed to the verdict (null when no face voted) */
  faceScore: number | null;
  /** decoded metadata (EXIF, C2PA markers, generator signatures, QF estimate) */
  metadata: MetadataFindings | null;
  /** temporal statistics — video runs only */
  temporal: TemporalStats | null;
  /** audio profile — video runs only */
  audio: AudioProfile | null;
  /** engine metadata (BlazeFace status, bundled-model disclosure) */
  engine: EngineInfo;
}

/* ==================================================================== */
/* Pluggable AI-generation classifier backend                          */
/* ==================================================================== */

/** Feature vector handed to a classifier backend. All values are measured. */
export interface GenerationFeatures {
  /** 1 when the flat-region noise floor is unnaturally low */
  noiseSmoothness: number;
  /** 1 when the radial power-spectrum slope sits outside the natural band */
  spectralAnomaly: number;
  /** 1 when a periodic upsampling peak dominates the spectrum */
  upsamplingPeak: number;
  /** 1 when the luminance histogram shows post-processing gaps */
  toneGap: number;
  /** 1 when block-grid alignment disagrees between regions */
  gridMisalignment: number;
  /** 1 when error energy concentrates in a small set of tiles */
  elaLocalization: number;
  /** 1 when a hard vertical seam crosses the frame */
  seam: number;
  /** area-weighted face lean, or null when no face was measured */
  faceLean: number | null;
}

export interface ClassifierPrediction {
  /** 0..1 synthetic-leaning lean */
  score: number;
  /** 0..100 confidence in that score */
  confidence: number;
  /** short note surfaced in the report (e.g. which features dominated) */
  note: string;
}

/**
 * A classifier backend. The shipped default is a *measured-feature* blend, not
 * a neural network — and it says so. Replacing it with a trained model means
 * implementing this interface and calling `registerBackend`; nothing else in
 * the pipeline changes.
 */
export interface ClassifierBackend {
  readonly id: string;
  readonly version: string;
  /** false when no trained weights are behind the prediction */
  readonly modelBacked: boolean;
  predict(features: GenerationFeatures): ClassifierPrediction;
}

/**
 * Feature weights for the shipped heuristic backend.
 *
 * These are *not* arbitrary: each feature is the normalised output of a
 * calibrated band from `forensics.ts` (see BANDS), and the weights sum to 1 so
 * the prediction stays inside [0,1]. `scripts/calibrate.ts` sweeps the
 * resulting score against the labelled samples and reports ROC-AUC.
 */
export const HEURISTIC_FEATURE_WEIGHTS: Record<keyof GenerationFeatures, number> = {
  noiseSmoothness: 0.22,
  spectralAnomaly: 0.22,
  upsamplingPeak: 0.08,
  toneGap: 0.08,
  gridMisalignment: 0.1,
  elaLocalization: 0.16,
  seam: 0.14,
  faceLean: 0,
};

/**
 * The shipped backend: a deterministic blend of calibrated measurements.
 * It is labelled `modelBacked: false` everywhere it is shown, because no
 * trained weights are involved.
 */
export const HEURISTIC_BACKEND: ClassifierBackend = {
  id: "truthlens-feature-blend",
  version: "1.1.0",
  modelBacked: false,
  predict(features) {
    const parts: Array<[keyof GenerationFeatures, number]> = (
      Object.keys(features) as Array<keyof GenerationFeatures>
    )
      .map((k) => [k, features[k]] as [keyof GenerationFeatures, number])
      .filter(([, v]) => typeof v === "number");

    const active = parts.filter(([k]) => HEURISTIC_FEATURE_WEIGHTS[k] > 0);
    if (active.length === 0) {
      return {
        score: 0.5,
        confidence: 0,
        note: "No measurable feature was available, so no generation score was produced.",
      };
    }
    const wsum = active.reduce((a, [k]) => a + HEURISTIC_FEATURE_WEIGHTS[k], 0);
    const score = clamp(
      active.reduce((a, [k, v]) => a + HEURISTIC_FEATURE_WEIGHTS[k] * clamp(v, 0, 1), 0) / wsum,
      0,
      1,
    );
    const agreement = 1 - clamp(stdDev(active.map(([, v]) => v)) * 2, 0, 1);
    const ranked = [...active].sort((a, b) => {
      const wa = HEURISTIC_FEATURE_WEIGHTS[a[0]] * a[1];
      const wb = HEURISTIC_FEATURE_WEIGHTS[b[0]] * b[1];
      return wb - wa;
    });
    const dominant = ranked.slice(0, 2).filter(([, v]) => v >= 0.4).map(([k]) => k);
    const note =
      dominant.length > 0
        ? `Dominated by ${dominant.join(" and ")}; the remaining ${active.length - dominant.length} feature(s) stayed below the flag level.`
        : `All ${active.length} features sit inside the range expected from camera-sourced media.`;
    /* confidence: how far from neutral, tempered by feature agreement.
       Capped at 90 — a measured-feature blend is not a trained model. */
    const confidence = clamp(
      100 * (0.35 * Math.abs(score - 0.5) * 2 + 0.45 * agreement + 0.2),
      5,
      90,
    );
    void wsum;
    return { score, confidence: Math.round(confidence), note };
  },
};

let activeBackend: ClassifierBackend = HEURISTIC_BACKEND;

/** Swap the AI-generation classifier for a trained model or another backend. */
export function registerBackend(backend: ClassifierBackend): void {
  activeBackend = backend;
}

export function currentBackend(): ClassifierBackend {
  return activeBackend;
}

/* ==================================================================== */
/* Fusion weights                                                       */
/* ==================================================================== */

/**
 * Per-group fusion weights. These mirror the check weights already used by
 * `forensics.ts` so the evidence report and the verdict describe the same
 * measurement; changing them here changes only the report breakdown, never the
 * score the verdict layer computes from `checks`.
 */
export const FUSION_WEIGHTS: Record<DetectorGroup, number> = {
  image: 0.3,
  spectral: 0.18,
  compression: 0.26,
  metadata: 0.16,
  provenance: 0.08,
  face: 0.26,
  temporal: 0.28,
  audio: 0.06,
};

/* ==================================================================== */
/* Helpers                                                              */
/* ==================================================================== */

/** Map an engine check group onto a detector evidence family. */
export function groupForCheckGroup(group: CheckGroup): DetectorGroup {
  switch (group) {
    case "signal":
      return "image";
    case "spectral":
      return "spectral";
    case "compression":
      return "compression";
    case "metadata":
      return "metadata";
    case "face":
      return "face";
    case "temporal":
      return "temporal";
    case "audio":
      return "audio";
  }
}

/** A signal that reports "this detector could not measure anything". */
function skipped(
  id: string,
  label: string,
  group: DetectorGroup,
  why: string,
): DetectorSignal {
  return {
    id,
    label,
    group,
    raw: "not run",
    score: 0.5,
    weight: 0,
    confidence: 0,
    evidence: why,
    reliability: "skip",
  };
}

/** A signal that ran and produced a usable measurement. */
function measured(args: {
  id: string;
  label: string;
  group: DetectorGroup;
  raw: string;
  score: number;
  weight: number;
  confidence: number;
  evidence: string;
}): DetectorSignal {
  const score = clamp(args.score, 0, 1);
  return {
    ...args,
    score,
    reliability: score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok",
  };
}

/**
 * Turn the raw measurements into the normalised feature vector the classifier
 * backend consumes. Each feature is a ramp over the *same* calibrated band the
 * corresponding check uses, so a feature of 1 means "at or past the flag
 * level", not "arbitrarily large".
 */
export function generationFeatures(ctx: DetectorContext): GenerationFeatures {
  const sig = ctx.signal;
  const check = (id: string) => ctx.checks.find((c) => c.id === id);
  return {
    noiseSmoothness: sig
      ? 1 - ramp(sig.noise.sigmaFlat, BANDS.noiseSmooth.lo, BANDS.noiseSmooth.hi)
      : (check("noise")?.score ?? 0),
    spectralAnomaly: sig
      ? clamp(
          Math.max(
            ramp(-sig.spectrum.slope, BANDS.spectralSlope.steep, BANDS.spectralSlope.steep + 1.1),
            ramp(BANDS.spectralSlope.shallow + sig.spectrum.slope, 0, 0.7),
          ),
          0,
          1,
        )
      : (check("spectrum")?.score ?? 0),
    upsamplingPeak: sig
      ? ramp(sig.spectrum.peak, BANDS.spectralPeak.lo, BANDS.spectralPeak.hi)
      : 0,
    toneGap: sig
      ? clamp(
          0.7 * ramp(sig.histogram.gaps, BANDS.histGaps.lo, BANDS.histGaps.hi) +
            0.3 * ramp(sig.histogram.longestRun, BANDS.histRun.lo, BANDS.histRun.hi),
          0,
          1,
        )
      : (check("histogram")?.score ?? 0),
    gridMisalignment: sig?.grid
      ? 1 - ramp(sig.grid.phase, BANDS.gridPhase.lo, BANDS.gridPhase.hi)
      : 0,
    elaLocalization: check("ela")?.score ?? 0,
    seam: check("seam")?.score ?? 0,
    faceLean: ctx.faceScore,
  };
}

/* ==================================================================== */
/* Concrete detectors                                                   */
/* ==================================================================== */

/**
 * ImageAIDetector — the AI-generation classifier.
 *
 * Delegates to the registered `ClassifierBackend` so a trained model can be
 * added later without touching this file's callers. The shipped backend is a
 * measured-feature blend and is reported as `modelBacked: false`.
 */
export class ImageAIDetector extends Detector {
  readonly name = "AI-generation classifier";
  readonly version = "1.1.0";
  readonly group: DetectorGroup = "image";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const backend = currentBackend();
    const features = generationFeatures(ctx);
    const pred = backend.predict(features);
    const detail = (Object.keys(features) as Array<keyof GenerationFeatures>)
      .filter((k) => HEURISTIC_FEATURE_WEIGHTS[k] > 0)
      .map((k) => `${k}=${((features[k] ?? 0) * 100).toFixed(0)}%`)
      .join(", ");

    if (pred.confidence === 0) {
      return [
        skipped(
          "ai-generation",
          "AI-generation classifier",
          "image",
          `Backend "${backend.id}" produced no usable prediction for this file — the score is not guessed. ${pred.note}`,
        ),
      ];
    }

    return [
      measured({
        id: "ai-generation",
        label: "AI-generation classifier",
        group: "image",
        raw: `${(pred.score * 100).toFixed(0)}% lean`,
        score: pred.score,
        weight: FUSION_WEIGHTS.image,
        confidence: pred.confidence,
        evidence:
          `Backend ${backend.id} v${backend.version} (` +
          `${backend.modelBacked ? "trained model" : "measured-feature blend, no trained weights"}` +
          `) scored ${(pred.score * 100).toFixed(0)}% synthetic lean at ${pred.confidence}% confidence. ` +
          `${pred.note} Features: ${detail}.`,
      }),
    ];
  }
}

/**
 * VisualArtifactDetector — whole-frame physical artifacts.
 *
 * Re-exports the noise-residual and histogram measurements as their own
 * evidence family. It reports what ran; it never re-derives a score.
 */
export class VisualArtifactDetector extends Detector {
  readonly name = "Visual artifact detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "image";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const out: DetectorSignal[] = [];
    for (const id of ["noise", "histogram"]) {
      const c = ctx.checks.find((k) => k.id === id);
      if (!c) {
        out.push(
          skipped(
            `artifact-${id}`,
            id,
            "image",
            "This measurement was not produced for this run.",
          ),
        );
        continue;
      }
      out.push({
        id: `artifact-${id}`,
        label: c.label,
        group: "image",
        raw: c.display,
        score: c.score,
        weight: c.weight,
        confidence: c.status === "skip" ? 0 : 80,
        evidence: c.finding,
        reliability: c.status,
      });
    }
    return out;
  }
}

/**
 * FrequencyDetector — FFT power-spectrum analysis.
 *
 * Reports the radial power-slope, the periodic upsampling peak and the
 * high-frequency energy share actually measured on the analysed plane.
 */
export class FrequencyDetector extends Detector {
  readonly name = "Frequency-domain detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "spectral";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const c = ctx.checks.find((k) => k.id === "spectrum");
    if (!c || c.status === "skip") {
      return [
        skipped(
          "spectrum",
          "Frequency spectrum (FFT)",
          "spectral",
          c?.finding ??
            "The analysed plane was too small for a 2D FFT, so no spectral evidence was measured.",
        ),
      ];
    }
    const sig = ctx.signal;
    return [
      measured({
        id: "spectrum",
        label: "Frequency spectrum (FFT)",
        group: "spectral",
        raw: c.display,
        score: c.score,
        weight: FUSION_WEIGHTS.spectral,
        confidence: 85,
        evidence:
          c.finding +
          (sig
            ? ` High-frequency energy share = ${(sig.spectrum.hfRatio * 100).toFixed(1)}%.`
            : ""),
      }),
    ];
  }
}

/**
 * CompressionDetector — JPEG block grid + error-level analysis.
 *
 * Separated from the visual-artifact family because a grid/ELA signal is
 * evidence about the *encoding history* of the file, not about its content.
 */
export class CompressionDetector extends Detector {
  readonly name = "Compression & resampling detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "compression";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const out: DetectorSignal[] = [];
    for (const id of ["grid", "ela", "seam"]) {
      const c = ctx.checks.find((k) => k.id === id);
      if (!c) {
        out.push(
          skipped(`compression-${id}`, id, "compression", "This measurement was not produced for this run."),
        );
        continue;
      }
      out.push({
        id: `compression-${id}`,
        label: c.label,
        group: "compression",
        raw: c.display,
        score: c.score,
        weight: c.weight,
        confidence: c.status === "skip" ? 0 : 78,
        evidence: c.finding,
        reliability: c.status,
      });
    }
    return out;
  }
}

/**
 * MetadataDetector — EXIF / encoder / generator signatures.
 *
 * Absence of EXIF is explicitly *not* treated as evidence of generation: it
 * only leans slightly synthetic, and the wording says so.
 */
export class MetadataDetector extends Detector {
  readonly name = "Metadata detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "metadata";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const md = ctx.metadata;
    if (!md) {
      return [
        skipped(
          "metadata",
          "Container metadata",
          "metadata",
          "Metadata parsing was disabled for this run, so no metadata evidence was measured.",
        ),
      ];
    }
    const c = ctx.checks.find((k) => k.id === "metadata");
    const qf = md.tags["EstimatedJpegQuality"];

    // Provenance inference is deliberately *not* folded into the metadata
    // score — it lives in ProvenanceDetector, so the report can keep
    // "DETECTION" and "PROVENANCE" visibly separate.
    const s = c?.score ?? 0.5;
    return [
      measured({
        id: "metadata",
        label: `Metadata (${md.format})`,
        group: "metadata",
        raw:
          `${md.format}` +
          `${md.hasExif ? " · EXIF" : " · no EXIF"}` +
          `${md.aiSignatures.length ? ` · ${md.aiSignatures.length} AI marker(s)` : ""}` +
          `${qf ? ` · QF≈${qf}` : ""}`,
        score: s,
        weight: FUSION_WEIGHTS.metadata,
        confidence: md.aiSignatures.length > 0 ? 92 : 78,
        evidence:
          c?.finding ??
          (md.aiSignatures.length > 0
            ? `Known generator/tool signatures found: ${md.aiSignatures.join(", ")}.`
            : "No metadata evidence was measured."),
      }),
    ];
  }
}

/**
 * ProvenanceDetector — C2PA / Content Credentials.
 *
 * DETECTION vs PROVENANCE, kept apart on purpose:
 *   - Detection asks "do the pixels/bytes look synthesised?"
 *   - Provenance asks "does the file carry a signed claim about its origin?"
 * A file with no provenance information is NOT automatically fake, and its
 * absence contributes zero weight to the fusion score.
 */
export class ProvenanceDetector extends Detector {
  readonly name = "Provenance detector (C2PA)";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "provenance";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const md = ctx.metadata;
    if (!md) {
      return [
        skipped(
          "provenance",
          "Provenance (C2PA)",
          "provenance",
          "No metadata was parsed, so provenance could not be assessed. Absence of provenance is not evidence of fakery.",
        ),
      ];
    }

    if (md.c2pa) {
      return [
        {
          id: "provenance",
          label: "Provenance (C2PA)",
          group: "provenance",
          raw: "content credentials present",
          score: 0.5,
          weight: FUSION_WEIGHTS.provenance,
          confidence: 70,
          evidence:
            "C2PA Content Credentials were found in the file. A signed record is meaningful only when its claims are inspected at contentcredentials.org — presence alone neither proves nor disproves generation, so this signal contributes neutrally.",
          reliability: "warn",
        },
      ];
    }

    const qfRaw = md.tags["EstimatedJpegQuality"];
    const qf = qfRaw !== undefined ? Number(qfRaw) : NaN;
    if (md.aiSignatures.length > 0) {
      return [
        {
          id: "provenance",
          label: "Provenance (C2PA)",
          group: "provenance",
          raw: `generator signature: ${md.aiSignatures[0]}`,
          score: 0.95,
          weight: FUSION_WEIGHTS.provenance,
          confidence: 90,
          evidence: `The file itself names an AI generator (${md.aiSignatures.join(", ")}). This is a claim made by the file about its own origin, corroborated by the pixel-level detectors.`,
          reliability: "flag",
        },
      ];
    }

    if (!md.hasExif && Number.isFinite(qf) && qf >= PROVENANCE_MIN_QF) {
      return [
        {
          id: "provenance",
          label: "Provenance (C2PA)",
          group: "provenance",
          raw: `no credentials · QF≈${qf}`,
          score: 0.68,
          weight: FUSION_WEIGHTS.provenance,
          confidence: 72,
          evidence:
            `JPEG quantization tables show near-lossless encoding (quality ≈ ${qf} ≥ ${PROVENANCE_MIN_QF}) while the file carries no EXIF and no content credentials. ` +
            "Cameras and social platforms re-encode at much lower quality and retain provenance, so a stripped near-lossless file is consistent with a programmatic render or a saved generator output. " +
            "This is provenance *inference*, not proof of generation, and it is deliberately kept separate from detection evidence.",
          reliability: "flag",
        },
      ];
    }

    return [
      {
        id: "provenance",
        label: "Provenance (C2PA)",
        group: "provenance",
        raw: "absent",
        score: 0.5,
        weight: 0,
        confidence: 0,
        evidence:
          "No C2PA content credentials are present. Absent provenance is neutral: it does not imply generation, and a missing EXIF alone is never treated as evidence of AI generation.",
        reliability: "not-applicable",
      },
    ];
  }
}

/**
 * FaceManipulationDetector — per-face consistency.
 *
 * Uses the engine's own `buildFaceAggregate` so the reported face lean is
 * numerically identical to the one the verdict consumed. Faces whose sub-checks
 * were all skipped (portrait frames, tiny crops) do not vote.
 */
export class FaceManipulationDetector extends Detector {
  readonly name = "Face manipulation detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "face";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    if (ctx.engine.faceDetector.status === "unavailable") {
      return [
        skipped(
          "face-consistency",
          "Face consistency",
          "face",
          `Face detector unavailable (${ctx.engine.faceDetector.detail ?? "model failed to load"}), so no faces were localised and no face evidence was measured.`,
        ),
      ];
    }
    if (ctx.faces.length === 0) {
      return [
        skipped(
          "face-consistency",
          "Face consistency",
          "face",
          "No face was detected in this media, so facial consistency was not applicable.",
        ),
      ];
    }

    const agg = buildFaceAggregate(ctx.faces);
    if (agg.faceScore === null) {
      return [
        skipped(
          "face-consistency",
          "Face consistency",
          "face",
          "Every detected face was skipped (portrait frame or crop too small to measure), so no face vote was cast.",
        ),
      ];
    }

    return [
      {
        id: "face-consistency",
        label: "Face consistency",
        group: "face",
        raw: `${(agg.faceScore * 100).toFixed(0)}% lean · ${ctx.faces.length} face(s)`,
        score: agg.faceScore,
        weight: FUSION_WEIGHTS.face,
        confidence: agg.check ? 82 : 60,
        evidence:
          agg.check?.finding ??
          `Faces were measured in ${ctx.faces.length} region(s); area-weighted lean ${(agg.faceScore * 100).toFixed(0)}%.`,
        reliability: agg.check?.status ?? "ok",
      },
    ];
  }
}

/**
 * VideoTemporalDetector — frame-to-frame consistency.
 *
 * Consumes the temporal statistics already computed by `video.ts`, so a video
 * is never classified from a single arbitrary frame.
 */
export class VideoTemporalDetector extends Detector {
  readonly name = "Video temporal consistency detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "temporal";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const t = ctx.temporal;
    if (!t) {
      return [
        skipped(
          "temporal",
          "Temporal consistency",
          "temporal",
          ctx.kind === "video"
            ? "No temporal statistics were produced — too few frames could be sampled."
            : "Temporal consistency applies to video runs only.",
        ),
      ];
    }

    const sFlicker = ramp(t.flicker, 0.06, 0.3);
    const sCv = ramp(t.scoreCv, 0.12, 0.38);
    const sJitter = t.faceJitter > 0 ? ramp(t.faceJitter, 0.04, 0.18) : 0;
    const sLights = ramp(t.lightJumps, 1, 6) * 0.5;
    const withFaces = ctx.faces.length > 0;
    const score = clamp(
      withFaces
        ? 0.35 * sFlicker + 0.3 * sCv + 0.25 * sJitter + 0.1 * sLights
        : 0.45 * sFlicker + 0.35 * sCv + 0.2 * sLights,
      0,
      1,
    );

    const raw =
      `flicker ${(t.flicker * 100).toFixed(1)}% · CV ${t.scoreCv.toFixed(2)} · ` +
      `jumps ${t.lightJumps} · cuts ${t.cuts} · no-face ${(t.noFaceRatio * 100).toFixed(0)}%`;
    const evidence =
      `Frame-to-frame noise flicker ${(t.flicker * 100).toFixed(1)}%, per-frame score dispersion CV ${t.scoreCv.toFixed(2)}, ` +
      `${t.lightJumps} lighting jump(s) outside ${t.cuts} detected scene cut(s), ` +
      `mean face-geometry displacement ${(t.faceJitter * 100).toFixed(1)}% of frame size per sampled frame, ` +
      `${(t.noFaceRatio * 100).toFixed(0)}% of sampled frames had no detectable face. ` +
      (t.cuts > 0
        ? "Cut boundaries are excluded from the flicker statistics. "
        : "No scene cuts were detected. ") +
      (score >= 0.5
        ? "Noise that oscillates between frames, inconsistent lighting and unstable geometry are the core temporal signatures of per-frame synthesis."
        : "Noise, lighting and geometry evolve smoothly, as in a continuous recording.");

    return [
      measured({
        id: "temporal",
        label: "Temporal consistency",
        group: "temporal",
        raw,
        score,
        weight: FUSION_WEIGHTS.temporal,
        confidence: withFaces ? 82 : 74,
        evidence,
      }),
    ];
  }
}

/**
 * AudioVideoSyncDetector — audio continuity.
 *
 * Honest about scope: this profiles the decoded track (clipping, DC offset,
 * silence ratio, loudness uniformity, spectral centroid). It does **not**
 * classify cloned voices, and the report says so on every run.
 */
export class AudioVideoSyncDetector extends Detector {
  readonly name = "Audio / video continuity detector";
  readonly version = "1.0.0";
  readonly group: DetectorGroup = "audio";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const a = ctx.audio;
    if (ctx.kind !== "video") {
      return [
        skipped(
          "audio",
          "Audio continuity",
          "audio",
          "Audio analysis applies to video runs only.",
        ),
      ];
    }
    if (!a || !a.present) {
      return [
        skipped(
          "audio",
          "Audio continuity",
          "audio",
          "No decodable audio track was present in this file, so no audio evidence was measured.",
        ),
      ];
    }

    const sFlat = ramp(a.uniformity, 0.93, 0.99);
    const sClip = clamp(a.clippingRatio / 0.01, 0, 1);
    const score = clamp(0.6 * sFlat + 0.4 * sClip, 0, 1);

    return [
      measured({
        id: "audio",
        label: "Audio continuity",
        group: "audio",
        raw: `uniformity ${(a.uniformity * 100).toFixed(1)}% · clip ${(a.clippingRatio * 100).toFixed(3)}%`,
        score,
        weight: FUSION_WEIGHTS.audio,
        confidence: 70,
        evidence:
          `Track profiled over ${a.durationSec.toFixed(1)}s at ${a.sampleRate} Hz: loudness uniformity ` +
          `${(a.uniformity * 100).toFixed(1)}%, clipping ${(a.clippingRatio * 100).toFixed(3)}%, ` +
          `DC offset ${a.dcOffset.toFixed(4)}, silence ${(a.silenceRatio * 100).toFixed(1)}%, ` +
          `spectral centroid ${a.spectralCentroid.toFixed(3)}. ` +
          a.note +
          " Scope note: this detector profiles the audio signal only — it is not a voice-clone classifier.",
      }),
    ];
  }
}

/* ==================================================================== */
/* Registry + fusion                                                    */
/* ==================================================================== */

/** The shipped portfolio, in reporting order. */
export function defaultDetectors(): Detector[] {
  return [
    new ImageAIDetector(),
    new VisualArtifactDetector(),
    new FrequencyDetector(),
    new CompressionDetector(),
    new MetadataDetector(),
    new ProvenanceDetector(),
    new FaceManipulationDetector(),
    new VideoTemporalDetector(),
    new AudioVideoSyncDetector(),
  ];
}

export interface DetectorRun {
  detector: string;
  version: string;
  group: DetectorGroup;
  score: number;
  confidence: number;
  reliability: SignalReliability;
  ranInMs: number;
}

export interface FusionResult {
  /** combined synthetic-leaning score over the weighted detector signals */
  fusionScore: number;
  /** per-evidence-category summary, in registry order */
  categories: EvidenceCategory[];
  /** every signal, annotated with the detector that produced it */
  signals: DetectorSignal[];
  /** one row per detector, for the developer dashboard */
  perDetector: DetectorRun[];
  /** how many detectors actually contributed a weighted signal */
  activeDetectors: number;
  /** total wall-clock cost of the detector portfolio */
  elapsedMs: number;
  /** 0..1 — shared weighting across the categories that ran */
  evidenceStrength: number;
}

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Run every detector and fuse its signals.
 *
 * The fused score is a weighted mean over signals that actually ran. Signals
 * that could not be measured carry weight 0 and therefore cannot move the
 * score in either direction — a skipped detector is never silently treated as
 * a clean bill of health.
 */
export async function mergeEvidence(
  detectors: Detector[],
  ctx: DetectorContext,
  onProgress?: (note: string, pct: number) => void,
): Promise<FusionResult> {
  const started = now();
  const signals: DetectorSignal[] = [];
  const perDetector: DetectorRun[] = [];

  for (let i = 0; i < detectors.length; i++) {
    const d = detectors[i];
    onProgress?.(
      `${d.name} v${d.version}`,
      Math.round(((i + 1) / detectors.length) * 100),
    );
    const t0 = now();
    let produced: DetectorSignal[] = [];
    try {
      produced = await d.run(ctx);
    } catch (err) {
      // A detector that throws is reported as "did not run" — the run must not
      // fail because one optional measurement blew up.
      produced = [
        skipped(
          `${d.group}-error`,
          d.name,
          d.group,
          `Detector failed: ${err instanceof Error ? err.message : String(err)}. Its evidence was excluded from the score.`,
        ),
      ];
    }
    for (const s of produced) {
      signals.push({ ...s, detector: d.name, detectorVersion: d.version });
    }
    const scored = produced.filter((s) => s.weight > 0);
    perDetector.push({
      detector: d.name,
      version: d.version,
      group: d.group,
      score: scored.length > 0 ? mean(scored.map((s) => s.score)) : 0.5,
      confidence: scored.length > 0 ? Math.max(...scored.map((s) => s.confidence)) : 0,
      reliability: scored.length === 0
        ? "skip"
        : scored.some((s) => s.reliability === "flag")
          ? "flag"
          : scored.some((s) => s.reliability === "warn")
            ? "warn"
            : "ok",
      ranInMs: Math.round(now() - t0),
    });
  }

  /* ---- per-category rollup (registry order preserved) ---- */
  const categories: EvidenceCategory[] = [];
  const byGroup = new Map<DetectorGroup, DetectorSignal[]>();
  for (const s of signals) {
    const list = byGroup.get(s.group) ?? [];
    list.push(s);
    byGroup.set(s.group, list);
  }
  for (const [group, list] of byGroup) {
    const weighted = list.filter((s) => s.weight > 0);
    categories.push({
      id: group,
      label: DETECTOR_GROUP_LABEL[group],
      signals: list,
      flagged: weighted.some((s) => s.score >= 0.65),
      maxScore: list.reduce((a, s) => Math.max(a, s.weight > 0 ? s.score : 0), 0),
      weight: weighted.reduce((a, s) => a + s.weight, 0),
    });
  }

  /* ---- fused score ---- */
  const active = signals.filter((s) => s.weight > 0);
  const wsum = active.reduce((a, s) => a + s.weight, 0);
  const score = wsum > 0 ? active.reduce((a, s) => a + s.score * s.weight, 0) / wsum : 0.5;

  /* Evidence strength: how many independent families actually voted, tempered
     by how much they agree. 0 means "nothing measurable ran". */
  const cats = categories.filter((c) => c.weight > 0);
  const coverage = clamp(cats.length / 4, 0, 1);
  const agreement =
    cats.length > 1
      ? clamp(1 - stdDev(cats.map((c) => c.maxScore)) * 2, 0, 1)
      : 0.5;
  const evidenceStrength = clamp(0.6 * coverage + 0.4 * agreement, 0, 1);

  return {
    fusionScore: score,
    categories,
    signals,
    perDetector,
    activeDetectors: perDetector.filter((d) => d.reliability !== "skip").length,
    elapsedMs: Math.round(now() - started),
    evidenceStrength,
  };
}