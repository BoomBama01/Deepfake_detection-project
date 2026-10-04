/**
 * Threshold calibration (audit item: "calibrate the threshold on a validation
 * set using ROC/F1 instead of the default 0.5").
 *
 *   bunx tsx scripts/calibrate.ts <root> [--faces manifest.json] [--sensitivity low|balanced|high]
 *
 * Same folder layout as eval-folder.ts: <root>/real and <root>/fake.
 *
 * Method:
 *  1. For every image compute the RAW combined score — the weighted mean of
 *     the checks after the documented "passing checks lean authentic only
 *     weakly" floor, WITHOUT the flag-escalation floors (those depend on the
 *     thresholds themselves, so they must stay out of the sweep).
 *  2. Rank-based ROC-AUC of the raw score (fake = positive).
 *  3. Grid search over (real, fake) threshold pairs; each pair is scored by
 *     strict accuracy and F1 (abstained fakes count as missed detections).
 *  4. Print the best pairs and the current defaults side by side.
 *
 * The script does NOT rewrite verdict.ts — accept a suggestion only after
 * re-running eval-folder on a held-out set and confirming no regressions.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { analyzeFile } from "./lib/pipeline";
import { combineChecks, evidenceQuality } from "../src/lib/engine/forensics";
import {
  OK_SCORE_FLOOR,
  THRESHOLDS,
  decideCore,
} from "../src/lib/engine/verdict";
import {
  DEFAULT_SETTINGS,
  type FaceBox,
  type Sensitivity,
} from "../src/lib/engine/types";

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

const root = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
if (!root) {
  console.error("Usage: bunx tsx scripts/calibrate.ts <root> [--faces manifest.json] [--sensitivity low|balanced|high]");
  process.exit(2);
}
let faces: Record<string, FaceBox> = {};
const facesArg = argValue("--faces");
if (facesArg) {
  try {
    faces = JSON.parse(readFileSync(facesArg, "utf8"));
  } catch (err) {
    console.error(`Could not read face manifest: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
}
const sensitivity = (argValue("--sensitivity") as Sensitivity | undefined) ?? "balanced";

const settings = { ...DEFAULT_SETTINGS, sensitivity };

interface Sample {
  file: string;
  fake: boolean;
  /** threshold-free ranking statistic (ok-floor only, no escalation) */
  raw: number;
  /** checks exactly as fed to production, for decideCore sweeps */
  checks: ReturnType<typeof analyzeFile>["checks"];
  faceScore: number | null;
  evidence: ReturnType<typeof evidenceQuality>;
}

const samples: Sample[] = [];
let failed = 0;
for (const label of ["real", "fake"] as const) {
  for (const file of listImages(join(root, label))) {
    const rel = relative(root, file);
    const faceBox = faces[rel] ?? faces[rel.split(/[\\/]/).pop() ?? ""];
    try {
      const r = analyzeFile(file, { faceBox, settings });
      /* raw score: ok-floor applied, escalation floors excluded (threshold-free) */
      const floored = r.checks
        .filter((c) => c.weight > 0 && c.status !== "skip")
        .map((c) =>
          c.status === "ok" ? { ...c, score: Math.max(c.score, OK_SCORE_FLOOR) } : c,
        );
      samples.push({
        file: rel,
        fake: label === "fake",
        raw: combineChecks(floored),
        checks: r.checks,
        faceScore: r.faceScore,
        evidence: evidenceQuality(r.sig.sharpness, r.metadata),
      });
    } catch (err) {
      failed++;
      console.error(`! skipped ${rel}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

if (samples.length < 4) {
  console.error("Not enough images to calibrate (need ≥ 4, ideally hundreds).");
  process.exit(2);
}

/* ---- rank-based ROC-AUC ---------------------------------------------- */
function auc(list: Sample[]): number {
  const sorted = [...list].sort((a, b) => a.raw - b.raw);
  const nR = sorted.filter((s) => !s.fake).length;
  const nF = sorted.length - nR;
  if (!nR || !nF) return 0.5;
  // average ranks for ties
  let rank = 1;
  let sumRankF = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].raw === sorted[i].raw) j++;
    const avgRank = (rank + rank + (j - i)) / 2;
    for (let k = i; k <= j; k++) if (sorted[k].fake) sumRankF += avgRank;
    rank += j - i + 1;
    i = j + 1;
  }
  return (sumRankF - (nF * (nF + 1)) / 2) / (nF * nR);
}

/* ---- threshold grid --------------------------------------------------- */
interface Pair {
  real: number;
  fake: number;
  acc: number;
  precision: number;
  recall: number;
  f1: number;
  /** false-positive rate: authentic media called synthetic */
  fpr: number;
  /** false-negative rate: synthetic media called authentic */
  fnr: number;
  /** share of samples the decision core declined to decide */
  abstain: number;
}

function evaluate(real: number, fake: number): Pair {
  let tp = 0,
    fp = 0,
    tn = 0;
  let calledFake = 0;
  let nFake = 0;
  let nReal = 0;
  let abstains = 0;
  for (const s of samples) {
    /* the *production* decision with this candidate threshold pair */
    const d = decideCore(
      { checks: s.checks, faceScore: s.faceScore, kind: "image", evidence: s.evidence },
      { real, fake },
      "candidate",
    );
    const pred: "real" | "fake" | "abstain" =
      d.verdict === "likely_ai" || d.verdict === "likely_deepfake"
        ? "fake"
        : d.verdict === "real"
          ? "real"
          : "abstain";
    if (s.fake) nFake++;
    else nReal++;
    if (pred === "abstain") abstains++;
    if (pred === "fake") {
      calledFake++;
      if (s.fake) tp++;
      else fp++;
    } else if (!s.fake && pred === "real") tn++;
  }
  const precision = calledFake > 0 ? tp / calledFake : 0;
  const recall = nFake > 0 ? tp / nFake : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const acc = (tp + tn) / samples.length;
  /* recall IS the true-positive rate, so its complement is the false-negative
     rate: synthetic media the engine let through as authentic. */
  const fnr = 1 - recall;
  const fpr = nReal > 0 ? fp / nReal : 0;
  const abstain = samples.length > 0 ? abstains / samples.length : 0;
  return { real, fake, acc, precision, recall, f1, fpr, fnr, abstain };
}

const pairs: Pair[] = [];
for (let r = 0.2; r <= 0.5; r += 0.01) {
  for (let f = Math.max(0.36, r + 0.02); f <= 0.85; f += 0.01) {
    pairs.push(evaluate(Number(r.toFixed(2)), Number(f.toFixed(2))));
  }
}
const byF1 = [...pairs].sort(
  (a, b) => b.f1 - a.f1 || a.fnr - b.fnr || a.abstain - b.abstain || b.acc - a.acc,
);
const byAcc = [...pairs].sort((a, b) => b.acc - a.acc || b.f1 - a.f1);

const cur = THRESHOLDS[sensitivity];
const curEval = evaluate(cur.real, cur.fake);

const fmt = (p: Pair) =>
  `real ≤ ${p.real.toFixed(2)}, fake ≥ ${p.fake.toFixed(2)}  →  acc ${(100 * p.acc).toFixed(1)}%  P ${(100 * p.precision).toFixed(1)}%  R ${(100 * p.recall).toFixed(1)}%  F1 ${p.f1.toFixed(3)}  FPR ${(100 * p.fpr).toFixed(1)}%  FNR ${(100 * p.fnr).toFixed(1)}%  abstain ${(100 * p.abstain).toFixed(1)}%`;

console.log(`\nTruthLens threshold calibration (sensitivity: ${sensitivity})`);
console.log(`  images: ${samples.length} (${samples.filter((s) => s.fake).length} fake / ${samples.filter((s) => !s.fake).length} real), failed: ${failed}`);
console.log(`  ROC-AUC of raw combined score: ${auc(samples).toFixed(3)}`);
console.log(`  (pairs are evaluated through the production decision — flag-veto floors included)\n`);
console.log(`  Current defaults : ${fmt(curEval)}`);
console.log(`  Best F1          : ${fmt(byF1[0])}`);
console.log(`  Best accuracy    : ${fmt(byAcc[0])}`);
console.log(`\n  Top pairs by F1:`);
for (const p of byF1.slice(0, 8)) console.log(`    ${fmt(p)}`);

if (samples.length < 30) {
  console.log(`\n  ⚠ n=${samples.length} — with a handful of images any threshold is overfit.`);
  console.log(`    Run this on a held-out validation set of hundreds of images (FaceForensics++,`);
  console.log(`    DFDC, GenImage splits) before changing THRESHOLDS in src/lib/engine/verdict.ts.`);
} else {
  console.log(`\n  To adopt, edit THRESHOLDS in src/lib/engine/verdict.ts, then re-run`);
  console.log(`  scripts/eval-folder.ts on a DIFFERENT held-out set to confirm.`);
}
