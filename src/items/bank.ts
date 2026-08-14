import { createHash } from "node:crypto";
import { z } from "zod";
import bankFile from "../../data/bank/items.json";
import {
  PuzzleSchema,
  isBlank,
  shuffleOptions,
  visualSignature,
  type Puzzle,
  type PuzzleSet,
  type PuzzleType,
} from "./schema";

/**
 * The item bank — validated puzzles as data (data/bank/items.json, committed).
 *
 * The bank is the default serving path (instant quiz start; live generation is
 * the opt-in variety path) and the failure fallback. Loaded via a static JSON
 * import so it works identically on Vercel serverless with zero fs/tracing
 * config. Items are stored in canonical (unshuffled) option order for stable
 * diffs; `shuffleOptions` runs at serve time. Bank invariant (enforced by
 * scripts/bank-verify.ts and the topup CLI, not at runtime): every item has a
 * `rule` and passes `checkRule`.
 */

export const BankItemSchema = z.object({
  /** Canonical authored option order — serve-time shuffling never touches the file. */
  puzzle: PuzzleSchema,
  /** Content-addressed identity (see fingerprintPuzzle) — dedup + stable ids. */
  fingerprint: z.string().min(1),
  provenance: z.object({
    source: z.enum(["procedural", "model", "handAuthored"]),
    provider: z.string().optional(), // when source = "model"
    model: z.string().optional(),
    seed: z.number().optional(), // when source = "procedural"
    createdAt: z.string(), // ISO 8601
  }),
  /** Calibration tags (Phase D): "agent-easy" | "agent-mid" | "agent-hard". */
  tags: z.array(z.string()).default([]),
  /** Calibration summary (Phase D `report --write`); image channel only. */
  calibration: z
    .object({
      attempts: z.number().int(),
      solveRate: z.number(),
      byModel: z.record(z.string(), z.object({ attempts: z.number(), solveRate: z.number() })),
      updatedAt: z.string(),
    })
    .optional(),
});
export type BankItem = z.infer<typeof BankItemSchema>;

export const BankFileSchema = z.object({
  version: z.literal(1),
  items: z.array(BankItemSchema),
});
export type BankFile = z.infer<typeof BankFileSchema>;

/**
 * Content-addressed identity: sha256 over type, layout, stem signatures in
 * order ("·" for blanks), SORTED option signatures (shuffle-invariant), and the
 * answer's signature (same stem + different correct answer = different item).
 */
export function fingerprintPuzzle(p: Puzzle): string {
  const stemSigs = p.stem.map((panel) => (isBlank(panel) ? "·" : visualSignature(panel)));
  const optionSigs = p.options.map(visualSignature).sort();
  const answerSig = visualSignature(p.options[p.answerIndex]);
  const base = [p.type, p.layout, stemSigs.join(","), optionSigs.join(","), answerSig];
  // Preserve every legacy bank fingerprint byte-for-byte; only the new family
  // appends its visible nominal ordering.
  if (p.operatorLegend) base.push(p.operatorLegend.shapeCycle.join(">"));
  const canonical = base.join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 10);
}

const ID_PREFIX: Record<PuzzleType, string> = {
  matrix: "mx",
  sequence: "sq",
  analogy: "an",
  oddOneOut: "oo",
  operatorInduction: "op",
};

/** The bank id a puzzle should carry: `<typePrefix>-<fingerprint>`. */
export function bankIdFor(p: Puzzle): string {
  return `${ID_PREFIX[p.type]}-${fingerprintPuzzle(p)}`;
}

let cachedItems: BankItem[] | null = null;

/** Parse the embedded bank once per process. */
export function loadBank(): BankItem[] {
  if (!cachedItems) cachedItems = BankFileSchema.parse(bankFile).items;
  return cachedItems;
}

/** A served quiz; `puzzles[i]` is the shuffled form of `items[i].puzzle`. */
export interface SampledQuiz {
  puzzles: PuzzleSet;
  items: BankItem[];
}

/**
 * Per-item agent calibration summary, served alongside bank quizzes (Phase D).
 * The client imports only this TYPE (type-only import — bank.ts itself must
 * never reach the client bundle: node:crypto + the whole bank JSON).
 */
export interface AgentStats {
  solveRate: number;
  attempts: number;
  tag: string | null; // "agent-easy" | "agent-mid" | "agent-hard"
}

export function agentStatsFor(item: BankItem): AgentStats | null {
  if (!item.calibration) return null;
  return {
    solveRate: item.calibration.solveRate,
    attempts: item.calibration.attempts,
    tag: item.tags.find((t) => t.startsWith("agent-")) ?? null,
  };
}

const QUIZ_SIZE = 5;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** User-selectable difficulty profile for a quiz (chosen on the intro screen). */
export type DifficultyLevel = "easy" | "standard" | "hard";

/**
 * Target per-slot difficulty ramps (ascending). The bank is topped up evenly
 * across d1–d5, so exact matches normally exist; the sampler widens to the
 * nearest available difficulty when they don't.
 */
export const DIFFICULTY_RAMPS: Record<DifficultyLevel, readonly number[]> = {
  easy: [1, 1, 2, 2, 3],
  standard: [2, 2, 3, 3, 5],
  hard: [3, 4, 4, 5, 5],
};

/**
 * Sample a quiz from the bank: one item per ramp slot at the nearest available
 * difficulty, preferring types not yet covered (≥3 types with today's bank),
 * ascending difficulty order, serve-time option shuffle. Content-addressed ids
 * make uniqueness automatic.
 */
export function sampleQuiz(
  items: BankItem[] = loadBank(),
  n = QUIZ_SIZE,
  level: DifficultyLevel = "standard",
): SampledQuiz {
  if (items.length < n) {
    throw new Error(`bank has ${items.length} items — need at least ${n} to sample a quiz`);
  }
  const ramp = DIFFICULTY_RAMPS[level].slice(0, n);
  while (ramp.length < n) ramp.push(ramp[ramp.length - 1] ?? 3);

  const used = new Set<string>();
  const typesCovered = new Set<PuzzleType>();
  const chosen: BankItem[] = [];
  for (const target of ramp) {
    // Nearest available difficulty, widening the spread only when a bucket is exhausted.
    let pool: BankItem[] = [];
    for (let spread = 0; pool.length === 0 && spread <= 4; spread++) {
      pool = items.filter((i) => !used.has(i.fingerprint) && Math.abs(i.puzzle.difficulty - target) <= spread);
    }
    if (pool.length === 0) {
      throw new Error(`bank cannot satisfy the "${level}" difficulty profile`);
    }
    const uncovered = pool.filter((i) => !typesCovered.has(i.puzzle.type));
    const item = pickRandom(uncovered.length > 0 ? uncovered : pool);
    used.add(item.fingerprint);
    typesCovered.add(item.puzzle.type);
    chosen.push(item);
  }

  chosen.sort((a, b) => a.puzzle.difficulty - b.puzzle.difficulty);
  return {
    puzzles: chosen.map((i) => shuffleOptions(i.puzzle)) as PuzzleSet,
    items: chosen,
  };
}
