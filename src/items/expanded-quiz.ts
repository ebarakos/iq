import { createHash } from "node:crypto";
import { seededRng, shuffled, type Rng, type Seed } from "../lib/rng";
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
 * are not comparable and must never be pooled. `v7` withdraws the four families
 * the first human pilot ruled out, so its family pool is smaller than `v6`'s.
 * `v8` withdraws `interleaved-sequence-v2` (one observed transition is not
 * evidence a step repeats), shrinking the pool again — attempts recorded under
 * `v7` and `v8` are different populations and must never be pooled. `v9`
 * raises the ceiling: composed-transform grows to three ordered steps (as
 * `-v2`), the redesigned `interleaved-sequence-v3` and `relational-outlier-v3`
 * enter at their predecessors' positions, and `containment-analogy-v2` moves
 * down into constraint-spatial — a different pool and ladder than `v8`'s.
 * `v10` withdraws both redesigns after the 2026-08-24 full-battery pilot:
 * `relational-outlier-v3` failed it outright, and `interleaved-sequence-v3`
 * was answered correctly but with the notation misread, which the human gate
 * does not accept as proof of legibility.
 *
 * `v11` is the escalate-the-quiz batch, bumped once on 2026-08-25 after every
 * semantic change and registry entry was final, so no attempt or bank artifact
 * was ever recorded under a half-finished population. It changes what a
 * question is made of, in six ways. Difficulty buckets are now an INPUT to
 * generation rather than a label put on the output, so a bucket selects the
 * program the family draws; `fold-punch`, `visual-set-algebra`,
 * `compositional-analogy` and `composed-transform` each gained a deeper bucket
 * on top of their existing one, and a family asked for twice in a band now
 * gets its deeper bucket the second time. Wrong answers are no longer sampled
 * uniformly: required contrasts are kept, then the remaining slots are filled
 * from the closest candidates by scene edit distance, so every option is a
 * near miss. Composed transforms grew a four-gate form and admit token turns,
 * and every displayed gate is now proved load-bearing — a program whose answer
 * survives deleting any one gate is not servable — with the deep half of that
 * grammar held out of public tests entirely. `parallel-evolution-v1` joins the
 * composition band, three tokens on one board each following their own rule.
 * Band draws became format-aware: at most one analogy-layout family per draw,
 * chosen uniformly from the subsets that satisfy that and the cross-band rule
 * — which now yields for a family whose bucket only this band can serve, so a
 * long test can spend one of its distinct families on the four-gate machine
 * and its floor moved from twelve to eleven to pay for it.
 * And the family pools are the plan's fallback branch — six composition, four
 * constraint-spatial, four induction-transfer, twenty enabled family/band/bucket
 * keys — because the `dual-constraint-matrix-v1` necessity proof failed and
 * that family was never added. Every one of those changes moves what a score
 * means, so `v10` and `v11` results are different populations and must never be
 * pooled. See docs/plans/escalate-the-quiz.md.
 *
 * `v12` is the raise-the-ceiling batch of 2026-08-26, bumped once for four
 * changes that all move what a score means. The difficulty range gained a sixth
 * rung, and two buckets sit on it: `composed-transform-d6` shows five ordered
 * gates and `transformation-machine-d6` demonstrates four. Both live in
 * `induction-transfer` because the long test is ordered easiest-first and that
 * band is last, so a deeper bucket anywhere else would still be answered before
 * the end. A band's leftover questions now go first to the families whose next
 * occurrence reaches a bucket their base share never would, which is what turns
 * "a long test usually ends on the hardest thing the battery has" into "always".
 * And `containment-analogy-v2` is withdrawn on the pilot's notation evidence,
 * which drops `constraint-spatial` from four families to three — exactly its
 * draw size, so that band no longer subsamples. `v11` and `v12` results are
 * different populations and must never be pooled. See
 * docs/plans/raise-the-ceiling-v12.md.
 *
 * `v13` is the owner's correction of 2026-08-27, one day after v12, and it
 * moves the population twice:
 *
 * - **Both d6 buckets are withdrawn.** The rule is now **never more than three
 *   gates**: a fourth or fifth adds procedure, not reasoning. The owner knew
 *   the mechanism instantly and answered the five-gate item wrong in under five
 *   seconds because applying it once more was boring. The ladder tops out at d5
 *   again, and the leftover-question rule from v12 stays but redirects nothing
 *   until some family holds two buckets in one band again.
 * - **`visual-set-algebra-v2` is rebuilt.** Its inputs were a fixed diagonal of
 *   two tokens that could never disagree, which the owner called toys. Boards
 *   are now three tokens drawn into four roles — shared, clashing, left-only,
 *   right-only — and the combining vocabulary went from four operations to
 *   eight, because a clash finally makes "which side wins" and "does identity
 *   count" real questions. `relational-matrix-v2` moves with it: it draws from
 *   the same widened operation set.
 *
 * The battery is 19 enabled family/band/bucket keys over pools of two warmup,
 * six composition, three constraint-spatial and four induction-transfer
 * families.
 *
 * `v14`, later the same day, changes what the WRONG options are in every
 * family at once. The owner reported that "using only one first inference you
 * can select the right answer without looking at the other rules", and it
 * measured true of every item in four buckets: the answer was the only board
 * with its footprint, so working out where the tokens go finished the item
 * without ever reading a shape or a fill. Distractor selection now takes, for
 * each aspect a solver can infer on its own — footprint, shapes, fills,
 * rotations, token count — the closest wrong option that AGREES with the answer
 * on it, before filling the remaining slots by closeness as before. Knowing one
 * aspect therefore no longer narrows six options to one. `relational-matrix-v2`
 * needed its inputs widened for the same reason `visual-set-algebra-v2` did a
 * few hours earlier: its four corner atoms were fixed, so two input boards
 * could never disagree and no wrong option could share the answer's footprint.
 *
 * Every family's option lists moved, so `v13` and `v14` are different
 * populations. Measured over 120 seeds a bucket, items solvable from a single
 * aspect fell from 13 buckets to 8, and the five multi-rule families that
 * carried the ladder — composed-transform, transformation-machine,
 * compositional-analogy, visual-set-algebra d5 and inverse-analogy — went to
 * zero.
 *
 * `v15` finishes that job in the four buckets `v14` left leaking, each at the
 * source of its near misses rather than in the shared selection:
 *
 * - **`relational-matrix-d4`** (88% of items decided by one aspect) gets three
 *   tokens per corner instead of two, so a shape has three possible homes and a
 *   wrong option can carry the answer's shapes in other cells; and a fourth
 *   witnessed mistake, combining the right rule with the wrong two boards of the
 *   grid, which is the commonest real error on a 3x3.
 * - **`spatial-transform-d2`** (64%) pairs every board move with an extra token
 *   turn, so the option list holds the board the solver gets by moving correctly
 *   and turning the tokens as well — the exact mix-up the family tests.
 * - **`rule-switching-d2`** (48%) adds the correct board carried one operation
 *   further, which keeps the answer's cells and changes only the fill.
 * - **`visual-set-algebra-d4`** (45%) redraws its inputs until the pool can
 *   cover every aspect, the way its `-d5` sibling already did for free through
 *   its third turning step.
 *
 * Every servable bucket that can hide its answer now does. Four cannot and are
 * not defects: `fold-punch` d4/d5, `inverse-fold-punch-d5` and
 * `second-order-sequence-d4` offer one token or one punched sheet at different
 * places, so an option agreeing on the footprint would BE the answer.
 *
 * `v15` also adds `combining-machine-v1`, the first family whose gates take TWO
 * boards — the owner asked for the set-algebra idea inside the gate machines,
 * and a machine row of (input, gate, output) cannot show a second operand, so it
 * ships with a new row shape where the gate glyph sits between its operands. It
 * is registered as a PROTOTYPE, not code-valid, so the assembler does not serve
 * it: no human has seen it. Its aspect gap was closed the same day — d4 to 0%
 * and d5 to 8%, from 63% and 90% — by giving the pool the two boards that sit
 * beside the answer: the clash read the wrong way round, and the exclusive token
 * kept from the wrong board.
 *
 * `v15` also DELETES the ten families that were carried in the registry but
 * served in no test: operator-induction-v1, containment-analogy-v2, both
 * relational-outliers, constraint-mosaic-v2, topology-path-v1,
 * concept-induction-v2, both interleaved-sequences and minimal-repair-v3. Each
 * had been withdrawn on evidence recorded in git and in data/pilot/README.md, so
 * the code carried nothing the history does not. The served battery is unchanged
 * at the same 19 keys as `v14`.
 *
 * `v16` withdraws both fold-and-punch families because their corner mirroring
 * is too easy to earn repeated slots in the battery. Constraint-spatial now
 * consists only of relational matrix and visual set algebra. The deep composed
 * transform no longer adds a separate order-demonstration row and then asks
 * for all three gates; it demonstrates A, B and C once, then asks for two of
 * those gates in a recombined order. Results from v15 and v16 are different
 * populations and must not be pooled.
 *
 * `v17` makes the transformation ladder literal. The intermediate composed
 * bucket demonstrates and applies two gates; the hard bucket demonstrates and
 * applies three, with varied order. The one-step rule-switching family moves
 * from the hard tail into warmup. Every composed worked row is now required by
 * its query, so v16 and v17 results must not be pooled.
 */
export const EXPANDED_GENERATOR_VERSION = "scene-families-v17" as const;

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
  "long-30": { warmup: 2, composition: 4, "constraint-spatial": 2, "induction-transfer": 2 },
  "short-5": { warmup: 1, composition: 1, "constraint-spatial": 2, "induction-transfer": 1 },
};

/**
 * How many different families one test must contain.
 *
 * A profile that cannot reach its floor fails loudly rather than serving a
 * repetitive test. The long profile has room for two family slots to repeat
 * across bands; the short profile has none:
 *
 * - long-30 draws 4 + 4 + 2 + 2 = 12 family slots, floor 10;
 * - short-5 draws 1 + 1 + 2 + 1 = 5, floor 5, which leaves it no room at all.
 *
 * The short test keeps zero slack on purpose: it has five questions and needs
 * five different mechanisms, so its cross-band rule never yields.
 */
export const MINIMUM_DISTINCT_FAMILIES: Readonly<Record<ExpandedProfile, number>> = {
  "long-30": 10,
  "short-5": 5,
};

/**
 * Non-warmup bands draw this many families for one test before their questions
 * are split and ordered. Warmup keeps its complete pool so every test still
 * begins with the full set of introductory mechanisms.
 *
 * Constraint-spatial draws both of its remaining families after fold-and-punch
 * was withdrawn in v16. Induction-transfer draws both of its hard, three-step
 * transformation families after the one-step switch moved to warmup in v17.
 */
export const FAMILY_SUBSAMPLE_SIZES: Readonly<
  Record<ExpandedProfileBand, number | undefined>
> = {
  warmup: undefined,
  composition: 4,
  "constraint-spatial": 2,
  "induction-transfer": 2,
};

/**
 * How many families drawn for one band may present their question as an
 * analogy — the `A : B :: C : ?` layout.
 *
 * Difficulty is meant to come from rule depth, but a test that asks the same
 * VISUAL QUESTION over and over stops measuring reasoning and starts measuring
 * familiarity with one presentation. Several servable families render as
 * analogies, so an unconstrained draw can overuse that layout. Capping the draw
 * is the plan's format-aware subsampling
 * (docs/plans/escalate-the-quiz.md, Phase 5: "Composition and constraint draws
 * contain at most one analogy-layout family").
 *
 * The cap is applied to every subsampled band, not only to the two the plan
 * names: those are simply the two bands whose pools make it bind today, and a
 * rule that reads off the pool rather than off a band list keeps holding when
 * the pools move.
 */
export const MAXIMUM_ANALOGY_LAYOUT_FAMILIES_PER_DRAW = 1;

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
const RETRY_BUDGET = 4;

/**
 * Worked-example layouts must show at least two visible scenes, so the rule is
 * read off a sequence rather than guessed from one unexplained panel.
 *
 * `singleScene` boards and the empty-stem outlier layout are exempt because
 * their evidence is not in the stem: an outlier item is read across its four
 * options, and a mosaic, path, or repair board is read as a whole.
 */
/**
 * Every served item must show at least this many visible panels.
 *
 * This is what makes an item a reasoning question rather than a guess: the
 * panels demonstrate the rule, and the options ask for it applied. A single
 * board with six variations of itself shows nothing to infer from — the solver
 * has to guess which property matters. `singleScene` and empty-stem layouts
 * were exempted here until 2026-08-23, when the user hit them in the pilot and
 * ruled them out; the exemption is gone rather than narrowed, so no future
 * family can reintroduce the shape.
 */
const MINIMUM_VISIBLE_STEM_PANELS = 2;

export function questionCount(profile: ExpandedProfile): number {
  return EXPANDED_PROFILE_BANDS.reduce((total, band) => total + BAND_SCHEDULE[profile][band], 0);
}

/**
 * One question's family and the exact bucket that question is drawn at.
 *
 * A family with several validated buckets in a band produces several different
 * slots, one per occurrence, so difficulty is fixed before anything is
 * generated and the band can be ordered by what each QUESTION is worth rather
 * than by what its family is worth on average.
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
   *
   * The band's i-th question from the family takes the i-th entry, clamping at
   * the last, so repetition inside a band gets harder instead of repeating one
   * difficulty. `difficultyBucket` above is always the first entry: it is what
   * a first occurrence uses, and what callers that only want the family's entry
   * point read.
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
    // A family with several validated buckets in one band enters at its easiest
    // and goes deeper on every later occurrence.
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
 * Split a band's questions as evenly as its pool allows, spending the leftover
 * questions where they buy a DEEPER question rather than a repeat.
 *
 * With `count` questions and `k` families every chosen family appears either
 * `floor(count / k)` or `ceil(count / k)` times. That one rule sets both the
 * repeat cap and the distinct-family count, and it keeps holding when a
 * withdrawal shrinks the pool.
 *
 * The `count % k` leftover questions used to go to families picked at random.
 * Since 2026-08-26 (raise-the-ceiling-v12) they go first to the families whose
 * next occurrence would serve a bucket the base share never reaches — a family
 * with `bandBuckets.length` buckets needs that many questions to show its
 * deepest one, and `bucketedSlots` below clamps anything past that. Ordering
 * inside each of the two groups is still the seeded shuffle, so the choice
 * stays random wherever it is free.
 *
 * Added on 2026-08-26 to make the d6 tail reachable instead of likely: a drawn
 * d6 family always got the second question its deeper bucket needed, which took
 * long tests ending on a d6 item from 8,289 in 10,000 to all 10,000.
 *
 * Both d6 buckets were withdrawn on 2026-08-27 under the owner's three-gate
 * rule, and that left every family in every band holding exactly one bucket
 * there — so this rule currently redirects nothing at all and the allocation is
 * the plain seeded shuffle it always was. It is kept rather than reverted
 * because the property stands on its own: when a family is asked twice in one
 * band, the second question should be a bucket nobody has been asked yet rather
 * than a rerun of the first. It starts working again the moment any family
 * holds two buckets in one band. A test walks every band of both lengths and
 * asserts that today no band qualifies, so the change surfaces there.
 */
export function evenSplit(
  count: number,
  families: readonly EligibleFamily[],
  rng: Rng,
): Map<string, number> {
  const base = Math.floor(count / families.length);
  const extra = count % families.length;
  const bucketCounts = new Map(families.map((family) => [family.familyId, family.bandBuckets.length]));
  const reachesANewBucket = (familyId: string) => base < (bucketCounts.get(familyId) ?? 1);
  const shuffledIds = shuffled(rng, families.map((family) => family.familyId));
  const order = [
    ...shuffledIds.filter((familyId) => reachesANewBucket(familyId)),
    ...shuffledIds.filter((familyId) => !reachesANewBucket(familyId)),
  ];
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
 * Turn a family's share of a band into that many slots, getting deeper.
 *
 * The first question a family contributes uses its easiest validated bucket,
 * the second its next one, and so on, clamped at its deepest. A family with one
 * validated bucket produces the same slot every time, which is exactly what it
 * did before buckets were assigned per occurrence.
 */
function bucketedSlots(family: EligibleFamily, count: number): EligibleFamily[] {
  return Array.from({ length: count }, (_, occurrence) => {
    const chosen = family.bandBuckets[Math.min(occurrence, family.bandBuckets.length - 1)];
    return { ...family, difficultyBucket: chosen.bucket, difficulty: chosen.difficulty };
  });
}

/**
 * Order one band: easiest SLOT first, never repeating a family back to back.
 *
 * At each position it takes the lowest-difficulty slot still available whose
 * family leaves the rest of the band arrangeable. Ordering is on the slot, not
 * the family, so a family's deeper questions land later in the band even though
 * they carry the same family id. Where the ramp and the repeat rule collide — a
 * band ending in two questions from the only family at its top difficulty — the
 * repeat rule wins and one harder question moves earlier. That costs at most a
 * question or two of the ramp and never lets the same family run twice.
 */
function arrangeBand(
  counts: Map<string, number>,
  byFamilyId: ReadonlyMap<string, EligibleFamily>,
  previousFamilyId: string | undefined,
  rng: Rng,
): EligibleFamily[] {
  const tieBreak = new Map(shuffled(rng, [...counts.keys()]).map((familyId, index) => [familyId, index]));
  const remaining = new Map(counts);
  // Each family's own slots, easiest first; the next one is always at the head.
  const pending = new Map([...counts].map(([familyId, count]) =>
    [familyId, bucketedSlots(byFamilyId.get(familyId)!, count)]));
  const arranged: EligibleFamily[] = [];
  let previous = previousFamilyId;

  while (totalRemaining(remaining) > 0) {
    const candidates = [...remaining.keys()]
      .filter((familyId) => familyId !== previous)
      .sort((left, right) =>
        pending.get(left)![0].difficulty - pending.get(right)![0].difficulty ||
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
    arranged.push(pending.get(chosen)!.shift()!);
    previous = chosen;
  }
  return arranged;
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

/** Every subset of the given size, in a deterministic index order. */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const out: T[][] = [];
  const indexes = Array.from({ length: size }, (_, index) => index);
  for (;;) {
    out.push(indexes.map((index) => items[index]));
    let cursor = size - 1;
    while (cursor >= 0 && indexes[cursor] === items.length - size + cursor) cursor--;
    if (cursor < 0) return out;
    indexes[cursor]++;
    for (let next = cursor + 1; next < size; next++) indexes[next] = indexes[next - 1] + 1;
  }
}

/**
 * Every family subset a band may draw, all equally good under both rules.
 *
 * This replaces shuffle-and-slice-then-repair: the whole set of subsets is
 * enumerated, scored, and the best-scoring ones are returned so the caller can
 * pick one uniformly (docs/plans/escalate-the-quiz.md, Phase 5). Enumerating is
 * affordable because a band's pool is small — six families choosing four is
 * fifteen subsets — and a test locks that size so a pool that grows past it
 * fails loudly instead of slowing every request.
 *
 * Two rules score a subset, in this order:
 *
 * 1. **Cross-band.** As few families an earlier band already used as possible.
 *    A family registered in two bands otherwise gets drawn twice in one test,
 *    which spends two of a short test's five distinct families on one
 *    mechanism. The rule is a preference rather than a hard filter: a band that
 *    cannot fill its draw from unused families takes used ones rather than
 *    serving a thinner band. It also YIELDS — see below.
 * 2. **Format.** No more than `MAXIMUM_ANALOGY_LAYOUT_FAMILIES_PER_DRAW`
 *    analogy-layout families, again as a preference, so a pool that is all
 *    analogies still produces a test.
 *
 * Cross-band outranks format because it protects a hard invariant — the
 * distinct-family floor a profile refuses to build without — while the format
 * cap protects variety of presentation. Today both are satisfiable at once in
 * every band.
 *
 * **When cross-band yields.** Avoiding a family a previous band used is right
 * when it would only repeat the same question. It is wrong when this band is
 * the only place one of that family's declared buckets can be served, because
 * then avoiding it does not reduce repetition — it deletes a question from the
 * test. So a family already used stops counting as used here when both hold:
 *
 * - this band offers it a bucket no band it has already served offered, so the
 *   question really is a different one; and
 * - `crossBandSlack` is still positive, meaning the profile can afford the
 *   distinct family the repeat costs.
 *
 * The slack is what keeps the two lengths apart without a special case for
 * either. A long test draws twelve family slots against a floor of eleven, so
 * it can spend one; a short test draws five against a floor of five, so it can
 * spend none and its cross-band rule never yields.
 */
export function candidateFamilyDraws(
  families: readonly EligibleFamily[],
  band: ExpandedProfileBand,
  servedBucketsByFamilyId: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  crossBandSlack = 0,
): EligibleFamily[][] {
  const requested = FAMILY_SUBSAMPLE_SIZES[band];
  if (requested === undefined) return [[...families]];
  const size = Math.min(requested, families.length);

  const offersNewBucket = (family: EligibleFamily, served: ReadonlySet<string>) =>
    family.bandBuckets.some((bucket) => !served.has(bucket.bucket));

  let bestUsed = Number.POSITIVE_INFINITY;
  let bestAnalogyExcess = Number.POSITIVE_INFINITY;
  let best: EligibleFamily[][] = [];
  for (const subset of combinations(families, size)) {
    const repeats = subset.filter((family) => servedBucketsByFamilyId.has(family.familyId));
    const forgiven = Math.min(
      crossBandSlack,
      repeats.filter((family) =>
        offersNewBucket(family, servedBucketsByFamilyId.get(family.familyId)!)).length,
    );
    const used = repeats.length - forgiven;
    const analogyExcess = Math.max(
      0,
      subset.filter((family) => isAnalogyLayoutFamily(family.familyId)).length -
        MAXIMUM_ANALOGY_LAYOUT_FAMILIES_PER_DRAW,
    );
    if (used > bestUsed || (used === bestUsed && analogyExcess > bestAnalogyExcess)) continue;
    if (used < bestUsed || analogyExcess < bestAnalogyExcess) {
      bestUsed = used;
      bestAnalogyExcess = analogyExcess;
      best = [];
    }
    best.push(subset);
  }
  return best;
}

/** Pick one of the equally good draws, then shuffle the families inside it. */
function drawnFamiliesForBand(
  families: readonly EligibleFamily[],
  band: ExpandedProfileBand,
  rng: Rng,
  servedBucketsByFamilyId: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  crossBandSlack = 0,
): EligibleFamily[] {
  const draws = candidateFamilyDraws(families, band, servedBucketsByFamilyId, crossBandSlack);
  return shuffled(rng, shuffled(rng, draws)[0]);
}

/**
 * The most different families a profile's band draws could possibly produce.
 *
 * One band contributes the smaller of the families it draws and the questions
 * it asks: a short test's composition band draws four families for one
 * question, so it can only ever show one of them. The gap between this and
 * `MINIMUM_DISTINCT_FAMILIES` is how many families a test may repeat across
 * bands before it stops being buildable.
 */
export function maximumDistinctFamilies(
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): number {
  return EXPANDED_PROFILE_BANDS.reduce((total, band) => {
    const pool = eligibleFamiliesForBand(registry, band, withdrawnFamilyIds).length;
    const drawn = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? pool, pool);
    return total + Math.min(drawn, BAND_SCHEDULE[profile][band]);
  }, 0);
}

/** Choose every family for the whole test before any item is generated. */
export function planExpandedSchedule(
  seed: Seed,
  profile: ExpandedProfile,
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string> = new Set(),
): EligibleFamily[] {
  const schedule: EligibleFamily[] = [];
  // familyId -> the buckets it has actually been asked for so far. Buckets, not
  // just ids, because a family registered in two bands asks a different
  // question in each and the cross-band rule needs to tell those apart.
  const servedBuckets = new Map<string, Set<string>>();
  let crossBandSlack =
    maximumDistinctFamilies(profile, registry, withdrawnFamilyIds) -
    MINIMUM_DISTINCT_FAMILIES[profile];
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
      servedBuckets,
      crossBandSlack,
    );
    // When a short band draws more candidates than it asks questions, allocate
    // those few questions to unserved families whenever there are enough. The
    // family draw still controls format and eligibility; this tie-break keeps a
    // five-question sample from repeating composed-transform across two bands
    // after induction-transfer shrank to two families in v17.
    const unservedDrawn = drawn.filter((family) => !servedBuckets.has(family.familyId));
    const allocationPool = count <= unservedDrawn.length ? unservedDrawn : drawn;
    const byFamilyId = new Map(allocationPool.map((family) => [family.familyId, family]));
    const counts = evenSplit(
      count,
      allocationPool,
      seededRng(seed, `expanded-split:${profile}:${band}`),
    );
    const arranged = arrangeBand(
      counts,
      byFamilyId,
      schedule.at(-1)?.familyId,
      seededRng(seed, `expanded-order:${profile}:${band}`),
    );
    // Only families that actually got a question count as used: a family drawn
    // into a band's pool and then given nothing by the even split never appears
    // in the test, so it must not make a later band avoid it.
    //
    // A family this band repeats from an earlier one spends a unit of slack,
    // whether the cross-band rule forgave the repeat or simply had no
    // alternative. Counted before the served map is updated, or every family in
    // the band would look like a repeat of itself.
    crossBandSlack = Math.max(0, crossBandSlack - new Set(arranged
      .map((slot) => slot.familyId)
      .filter((familyId) => servedBuckets.has(familyId))).size);
    for (const slot of arranged) {
      const buckets = servedBuckets.get(slot.familyId) ?? new Set<string>();
      buckets.add(slot.difficultyBucket);
      servedBuckets.set(slot.familyId, buckets);
    }
    schedule.push(...arranged);
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
    // Program depth is a property of the bucket, not of the band. Reading it
    // here also proves the registry and the generator agree about this bucket
    // before anything is drawn: a registry that enables a bucket the family
    // does not declare fails the whole assembly rather than serving an item
    // labelled with a depth nobody produced.
    const declaredBucket = requireSceneFamilyBucket(familyId, selected.difficultyBucket);
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
          declaredBucket.bucket,
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
            programDepth: declaredBucket.programDepth,
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
      if (visiblePanels < MINIMUM_VISIBLE_STEM_PANELS) {
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
