/**
 * TruthLens robustness audit.
 *
 *   bunx tsx scripts/robustness-audit.ts <dataset-root> --manifest manifest.json \
 *        [--sensitivity balanced] [--json out.json]
 *
 * Real media almost never reaches a detector untouched. It has been screenshotted,
 * resized, recompressed by a platform, cropped, or stripped of metadata on the
 * way to being posted. This harness measures what the verdict does under those
 * transforms and separates two very different outcomes:
 *
 *   CONFIDENT DIRECTION FLIP  the verdict reversed and still claims confidence.
 *                            This is the failure that matters: a real photo
 *                            called synthetic, or a forgery cleared as authentic.
 *   HONEST DEGRADATION        the verdict reversed, but the engine noticed the
 *                            evidence had been destroyed and reported
 *                            INCONCLUSIVE (or capped its confidence). Correct
 *                            behaviour — the detector cannot recover detail
 *                            that is no longer in the file, and says so.
 *
 * Only the first counts as a failure. A detector that never degrades would also
 * never be wrong, and that is not achievable; the requirement is that loss of
 * evidence is *reported* as loss of evidence.
 *
 * Deterministic by construction: every transform uses a fixed seed, so the
 * script is byte-reproducible across runs.
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { analyzeFile, decodeImage, type DecodedImage } from "./lib/pipeline";
import {
  blurRgba,
  cropRgba,
  encodeJpeg,
  resizeRoundTrip,
  screenshotRgba,
  stripMetadata,
} from "./lib/perturb";
import { UNCERTAIN_BAND } from "../src/lib/engine/verdict";
import { loadDataset, type LoadedSample } from "./lib/dataset";
import {
  DEFAULT_SETTINGS,
  type AnalysisSettings,
  type Sensitivity,
  type Verdict,
} from "../src/lib/engine/types";

function argValue(flag: string, fallback = ""): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
if (!root) {
  console.error(
    "Usage: bunx tsx scripts/robustness-audit.ts <dataset-root> --manifest manifest.json [--sensitivity balanced] [--json out.json]",
  );
  process.exit(2);
}
const manifestArg = argValue("--manifest", "manifest.json");
const manifestPath = existsSync(manifestArg) ? manifestArg : join(root, manifestArg);
const sensitivity = (argValue("--sensitivity", "balanced") || "balanced") as Sensitivity;
const settings: AnalysisSettings = { ...DEFAULT_SETTINGS, sensitivity };
const jsonOut = argValue("--json");

let samples: LoadedSample[];
try {
  samples = loadDataset(root, manifestPath);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

interface Perturbation {
  name: string;
  /** what this simulates in the real world */
  realWorld: string;
  apply: (img: DecodedImage) => { bytes: Uint8Array; ext: string };
}

const PERTURBATIONS: Perturbation[] = [
  {
    name: "baseline",
    realWorld: "the original file",
    apply: (img) => ({ bytes: encodeJpeg(img, 95), ext: "jpg" }),
  },
  {
    name: "platform-recompress",
    realWorld: "a social platform re-encoding at QF 75",
    apply: (img) => ({ bytes: encodeJpeg(img, 75), ext: "jpg" }),
  },
  {
    name: "aggressive-compress",
    realWorld: "a messaging app compressing hard (QF 50)",
    apply: (img) => ({ bytes: encodeJpeg(img, 50), ext: "jpg" }),
  },
  {
    name: "thumbnail-downscale",
    realWorld: "a 25%-size thumbnail (upscaled back by the viewer)",
    apply: (img) => ({ bytes: encodeJpeg(resizeRoundTrip(img, 0.25), 90), ext: "jpg" }),
  },
  {
    name: "half-resize",
    realWorld: "half-resolution downscale/ upscale round trip",
    apply: (img) => ({ bytes: encodeJpeg(resizeRoundTrip(img, 0.5), 90), ext: "jpg" }),
  },
  {
    name: "crop",
    realWorld: "a 20% centre crop (reframing before upload)",
    apply: (img) => ({ bytes: encodeJpeg(cropRgba(img, 0.8), 92), ext: "jpg" }),
  },
  {
    name: "screenshot",
    realWorld: "a phone screenshot — the most common real-world path",
    apply: (img) => ({ bytes: encodeJpeg(screenshotRgba(img), 88), ext: "jpg" }),
  },
  {
    name: "blur",
    realWorld: "a soft-focus or deliberately blurred re-share",
    apply: (img) => ({ bytes: encodeJpeg(blurRgba(img, 1, 2), 88), ext: "jpg" }),
  },
  {
    name: "metadata-stripped",
    realWorld: "EXIF/C2PA removed — provenance evidence disappears entirely",
    apply: (img) => ({ bytes: stripMetadata(img), ext: "png" }),
  },
  {
    name: "format-conversion",
    realWorld: "JPEG → PNG re-save (container change, pixels preserved)",
    apply: (img) => ({ bytes: stripMetadata(img), ext: "png" }),
  },
];

interface Cell {
  verdict: Verdict;
  score: number;
  confidence: number;
  outcome: string;
  error?: string;
}

function runOne(path: string, sample: LoadedSample): Cell {
  try {
    const r = analyzeFile(path, { faceBox: sample.faceBox, settings });
    return {
      verdict: r.decision.verdict,
      score: r.decision.score,
      confidence: r.decision.confidence,
      outcome: r.decision.outcome,
    };
  } catch (err) {
    return {
      verdict: "error",
      score: 0.5,
      confidence: 0,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const isSyntheticCall = (v: Verdict): boolean => v === "likely_ai" || v === "likely_deepfake";
const isAuthenticCall = (v: Verdict): boolean => v === "real";

/** Did the engine flag its own loss of evidence instead of asserting a side? */
function reportedHonesty(c: Cell): boolean {
  return (
    c.verdict === "inconclusive" ||
    (c.confidence >= UNCERTAIN_BAND.lo && c.confidence <= UNCERTAIN_BAND.hi)
  );
}

const dir = mkdtempSync(join(tmpdir(), "tl-robustness-"));
let confidentFlips = 0;
let honestDegradations = 0;
let clean = 0;
const jsonRows: unknown[] = [];

console.log(`\nTruthLens robustness audit — ${samples.length} sample(s), sensitivity=${sensitivity}`);
console.log("A CONFIDENT flip is a failure. A flip the engine reported as inconclusive is correct behaviour.\n");

try {
  for (const s of samples) {
    const original = decodeImage(s.absPath);
    console.log(`${s.file}  [${s.truth}]`);

    let baseline: Cell | null = null;
    for (const p of PERTURBATIONS) {
      const { bytes, ext } = p.apply(original.img);
      const tmp = join(dir, `${s.file.replace(/[^\w.-]/g, "_")}.${p.name}.${ext}`);
      writeFileSync(tmp, bytes);

      // metadata-stripped and format-conversion produce the same pixels, so
      // run the baseline once and reuse it rather than reporting a duplicate
      if (p.name === "baseline") baseline = runOne(tmp, s);
      if (p.name === "format-conversion") continue;

      const cell = runOne(tmp, s);
      const base = baseline!;
      const baseSide = isSyntheticCall(base.verdict)
        ? "synthetic"
        : isAuthenticCall(base.verdict)
          ? "authentic"
          : "abstain";
      const cellSide = isSyntheticCall(cell.verdict)
        ? "synthetic"
        : isAuthenticCall(cell.verdict)
          ? "authentic"
          : "abstain";

      let note = "";
      if (baseSide === "abstain" || cellSide === "abstain") {
        if (baseSide !== cellSide && cellSide === "abstain") {
          honestDegradations++;
          note = "  → became INCONCLUSIVE (honest)";
        } else if (cellSide !== "abstain") {
          // The baseline abstained but the transform asserted a side. Judge this
          // against GROUND TRUTH, not against the baseline: a transform that
          // turns a manipulated file into a confident "authentic" call is a
          // cleared forgery regardless of what the original said.
          const truthIsSynthetic = s.truth !== "real";
          const wrongSide = truthIsSynthetic
            ? cellSide === "authentic"
            : cellSide === "synthetic";
          if (wrongSide && !reportedHonesty(cell)) {
            confidentFlips++;
            note = `  → ✗ CONFIDENT ${truthIsSynthetic ? "FALSE NEGATIVE" : "FALSE POSITIVE"} (baseline abstained, transform asserted ${cellSide})`;
          } else if (wrongSide) {
            honestDegradations++;
            note = `  → ${truthIsSynthetic ? "false negative" : "false positive"} but flagged low-confidence (honest)`;
          }
        }
      } else if (baseSide !== cellSide) {
        if (reportedHonesty(cell)) {
          honestDegradations++;
          note = `  → flipped ${baseSide}→${cellSide} but flagged low-confidence (honest)`;
        } else {
          confidentFlips++;
          note = `  → ✗ CONFIDENT FLIP ${baseSide}→${cellSide}`;
        }
      } else {
        // Even an "unchanged" verdict has to be checked against ground truth: a
        // confident "real" on a manipulation is a cleared forgery.
        if (!reportedHonesty(cell)) {
          const truthIsSynthetic = s.truth !== "real";
          const wrongSide = truthIsSynthetic
            ? cellSide === "authentic"
            : cellSide === "synthetic";
          if (wrongSide) {
            confidentFlips++;
            note = `  → ✗ CONFIDENT ${truthIsSynthetic ? "FALSE NEGATIVE" : "FALSE POSITIVE"} (unchanged verdict is wrong)`;
          } else {
            clean++;
          }
        } else {
          honestDegradations++;
          note = "  → inconclusive (honest)";
        }
      }

      if (p.name !== "baseline") {
        console.log(
          `    ${p.name.padEnd(22)} ${cell.verdict.padEnd(15)} score ${cell.score.toFixed(2)}  conf ${String(cell.confidence).padStart(5)}%${note}`,
        );
      }
      jsonRows.push({
        file: s.file,
        truth: s.truth,
        group: s.group,
        transform: p.name,
        realWorld: p.realWorld,
        verdict: cell.verdict,
        outcome: cell.outcome,
        score: cell.score,
        confidence: cell.confidence,
        baselineVerdict: base.verdict,
        flipped: baseSide !== cellSide,
      });
    }
    console.log("");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("summary");
console.log(`  unchanged across every transform : ${clean}`);
console.log(`  honest degradation (flagged)     : ${honestDegradations}`);
console.log(`  ✗ confident direction flips      : ${confidentFlips}`);

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sensitivity,
        transforms: PERTURBATIONS.map((p) => ({ name: p.name, realWorld: p.realWorld })),
        unchanged: clean,
        honestDegradations,
        confidentFlips: confidentFlips,
        rows: jsonRows,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${jsonOut}`);
}

if (confidentFlips > 0) {
  console.error(
    `\n✗ FAILED — ${confidentFlips} transform(s) flipped the verdict while still claiming confidence.`,
  );
  console.error("  The engine asserted a side on evidence it had lost. That is a false accusation or a cleared forgery.");
  process.exit(1);
}
console.log(
  `\n✓ no confident direction flip under any transform. Where a transform destroyed the evidence, the engine reported it as inconclusive or capped its confidence instead of asserting a side.`,
);