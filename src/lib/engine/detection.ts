// detection.ts
import { clamp, stdDev } from "./dsp";
import { EVIDENCE, type Check, type MetadataFindings, type SignalAnalysis } from "./forensics";
import { PRODUCTION_THRESHOLDS } from "./config";
import type { GenerationFeatures } from "./model";
import type { SignalAnalysis as SignalAnalysisType } from "./types";

export const MODEL_WEIGHT = 0.55;
export const MEASUREMENT_WEIGHT = 0.45;

export interface EnsembleResult {
  aiProbability: number;
  confidence: number;
  modelLabel: "REAL" | "AI_GENERATED";
  measurementLean: number;
  evidence: Array<{ label: string; finding: string; score: number }>;
  firmAIProbability: number | null;
  modelMetadata: { modelId: string; version: string; trainedAt: number; weightBytes: number; weightSha256?: string; calibrationOffset: number; thresholds: { real: number; fake: number }; };
}

export function combineImageSignal(model: any, features: GenerationFeatures, checks: Check[], signal: SignalAnalysisType | null, metadata: MetadataFindings | null, thresholds: { real: number; fake: number } = PRODUCTION_THRESHOLDS): EnsembleResult {
  const m = model ?? null;
  const mProb = m ? m.aiProbability : null;

  const measuredLean = leanFromChecks(checks, signal, metadata);

  const calibrated = mProb !== null ? clamp(mProb + (m.calibrationOffset ?? 0), 0, 1) : 0.5;

  const modelDistance = m !== null ? Math.abs(calibrated - 0.5) : 0;
  const featureAgreement = 1 - clamp(stdDev(Object.values(features)) * 2, 0, 1);
  const modelConfidence = m !== null ? clamp(100 * modelDistance, 0, 100) : 0;
  const agreement = 0.6 * (modelConfidence / 100) + 0.4 * featureAgreement;
  const combinedConfidence = clamp(100 * (0.35 + 0.3 * modelDistance + 0.35 * agreement), 10, 97);

  const score = MODEL_WEIGHT * calibrated + MEASUREMENT_WEIGHT * measuredLean;

  const firm = score >= thresholds.fake || score <= thresholds.real;
  const firmAProb = firm ? calibrated : null;

  const evidence: Array<{ label: string; finding: string; score: number }> = [];
  if (m !== null) {
    evidence.push({ label: "Model prediction", finding: "Calibrated AI probability " + Math.round(m.aiProbability * 100) + "%.", score: m.aiProbability });
  }
  for (const c of checks) {
    if (c.weight > 0 && c.status !== "skip") {
      evidence.push({ label: c.label, finding: c.finding, score: c.score });
    }
  }

  return {
    aiProbability: Math.round(score * 1000) / 1000,
    confidence: Math.round(combinedConfidence),
    modelLabel: m !== null ? m.label : "REAL",
    measurementLean: Math.round(measuredLean * 1000) / 1000,
    evidence,
    firmAIProbability: firmAProb,
    modelMetadata: {
      modelId: m?.metadata?.modelId ?? "truthlens-cnn-224",
      version: m?.metadata?.version ?? "2.2.0",
      trainedAt: m?.metadata?.trainedAt ?? 0,
      weightBytes: m?.metadata?.weightBytes ?? 0,
      weightSha256: m?.metadata?.weightSha256,
      calibrationOffset: m?.metadata?.calibrationOffset ?? 0,
      thresholds,
    },
  };
}

export function leanFromChecks(checks: Check[], signal: SignalAnalysisType | null, metadata: MetadataFindings | null): number {
  const active = checks.filter(c => c.weight > 0 && c.status !== "skip");
  if (active.length === 0) return 0.5;
  const wsum = active.reduce((a, c) => a + c.weight, 0) || 1;
  let lean = active.reduce((a, c) => a + c.score * c.weight, 0) / wsum;

  if (metadata?.aiSignatures.length > 0) { lean = Math.max(lean, 0.72); }

  const decisive = active.find(c => c.group === "face" && c.status === "flag" && c.raw >= 0.8);
  if (decisive) lean = Math.max(lean, 0.8);

  if (EVIDENCE.degraded) { return Math.max(lean, 0.5); }
  return lean;
}
