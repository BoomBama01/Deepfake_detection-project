/**
 * Engine verification harness — runs the signal-forensic pipeline on the
 * bundled samples outside the browser and prints every measured check.
 *
 *   bunx tsx scripts/engine-check.ts
 *
 * Run it twice: the output must be byte-identical (deterministic, no random
 * scores).
 */
import { analyzeFile, formatCheck } from "./lib/pipeline";
import type { FaceBox } from "../src/lib/engine/types";

/** Keep in sync with scripts/make-samples.mjs */
const COMPOSITE_FACE_BOX: FaceBox = { x: 0.3, y: 0.11, w: 0.4, h: 0.74 };

const files: Array<{ file: string; faceBox?: FaceBox }> = [
  { file: "public/samples/photo-camera.jpg" },
  { file: "public/samples/photo-scene2.jpg" },
  { file: "public/samples/ai-generated.png" },
  { file: "public/samples/photo-spliced.jpg" },
  { file: "public/samples/face-composited.jpg", faceBox: COMPOSITE_FACE_BOX },
  {
    file: "public/samples/face-generated.jpg",
    faceBox: { x: 0.2, y: 0.06, w: 0.6, h: 0.84 },
  },
];

for (const { file, faceBox } of files) {
  const r = analyzeFile(file, { faceBox });

  if (faceBox && r.face) {
    console.log(`\n--- face region checks (${file}) ---`);
    for (const c of r.face.checks) {
      console.log(
        `  [${c.status.padEnd(4)}] ${c.label.padEnd(30)} ${c.display.padEnd(24)} score=${c.score.toFixed(2)} w=${c.weight}`,
      );
    }
  }

  console.log(
    `\n=== ${file} (${r.format}, ${r.width}×${r.height}) QF=${r.jpegQuality} ===`,
  );
  for (const c of r.checks) {
    console.log(formatCheck(c));
  }
  console.log(
    `  => score=${r.decision.score.toFixed(3)} verdict=${r.decision.verdict} confidence=${r.decision.confidence}`,
  );
}
