import { createHash } from "node:crypto";
import { z } from "zod";
import bankFile from "../../data/bank/items.json";
import {
  PuzzleSchema,
  isBlank,
  sceneSignature,
  type Puzzle,
  type PuzzleSet,
  type PuzzleType,
} from "./schema";
import {
  eligibleFamiliesForBand,
  EXPANDED_GENERATOR_VERSION,
  planExpandedSchedule,
  type ExpandedProfile,
} from "./expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
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
 * Five, because constraint-spatial now splits ten questions over its two
 * retained families. The emergency bank has to answer every slot from the
 * exact bucket the schedule asks for.
 */
export const BANK_ITEMS_PER_KEY = 5;

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
  const usable = items.filter((item) =>
    item.provenance.generatorVersion === EXPANDED_GENERATOR_VERSION &&
    item.puzzle.generation?.generatorVersion === EXPANDED_GENERATOR_VERSION &&
    item.puzzle.familyId !== undefined &&
    !withdrawnFamilyIds.has(item.puzzle.familyId));
  const used = new Set<string>();
  const chosen = schedule.map((slot, slotIndex) => {
    const inSlotFamily = usable.filter((item) =>
      !used.has(item.fingerprint) && item.puzzle.familyId === slot.familyId);
    const inSlotBand = inSlotFamily.filter((item) => item.puzzle.band === slot.band);
    const key = expandedBankKey(slot.familyId, slot.band, slot.difficultyBucket);
    const exactKey = inSlotBand.filter((item) => expandedBankKeyOf(item.puzzle) === key);
    const sameDifficulty = inSlotBand.filter((item) => item.puzzle.difficulty === slot.difficulty);
    // Four rungs, each used only when the one above it is empty: the slot's
    // exact family/band/bucket key, then the same family and band at the same
    // difficulty, then the same family anywhere in that band, then the same
    // family from whichever band the bank does hold it in.
    //
    // Only the first rung should ever run. A bank built by
    // `npm run bank:topup -- --replace --per-bucket 5` holds
    // five items for every key the registry can schedule, and no key comes up
    // more than five times in one test, so the exact bucket is always in stock
    // — `expandedBankCoverage` above proves that from the built file rather
    // than leaving it to a lucky sampling run.
    //
    // The lower rungs stay as a guard for the one case that is not a bug: a
    // registry that has moved ahead of the committed bank. That has happened
    // repeatedly as the family registry evolved, and an emergency fallback
    // that refuses to serve a test is worse than one that serves the same
    // family a step shallower.
    // `npm run bank:verify` reports the gap rather than leaving a taker to
    // find it.
    const candidates = exactKey.length > 0
      ? exactKey
      : sameDifficulty.length > 0
        ? sameDifficulty
        : inSlotBand.length > 0
          ? inSlotBand
          : inSlotFamily;
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
