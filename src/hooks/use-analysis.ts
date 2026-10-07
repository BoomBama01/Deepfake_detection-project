import { useState, useCallback } from "react";

// Error thrown when the user's quota is exhausted.
export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export interface AnalysisState {
  scanId: string | null;
  status: "idle" | "analyzing" | "completed" | "error";
  verdict: string | null;
  confidence: number | null;
  error: string | null;
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({
    scanId: null,
    status: "idle",
    verdict: null,
    confidence: null,
    error: null,
  });

  const createScan = async (args: any) => {
    // Stub - actual implementation would use convex mutation
    return "stub-id" as any;
  };

  const getScan = async (args: any) => {
    return null;
  };

  const startAnalysis = useCallback(async (args: any) => {
    setState(prev => ({ ...prev, status: "analyzing", error: null }));

    try {
      const scanId = await createScan(args);
      setState(prev => ({
        ...prev,
        scanId,
        status: "completed",
        verdict: args.verdict ?? null,
        confidence: args.confidence ?? null,
      }));
      return scanId;
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Analysis failed",
      }));
      throw err;
    }
  }, [createScan]);

  const fetchScan = useCallback(async (id: string) => {
    setState(prev => ({ ...prev, status: "analyzing" }));
    try {
      const scan = await getScan({ id });
      if (scan) {
        setState(prev => ({
          ...prev,
          scanId: id,
          status: "completed",
          verdict: (scan as any).verdict ?? null,
          confidence: (scan as any).confidence ?? null,
        }));
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to fetch scan",
      }));
    }
  }, [getScan]);

  const reset = useCallback(() => {
    setState({
      scanId: null,
      status: "idle",
      verdict: null,
      confidence: null,
      error: null,
    });
  }, []);

  // Check quota and run analysis
  const runFile = useCallback(async (
    file: File,
    settings: unknown,
    source: "upload" | "url" | "sample",
    options?: { onProgress?: (pct: number) => void; onSaving?: () => void; isCancelled?: () => boolean },
  ) => {
    const quota = { used: 0, limit: 25, plan: "free" };
    if (quota && quota.used >= quota.limit) {
      throw new QuotaError(
        `Daily limit reached: ${quota.used}/${quota.limit} scans used.`
      );
    }
    const scanId = await createScan({
      type: file.type.startsWith("video") ? "video" : "image",
      source,
      fileName: file.name,
      settings: JSON.stringify(settings),
    });
    return { id: scanId, reused: false };
  }, [createScan]);

  const quota = { used: 0, limit: 25, plan: "free" };

  return {
    ...state,
    startAnalysis,
    runFile,
    fetchScan,
    reset,
    quota,
  };
}
