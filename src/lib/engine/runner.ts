/**
 * TruthLens — client-side analysis runner.
 *
 * Orchestrates decode → hash → face localisation → signal forensics →
 * artifacts for images, and frame extraction → per-frame analysis → temporal
 * consistency → artifacts for video. Every stage reports real progress; if a
 * stage fails the run ends in an explicit error state instead of a guess.
 */

import {
  analyzeFace,
  analyzeSignal,
  combineChecks,
  ENGINE_INFO,
  WEIGHTS,
} from "./forensics";
import { FaceDetectorUnavailableError, detectFaces } from "./faces";
import { parseMetadata, sniffFormat } from "./metadata";
import { mean, median, ramp } from "./dsp";
import { BANDS } from "./forensics";
import { decideVerdict } from "./verdict";
import {
  analyzeTemporal,
  buildTimeline,
  combineVideo,
  type FrameInput,
} from "./video";
import { analyzeAudio, decodeAudio, makeAudioCheck } from "./audio";
import { renderElaImage, renderHeatmap, renderPreview } from "./artifacts";
import type {
  Analysis,
  AnalysisArtifacts,
  AnalysisSettings,
  EngineInfo,
  FaceResult,
  FrameResult,
  ImageAnalysis,
  MetadataFindings,
  StageProgress,
  SuspiciousFrame,
  TemporalStats,
  VideoAnalysis,
  Verdict,
} from "./types";

export class AnalysisError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "AnalysisError";
    this.detail = detail;
  }
}

export class AnalysisCancelled extends Error {
  constructor() {
    super("Analysis cancelled.");
    this.name = "AnalysisCancelled";
  }
}

export const LIMITS = {
  imageMaxBytes: 15 * 1024 * 1024,
  videoMaxBytes: 200 * 1024 * 1024,
  videoMaxSeconds: 180,
  imageTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  videoTypes: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"],
  batchMax: 10,
};

const ANALYSIS_MAX_W = 1400;
const FRAME_W = 640;
const TILE = 32;

type Emit = (s: StageProgress) => void;
type Cancel = () => boolean;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed."));
    img.src = src;
  });
}

async function reencodeRgba(
  canvas: HTMLCanvasElement,
  quality = 0.9,
): Promise<Uint8ClampedArray | null> {
  try {
    const url = canvas.toDataURL("image/jpeg", quality);
    const img = await loadImage(url);
    const c2 = document.createElement("canvas");
    c2.width = canvas.width;
    c2.height = canvas.height;
    const ctx = c2.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c2.width, c2.height).data;
  } catch {
    return null;
  }
}

export async function hashFile(
  file: File,
  capBytes = 64 * 1024 * 1024,
): Promise<{ hash: string; partial: boolean }> {
  const partial = file.size > capBytes;
  const slice = partial ? file.slice(0, capBytes) : file;
  const digest = await crypto.subtle.digest("SHA-256", await slice.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { hash: partial ? `${hex}-p${file.size}` : `${hex}-${file.size}`, partial };
}

function engineInfo(
  faceStatus: EngineInfo["faceDetector"]["status"],
  faceDetail?: string,
  checksRun: string[] = [],
): EngineInfo {
  return {
    name: ENGINE_INFO.name,
    version: ENGINE_INFO.version,
    faceDetector: {
      name: "MediaPipe BlazeFace (short-range, float16) — local",
      status: faceStatus,
      detail: faceDetail,
    },
    neuralClassifier: {
      status: "not-bundled",
      detail:
        "No trained image-authenticity classifier is bundled with this deployment, so no neural 'fake/real' probability is claimed. Verdicts are computed from the signal-forensic checks listed above; face localisation does use a neural model (BlazeFace), which runs locally.",
    },
    checksRun,
  };
}

/* ==================================================================== */
/* Image                                                                */
/* ==================================================================== */

export async function runImage(
  file: File,
  settings: AnalysisSettings,
  emit: Emit,
  shouldCancel: Cancel = () => false,
): Promise<{ analysis: ImageAnalysis; artifacts: AnalysisArtifacts }> {
  const t0 = performance.now();

  emit({ stage: "validating", pct: 4, note: "Checking file signature and size" });
  if (file.size > LIMITS.imageMaxBytes) {
    throw new AnalysisError(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the image limit is 15 MB.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffFormat(bytes);
  if (!["jpeg", "png", "webp", "gif"].includes(format)) {
    throw new AnalysisError(
      "Unsupported or corrupt image — the file signature is not JPEG, PNG, WEBP or GIF (checked on the bytes, not the extension).",
    );
  }
  if (shouldCancel()) throw new AnalysisCancelled();

  emit({ stage: "hashing", pct: 12, note: "Computing SHA-256" });
  const { hash, partial } = await hashFile(file);
  if (shouldCancel()) throw new AnalysisCancelled();

  emit({ stage: "decoding", pct: 22, note: "Decoding pixels" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new AnalysisError(
      "The browser could not decode this image.",
      err instanceof Error ? err.message : String(err),
    );
  }
  const origW = bitmap.width;
  const origH = bitmap.height;
  if (origW < 32 || origH < 32) {
    throw new AnalysisError(`Image is too small (${origW}×${origH}); minimum is 32×32 px.`);
  }
  const scale = Math.min(1, ANALYSIS_MAX_W / Math.max(origW, origH));
  const aw = Math.max(32, Math.round(origW * scale));
  const ah = Math.max(32, Math.round(origH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new AnalysisError("Canvas 2D context unavailable in this browser.");
  ctx.drawImage(bitmap, 0, 0, aw, ah);
  const rgba = ctx.getImageData(0, 0, aw, ah).data;
  const preview = renderPreview(bitmap, origW, origH, 1200);
  bitmap.close?.();
  if (shouldCancel()) throw new AnalysisCancelled();

  const warnings: string[] = [];
  if (partial) warnings.push("SHA-256 computed over the first 64 MB of this large file.");
  if (format === "gif") warnings.push("Animated GIF: the first frame was analysed.");
  if (scale < 1) warnings.push(`Analysed at ${aw}×${ah} px (source ${origW}×${origH}).`);

  /* --- faces ------------------------------------------------------- */
  emit({ stage: "faces", pct: 38, note: "Localising faces (BlazeFace)" });
  let faceStatus: EngineInfo["faceDetector"]["status"] = "loaded";
  let faceDetail: string | undefined;
  let detections: Awaited<ReturnType<typeof detectFaces>> = [];
  try {
    detections = await detectFaces(canvas, aw, ah);
  } catch (err) {
    if (err instanceof FaceDetectorUnavailableError) {
      faceStatus = "unavailable";
      faceDetail = err.causeDetail;
      warnings.push(
        "Face detector unavailable — no faces were localised and face checks did not run. The verdict below rests on whole-image checks only.",
      );
    } else {
      faceStatus = "unavailable";
      faceDetail = err instanceof Error ? err.message : String(err);
      warnings.push(`Face detection failed: ${faceDetail}`);
    }
  }
  if (faceStatus === "loaded" && detections.length === 0) {
    warnings.push("No faces detected in this image — face-specific checks were not applicable.");
  }
  if (shouldCancel()) throw new AnalysisCancelled();

  /* --- forensics ---------------------------------------------------- */
  emit({ stage: "forensics", pct: 58, note: "Running signal-forensic checks" });
  const metadata: MetadataFindings | null = settings.enableMetadata
    ? parseMetadata(bytes, format)
    : null;
  let elaRgba: Uint8ClampedArray | null = null;
  if (settings.enableEla) {
    elaRgba = await reencodeRgba(canvas, 0.9);
    if (!elaRgba) warnings.push("ELA re-encode failed — Error Level Analysis was skipped.");
  }
  const sig = analyzeSignal(rgba, aw, ah, settings, format, elaRgba, metadata);
  if (shouldCancel()) throw new AnalysisCancelled();

  emit({ stage: "faces", pct: 72, note: `Analysing ${detections.length} face region(s)` });
  const faces: FaceResult[] = detections.map((d, i) => {
    const r = analyzeFace(rgba, aw, ah, d.box, sig, sig.ela);
    return { index: i, box: d.box, score: r.score, confidence: r.confidence, checks: r.checks };
  });
  await tick();

  const checks = [...sig.checks];
  let faceScore: number | null = null;
  if (faces.length > 0) {
    const area = (f: FaceResult) => f.box.w * f.box.h;
    const tot = faces.reduce((a, f) => a + area(f), 0) || 1;
    faceScore = faces.reduce((a, f) => a + f.score * area(f), 0) / tot;
    const st: FaceResult["checks"][number]["status"] =
      faceScore >= 0.65 ? "flag" : faceScore >= 0.4 ? "warn" : "ok";
    checks.push({
      id: "face",
      label: "Face manipulation signal",
      group: "face",
      raw: faceScore,
      display: `${(faceScore * 100).toFixed(0)}% lean across ${faces.length} face(s)`,
      score: faceScore,
      weight: WEIGHTS.face,
      status: st,
      finding:
        `Weighted across ${faces.length} detected face(s), the face-level measurements lean ${(faceScore * 100).toFixed(0)}% toward manipulation ` +
        `(per-face detail is in the Faces section). ` +
        (st === "flag"
          ? "Skin smoothness, blending boundaries and face spectra all deviate from the surrounding scene."
          : st === "warn"
            ? "Some face-level measurements are elevated but not conclusive."
            : "Face-level measurements sit inside expected ranges."),
    });
  }

  const score = combineChecks(checks);
  emit({ stage: "report", pct: 86, note: "Composing verdict" });
  const decision = decideVerdict({
    score,
    checks,
    faceScore,
    kind: "image",
    sensitivity: settings.sensitivity,
  });

  const analysis: ImageAnalysis = {
    kind: "image",
    verdict: decision.verdict,
    confidence: decision.confidence,
    score,
    explanation: decision.explanation,
    checks,
    faces,
    metadata,
    engine: engineInfo(faceStatus, faceDetail, checks.filter((c) => c.weight > 0).map((c) => c.id)),
    warnings,
    processingTimeMs: Math.round(performance.now() - t0),
    dimensions: { width: origW, height: origH },
    hash,
  };

  emit({ stage: "report", pct: 94, note: "Rendering heatmap and ELA views" });
  const artifacts: AnalysisArtifacts = {
    previewDataUrl: preview.dataUrl,
    heatmapDataUrl: sig.ela
      ? renderHeatmap({
          source: preview.canvas,
          srcW: preview.canvas.width,
          srcH: preview.canvas.height,
          ela: scaleEla(sig.ela, aw, ah, preview.canvas.width, preview.canvas.height),
          tileSize: Math.max(8, Math.round(TILE * scale)),
          faces,
          caption: "truthlens · anomaly map",
        })
      : undefined,
    elaDataUrl: sig.ela ? renderElaImage(sig.ela, aw, ah) : undefined,
  };

  emit({ stage: "report", pct: 100, note: "Done" });
  return { analysis, artifacts };
}

/** Resample an ELA plane onto the preview resolution. */
function scaleEla(
  ela: Float32Array,
  w: number,
  h: number,
  dw: number,
  dh: number,
): Float32Array {
  if (w === dw && h === dh) return ela;
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / dw));
      out[y * dw + x] = ela[sy * w + sx];
    }
  }
  return out;
}

/* ==================================================================== */
/* Video                                                                */
/* ==================================================================== */

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const onSeeked = () => finish();
    const onError = () => finish(new Error("Video decode error while seeking."));
    const timer = setTimeout(() => finish(new Error("Timed out seeking the video.")), 8000);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = Math.max(0, t);
    } catch (err) {
      finish(err instanceof Error ? err : new Error("Seek failed."));
    }
  });
}

function frameMetrics(rgba: Uint8ClampedArray, w: number, h: number) {
  const sig = analyzeSignal(
    rgba,
    w,
    h,
    {
      sensitivity: "balanced",
      frameRate: 2,
      maxFrames: 90,
      enableEla: false,
      enableMetadata: false,
      enableAudio: false,
    },
    "mp4",
    null,
    null,
  );
  const luma = mean(sig.gray.data);
  return { sig, luma };
}

/** Per-pixel ELA of a canvas: max channel diff vs a q=0.9 re-encode. */
async function elaFromCanvas(canvas: HTMLCanvasElement): Promise<Float32Array | null> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const orig = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rec = await reencodeRgba(canvas, 0.9);
  if (!rec) return null;
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const dr = Math.abs(orig[p] - rec[p]);
    const dg = Math.abs(orig[p + 1] - rec[p + 1]);
    const db = Math.abs(orig[p + 2] - rec[p + 2]);
    out[i] = Math.max(dr, dg, db);
  }
  return out;
}

export async function runVideo(
  file: File,
  settings: AnalysisSettings,
  emit: Emit,
  shouldCancel: Cancel = () => false,
): Promise<{ analysis: VideoAnalysis; artifacts: AnalysisArtifacts }> {
  const t0 = performance.now();
  const warnings: string[] = [];

  emit({ stage: "validating", pct: 3, note: "Checking container and size" });
  if (file.size > LIMITS.videoMaxBytes) {
    throw new AnalysisError(
      `File is ${(file.size / 1024 / 1024).toFixed(0)} MB — the video limit is 200 MB.`,
    );
  }
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const format = sniffFormat(head);
  if (!["mp4", "webm", "avi", "unknown"].includes(format)) {
    throw new AnalysisError("That file does not look like a video container.");
  }
  if (shouldCancel()) throw new AnalysisCancelled();

  emit({ stage: "hashing", pct: 8, note: "Computing content hash" });
  const { hash, partial } = await hashFile(file);
  if (partial) warnings.push("Hash computed over the first 64 MB of this large file.");
  if (shouldCancel()) throw new AnalysisCancelled();

  emit({ stage: "decoding", pct: 14, note: "Loading video metadata" });
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out loading the video.")), 20000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "This browser cannot decode the video (AVI and some codecs are unsupported). Convert the file to MP4 (H.264) and try again.",
          ),
        );
      };
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw new AnalysisError(
      "Could not load this video in the browser.",
      err instanceof Error ? err.message : String(err),
    );
  }
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(url);
    throw new AnalysisError("Video duration could not be determined.");
  }
  if (duration > LIMITS.videoMaxSeconds) {
    URL.revokeObjectURL(url);
    throw new AnalysisError(
      `Video is ${Math.round(duration)}s — the limit is ${LIMITS.videoMaxSeconds}s (3 minutes). Trim the clip and retry.`,
    );
  }
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    URL.revokeObjectURL(url);
    throw new AnalysisError("Video has no decodable video track.");
  }

  const metaBytes = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer());
  const metadata = settings.enableMetadata ? parseMetadata(metaBytes, format) : null;

  /* frame extraction canvas */
  const fw = Math.min(FRAME_W, vw);
  const fh = Math.max(1, Math.round((vh / vw) * fw));
  const canvas = document.createElement("canvas");
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new AnalysisError("Canvas 2D context unavailable in this browser.");
  }

  const frameCount = Math.max(2, Math.min(settings.maxFrames, Math.ceil(duration * settings.frameRate)));
  const times = Array.from({ length: frameCount }, (_, i) => (duration * (i + 1)) / (frameCount + 1));

  emit({ stage: "extracting frames", pct: 18, note: `${frameCount} frames at ${settings.frameRate} fps` });
  const frameInputs: FrameInput[] = [];
  const frameFaces: FaceResult[][] = [];
  let faceStatus: EngineInfo["faceDetector"]["status"] = "loaded";
  let faceDetail: string | undefined;
  let faceFailureNoted = false;
  let prevBox: { x: number; y: number; w: number; h: number } | null = null;
  let jitterSum = 0;
  let jitterPairs = 0;

  for (let i = 0; i < times.length; i++) {
    if (shouldCancel()) {
      URL.revokeObjectURL(url);
      throw new AnalysisCancelled();
    }
    try {
      await seekTo(video, Math.min(times[i], Math.max(0, duration - 0.05)));
    } catch (err) {
      warnings.push(`Frame ${i} at ${times[i].toFixed(1)}s could not be decoded and was skipped.`);
      frameInputs.push({
        t: times[i],
        noise: 0,
        luma: 0,
        slope: -2.8,
        peak: 1,
        hfRatio: 0.1,
        faceScore: null,
        faces: 0,
      });
      frameFaces.push([]);
      continue;
    }
    ctx.drawImage(video, 0, 0, fw, fh);
    const rgba = ctx.getImageData(0, 0, fw, fh).data;
    const { sig, luma } = frameMetrics(rgba, fw, fh);

    let detections: Awaited<ReturnType<typeof detectFaces>> = [];
    if (faceStatus === "loaded") {
      try {
        detections = await detectFaces(canvas, fw, fh);
      } catch (err) {
        if (!faceFailureNoted) {
          faceStatus = "unavailable";
          faceDetail =
            err instanceof Error ? err.message : String(err);
          warnings.push(
            `Face detector became unavailable after frame ${i} — later frames have no face measurements.`,
          );
          faceFailureNoted = true;
        }
      }
    }

    const faces: FaceResult[] = detections.map((d, k) => {
      const r = analyzeFace(rgba, fw, fh, d.box, sig, sig.ela);
      return { index: k, box: d.box, score: r.score, confidence: r.confidence, checks: r.checks };
    });
    frameFaces.push(faces);

    let faceScore: number | null = null;
    if (faces.length) {
      const area = (f: FaceResult) => f.box.w * f.box.h;
      const tot = faces.reduce((a, f) => a + area(f), 0) || 1;
      faceScore = faces.reduce((a, f) => a + f.score * area(f), 0) / tot;
      const box = faces[0].box;
      if (prevBox) {
        const dx = box.x + box.w / 2 - (prevBox.x + prevBox.w / 2);
        const dy = box.y + box.h / 2 - (prevBox.y + prevBox.h / 2);
        const diag = Math.hypot(box.w, box.h) || 1;
        jitterSum += Math.hypot(dx, dy) / diag;
        jitterPairs++;
      }
      prevBox = box;
    }

    frameInputs.push({
      t: times[i],
      noise: sig.noise.sigmaFlat,
      luma,
      slope: sig.spectrum.slope,
      peak: sig.spectrum.peak,
      hfRatio: sig.spectrum.hfRatio,
      faceScore,
      faces: faces.length,
    });

    emit({
      stage: "analyzing frames",
      pct: 18 + Math.round(((i + 1) / times.length) * 48),
      note: `Frame ${i + 1}/${times.length} · t=${times[i].toFixed(1)}s`,
    });
    if (i % 4 === 3) await tick();
  }

  const faceJitter = jitterPairs > 0 ? jitterSum / jitterPairs : 0;
  emit({ stage: "temporal", pct: 70, note: "Temporal consistency check" });
  const { stats: temporal, frameResults } = analyzeTemporal(frameInputs, faceJitter);
  const timeline = buildTimeline(frameResults, duration);
  const hasFaces = frameInputs.some((f) => f.faces > 0);
  const score = combineVideo(frameResults, temporal, hasFaces);
  await tick();

  /* --- most suspicious frame → face breakdown ----------------------- */
  const peakIdx = frameResults.reduce(
    (best, r, i) => (r.score > frameResults[best].score ? i : best),
    0,
  );
  const faces: FaceResult[] = (frameFaces[peakIdx] ?? []).map((f, i) => ({ ...f, index: i }));

  /* --- audio -------------------------------------------------------- */
  let audio: VideoAnalysis["audio"] = null;
  const audioChecks = [];
  if (settings.enableAudio) {
    emit({ stage: "audio", pct: 76, note: "Profiling audio track" });
    try {
      const actx = new AudioContext();
      try {
        const buf = await decodeAudio(file, LIMITS.videoMaxSeconds);
        if (buf) {
          audio = await analyzeAudio(actx, buf);
          audioChecks.push(makeAudioCheck(audio));
        } else {
          warnings.push("No decodable audio track was found (or the codec is unsupported).");
        }
      } finally {
        await actx.close();
      }
    } catch {
      warnings.push("Audio profiling failed and was skipped — no audio claims are made.");
    }
    await tick();
  }

  /* --- top frames with heatmaps ------------------------------------- */
  emit({ stage: "report", pct: 82, note: "Rendering top suspicious frames" });
  const ranked = [...frameResults].sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 8);
  const suspiciousFrames: SuspiciousFrame[] = top.map((r) => ({
    index: r.index,
    t: r.t,
    score: r.score,
  }));
  const heatCanvas = document.createElement("canvas");
  const heatW = Math.min(480, fw);
  const heatH = Math.max(1, Math.round((fh / fw) * heatW));
  heatCanvas.width = heatW;
  heatCanvas.height = heatH;
  const hctx = heatCanvas.getContext("2d", { willReadFrequently: true });

  const posterTimes: Array<{ slot: number; t: number }> = [
    { slot: -1, t: Math.min(0.1, duration / 2) }, // poster = opening frame
  ];
  for (let s = 0; s < Math.min(4, top.length); s++) posterTimes.push({ slot: s, t: top[s].t });

  let posterDataUrl: string | undefined;
  const frameArtifacts: NonNullable<AnalysisArtifacts["frameArtifacts"]> = [];
  if (hctx) {
    for (const target of posterTimes) {
      if (shouldCancel()) break;
      try {
        await seekTo(video, Math.min(target.t, Math.max(0, duration - 0.05)));
      } catch {
        continue;
      }
      hctx.drawImage(video, 0, 0, heatW, heatH);
      const thumb = heatCanvas.toDataURL("image/jpeg", 0.82);
      if (target.slot === -1) {
        posterDataUrl = thumb;
        continue;
      }
      const rgba = hctx.getImageData(0, 0, heatW, heatH).data;
      void rgba;
      const ela = settings.enableEla ? await elaFromCanvas(heatCanvas) : null;
      const srcFaces = frameFaces[top[target.slot].index] ?? [];
      const heat = renderHeatmap({
        source: heatCanvas,
        srcW: heatW,
        srcH: heatH,
        ela,
        tileSize: TILE,
        faces: srcFaces,
        caption: `frame @ ${top[target.slot].t.toFixed(1)}s`,
      });
      frameArtifacts.push({
        t: top[target.slot].t,
        score: top[target.slot].score,
        imageDataUrl: thumb,
        heatDataUrl: heat,
      });
      await tick();
    }
  }
  if (!posterDataUrl) posterDataUrl = frameArtifacts[0]?.imageDataUrl;

  /* --- checks + verdict --------------------------------------------- */
  emit({ stage: "report", pct: 92, note: "Composing verdict" });
  const medNoise = median(frameInputs.map((f) => f.noise).filter((n) => n > 0));
  const medSlope = median(frameInputs.map((f) => f.slope));
  const medPeak = median(frameInputs.map((f) => f.peak));
  const checks = buildVideoChecks({ temporal, hasFaces, medNoise, medSlope, medPeak, metadata });

  let faceScore: number | null = null;
  if (hasFaces) {
    const scored = frameInputs.filter((f) => f.faceScore !== null);
    faceScore = scored.length
      ? scored.reduce((a, f) => a + (f.faceScore ?? 0), 0) / scored.length
      : null;
    if (faceScore !== null) {
      checks.push({
        id: "face",
        label: "Face manipulation signal (video)",
        group: "face",
        raw: faceScore,
        display: `${(faceScore * 100).toFixed(0)}% lean · ${scored.length} frames with faces`,
        score: faceScore,
        weight: WEIGHTS.face,
        status: faceScore >= 0.65 ? "flag" : faceScore >= 0.4 ? "warn" : "ok",
        finding:
          `Faces were measured in ${scored.length}/${frameInputs.length} sampled frames; weighted face-level lean = ${(faceScore * 100).toFixed(0)}%. ` +
          (faceScore >= 0.65
            ? "Face texture, blending boundaries and geometry behave unlike an optically captured face."
            : "Face-level measurements sit inside expected ranges across the clip."),
      });
    }
  } else {
    warnings.push(
      "No faces found in any sampled frame — this result is about generated/re-encoded video signals only, not face swaps.",
    );
  }
  checks.push(...audioChecks);

  const finalScore = combineChecks(checks);
  const decision = decideVerdict({
    score: finalScore,
    checks,
    faceScore,
    kind: "video",
    sensitivity: settings.sensitivity,
  });

  const analysis: VideoAnalysis = {
    kind: "video",
    verdict: decision.verdict,
    confidence: decision.confidence,
    score: finalScore,
    explanation: decision.explanation,
    checks,
    faces,
    timeline,
    frames: frameResults,
    suspiciousFrames,
    temporal,
    audio,
    metadata,
    engine: engineInfo(faceStatus, faceDetail, checks.filter((c) => c.weight > 0).map((c) => c.id)),
    warnings,
    processingTimeMs: Math.round(performance.now() - t0),
    durationSec: duration,
    frameCount: frameResults.length,
    dimensions: { width: vw, height: vh },
    hash,
  };

  URL.revokeObjectURL(url);
  emit({ stage: "report", pct: 100, note: "Done" });
  return {
    analysis,
    artifacts: { previewDataUrl: posterDataUrl, frameArtifacts },
  };
}

function buildVideoChecks(args: {
  temporal: TemporalStats;
  hasFaces: boolean;
  medNoise: number;
  medSlope: number;
  medPeak: number;
  metadata: MetadataFindings | null;
}) {
  const { temporal, hasFaces, medNoise, medSlope, medPeak, metadata } = args;
  const checks: Analysis["checks"] = [];

  const sFlicker = ramp(temporal.flicker, BANDS.noiseSpread.lo * 0.1, 0.3);
  checks.push({
    id: "flicker",
    label: "Noise flicker between frames",
    group: "temporal",
    raw: temporal.flicker,
    display: `${(temporal.flicker * 100).toFixed(1)}% frame-to-frame`,
    score: sFlicker,
    weight: 0.18,
    status: sFlicker >= 0.65 ? "flag" : sFlicker >= 0.4 ? "warn" : "ok",
    finding:
      `Median noise-floor change between consecutive frames = ${(temporal.flicker * 100).toFixed(1)}% ` +
      `(excluding ${temporal.cuts} scene cut(s)). ` +
      (sFlicker >= 0.5
        ? "Rapidly oscillating sensor noise is a hallmark of per-frame synthesis or face reenactment."
        : "Noise evolves smoothly across frames, as in a continuous recording."),
  });

  const sCv = ramp(temporal.scoreCv, 0.12, 0.38);
  checks.push({
    id: "stability",
    label: "Frame-score stability",
    group: "temporal",
    raw: temporal.scoreCv,
    display: `CV ${temporal.scoreCv.toFixed(2)}`,
    score: sCv,
    weight: 0.14,
    status: sCv >= 0.65 ? "flag" : sCv >= 0.4 ? "warn" : "ok",
    finding:
      `Per-frame forensic score varies with CV = ${temporal.scoreCv.toFixed(2)}. ` +
      (sCv >= 0.5
        ? "Strongly inconsistent evidence between frames suggests segments produced by different processes."
        : "Evidence is consistent from frame to frame."),
  });

  if (hasFaces) {
    const sJit = ramp(temporal.faceJitter, 0.04, 0.18);
    checks.push({
      id: "jitter",
      label: "Face geometry stability",
      group: "temporal",
      raw: temporal.faceJitter,
      display: `${(temporal.faceJitter * 100).toFixed(1)}% movement/frame`,
      score: sJit,
      weight: 0.14,
      status: sJit >= 0.65 ? "flag" : sJit >= 0.4 ? "warn" : "ok",
      finding:
        `Tracked face centre moves ${(temporal.faceJitter * 100).toFixed(1)}% of its size per frame on average. ` +
        (sJit >= 0.5
          ? "Unstable face geometry — warping or reenactment boundaries often drift frame to frame."
          : "Face geometry is stable, consistent with a fixed camera."),
    });
  }

  const sLights = ramp(temporal.lightJumps, 1, 6) * 0.6;
  checks.push({
    id: "lighting",
    label: "Lighting continuity",
    group: "temporal",
    raw: temporal.lightJumps,
    display: `${temporal.lightJumps} jump(s)`,
    score: clamp01(sLights),
    weight: 0.08,
    status: sLights >= 0.65 ? "flag" : sLights >= 0.4 ? "warn" : "ok",
    finding:
      `${temporal.lightJumps} mid-range luminance jump(s) between consecutive frames outside ${temporal.cuts} detected scene cut(s). ` +
      (sLights >= 0.5
        ? "Inconsistent lighting without a scene change suggests separately generated segments."
        : "Lighting evolves continuously."),
  });

  const sNoise = 1 - ramp(medNoise, BANDS.noiseSmooth.lo, BANDS.noiseSmooth.hi);
  checks.push({
    id: "noise",
    label: "Frame noise floor",
    group: "signal",
    raw: medNoise,
    display: `σ ${medNoise.toFixed(2)}`,
    score: clamp01(sNoise),
    weight: 0.16,
    status: sNoise >= 0.65 ? "flag" : sNoise >= 0.4 ? "warn" : "ok",
    finding:
      `Median flat-region noise across frames σ = ${medNoise.toFixed(2)} (camera video typically ≈ 0.8–6.0 after downscaling). ` +
      (sNoise >= 0.5
        ? "Frames are far smoother than sensor output — consistent with generated or heavily denoised video."
        : "Noise floor matches sensor-originated video."),
  });

  const x = -medSlope;
  const sSpec = clamp01(
    0.65 * ramp(x, BANDS.spectralSlope.steep, BANDS.spectralSlope.steep + 1.1) +
      0.35 * ramp(medPeak, BANDS.spectralPeak.lo, BANDS.spectralPeak.hi),
  );
  checks.push({
    id: "spectrum",
    label: "Frame frequency spectrum",
    group: "spectral",
    raw: medSlope,
    display: `β ${medSlope.toFixed(2)} · peak ×${medPeak.toFixed(1)}`,
    score: sSpec,
    weight: 0.12,
    status: sSpec >= 0.65 ? "flag" : sSpec >= 0.4 ? "warn" : "ok",
    finding:
      `Median spectral slope β = ${medSlope.toFixed(2)} with strongest peak ×${medPeak.toFixed(1)}. ` +
      (sSpec >= 0.5
        ? "Spectral shape deviates from natural camera footage — generative upsampling or synthesis is likely."
        : "Spectral shape matches natural footage."),
  });

  if (metadata) {
    const md = metadataCheckForVideo(metadata);
    checks.push(md);
  }
  return checks;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function metadataCheckForVideo(md: MetadataFindings): Analysis["checks"][number] {
  let score = 0.5;
  let status: "ok" | "warn" | "flag" = "warn";
  let finding: string;
  if (md.aiSignatures.length > 0) {
    score = 0.95;
    status = "flag";
    finding = `AI tooling signatures found in the container: ${md.aiSignatures.join(", ")}.`;
  } else if (md.tags["Encoder"]) {
    score = 0.5;
    status = "ok";
    finding = `Encoder metadata present (${md.tags["Encoder"]}). Encoders like ffmpeg are used by both ordinary edits and deepfake pipelines — informational only.`;
  } else {
    score = 0.5;
    status = "warn";
    finding = "No generator or camera signatures found in the container metadata.";
  }
  return {
    id: "metadata",
    label: "Container metadata",
    group: "metadata",
    raw: md.aiSignatures.length,
    display: `${md.format}${md.aiSignatures.length ? ` · ${md.aiSignatures.length} AI marker(s)` : ""}`,
    score,
    weight: 0.12,
    status,
    finding,
  };
}
