import { useCallback } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDeviceId } from "@/lib/device";
import { dataUrlToBlob } from "@/lib/engine/artifacts";
import { sniffFormat } from "@/lib/engine/metadata";
import {
  AnalysisCancelled,
  AnalysisError,
  hashFile,
  runImage,
  runVideo,
} from "@/lib/engine/runner";
import { rememberFile } from "@/lib/session";
import type { AnalysisSettings, StageProgress, Verdict } from "@/lib/engine/types";

export interface RunOutcome {
  id: string;
  reused: boolean;
  verdict: Verdict | null;
}

export interface RunHooks {
  onProgress: (s: StageProgress) => void;
  /** called while artifacts are being uploaded/saved */
  onSaving?: (pct: number, note: string) => void;
  isCancelled?: () => boolean;
}

export class QuotaError extends Error {}

export function useAnalysis() {
  const convex = useConvex();
  const deviceId = getDeviceId();
  const quota = useQuery(api.scans.quota, { deviceId });
  const generateUploadUrl = useMutation(api.scans.generateUploadUrl);
  const save = useMutation(api.scans.save);

  const upload = useCallback(
    async (dataUrl: string | undefined): Promise<Id<"_storage"> | undefined> => {
      if (!dataUrl) return undefined;
      const blob = dataUrlToBlob(dataUrl);
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error("Artifact upload failed — check your connection and retry.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      return storageId;
    },
    [generateUploadUrl],
  );

  const runFile = useCallback(
    async (file: File, settings: AnalysisSettings, source: "upload" | "url" | "sample", hooks: RunHooks): Promise<RunOutcome> => {
      if (quota && quota.used >= quota.limit) {
        throw new QuotaError(
          `Daily scan limit reached (${quota.used}/${quota.limit}). Sign in or come back tomorrow.`,
        );
      }

      /* sniff the container from magic bytes (never trust the extension) */
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const fmt = sniffFormat(head);
      const isVideo = ["mp4", "webm", "avi"].includes(fmt);

      /* content-hash dedupe: identical files are not re-analysed */
      hooks.onProgress({ stage: "hashing", pct: 6, note: "Checking for a previous analysis" });
      const { hash } = await hashFile(file);
      const existing = await convex.query(api.scans.byHash, {
        fileHash: hash,
        deviceId,
      });
      if (
        existing &&
        existing.settings === JSON.stringify(settings) &&
        existing.verdict &&
        existing.verdict !== "error"
      ) {
        rememberFile(existing.id, file);
        return { id: existing.id, reused: true, verdict: existing.verdict };
      }

      const emit = (s: StageProgress) => hooks.onProgress(s);
      const cancelled = hooks.isCancelled ?? (() => false);

      const { analysis, artifacts } = isVideo
        ? await runVideo(file, settings, emit, cancelled)
        : await runImage(file, settings, emit, cancelled);

      if (cancelled()) throw new AnalysisCancelled();

      /* upload derived artifacts (the original file is never uploaded) */
      hooks.onSaving?.(4, "Uploading preview");
      let previewId: Id<"_storage"> | undefined;
      let heatmapId: Id<"_storage"> | undefined;
      let elaId: Id<"_storage"> | undefined;
      const type = isVideo ? "video" : "image";

      if (type === "image") {
        previewId = await upload(artifacts.previewDataUrl);
        hooks.onSaving?.(45, "Uploading heatmap");
        heatmapId = await upload(artifacts.heatmapDataUrl);
        elaId = await upload(artifacts.elaDataUrl);
      } else {
        previewId = await upload(artifacts.previewDataUrl);
        const frames = artifacts.frameArtifacts ?? [];
        const uploaded: Array<{ t: number; imageId?: string; heatId?: string }> = [];
        for (let i = 0; i < frames.length; i++) {
          hooks.onSaving?.(
            10 + Math.round(((i + 1) / Math.max(1, frames.length)) * 70),
            `Uploading frame ${i + 1}/${frames.length}`,
          );
          const imageId = await upload(frames[i].imageDataUrl);
          const heatId = await upload(frames[i].heatDataUrl);
          uploaded.push({
            t: frames[i].t,
            imageId: imageId as unknown as string,
            heatId: heatId as unknown as string,
          });
        }
        if (analysis.kind === "video") {
          analysis.suspiciousFrames = analysis.suspiciousFrames.map((sf) => {
            const u = uploaded.find((x) => Math.abs(x.t - sf.t) < 1e-6);
            return u ? { ...sf, imageId: u.imageId, heatId: u.heatId } : sf;
          });
        }
      }

      hooks.onSaving?.(88, "Saving result");
      let id: string;
      try {
        id = await save({
          type,
          source,
          fileName: file.name.slice(0, 120),
          fileHash: hash,
          fileSize: file.size,
          verdict: analysis.verdict,
          confidence: analysis.confidence,
          settings: JSON.stringify(settings),
          resultJson: JSON.stringify(analysis),
          previewId,
          heatmapId,
          elaId,
          deviceId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Daily scan limit|suspended/i.test(msg)) throw new QuotaError(msg);
        throw new Error(
          `Analysis finished but the result could not be saved: ${msg} Your media was not retained.`,
        );
      }
      hooks.onSaving?.(100, "Done");
      rememberFile(id, file);
      return { id, reused: false, verdict: analysis.verdict };
    },
    [convex, deviceId, quota, save, upload],
  );

  return { runFile, quota, deviceId };
}

export { AnalysisError, AnalysisCancelled };
