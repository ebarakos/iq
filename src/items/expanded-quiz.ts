import { createHash } from "node:crypto";
import { seededRng, shuffled, type Rng, type Seed } from "../lib/rng";
import {
  EXPANDED_PROFILE_BANDS,
  type ExpandedProfileBand,
  type FamilyPromotionRegistry,
} from "./family-promotion";
import {
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import {
  VisualPuzzleSetSchema,
  type Puzzle,
  type PuzzleSet,
  type Scene,
  type Visual,
} from "./schema";

/**
 * Generation semantics for the two public test lengths.
 *
 * Bump this whenever the band schedule, the family pool rule, the ordering
 * rule, or any family's item semantics change. `scene-families-v2` was the
 * retired 12-question profile; `v3` carried the ill-posed `minimal-repair-v1`,
 * so attempt data recorded under it must not be pooled with `v4`. `v5` adds
 * seeded family-pool subsampling, so it is likewise a separate population.
 * `v6` serves `OPTIONS_PER_ITEM` options instead of four, which lowers the value
 * of a guess and changes every family's near misses — results from `v5` and `v6`
 * are not comparable and must never be pooled.
 */
export const EXPANDED_GENERATOR_VERSION = "scene-families-v6" as const;

export const EXPANDED_PROFILES = ["short-5", "long-30"] as const;
export type ExpandedProfile = (typeof EXPANDED_PROFILES)[number];

/** Questions per band. Part of the generator version; a released one never changes. */
export const BAND_SCHEDULE: Readonly<
  Record<ExpandedProfile, Readonly<Record<ExpandedProfileBand, number>>>
> = {
  "long-30": { warmup: 5, composition: 10, "constraint-spatial": 10, "induction-transfer": 5 },
  "short-5": { warmup: 1, composition: 1, "constraint-spatial": 2, "induction-transfer": 1 },
};

/**
 * How small a band's family pool may get before the length is unavailable.
 *
 * Withdrawing families must not quietly produce a thinner test, so falling
 * below any of these fails the request loudly instead of serving a test built
 * from two generators.
 */
export const MINIMUM_ELIGIBLE_FAMILIES: Readonly<
  Record<ExpandedProfile, Readonly<Record<ExpandedProfileBand, number>>>
> = {
  "long-30": { warmup: 2, composition: 4, "constraint-spatial": 4, "induction-transfer": 3 },
  "short-5": { warmup: 1, composition: 1, "constraint-spatial": 2, "induction-transfer": 1 },
};

export const MINIMUM_DISTINCT_FAMILIES: Readonly<Record<ExpandedProfile, number>> = {
  "long-30": 12,
  "short-5": 5,
};

/**
 * Non-warmup bands draw this many families for one test before their questions
 * are split and ordered. Warmup keeps its complete pool so every test still
 * begins with the full set of introductory mechanisms.
 */
export const FAMILY_SUBSAMPLE_SIZES: Readonly<
  Record<ExpandedProfileBand, number | undefined>
> = {
  warmup: undefined,
  composition: 4,
  "constraint-spatial": 4,
  "induction-transfer": 3,
};

/** Attempts per slot before assembly gives up. Each attempt has its own child seed. */
const RETRY_BUDGET = 4;

/**
 * Worked-example layouts must show at least two visible scenes, so the rule is
 * read off a sequence rather than guessed from one unexplained panel.
 *
 * `singleScene` boards and the empty-stem outlier layout are exempt because
 * their evidence is not in the stem: an outlier item is read across its four
 * options, and a mosaic, path, or repair board is read as a whole.
 */
const MINIMUM_VISIBLE_STEM_PANELS = 2;

function needsWorkedExamples(puzzle: Puzzle<Scene>): boolean {
  return puzzle.layout !== "singleScene" && puzzle.stem.length > 0;
}

export function questionCount(profile: ExpandedProfile): number {
  return EXPANDED_PROFILE_BANDS.reduce((total, band) => total + BAND_SCHEDULE[profile][band], 0);
}

export interface EligibleFamily {
  familyId: string;
  primaryReasoningFamily: string;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  /** Difficulty the bucket promises, checked against the generated item. */
  difficulty: number;
}

/** Difficulty buckets are named `<family>-d<1..5>`; the suffix is the ramp input. */
function bucketDifficulty(bucket: string): number {
  const match = /-d([1-5])$/.exec(bucket);
  if (!match) throw new Error(`difficulty bucket "${bucket}" must end in -d1 through -d5`);
  return Number(match[1]);
}

/**
 * Families a band may draw from.
 *
 * Code-valid is enough to be served: since 2026-08-16 the human pilot is a
 * retention gate rather than an admission gate, and withdrawal happens through
 * the excluded-family list. A family is only ever offered in a band it is
 * registered for — assembly never remaps one into a different band.
 */
export function eligibleFamiliesForBand(
  registry: FamilyPromotionRegistry,
  band: ExpandedProfileBand,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): EligibleFamily[] {
  const eligible: EligibleFamily[] = [];
  for (const family of registry) {
    if (withdrawnFamilyIds.has(family.familyId)) continue;
    const promotion = family.bands.find((entry) => entry.band === band);
    if (!promotion || promotion.state === "prototype") continue;
    if (promotion.validatedDifficultyBuckets.length === 0) continue;
    // A family with several validated buckets in one band enters at its easiest.
    const bucket = [...promotion.validatedDifficultyBuckets]
      .sort((left, right) => bucketDifficulty(left) - bucketDifficulty(right) || left.localeCompare(right))[0];
    eligible.push({
      familyId: family.familyId,
      primaryReasoningFamily: family.primaryReasoningFamily,
      band,
      difficultyBucket: bucket,
      difficulty: bucketDifficulty(bucket),
    });
  }
  return eligible.sort((left, right) => left.familyId.localeCompare(right.familyId));
}

/**
 * Split a band's questions as evenly as its pool allows.
 *
 * With `count` questions and `k` families every chosen family appears either
 * `floor(count / k)` or `ceil(count / k)` times. That one rule sets both the
 * repeat cap and the distinct-family count, and it keeps holding when a
 * withdrawal shrinks the pool.
 */
function evenSplit(
  count: number,
  families: readonly EligibleFamily[],
  rng: Rng,
): Map<string, number> {
  const base = Math.floor(count / families.length);
  const extra = count % families.length;
  const order = shuffled(rng, families.map((family) => family.familyId));
  const counts = new Map<string, number>();
  for (const familyId of families.map((family) => family.familyId)) {
    counts.set(familyId, base);
  }
  for (const familyId of order.slice(0, extra)) {
    counts.set(familyId, (counts.get(familyId) ?? 0) + 1);
  }
  for (const [familyId, value] of [...counts]) {
    if (value === 0) counts.delete(familyId);
  }
  return counts;
}

function totalRemaining(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of counts.values()) total += value;
  return total;
}

/**
 * Can what is left still be laid out without two neighbours sharing a family?
 *
 * With `total` questions left and `previous` already placed, a family may fill
 * at most every other position — one fewer when it is the family just placed,
 * because it cannot take the next position.
 */
function arrangeable(counts: ReadonlyMap<string, number>, previousFamilyId: string | undefined): boolean {
  const total = totalRemaining(counts);
  if (total === 0) return true;
  for (const [familyId, value] of counts) {
    const limit = familyId === previousFamilyId ? Math.floor(total / 2) : Math.ceil(total / 2);
    if (value > limit) return false;
  }
  return true;
}

/**
 * Order one band: easiest bucket first, never repeating a family back to back.
 *
 * At each position it takes the lowest-difficulty family that still leaves the
 * rest of the band arrangeable. Where those two goals collide — a band ending
 * in two questions from the only family at its top difficulty — the repeat rule
 * wins and one harder question moves earlier. That costs at most a question or
 * two of the ramp and never lets the same family run twice.
 */
function arrangeBand(
  counts: Map<string, number>,
  byFamilyId: ReadonlyMap<string, EligibleFamily>,
  previousFamilyId: string | undefined,
  rng: Rng,
): EligibleFamily[] {
  const tieBreak = new Map(shuffled(rng, [...counts.keys()]).map((familyId, index) => [familyId, index]));
  const remaining = new Map(counts);
  const arranged: EligibleFamily[] = [];
  let previous = previousFamilyId;

  while (totalRemaining(remaining) > 0) {
    const candidates = [...remaining.keys()]
      .filter((familyId) => familyId !== previous)
      .sort((left, right) =>
        byFamilyId.get(left)!.difficulty - byFamilyId.get(right)!.difficulty ||
        remaining.get(right)! - remaining.get(left)! ||
        tieBreak.get(left)! - tieBreak.get(right)!);

    const chosen = candidates.find((familyId) => {
      const value = remaining.get(familyId)!;
      if (value === 1) remaining.delete(familyId);
      else remaining.set(familyId, value - 1);
      const ok = arrangeable(remaining, familyId);
      remaining.set(familyId, value);
      return ok;
    });
    if (chosen === undefined) {
      throw new Error("expanded quiz cannot order a band without repeating a family");
    }

    const value = remaining.get(chosen)!;
    if (value === 1) remaining.delete(chosen);
    else remaining.set(chosen, value - 1);
    arranged.push(byFamilyId.get(chosen)!);
    previous = chosen;
  }
  return arranged;
}

function programDepth(band: ExpandedProfileBand): number {
  return band === "warmup" ? 1 : band === "composition" ? 2 : 3;
}

/**
 * A public item id that cannot be turned back into the seed.
 *
 * The previous scheme embedded the first 28 characters of the 32-character seed
 * directly in the id, so anyone holding a served puzzle could brute-force the
 * remaining four hex digits, regenerate the quiz, and read every answer. That
 * defeats the answer-free public contract, which is the point of serving the
 * puzzle without `answerIndex`, `rule`, or `explanation` at all.
 *
 * The id is now a keyed hash of the seed and slot: still deterministic (the
 * same seed replays the same ids) and still unique within a test, but one-way.
 * The real seed stays inside the sealed server token.
 */
function runtimePuzzleId(seed: Seed, slotIndex: number, familyId: string): string {
  const digest = createHash("sha256")
    .update(`aiq.public-item-id.v1\u0000${String(seed)}\u0000${slotIndex}`)
    .digest("hex")
    .slice(0, 16);
  return `expanded-${digest}-${slotIndex + 1}-${familyId}`;
}

function visibleFingerprint(puzzle: Puzzle<Scene>): string {
  return createHash("sha256").update(JSON.stringify({
    type: puzzle.type,
    layout: puzzle.layout,
    stem: puzzle.stem,
    options: puzzle.options,
  })).digest("hex");
}

function drawnFamiliesForBand(
  families: readonly EligibleFamily[],
  band: ExpandedProfileBand,
  rng: Rng,
): EligibleFamily[] {
  const requested = FAMILY_SUBSAMPLE_SIZES[band];
  if (requested === undefined) return [...families];
  return shuffled(rng, families).slice(0, Math.min(requested, families.length));
}

/** Choose every family for the whole test before any item is generated. */
export function planExpandedSchedule(
  seed: Seed,
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): EligibleFamily[] {
  const schedule: EligibleFamily[] = [];
  for (const band of EXPANDED_PROFILE_BANDS) {
    const count = BAND_SCHEDULE[profile][band];
    if (count === 0) continue;
    const families = eligibleFamiliesForBand(registry, band, withdrawnFamilyIds);
    const minimum = MINIMUM_ELIGIBLE_FAMILIES[profile][band];
    if (families.length < minimum) {
      throw new Error(
        `the ${profile} test needs at least ${minimum} eligible ${band} families but has ${families.length}`,
      );
    }
    const drawn = drawnFamiliesForBand(
      families,
      band,
      seededRng(seed, `expanded-family-pool:${profile}:${band}`),
    );
    const byFamilyId = new Map(drawn.map((family) => [family.familyId, family]));
    const counts = evenSplit(count, drawn, seededRng(seed, `expanded-split:${profile}:${band}`));
    schedule.push(...arrangeBand(
      counts,
      byFamilyId,
      schedule.at(-1)?.familyId,
      seededRng(seed, `expanded-order:${profile}:${band}`),
    ));
  }

  const distinct = new Set(schedule.map((entry) => entry.familyId)).size;
  const minimumDistinct = MINIMUM_DISTINCT_FAMILIES[profile];
  if (distinct < minimumDistinct) {
    throw new Error(`the ${profile} test needs at least ${minimumDistinct} distinct families but has ${distinct}`);
  }
  return schedule;
}

/**
 * Refuse to start when the withdrawal list has emptied out a band.
 *
 * Called once at server start. Pulling one confusing family is routine; pulling
 * enough of them that the long test can no longer be built is a different
 * event, and it must be visible immediately rather than discovered by the first
 * person who presses start.
 */
export function assertProfilesRemainBuildable(
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string>,
): void {
  const shortfalls: string[] = [];
  for (const profile of EXPANDED_PROFILES) {
    for (const band of EXPANDED_PROFILE_BANDS) {
      const available = eligibleFamiliesForBand(registry, band, withdrawnFamilyIds).length;
      const minimum = MINIMUM_ELIGIBLE_FAMILIES[profile][band];
      if (available < minimum) {
        shortfalls.push(`${profile} needs ${minimum} ${band} families but only ${available} remain`);
      }
    }
  }
  if (shortfalls.length > 0) {
    throw new Error(
      `WITHDRAWN_FAMILY_IDS has left the test unbuildable: ${shortfalls.join("; ")}. ` +
        "Put a family back, or add a new one for the short band.",
    );
  }
}

/**
 * Assemble one public test of the requested length.
 *
 * Pure: the same seed, profile, registry, and withdrawal list reproduce the
 * same items, family order, and option order on any machine. Every slot has its
 * own child seed, so one family's retries never perturb a later question.
 */
export function assembleExpandedQuiz(
  seed: Seed,
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): PuzzleSet<Visual> {
  if (String(seed).length === 0) throw new Error("seed must not be empty");
  const schedule = planExpandedSchedule(seed, profile, registry, withdrawnFamilyIds);

  const puzzles: Puzzle<Scene>[] = [];
  // A program fingerprint names a family's rule structure, not one instance, so
  // it cannot be unique across a 30-question test that reuses families. What
  // must be unique is the visible puzzle: no two questions may look the same.
  const visibleFingerprints = new Set<string>();

  for (const [slotIndex, selected] of schedule.entries()) {
    const familyId = selected.familyId as SceneFamilyId;
    const rejections: string[] = [];
    let accepted: Puzzle<Scene> | undefined;
    let acceptedVisible = "";

    for (let attempt = 0; attempt < RETRY_BUDGET && !accepted; attempt++) {
      // A family can refuse a draw outright — for instance when the rule it
      // sampled cannot produce enough near misses to fill the option list. That
      // is a rejected attempt like any other, not a failed test: the next
      // attempt has its own child seed and usually succeeds.
      let generated;
      try {
        generated = generateSceneFamilyCandidate(
          familyId,
          seededRng(seed, `expanded-scene-slot:${profile}:${slotIndex}:${attempt}:${familyId}`),
        );
      } catch (error) {
        rejections.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      const puzzle: Puzzle<Scene> = {
        ...generated.puzzle,
        id: runtimePuzzleId(seed, slotIndex, familyId),
        band: selected.band,
        generation: {
          generatorVersion: EXPANDED_GENERATOR_VERSION,
          familyId,
          programFingerprint: generated.definition.programFingerprint!(generated.puzzle),
          featureBucket: selected.difficultyBucket,
          features: {
            difficulty: generated.puzzle.difficulty,
            ruleComplexity: generated.puzzle.difficulty,
            programDepth: programDepth(selected.band),
            activeDimensions: [],
            usesWrap: false,
            distractorStrategy: "near-miss",
          },
        },
      };

      const acceptance = validateSceneFamilyCandidate({ ...generated, puzzle });
      if (!acceptance.accepted) {
        rejections.push(acceptance.issues.map((issue) => issue.message).join("; "));
        continue;
      }
      if (puzzle.difficulty !== selected.difficulty) {
        rejections.push(
          `difficulty ${puzzle.difficulty} does not match bucket ${selected.difficultyBucket}`,
        );
        continue;
      }
      const visiblePanels = puzzle.stem.filter((panel) => !("blank" in panel)).length;
      if (needsWorkedExamples(puzzle) && visiblePanels < MINIMUM_VISIBLE_STEM_PANELS) {
        rejections.push(`only ${visiblePanels} visible stem panels`);
        continue;
      }
      const visible = visibleFingerprint(puzzle);
      if (visibleFingerprints.has(visible)) {
        rejections.push("duplicate visible puzzle");
        continue;
      }
      accepted = puzzle;
      acceptedVisible = visible;
    }

    if (!accepted) {
      throw new Error(
        `${familyId} could not fill slot ${slotIndex + 1} of the ${profile} test after ` +
          `${RETRY_BUDGET} attempts: ${rejections.join(" | ")}`,
      );
    }
    visibleFingerprints.add(acceptedVisible);
    puzzles.push(accepted);
  }

  return VisualPuzzleSetSchema.parse(puzzles) as PuzzleSet<Visual>;
}
