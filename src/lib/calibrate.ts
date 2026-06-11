/**
 * Calibration core — pure aggregation of agent attempt artifacts.
 *
 * No fs, no env, no side effects. The CLI script (scripts/report.ts) is the
 * shell that loads files, prints output, and optionally writes back to the bank.
 * Pure functions here make this fully unit-testable and reusable if/when a DB
 * arrives (calibrate.ts gains a data source, not a rewrite).
 */

import type { AttemptFile } from "./attempts";
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
  /** Headline rollups: channel === "image". */
  imageRollups: ItemRollup[];
  /** Secondary/diagnostic rollups: channel === "symbolic". */
  symbolicRollups: ItemRollup[];
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
function aggregateByChannel(
  files: AttemptFile[],
  channel: "image" | "symbolic",
): Map<string, { totalAttempts: number; totalCorrect: number; byModel: Map<string, { attempts: number; correct: number }> }> {
  const map = new Map<string, { totalAttempts: number; totalCorrect: number; byModel: Map<string, { attempts: number; correct: number }> }>();

  for (const file of files) {
    if (file.channel !== channel) continue;
    const modelKey = `${file.provider}/${file.model}`;

    for (const attempt of file.attempts) {
      let entry = map.get(attempt.itemId);
      if (!entry) {
        entry = { totalAttempts: 0, totalCorrect: 0, byModel: new Map() };
        map.set(attempt.itemId, entry);
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

/** Convert the aggregated map to a list of ItemRollups. */
function toRollups(
  agg: Map<string, { totalAttempts: number; totalCorrect: number; byModel: Map<string, { attempts: number; correct: number }> }>,
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

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

/**
 * Build the full calibration report from a set of attempt files and the
 * current bank items.
 *
 * When multiple promptVersions are present the caller (scripts/report.ts)
 * should split files by promptVersion and call buildReport once per version,
 * then print per-version sections. buildReport itself still aggregates whatever
 * files it is given — it never silently hides version diversity, but exposes
 * them in promptVersions so the script can warn and group.
 */
export function buildReport(files: AttemptFile[], bank: BankItem[]): CalibrationReport {
  // --- promptVersions ---
  const promptVersions = [...new Set(files.map((f) => f.promptVersion))].sort();

  // --- aggregation ---
  const imageAgg = aggregateByChannel(files, "image");
  const symbolicAgg = aggregateByChannel(files, "symbolic");

  const imageRollups = toRollups(imageAgg);
  const symbolicRollups = toRollups(symbolicAgg);

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
    imageRollups,
    symbolicRollups,
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
