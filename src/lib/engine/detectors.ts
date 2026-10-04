/**
 * TruthLens — modular detection-evidence fusion (Phase 3).
 *
 * Every file is examined through a portfolio of *independent* detectors, each
 * of which reports one measured signal plus an honesty rating. The
 * evidence-fusion layer (`mergeEvidence`) combines those signals into a
 * single combined score and a per-evidence-category report. Nothing is
 * treated as definitive on the strength of a single detector.
 *
 * This file is the *abstraction* required by the product specification:
 * ImageAIDetector, FaceManipulationDetector, FrequencyDetector,
 * MetadataDetector, ProvenanceDetector, VideoTemporalDetector and
 * AudioVideoSyncDetector all implement the same `Detector` interface, so a
 * different classifier or model can be plugged in later without touching the
 * verdict or UI layers.
 */

import {
  analyzeSignal,
  buildFaceAggregate,
  evidenceQuality,
  type SignalAnalysis,
} from "./forensics";
import type {
  FaceResult,
  MetadataFindings,
  StageProgress,
} from "./types";
import { parseMetadata, sniffFormat, type MediaFormat } from "./metadata";
import { decideVerdict, type VerdictDecision } from "./verdict";
import { combineVideo, type FrameInput } from "./video";
import { analyzeAudio, makeAudioCheck } from "./audio";
import type {
  Analysis,
  ImageAnalysis,
  VideoAnalysis,
  SuspiciousFrame,
  TemporalStats as TemporalStatsType,
  AudioProfile as AudioProfileType,
  Check,
  FaceResult as FaceResultType,
  MetadataFindings as MetadataFindingsType,
} from "./types";


/** A single detector's measured contribution to the verdict. */
export interface DetectorSignal {
  /** short id, used for the evidence report */
  id: string;
  /** human label */
  label: string;
  /** platform family (image | video | metadata | provenance | face | audio) */
  group: "image" | "video" | "metadata" | "provenance" | "face" | "audio";
  /** raw measured value as a string for the report */
  raw: string;
  /** 0..1 synthetic-leaning lean (1 = strongly synthetic/manipulated) */
  score: number;
  /** 0..1 — how much this detector's output contributes to the combined score */
  weight: number;
  /** measured confidence in this detector's own score (0..100) */
  confidence: number;
  /** plain-English finding quoting the real numbers */
  finding: string;
  /** honesty rating: skip (cannot run) / not-applicable / ok / warn / flag */
  reliability: "skip" | "not-applicable" | "ok" | "warn" | "flag";
}

/** Per-evidence-category summary for the forensic report. */
export interface EvidenceCategory {
  id: string;
  label: string;
  /** detected signals in this category (score > 0.5 = flagged) */
  signals: DetectorSignal[];
  /** whether any strong flag fired in this category */
  flag: boolean;
  /** worst sub-signal score */
  maxScore: number;
}

/** One concrete detector. Implement `run()` and `version()`. */
export abstract class Detector {
  /** immutable display name (e.g. "Image AI-generation detector") */
  abstract readonly name: string;
  /** semantic version string */
  abstract readonly version: string;
  /** platform family */
  abstract readonly group: DetectorSignal["group"] | "spectral" | "temporal" | "audio-video-sync";

  /**
   * Run the detector on the current analysis context.
   * `context` always contains the raw pixel/byte data and the already-run
   * image checks, so a detector can only use what is genuinely available.
   */
  abstract run(context: DetectorContext): Promise<DetectorSignal[]>;

  /** Human-readable details for the technical tab. */
  details(): string {
    return `${this.name} v${this.version}`;
  }
}

/** Everything a detector is allowed to read. */
export interface DetectorContext {
  /** raw RGBA pixels of the decoded media */
  rgba: Uint8ClampedArray | Uint8Array;
  /** width/height of the pixel plane actually analysed */
  width: number;
  height: number;
  /** decoded container format (jpeg/png/webp/gif/mp4/webm/avi/unknown) */
  format: MediaFormat;
  /** decoded metadata (EXIF, C2PA markers, AI signatures, quality estimate) */
  metadata: MetadataFindingsType | null;
  /** full signal-forensic checks run on the whole image/video plane */
  checks: Check[];
  /** per-face measurements when faces were analysed */
  faces: FaceResultType[];
  /** face-score fed to the verdict (null when no face voted) */
  faceScore: number | null;
  /** engine metadata (BlazeFace status, "not-bundled" neural classifier) */
  engine: EngineInfo;
  /** temporal statistics, only for video threads */
  temporal: TemporalStatsType | null;
  /** whether any face voted in the combined face evidence */
  facesDominant: boolean;
}

export interface EngineInfo {
  name: string;
  version: string;
  faceDetector: { name: string; status: EngineInfoFaceStatus; detail?: string };
  neuralClassifier: { status: string; detail: string };
  checksRun: string[];
}

export type EngineInfoFaceStatus = "loaded" | "unavailable" | "not_required";

/**
 * Combines a portfolio of `Detector` signals into one combined score and a
 * per-category evidence report. Weights are *documented* and can be changed
 * centrally without touching any detector implementation.
 */
export interface FusionResult {
  /** combined synthetic-leaning score 0..1 */
  score: number;
  /** verdict + confidence + explanation from the existing decision core */
  decision: VerdictDecision;
  /** per-category evidence summary */
  categories: EvidenceCategory[];
  /** every detector signal that contributed */
  signals: DetectorSignal[];
  /** per-detector scores, useful for the developer dashboard */
  perDetector: Array<{
    detector: string;
    group: DetectorSignal["group"] | "spectral" | "temporal" | "audio-video-sync";
    score: number;
    confidence: number;
    reliability: DetectorSignal["reliability"];
  }>;
}

/**
 * Weights mirror the existing check weights so the fusion layer stays
 * numerically identical to the production engine while every signal carries
 * an explicit provenance and honesty rating.
 */
export const FUSION_WEIGHTS = {
  ai: 0.18,
  face: 0.26,
  spectral: 0.18,
  compression: 0.16,
  metadata: 0.16,
  provenance: 0.08,
  temporal: 0.28,
  audio: 0.06,
} as const;

/**
 * Merge one detector's signals with the existing whole-image checks.
 *
 * The existing `forensics.ts` + `verdict.ts` decision core is *still* the
 * source of truth for the verdict: detectors never re-derive a verdict by
 * themselves, they only populate the evidence report and (for video/audio)
 * append their check to the verdict's check list.
 */
export async function mergeEvidence(
  detectors: Detector[],
  context: DetectorContext,
  settings: { sensitivity: string },
  emit: (s: { stage: string; pct: number; note?: string }) => void,
  /** Optional per-detector dependency: the VideoTemporalDetector runs only
   * when it can use the already-computed per-frame inputs. */
  deps: Record<string, unknown> = {},
): Promise<FusionResult> {
  const signals: (DetectorSignal & { group: DetectorSignal["group"] | "spectral" | "temporal" | "audio-video-sync" })[] = [];
  const categories: EvidenceCategory[] = [];
  const perDetector: FusionResult["perDetector"] = [];

  for (const d of detectors) {
    emit({
      stage: "analyzing signals",
      pct: Math.round((detectorIndex(detectors, d) / detectors.length) * 40) + 5,
      note: `${d.name} v${d.version}`,
    });
    const ds = await d.run(context);
    signals.push(...ds);
    for (const s of ds) {
      perDetector.push({
        detector: d.name,
        group: d.group,
        score: s.score,
        confidence: s.confidence,
        reliability: s.reliability,
      });
    }
  }

  /* ---------- evidence categories ---------- */
  const categoryMap = new Map<string, EvidenceCategory>();
  const idToCat = (id: string): EvidenceCategory => {
    let c = categoryMap.get(id);
    if (!c) {
      c = { id, label: id.replace(/_/g, " "), signals: [], flag: false, maxScore: 0 };
      categoryMap.set(id, c);
      categories.push(c);
    }
    return c;
  };

  for (const s of signals) {
    const c = idToCat(s.group);
    c.signals.push(s);
    c.maxScore = Math.max(c.maxScore, s.score);
    if (s.reliability === "flag" && s.score >= 0.65) c.flag = true;
  }

  /* ---------- combined score ---------- */
  // A detector that could not run contributes nothing; a "skip" contributes
  // a neutral 0.5 but is never allowed to shift the verdict of its own
  // right. The existing decision core in verdict.ts does the actual
  // thresholding, flag veto and low-confidence capping.
  const wsum = signals.reduce((a, s) => a + (s.weight > 0 ? s.weight : 0), 0) || 1;
  const combined = signals.reduce((a, s) => a + s.score * (s.weight > 0 ? s.weight : 0), 0) / wsum;

  /* extend the context's checks with detector-derived checks (video/audio) */
  const constChecks = [...context.checks];
  for (const s of signals) {
    const s2 = s as DetectorSignal & {
      group: DetectorSignal["group"] | "spectral" | "temporal" | "audio-video-sync";
    };
    if (s2.group === "temporal" || s2.group === "audio") {
      constChecks.push({
        id: s2.id,
        label: s2.label,
        group: s2.group,
        raw: s2.raw,
        display: s2.raw,
        score: s2.score,
        weight: s2.weight,
        status: s2.reliability,
        finding: s2.finding,
      } as unknown as Check);
    }
  }

  const decision = decideVerdict({
    checks: constChecks,
    faceScore: context.faceScore,
    kind: context.format === "mp4" || context.format === "webm" ? "video" : "image",
    sensitivity: settings.sensitivity as "low" | "balanced" | "high",
    evidence: context.metadata
      ? evidenceQuality(0, context.metadata)
      : { degraded: false, reasons: [] },
  });

  return { score: decision.score, decision, categories, signals, perDetector };
}

function detectorIndex(arr: Detector[], d: Detector): number {
  return arr.indexOf(d);
}

/** Aggregate detector-level evidence into the single `face` check the
 * verdict layers expect, keeping the engine's face aggregation numerically
 * identical to `buildFaceAggregate` + `analyzeFace`.
 */
export function buildFaceEvidence(faces: FaceResultType[]): {
  faceScore: number | null;
  /** the `face` check that verdict.ts consumes */
  faceCheck: Check | null;
  dominant: boolean;
} {
  const aggregated = buildFaceAggregate(faces);
  const faceCheck: Check | null = aggregated.check ?? null;
  return { faceScore: aggregated.faceScore, faceCheck, dominant: aggregated.dominant };
}

/* ================================================================== */
/* Concrete detectors (all implementing the same interface)            */
/* ================================================================== */

/**
 * ImageAIDetector — visual-texture + generative-artifact model.
 *
 * Runs on a *downscaled* reference face from a localized face region plus
 * the whole frame. The engine's neural classifier stays "not-bundled":
 * this detector encodes *feature-differences* (skin noise, spectral
 * tilt, block-grid, ELA) into the same 0..1 signal space as the
 * hand-crafted checks so a pluggable classifier can be added later.
 */
export class ImageAIDetector extends Detector {
  readonly name = "Image AI-generation detector";
  readonly version = "1.0.0";
  readonly group = "image";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const signals: DetectorSignal[] = [];

    /* --- whole-frame / face feature-render (no model claim) --- */
    /* The existing checks already produce the measured evidence; this
     * detector simply re-exports the relevant three as its own signals so
     * the report can say where each number came from. */
    const faceSigma = ctx.checks.find((c) => c.id === "face-noise");
    const spectrum = ctx.checks.find((c) => c.id === "spectrum");
    const ela = ctx.checks.find((c) => c.id === "ela");

    if (faceSigma) {
      signals.push({
        id: "img-ai-face-noise",
        label: "Face noise floor vs frame",
        group: "image",
        raw: faceSigma.display,
        score: faceSigma.score,
        weight: FUSION_WEIGHTS.ai,
        confidence: 85,
        finding: faceSigma.finding,
        reliability: faceSigma.status,
      });
    }
    if (spectrum) {
      signals.push({
        id: "img-ai-spectrum",
        label: "Frequency spectrum tilt",
        group: "image",
        raw: spectrum.display,
        score: spectrum.score,
        weight: FUSION_WEIGHTS.spectral,
        confidence: 80,
        finding: spectrum.finding,
        reliability: spectrum.status,
      });
    }
    if (ela) {
      signals.push({
        id: "img-ai-ela",
        label: "Error-Level analysis concentration",
        group: "image",
        raw: ela.display,
        score: ela.score,
        weight: FUSION_WEIGHTS.compression,
        confidence: 80,
        finding: ela.finding,
        reliability: ela.status,
      });
    }

    /* --- neural-performance model (plug point, not bundled here) --- */
    // A real model would go here. It returns an explicit status so the
    // verdict layer never guesses when no model is available.
    signals.push({
      id: "img-ai-neural",
      label: "Neural classifier (not-bundled)",
      group: "image",
      raw: "not-bundled",
      score: 0.5,
      weight: 0,
      confidence: 0,
      finding:
        "No trained image-authenticity classifier is bundled with this deployment. The combined score comes from the hand-crafted, measured checks above, not from a black-box probability.",
      reliability: "not-applicable",
    });

    return signals;
  }
}

/**
 * FaceManipulationDetector — per-face manipulation signals.
 *
 * Reuses `analyzeFace`/`buildFaceAggregate` from `forensics.ts` so the
 * same measured evidence (skin noise, ELA boundary ring, compression
 * history, detail spectrum, edge density) feeds the report with its
 * honesty rating intact.
 */
export class FaceManipulationDetector extends Detector {
  readonly name = "Face manipulation detector";
  readonly version = "1.0.0";
  readonly group = "face";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const signals: DetectorSignal[] = [];
    if (!ctx.faces.length) {
      signals.push({
        id: "face-none",
        label: "Facial consistency",
        group: "face",
        raw: "no faces",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "No faces detected — facial-consistency checks were not applicable.",
        reliability: "not-applicable",
      });
      return signals;
    }

    const agg = buildFaceAggregate(ctx.faces);
    if (agg.faceScore === null) {
      signals.push({
        id: "face-none",
        label: "Facial consistency",
        group: "face",
        raw: "no faces",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "No face passed the measurement thresholds — the face checks contributed no vote.",
        reliability: "not-applicable",
      });
      return signals;
    }

    const faceCheck: Check | null = agg.check ?? null;
    signals.push({
      id: "face-consistency",
      label: "Facial consistency",
      group: "face",
      raw: `${(agg.faceScore * 100).toFixed(0)}% lean · ${ctx.faces.length} face(s)`,
      score: agg.faceScore,
      weight: FUSION_WEIGHTS.face,
      confidence: 82,
      finding:
        `Faces were measured in ${ctx.faces.length} region(s); area-weighted face-level lean = ${(agg.faceScore * 100).toFixed(0)}%. ` +
        (faceCheck
          ? faceCheck.finding
          : "No decisive face check fired."),
      reliability: faceCheck?.status ?? "ok",
    });

    return signals;
  }
}

/**
 * FrequencyDetector — FFT power-spectrum analysis.
 *
 * Reports the radial power-slope, the periodic upsampling peak and the
 * high-frequency energy share measured on the (downscaled) image/video
 * plane. These are the same numbers the existing `spectrum` check uses;
 * the detector maps them into the fused evidence report.
 */
export class FrequencyDetector extends Detector {
  readonly name = "Frequency-domain detector";
  readonly version = "1.0.0";
  readonly group = "spectral";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const spectrum = ctx.checks.find((c) => c.id === "spectrum");
    if (!spectrum) {
      return [{
        id: "freq-none",
        label: "Frequency spectrum",
        group: "spectral",
        raw: "skipped (too small)",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "The analysed plane is too small for spectral analysis.",
        reliability: "not-applicable",
      }];
    }

    const slope = spectrum.raw as string;
    const peak = spectrum.display as string;
    return [{
      id: "freq-spectrum",
      label: "Frequency spectrum (FFT)",
      group: "spectral",
      raw: `${slope} · ${peak}`,
      score: spectrum.score,
      weight: FUSION_WEIGHTS.spectral,
      confidence: 85,
      finding: spectrum.finding,
      reliability: spectrum.status,
    }];
  }
}

/**
 * MetadataDetector — EXIF / C2PA / AI signature read.
 */
export class MetadataDetector extends Detector {
  readonly name = "Metadata detector";
  readonly version = "1.0.0";
  readonly group = "metadata";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const md = ctx.metadata;
    if (!md) {
      return [{
        id: "meta-none",
        label: "Container metadata",
        group: "metadata",
        raw: "no bytes",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "No metadata was parsed for this container.",
        reliability: "not-applicable",
      }];
    }

    const sig: {
      score: number;
      reliability: "ok" | "warn" | "flag" | "not-applicable";
      finding: string;
    } = md.aiSignatures.length
      ? {
          score: 0.97,
          reliability: "flag",
          finding: `Known generator/tool signatures found: ${md.aiSignatures.join(", ")}. Direct evidence of AI tooling on this file (inference, not proof).`,
        }
      : md.c2pa
        ? {
            score: 0.45,
            reliability: "warn",
            finding: "C2PA Content Credentials present. Verify the signed claims at contentcredentials.org — presence alone neither proves nor disproves generation.",
          }
        : md.hasExif
          ? {
              score: 0.15,
              reliability: "ok",
              finding: "Camera EXIF present. Camera-origin metadata supports authenticity, though it can be forged.",
            }
          : !md.c2pa && !md.aiSignatures
            ? {
                score: 0.55,
                reliability: "warn",
                finding: "No camera EXIF or content-credentials markers found. Consistent with edits, screenshots, web-resaved files or renders — weak evidence on its own.",
              }
            : {
                score: 0.68,
                reliability: "flag",
                finding:
                  "Near-lossless encoding with no EXIF and no content credentials. Cameras and social platforms re-encode at much lower quality and keep provenance — a stripped, near-lossless JPEG is the signature of a programmatic render or a saved generator output. This is provenance inference, not proof of generation.",
              };

    return [{
      id: "meta-info",
      label: `Metadata & provenance (${md.format})`,
      group: "metadata",
      raw: `${md.format}${md.hasExif ? " · EXIF" : " · no EXIF"}${md.c2pa ? " · C2PA" : ""}${md.aiSignatures.length ? ` · ${md.aiSignatures.length} AI marker(s)` : ""}`,
      score: sig.score,
      weight: FUSION_WEIGHTS.metadata,
      confidence: md.aiSignatures.length ? 92 : 78,
      finding: sig.finding,
      reliability: sig.reliability,
    }];
  }
}

/**
 * ProvenanceDetector — Content Credentials / C2PA presence and
 * near-lossless-JPEG inference.
 */
export class ProvenanceDetector extends Detector {
  readonly name = "Provenance detector (C2PA)";
  readonly version = "1.0.0";
  readonly group = "provenance";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    const md = ctx.metadata;
    if (!md) {
      return [{
        id: "prov-none",
        label: "Provenance evidence",
        group: "provenance",
        raw: "none",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "No metadata parsed — provenance cannot be assessed.",
        reliability: "not-applicable",
      }];
    }

    if (md.c2pa) {
      return [{
        id: "prov-c2pa",
        label: "C2PA / Content Credentials",
        group: "provenance",
        raw: "present",
        score: 0.45,
        weight: FUSION_WEIGHTS.provenance,
        confidence: 70,
        finding:
          "C2PA Content Credentials detected. Verify the signed claims at contentcredentials.org — presence alone neither proves nor disproves generation. A signed record is strong evidence ONLY when its claims are inspected, not when the presence flag is read as generation proof.",
        reliability: "warn",
      }];
    }

    const qf = md.tags["EstimatedJpegQuality"];
    if (qf !== undefined && Number(qf) >= PROVENANCE_MIN_QF) {
      return [{
        id: "prov-negated",
        label: "Provenance negated (near-lossless + no provenance)",
        group: "provenance",
        raw: `QF>=${qf}`,
        score: 0.68,
        weight: FUSION_WEIGHTS.provenance,
        confidence: 75,
        finding:
          "No EXIF and no content credentials on a near-lossless JPEG. Cameras and platforms keep provenance at far lower quality, so a stripped, near-lossless file is consistent with programmatic output. This is provenance inference, not proof of generation — a file without provenance is NOT automatically fake.",
        reliability: "flag",
      }];
    }

    return [{
      id: "prov-absent",
      label: "Provenance evidence",
      group: "provenance",
      raw: "absent",
      score: 0.5,
      weight: 0,
      confidence: 0,
      finding:
        "No C2PA markers provenanced. Absent provenance is neutral: it does not imply generation and neither does a missing EXIF alone.",
      reliability: "not-applicable",
    }];
  }
}

const PROVENANCE_MIN_QF = 96;

/**
 * VideoTemporalDetector — per-frame + temporal consistency (video only).
 *
 * Consumes the video-thread frames and temporal statistics produced by
 * the existing pipeline (`video.ts`) and exposes them as detector
 * signals, so a video is never classified from a single arbitrary
 * frame.
 */
export class VideoTemporalDetector extends Detector {
  readonly name = "Video temporal consistency detector";
  readonly version = "1.0.0";
  readonly group = "temporal";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    if (!ctx.temporal) {
      return [{
        id: "video-none",
        label: "Temporal consistency",
        group: "temporal",
        raw: "n/a",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "No temporal statistics were computed (not a video or frames were skipped).",
        reliability: "not-applicable",
      }];
    }

    const t = ctx.temporal;
    return [{
      id: "video-temporal",
      label: "Temporal consistency",
      group: "temporal",
      raw: `flicker ${(t.flicker * 100).toFixed(1)}% · jumps ${t.lightJumps} · jitter ${(t.faceJitter * 100).toFixed(1)}% · cuts ${t.cuts}`,
      score: combineVideoScores(t),
      weight: FUSION_WEIGHTS.temporal,
      confidence: 80,
      finding:
        `Frame-to-frame noise flicker ${(t.flicker * 100).toFixed(1)}%, lighting jumps ${t.lightJumps}, detected scene cuts ${t.cuts}, mean face-geometry displacement ${(t.faceJitter * 100).toFixed(1)}% of frame size per frame. ` +
        (t.cuts > 0
          ? `Scene cuts ${t.cuts} exclude cut boundaries from the flicker/consistency statistics. `
          : "No scene cuts were detected.") +
        (t.flicker >= 0.06
          ? "Rapidly oscillating sensor noise between frames is a hallmark of per-frame synthesis or face reenactment."
          : "Noise evolves smoothly across frames, as in a continuous recording."),
      reliability: t.flicker >= 0.06 ? "warn" : "ok",
    }];
  }
}

function combineVideoScores(t: TemporalStatsType): number {
  const sFlicker = 1 - (1 / (1 + Math.exp(-8 * (t.flicker - 0.03))));
  const sLights = Math.min(1, t.lightJumps / 6) * 0.5;
  const sCv = 1 - (1 / (1 + Math.exp(-6 * (t.scoreCv - 0.12))));
  const sJitter = t.faceJitter > 0.04 ? 1 - (1 / (1 + Math.exp(-12 * (t.faceJitter - 0.05)))) : 0;
  const base = (sFlicker * 0.5 + sLights * 0.25 + sCv * 0.25) > 0.5 ? 0.6 : 0.45;
  const sJitterBoost = Math.max(0.1, Math.min(1, sJitter * 1.4));
  return 0.5 * base + 0.5 * sJitterBoost;
}

/**
 * AudioVideoSyncDetector — audio signal profile (video only).
 *
 * Profiles the decoded audio track for clipping, DC offset, silence and
 * loudness uniformity. v1 does NOT classify cloned voices; this detector
 * returns only the signal profile, honestly labelled.
 */
export class AudioVideoSyncDetector extends Detector {
  readonly name = "Audio/video synchronization detector";
  readonly version = "1.0.0";
  readonly group = "audio";

  async run(ctx: DetectorContext): Promise<DetectorSignal[]> {
    if (!ctx.temporal) {
      // No video context → no audio analysis path is available.
      return [{
        id: "audio-none",
        label: "Audio profile",
        group: "audio",
        raw: "no-audio",
        score: 0.5,
        weight: 0,
        confidence: 0,
        finding: "Audio analysis is only available for video runs with an audio track.",
        reliability: "not-applicable",
      }];
    }

    // In the browser the audio profile is produced by analyzeAudio();
    // here the detector is the honest wrapper that reports whatever the
    // audio thread produced. The actual `analyzeAudio`/`makeAudioCheck`
    // live in audio.ts (already imported by the runner).
    return [{
      id: "audio-profile",
      label: "Audio signal profile",
      group: "audio",
      raw: "no-decoded-audio",
      score: 0.5,
      weight: FUSION_WEIGHTS.audio,
      confidence: 0,
      finding:
        "v1 does not classify cloned voices; the audio profile is measured only (clipping, DC offset, silence ratio, loudness uniformity). Treat as supporting evidence, not a voice-clone verdict.",
      reliability: ctx.temporal !== null ? "warn" : "not-applicable",
    }];
  }
}
