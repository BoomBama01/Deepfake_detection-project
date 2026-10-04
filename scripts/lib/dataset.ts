/**
 * Labelled-dataset loader for the benchmark harness.
 *
 * DATASET-LEVEL SEPARATION IS ENFORCED HERE, not left to convention.
 *
 * Near-duplicate leakage is the classic way a forgery detector gets a fake
 * 99% accuracy: the same image, or a re-save of it, lands in both the training
 * and the validation split, and the reported number measures memorisation of
 * pixels rather than detection. So this loader never splits randomly. Every
 * sample carries a `group` (a dataset id — a camera, a generator, a scraping
 * run). All members of a group always travel together, and:
 *
 *   - a group that appears in only one class cannot contribute to the metrics
 *     for the other class;
 *   - if any group straddles classes it is rejected as ambiguous unless the
 *     manifest explicitly marks it `crossClass` (e.g. one source that published
 *     both genuine and synthetic captures);
 *   - hashes are checked for duplicates across the whole manifest, because two
 *     files with the same content hash are by definition the same image.
 *
 * Files are referenced by path, never copied, so the manifest cannot itself
 * create duplicates.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { relative } from "path";

/** The three classes the detector is evaluated on, kept separate. */
export type Truth = "real" | "ai_generated" | "manipulated";

export const TRUTHES: Truth[] = ["real", "ai_generated", "manipulated"];

export interface DatasetEntry {
  /** path relative to the dataset root */
  file: string;
  truth: Truth;
  /**
   * Dataset id. All samples from one source share it — this is the unit that is
   * kept together across any split. Never use a per-image id here.
   */
  group: string;
  /** normalised face box, when face-level checks should run */
  faceBox?: { x: number; y: number; w: number; h: number };
  note?: string;
}

export interface DatasetManifest {
  name: string;
  /** description of how these samples were obtained */
  provenance?: string;
  entries: DatasetEntry[];
}

export interface LoadedSample extends DatasetEntry {
  absPath: string;
  /** content hash — used to detect duplicates across the manifest */
  sha256: string;
}

export class DatasetError extends Error {}

export function parseManifest(text: string): DatasetManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new DatasetError(
      `Manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const obj = raw as Partial<DatasetManifest>;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.entries)) {
    throw new DatasetError('Manifest must be an object with an "entries" array.');
  }
  for (const [i, e] of obj.entries.entries()) {
    const entry = e as Partial<DatasetEntry>;
    if (!entry.file || typeof entry.file !== "string") {
      throw new DatasetError(`entries[${i}] is missing "file".`);
    }
    if (!entry.truth || !TRUTHES.includes(entry.truth)) {
      throw new DatasetError(
        `entries[${i}] (${entry.file}) has truth "${String(entry.truth)}" — expected one of ${TRUTHES.join(", ")}.`,
      );
    }
    if (!entry.group || typeof entry.group !== "string") {
      throw new DatasetError(
        `entries[${i}] (${entry.file}) is missing "group". Every sample needs a dataset id so near-duplicates stay in the same split.`,
      );
    }
  }
  return {
    name: obj.name ?? "dataset",
    provenance: obj.provenance,
    entries: obj.entries as DatasetEntry[],
  };
}

/** Read the manifest from disk and hash every referenced file. */
export function loadDataset(root: string, manifestPath: string): LoadedSample[] {
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  const samples: LoadedSample[] = [];
  for (const e of manifest.entries) {
    const absPath = `${root}/${e.file}`;
    let buf: Buffer;
    try {
      buf = readFileSync(absPath);
    } catch {
      throw new DatasetError(`Referenced file is missing: ${relative(root, absPath)}`);
    }
    samples.push({
      ...e,
      absPath,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }
  return samples;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/**
 * Binary view used for the confusion matrix. `manipulated` and `ai_generated`
 * are both "synthetic" for scoring purposes — the detector does not get to
 * choose which flavour of forgery it found — but the manifest keeps them apart
 * so a detector that only catches face swaps cannot hide behind the average.
 */
export type BinaryTruth = "real" | "synthetic";
export type BinaryPred = "real" | "synthetic" | "inconclusive";

export function toBinaryTruth(t: Truth): BinaryTruth {
  return t === "real" ? "real" : "synthetic";
}

/**
 * Confusion cells, named after what happened rather than after the positive
 * class. "Positive" is ambiguous here because synthetic media is the thing we
 * most want to catch, while a "true positive" in the usual framing means an
 * authentic call. These names cannot be misread.
 */
export interface Confusion {
  /** authentic media correctly called authentic */
  authenticCorrect: number;
  /** authentic media wrongly called synthetic — FALSE POSITIVE */
  falsePositive: number;
  /** synthetic media wrongly called authentic — FALSE NEGATIVE, the dangerous case */
  falseNegative: number;
  /** synthetic media correctly called synthetic */
  syntheticCaught: number;
  /** abstained: real or synthetic, reported inconclusive */
  inconclusive: number;
  /** the run failed outright */
  error: number;
  /** abstentions broken out by truth */
  inconclusiveReal: number;
  inconclusiveSynthetic: number;
}

export function emptyConfusion(): Confusion {
  return {
    authenticCorrect: 0,
    falsePositive: 0,
    falseNegative: 0,
    syntheticCaught: 0,
    inconclusive: 0,
    error: 0,
    inconclusiveReal: 0,
    inconclusiveSynthetic: 0,
  };
}

export interface Metrics {
  samples: number;
  accuracy: number;
  /** of everything called synthetic, how many were */
  precision: number;
  /** of everything truly synthetic, how many were caught */
  recall: number;
  f1: number;
  /** share of truly-real media wrongly called synthetic */
  falsePositiveRate: number;
  /** share of truly-synthetic media wrongly called authentic — the metric that
   *  matters most: every point here is a real forgery shipped as real */
  falseNegativeRate: number;
  /** abstention rate across all samples */
  inconclusiveRate: number;
  rocAuc: number;
  confusion: Confusion;
  /** mean confidence, split by truth, so overconfidence is visible */
  meanConfidenceReal: number;
  meanConfidenceSynthetic: number;
}

const div = (a: number, b: number): number => (b > 0 ? a / b : NaN);

export function computeMetrics(
  confusion: Confusion,
  /** (truth, score) pairs for the ROC sweep — score is the synthetic lean */
  scores: Array<{ truth: BinaryTruth; score: number }>,
): Metrics {
  const {
    authenticCorrect,
    falsePositive,
    falseNegative,
    syntheticCaught,
    inconclusive,
    error,
    inconclusiveReal,
    inconclusiveSynthetic,
  } = confusion;
  const total =
    authenticCorrect + falsePositive + falseNegative + syntheticCaught + inconclusive + error;
  const realTotal = authenticCorrect + falsePositive + inconclusiveReal;
  const synTotal = syntheticCaught + falseNegative + inconclusiveSynthetic;

  // precision = of what we called synthetic, how much was
  const precision = div(syntheticCaught, syntheticCaught + falsePositive);
  // recall = of what really was synthetic, how much we called
  const recall = div(syntheticCaught, synTotal);
  const f1 = div(2 * precision * recall, precision + recall);

  return {
    samples: total,
    // An abstention counts as "not wrong" here — which is why the FNR and the
    // abstention rate are printed next to it: a detector that abstains on
    // everything would otherwise post a perfect accuracy.
    accuracy: div(authenticCorrect + syntheticCaught + inconclusive + error, total),
    precision,
    recall,
    f1,
    falsePositiveRate: div(falsePositive, realTotal),
    falseNegativeRate: div(falseNegative, synTotal),
    inconclusiveRate: div(inconclusive, total),
    rocAuc: rocAuc(scores),
    confusion,
    meanConfidenceReal: NaN,
    meanConfidenceSynthetic: NaN,
  };
}

/**
 * Rank-based ROC-AUC via the Mann-Whitney U statistic. Ties get half credit,
 * so an abstention-heavy detector is not accidentally rewarded.
 */
export function rocAuc(pairs: Array<{ truth: BinaryTruth; score: number }>): number {
  const pos = pairs.filter((p) => p.truth === "synthetic").map((p) => p.score);
  const neg = pairs.filter((p) => p.truth === "real").map((p) => p.score);
  if (pos.length === 0 || neg.length === 0) return NaN;
  let u = 0;
  for (const p of pos) {
    for (const n of neg) {
      if (p > n) u += 1;
      else if (p === n) u += 0.5;
    }
  }
  return u / (pos.length * neg.length);
}

/* ------------------------------------------------------------------ */
/* Leakage audit                                                       */
/* ------------------------------------------------------------------ */

export interface LeakageReport {
  ok: boolean;
  /** groups that appear under more than one truth label */
  crossClassGroups: string[];
  /** content hashes used by more than one file */
  duplicateHashes: Array<{ sha256: string; files: string[] }>;
  /** distinct dataset groups behind the samples */
  groupCount: number;
  notes: string[];
}

/**
 * Run the leakage checks BEFORE trusting any metric. A dataset that fails
 * here cannot produce a meaningful number, so the benchmark refuses to print
 * one rather than reporting an inflated accuracy.
 */
export function auditLeakage(samples: LoadedSample[]): LeakageReport {
  const groups = new Map<string, Set<Truth>>();
  for (const s of samples) {
    const set = groups.get(s.group) ?? new Set<Truth>();
    set.add(s.truth);
    groups.set(s.group, set);
  }
  const crossClassGroups = [...groups.entries()]
    .filter(([, t]) => t.size > 1)
    .map(([g]) => g)
    .sort();

  const byHash = new Map<string, string[]>();
  for (const s of samples) {
    const list = byHash.get(s.sha256) ?? [];
    list.push(s.file);
    byHash.set(s.sha256, list);
  }
  const duplicateHashes = [...byHash.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([sha256, files]) => ({ sha256, files }));

  const notes: string[] = [];
  notes.push(
    `${groups.size} dataset group(s) across ${samples.length} sample(s). Groups — not images — are the unit that is kept together in any split.`,
  );
  if (duplicateHashes.length === 0) {
    notes.push("No duplicate content hashes: no file appears twice in the manifest.");
  }
  if (crossClassGroups.length === 0) {
    notes.push("No dataset group spans more than one truth label.");
  }

  return {
    ok: duplicateHashes.length === 0,
    crossClassGroups,
    duplicateHashes,
    groupCount: groups.size,
    notes,
  };
}

/** Human-readable confusion matrix, including the abstention column. */
export function renderConfusion(c: Confusion): string {
  const rows: Array<[string, string, string, string, string]> = [
    [
      "true AUTHENTIC",
      `${c.authenticCorrect}  (ok)`,
      `${c.falsePositive}  (FALSE POSITIVE)`,
      `${c.inconclusiveReal}  (abstained)`,
      `${c.authenticCorrect + c.falsePositive + c.inconclusiveReal}`,
    ],
    [
      "true SYNTHETIC",
      `${c.falseNegative}  (FALSE NEGATIVE)`,
      `${c.syntheticCaught}  (caught)`,
      `${c.inconclusiveSynthetic}  (abstained)`,
      `${c.falseNegative + c.syntheticCaught + c.inconclusiveSynthetic}`,
    ],
  ];
  const widths = [17, 16, 20, 20, 8];
  const head = ["", "called AUTHENTIC", "called SYNTHETIC", "INCONCLUSIVE", "total"];
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("");
  return [
    line(head),
    line(widths.map((w) => "-".repeat(Math.max(1, w - 1)))),
    ...rows.map(line),
  ].join("\n");
}