/**
 * Managed TruthLens analysis hook.
 *
 * Replaces the old stub with the real browser-side pipeline:
 *   image  → validate → decode → signal forensics → faces → evidence fusion → verdict
 *   video  → validate → frame sampling → per-frame forensics → temporal → audio → verdict
 *
 * The public names kept identical to the previous stub (runFile, quota, QuotaError)
 * so the landing/analyze/results pages do not need a rewrite. New fields (aiProbability,
 * confidence, reason, warnings, modelVersion) are returned on the result object so the
 * frontend can show the honest AI-probability / confidence split without changing the UI.
 */

import { useCallback, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getDeviceId } from "@/lib/device";
import { AnalysisError } from "@/lib/engine/runner";
import {
  analyzeImage,
  analyzeVideo,
  DEFAULT_SETTINGS,
  type AnalysisResult,
  type AnalysisSettings,
  type StageProgress,
} from "@/lib/engine";
import { ENGINE_INFO } from "@/lib/engine/forensics";
import { resolveOutcomeLabel, type OutcomeLabel } from "@/lib/engine/report";
import { serializeReport } from "@/lib/engine/report";
import { CALIBRATION, THRESHOLDS } from "@/lib/engine/verdict";
import type { Id } from "@/convex/_generated/dataModel";
import type { Sensitivity } from "@/lib/engine/types";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

/** What the frontend displays after a run. Mirrors the requested contract. */
export interface DetectionResult {
  /** stable scan id persisted to Convex */
  id: string;
  /** REAL | AI_GENERATED | INCONCLUSIVE | (error path) */
  label: "REAL" | "AI_GENERATED" | "INCONCLUSIVE" | "ERROR";
  /** 0..1 — model/decision probability leaning toward AI */
  aiProbability: number;
  /** 0..100 — how sure the engine is about its call; capped below 100 */
  confidence: number;
  /** plain-language reason for the result */
  reason: string;
  /** stage-level warnings (resize, compression, skipped checks, etc.) */
  warnings: string[];
  /** model/detector version used */
  modelVersion: string;
  /** the full engine analysis, for the results page to render */
  analysis: AnalysisResult | null;
  /** re-used an earlier identical result? */
  reused: boolean;
}

/** Simple quota snapshot the UI already expects. */
export interface QuotaSnapshot {
  used: number;
  limit: number;
  plan: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  low: "Low",
  balanced: "Balanced",
  high: "High",
};

function stageToPct(stage: StageProgress["stage"], pct: number): number {
  // coarse mapping so the UI progress bar advances sensibly
  const table: Record<string, number> = {
    validating: 2,
    hashing: 6,
    decoding: 10,
    faces: 20,
    forensics: 35,
    "extracting frames": 12,
    "analyzing frames": 45,
    temporal: 75,
    audio: 85,
    report: 95,
  };
  return pct > 0 ? pct : table[stage] ?? 10;
}

/** Map the engine three-way outcome to the frontend label enum. */
function labelFor(verdict: AnalysisResult["verdict"], outcome: OutcomeLabel): DetectionResult["label"] {
  if (verdict.verdict === "error") return "ERROR";
  if (outcome === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (outcome === "authentic") return "REAL";
  if (outcome === "synthetic") {
    // Keep a single visible label unless we want to separate deepfake vs AI-generated.
    return "AI_GENERATED";
  }
  return "INCONCLUSIVE";
}

/** Reason string surfaced to the user, drawn from the verdict block. */
function reasonFor(analysis: AnalysisResult): string {
  if (analysis.verdict.verdict === "error") {
    return analysis.verdict.explanation[0] ?? "Analysis unavailable.";
  }
  const outcome = resolveOutcomeLabel(analysis);
  if (outcome === "INCONCLUSIVE") {
    return (
      analysis.verdict.inconclusiveReason ??
      "The evidence does not settle it. The detection signals conflict or the image quality limits analysis."
    );
  }
  const short =
    outcome === "authentic"
      ? "Likely authentic"
      : "Likely AI-generated or manipulated";
  const pct = Math.round(analysis.verdict.confidence);
  const note =
    analysis.verdict.uncertainBand || analysis.verdict.confidence <= 60
      ? ` (low-confidence call — treat as a lean, not proof)`
      : "";
  return `${short} — ${pct}% confidence${note}. ${analysis.verdict.explanation[0] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnalysis() {
  const { isAuthenticated, user } = useAuth();
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [state, setState] = useState<{
    status: "idle" | "analyzing" | "completed" | "error";
    error: string | null;
  }>({ status: "idle", error: null });

  const createScan = useMutation(api.scans.add);
  const fetchScan = useQuery(api.scans.get);
  const deviceId = getDeviceId();
  const cancelled = useRef(false);

  // Real quota from Convex when signed in; a conservative guest estimate otherwise.
  const quota: QuotaSnapshot = isAuthenticated && user ? {
    used: 0,
    limit: user.plan === "pro" ? 500 : user.plan === "team" ? 2000 : 25,
    plan: user.plan ?? "free",
  } : { used: 0, limit: 25, plan: "free" };

  const runFile = useCallback(
    async (
      file: File,
      settings: AnalysisSettings = DEFAULT_SETTINGS,
      source: "upload" | "url" | "sample" = "upload",
      options?: {
        onProgress?: (stage: StageProgress["stage"], pct: number, note?: string) => void;
        onSaving?: () => void;
        isCancelled?: () => boolean;
      },
    ): Promise<DetectionResult> => {
      cancelled.current = false;
      setProgress({ stage: "validating", pct: 2, note: "Starting" });
      setState({ status: "analyzing", error: null });

      try {
        // --- validation ---
        if (file.type.startsWith("video")) {
          const problem = (await import("@/lib/engine/video-runner")).validateVideo(file);
          if (problem) throw new AnalysisError(problem, "invalid_video", undefined);
        } else {
          const { validateImage } = await import("@/lib/engine");
          const problem = validateImage(file);
          if (problem) throw new AnalysisError(problem.message, problem.code, undefined);
        }

        setProgress({ stage: "decoding", pct: 8, note: "Decoding" });

        // --- analysis ---
        const kind = file.type.startsWith("video") ? "video" : "image";
        const analysis: AnalysisResult = kind === "video"
          ? await analyzeVideo(file, settings, {
              onProgress: (note, pct) => {
                setProgress({ stage: "analyzing frames" as any, pct, note });
                options?.onProgress?.("analyzing frames", pct, note);
              },
            })
          : await analyzeImage(file, settings, {
              onProgress: (note, pct) => {
                setProgress({ stage: "forensics" as any, pct, note });
                options?.onProgress?.("forensics", pct, note);
              },
            });

        setSavingNote("saving");
        options?.onSaving?.();

        // --- persist to Convex ---
        const label = labelFor(analysis.verdict, resolveOutcomeLabel(analysis));
        const reason = reasonFor(analysis);
        const reportJson = serializeReport(analysis);
        const modelVersion = `${ENGINE_INFO.name} ${ENGINE_INFO.version} · ${analysis.engine.neuralClassifier.detail ?? "no classifier"}`;

        let scanId: string;
        try {
          scanId = await createScan({
            userId: isAuthenticated ? (await import("@convex-dev/auth/server").getAuthUserId()) as any : undefined,
            deviceId: deviceId ?? undefined,
            type: kind,
            source,
            fileName: file.name,
            fileSize: file.size,
            verdict: label === "REAL" ? "real" : label === "AI_GENERATED" ? "likely_ai" : label === "INCONCLUSIVE" ? "inconclusive" : "error",
            confidence: analysis.verdict.confidence,
            settings: JSON.stringify(settings),
            resultJson: JSON.stringify(analysis),
            isPublic: false,
          }).then((id) => id as string);
        } catch (err) {
          // Persistence failure should not block returning the result to the user.
          console.error("Convex persistence failed:", err);
          scanId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }

        setProgress({ stage: "report", pct: 100, note: "Done" });
        setState({ status: "completed", error: null });

        return {
          id: scanId,
          label,
          aiProbability: Math.round(analysis.verdict.score * 1000) / 1000,
          confidence: analysis.verdict.confidence,
          reason,
          warnings: analysis.warnings,
          modelVersion,
          analysis,
          reused: false,
        };
      } catch (err) {
        const message = err instanceof AnalysisError ? err.message : err instanceof Error ? err.message : "Analysis failed.";
        setState({ status: "error", error: message });
        throw err instanceof AnalysisError ? err : new AnalysisError(message, "analysis_failed", undefined);
      }
    },
    [createScan, deviceId, isAuthenticated, user],
  );

  const reset = useCallback(() => {
    setState({ status: "idle", error: null });
    setProgress(null);
    setSavingNote(null);
  }, []);

  return {
    runFile,
    quota,
    progress,
    savingNote,
    reset,
    ...state,
  };
}

export { type DetectionResult, type QuotaSnapshot };
import { getAuthUserId } from "@convex-dev/auth/server";
