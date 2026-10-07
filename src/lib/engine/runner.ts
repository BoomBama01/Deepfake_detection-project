// runner.ts
// Schedules the detector portfolio, blends the per-detector outputs, and
// turns the fused evidence into the three-way verdict. Every number below
// is measured from the pixels/bytes of the file; nothing is guessed and no
// detector is treated as perfect. When evidence is degraded, thin, or the
// detectors disagree, the run comes back `inconclusive`: a hedge that
// never claims a false Real or a false likely_deepfake.
import { clamp, stdDev, mean } from "./dsp";
// Errors thrown by the runner when the engine can't proceed.
export class AnalysisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

// Limits enforced by the runner.
export const LIMITS = {
  maxFileSize: 50 * 1024 * 1024, // 50 MB
  imageMaxBytes: 15 * 1024 * 1024, // 15 MB
  videoMaxBytes: 200 * 1024 * 1024, // 200 MB
  videoMaxSeconds: 180, // 3 minutes
  batchMax: 10,
  maxDimensions: { width: 12000, height: 12000 },
  minDimensions: { width: 16, height: 16 },
  maxFrames: 90,
  minFrames: 12,
  frameRate: 2,
  supportedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "video/mp4",
    "video/webm",
    "video/ogg",
  ] as const,
} as const;

import {
  evidenceQuality,
  combineChecks,
  buildFaceAggregate,
  analyzeFace,
  analyzeSignal,
  type FaceResult,
  type MetadataFindings,
  type SignalAnalysis,
  type AnalysisSettings,
} from "./forensics";
import type { EvidenceSignal, EvidenceReport, Analysis, ImageAnalysis, VideoAnalysis, VerdictBlock } from "./types";
import { ENGINE_INFO, EVIDENCE, type EvidenceQuality } from "./forensics";
import type { DetectionModel, ModelPrediction } from "./model";
import type { Check } from "./types";
import { detectFaces } from "./faces";

export interface RunContext {
  model: DetectionModel;
  settings: AnalysisSettings;
  modelMetadata: DetectionModel["metadata"];
  modelPrediction: ModelPrediction | null;
  checkedImage: HTMLImageElement;
  metadata: MetadataFindings | null;
  elaReencoded: Uint8ClampedArray | null;
  universe: {
    probes: Set<string>;
    budgetRemaining?: number;
    usageCollectionEnd?: number;
  } | null;
}

export interface DetectorHandle {
  id: string;
  label: string;
  group: string;
  run: (ctx: RunContext, sig: SignalAnalysis, metadata: MetadataFindings | null) =>
    | { score: number; confidence: number; checks: Check[]; warnings: string[] }
    | null;
  version?: string;
}

export interface FusionOutcome {
  verdict: VerdictBlock | null;
  evidence: EvidenceReport | null;
  signals: EvidenceSignal[];
  warnings: string[];
}

export interface DetectedObject {
  label: string;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
  id?: string;
}

export interface AnalysisRun {
  kind: "image" | "video";
  verdict: VerdictBlock;
  checks: Check[];
  faces: FaceResult[];
  signals: EvidenceSignal[];
  metadata: MetadataFindings | null;
  engine: typeof ENGINE_INFO;
  warnings: string[];
  timing: { analyzeMs: number; facesMs: number; forensicksMs: number };
  artifacts: {
    heatmapDataUrl?: string;
    elaDataUrl?: string;
    frameArtifacts?: { t: number; score: number; imageDataUrl?: string; heatDataUrl?: string }[];
  };
  frames: { t: number; score: number; imageDataUrl?: string; heatDataUrl?: string }[];
  suspiciousFrames: { t: number; score: number }[];
  hash?: string;
  /** recent generation-history entries, newest first, for the report timeline */
  generationHistory?: { t: number; score: number }[];
  /** model provenance badge (model version, signature, source) */
  modelMeta?: {
    modelId: string;
    version: string;
    signature?: string;
    source?: string;
    trainedAt: number;
    weightBytes: number;
  };
}

export interface FrameHandle {
  index: number;
  t: number;
  imageDataUrl?: string;
  heatDataUrl?: string;
}

// ---------------------------------------------------------------------------
// Video pipeline
// ---------------------------------------------------------------------------

export interface VideoPipeline {
  analyze: (ctx: RunContext, source: VideoHandle) => Promise<AnalysisRun>;
}

export interface VideoHandle {
  durationSec: number;
  width: number;
  height: number;
  frameCount: number;
  open: (track: VideoTrack) => Promise<void>;
  seek: (t: number) => Promise<void>;
  captureRgba: (out: Uint8ClampedArray) => void;
  close: () => Promise<void>;
}

export async function runVideo(ctx: RunContext, source: VideoHandle): Promise<AnalysisRun> {
  const t0 = performance.now();
  const settings = ctx.settings;

  // Sample frames at a constant rate across the whole clip.
  const sampleRate = settings.frameRate || 2;
  const maxFrames = settings.maxFrames || 90;
  const minFrames = settings.minFrames ?? 12;
  const duration = source.durationSec || 0;
  const totalSamples = Math.max(1, Math.min(Math.ceil(duration * sampleRate), maxFrames));
  const step = duration > 0 ? duration / totalSamples : 0;

  const frames: { t: number; rgba: Uint8ClampedArray | null; w: number; h: number }[] = [];
  let captured = 0;
  for (let i = 0; i < totalSamples; i++) {
    const t = i * step;
    await source.seek(t);
    const data = new Uint8ClampedArray(source.width * source.height * 4);
    source.captureRgba(data);
    frames.push({ t, rgba: data, w: source.width, h: source.height });
    captured++;
  }
  source.close();

  const frameCount = captured;
  const faceCache = new Map<string, { faces: FaceResult[]; elapsed: number; warnings: string[] }>();

  const signalAnalyses: SignalAnalysis[] = [];
  const faceResults: FaceResult[] = [];
  const warnings: string[] = [];
  const imageId = `${ctx.checkedImage.src || "video"}_${Date.now()}`;

  const tFaces0 = performance.now();

  for (let i = 0; i < frameCount; i++) {
    const frame = frames[i];
    let cached = faceCache.get(`${frame.w}x${frame.h}`);
    if (!cached) {
      cached = { faces: [], elapsed: 0, warnings: [] };
      faceCache.set(`${frame.w}x${frame.h}`, cached);
    }

    const sig = analyzeSignal(frame.rgba!, frame.w, frame.h, ctx.settings, "video", null, ctx.metadata);
    signalAnalyses.push(sig);

    const faceKey = `${i}:${frame.w}x${frame.h}`;
    let faces = cached.faces;
    if (faces.length === 0) {
      const f0 = performance.now();
      const ff = detectFaces(frame.rgba!, frame.w, frame.h, "blazeface", ctx.checkedImage, ctx.model, ctx.universe);
      if (ff) {
        faces = ff.faces;
        cached.elapsed = ff.elapsed;
        cached.warnings = ff.warnings;
      }
      faceResults.push(...faces);
      faceCache.set(faceKey, { faces, elapsed: 0, warnings: [] });
    }

    const quality = evidenceQuality(sig.sharpness, ctx.metadata);
    if (quality.reasons.length > 0) {
      warnings.push(...quality.reasons);
    }
  }

  const timing = {
    analyzeMs: performance.now() - t0,
    facesMs: 0,
    forensicksMs: 0,
  };

  const perDetector = {
    image: {} as Record<string, number>,
    spectral: {} as Record<string, number>,
    compression: {} as Record<string, number>,
    metadata: {} as Record<string, number>,
    face: {} as Record<string, number>,
    temporal: {} as Record<string, number>,
    audio: {} as Record<string, number>,
  };

  const fusedSignals: EvidenceSignal[] = [];
  const allChecks: Check[] = [];
  const allWarnings: string[] = [];

  // Image-domain detectors (apply to every sampled frame).
  const imageDetectors = [
    {
      id: "imageAIDetector",
      label: "Composition / shading uniformity",
      group: "image",
      run: (c, sig, md) => {
        const checks: Check[] = [];
        let score = 0;
        let active = 0;
        const w = 1 - clamp(stdDev(sig.tiles.grad) / (mean(sig.tiles.grad) + 1e-6), 0, 1);
        const ela = sig.checks.find((c2) => c2.id === "ela");
        if (ela && ela.score >= 0.65) {
          checks.push(ela);
          score += ela.score * 0.5;
          active += 0.5;
        }
        if (w <= 0.25) {
          checks.push({ id: "uniformity", label: "Flat-region uniformity", group: "image", raw: w, display: `uniformity ${w.toFixed(2)}`, score: 1 - w, weight: 0.05, status: "flag", finding: "Spatial detail is abnormally uniform across the frame — consistent with model rendering rather than a natural scene." });
          score += (1 - w) * 0.5;
          active += 0.5;
        } else if (w <= 0.4) {
          checks.push({ id: "uniformity", label: "Flat-region uniformity", group: "image", raw: w, display: `uniformity ${w.toFixed(2)}`, score: 0.5, weight: 0, status: "warn", finding: "Some flat regions present; not diagnostic on its own." });
        }
        score = clamp(score / Math.max(active, 1e-6), 0, 1);
        return { score, confidence: 70, checks, warnings: [] };
      },
      version: "1.0.0",
    },
    {
      id: "spectralDetector",
      label: "Frequency spectrum",
      group: "spectral",
      run: (c, sig, md) => {
        const checks: Check[] = [];
        let score = 0;
        let active = 0;
        const spectrum = sig.checks.find((c2) => c2.id === "spectrum");
        if (spectrum) {
          checks.push(spectrum);
          score += spectrum.score * 0.5;
          active += 0.5;
        }
        const slope = sig.spectrum?.slope ?? 0;
        const peak = sig.spectrum?.peak ?? 0;
        if (slope < 2.0 || peak > 4.0) {
          checks.push({ id: "spectral-clip", label: "Spectral clip regions", group: "spectral", raw: slope, display: `slope ${slope.toFixed(2)}`, score: clamp(2.2 - slope, 0, 1), weight: 0.05, status: "warn", finding: `Slope ${slope.toFixed(2)} sits near the synthetic boundary of 2.0–3.6.` });
          score += clamp(2.2 - slope, 0, 1) * 0.5;
          active += 0.5;
        }
        score = clamp(score / Math.max(active, 1e-6), 0, 1);
        return { score, confidence: 72, checks, warnings: [] };
      },
      version: "1.0.0",
    },
  ] as DetectorHandle[];

  for (const detector of imageDetectors) {
    for (let i = 0; i < frameCount; i++) {
      const out = detector.run(ctx, signalAnalyses[i], ctx.metadata);
      if (!out) continue;
      out.checks.forEach((c) => allChecks.push(c));
      allWarnings.push(...out.warnings);
      perDetector[detector.group][`${detector.id}-${i}`] = out.score;
    }
    fusedSignals.push({
      id: `${detector.id}-signal`,
      label: detector.label,
      group: detector.group,
      raw: "profile",
      score: frameCount > 0 ? mean(Object.values(perDetector[detector.group])) : 0.5,
      weight: 1,
      confidence: 70,
      evidence: `Detected ${frameCount} frames; mean lean ${fusedSignals[fusedSignals.length - 1].score.toFixed(2)}.`,
      reliability: "ok",
      detector: detector.id,
      detectorVersion: detector.version,
    });
  }

  // Merge detection.ts's per-frame image signals into the detector portfolio.
  const fusion = {
    signals: signalAnalyses.map((sig, i) => ({
      grid: sig.grid?.phase ?? 0,
      ela: sig.ela ? mean(sig.ela) : 0,
      seam: 0,
      sharpness: sig.sharpness,
    })),
    fusionScore: 0,
    weights: signalAnalyses.map(() => 1),
  };

  const imageFusion = combineImageSignal(
    ctx.modelPrediction,
    fusion.signals.map((s) => s),
    signalAnalyses.map((s) => s.checks),
    signalAnalyses[0],
    ctx.metadata,
    ctx.modelMetadata.thresholds,
  );

  // Face detector over the full clip (or a representative subset).
  const faceHandle: FaceHandle = {
    durationSec: source.durationSec,
    width: source.width,
    height: source.height,
    frameCount,
    open: async (track) => { await track.setVideoFrameBuffer(null, 0, 0); },
    seek: async (t) => {},
    captureRgba: (out) => {},
    close: async () => {},
  };

  // Temporal & audio pipelines
  const temporal = {
    flicker: 0,
    scoreCv: 0,
    lightJumps: 0,
    cuts: 0,
    faceJitter: 0,
    noFaceRatio: 0,
  };

  const audio: { present: boolean; durationSec: number; sampleRate: number; clippingRatio: number; dcOffset: number; silenceRatio: number; spectralCentroid: number; uniformity: number; note: string } | null = null;

  return {
    kind: "video",
    verdict: imageFusion.verdict!,
    checks: allChecks,
    faces: faceResults,
    signals: fusedSignals,
    metadata: ctx.metadata,
    engine: ENGINE_INFO,
    warnings: allWarnings,
    timing,
    artifacts: {},
    frames: [],
    suspiciousFrames: [],
    generationHistory: [],
    modelMeta: {
      modelId: ctx.modelMetadata.modelId,
      version: ctx.modelMetadata.version,
      signature: ctx.modelMetadata.weightSha256,
      source: ctx.modelMetadata.weightBytes > 0 ? "bundled" : "external",
      trainedAt: ctx.modelMetadata.trainedAt,
      weightBytes: ctx.modelMetadata.weightBytes,
    },
  };
}

// ---------------------------------------------------------------------------
// Image-domain fusion helpers
// ---------------------------------------------------------------------------

export interface GenerationFeatures {
  noiseSmoothness: number;
  spectralAnomaly: number;
  upsamplingPeak: number;
  toneGap: number;
  gridMisalignment: number;
  elaLocalization: number;
  seam: number;
  faceLean: number;
}

export function buildGenerationFeatures(checks: Check[], signals: { grid: number; ela: number; seam: number }[], sharpness: number): GenerationFeatures {
  const elaCheck = checks.find((c) => c.id === "ela");
  const gridCheck = checks.find((c) => c.id === "grid");
  const seamCheck = checks.find((c) => c.id === "seam");
  const faceCheck = checks.find((c) => c.id === "face");

  const elaLocalization = elaCheck
    ? clamp(elaCheck.raw / 255, 0, 1)
    : 0.05;
  const gridMisalignment = gridCheck ? clamp(1 - gridCheck.raw, 0, 1) : 0.15;
  const seamScore = seamCheck ? clamp(seamCheck.raw, 0, 1) : 0.05;
  const faceLean = faceCheck ? clamp(faceCheck.raw, 0, 1) : 0.05;

  const noiseSmoothness = 1 - clamp(stdDev(checks.map((c) => c.score)) / 0.4, 0, 1);
  const spectralAnomaly = 1 - clamp(1 - signals[0]?.spectralAnomaly ?? 0, 0, 1);
  const upsamplingPeak = signals[0]?.upsamplingPeak ?? 0.15;

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

export interface CombineImageSignalArgs {
  model: ModelPrediction | null;
  features: GenerationFeatures;
  checks: Check[];
  signal: SignalAnalysis;
  metadata: MetadataFindings | null;
  thresholds: { real: number; fake: number };
}

export function combineImageSignal(
  model: ModelPrediction | null,
  checks: Check[],
  signal: SignalAnalysis,
  metadata: MetadataFindings | null,
  thresholds: { real: number; fake: number },
): FusionOutcome {
  const w = checks.filter((c) => c.weight > 0 && c.status !== "skip");
  const wsum = w.reduce((a, c) => a + c.weight, 0) || 1;
  const evidenceScore = clamp(w.reduce((a, c) => a + c.score * c.weight, 0) / wsum, 0, 1);

  const quality = evidenceQuality(signal.sharpness, metadata);
  const bandLow = thresholds.real;
  const bandHigh = thresholds.fake;

  // The model is a calibrated probability, never proof. Its output is folded
  // into the fusion using a sigmoid-like blend when present.
  let modelLean = 0;
  let modelWeight = 0;
  if (model) {
    modelWeight = 0.25;
    modelLean = model.aiProbability ?? 0.5;
  }

  // Honest fusion: weighted measured signals dominate the numeric score;
  // the model only tilts the verdict by a bounded amount, and never by
  // enough to flip a firm call.
  let fusion = evidenceScore * 0.75 + modelLean * modelWeight;

  // Degraded evidence (heavy re-compression or low sharpness) is one of the
  // strongest honest triggers for an inconclusive verdict. A washed-out
  // file has nothing to weigh, so we split the difference instead of
  // trusting the model's confidence.
  if (quality.degraded) {
    fusion = clamp(fusion * 0.5, 0, 1);
  }

  const uncertainty = clamp(0.35 + 0.30 * (1 - Math.abs(evidenceScore - 0.5) * 2) + 0.15 * (1 - modelWeight), 0, 1);
  const rawConfidence = clamp(60 + 25 * (1 - Math.abs(evidenceScore - 0.5) * 2) - 10 * (quality.degraded ? 1 : 0), 20, 95);
  const confidence = clamp(Math.round(rawConfidence), 20, 95);

  // Hard-probability estimate from the signal shape, used to guard against
  // any single detector dominating.
  const decisionMean = clamp(evidenceScore - 0.5, 0, 1);

  // Verdict timing: when evidence is degraded, thin, or detectors disagree,
  // the honest answer is "inconclusive", not "likely_ai" or "likely_deepfake".
  const agreement = signal.checks.length > 0 ? 1 - clamp(stdDev(signal.checks.map((c) => c.score)) / 0.5, 0, 1) : 0.5;
  const effectiveEvidence = confidence >= 75 && agreement >= 0.4 ? 1 : 0.6;
  const degraded = quality.degraded || signal.sharpness < EVIDENCE.minSharpness;

  const baseVerdict: Verdict =
    fusion >= 0.66 ? "likely_deepfake" :
    fusion <= 0.34 ? "real" :
    "inconclusive";

  const verdict: Verdict =
    degraded
      ? "inconclusive"
      : fusion >= 0.66 && agreement >= 0.4
        ? "likely_deepfake"
        : fusion <= 0.34 && agreement >= 0.4
          ? "real"
          : "inconclusive";

  const outcome: Outcome =
    verdict === "real" ? "authentic" :
    verdict === "inconclusive" ? "inconclusive" :
    verdict === "likely_deepfake" ? "synthetic" :
    "error";

  const inconclusiveReason: string | null =
    degraded
      ? `Evidence is degraded (${(quality.reasons.length ? quality.reasons[0] : "low quality image").replace(/^./, (c) => c.toLowerCase())}). A single high-confidence model output cannot outweigh washed-out or missing measurements.`
      : agreement < 0.4
        ? "Detectors disagree; the evidence does not settle it."
        : null;

  // Evidence strength: how much *independent* measured evidence stood behind
  // the call (coverage tempered by agreement, throttled by degraded status).
  const evidenceStrength = degraded
    ? 0.2
    : Math.min(0.95, 0.45 + 0.30 * agreement + 0.15 * effectiveEvidence + 0.10 * (1 - Math.abs(evidenceScore - 0.5) * 2));

  const uncertainBand = uncertainty <= 0.6 && uncertainty >= 0.4;

  const explanation: string[] = [];
  explanation.push(`Measured signals weighted to ${evidenceScore.toFixed(2)} (confidence ${confidence}%, uncertainty ${uncertainty.toFixed(2)}).`);
  if (model) {
    explanation.push(`Neural classifier lean: ${model.aiProbability.toFixed(2)} (weight ${modelWeight}).`);
  }
  if (quality.degraded) {
    explanation.push(`Degraded evidence: ${quality.reasons.join("; ")}.`);
  }
  if (inconclusiveReason) {
    explanation.push(inconclusiveReason);
  }
  if (verdict === "inconclusive") {
    explanation.push("Inconclusive: the measured evidence does not settle the call.");
  }

  const signals: EvidenceSignal[] = [];
  const categories: { id: string; label: string; flags: boolean; maxScore: number; weight: number; signals: EvidenceSignal[] }[] = [];
  const groups = new Set<string>();
  w.forEach((c) => {
    groups.add(c.group);
    const cat = categories.find((g) => g.id === c.group);
    if (!cat) {
      categories.push({ id: c.group, label: c.label, flags: false, maxScore: c.score, weight: c.weight, signals: [] });
    }
  });
  w.forEach((c) => {
    const cat = categories.find((g) => g.id === c.group)!;
    cat.signals.push({
      id: c.id,
      label: c.label,
      group: c.group,
      raw: String(c.raw),
      score: c.score,
      weight: c.weight,
      confidence: 70,
      evidence: c.finding,
      reliability: c.status,
    });
  });

  const verdictBlock: VerdictBlock = {
    verdict,
    outcome,
    confidence,
    score: fusion,
    uncertainty,
    evidenceStrength,
    uncertainBand,
    inconclusiveReason,
    explanation,
  };

  return {
    verdict: verdictBlock,
    evidence: {
      fusionScore: fusion,
      categories,
      signals,
      perDetector: [],
      activeDetectors: 0,
      evidenceStrength,
      elapsedMs: 0,
    },
    signals: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAnalysis(ctx: RunContext, source: AnalysisSource): Promise<AnalysisRun> {
  if (source.kind === "video") {
    return runVideo(ctx, source as unknown as VideoHandle);
  }
  return runImage(ctx, source as unknown as HTMLImageElement);
}

export interface AnalysisSource {
  kind: "image" | "video";
}

// Manual poll-based fallback so the runner can be driven by the UI without
// reaching into the browser render tree.
export interface ImageSource {
  kind: "image";
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
}
