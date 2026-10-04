/**
 * TruthLens engine — shared result types.
 *
 * Everything the engine reports is measured from the actual pixels/bytes of
 * the file under analysis. No values are randomized or hard-coded: if a check
 * cannot run (missing face model, decode failure, codec unavailable) it is
 * marked "skip" / listed in `warnings` instead of being invented.
 */

/**
 * The engine reports THREE outcomes plus a failure state — never a forced
 * binary. `inconclusive` is a first-class result: when the evidence is weak,
 * degraded, or the detectors disagree, that is what is reported.
 */
export type Verdict =
  | "real"
  | "inconclusive"
  | "likely_ai"
  | "likely_deepfake"
  | "error";

/** Which of the three outcomes a verdict maps to. */
export type Outcome = "authentic" | "synthetic" | "inconclusive" | "error";

/**
 * One measured signal as reported by a detector in the fusion layer.
 * Mirrors `DetectorSignal` in detectors.ts, duplicated here so the persisted
 * analysis payload stays a plain serialisable shape with no cross-imports.
 */
export interface EvidenceSignal {
  id: string;
  label: string;
  /** evidence family */
  group: string;
  /** human-formatted measured value */
  raw: string;
  /** 0..1 synthetic-leaning lean */
  score: number;
  /** 0..1 fusion weight; 0 means "did not run" */
  weight: number;
  /** 0..100 confidence in this signal */
  confidence: number;
  /** plain-English evidence quoting the real measured numbers */
  evidence: string;
  /** "skip" | "not-applicable" | "ok" | "warn" | "flag" */
  reliability: "skip" | "not-applicable" | "ok" | "warn" | "flag";
  detector?: string;
  detectorVersion?: string;
}

/** Roll-up of every signal in one evidence family, for the report. */
export interface EvidenceCategoryReport {
  id: string;
  label: string;
  signals: EvidenceSignal[];
  flagged: boolean;
  maxScore: number;
  weight: number;
}

/** Per-detector row for the developer/evaluation dashboard. */
export interface DetectorRunReport {
  detector: string;
  version: string;
  group: string;
  score: number;
  confidence: number;
  reliability: EvidenceSignal["reliability"];
  ranInMs: number;
}

/**
 * The evidence block attached to every analysis. This is what makes the report
 * explainable: every number in the verdict can be traced to a signal here.
 */
export interface EvidenceReport {
  /** weighted-mean fused score over the signals that actually ran (0..1) */
  fusionScore: number;
  categories: EvidenceCategoryReport[];
  signals: EvidenceSignal[];
  perDetector: DetectorRunReport[];
  /** how many detectors contributed a weighted signal */
  activeDetectors: number;
  /** 0..1 evidence strength (coverage tempered by agreement) */
  evidenceStrength: number;
  /** wall-clock cost of the detector portfolio */
  elapsedMs: number;
}

export type Sensitivity = "low" | "balanced" | "high";

export interface AnalysisSettings {
  sensitivity: Sensitivity;
  /** video only: frames sampled per second (default 2) */
  frameRate: number;
  /** video only: hard cap on sampled frames (default 90) */
  maxFrames: number;
  enableEla: boolean;
  enableMetadata: boolean;
  enableAudio: boolean;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  sensitivity: "balanced",
  frameRate: 2,
  maxFrames: 90,
  enableEla: true,
  enableMetadata: true,
  enableAudio: true,
};

export type CheckStatus = "ok" | "flag" | "warn" | "skip";

export type CheckGroup =
  | "signal"
  | "spectral"
  | "compression"
  | "metadata"
  | "face"
  | "temporal"
  | "audio";

/** One measured forensic check with its raw value and interpretation. */
export interface Check {
  id: string;
  label: string;
  group: CheckGroup;
  /** measured raw value, units depend on the check */
  raw: number;
  /** human-formatted raw value */
  display: string;
  /** 0..1 — how much this measurement leans toward synthetic/manipulated */
  score: number;
  /** 0..1 — how much this check contributes to the combined score */
  weight: number;
  status: CheckStatus;
  /** plain-English interpretation containing the real measured numbers */
  finding: string;
}

export interface FaceBox {
  /** normalized to image dimensions, 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceResult {
  index: number;
  box: FaceBox;
  /** 0..1 manipulation-leaning score for this face */
  score: number;
  /** 0..100 confidence in this face's score */
  confidence: number;
  checks: Check[];
}

export interface MetadataFindings {
  format: string;
  hasExif: boolean;
  software: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  dateTime: string | null;
  c2pa: boolean;
  c2paDetail: string | null;
  aiSignatures: string[];
  warnings: string[];
  tags: Record<string, string>;
}

export interface EngineInfo {
  name: string;
  version: string;
  faceDetector: {
    name: string;
    status: "loaded" | "unavailable" | "not_required";
    detail?: string;
  };
  neuralClassifier: { status: string; detail: string };
  checksRun: string[];
}

/**
 * The three-way verdict block. Shared by image and video analyses so the UI and
 * the report renderer read exactly the same fields regardless of media type.
 */
export interface VerdictBlock {
  verdict: Verdict;
  /** which of the three outcomes this maps to */
  outcome: Outcome;
  /** 0..100, always below 100 — no detector is perfect */
  confidence: number;
  /** combined synthetic-leaning score, 0..1 */
  score: number;
  /** 0..100 — how close this call sits to a decision boundary */
  uncertainty: number;
  /** 0..1 — how much independent measured evidence stood behind the call */
  evidenceStrength: number;
  /** confidence sits inside the 40–60% band */
  uncertainBand: boolean;
  /** why the run is inconclusive; null when the call is firm */
  inconclusiveReason: string | null;
  explanation: string[];
}

export interface ImageAnalysis extends VerdictBlock {
  kind: "image";
  checks: Check[];
  faces: FaceResult[];
  metadata: MetadataFindings | null;
  engine: EngineInfo;
  /** per-detector evidence breakdown (optional for legacy stored rows) */
  evidence?: EvidenceReport;
  warnings: string[];
  processingTimeMs: number;
  dimensions: { width: number; height: number };
  hash?: string;
}

export interface TimelinePoint {
  /** seconds */
  t: number;
  /** 0..1 */
  score: number;
}

export interface FrameMetrics {
  noise: number;
  luma: number;
  freq: number;
}

export interface FrameResult {
  index: number;
  t: number;
  score: number;
  faceScore: number | null;
  faces: number;
  metrics: FrameMetrics;
}

export interface SuspiciousFrame {
  index: number;
  t: number;
  score: number;
  imageId?: string;
  heatId?: string;
}

export interface TemporalStats {
  /** normalized frame-to-frame noise flicker */
  flicker: number;
  /** dispersion of per-frame scores */
  scoreCv: number;
  /** count of detected lighting jumps (excluding scene cuts) */
  lightJumps: number;
  /** scene cuts detected — pairs across cuts are excluded from flicker */
  cuts: number;
  /** mean normalized face-box displacement per frame pair */
  faceJitter: number;
  /** fraction of sampled frames with no detectable face */
  noFaceRatio: number;
}

export interface AudioProfile {
  present: boolean;
  durationSec: number;
  sampleRate: number;
  clippingRatio: number;
  dcOffset: number;
  silenceRatio: number;
  /** normalized spectral centroid of the loudest segment (0..1) */
  spectralCentroid: number;
  /** 0..1 — how uniform loudness is across segments (1 = perfectly flat) */
  uniformity: number;
  note: string;
}

export interface VideoAnalysis extends VerdictBlock {
  kind: "video";
  checks: Check[];
  faces: FaceResult[];
  timeline: TimelinePoint[];
  frames: FrameResult[];
  suspiciousFrames: SuspiciousFrame[];
  temporal: TemporalStats;
  audio: AudioProfile | null;
  metadata: MetadataFindings | null;
  engine: EngineInfo;
  /** per-detector evidence breakdown (optional for legacy stored rows) */
  evidence?: EvidenceReport;
  warnings: string[];
  processingTimeMs: number;
  durationSec: number;
  frameCount: number;
  dimensions: { width: number; height: number };
  hash?: string;
}

export type Analysis = ImageAnalysis | VideoAnalysis;

export interface AnalysisArtifacts {
  previewDataUrl?: string;
  heatmapDataUrl?: string;
  elaDataUrl?: string;
  frameArtifacts?: { t: number; score: number; imageDataUrl?: string; heatDataUrl?: string }[];
}

export interface StageProgress {
  stage:
    | "validating"
    | "hashing"
    | "decoding"
    | "faces"
    | "forensics"
    | "extracting frames"
    | "analyzing frames"
    | "temporal"
    | "audio"
    | "report";
  pct: number;
  note?: string;
}
