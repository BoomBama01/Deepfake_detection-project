/**
 * Engine verification harness — runs the signal-forensic pipeline on the
 * bundled samples outside the browser and prints every measured check.
 *
 *   bun scripts/engine-check.ts
 *
 * Run it twice: the output must be byte-identical (deterministic, no random
 * scores).
 */
import { readFileSync } from "fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { analyzeFace, analyzeSignal, WEIGHTS } from "../src/lib/engine/forensics";
import { parseMetadata, sniffFormat } from "../src/lib/engine/metadata";
import { decideVerdict } from "../src/lib/engine/verdict";
import { DEFAULT_SETTINGS, type FaceBox } from "../src/lib/engine/types";

/** Keep in sync with scripts/make-samples.mjs */
const COMPOSITE_FACE_BOX: FaceBox = { x: 0.3, y: 0.11, w: 0.4, h: 0.74 };

const files: Array<{ file: string; faceBox?: FaceBox }> = [
  { file: "public/samples/photo-camera.jpg" },
  { file: "public/samples/ai-generated.png" },
  { file: "public/samples/photo-spliced.jpg" },
  { file: "public/samples/face-composited.jpg", faceBox: COMPOSITE_FACE_BOX },
];

for (const { file, faceBox } of files) {
  const bytes = new Uint8Array(readFileSync(file));
  const format = sniffFormat(bytes);
  const img =
    format === "png"
      ? (() => {
          const png = PNG.sync.read(Buffer.from(bytes));
          return { data: png.data as Uint8Array, width: png.width, height: png.height };
        })()
      : jpeg.decode(bytes, { useTArray: true });

  // ELA input: re-encode at q=0.9 exactly like the browser pipeline does
  const rec = jpeg.encode(
    { data: img.data, width: img.width, height: img.height },
    90,
  );
  const recImg = jpeg.decode(rec.data, { useTArray: true });

  const metadata = parseMetadata(bytes, format);
  const sig = analyzeSignal(
    img.data,
    img.width,
    img.height,
    DEFAULT_SETTINGS,
    format,
    recImg.data,
    metadata,
  );

  const checks = [...sig.checks];
  let faceScore: number | null = null;
  if (faceBox) {
    const fr = analyzeFace(img.data, img.width, img.height, faceBox, sig, sig.ela);
    faceScore = fr.score;
    const st = fr.score >= 0.65 ? "flag" : fr.score >= 0.4 ? "warn" : "ok";
    checks.push({
      id: "face",
      label: "Face manipulation signal",
      group: "face",
      raw: fr.score,
      display: `${(fr.score * 100).toFixed(0)}% lean`,
      score: fr.score,
      weight: WEIGHTS.face,
      status: st,
      finding: `Face-level forensic lean = ${(fr.score * 100).toFixed(0)}%.`,
    });
    const faceAreaRatio = faceBox.w * faceBox.h;
    if (faceAreaRatio > 0.35) {
      for (const c of checks) {
        if (c.id === "face") c.weight = 0.6;
        else if (c.group === "signal" || c.group === "spectral" || c.id === "ela")
          c.weight *= 0.4;
      }
    }
    console.log(`\n--- face region checks (${file}) ---`);
    for (const c of fr.checks) {
      console.log(
        `  [${c.status.padEnd(4)}] ${c.label.padEnd(30)} ${c.display.padEnd(24)} score=${c.score.toFixed(2)} w=${c.weight}`,
      );
    }
  }

  const d = decideVerdict({
    checks,
    faceScore,
    kind: "image",
    sensitivity: "balanced",
  });
  const score = d.score;

  console.log(`\n=== ${file} (${format}, ${img.width}×${img.height}) QF=${metadata.tags["EstimatedJpegQuality"] ?? "?"} ===`);
  for (const c of checks) {
    console.log(
      `  [${c.status.padEnd(4)}] ${c.label.padEnd(34)} ${c.display.padEnd(26)} score=${c.score.toFixed(2)} w=${c.weight.toFixed(2)}`,
    );
  }
  console.log(`  => score=${score.toFixed(3)} verdict=${d.verdict} confidence=${d.confidence}`);
}
