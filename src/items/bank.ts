import { createHash } from "node:crypto";
import { z } from "zod";
import bankFile from "../../data/bank/items.json";
import {
  PuzzleSchema,
  PUZZLE_TYPES,
  isBlank,
  isScene,
  sceneSignature,
  shuffleOptions,
  visualSignature,
  type Puzzle,
  type PuzzleSet,
  type PuzzleType,
  type Visual,
} from "./schema";
import {
  EXPANDED_GENERATOR_VERSION,
  planExpandedSchedule,
  type ExpandedProfile,
} from "./expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  readWithdrawnFamilyIds,
  type FamilyPromotionRegistry,
} from "./family-promotion";
import { seededRng, shuffled, type Seed } from "../lib/rng";

/**
 * The item bank — validated puzzles as data (data/bank/items.json, committed).
 *
 * The bank is the deterministic generator's emergency fallback and regression
 * corpus. Loaded via a static JSON import so it works identically on Vercel
 * serverless with zero fs/tracing config. Items are stored in canonical
 * (unshuffled) option order for stable diffs and shuffled at serve time. Bank
 * invariants are enforced by `scripts/bank-verify.ts`: expanded items replay
 * through their current generator and legacy items pass `checkRule`.
 */

export const BankItemSchema = z.object({
  /** Canonical authored option order — serve-time shuffling never touches the file. */
  puzzle: PuzzleSchema,
  /** Content-addressed identity (see fingerprintPuzzle) — dedup + stable ids. */
  fingerprint: z.string().min(1),
  provenance: z.object({
    source: z.enum(["procedural", "model", "handAuthored", "expanded"]),
    provider: z.string().optional(), // when source = "model"
    model: z.string().optional(),
    seed: z.union([z.number(), z.string()]).optional(),
    profile: z.enum(["short-5", "long-30"]).optional(),
    generatorVersion: z.string().optional(),
    /**
     * Normalized withdrawal list this item was generated under (source
     * "expanded"). The withdrawal list is an input to the assembler, so replay
     * must use the stored value: verifying against the runtime list makes every
     * expanded item fail the moment an operator withdraws any family.
     */
    withdrawnFamilyIds: z.array(z.string()).optional(),
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
export function fingerprintPuzzle(p: Puzzle<Visual>): string {
  const signature = (visual: Visual) => isScene(visual) ? sceneSignature(visual) : visualSignature(visual);
  const stemSigs = p.stem.map((panel) => (isBlank(panel) ? "·" : signature(panel)));
  const optionSigs = p.options.map(signature).sort();
  const answerSig = signature(p.options[p.answerIndex]);
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
export function bankIdFor(p: Puzzle<Visual>): string {
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

/** Internal difficulty profile used by generation, calibration, and fallback sampling. */
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

export const EXPANDED_DIFFICULTY_RAMPS: Record<DifficultyLevel, readonly number[]> = {
  easy: [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4],
  standard: [2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5],
  hard: [3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5],
};

/**
 * Sample a quiz from the bank: one item per ramp slot at the nearest available
 * difficulty, preferring types not yet covered (and enforcing full family coverage
 * for hard mode when five families are available),
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
  const rampSource = n === 12 ? EXPANDED_DIFFICULTY_RAMPS : DIFFICULTY_RAMPS;
  const ramp = rampSource[level].slice(0, n);
  while (ramp.length < n) ramp.push(ramp[ramp.length - 1] ?? 3);
  const forceAllTypes = level === "hard" && n >= PUZZLE_TYPES.length;
  const requiredTypes = forceAllTypes ? [...PUZZLE_TYPES] : [];

  const used = new Set<string>();
  const typesCovered = new Set<PuzzleType>();
  const typeCounts = new Map<PuzzleType, number>();
  const chosen: BankItem[] = [];
  for (const target of ramp) {
    // Nearest available difficulty, widening the spread only when a bucket is exhausted.
    const requiredType = requiredTypes.length > 0 ? requiredTypes.shift() : null;
    let pool: BankItem[] = [];
    for (let spread = 0; pool.length === 0 && spread <= 4; spread++) {
      pool = items.filter((i) => !used.has(i.fingerprint) && Math.abs(i.puzzle.difficulty - target) <= spread);
      if (requiredType) {
        const typed = pool.filter((i) => i.puzzle.type === requiredType);
        if (typed.length > 0) {
          pool = typed;
          break;
        }
      }
    }
    if (pool.length === 0) {
      throw new Error(`bank cannot satisfy the "${level}" difficulty profile`);
    }
    const uncovered = pool.filter((i) => !typesCovered.has(i.puzzle.type));
    const diversityPool = uncovered.length > 0
      ? uncovered
      : pool.filter((item) => {
          const least = Math.min(...new Set(pool.map((candidate) => typeCounts.get(candidate.puzzle.type) ?? 0)));
          return (typeCounts.get(item.puzzle.type) ?? 0) === least;
        });
    const item = pickRandom(diversityPool);
    used.add(item.fingerprint);
    typesCovered.add(item.puzzle.type);
    typeCounts.set(item.puzzle.type, (typeCounts.get(item.puzzle.type) ?? 0) + 1);
    chosen.push(item);
  }

  chosen.sort((a, b) => a.puzzle.difficulty - b.puzzle.difficulty);
  return {
    puzzles: chosen.map((i) => shuffleOptions(i.puzzle)) as PuzzleSet,
    items: chosen,
  };
}

function shuffleOptionsWithSeed<V extends Visual>(puzzle: Puzzle<V>, seed: Seed, slot: number): Puzzle<V> {
  const order = shuffled(
    seededRng(seed, `expanded-bank-options:${slot}:${puzzle.id}`),
    puzzle.options.map((_, index) => index),
  );
  return {
    ...puzzle,
    options: order.map((index) => puzzle.options[index]),
    answerIndex: order.indexOf(puzzle.answerIndex),
  };
}

/**
 * Build an emergency quiz from expanded-family bank entries.
 *
 * The live assembler owns the schedule, so fallback keeps the same band counts,
 * family draws, repeat caps, and easiest-first ordering instead of silently
 * falling back to the legacy type-based ramp.
 */
export function sampleExpandedBankQuiz(
  items: BankItem[] = loadBank(),
  profile: ExpandedProfile,
  seed: Seed,
  registry: FamilyPromotionRegistry = CURRENT_FAMILY_PROMOTION_REGISTRY,
  withdrawnFamilyIds: ReadonlySet<string> = readWithdrawnFamilyIds(),
): SampledQuiz {
  const schedule = planExpandedSchedule(seed, profile, registry, withdrawnFamilyIds);
  const usable = items.filter((item) =>
    item.provenance.source === "expanded" &&
    item.provenance.generatorVersion === EXPANDED_GENERATOR_VERSION &&
    item.puzzle.generation?.generatorVersion === EXPANDED_GENERATOR_VERSION &&
    item.puzzle.familyId !== undefined &&
    !withdrawnFamilyIds.has(item.puzzle.familyId));
  const used = new Set<string>();
  const chosen = schedule.map((slot, slotIndex) => {
    const candidates = usable.filter((item) =>
      !used.has(item.fingerprint) &&
      item.puzzle.familyId === slot.familyId &&
      item.puzzle.band === slot.band &&
      item.puzzle.difficulty === slot.difficulty);
    const item = shuffled(
      seededRng(seed, `expanded-bank-item:${slotIndex}:${slot.familyId}`),
      candidates,
    )[0];
    if (!item) {
      throw new Error(
        `expanded emergency bank cannot fill ${profile} slot ${slotIndex + 1}: ` +
          `${slot.familyId} in ${slot.band} needs another current-version item`,
      );
    }
    used.add(item.fingerprint);
    return item;
  });

  return {
    puzzles: chosen.map((item, index) => shuffleOptionsWithSeed(item.puzzle, seed, index)) as PuzzleSet,
    items: chosen,
  };
}
