import { createHash } from "node:crypto";
import { seededRng, shuffled, type Seed } from "../lib/rng";
import {
  EXPANDED_PROFILE_BANDS,
  type ExpandedProfileBand,
  type FamilyPromotionRegistry,
} from "./family-promotion";
import {
  generateSceneFamilyCandidate,
  requireSceneFamilyBucket,
  SCENE_FAMILY_IDS,
  sceneFamilyBucketsFor,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import {
  PuzzleSchema,
  PuzzleSetSchema,
  type Puzzle,
  type PuzzleSet,
} from "./schema";

/**
 * Generation semantics for the two public test lengths.
 *
 * Bump this whenever the difficulty schedule, the family pool rule, the ordering
 * rule, or any family's item semantics change: results recorded under two
 * versions are different populations and must never be pooled. What each
 * version changed is in docs/plans/history.md.
 */
export const EXPANDED_GENERATOR_VERSION = "scene-families-v39" as const;

export const EXPANDED_PROFILES = ["short-5", "long-30"] as const;
export type ExpandedProfile = (typeof EXPANDED_PROFILES)[number];

/** Fixed difficulty for each question number; independent of the seed and family. */
export const SLOT_DIFFICULTIES: Readonly<Record<ExpandedProfile, readonly number[]>> = {
  "short-5": [2, 3, 4, 4, 5],
  "long-30": [
    2, 2, 2, 2, 2,
    3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5, 5, 5,
  ],
};

/** Long tests cover every enabled family; short tests use five different families. */
export const MINIMUM_DISTINCT_FAMILIES: Readonly<Record<ExpandedProfile, number>> = {
  "long-30": 10,
  "short-5": 5,
};

/** Bound repetition and the number of reference items one family can consume. */
export const MAXIMUM_FAMILY_QUESTIONS: Readonly<Record<ExpandedProfile, number>> = {
  "long-30": 5,
  "short-5": 1,
};

/**
 * Families held below `MAXIMUM_FAMILY_QUESTIONS` (owner, 2026-10-15): the
 * growing-jump ring sequence reads as easy and repetitive, so at most two a test.
 */
export const FAMILY_QUESTION_LIMITS: Readonly<Record<string, number>> = {
  "second-order-sequence-v2": 2,
};

/**
 * Families whose questions ramp up through a 30-question test (owner,
 * 2026-10-15): each fills at least one slot at every level it serves. Machine
 * tables go from one gate early (level 2) to two mid-test (level 4) and three
 * at the end (level 5), instead of appearing only at the end.
 */
export const RAMPED_FAMILIES: readonly string[] = ["composed-transform-v2"];

/** The most questions one family may fill in one test of this length. */
export function familyQuestionLimit(profile: ExpandedProfile, familyId: string): number {
  return Math.min(MAXIMUM_FAMILY_QUESTIONS[profile], FAMILY_QUESTION_LIMITS[familyId] ?? Infinity);
}

/**
 * Seeds used to read a family's layout off a generated question.
 *
 * A family may refuse a draw, so several seeds are tried; the layout is a
 * structural constant of the family, so the first accepted draw settles it.
 */
const LAYOUT_PROBE_SEED = "aiq.family-layout-probe.v1";
const LAYOUT_PROBE_ATTEMPTS = 8;

/** familyId -> layout of a generated question, or null when nothing generated. */
const layoutProbeCache = new Map<string, string | null>();

/**
 * The layout a family's questions actually use, read off a generated stem.
 *
 * Deliberately not a hand-maintained list of family names. Whether an item
 * reads as an analogy is a property of the stem the generator builds — three
 * panels shown as `A : B :: C : ?` — and several families that present that
 * way are not called "analogy" anything (`spatial-transform-v2`), while
 * `compositional-analogy-v2` is named for its reasoning rather than its shape.
 * Probing the generator
 * means a family added tomorrow is classified by what it draws, with no list
 * to remember to update.
 *
 * The probe runs once per family per process and is memoised: it costs about
 * a tenth of a second for the whole registry, and only the first schedule of
 * a process pays it. A family id the scene generator does not know — the
 * synthetic registries used in tests — has no layout and is treated as not an
 * analogy, which leaves the format cap inactive rather than guessing.
 */
export function sceneFamilyLayout(familyId: string): string | null {
  const cached = layoutProbeCache.get(familyId);
  if (cached !== undefined) return cached;

  let layout: string | null = null;
  if ((SCENE_FAMILY_IDS as readonly string[]).includes(familyId)) {
    const entry = sceneFamilyBucketsFor(familyId as SceneFamilyId)[0];
    for (let attempt = 0; attempt < LAYOUT_PROBE_ATTEMPTS && layout === null; attempt++) {
      try {
        layout = generateSceneFamilyCandidate(
          familyId as SceneFamilyId,
          seededRng(LAYOUT_PROBE_SEED, `${familyId}:${attempt}`),
          entry.bucket,
        ).puzzle.layout;
      } catch {
        // A refused draw says nothing about the layout; try the next seed.
      }
    }
  }
  layoutProbeCache.set(familyId, layout);
  return layout;
}

/** Does this family present its question as `A : B :: C : ?`? */
export function isAnalogyLayoutFamily(familyId: string): boolean {
  return sceneFamilyLayout(familyId) === "analogy";
}

/** Attempts per slot before assembly gives up. Each attempt has its own child seed. */
export const EXPANDED_SLOT_RETRY_BUDGET = 4;

/**
 * Every served item must show at least this many visible panels.
 *
 * This is what makes an item a reasoning question rather than a guess: the
 * panels demonstrate the rule, and the options ask for it applied. A single
 * board with six variations of itself shows nothing to infer from — the solver
 * has to guess which property matters. The owner ruled such items out on
 * 2026-08-23, and the single-board and empty-stem layouts have since left the
 * schema.
 */
const MINIMUM_VISIBLE_STEM_PANELS = 2;

export function questionCount(profile: ExpandedProfile): number {
  return SLOT_DIFFICULTIES[profile].length;
}

/**
 * One question's family and the exact bucket that question is drawn at.
 *
 * The question number determines difficulty. A family can fill it only through
 * a bucket validated at that exact level.
 */
export interface EligibleFamily {
  familyId: string;
  primaryReasoningFamily: string;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  /** Difficulty the bucket promises, checked against the generated item. */
  difficulty: number;
  /**
   * Every bucket this family has validated for this band, easiest first.
   * The difficulty pool selects the matching bucket before scheduling a question.
   */
  bandBuckets: readonly { bucket: string; difficulty: number }[];
}

/**
 * Difficulty buckets are named `<family>-d<1..6>`; the suffix is the ramp input.
 *
 * The ceiling moved from 5 to 6 on 2026-08-26 (raise-the-ceiling-v12) so the
 * `-d6` buckets at the tail of `induction-transfer` parse at all. It is the
 * same widening the puzzle schema took; see `MAXIMUM_DIFFICULTY` in schema.ts
 * for why the ladder needed another rung.
 */
export function bucketDifficulty(bucket: string): number {
  const match = /-d([1-6])$/.exec(bucket);
  if (!match) throw new Error(`difficulty bucket "${bucket}" must end in -d1 through -d6`);
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
    // Keep every validated level; question slots choose the exact matching one.
    const bandBuckets = [...promotion.validatedDifficultyBuckets]
      .map((bucket) => ({ bucket, difficulty: bucketDifficulty(bucket) }))
      .sort((left, right) => left.difficulty - right.difficulty || left.bucket.localeCompare(right.bucket));
    eligible.push({
      familyId: family.familyId,
      primaryReasoningFamily: family.primaryReasoningFamily,
      band,
      difficultyBucket: bandBuckets[0].bucket,
      difficulty: bandBuckets[0].difficulty,
      bandBuckets,
    });
  }
  return eligible.sort((left, right) => left.familyId.localeCompare(right.familyId));
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
 * The id is now a one-way hash of the seed and slot: still deterministic (the
 * same seed replays the same ids) and still unique within a test. The seed
 * itself is never served, sealed into the token, or stored; it exists only
 * during the request that assembles the test.
 */
function runtimePuzzleId(seed: Seed, slotIndex: number): string {
  const digest = createHash("sha256")
    .update(`aiq.public-item-id.v1\u0000${String(seed)}\u0000${slotIndex}`)
    .digest("hex")
    .slice(0, 16);
  // No family name: the id is served before scoring, and the family is one of
  // the hints the public payload deliberately leaves out.
  return `expanded-${digest}-${slotIndex + 1}`;
}

/**
 * What makes two questions the same question: what the taker is ASKED — the
 * item type, its layout, and the panels of its stem.
 *
 * The options are deliberately left out. Until 2026-09-28 they were hashed in,
 * in served order, so the same stem offered with different near misses (or the
 * same near misses in another order) counted as a new question, and about 3% of
 * long tests asked one question twice.
 */
export function questionFingerprint(puzzle: { type: string; layout: string; stem: readonly unknown[] }): string {
  return createHash("sha256").update(JSON.stringify({
    type: puzzle.type,
    layout: puzzle.layout,
    stem: puzzle.stem,
  })).digest("hex");
}

/** Every validated family/band/bucket that can fill this exact difficulty. */
export function eligibleFamiliesForDifficulty(
  registry: FamilyPromotionRegistry,
  difficulty: number,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): EligibleFamily[] {
  return EXPANDED_PROFILE_BANDS.flatMap((band) =>
    eligibleFamiliesForBand(registry, band, withdrawnFamilyIds).flatMap((family) =>
      family.bandBuckets.filter((bucket) => bucket.difficulty === difficulty)
        .map((bucket) => ({ ...family, difficultyBucket: bucket.bucket, difficulty }))));
}

/** Upper bound on distinct families, matching fixed difficulty slots to eligible families. */
export function maximumDistinctFamilies(
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): number {
  const places = SLOT_DIFFICULTIES[profile].map((difficulty) =>
    [...new Set(eligibleFamiliesForDifficulty(registry, difficulty, withdrawnFamilyIds)
      .map((family) => family.familyId))]);
  const placeOf = new Map<string, number>();
  const assign = (place: number, visited: Set<string>): boolean => {
    for (const familyId of places[place]) {
      if (visited.has(familyId)) continue;
      visited.add(familyId);
      const holder = placeOf.get(familyId);
      if (holder === undefined || assign(holder, visited)) {
        placeOf.set(familyId, place);
        return true;
      }
    }
    return false;
  };
  return places.reduce((matched, _, place) => matched + Number(assign(place, new Set())), 0);
}

/**
 * Choose a family independently for each fixed difficulty slot, with seeded backtracking.
 * Band tags describe questions; they never reserve positions or numbers of questions.
 * Each slot shuffles family ids first, so a family offered in two bands receives one chance.
 * Coverage and repetition checks reject impossible completions without changing difficulty.
 */
export function planExpandedSchedule(
  seed: Seed,
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): EligibleFamily[] {
  const difficulties = SLOT_DIFFICULTIES[profile];
  const pool = new Map([...new Set(difficulties)].map((difficulty) => [
    difficulty, eligibleFamiliesForDifficulty(registry, difficulty, withdrawnFamilyIds),
  ]));
  for (const [difficulty, families] of pool) {
    const distinct = new Set(families.map((family) => family.familyId)).size;
    const needed = difficulties.filter((value) => value === difficulty).length > 1 ? 2 : 1;
    if (distinct < needed) {
      throw new Error(`the ${profile} test needs at least ${needed} eligible d${difficulty} families but has ${distinct}`);
    }
  }
  const eligibleIds = [...new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
    eligibleFamiliesForBand(registry, band, withdrawnFamilyIds).map((family) => family.familyId)))].sort();
  const requiredDistinct = profile === "long-30"
    ? Math.max(MINIMUM_DISTINCT_FAMILIES[profile], eligibleIds.length)
    : MINIMUM_DISTINCT_FAMILIES[profile];
  const maximumDistinct = maximumDistinctFamilies(profile, registry, withdrawnFamilyIds);
  if (maximumDistinct < requiredDistinct) {
    throw new Error(`the ${profile} test needs at least ${requiredDistinct} distinct families but has ${maximumDistinct}`);
  }
  const candidates = difficulties.map((difficulty, index) => {
    const byFamily = new Map<string, EligibleFamily[]>();
    for (const family of pool.get(difficulty)!) {
      const variants = byFamily.get(family.familyId) ?? [];
      variants.push(family);
      byFamily.set(family.familyId, variants);
    }
    return shuffled(seededRng(seed, `expanded-slot-family:${profile}:${index}`), [...byFamily.keys()])
      .map((familyId) => shuffled(
        seededRng(seed, `expanded-slot-bucket:${profile}:${index}:${familyId}`), byFamily.get(familyId)!,
      )[0]);
  });
  const lastSlot = new Map<string, number>();
  candidates.forEach((choices, index) => choices.forEach((choice) => lastSlot.set(choice.familyId, index)));
  const suffixCounts = difficulties.map((_, index) => {
    const counts = new Map<number, number>();
    for (const difficulty of difficulties.slice(index)) counts.set(difficulty, (counts.get(difficulty) ?? 0) + 1);
    return counts;
  });
  const idsByDifficulty = new Map([...pool].map(([difficulty, choices]) =>
    [difficulty, [...new Set(choices.map((choice) => choice.familyId))]]));
  const counts = new Map<string, number>();
  const refused = new Set<string>();
  // Each ramped family at each level it serves: one slot there is required.
  const ramp = profile === "long-30"
    ? RAMPED_FAMILIES.flatMap((familyId) => [...pool]
      .filter(([, families]) => families.some((family) => family.familyId === familyId))
      .map(([difficulty]) => ({ key: `${familyId}@${difficulty}`, difficulty })))
    : [];
  const rampFilled = new Map<string, number>();
  const rampMissing = () => ramp.filter(({ key }) => !rampFilled.get(key));
  const complete = (index: number, previous?: string): EligibleFamily[] | null => {
    if (index === difficulties.length) {
      return counts.size >= requiredDistinct && rampMissing().length === 0 ? [] : null;
    }
    if (requiredDistinct - counts.size > difficulties.length - index) return null;
    if (rampMissing().some(({ difficulty }) => !suffixCounts[index].get(difficulty))) return null;
    if (profile === "long-30" && eligibleIds.some((id) => !counts.has(id) && (lastSlot.get(id) ?? -1) < index)) {
      return null;
    }
    // A tier must fit within the remaining family capacities while alternating.
    // Check before branching, including a family's uses at earlier levels.
    for (const [difficulty, needed] of suffixCounts[index]) {
      const capacity = idsByDifficulty.get(difficulty)!.reduce((total, id) => {
        const alternating = difficulty === difficulties[index] && id === previous
          ? Math.floor(needed / 2) : Math.ceil(needed / 2);
        return total + Math.min(familyQuestionLimit(profile, id) - (counts.get(id) ?? 0), alternating);
      }, 0);
      if (capacity < needed) return null;
    }
    if (profile === "long-30") {
      for (const end of new Set(lastSlot.values())) {
        if (end < index) continue;
        const unseen = eligibleIds.filter((id) => !counts.has(id) && lastSlot.get(id)! <= end).length;
        if (unseen > end - index + 1) return null;
      }
    }
    const state = `${index}|${previous ?? ""}|${eligibleIds.map((id) => counts.get(id) ?? 0).join(",")}|` +
      ramp.map(({ key }) => (rampFilled.get(key) ? 1 : 0)).join("");
    if (refused.has(state)) return null;
    for (const choice of candidates[index]) {
      const count = counts.get(choice.familyId) ?? 0;
      if (choice.familyId === previous || count >= familyQuestionLimit(profile, choice.familyId)) continue;
      counts.set(choice.familyId, count + 1);
      const rampKey = `${choice.familyId}@${difficulties[index]}`;
      rampFilled.set(rampKey, (rampFilled.get(rampKey) ?? 0) + 1);
      const tail = complete(index + 1, choice.familyId);
      rampFilled.set(rampKey, rampFilled.get(rampKey)! - 1);
      if (count === 0) counts.delete(choice.familyId);
      else counts.set(choice.familyId, count);
      if (tail) return [choice, ...tail];
    }
    refused.add(state);
    return null;
  };
  const schedule = complete(0);
  if (!schedule) {
    throw new Error(`the ${profile} test cannot fill its fixed difficulty slots without losing family coverage or repeating a family`);
  }
  return schedule;
}

/** Refuse unavailable fixed difficulty profiles before serving any test. */
export function assertProfilesRemainBuildable(
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string>,
): void {
  for (const profile of EXPANDED_PROFILES) {
    try {
      planExpandedSchedule("aiq.buildability-probe.v2", profile, registry, withdrawnFamilyIds);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `WITHDRAWN_FAMILY_IDS has left the test unbuildable: ${reason}. ` +
        "Put a family back, or add one at the missing difficulty.",
      );
    }
  }
}

/** One attempt at filling one slot: the item the assembler would serve, or why not. */
export type ExpandedSlotDraw =
  | { accepted: true; puzzle: Puzzle }
  | { accepted: false; rejection: string };

/**
 * Draw one scheduled slot once, through every check the assembler applies to a
 * single item.
 *
 * Exported so the per-bucket acceptance sweep in the tests measures the very
 * path a real test takes. The one check left to the caller is that no two
 * questions in a test are the same (`questionFingerprint`), because only the
 * caller knows what else the test holds.
 */
export function drawExpandedSlot(
  seed: Seed,
  profile: ExpandedProfile,
  slotIndex: number,
  attempt: number,
  selected: EligibleFamily,
): ExpandedSlotDraw {
  const familyId = selected.familyId as SceneFamilyId;
  // Program depth is a property of the bucket, not of the band. Reading it
  // here also proves the registry and the generator agree about this bucket
  // before anything is drawn: a registry that enables a bucket the family does
  // not declare fails the whole assembly rather than serving an item labelled
  // with a depth nobody produced.
  const declaredBucket = requireSceneFamilyBucket(familyId, selected.difficultyBucket);
  // A family can refuse a draw outright — for instance when the rule it sampled
  // cannot produce enough near misses to fill the option list. That is a
  // rejected attempt like any other, not a failed test: the next attempt has
  // its own child seed and usually succeeds.
  let generated;
  try {
    generated = generateSceneFamilyCandidate(
      familyId,
      seededRng(seed, `expanded-scene-slot:${profile}:${slotIndex}:${attempt}:${familyId}`),
      declaredBucket.bucket,
    );
  } catch (error) {
    return { accepted: false, rejection: error instanceof Error ? error.message : String(error) };
  }
  const puzzle: Puzzle = {
    ...generated.puzzle,
    id: runtimePuzzleId(seed, slotIndex),
    band: selected.band,
    generation: {
      generatorVersion: EXPANDED_GENERATOR_VERSION,
      familyId,
      programFingerprint: generated.definition.programFingerprint!(generated.puzzle),
      featureBucket: selected.difficultyBucket,
      features: {
        difficulty: generated.puzzle.difficulty,
        ruleComplexity: generated.puzzle.difficulty,
        programDepth: declaredBucket.programDepth,
        activeDimensions: [],
        usesWrap: false,
        distractorStrategy: "near-miss",
      },
    },
  };

  const acceptance = validateSceneFamilyCandidate({ ...generated, puzzle });
  if (!acceptance.accepted) {
    return { accepted: false, rejection: acceptance.issues.map((issue) => issue.message).join("; ") };
  }
  if (puzzle.difficulty !== selected.difficulty) {
    return {
      accepted: false,
      rejection: `difficulty ${puzzle.difficulty} does not match bucket ${selected.difficultyBucket}`,
    };
  }
  const visiblePanels = puzzle.stem.filter((panel) => !("blank" in panel)).length;
  if (visiblePanels < MINIMUM_VISIBLE_STEM_PANELS) {
    return { accepted: false, rejection: `only ${visiblePanels} visible stem panels` };
  }
  return { accepted: true, puzzle };
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
): PuzzleSet {
  return assembleExpandedTest(seed, profile, registry, withdrawnFamilyIds).puzzles;
}

/** A test, and for each question the attempt its slot kept: enough to rebuild any one question alone. */
export interface AssembledTest {
  puzzles: PuzzleSet;
  attempts: number[];
}

/** `assembleExpandedQuiz`, also saying which attempt filled each slot. */
export function assembleExpandedTest(
  seed: Seed,
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): AssembledTest {
  if (String(seed).length === 0) throw new Error("seed must not be empty");
  const schedule = planExpandedSchedule(seed, profile, registry, withdrawnFamilyIds);

  const puzzles: Puzzle[] = [];
  const attempts: number[] = [];
  // A program fingerprint names a family's rule structure, not one instance, so
  // it cannot be unique across a 30-question test that reuses families. What
  // must be unique is the question: no two may ask the same thing.
  const askedQuestions = new Set<string>();

  for (const [slotIndex, selected] of schedule.entries()) {
    const rejections: string[] = [];
    let accepted: Puzzle | undefined;
    let acceptedQuestion = "";
    let acceptedAttempt = -1;

    for (let attempt = 0; attempt < EXPANDED_SLOT_RETRY_BUDGET && !accepted; attempt++) {
      const draw = drawExpandedSlot(seed, profile, slotIndex, attempt, selected);
      if (!draw.accepted) {
        rejections.push(draw.rejection);
        continue;
      }
      const question = questionFingerprint(draw.puzzle);
      if (askedQuestions.has(question)) {
        rejections.push("repeats a question this test already asks");
        continue;
      }
      accepted = draw.puzzle;
      acceptedQuestion = question;
      acceptedAttempt = attempt;
    }

    if (!accepted) {
      throw new Error(
        `${selected.familyId} could not fill slot ${slotIndex + 1} of the ${profile} test after ` +
          `${EXPANDED_SLOT_RETRY_BUDGET} attempts: ${rejections.join(" | ")}`,
      );
    }
    askedQuestions.add(acceptedQuestion);
    puzzles.push(accepted);
    attempts.push(acceptedAttempt);
  }

  return { puzzles: PuzzleSetSchema.parse(puzzles) as PuzzleSet, attempts };
}

/**
 * Rebuild one question of a test without the others, from the attempt its slot
 * kept (`assembleExpandedTest`). It is the very item the whole test holds: each
 * slot draws from its own child seed, and the attempt already records the one
 * thing that depends on earlier questions, which draws repeated one of them.
 */
export function buildExpandedQuestion(
  seed: Seed,
  profile: ExpandedProfile,
  slotIndex: number,
  attempt: number,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): Puzzle {
  if (String(seed).length === 0) throw new Error("seed must not be empty");
  const selected = planExpandedSchedule(seed, profile, registry, withdrawnFamilyIds)[slotIndex];
  if (!selected) throw new Error(`the ${profile} test has no question ${slotIndex + 1}`);
  const draw = drawExpandedSlot(seed, profile, slotIndex, attempt, selected);
  if (!draw.accepted) {
    throw new Error(`attempt ${attempt} does not fill slot ${slotIndex + 1} of the ${profile} test: ${draw.rejection}`);
  }
  return PuzzleSchema.parse(draw.puzzle) as Puzzle;
}
