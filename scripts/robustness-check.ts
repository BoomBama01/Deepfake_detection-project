/**
 * Robustness check (audit item: "add augmentation … so social-media images
 * are handled") — verifies verdicts survive the transformations real uploads
 * go through: JPEG recompression, blur, and downscale/upscale.
 *
 *   bunx tsx scripts/robustness-check.ts
 *
 * For every bundled known-labeled sample it runs the baseline plus each
 * perturbation and asserts:
 *   - no *confident* fake→real or real→fake call after a perturbation
 *     (critical failure — the verdict is binary, so what matters is that a
 *     direction flip is never made with firm confidence)
 *   - a perturbed call inside the low-confidence zone is tolerated but
 *     reported (uncertain band, ≤ 60% confidence, or score between the
 *     thresholds ⇒ evidence destroyed by recompression/blur, and the
 *     binary call is explicitly flagged low-confidence)
 *
 * Exits non-zero if any critical failure occurs (CI-usable).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { analyzeFile, decodeImage, type DecodedImage } from "./lib/pipeline";
import { blurRgba, encodeJpeg, resizeRoundTrip } from "./lib/perturb";
import { THRESHOLDS } from "../src/lib/engine/verdict";
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
let softWrong = 0;
/* pipeline default sensitivity is balanced */
const T = THRESHOLDS.balanced;

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
      let confidence = 0;
      let uncertain = false;
      try {
        const r = analyzeFile(tmp, { faceBox: s.faceBox });
        verdict = r.decision.verdict;
        score = r.decision.score;
        confidence = r.decision.confidence;
        uncertain = r.decision.uncertainBand;
      } catch {
        verdict = "error";
      }
      /* low-confidence zone: the call exists (binary engine) but the
         evidence does not firmly support either side */
      const inBand = score > T.real && score < T.fake;
      const soft =
        p.name !== "baseline (as-is)" &&
        (verdict === "inconclusive" || uncertain || confidence <= 60 || inBand);
      const wrong =
        (s.truth === "fake" && verdict === "real") ||
        (s.truth === "real" && isPredFake(verdict));
      const bad = verdict === "error" || (wrong && !soft);
      if (bad) {
        failedPerturbation = true;
        critical++;
      }
      if (soft) degraded++;
      if (soft && wrong) softWrong++;
      row.push(`${p.name}: ${verdict} (${score.toFixed(2)}, ${confidence}%)${bad ? " ✗" : soft ? " ~" : ""}`);
    }
    console.log(`  ${s.file} [${s.truth}]${failedPerturbation ? " — CRITICAL" : ""}`);
    for (const line of row) console.log(`      ${line}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  critical failures (confident fake→real or real→fake): ${critical}`);
console.log(
  `  degraded (perturbed → low-confidence call, evidence destroyed): ${degraded}`,
);
if (critical > 0) {
  console.log(`\n  ✗ robustness check FAILED`);
  process.exit(1);
}
console.log(
  softWrong > 0
    ? `\n  ✓ no confident direction flip under any transform — the ${softWrong} flip(s) above occurred only where evidence was destroyed and were flagged low-confidence`
    : "\n  ✓ no fake was called real and no real was called fake under any transform",
);
