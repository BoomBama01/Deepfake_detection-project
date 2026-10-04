/**
 * TruthLens benchmark harness.
 *
 *   bunx tsx scripts/benchmark.ts <dataset-root> --manifest manifest.json \
 *        [--sensitivity balanced] [--json out.json]
 *
 * Dataset layout is a manifest (see scripts/lib/dataset.ts) with three classes
 * kept apart:
 *
 *   real/          camera or otherwise authentic captures
 *   ai_generated/  wholly synthesised frames (diffusion / GAN output)
 *   manipulated/   authentic sources that were edited (face swap, splice,
 *                  retouch) — the class most detectors quietly miss
 *
 * Reported, per class and pooled:
 *   accuracy · precision · recall · F1 · ROC-AUC · FPR · FNR · confusion matrix
 *
 * Two rules the harness enforces rather than advises:
 *   1. DATASET-LEVEL SEPARATION. Samples are grouped by dataset id and the
 *      harness refuses to print a pooled metric if a group spans two truth
 *      labels or a file is duplicated by content hash. Near-duplicate leakage
 *      inflates accuracy and this is the number most likely to be quoted.
 *   2. FALSE NEGATIVES ARE CALLED OUT. AI media classified as authentic is the
 *      failure that ships a forgery to the public, so it is printed separately
 *      and the script exits non-zero when the FNR exceeds the tolerance.
 *
 * The script never trains on the samples: TruthLens ships no trained weights,
 * so this measures the calibrated feature blend, not a fitted model.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { analyzeFile } from "./lib/pipeline";
import { CALIBRATION } from "../src/lib/engine/verdict";
import {
  auditLeakage,
  computeMetrics,
  emptyConfusion,
  loadDataset,
  renderConfusion,
  toBinaryTruth,
  TRUTHES,
  type BinaryTruth,
  type Confusion,
  type LoadedSample,
  type Metrics,
} from "./lib/dataset";
import {
  DEFAULT_SETTINGS,
  type AnalysisSettings,
  type Sensitivity,
  type Verdict,
} from "../src/lib/engine/types";

/** Share of synthetic media that may be missed before the run is a failure. */
const FNR_TOLERANCE = Number(process.env.TL_FNR_TOLERANCE ?? 0.1);

function argValue(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : (fallback ?? "");
}

const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
if (!root) {
  console.error(
    "Usage: bunx tsx scripts/benchmark.ts <dataset-root> --manifest manifest.json [--sensitivity balanced|low|high] [--json out.json]",
  );
  process.exit(2);
}
// the manifest may be given relative to the dataset root or to the cwd
const manifestArg = argValue("--manifest", "manifest.json");
const manifestPath = existsSync(manifestArg)
  ? manifestArg
  : join(root, manifestArg);
const sensitivity = (argValue("--sensitivity", "balanced") as Sensitivity) ?? "balanced";
const settings: AnalysisSettings = { ...DEFAULT_SETTINGS, sensitivity };

console.log(`\nTruthLens benchmark — dataset: ${root}`);
console.log(`sensitivity=${sensitivity}  manifest=${manifestPath}\n`);

let samples: LoadedSample[];
try {
  samples = loadDataset(root, manifestPath);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

/* ---------- leakage gate: refuse to report inflated numbers ---------- */
const leakage = auditLeakage(samples);
console.log("dataset separation");
for (const n of leakage.notes) console.log(`  · ${n}`);
if (leakage.duplicateHashes.length > 0) {
  console.error(
    `\n✗ duplicate content hashes detected — this dataset leaks and its metrics would be meaningless:`,
  );
  for (const d of leakage.duplicateHashes) {
    console.error(`    ${d.sha256.slice(0, 16)}… → ${d.files.join(", ")}`);
  }
  process.exit(1);
}
if (leakage.crossClassGroups.length > 0) {
  console.error(
    `\n✗ dataset group(s) span more than one truth label: ${leakage.crossClassGroups.join(", ")}`,
  );
  console.error("  Split these into separate dataset ids, or the pooled metrics mix classes.");
  process.exit(1);
}
console.log("");

/* ---------- run the engine over every sample ---------- */
interface Row {
  sample: LoadedSample;
  verdict: Verdict;
  score: number;
  confidence: number;
  uncertainty: number;
  evidenceStrength: number;
  error?: string;
}

const rows: Row[] = [];
let failed = 0;
for (const [i, s] of samples.entries()) {
  process.stdout.write(`  analysing ${String(i + 1).padStart(3)}/${samples.length}  ${s.file}\r`);
  try {
    const r = analyzeFile(s.absPath, { faceBox: s.faceBox, settings });
    rows.push({
      sample: s,
      verdict: r.decision.verdict,
      score: r.decision.score,
      confidence: r.decision.confidence,
      uncertainty: r.decision.uncertainty,
      evidenceStrength: r.decision.evidenceStrength,
    });
  } catch (err) {
    failed++;
    rows.push({
      sample: s,
      verdict: "error",
      score: 0.5,
      confidence: 0,
      uncertainty: 100,
      evidenceStrength: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
process.stdout.write(" ".repeat(70) + "\r");

/* ---------- scoring helpers ---------- */
function predicted(row: Row): "authentic" | "synthetic" | "abstain" {
  if (row.verdict === "error") return "abstain";
  if (row.verdict === "inconclusive") return "abstain";
  return row.verdict === "real" ? "authentic" : "synthetic";
}

function scoreFor(subset: Row[]): Metrics {
  const confusion: Confusion = emptyConfusion();
  const pairs: Array<{ truth: BinaryTruth; score: number }> = [];
  for (const row of subset) {
    const binTruth = toBinaryTruth(row.sample.truth);
    const pred = predicted(row);
    pairs.push({ truth: binTruth, score: row.score });
    if (row.verdict === "error") {
      confusion.error++;
      continue;
    }
    if (pred === "abstain") {
      confusion.inconclusive++;
      if (binTruth === "real") confusion.inconclusiveReal++;
      else confusion.inconclusiveSynthetic++;
      continue;
    }
    if (binTruth === "real") {
      if (pred === "authentic") confusion.authenticCorrect++;
      else confusion.falsePositive++;
    } else {
      if (pred === "authentic") confusion.falseNegative++;
      else confusion.syntheticCaught++;
    }
  }
  return computeMetrics(confusion, pairs);
}

const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const num = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : "n/a");

/**
 * Print a metric block.
 *
 * `twoClass` is false for a per-class block: accuracy, precision, FPR and
 * ROC-AUC are undefined when only one truth label is present, and printing them
 * anyway would be the kind of meaningless number this harness exists to avoid.
 */
function printBlock(title: string, m: Metrics, twoClass: boolean): void {
  console.log(`\n${title}`);
  console.log(`  samples ${m.samples}   abstained ${pct(m.inconclusiveRate)}`);
  if (twoClass) {
    console.log(
      `  accuracy ${pct(m.accuracy)}   precision ${pct(m.precision)}   recall ${pct(m.recall)}   F1 ${pct(m.f1)}`,
    );
    console.log(
      `  ROC-AUC ${num(m.rocAuc)}   FPR ${pct(m.falsePositiveRate)}   FNR ${pct(m.falseNegativeRate)}`,
    );
    console.log(renderConfusion(m.confusion).replace(/^/gm, "  "));
  } else {
    console.log("  (precision / FPR / ROC-AUC need both classes present — see the pooled block below)");
  }
}

/* ---------- per-class ---------- */
const perClass: Record<string, Metrics> = {};
for (const truth of TRUTHES) {
  const subset = rows.filter((r) => r.sample.truth === truth);
  if (subset.length === 0) continue;
  perClass[truth] = scoreFor(subset);
  printBlock(`class: ${truth}`, perClass[truth], false);
}

/* ---------- pooled ---------- */
const pooled = scoreFor(rows);
printBlock("pooled (real vs synthetic)", pooled, true);

/* ---------- per-class outcomes, so a detector cannot hide behind the mean ---------- */
console.log("\nper-class outcome breakdown");
for (const truth of TRUTHES) {
  const subset = rows.filter((r) => r.sample.truth === truth);
  if (!subset.length) continue;
  const calledSynthetic = subset.filter((r) => predicted(r) === "synthetic").length;
  const calledAuthentic = subset.filter((r) => predicted(r) === "authentic").length;
  const abstained = subset.filter((r) => predicted(r) === "abstain" && r.verdict !== "error").length;
  const caught = calledSynthetic;
  const missed = calledAuthentic;
  if (truth === "real") {
    // for authentic media the error is being called synthetic, not "caught"
    console.log(
      `  ${truth.padEnd(14)} passed ${String(calledAuthentic).padStart(3)}/${subset.length} (${pct(calledAuthentic / subset.length)})   ` +
        `abstained ${String(abstained).padStart(3)}   FALSE POSITIVE ${String(calledSynthetic).padStart(3)}`,
    );
  } else {
    console.log(
      `  ${truth.padEnd(14)} caught ${String(caught).padStart(3)}/${subset.length} (${pct(caught / subset.length)})   ` +
        `abstained ${String(abstained).padStart(3)}   MISSED ${String(missed).padStart(3)}`,
    );
  }
}

/* ---------- per-group breakdown (dataset-level separation, visible) ---------- */
console.log("\nby dataset group");
const byGroup = new Map<string, Row[]>();
for (const r of rows) {
  const list = byGroup.get(r.sample.group) ?? [];
  list.push(r);
  byGroup.set(r.sample.group, list);
}
for (const [group, list] of [...byGroup.entries()].sort()) {
  const truth = [...new Set(list.map((r) => r.sample.truth))].join("+");
  const synthetic = truth !== "real";
  const calledSynthetic = list.filter((r) => predicted(r) === "synthetic").length;
  const calledAuthentic = list.filter((r) => predicted(r) === "authentic").length;
  const abstained = list.filter((r) => predicted(r) === "abstain" && r.verdict !== "error").length;
  console.log(
    `  ${group.padEnd(28)} ${truth.padEnd(13)} n=${String(list.length).padStart(3)}   ` +
      `authentic ${String(calledAuthentic).padStart(3)}   synthetic ${String(calledSynthetic).padStart(3)}   ` +
      `abstained ${String(abstained).padStart(3)}` +
      (synthetic ? `   MISSED ${String(calledAuthentic).padStart(3)}` : `   FALSE POSITIVE ${String(calledSynthetic).padStart(3)}`),
  );
}

/* ---------- calibration provenance ---------- */
console.log(
  `\ncalibration: ${CALIBRATION.method} · ${CALIBRATION.metric} · separated by ${CALIBRATION.separatedBy} · adopted=${CALIBRATION.adopted}`,
);
console.log(`  ${CALIBRATION.note}`);
if (failed > 0) {
  console.log(`\n  ${failed} sample(s) failed to analyse and are counted as abstentions, not passes.`);
}

/* ---------- machine-readable output ---------- */
const jsonOut = argValue("--json");
if (jsonOut) {
  const payload = {
    generatedAt: new Date().toISOString(),
    datasetRoot: root,
    manifest: manifestPath,
    sensitivity,
    calibration: CALIBRATION,
    leakage: { ok: leakage.ok, groupCount: leakage.groupCount, notes: leakage.notes },
    pooled,
    perClass,
    rows: rows.map((r) => ({
      file: r.sample.file,
      group: r.sample.group,
      truth: r.sample.truth,
      verdict: r.verdict,
      score: r.score,
      confidence: r.confidence,
      uncertainty: r.uncertainty,
      evidenceStrength: r.evidenceStrength,
      error: r.error,
    })),
  };
  writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}

/* ---------- gate on the metric that matters ---------- */
const fnr = pooled.falseNegativeRate;
if (Number.isFinite(fnr) && fnr > FNR_TOLERANCE) {
  console.error(
    `\n✗ FAILED — ${pct(fnr)} of synthetic media was called authentic (tolerance ${pct(FNR_TOLERANCE)}).`,
  );
  console.error("  Every one of those is a forgery the product would have cleared.");
  process.exit(1);
}
console.log(
  `\n✓ synthetic media called authentic: ${pct(fnr)} (tolerance ${pct(FNR_TOLERANCE)}).`,
);
console.log("  Recall this is measured on the bundled sample set only — it is not a published benchmark.");