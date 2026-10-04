/**
 * Robustness check (audit item: "add augmentation … so social-media images
 * are handled") — verifies verdicts survive the transformations real uploads
 * go through: JPEG recompression, blur, and downscale/upscale.
 *
 *   bunx tsx scripts/robustness-check.ts
 *
 * For every bundled known-labeled sample it runs the baseline plus each
 * perturbation and asserts:
 *   - a fake sample never comes back "real"      (critical failure)
 *   - a real sample never comes back likely_*    (critical failure)
 *   - Inconclusive after a perturbation is tolerated but reported
 *     (evidence destroyed by recompression ⇒ abstain, not guess)
 *
 * Exits non-zero if any critical failure occurs (CI-usable).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { analyzeFile, decodeImage, type DecodedImage } from "./lib/pipeline";
import { blurRgba, encodeJpeg, resizeRoundTrip } from "./lib/perturb";
import type { FaceBox, Verdict } from "../src/lib/engine/types";

type Truth = "real" | "fake";

const SAMPLES: Array<{ file: string; truth: Truth; faceBox?: FaceBox }> = [
  { file: "public/samples/photo-camera.jpg", truth: "real" },
  { file: "public/samples/photo-scene2.jpg", truth: "real" },
  { file: "public/samples/ai-generated.png", truth: "fake" },
  { file: "public/samples/photo-spliced.jpg", truth: "fake" },
  {
    file: "public/samples/face-composited.jpg",
    truth: "fake",
    faceBox: { x: 0.3, y: 0.11, w: 0.4, h: 0.74 },
  },
  {
    file: "public/samples/face-generated.jpg",
    truth: "fake",
    faceBox: { x: 0.2, y: 0.06, w: 0.6, h: 0.84 },
  },
];

/* ---- evaluation ------------------------------------------------------- */

interface Perturbation {
  name: string;
  apply: (img: DecodedImage) => DecodedImage;
  asJpeg?: number; // re-encode quality after apply
}

const PERTURBATIONS: Perturbation[] = [
  { name: "baseline (as-is)", apply: (i) => i },
  { name: "JPEG re-encode q60", apply: (i) => i, asJpeg: 60 },
  { name: "JPEG re-encode q40", apply: (i) => i, asJpeg: 40 },
  { name: "box blur 3×3 ×2", apply: (i) => blurRgba(i, 1, 2), asJpeg: 85 },
  { name: "downscale 50% → upscale", apply: (i) => resizeRoundTrip(i, 0.5), asJpeg: 85 },
];

function isPredFake(v: Verdict): boolean {
  return v === "likely_ai" || v === "likely_deepfake";
}

const dir = mkdtempSync(join(tmpdir(), "tl-robust-"));
let critical = 0;
let degraded = 0;

try {
  console.log(`\nTruthLens robustness — social-media transform simulation\n`);
  for (const s of SAMPLES) {
    const base = decodeImage(s.file);
    const row: string[] = [];
    let failedPerturbation = false;
    for (const p of PERTURBATIONS) {
      const transformed = p.apply(base.img);
      const bytes =
        p.asJpeg !== undefined
          ? encodeJpeg(transformed, p.asJpeg)
          : readFileSync(s.file);
      const tmp = join(dir, `${s.file.split("/").pop()}-${p.name.replace(/[^a-z0-9]+/gi, "_")}.jpg`);
      writeFileSync(tmp, bytes);
      let verdict: Verdict = "error";
      let score = 0;
      try {
        const r = analyzeFile(tmp, { faceBox: s.faceBox });
        verdict = r.decision.verdict;
        score = r.decision.score;
      } catch {
        verdict = "error";
      }
      const bad =
        (s.truth === "fake" && verdict === "real") ||
        (s.truth === "real" && isPredFake(verdict)) ||
        verdict === "error";
      const soft = verdict === "inconclusive" && p.name !== "baseline (as-is)";
      if (bad) {
        failedPerturbation = true;
        critical++;
      }
      if (soft) degraded++;
      row.push(`${p.name}: ${verdict} (${score.toFixed(2)})${bad ? " ✗" : soft ? " ~" : ""}`);
    }
    console.log(`  ${s.file} [${s.truth}]${failedPerturbation ? " — CRITICAL" : ""}`);
    for (const line of row) console.log(`      ${line}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  critical failures (fake→real or real→fake): ${critical}`);
console.log(`  degraded (perturbed → inconclusive, evidence destroyed): ${degraded}`);
if (critical > 0) {
  console.log(`\n  ✗ robustness check FAILED`);
  process.exit(1);
}
console.log(`\n  ✓ no fake was called real and no real was called fake under any transform`);
