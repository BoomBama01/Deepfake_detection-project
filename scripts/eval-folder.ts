/**
 * Folder evaluation (audit item: "runs a folder of known real/fake images
 * and prints accuracy, precision, recall, and a confusion matrix").
 *
 *   bunx tsx scripts/eval-folder.ts <root> [--faces manifest.json] [--sensitivity low|balanced|high]
 *
 * <root>
 *   ├── real/   *.jpg *.jpeg *.png   (ground-truth authentic)
 *   └── fake/   *.jpg *.jpeg *.png   (ground-truth AI-generated / manipulated)
 *
 * --faces     optional JSON map of "<path relative to root>" (or bare file
 *             name) to a normalized face box {x,y,w,h}. The Node harness has
 *             no BlazeFace detector; boxes are needed only when you want the
 *             face-level checks in the measurement (the browser does this
 *             automatically).
 * --sensitivity  low | balanced | high (default balanced)
 *
 * The engine is binary: every analysed file comes back "real" or an
 * AI-side verdict (likely_ai / likely_deepfake) — there is no third
 * verdict. The abstain column therefore only catches files that failed to
 * analyse; they count against strict accuracy, while precision/recall are
 * computed over called results with abstained fakes counted as missed
 * detections. Calls made with confidence ≤ 60% (the uncertain band) are
 * reported separately so binary output never hides weak evidence.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { analyzeFile, formatCheck } from "./lib/pipeline";
import { DEFAULT_SETTINGS, type FaceBox, type Sensitivity, type Verdict } from "../src/lib/engine/types";

type Label = "real" | "fake";
type Pred = "real" | "fake" | "abstain";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function listImages(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jpe?g|png)$/i.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function loadFaces(path: string | undefined): Record<string, FaceBox> {
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, FaceBox>;
  } catch (err) {
    console.error(`Could not read face manifest ${path}: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
}

function predOf(v: Verdict): Pred {
  if (v === "likely_ai" || v === "likely_deepfake") return "fake";
  if (v === "real") return "real";
  return "abstain";
}

const pct = (n: number, d: number) => (d > 0 ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

const root = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
if (!root) {
  console.error("Usage: bunx tsx scripts/eval-folder.ts <root> [--faces manifest.json] [--sensitivity low|balanced|high]");
  process.exit(2);
}
const faces = loadFaces(argValue("--faces"));
const sensitivity = (argValue("--sensitivity") as Sensitivity | undefined) ?? "balanced";
const settings = { ...DEFAULT_SETTINGS, sensitivity };

interface Row {
  file: string;
  label: Label;
  verdict: Verdict;
  pred: Pred;
  score: number;
  confidence: number;
  error?: string;
}

const rows: Row[] = [];
let skipped = 0;

for (const label of ["real", "fake"] as const) {
  const dir = join(root, label);
  const files = listImages(dir);
  if (files.length === 0) console.warn(`! no ${label} images under ${dir}`);
  for (const file of files) {
    const rel = relative(root, file);
    const faceBox = faces[rel] ?? faces[file] ?? faces[rel.split(/[\\/]/).pop() ?? ""];
    try {
      const r = analyzeFile(file, { faceBox, settings });
      rows.push({
        file: rel,
        label,
        verdict: r.decision.verdict,
        pred: predOf(r.decision.verdict),
        score: r.decision.score,
        confidence: r.decision.confidence,
      });
    } catch (err) {
      skipped++;
      rows.push({
        file: rel,
        label,
        verdict: "error",
        pred: "abstain",
        score: 0.5,
        confidence: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/* ---- per-file report ------------------------------------------------- */
console.log(`\nTruthLens evaluation — ${rows.length} images (sensitivity: ${sensitivity})\n`);
for (const r of rows) {
  const mark = r.pred === r.label ? "✓" : r.pred === "abstain" ? "~" : "✗";
  console.log(
    `  ${mark} ${r.file.padEnd(46)} ${r.label} → ${r.verdict.padEnd(16)} score=${r.score.toFixed(3)} conf=${r.confidence}%` +
      (r.error ? `  [error: ${r.error}]` : ""),
  );
}

/* ---- totals ----------------------------------------------------------- */
const actualFake = rows.filter((r) => r.label === "fake");
const actualReal = rows.filter((r) => r.label === "real");
const tp = rows.filter((r) => r.label === "fake" && r.pred === "fake").length;
const fp = rows.filter((r) => r.label === "real" && r.pred === "fake").length;
const tn = rows.filter((r) => r.label === "real" && r.pred === "real").length;
const fn = rows.filter((r) => r.label === "fake" && r.pred === "real").length;
const abstainReal = actualReal.filter((r) => r.pred === "abstain").length;
const abstainFake = actualFake.filter((r) => r.pred === "abstain").length;
const total = rows.length;
const decided = tp + fp + tn + fn;

const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
const recall = actualFake.length > 0 ? tp / actualFake.length : 0;
const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
const strictAcc = (tp + tn) / (total || 1);

console.log(`\nConfusion matrix (fake = positive; abstain = analysis error):`);
console.log(`                    predicted real   predicted fake   abstain`);
console.log(`  actual real        ${String(tn).padStart(8)}         ${String(fp).padStart(8)}          ${String(abstainReal).padStart(8)}`);
console.log(`  actual fake        ${String(fn).padStart(8)}         ${String(tp).padStart(8)}          ${String(abstainFake).padStart(8)}`);
console.log(``);
console.log(`  Accuracy (strict, abstentions wrong) : ${pct(tp + tn, total)}`);
console.log(`  Coverage (decided / total)           : ${pct(decided, total)}`);
console.log(`  Precision (of called fake)           : ${pct(tp, tp + fp)}`);
console.log(`  Recall (of all real fakes)           : ${pct(tp, actualFake.length)}  [abstained fakes count as missed]`);
console.log(`  F1                                    : ${f1.toFixed(3)}`);
const lowConfCalls = rows.filter((r) => r.pred !== "abstain" && r.confidence <= 60).length;
console.log(
  `  Low-confidence calls (≤ 60%)         : ${lowConfCalls} / ${decided} decided  [binary verdict, weak evidence]`,
);
if (skipped) console.log(`  Skipped/failed files                 : ${skipped}`);
if (total < 30) {
  console.log(`\n  ⚠ n=${total} is far too small for a meaningful estimate — this run is a`);
  console.log(`    smoke test, not a benchmark. Use a held-out validation set (hundreds+`);
console.log(`    of images, untouched by any tuning) for real numbers.`);
}

/* ---- optional detailed dump ------------------------------------------ */
if (process.argv.includes("--verbose")) {
  console.log("");
  for (const r of rows) {
    if (r.error) continue;
    console.log(`--- ${r.file}`);
    const res = analyzeFile(join(root, r.file), {
      faceBox: faces[r.file],
      settings,
    });
    for (const c of res.checks) console.log(formatCheck(c));
  }
}
