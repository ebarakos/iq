/**
 * Calibration core — pure aggregation of agent attempt artifacts.
 *
 * No fs, no env, no side effects. The CLI script (scripts/report.ts) is the
 * shell that loads files, prints output, and optionally writes back to the bank.
 * Pure functions here make this fully unit-testable and reusable if/when a DB
 * arrives (calibrate.ts gains a data source, not a rewrite).
 */

import {
  ATTEMPT_OUTCOMES,
  generatorVersionOf,
  outcomeOf,
  type Attempt,
  type AttemptFile,
  type AttemptOutcome,
  hasModelEvidence,
} from "./attempts";
import type { BankItem } from "@/items/bank";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Items with fewer image attempts than this threshold stay untagged. */
export const MIN_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentTag = "agent-easy" | "agent-mid" | "agent-hard";

/**
 * Per-item rollup for one channel. The "image" rollups are the headline stats
 * (human-comparable, per Q2); "symbolic" rollups are secondary/diagnostic.
 */
export interface ItemRollup {
  itemId: string;
  /** Total attempt count for the channel. */
  attempts: number;
  /** Solve rate across all tested models (pooled); labeled "all tested models" in output. */
  solveRate: number;
  /** Per-model breakdown — models are never silently pooled here. */
  byModel: Record<string, { attempts: number; solveRate: number }>;
  /**
   * Calibration tag. null when attempts < MIN_ATTEMPTS ("insufficient data").
   * agentTag thresholds: ≥0.90 → "agent-easy", ≤0.40 → "agent-hard", else "agent-mid".
   */
  tag: AgentTag | null;
}

/** Generator feature-bucket rollup for one channel. Exact items remain separate diagnostics. */
export interface BucketRollup {
  featureBucket: string;
  attempts: number;
  solveRate: number;
  /** Per-model breakdown — models are never silently pooled here. */
  byModel: Record<string, { attempts: number; solveRate: number }>;
}

/** Difficulty × tag matrix cell */
export interface DifficultyTagMatrix {
  matrix: Record<number, Record<AgentTag | "untagged", number>>;
  /**
   * Top mismatches sorted by severity, both directions:
   *   - "d5 but agents ace it": high difficulty + high solveRate
   *   - "d2 but agents fail it": low difficulty + low solveRate
   * Top 10 total (N=10).
   */
  mismatches: {
    itemId: string;
    difficulty: number;
    solveRate: number;
    attempts: number;
    note: string;
  }[];
}

/** Full calibration report produced by buildReport. */
export interface CalibrationReport {
  /** Distinct promptVersion strings seen across all attempt files. */
  promptVersions: string[];
  /** Distinct run-level generator populations represented in this report. */
  generatorVersions: string[];
  /** Strict accuracy keeps every outcome in its denominator; these counts expose why attempts failed. */
  outcomes: Record<"image" | "symbolic", Record<AttemptOutcome, number>>;
  /** Headline rollups: channel === "image". */
  imageRollups: ItemRollup[];
  /** Secondary/diagnostic rollups: channel === "symbolic". */
  symbolicRollups: ItemRollup[];
  /** Generated-item calibration grouped by stable feature bucket, image channel. */
  imageBucketRollups: BucketRollup[];
  /** Generated-item calibration grouped by stable feature bucket, symbolic channel. */
  symbolicBucketRollups: BucketRollup[];
  /** Per-difficulty-tier aggregate: attempts and solve rate (image channel). */
  byTier: { difficulty: number; attempts: number; solveRate: number }[];
  /** Per-type aggregate: attempts and solve rate (image channel). */
  byType: { type: string; attempts: number; solveRate: number }[];
  /** Difficulty × tag divergence analysis. */
  divergence: DifficultyTagMatrix;
  /**
   * Attempt records referencing itemIds that are NOT in the bank.
   * Reported but never crash-worthy.
   */
  orphanItemIds: string[];
}

export interface BuildReportOptions {
  /** Partial runs are excluded by default so interrupted prefixes cannot bias evidence. */
  includePartial?: boolean;
}

// ---------------------------------------------------------------------------
// agentTag
// ---------------------------------------------------------------------------

/**
 * Map a pooled image-channel solve rate to a calibration tag.
 * Thresholds live as named constants — they WILL move with real attempt volume.
 * ≥ 0.90 → "agent-easy"   (route to humans)
 * ≤ 0.40 → "agent-hard"   (frontier item)
 *  else  → "agent-mid"
 */
export function agentTag(solveRate: number): AgentTag {
  if (solveRate >= 0.9) return "agent-easy";
  if (solveRate <= 0.4) return "agent-hard";
  return "agent-mid";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Tally attempts and correct count per model, per item, for one channel. */
type AggregateEntry = {
  totalAttempts: number;
  totalCorrect: number;
  byModel: Map<string, { attempts: number; correct: number }>;
};

function aggregateByChannel(
  files: AttemptFile[],
  channel: "image" | "symbolic",
  keyOf: (attempt: Attempt) => string | undefined = (attempt) => attempt.itemId,
): Map<string, AggregateEntry> {
  const map = new Map<string, AggregateEntry>();

  for (const file of files) {
    if (file.channel !== channel) continue;
    const modelKey = `${file.provider}/${file.model}`;

    for (const attempt of file.attempts) {
      const key = keyOf(attempt);
      if (key === undefined) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = { totalAttempts: 0, totalCorrect: 0, byModel: new Map() };
        map.set(key, entry);
      }

      entry.totalAttempts += 1;
      if (attempt.correct) entry.totalCorrect += 1;

      let modelEntry = entry.byModel.get(modelKey);
      if (!modelEntry) {
        modelEntry = { attempts: 0, correct: 0 };
        entry.byModel.set(modelKey, modelEntry);
      }
      modelEntry.attempts += 1;
      if (attempt.correct) modelEntry.correct += 1;
    }
  }

  return map;
}

export function reportableAttemptFiles(
  files: readonly AttemptFile[],
  includePartial = false,
): AttemptFile[] {
  // A run with no model answers is excluded unconditionally — `--include-partial`
  // widens the population for diagnostics, it does not license reporting a run
  // that never reached the model as though it measured the items.
  // `status` is optional: artifacts written before it existed are treated as
  // complete, exactly as they were before this filter gained the evidence check.
  return files.filter((file) =>
    hasModelEvidence(file) && (includePartial || file.status !== "partial"));
}

/** Runs that recorded attempts but never reached the model. */
export function harnessFailureAttemptFiles(files: readonly AttemptFile[]): AttemptFile[] {
  return files.filter((file) => !hasModelEvidence(file));
}

function outcomeCounts(
  files: readonly AttemptFile[],
  channel: "image" | "symbolic",
): Record<AttemptOutcome, number> {
  const counts = Object.fromEntries(ATTEMPT_OUTCOMES.map((outcome) => [outcome, 0])) as
    Record<AttemptOutcome, number>;
  for (const file of files) {
    if (file.channel !== channel) continue;
    for (const attempt of file.attempts) counts[outcomeOf(attempt)] += 1;
  }
  return counts;
}

/** Convert the aggregated map to a list of ItemRollups. */
function toRollups(
  agg: Map<string, AggregateEntry>,
): ItemRollup[] {
  const rollups: ItemRollup[] = [];

  for (const [itemId, data] of agg) {
    const attempts = data.totalAttempts;
    const solveRate = attempts > 0 ? data.totalCorrect / attempts : 0;

    const byModel: Record<string, { attempts: number; solveRate: number }> = {};
    for (const [model, md] of data.byModel) {
      byModel[model] = {
        attempts: md.attempts,
        solveRate: md.attempts > 0 ? md.correct / md.attempts : 0,
      };
    }

    rollups.push({
      itemId,
      attempts,
      solveRate,
      byModel,
      tag: attempts >= MIN_ATTEMPTS ? agentTag(solveRate) : null,
    });
  }

  return rollups.sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/** Convert bucket aggregates without applying per-item calibration tags. */
function toBucketRollups(agg: Map<string, AggregateEntry>): BucketRollup[] {
  const rollups: BucketRollup[] = [];
  for (const [featureBucket, data] of agg) {
    const byModel: BucketRollup["byModel"] = {};
    for (const [model, modelData] of data.byModel) {
      byModel[model] = {
        attempts: modelData.attempts,
        solveRate: modelData.attempts > 0 ? modelData.correct / modelData.attempts : 0,
      };
    }
    rollups.push({
      featureBucket,
      attempts: data.totalAttempts,
      solveRate: data.totalAttempts > 0 ? data.totalCorrect / data.totalAttempts : 0,
      byModel,
    });
  }
  return rollups.sort((a, b) => a.featureBucket.localeCompare(b.featureBucket));
}

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

/**
 * Build the full calibration report from a set of attempt files and the
 * current bank items.
 *
 * The caller (scripts/report.ts) splits files by both prompt and generator
 * version before calling this function. buildReport exposes both version sets
 * as a second guard against silently mixing incompatible populations.
 */
export function buildReport(
  files: AttemptFile[],
  bank: BankItem[],
  options: BuildReportOptions = {},
): CalibrationReport {
  const reportFiles = reportableAttemptFiles(files, options.includePartial);
  // --- promptVersions ---
  const promptVersions = [...new Set(reportFiles.map((f) => f.promptVersion))].sort();
  const generatorVersions = [...new Set(reportFiles.map(generatorVersionOf))].sort();

  // --- aggregation ---
  const imageAgg = aggregateByChannel(reportFiles, "image");
  const symbolicAgg = aggregateByChannel(reportFiles, "symbolic");

  const imageRollups = toRollups(imageAgg);
  const symbolicRollups = toRollups(symbolicAgg);
  const imageBucketRollups = toBucketRollups(
    aggregateByChannel(reportFiles, "image", (attempt) => attempt.generation?.featureBucket),
  );
  const symbolicBucketRollups = toBucketRollups(
    aggregateByChannel(reportFiles, "symbolic", (attempt) => attempt.generation?.featureBucket),
  );

  // --- orphan detection ---
  const bankIds = new Set(bank.map((item) => item.puzzle.id));
  const allItemIds = new Set([...imageAgg.keys(), ...symbolicAgg.keys()]);
  const orphanItemIds = [...allItemIds].filter((id) => !bankIds.has(id)).sort();

  // --- build lookup maps for tier/type joins ---
  const bankById = new Map(bank.map((item) => [item.puzzle.id, item]));
  const imageRollupById = new Map(imageRollups.map((r) => [r.itemId, r]));

  // --- byTier ---
  const tierAcc = new Map<number, { attempts: number; correct: number }>();
  for (const [itemId, rollup] of imageRollupById) {
    const bankItem = bankById.get(itemId);
    if (!bankItem) continue; // orphan — skip
    const diff = bankItem.puzzle.difficulty;
    let acc = tierAcc.get(diff);
    if (!acc) { acc = { attempts: 0, correct: 0 }; tierAcc.set(diff, acc); }
    acc.attempts += rollup.attempts;
    acc.correct += Math.round(rollup.solveRate * rollup.attempts);
  }
  const byTier = [...tierAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([difficulty, acc]) => ({
      difficulty,
      attempts: acc.attempts,
      solveRate: acc.attempts > 0 ? acc.correct / acc.attempts : 0,
    }));

  // --- byType ---
  const typeAcc = new Map<string, { attempts: number; correct: number }>();
  for (const [itemId, rollup] of imageRollupById) {
    const bankItem = bankById.get(itemId);
    if (!bankItem) continue;
    const type = bankItem.puzzle.type;
    let acc = typeAcc.get(type);
    if (!acc) { acc = { attempts: 0, correct: 0 }; typeAcc.set(type, acc); }
    acc.attempts += rollup.attempts;
    acc.correct += Math.round(rollup.solveRate * rollup.attempts);
  }
  const byType = [...typeAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, acc]) => ({
      type,
      attempts: acc.attempts,
      solveRate: acc.attempts > 0 ? acc.correct / acc.attempts : 0,
    }));

  // --- divergence matrix ---
  const DIFFICULTIES = [1, 2, 3, 4, 5];
  const matrix: Record<number, Record<AgentTag | "untagged", number>> = {};
  for (const d of DIFFICULTIES) {
    matrix[d] = { "agent-easy": 0, "agent-mid": 0, "agent-hard": 0, untagged: 0 };
  }

  // We count ALL bank items (not just those with attempts) so the matrix shows
  // the full picture including items awaiting calibration.
  for (const item of bank) {
    const diff = item.puzzle.difficulty;
    if (!matrix[diff]) {
      matrix[diff] = { "agent-easy": 0, "agent-mid": 0, "agent-hard": 0, untagged: 0 };
    }
    const rollup = imageRollupById.get(item.puzzle.id);
    const tagKey: AgentTag | "untagged" = rollup?.tag ?? "untagged";
    matrix[diff][tagKey] += 1;
  }

  // --- divergence mismatches ---
  // "d5 but agents ace it"  → high difficulty (≥4) + high solveRate (≥0.80) → severity = solveRate * difficulty
  // "d2 but agents fail it" → low difficulty (≤2) + low solveRate (≤0.50) → severity = (1 - solveRate) * (6 - difficulty)
  interface MismatchCandidate {
    itemId: string;
    difficulty: number;
    solveRate: number;
    attempts: number;
    note: string;
    severity: number;
  }

  const candidates: MismatchCandidate[] = [];

  for (const [itemId, rollup] of imageRollupById) {
    if (rollup.attempts < MIN_ATTEMPTS) continue;
    const bankItem = bankById.get(itemId);
    if (!bankItem) continue;
    const diff = bankItem.puzzle.difficulty;

    // High difficulty but agents ace it
    if (diff >= 4 && rollup.solveRate >= 0.8) {
      candidates.push({
        itemId,
        difficulty: diff,
        solveRate: rollup.solveRate,
        attempts: rollup.attempts,
        note: `d${diff} but agents solve it ${(rollup.solveRate * 100).toFixed(0)}% of the time`,
        severity: rollup.solveRate * diff,
      });
    }

    // Low difficulty but agents fail it
    if (diff <= 2 && rollup.solveRate <= 0.5) {
      candidates.push({
        itemId,
        difficulty: diff,
        solveRate: rollup.solveRate,
        attempts: rollup.attempts,
        note: `d${diff} but agents only solve it ${(rollup.solveRate * 100).toFixed(0)}% of the time`,
        severity: (1 - rollup.solveRate) * (6 - diff),
      });
    }
  }

  // Sort by severity descending, take top 10
  candidates.sort((a, b) => b.severity - a.severity);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mismatches = candidates.slice(0, 10).map(({ severity: _severity, ...rest }) => rest);

  return {
    promptVersions,
    generatorVersions,
    outcomes: {
      image: outcomeCounts(reportFiles, "image"),
      symbolic: outcomeCounts(reportFiles, "symbolic"),
    },
    imageRollups,
    symbolicRollups,
    imageBucketRollups,
    symbolicBucketRollups,
    byTier,
    byType,
    divergence: { matrix, mismatches },
    orphanItemIds,
  };
}

// ---------------------------------------------------------------------------
// applyCalibration
// ---------------------------------------------------------------------------

/**
 * Return a new bank array with calibration blocks and agent-* tags applied.
 *
 * Rules:
 * - Items with ≥1 image attempt get a calibration block (attempts, solveRate, byModel, updatedAt).
 * - Items with ≥ MIN_ATTEMPTS image attempts also get the appropriate "agent-*" tag
 *   (replaces any existing "agent-*" tag; non-agent tags are preserved).
 * - Items with <MIN_ATTEMPTS attempts (but ≥1): stale agent-* tags are removed;
 *   calibration block is still set with current data.
 * - Items with 0 image attempts: unchanged (existing calibration/tags preserved).
 *
 * Idempotent: applying twice with the same rollups and `now` yields identical output.
 *
 * @param bank    - current bank items (not mutated)
 * @param rollups - image-channel ItemRollups from buildReport
 * @param now     - timestamp string for updatedAt (default: new Date().toISOString())
 */
export function applyCalibration(
  bank: BankItem[],
  rollups: ItemRollup[],
  now: string = new Date().toISOString(),
): BankItem[] {
  const rollupById = new Map(rollups.map((r) => [r.itemId, r]));

  return bank.map((item): BankItem => {
    const rollup = rollupById.get(item.puzzle.id);
    if (!rollup || rollup.attempts === 0) {
      // No image attempts — leave calibration and tags unchanged.
      return item;
    }

    // Build updated calibration block.
    const calibration = {
      attempts: rollup.attempts,
      solveRate: rollup.solveRate,
      byModel: rollup.byModel,
      updatedAt: now,
    };

    // Strip existing agent-* tags; preserve non-agent tags.
    const nonAgentTags = item.tags.filter((t) => !t.startsWith("agent-"));

    // Add the new tag only when we have enough data.
    const newTags: string[] =
      rollup.tag !== null ? [...nonAgentTags, rollup.tag] : nonAgentTags;

    return {
      ...item,
      calibration,
      tags: newTags,
    };
  });
}
