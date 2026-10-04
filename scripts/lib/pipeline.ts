/**
 * Shared Node-side analysis pipeline.
 *
 * Runs the *same* engine code as the browser runner (decode → metadata →
 * signal forensics → face aggregation → verdict) on a JPEG/PNG file, so the
 * test/evaluation scripts measure exactly what the website computes.
 *
 * Known environment difference (documented in the audit): the browser
 * decodes via the platform's color-managed image decoder and re-encodes
 * ELA with the platform JPEG encoder, while Node uses jpeg-js/pngjs.
 * Pixel values can differ by a hair; check *scores* are stable because all
 * bands are calibrated with margins.
 */
import { readFileSync } from "fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import {
  analyzeFace,
  analyzeSignal,
  buildFaceAggregate,
  evidenceQuality,
  type FaceCheckResult,
} from "../../src/lib/engine/forensics";
import {
  parseMetadata,
  sniffFormat,
  type MediaFormat,
} from "../../src/lib/engine/metadata";
import { decideVerdict, type VerdictDecision } from "../../src/lib/engine/verdict";
import {
  DEFAULT_SETTINGS,
  type AnalysisSettings,
  type Check,
  type FaceBox,
} from "../../src/lib/engine/types";

export interface DecodedImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface PipelineResult {
  path: string;
  format: MediaFormat;
  width: number;
  height: number;
  jpegQuality: string;
  metadata: ReturnType<typeof parseMetadata>;
  /** full signal analysis (gray plane, ELA, per-check stats) */
  sig: ReturnType<typeof analyzeSignal>;
  /** checks exactly as fed to the verdict (face aggregated, weights applied) */
  checks: Check[];
  faceScore: number | null;
  /** per-face sub-checks when a face box was supplied */
  face: FaceCheckResult | null;
  decision: VerdictDecision;
}

/** Decode a JPEG or PNG file to RGBA. Throws for other formats. */
export function decodeImage(path: string): {
  img: DecodedImage;
  format: MediaFormat;
  bytes: Uint8Array;
} {
  const bytes = new Uint8Array(readFileSync(path));
  const format = sniffFormat(bytes);
  if (format === "png") {
    const png = PNG.sync.read(Buffer.from(bytes));
    return {
      img: { data: png.data as Uint8Array, width: png.width, height: png.height },
      format,
      bytes,
    };
  }
  if (format === "jpeg" || format === "webp") {
    // jpeg-js decodes baseline JPEG; webp is rejected below via decode guard
    try {
      const img = jpeg.decode(bytes, { useTArray: true });
      return { img: { data: img.data, width: img.width, height: img.height }, format, bytes };
    } catch {
      throw new Error(`Could not decode ${path} (only baseline JPEG and PNG are supported here).`);
    }
  }
  throw new Error(`Unsupported format "${format}" for ${path} — Node harness handles JPEG/PNG only.`);
}

/**
 * Run the engine on a file. `faceBox` plays the role the on-device face
 * detector (BlazeFace) plays in the browser — the Node harness has no
 * detector, so pass boxes via the face manifest when a script needs
 * face-level checks.
 */
export function analyzeFile(
  path: string,
  opts: { faceBox?: FaceBox; settings?: AnalysisSettings } = {},
): PipelineResult {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const { img, format, bytes } = decodeImage(path);
  const { width, height } = img;

  // ELA input: re-encode at q=0.9 exactly like the browser pipeline does
  const rec = jpeg.encode(
    { data: img.data as Uint8Array, width, height },
    90,
  );
  const recImg = jpeg.decode(rec.data, { useTArray: true });

  const metadata = parseMetadata(bytes, format);
  const sig = analyzeSignal(
    img.data,
    width,
    height,
    settings,
    format,
    recImg.data,
    metadata,
  );

  const checks = [...sig.checks];
  let faceScore: number | null = null;
  let face: FaceCheckResult | null = null;
  if (opts.faceBox) {
    face = analyzeFace(img.data, width, height, opts.faceBox, sig, sig.ela);
    /* identical aggregation to the browser pipeline (runner.ts) */
    const agg = buildFaceAggregate([
      {
        index: 0,
        box: opts.faceBox,
        score: face.score,
        confidence: face.confidence,
        checks: face.checks,
      },
    ]);
    faceScore = agg.faceScore;
    if (agg.check) checks.push(agg.check);
    if (agg.dominant) {
      for (const c of checks) {
        if (c.id === "face") c.weight = 0.6;
        else if (c.group === "signal" || c.group === "spectral" || c.id === "ela")
          c.weight *= 0.4;
      }
    }
  }

  const decision = decideVerdict({
    checks,
    faceScore,
    kind: "image",
    sensitivity: settings.sensitivity,
    evidence: evidenceQuality(sig.sharpness, metadata),
  });

  return {
    path,
    format,
    width,
    height,
    jpegQuality: String(metadata.tags["EstimatedJpegQuality"] ?? "?"),
    metadata,
    sig,
    checks,
    faceScore,
    face,
    decision,
  };
}

/** One line of the per-check report (shared formatting). */
export function formatCheck(c: Check): string {
  return `  [${c.status.padEnd(4)}] ${c.label.padEnd(34)} ${c.display.padEnd(26)} score=${c.score.toFixed(2)} w=${c.weight.toFixed(2)}`;
}
