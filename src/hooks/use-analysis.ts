/**
 * Managed TruthLens analysis hook.
 *
 * Replaces the old stub with the real browser-side pipeline:
 *   image  -> validate -> decode -> signal forensics -> faces -> evidence fusion -> verdict
 *   video  -> validate -> frame sampling -> per-frame forensics -> temporal -> audio -> verdict
 *
 * The public names kept identical to the previous stub (runFile, quota, QuotaError)
 * so the landing/analyze/results pages do not need a rewrite. New fields (aiProbability,
 * confidence, reason, warnings, modelVersion) are returned on the result object so the
 * frontend can show the honest AI-probability / confidence split without changing the UI.
 *
 * This hook runs the pipeline entirely in the browser. Persistence to Convex is left to
 * the app's existing Convex flows — this hook returns the in-flight result the UI consumes
 * immediately (id is a live key, reused is always false here).
 */

import { useCallback, useRef, useState } from "react";
import { AnalysisError } from "@/lib/engine/runner";
import {
  analyzeImage,
  analyzeVideo,
  validateImage,
  DEFAULT_SETTINGS,
  type Analysis,
  type AnalysisSettings,
  type StageProgress,
  type ImageAnalysis,
  type VideoAnalysis,
} from "@/lib/engine";
import { ENGINE_INFO } from "@/lib/engine/forensics";
import { resolveOutcomeLabel } from "@/lib/engine/report";
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
  /** live key for the in-flight result; persistence uses the app's existing Convex flows */
  id: string;
  /** REAL | AI_GENERATED | INCONCLUSIVE | ERROR */
  label: "REAL" | "AI_GENERATED" | "INCONCLUSIVE" | "ERROR";
  /** 0..1 — decision probability leaning toward AI */
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
  analysis: Analysis | null;
  /** re-used an earlier identical result? (always false in this managed hook) */
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

function stageToPct(stage: StageProgress["stage"], pct: number): number {
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
function labelFor(analysis: Analysis): DetectionResult["label"] {
  const v = analysis.verdict;
  if (v === "error") return "ERROR";
  const outcome = resolveOutcomeLabel(analysis);
  if (outcome === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (outcome === "LIKELY AUTHENTIC") return "REAL";
  if (outcome === "LIKELY AI-GENERATED or MANIPULATED") return "AI_GENERATED";
  return "INCONCLUSIVE";
}

/** Reason string surfaced to the user, drawn from the verdict block. */
function reasonFor(analysis: Analysis): string {
  if (analysis.verdict === "error") {
    return analysis.explanation[0] ?? "Analysis unavailable.";
  }
  const outcome = resolveOutcomeLabel(analysis);
  if (outcome === "INCONCLUSIVE") {
    return (
      analysis.inconclusiveReason ??
      "The evidence does not settle it. The detection signals conflict or the image quality limits analysis."
    );
  }
  const short =
    outcome === "LIKELY AUTHENTIC"
      ? "Likely authentic"
      : "Likely AI-generated or manipulated";
  const pct = Math.round(analysis.confidence);
  const note =
    analysis.uncertainBand || analysis.confidence <= 60
      ? ` (low-confidence call — treat as a lean, not proof)`
      : "";
  return `${short} — ${pct}% confidence${note}. ${analysis.explanation[0] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnalysis() {
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [state, setState] = useState<{
    status: "idle" | "analyzing" | "completed" | "error";
    error: string | null;
  }>({ status: "idle", error: null });

  const cancelled = useRef(false);

  // Conservative guest quota. The Dashboard reads authoritative counts from
  // useQuery(api.scans.quota) for signed-in users; this hook is the frontend
  // preflight path for the landing/samples/analyze pages and keeps the same
  // shape the previous stub exposed.
  const quota: QuotaSnapshot = { used: 0, limit: 3, plan: "free" };

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
          const { validateVideo } = await import("@/lib/engine/video-runner");
          const problem = validateVideo(file);
          if (problem) throw new AnalysisError(problem, "invalid_video", undefined);
        } else {
          const problem = validateImage(file);
          if (problem) throw new AnalysisError(problem.message, problem.code, undefined);
        }

        if (options?.isCancelled?.() ?? false) {
          const cancelled = new Error("AnalysisCancelled");
          (cancelled as any).name = "AnalysisCancelled";
          throw cancelled;
        }
        setProgress({ stage: "decoding", pct: 8, note: "Decoding" });

        // --- analysis ---
        const kind = file.type.startsWith("video") ? "video" : "image";
        const analysis: Analysis = kind === "video"
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

        if (options?.isCancelled?.() ?? false) {
          const cancelled = new Error("AnalysisCancelled");
          (cancelled as any).name = "AnalysisCancelled";
          throw cancelled;
        }

        setSavingNote("saving");
        options?.onSaving?.();

        // --- build the frontend-facing result ---
        const label = labelFor(analysis);
        const reason = reasonFor(analysis);
        const modelVersion =
          `${ENGINE_INFO.name} ${ENGINE_INFO.version} · ${analysis.engine.neuralClassifier.detail ?? "no classifier"}`;

        // A stable live key for the in-flight result. Persistence to Convex is
        // handled by the app's existing Convex flows (e.g. the Results page path).
        const id = `live-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        setProgress({ stage: "report", pct: 100, note: "Done" });
        setState({ status: "completed", error: null });

        return {
          id,
          label,
          aiProbability: Math.round(analysis.score * 1000) / 1000,
          confidence: analysis.confidence,
          reason,
          warnings: analysis.warnings,
          modelVersion,
          analysis,
          reused: false,
        };
      } catch (err) {
        if ((err as Error)?.name === "AnalysisCancelled") throw err;
        const message =
          err instanceof AnalysisError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Analysis failed.";
        setState({ status: "error", error: message });
        throw err instanceof AnalysisError
          ? err
          : new AnalysisError(message, "analysis_failed", undefined);
      }
    },
    [],
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
