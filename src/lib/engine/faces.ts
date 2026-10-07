/**
 * TruthLens — face localisation via MediaPipe BlazeFace (runs fully offline;
 * wasm + model are served from /vision and /models).
 *
 * If the model cannot load, callers get a typed error so the UI can show a
 * clear "face detector unavailable" state instead of inventing face scores.
 */

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceBox } from "./types";

export class FaceDetectorUnavailableError extends Error {
  readonly causeDetail: string;
  constructor(detail: string) {
    super(`Face detector unavailable: ${detail}`);
    this.name = "FaceDetectorUnavailableError";
    this.causeDetail = detail;
  }
}

let detectorPromise: Promise<FaceDetector> | null = null;

async function load(): Promise<FaceDetector> {
  const fileset = await FilesetResolver.forVisionTasks("/vision");
  return FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/models/face_detector.task" },
    runningMode: "IMAGE",
    minDetectionConfidence: 0.4,
  });
}

export function getFaceDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = load().catch((err) => {
      detectorPromise = null; // allow a retry on the next run
      throw new FaceDetectorUnavailableError(err instanceof Error ? err.message : String(err));
    });
  }
  return detectorPromise;
}

export interface FaceDetection {
  box: FaceBox;
  score: number;
}

/** Detect faces on a drawable source; boxes are normalised to 0..1. */
export async function detectFacesCore(
  source: HTMLCanvasElement | ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
): Promise<FaceDetection[]> {
  const detector = await getFaceDetector();
  void width;
  void height;
  const result = await detector.detect(source);
  const out: FaceDetection[] = [];
  for (const d of result.detections ?? []) {
    const bb = d.boundingBox;
    if (!bb) continue;
    out.push({
      box: {
        x: clamp01(bb.originX / width),
        y: clamp01(bb.originY / height),
        w: clamp01(bb.width / width),
        h: clamp01(bb.height / height),
      },
      score: d.categories?.[0]?.score ?? 0.5,
    });
  }
  // largest faces first
  out.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Intersection-over-utility for tracking a face across frames. */
export function iou(a: FaceBox, b: FaceBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export function centerOf(b: FaceBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * Runner-friendly face-detection wrapper.
 *
 * Returns the shape the video pipeline expects ({ faces, elapsed, warnings })
 * so runner.ts can call detectFaces with the same arity it uses everywhere.
 */
export async function detectFaces(
  source: HTMLCanvasElement | ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  _settings: unknown,
  _metadata: unknown,
): Promise<{ faces: FaceDetection[]; elapsed: number; warnings: string[] }> {
  const t0 = performance.now();
  let faces: FaceDetection[];
  const warnings: string[] = [];
  try {
    faces = await detectFacesCore(source, width, height);
  } catch (err) {
    warnings.push(
      err instanceof FaceDetectorUnavailableError
        ? err.message
        : `Face detection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    faces = [];
  }
  return { faces, elapsed: performance.now() - t0, warnings };
}
