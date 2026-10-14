import { createHash } from "node:crypto";
import { z } from "zod";
import bankFile from "../../data/bank/items.json";
import {
  PuzzleSchema,
  OPTIONS_PER_ITEM,
  isBlank,
  sceneSignature,
  type Puzzle,
  type PuzzleSet,
  type PuzzleType,
} from "./schema";
import {
  eligibleFamiliesForBand,
  EXPANDED_GENERATOR_VERSION,
  MAXIMUM_FAMILY_QUESTIONS,
  planExpandedSchedule,
  type ExpandedProfile,
} from "./expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
  readWithdrawnFamilyIds,
  type FamilyPromotionRegistry,
} from "./family-promotion";
import { SCENE_FAMILY_IDS, machineGateNecessity, sceneFamilyClueCheck } from "./scene-families";
import { solveAttributeMatrix } from "./attribute-matrix";
import { seededRng, shuffled, type Seed } from "../lib/rng";

/**
 * The item bank — validated puzzles as data (data/bank/items.json, committed).
 *
 * The bank is the deterministic generator's emergency fallback and regression
 * corpus. Loaded via a static JSON import so it works identically on Vercel
 * serverless with zero fs/tracing config. Items are stored in canonical
 * (unshuffled) option order for stable diffs and shuffled at serve time. Bank
 * invariants are enforced by `scripts/bank-verify.ts`: every item replays
 * through its current generator.
 */

export const BankItemSchema = z.object({
  /** Canonical authored option order — serve-time shuffling never touches the file. */
  puzzle: PuzzleSchema,
  /** Content-addressed identity (see fingerprintPuzzle) — dedup + stable ids. */
  fingerprint: z.string().min(1),
  provenance: z.object({
    source: z.literal("expanded"),
    seed: z.string().optional(),
    profile: z.enum(["short-5", "long-30"]).optional(),
    generatorVersion: z.string().optional(),
    /**
     * Normalized withdrawal list this item was generated under. The
     * withdrawal list is an input to the assembler, so replay
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
export function fingerprintPuzzle(p: Puzzle): string {
  const stemSigs = p.stem.map((panel) => (isBlank(panel) ? "·" : sceneSignature(panel)));
  const optionSigs = p.options.map(sceneSignature).sort();
  const answerSig = sceneSignature(p.options[p.answerIndex]);
  const canonical = [p.type, p.layout, stemSigs.join(","), optionSigs.join(","), answerSig].join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 10);
}

const ID_PREFIX: Record<PuzzleType, string> = {
  matrix: "mx",
  sequence: "sq",
  analogy: "an",
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
 * How many banked items every enabled family/band/bucket key holds.
 *
 * Five, matching the long test's maximum questions from any one family.
 * The emergency bank can therefore answer every slot from its exact bucket.
 */
export const BANK_ITEMS_PER_KEY = MAXIMUM_FAMILY_QUESTIONS["long-30"];

/**
 * What a bank item is stocked against: one family, in one band, at one bucket.
 *
 * Family alone was too coarse. A family with two validated buckets in a band
 * serves a shallower question the first time and a deeper one after that, and
 * a family registered in two bands serves a different item shape in each — so
 * "four items of compositional-analogy-v2" said nothing about whether the d4
 * bucket was covered.
 */
export function expandedBankKey(
  familyId: string,
  band: string,
  difficultyBucket: string,
): string {
  return `${familyId}:${band}:${difficultyBucket}`;
}

/** The key a banked puzzle covers, or null when it is not a current expanded item. */
export function expandedBankKeyOf(puzzle: Puzzle): string | null {
  const generation = puzzle.generation;
  if (!generation || generation.generatorVersion !== EXPANDED_GENERATOR_VERSION) return null;
  if (!puzzle.band) return null;
  return expandedBankKey(generation.familyId, puzzle.band, generation.featureBucket);
}

/** Every key the live registry can schedule, sorted; the bank must cover all of them. */
export function enabledExpandedBankKeys(
  registry: FamilyPromotionRegistry = CURRENT_FAMILY_PROMOTION_REGISTRY,
  withdrawnFamilyIds: ReadonlySet<string> = readWithdrawnFamilyIds(),
): string[] {
  return EXPANDED_PROFILE_BANDS.flatMap((band) =>
    eligibleFamiliesForBand(registry, band, withdrawnFamilyIds).flatMap((family) =>
      family.bandBuckets.map((bucket) => expandedBankKey(family.familyId, band, bucket.bucket))))
    .sort();
}

export interface ExpandedBankCoverage {
  /** Enabled key -> current-version items the bank holds for it. */
  countsByKey: Map<string, number>;
  /** Enabled keys holding fewer than `BANK_ITEMS_PER_KEY` items. */
  short: { key: string; have: number }[];
  /** Current expanded items whose key the live registry cannot schedule. */
  strays: string[];
}

/**
 * Count the bank against the keys the registry can schedule.
 *
 * This is the check that keeps the fallback ladder in `sampleExpandedBankQuiz`
 * unreachable: it is a property of the built bank, decided before anything is
 * served, rather than something a sampling run might or might not run into.
 */
export function expandedBankCoverage(
  items: readonly BankItem[] = loadBank(),
  registry: FamilyPromotionRegistry = CURRENT_FAMILY_PROMOTION_REGISTRY,
  withdrawnFamilyIds: ReadonlySet<string> = readWithdrawnFamilyIds(),
): ExpandedBankCoverage {
  const countsByKey = new Map<string, number>(enabledExpandedBankKeys(registry, withdrawnFamilyIds)
    .map((key) => [key, 0]));
  const strays: string[] = [];
  for (const item of items) {
    const key = expandedBankKeyOf(item.puzzle);
    if (key === null || !countsByKey.has(key)) {
      strays.push(`${item.puzzle.id} (${key ?? "no current-version key"})`);
      continue;
    }
    countsByKey.set(key, countsByKey.get(key)! + 1);
  }
  const short = [...countsByKey]
    .filter(([, have]) => have < BANK_ITEMS_PER_KEY)
    .map(([key, have]) => ({ key, have }));
  return { countsByKey, short, strays };
}

function shuffleOptionsWithSeed(puzzle: Puzzle, seed: Seed, slot: number): Puzzle {
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
 * family draws, repeat caps, and easiest-first ordering.
 */
export function sampleExpandedBankQuiz(
  items: BankItem[] = loadBank(),
  profile: ExpandedProfile,
  seed: Seed,
  registry: FamilyPromotionRegistry = CURRENT_FAMILY_PROMOTION_REGISTRY,
  withdrawnFamilyIds: ReadonlySet<string> = readWithdrawnFamilyIds(),
): SampledQuiz {
  const schedule = planExpandedSchedule(seed, profile, registry, withdrawnFamilyIds);
  const usable = items.filter((item) => {
    const puzzle = item.puzzle;
    if (item.provenance.generatorVersion !== EXPANDED_GENERATOR_VERSION ||
        puzzle.generation?.generatorVersion !== EXPANDED_GENERATOR_VERSION ||
        puzzle.familyId === undefined || puzzle.familyId !== puzzle.generation.familyId ||
        !SCENE_FAMILY_IDS.some((familyId) => familyId === puzzle.familyId) ||
        withdrawnFamilyIds.has(puzzle.familyId) || puzzle.options.length !== OPTIONS_PER_ITEM) return false;
    // Version labels alone cannot certify authored bank data. Re-read the
    // visible clues before any entry enters the fallback's candidate pool.
    const clues = sceneFamilyClueCheck(puzzle);
    const necessity = machineGateNecessity(puzzle);
    if (necessity && !necessity.valid) return false;
    if (necessity && puzzle.difficulty >= 5 && necessity.queryOrder.every((gate, index) => gate === index)) return false;
    if (puzzle.familyId === "attribute-matrix-v1") {
      const report = solveAttributeMatrix(puzzle);
      if (clues.dispensableClueIds.length > 0 || report.solutionCount !== 1 || !report.derivedAnswer ||
          sceneSignature(report.derivedAnswer) !== sceneSignature(puzzle.options[puzzle.answerIndex])) return false;
    }
    return clues.singleClueAnswerIds.length === 0 &&
      clues.indistinguishableWrongOptionIndexes.length === 0;
  });
  const used = new Set<string>();
  const chosen = schedule.map((slot, slotIndex) => {
    const inSlotFamily = usable.filter((item) =>
      !used.has(item.fingerprint) && item.puzzle.familyId === slot.familyId &&
      item.puzzle.difficulty === slot.difficulty);
    const inSlotBand = inSlotFamily.filter((item) => item.puzzle.band === slot.band);
    const key = expandedBankKey(slot.familyId, slot.band, slot.difficultyBucket);
    const exactKey = inSlotBand.filter((item) => expandedBankKeyOf(item.puzzle) === key);
    const sameDifficulty = inSlotBand.filter((item) => item.puzzle.difficulty === slot.difficulty);
    // An incomplete bank may substitute the same family at the same difficulty,
    // but must never change the question number's fixed level.
    const candidates = exactKey.length > 0
      ? exactKey
      : sameDifficulty.length > 0
        ? sameDifficulty
        : inSlotFamily;
    const item = shuffled(
      seededRng(seed, `expanded-bank-item:${slotIndex}:${slot.familyId}`),
      candidates,
    )[0];
    if (!item) {
      throw new Error(
        `expanded emergency bank cannot fill ${profile} slot ${slotIndex + 1}: ` +
          `${slot.familyId} at d${slot.difficulty} needs another current-version item`,
      );
    }
    used.add(item.fingerprint);
    // The band a question occupies is the SLOT's, exactly as the live assembler
    // stamps it; a substituted item must not report the band it was banked in,
    // or the served test would not have the schedule shape it claims.
    return { item, puzzle: { ...item.puzzle, band: slot.band } };
  });

  return {
    puzzles: chosen.map((entry, index) => shuffleOptionsWithSeed(entry.puzzle, seed, index)),
    items: chosen.map((entry) => entry.item),
  };
}
