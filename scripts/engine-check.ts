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
import { combineChecks, analyzeSignal } from "../src/lib/engine/forensics";
import { parseMetadata, sniffFormat } from "../src/lib/engine/metadata";
import { decideVerdict } from "../src/lib/engine/verdict";
import { DEFAULT_SETTINGS } from "../src/lib/engine/types";

const files = [
  "public/samples/photo-camera.jpg",
  "public/samples/face-generated.jpg",
  "public/samples/photo-spliced.jpg",
];

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  const format = sniffFormat(bytes);
  const img = jpeg.decode(bytes, { useTArray: true });

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

  const score = combineChecks(sig.checks);
  const d = decideVerdict({
    score,
    checks: sig.checks,
    faceScore: null,
    kind: "image",
    sensitivity: "balanced",
  });

  console.log(`\n=== ${file} (${format}, ${img.width}×${img.height}) ===`);
  for (const c of sig.checks) {
    console.log(
      `  [${c.status.padEnd(4)}] ${c.label.padEnd(34)} raw=${String(c.raw).slice(0, 8).padEnd(8)} score=${c.score.toFixed(2)} w=${c.weight}`,
    );
  }
  console.log(
    `  => score=${score.toFixed(3)} verdict=${d.verdict} confidence=${d.confidence}`,
  );
  if (metadata.aiSignatures.length) {
    console.log(`  AI signatures: ${metadata.aiSignatures.join(", ")}`);
  }
}
