import { describe, expect, it } from "vitest";
import {
  BAND_TIME_BUDGET_SECONDS,
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
  type FamilyPromotionRegistry,
} from "./family-promotion";
import {
  assembleExpandedQuiz,
  assertProfilesRemainBuildable,
  BAND_SCHEDULE,
  bucketDifficulty,
  candidateFamilyDraws,
  drawExpandedSlot,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  EXPANDED_SLOT_RETRY_BUDGET,
  FAMILY_SUBSAMPLE_SIZES,
  eligibleFamiliesForBand,
  isAnalogyLayoutFamily,
  MAXIMUM_ANALOGY_LAYOUT_FAMILIES_PER_DRAW,
  maximumDistinctFamilies,
  MINIMUM_DISTINCT_FAMILIES,
  MINIMUM_ELIGIBLE_FAMILIES,
  planExpandedSchedule,
  questionCount,
  questionFingerprint,
  sceneFamilyLayout,
  type ExpandedProfile,
  evenSplit,
} from "./expanded-quiz";
import {
  OPTIONS_PER_ITEM,
  VisualPuzzleSetSchema,
  visualElementSignature,
  type PuzzleSet,
  type Visual,
} from "./schema";
import {
  generateSceneFamilyCandidate,
  requireSceneFamilyBucket,
  sceneFamilyBucketsFor,
  type SceneFamilyId,
} from "./scene-families";
import { seededRng } from "../lib/rng";

const REGISTRY = CURRENT_FAMILY_PROMOTION_REGISTRY;

function bandOrder(profile: ExpandedProfile): string[] {
  return EXPANDED_PROFILE_BANDS.flatMap((band) =>
    new Array(BAND_SCHEDULE[profile][band]).fill(band) as string[]);
}

/**
 * One assembled test per length, shared by every test here that only reads it.
 *
 * Assembly is the expensive step, and most checks below are properties of any
 * one test, so they read the same memoised test instead of each assembling
 * their own. The seed is 32 hex characters on purpose: it is also the seed the
 * id-leak check below looks for inside the served ids.
 */
const SHARED_SEED = "0123456789abcdef0123456789abcdef";
const sharedQuizzes = new Map<ExpandedProfile, PuzzleSet<Visual>>();
function sharedQuiz(profile: ExpandedProfile): PuzzleSet<Visual> {
  let quiz = sharedQuizzes.get(profile);
  if (!quiz) {
    quiz = assembleExpandedQuiz(SHARED_SEED, profile, REGISTRY);
    sharedQuizzes.set(profile, quiz);
  }
  return quiz;
}

describe("eligible family pool", () => {
  it("offers every registered family band, and only the bands it registered", () => {
    const byBand = EXPANDED_PROFILE_BANDS.map((band) => eligibleFamiliesForBand(REGISTRY, band));
    // Derived from the registry, not hardcoded: a withdrawal is a normal event
    // and must not need this number edited. Since 2026-08-25 a family may hold
    // more than one band: composed-transform-v2 serves two gates in composition
    // and three in induction-transfer. So the count to match is the
    // number of registered (family, band) ENTRIES, and what each band offers
    // must be exactly the families that registered for it.
    const entries = REGISTRY.flatMap((family) => family.bands
      .filter((band) => band.state !== "prototype" && band.validatedDifficultyBuckets.length > 0)
      .map((band) => ({ familyId: family.familyId, band: band.band })));
    expect(byBand.flat()).toHaveLength(entries.length);
    EXPANDED_PROFILE_BANDS.forEach((band, index) => {
      expect(byBand[index].map((family) => family.familyId).sort(), band)
        .toEqual(entries.filter((entry) => entry.band === band).map((entry) => entry.familyId).sort());
    });
    EXPANDED_PROFILE_BANDS.forEach((band, index) => {
      expect(byBand[index].length, band).toBeGreaterThanOrEqual(MINIMUM_ELIGIBLE_FAMILIES["long-30"][band]);
    });
    expect(byBand.flat().every((family) => family.difficulty >= 2 && family.difficulty <= 5)).toBe(true);

    const composition = eligibleFamiliesForBand(REGISTRY, "composition").map((f) => f.familyId);
    expect(composition).not.toContain("spatial-transform-v2");
    expect(eligibleFamiliesForBand(REGISTRY, "warmup").map((f) => f.familyId))
      .toContain("spatial-transform-v2");
  });

  it("holds exactly the fifteen family/band/bucket keys the battery serves", () => {
    // v18 added the two combining-machine buckets to constraint-spatial, for
    // eighteen keys; retiring `parallel-evolution-v1` on 2026-09-28 took its two
    // composition buckets out again, and retiring `rule-switching-v2` on
    // 2026-09-29 took its warmup bucket out, leaving warmup with three.
    // `combining-machine-v1` was out of constraint-spatial from 2026-09-29 to
    // 2026-09-30 (docs/plans/blind-answer-leak.md). The number is derived
    // from the registry here, so adding or withdrawing a family without
    // revisiting the plan fails this test rather than quietly moving the
    // population the pilot packet and emergency bank are sized to.
    const keys = EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(REGISTRY, band).flatMap((family) =>
        family.bandBuckets.map((bucket) => `${family.familyId}:${band}:${bucket.bucket}`)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(15);
    expect(EXPANDED_PROFILE_BANDS.map((band) => eligibleFamiliesForBand(REGISTRY, band).length))
      .toEqual([3, 4, 3, 2]);
    // No key is d6 any more. The two that were are withdrawn, so the ladder
    // tops out at d5 until a mechanism earns a sixth rung some way other than
    // by adding gates — the lever the owner ruled out on 2026-08-27.
    expect(keys.filter((key) => key.endsWith("-d6"))).toEqual([]);
    // The same row's draw sizes and long-test floors.
    expect(EXPANDED_PROFILE_BANDS.map((band) => FAMILY_SUBSAMPLE_SIZES[band]))
      .toEqual([undefined, 4, 2, 2]);
    expect(EXPANDED_PROFILE_BANDS.map((band) => MINIMUM_ELIGIBLE_FAMILIES["long-30"][band]))
      .toEqual([2, 4, 2, 2]);
  });

  it("still reads difficulty 6 out of a bucket name, though no bucket declares one", () => {
    // The bucket suffix is the ramp input the whole assembler orders by, so it
    // had to widen with the puzzle schema on 2026-08-26. A `-d6` bucket that
    // still failed to parse would have thrown on every draw.
    for (const digit of [1, 2, 3, 4, 5, 6]) {
      expect(bucketDifficulty(`some-family-d${digit}`)).toBe(digit);
    }
    for (const bad of ["some-family-d0", "some-family-d7", "some-family-d10", "some-family", "d6"]) {
      expect(() => bucketDifficulty(bad), bad).toThrow(/must end in -d1 through -d6/);
    }
    // The parser keeps accepting -d6 even though the two buckets that used it
    // were withdrawn on 2026-08-27: the range is a schema fact, not a claim
    // that anything currently reaches the top of it. Read through the registry
    // rather than through a name, this family now stops at d5.
    const buckets = eligibleFamiliesForBand(REGISTRY, "induction-transfer")
      .find((family) => family.familyId === "composed-transform-v2")?.bandBuckets ?? [];
    expect(buckets).toEqual([{ bucket: "composed-transform-d5", difficulty: 5 }]);
  });

  it("keeps one-step mechanisms easy and reserves the hard transformation band for three steps", () => {
    const served = EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(REGISTRY, band).flatMap((family) =>
        family.bandBuckets.map((bucket) => ({
          band,
          familyId: family.familyId,
          bucket: requireSceneFamilyBucket(family.familyId as SceneFamilyId, bucket.bucket),
        }))));
    const oneStep = served.filter((entry) => entry.bucket.programDepth === 1);
    expect(oneStep.length).toBeGreaterThan(0);
    expect(oneStep.every((entry) => entry.band === "warmup" && entry.bucket.difficulty === 2)).toBe(true);

    const hardTransforms = served.filter((entry) => entry.band === "induction-transfer");
    expect(hardTransforms.map((entry) => entry.familyId).sort())
      .toEqual(["composed-transform-v2", "transformation-machine-v3"]);
    expect(hardTransforms.every((entry) => entry.bucket.programDepth === 3)).toBe(true);
  });

  it("drops withdrawn families", () => {
    const withdrawn = new Set(["attribute-pairing-v1"]);
    expect(eligibleFamiliesForBand(REGISTRY, "warmup", withdrawn).map((f) => f.familyId))
      .toEqual(["relational-sequence-v2", "spatial-transform-v2"]);
  });
});

describe("assembleExpandedQuiz", () => {
  it("uses the documented band schedule for both lengths", () => {
    expect(questionCount("short-5")).toBe(5);
    expect(questionCount("long-30")).toBe(30);
    expect(EXPANDED_PROFILES).toEqual(["short-5", "long-30"]);
  });

  for (const profile of EXPANDED_PROFILES) {
    it(`assembles a deterministic ${profile} test from code-valid families`, () => {
      const first = sharedQuiz(profile);
      const replay = assembleExpandedQuiz(SHARED_SEED, profile, REGISTRY);

      expect(replay).toEqual(first);
      expect(VisualPuzzleSetSchema.safeParse(first).success).toBe(true);
      expect(first).toHaveLength(questionCount(profile));
      expect(first.map((puzzle) => puzzle.band)).toEqual(bandOrder(profile));
      expect(first.every((puzzle) =>
        puzzle.generation!.generatorVersion === EXPANDED_GENERATOR_VERSION)).toBe(true);
      expect(first.every((puzzle) =>
        puzzle.layout === "singleScene" ||
        puzzle.stem.length === 0 ||
        puzzle.stem.filter((panel) => !("blank" in panel)).length >= 2)).toBe(true);

      // Every served question is exactly the slot its schedule planned: same
      // family, band, bucket, and difficulty, in the same order. That is what
      // lets the invariants below be checked on schedules alone — planning is
      // cheap and assembly is not.
      const schedule = planExpandedSchedule(SHARED_SEED, profile, REGISTRY);
      expect(first.map((puzzle) => ({
        familyId: puzzle.generation!.familyId,
        band: puzzle.band,
        bucket: puzzle.generation!.featureBucket,
        difficulty: puzzle.difficulty,
      }))).toEqual(schedule.map((slot) => ({
        familyId: slot.familyId,
        band: slot.band,
        bucket: slot.difficultyBucket,
        difficulty: slot.difficulty,
      })));
    });
  }

  it("keeps coverage, spread, and ramp invariants across many schedules", () => {
    // Checked on the planned schedule: the test above proves an assembled test
    // serves exactly its schedule, slot for slot.
    for (const profile of EXPANDED_PROFILES) {
      for (let seed = 0; seed < 40; seed++) {
        const schedule = planExpandedSchedule(`schedule-${seed}`, profile, REGISTRY);
        const familyIds = schedule.map((slot) => slot.familyId);

        expect(new Set(familyIds).size).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_FAMILIES[profile]);
        for (let index = 1; index < familyIds.length; index++) {
          expect(familyIds[index]).not.toBe(familyIds[index - 1]);
        }

        // Even split: no family may take more than its share of a band.
        for (const band of EXPANDED_PROFILE_BANDS) {
          const inBand = schedule.filter((slot) => slot.band === band);
          const eligible = eligibleFamiliesForBand(REGISTRY, band).length;
          const pool = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible, eligible);
          const cap = Math.ceil(BAND_SCHEDULE[profile][band] / pool);
          const counts = new Map<string, number>();
          for (const slot of inBand) counts.set(slot.familyId, (counts.get(slot.familyId) ?? 0) + 1);
          expect(Math.max(...counts.values())).toBeLessThanOrEqual(cap);
        }

        // Rising ramp: each band's floor is at least the previous band's floor,
        // and inside a band the repeat rule may cost at most two dips. The
        // difficulty read here is the SLOT's, which for a family with two
        // buckets in one band is not the same on every occurrence.
        let previousFloor = 0;
        for (const band of EXPANDED_PROFILE_BANDS) {
          const difficulties = schedule
            .filter((slot) => slot.band === band)
            .map((slot) => slot.difficulty);
          const floor = Math.min(...difficulties);
          expect(floor).toBeGreaterThanOrEqual(previousFloor);
          previousFloor = floor;
          const dips = difficulties.filter((value, index) =>
            index > 0 && value < difficulties[index - 1]).length;
          const drawn = Math.min(
            FAMILY_SUBSAMPLE_SIZES[band] ?? eligibleFamiliesForBand(REGISTRY, band).length,
            eligibleFamiliesForBand(REGISTRY, band).length,
          );
          const maximumDips = Math.max(2, Math.ceil(BAND_SCHEDULE[profile][band] / drawn) - 1);
          expect(dips).toBeLessThanOrEqual(maximumDips);
        }
      }
    }
  });

  it("draws a seeded eligible subset for each non-warmup band", () => {
    const seenByBand = new Map(
      EXPANDED_PROFILE_BANDS.map((band) => [band, new Set<string>()]),
    );

    // Both lengths, because they do not reach the same families: every long-30
    // composition draw takes its whole pool, composed-transform-v2 included,
    // while a short-5 composition band hands its one question to a single
    // family, so induction-transfer can draw composed-transform instead.
    // Neither profile alone covers the pool; together they do.
    for (const profile of EXPANDED_PROFILES) {
      for (let seed = 0; seed < 24; seed++) {
        const schedule = planExpandedSchedule(`pool-${seed}`, profile, REGISTRY);
        for (const band of EXPANDED_PROFILE_BANDS) {
          const eligible = eligibleFamiliesForBand(REGISTRY, band).map((family) => family.familyId);
          const drawn = schedule
            .filter((entry) => entry.band === band)
            .map((entry) => entry.familyId);
          const drawnIds = new Set(drawn);
          // A long test gives every drawn family a question, so the questions
          // name the whole draw. A short band has fewer questions than the
          // families drawn for it, so it can only show some of them.
          const target = Math.min(
            FAMILY_SUBSAMPLE_SIZES[band] ?? eligible.length,
            eligible.length,
            BAND_SCHEDULE[profile][band],
          );
          expect(drawnIds.size).toBe(target);
          expect([...drawnIds].every((familyId) => eligible.includes(familyId))).toBe(true);
          for (const familyId of drawnIds) seenByBand.get(band)!.add(familyId);
        }
      }
    }

    for (const band of EXPANDED_PROFILE_BANDS) {
      expect([...seenByBand.get(band)!].sort()).toEqual(
        eligibleFamiliesForBand(REGISTRY, band).map((family) => family.familyId),
      );
    }
  });

  it("serves the configured number of options on every question", () => {
    for (const profile of EXPANDED_PROFILES) {
      for (const puzzle of sharedQuiz(profile)) {
        expect(puzzle.options.length, `${profile} ${puzzle.familyId}`).toBe(OPTIONS_PER_ITEM);
      }
    }
  });

  it("gives every option a distinct visual identity", () => {
    // The agent harness shuffles options and maps the model's pick back by this
    // identity, so two options that share one would silently mis-score a run.
    for (const profile of EXPANDED_PROFILES) {
      for (const puzzle of sharedQuiz(profile)) {
        const identities = puzzle.options.map(visualElementSignature);
        expect(new Set(identities).size).toBe(identities.length);
      }
    }
  });

  it("never asks the same question twice in one test, whatever its options", () => {
    // Found 2026-09-28: the duplicate check hashed the stem TOGETHER with the
    // options in served order, so one stem offered with different near misses
    // passed as a new question — about 3% of long tests asked one twice. A
    // question is what the taker is asked: its type, layout, and stem.
    const puzzle = sharedQuiz("long-30")[0];
    const base = questionFingerprint(puzzle);
    const reordered = { ...puzzle, options: [...puzzle.options].reverse() };
    const otherOptions = { ...puzzle, options: puzzle.options.slice(1) };
    expect(questionFingerprint(reordered)).toBe(base);
    expect(questionFingerprint(otherOptions)).toBe(base);
    expect(questionFingerprint({ ...puzzle, stem: [...puzzle.stem].reverse() })).not.toBe(base);
    expect(questionFingerprint({ ...puzzle, layout: puzzle.layout === "row" ? "analogy" : "row" })).not.toBe(base);
    for (const profile of EXPANDED_PROFILES) {
      const questions = sharedQuiz(profile).map(questionFingerprint);
      expect(new Set(questions).size, profile).toBe(questions.length);
    }
  });

  it("plans the whole family schedule before generating anything", () => {
    const schedule = planExpandedSchedule("plan-only", "long-30", REGISTRY);
    expect(schedule).toHaveLength(30);
    expect(schedule.map((entry) => entry.band)).toEqual(bandOrder("long-30"));
  });

  it("refuses a long test when withdrawals leave a band too thin", () => {
    const withdrawn = new Set(["attribute-pairing-v1", "spatial-transform-v2"]);
    expect(() => assembleExpandedQuiz("thin-warmup", "long-30", REGISTRY, withdrawn))
      .toThrow(/at least 2 eligible warmup families but has 1/);
  });

  it("refuses a short test when a band has no family left", () => {
    const withdrawn = new Set([
      "relational-sequence-v2",
      "attribute-pairing-v1",
      "spatial-transform-v2",
    ]);
    expect(() => assembleExpandedQuiz("no-warmup", "short-5", REGISTRY, withdrawn))
      .toThrow(/at least 1 eligible warmup families but has 0/);
  });

  it("refuses to start when withdrawals leave a band too thin", () => {
    expect(() => assertProfilesRemainBuildable(REGISTRY, new Set())).not.toThrow();
    expect(() => assertProfilesRemainBuildable(
      REGISTRY,
      new Set(["attribute-pairing-v1", "spatial-transform-v2"]),
    ))
      .toThrow(/long-30 needs 2 warmup families but only 1 remain/);
    expect(() => assertProfilesRemainBuildable(
      REGISTRY,
      new Set([
        "relational-sequence-v2",
        "attribute-pairing-v1",
        "spatial-transform-v2",
      ]),
    )).toThrow(/short-5 needs 1 warmup families but only 0 remain/);
    // The advice names the band that is actually short, not a fixed one.
    expect(() => assertProfilesRemainBuildable(
      REGISTRY,
      new Set(["attribute-pairing-v1", "spatial-transform-v2"]),
    )).toThrow(/add a new one to the warmup band/);
  });

  it("refuses to start when every band is deep enough but a length still cannot be built", () => {
    // Found 2026-09-28. Withdrawing these two leaves warmup at exactly its
    // long-test minimum of two, so the per-band check passed — and then every
    // long test failed with "needs at least 10 distinct families but has 9",
    // because composed-transform-v2 fills a place in two bands and the old
    // arithmetic counted it twice. The check now plans each length for real.
    // Since rule-switching-v2 retired (2026-09-29), one withdrawal is enough.
    const withdrawn = new Set(["spatial-transform-v2"]);
    expect(eligibleFamiliesForBand(REGISTRY, "warmup", withdrawn))
      .toHaveLength(MINIMUM_ELIGIBLE_FAMILIES["long-30"].warmup);
    expect(() => planExpandedSchedule("any-seed", "long-30", REGISTRY, withdrawn))
      .toThrow(/needs at least 10 distinct families but has 9/);
    expect(() => assertProfilesRemainBuildable(REGISTRY, withdrawn))
      .toThrow(/the long-30 test cannot be built \(the long-30 test needs at least 10 distinct families but has 9\)/);
    // The short test is still buildable, and the error does not claim otherwise.
    expect(() => assertProfilesRemainBuildable(REGISTRY, withdrawn)).not.toThrow(/short-5/);
    // The arithmetic behind the cross-band slack counts that family once.
    expect(maximumDistinctFamilies("long-30", REGISTRY, withdrawn)).toBe(9);
  });

  it("survives one withdrawal only from the band with a family to spare", () => {
    // Since rule-switching-v2 retired (2026-09-29) a long test's ten distinct
    // families are exactly what the registry can supply, so withdrawing a
    // warmup, composition or induction-transfer family stops long tests from
    // building. Constraint-spatial has three families and draws two (since
    // combining-machine-v1 returned on 2026-09-30), so one of those can go.
    expect(maximumDistinctFamilies("long-30", REGISTRY, new Set()))
      .toBe(MINIMUM_DISTINCT_FAMILIES["long-30"]);
    expect(() => assertProfilesRemainBuildable(REGISTRY, new Set(["attribute-pairing-v1"])))
      .toThrow(/the long-30 test cannot be built/);
    const withdrawn = new Set(["combining-machine-v1"]);
    expect(() => assertProfilesRemainBuildable(REGISTRY, withdrawn)).not.toThrow();
    for (const profile of EXPANDED_PROFILES) {
      expect(planExpandedSchedule("safe-withdrawal", profile, REGISTRY, withdrawn))
        .toHaveLength(questionCount(profile));
    }
  });

  it("counts a family registered in two bands once when bounding distinct families", () => {
    // composed-transform-v2 is registered in composition and induction-transfer.
    // Composition draws its whole pool of four, composed-transform included, so
    // induction-transfer can add only transformation-machine-v3: 3 + 4 + 2 + 1
    // (warmup has held three families since rule-switching-v2 retired on
    // 2026-09-29).
    expect(maximumDistinctFamilies("long-30", REGISTRY)).toBe(10);
    expect(maximumDistinctFamilies("short-5", REGISTRY)).toBe(5);
  });

  it("rejects an empty seed", () => {
    expect(() => assembleExpandedQuiz("", "short-5", REGISTRY)).toThrow(/seed must not be empty/);
  });

  it("gives a family's later questions in a band its deeper bucket", () => {
    // Three served families hold two validated buckets in one band: a band
    // serves the shallower one first and the deeper one every time after, so
    // repetition inside a band is a ramp, not a plateau.
    const ramps = [
      {
        familyId: "compositional-analogy-v2",
        band: "composition",
        buckets: ["compositional-analogy-d3", "compositional-analogy-d4"],
      },
      {
        familyId: "visual-set-algebra-v2",
        band: "constraint-spatial",
        buckets: ["visual-set-algebra-d4", "visual-set-algebra-d5"],
      },
      {
        familyId: "combining-machine-v1",
        band: "constraint-spatial",
        buckets: ["combining-machine-d4", "combining-machine-d5"],
      },
    ] as const;
    for (const { familyId, band, buckets } of ramps) {
      let sawRepeat = false;
      for (let seed = 0; seed < 40; seed++) {
        const schedule = planExpandedSchedule(`buckets-${seed}`, "long-30", REGISTRY);
        const slots = schedule.filter((slot) => slot.familyId === familyId && slot.band === band);
        if (slots.length < 2) continue;
        sawRepeat = true;
        expect(slots[0].difficultyBucket, `${familyId} seed ${seed}`).toBe(buckets[0]);
        expect(slots.slice(1).map((slot) => slot.difficultyBucket), `${familyId} seed ${seed}`)
          .toEqual(slots.slice(1).map(() => buckets[1]));
        // Deeper questions come later in the band, never before the entry one.
        const positions = slots.map((slot) => schedule.indexOf(slot));
        expect([...positions].sort((left, right) => left - right)).toEqual(positions);
      }
      expect(sawRepeat, `no seed put ${familyId} in ${band} twice`).toBe(true);
    }
  });

  it("lets composed-transform hold both bands of a long test but never of a short one", () => {
    // The family is registered in composition and induction-transfer. A short
    // test has five questions and needs five
    // different mechanisms, so drawing it into both bands would make the test
    // unbuildable — its cross-band rule never yields.
    for (let seed = 0; seed < 60; seed++) {
      const schedule = planExpandedSchedule(`composed-bands-${seed}`, "short-5", REGISTRY);
      const bands = new Set(schedule
        .filter((slot) => slot.familyId === "composed-transform-v2")
        .map((slot) => slot.band));
      expect(bands.size, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(new Set(schedule.map((slot) => slot.familyId)).size, `seed ${seed}`).toBe(5);
    }

    // A long test does yield, by the owner's decision of 2026-08-25. The format
    // cap puts composed-transform-v2 in every long composition draw, and the
    // two-family hard pool always includes its three-step d5 form.
    const shortBands = [
      "composition:composed-transform-d4",
      "induction-transfer:composed-transform-d5",
    ];
    const longBands = shortBands;
    for (const profile of EXPANDED_PROFILES) {
      const seen = new Set<string>();
      let withRecombinedQuery = 0;
      for (let seed = 0; seed < 200; seed++) {
        const schedule = planExpandedSchedule(`composed-depth-${seed}`, profile, REGISTRY);
        for (const slot of schedule) {
          if (slot.familyId !== "composed-transform-v2") continue;
          seen.add(`${slot.band}:${slot.difficultyBucket}`);
        }
        if (schedule.some((slot) => slot.difficultyBucket === "composed-transform-d5")) {
          withRecombinedQuery++;
        }
      }
      expect([...seen].sort(), profile).toEqual(profile === "long-30" ? longBands : shortBands);
      const share = withRecombinedQuery / 200;
      if (profile === "long-30") expect(share).toBe(1);
      else expect(share).toBeGreaterThan(0.05);
    }
  });

  it("orders each band by slot difficulty rather than by family", () => {
    for (let seed = 0; seed < 40; seed++) {
      const schedule = planExpandedSchedule(`slot-order-${seed}`, "long-30", REGISTRY);
      for (const band of EXPANDED_PROFILE_BANDS) {
        const difficulties = schedule
          .filter((slot) => slot.band === band)
          .map((slot) => slot.difficulty);
        // With two families, the no-adjacent-repeat rule forces alternation and
        // can pull up to four harder set-algebra questions ahead of a d4 matrix
        // question. Larger pools keep the older two-dip ceiling.
        const dips = difficulties.filter((value, index) => index > 0 && value < difficulties[index - 1]);
        const eligible = eligibleFamiliesForBand(REGISTRY, band).length;
        const drawn = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible, eligible);
        const maximumDips = Math.max(2, Math.ceil(BAND_SCHEDULE["long-30"][band] / drawn) - 1);
        expect(dips.length, `${band} seed ${seed}`).toBeLessThanOrEqual(maximumDips);
      }
    }
  });

  it("reads program depth from the family bucket, not from the band", () => {
    for (const puzzle of sharedQuiz("long-30")) {
      const declared = requireSceneFamilyBucket(
        puzzle.generation!.familyId as SceneFamilyId,
        puzzle.generation!.featureBucket,
      );
      expect(puzzle.generation!.features.programDepth, puzzle.generation!.featureBucket)
        .toBe(declared.programDepth);
    }
    // The regression this replaces: composed-transform-v2 sits in the
    // composition band, which used to stamp every item there with depth 2. It
    // now applies exactly the two gates appropriate to this intermediate rung.
    const composed = requireSceneFamilyBucket("composed-transform-v2", "composed-transform-d4");
    expect(composed.programDepth).toBe(2);
    // The hard bucket demonstrates and applies all three rules, sometimes in a
    // different query order from the worked rows.
    expect(requireSceneFamilyBucket("composed-transform-v2", "composed-transform-d5").programDepth).toBe(3);
    expect(requireSceneFamilyBucket("compositional-analogy-v2", "compositional-analogy-d3").programDepth).toBe(2);
    expect(requireSceneFamilyBucket("compositional-analogy-v2", "compositional-analogy-d4").programDepth).toBe(3);
    expect(requireSceneFamilyBucket("visual-set-algebra-v2", "visual-set-algebra-d4").programDepth).toBe(2);
    expect(requireSceneFamilyBucket("visual-set-algebra-v2", "visual-set-algebra-d5").programDepth).toBe(3);
  });

  it("fills every slot within its retry budget: a per-bucket acceptance sweep", () => {
    // Replaces "fills every slot of 200 long tests" (2026-09-28), which took
    // seven to nine minutes and could only report a throw after the fact. This
    // measures the thing that throw depended on, directly, for every key.
    //
    // A slot gets EXPANDED_SLOT_RETRY_BUDGET attempts, each on its own child
    // seed, and fails only if every one is refused. An attempt is refused when
    // the family throws, the item fails acceptance, its difficulty or visible
    // panels are wrong (all inside `drawExpandedSlot`, the assembler's own
    // path), or it repeats a question the test already asks. The repeat is
    // priced here as the worst case: a draw matching any of the draws before it
    // that one test could already hold of the same key — the band's most
    // questions per family, less one.
    //
    // Per key, the refused share must stay at or under 10%. Four attempts then
    // fail together at most 0.1^4 = 1 time in 10,000, so a 30-question test runs
    // out of attempts in under 0.3% of assemblies — the bound the 200-test run
    // was a sample of, now held per key where a regression shows up first.
    const DRAWS = 40;
    const MAXIMUM_REFUSED_SHARE = 0.1;
    const report: string[] = [];
    for (const band of EXPANDED_PROFILE_BANDS) {
      const pool = eligibleFamiliesForBand(REGISTRY, band);
      const drawnFamilies = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? pool.length, pool.length);
      const mostPerFamily = Math.ceil(BAND_SCHEDULE["long-30"][band] / drawnFamilies);
      for (const family of pool) {
        for (const { bucket, difficulty } of family.bandBuckets) {
          const slot = { ...family, difficultyBucket: bucket, difficulty };
          const asked: string[] = [];
          let refused = 0;
          const reasons = new Set<string>();
          for (let index = 0; index < DRAWS; index++) {
            const draw = drawExpandedSlot(`acceptance-sweep:${bucket}:${index}`, "long-30", 0, 0, slot);
            if (!draw.accepted) {
              refused++;
              reasons.add(draw.rejection);
              continue;
            }
            const question = questionFingerprint(draw.puzzle);
            if (asked.slice(-(mostPerFamily - 1)).includes(question)) {
              refused++;
              reasons.add("repeats a question");
            }
            asked.push(question);
          }
          if (refused / DRAWS > MAXIMUM_REFUSED_SHARE) {
            report.push(`${band}:${bucket} refused ${refused}/${DRAWS} (${[...reasons].join(" | ")})`);
          }
        }
      }
    }
    expect(EXPANDED_SLOT_RETRY_BUDGET).toBe(4);
    expect(report).toEqual([]);
  });
});

describe("format-aware family subsampling", () => {
  const eligibleFamilyIds = [...new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
    eligibleFamiliesForBand(REGISTRY, band).map((family) => family.familyId)))].sort();

  /**
   * The most analogy-layout families one draw of this band may hold.
   *
   * The cap, unless the pool has too few other families to fill a draw without
   * exceeding it — then the cap yields by exactly that shortfall and no more.
   * Composition is that band since `parallel-evolution-v1` was retired: its
   * whole pool of four is the draw, and two of the four are analogies.
   */
  const analogyCeiling = (band: (typeof EXPANDED_PROFILE_BANDS)[number]) => {
    const eligible = eligibleFamiliesForBand(REGISTRY, band);
    const size = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible.length, eligible.length);
    const others = eligible.filter((family) => !isAnalogyLayoutFamily(family.familyId)).length;
    return Math.max(MAXIMUM_ANALOGY_LAYOUT_FAMILIES_PER_DRAW, size - others);
  };

  it("reads the analogy-layout families off generated stems rather than off their names", () => {
    // Locked, not hardcoded policy: this is what the generator currently draws.
    // One of the four is not called "analogy" anything, and one family that
    // is — compositional-analogy-v2 — is named for its reasoning, so a name
    // list would have classified four of these six wrongly. A family added
    // tomorrow lands in or out of this list by what its stem looks like, and
    // this assertion is what makes that visible. It was seven until
    // `containment-analogy-v2` was withdrawn on 2026-08-26.
    expect(eligibleFamilyIds.filter(isAnalogyLayoutFamily)).toEqual([
      "attribute-pairing-v1",
      "compositional-analogy-v2",
      "inverse-analogy-v2",
      "spatial-transform-v2",
    ]);

    // The draw picks families, not buckets, so the layout has to be a property
    // of the family. Every bucket a family declares must draw the same layout;
    // a family whose deeper bucket changed shape would make the cap meaningless.
    for (const familyId of eligibleFamilyIds) {
      for (const bucket of sceneFamilyBucketsFor(familyId as SceneFamilyId)) {
        let layout: string | null = null;
        for (let attempt = 0; attempt < 8 && layout === null; attempt++) {
          try {
            layout = generateSceneFamilyCandidate(
              familyId as SceneFamilyId,
              seededRng("bucket-layout-agreement", `${bucket.bucket}:${attempt}`),
              bucket.bucket,
            ).puzzle.layout;
          } catch {
            // A refused draw says nothing about the layout; try the next seed.
          }
        }
        expect(layout, bucket.bucket).toBe(sceneFamilyLayout(familyId));
      }
    }

    // A family the scene generator does not know has no layout to read, so it
    // is not an analogy and the cap simply does not apply to it. The synthetic
    // registries below depend on that.
    expect(sceneFamilyLayout("not-a-real-family-v1")).toBe(null);
    expect(isAnalogyLayoutFamily("not-a-real-family-v1")).toBe(false);
  });

  it("offers only the draws that satisfy the cross-band and format rules", () => {
    // `served` is what earlier bands have already asked each family for, and
    // `slack` is how many families the profile can still afford to repeat —
    // two for a long test, none for a short one.
    const draws = (
      band: (typeof EXPANDED_PROFILE_BANDS)[number],
      served: Record<string, string[]> = {},
      slack = 0,
    ) =>
      candidateFamilyDraws(
        eligibleFamiliesForBand(REGISTRY, band),
        band,
        new Map(Object.entries(served).map(([familyId, buckets]) => [familyId, new Set(buckets)])),
        slack,
      );

    // Warmup is not subsampled: its whole pool is the only draw.
    expect(draws("warmup")).toHaveLength(1);
    expect(draws("warmup")[0]).toHaveLength(3);

    // Composition draws four from four since `parallel-evolution-v1` was
    // retired on 2026-09-28, so its one draw is the whole pool — and two of
    // those four are analogy-layout. The cap is a preference and yields: the
    // band carries two analogy families rather than a thinner draw.
    const composition = draws("composition");
    expect(composition).toHaveLength(1);
    expect(composition[0].filter((family) => isAnalogyLayoutFamily(family.familyId)).map((family) => family.familyId))
      .toEqual(["compositional-analogy-v2", "inverse-analogy-v2"]);

    // Constraint-spatial draws two of its three families, none analogy-shaped,
    // so every pair is a draw. (While combining-machine was out of the band,
    // 2026-09-29 to 2026-09-30, the one draw was both remaining families.)
    const constraint = draws("constraint-spatial");
    expect(constraint).toHaveLength(3);
    for (const draw of constraint) expect(draw).toHaveLength(2);
    expect([...new Set(constraint.flat().map((family) => family.familyId))].sort())
      .toEqual(["combining-machine-v1", "relational-matrix-v2", "visual-set-algebra-v2"]);

    // Induction-transfer now has exactly the two three-step transformation
    // families and draws both. The one-step switch belongs to warmup.
    const usedComposed = { "composed-transform-v2": ["composed-transform-d4"] };
    expect(draws("induction-transfer")).toHaveLength(1);
    expect(draws("induction-transfer", usedComposed, 1)).toHaveLength(1);
    expect(draws("induction-transfer", usedComposed, 0)).toHaveLength(1);
    expect(draws("induction-transfer", usedComposed, 0)[0]
      .map((family) => family.familyId).sort())
      .toEqual(["composed-transform-v2", "transformation-machine-v3"]);
    const composedFullyServed = {
      "composed-transform-v2": ["composed-transform-d4", "composed-transform-d5"],
    };
    expect(draws("induction-transfer", composedFullyServed, 1)).toHaveLength(1);
    expect(draws("induction-transfer", composedFullyServed, 1)[0]
      .map((family) => family.familyId).sort())
      .toEqual(["composed-transform-v2", "transformation-machine-v3"]);

    for (const band of EXPANDED_PROFILE_BANDS) {
      const eligible = eligibleFamiliesForBand(REGISTRY, band);
      const size = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible.length, eligible.length);
      for (const draw of draws(band)) {
        expect(draw, band).toHaveLength(size);
        expect(new Set(draw.map((family) => family.familyId)).size, band).toBe(size);
        if (band !== "warmup") {
          expect(draw.filter((family) => isAnalogyLayoutFamily(family.familyId)).length, band)
            .toBeLessThanOrEqual(analogyCeiling(band));
        }
      }
      // Enumerating every subset is only affordable while the pools are small,
      // and it runs on every request. A pool that grows past this fails here
      // rather than slowing the live assembler down.
      const choices = (pool: number, take: number) =>
        Array.from({ length: take }, (_, index) => (pool - index) / (index + 1)).reduce((a, b) => a * b, 1);
      expect(Math.round(choices(eligible.length, size)), band).toBeLessThanOrEqual(64);
    }
  });

  it("proves both profiles and every schedule target over 10,000 seeds", () => {
    const SCHEDULES = 10_000;
    // The deepest difficulty anything in the battery can serve, read off the
    // registry so the tail test tracks the ladder instead of restating it.
    const deepestDifficultyInBattery = Math.max(...EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(REGISTRY, band).flatMap((family) =>
        family.bandBuckets.map((bucket) => bucket.difficulty))));
    // Fold-and-punch removal leaves no analogy layouts in the two hardest
    // bands. Two of the three warmup families are analogy-shaped since
    // `rule-switching-v2` retired on 2026-09-29, so warmup contributes
    // 5 x 2/3 = 3.33 (it was 5 x 2/4 = 2.5 with four). Composition draws its
    // whole pool of four since `parallel-evolution-v1` was retired on
    // 2026-09-28, and two of those four are analogies, so it contributes
    // 10 x 2/4 = 5 (it was 2.5 while a fifth, non-analogy family let the cap
    // hold). 3.33 + 5 = 8.33.
    //
    // The assertion is two-sided around the closed form, not a bare "<= 10.0",
    // so it catches the mean drifting DOWN as well as up: a change that quietly
    // stopped serving analogies would otherwise pass. The per-draw ceiling
    // asserted above, which is what holds the number under the cap in the first
    // place, is checked on every one of these seeds with no tolerance at all.
    const ANALOGY_ITEMS_PER_LONG_TEST_CAP = 10.0;
    const ANALOGY_ITEMS_PER_LONG_TEST_EXPECTED = 5 * (2 / 3) + 10 * (2 / 4);
    const MEAN_TOLERANCE = 0.05;

    let analogyItems = 0;
    const finalItemFamilies = new Map<string, number>();
    for (let seed = 0; seed < SCHEDULES; seed++) {
      for (const profile of EXPANDED_PROFILES) {
        const schedule = planExpandedSchedule(`ten-thousand-${seed}`, profile, REGISTRY);
        expect(schedule, `${profile} seed ${seed}`).toHaveLength(questionCount(profile));

        const familyIds = schedule.map((slot) => slot.familyId);
        expect(new Set(familyIds).size, `${profile} seed ${seed}`)
          .toBeGreaterThanOrEqual(MINIMUM_DISTINCT_FAMILIES[profile]);
        for (let index = 1; index < familyIds.length; index++) {
          expect(familyIds[index], `${profile} seed ${seed} position ${index}`)
            .not.toBe(familyIds[index - 1]);
        }

        for (const band of EXPANDED_PROFILE_BANDS) {
          const inBand = schedule.filter((slot) => slot.band === band);
          expect(inBand.length, `${profile} seed ${seed} ${band}`).toBe(BAND_SCHEDULE[profile][band]);
          const eligible = eligibleFamiliesForBand(REGISTRY, band);
          expect(eligible.length, band)
            .toBeGreaterThanOrEqual(MINIMUM_ELIGIBLE_FAMILIES[profile][band]);
          const drawn = new Set(inBand.map((slot) => slot.familyId));
          if (band !== "warmup") {
            expect([...drawn].filter(isAnalogyLayoutFamily).length, `${profile} seed ${seed} ${band}`)
              .toBeLessThanOrEqual(analogyCeiling(band));
          }
        }

        // A family may hold two bands only as far as the profile's slack allows
        // — the gap between the family places its band draws add up to and the
        // distinct families it must still contain. That is one for a long test
        // (11 places, 10 distinct families) and none for a short one, so a short
        // test never repeats a mechanism across bands and a long test permits
        // one cross-band repeat, which composed-transform-v2 always takes.
        const bandsPerFamily = new Map<string, Set<string>>();
        const bucketsPerFamily = new Map<string, Set<string>>();
        for (const slot of schedule) {
          const bands = bandsPerFamily.get(slot.familyId) ?? new Set<string>();
          bands.add(slot.band);
          bandsPerFamily.set(slot.familyId, bands);
          const buckets = bucketsPerFamily.get(slot.familyId) ?? new Set<string>();
          buckets.add(slot.difficultyBucket);
          bucketsPerFamily.set(slot.familyId, buckets);
        }
        const places = EXPANDED_PROFILE_BANDS.reduce((sum, band) => {
          const pool = eligibleFamiliesForBand(REGISTRY, band).length;
          const drawn = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? pool, pool);
          return sum + Math.min(drawn, BAND_SCHEDULE[profile][band]);
        }, 0);
        const slack = places - MINIMUM_DISTINCT_FAMILIES[profile];
        const spanning = [...bandsPerFamily].filter(([, bands]) => bands.size > 1);
        expect(spanning.length, `${profile} seed ${seed}`).toBeLessThanOrEqual(slack);
        // And a family that does hold two bands asks a different question in
        // each: it is worth a distinct-family slot only because the second band
        // serves a bucket the first one could not.
        for (const [familyId, bands] of spanning) {
          expect(bucketsPerFamily.get(familyId)!.size, `${profile} seed ${seed} ${familyId}`)
            .toBeGreaterThanOrEqual(bands.size);
        }

        if (profile !== "long-30") continue;
        analogyItems += schedule.filter((slot) => isAnalogyLayoutFamily(slot.familyId)).length;
        // EVERY long test ends on the deepest thing the battery generates, not
        // most of them. The target is read off the registry rather than
        // written down, because the depth it names has already changed twice:
        // d6 between 2026-08-26 and 2026-08-27, d5 before and after. Today
        // every induction-transfer bucket is d5 and that band is last, so the
        // guarantee holds by construction; when a mechanism next earns a
        // deeper rung, this test starts demanding it without being edited.
        const last = schedule[schedule.length - 1];
        expect(last.difficulty, `seed ${seed} final item`).toBe(deepestDifficultyInBattery);
        finalItemFamilies.set(last.familyId, (finalItemFamilies.get(last.familyId) ?? 0) + 1);

        // The two hardest bands keep nine questions at d5: all five induction
        // questions plus four later visual-set-algebra occurrences after its
        // d4 entry question.
        const deepest = schedule.filter((slot) =>
          (slot.band === "constraint-spatial" || slot.band === "induction-transfer") &&
          slot.difficulty >= 5);
        expect(deepest.length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      }
    }

    const meanAnalogyItems = analogyItems / SCHEDULES;
    expect(meanAnalogyItems).toBeLessThanOrEqual(ANALOGY_ITEMS_PER_LONG_TEST_CAP);
    expect(Math.abs(meanAnalogyItems - ANALOGY_ITEMS_PER_LONG_TEST_EXPECTED))
      .toBeLessThanOrEqual(MEAN_TOLERANCE);

    // The final question must not narrow to one mechanism. A test whose last
    // question is always the same family stops measuring reasoning at the top
    // of the ladder and starts measuring familiarity with one machine, so the
    // finals have to spread over the induction-transfer pool. While the d6
    // tier existed this was pinned to exactly two families at roughly 50/50.
    // The current hard pool also contains two, and every family in that live
    // pool must be able to finish a test rather than a fixed name pair being
    // baked into this distribution check.
    const eligibleFinalFamilies = eligibleFamiliesForBand(REGISTRY, "induction-transfer");
    expect(finalItemFamilies.size, "distinct families that can finish a long test")
      .toBe(eligibleFinalFamilies.length);
    expect(new Set(finalItemFamilies.keys()))
      .toEqual(new Set(eligibleFinalFamilies.map((family) => family.familyId)));
    for (const [familyId, count] of finalItemFamilies) {
      expect(count / SCHEDULES, `${familyId} share of final items`).toBeLessThan(0.75);
    }
  }, 300_000);

  it("spends a band's leftover questions only where they reach a new bucket", () => {
    // A leftover question is redirected only when some drawn family has more
    // validated buckets in this band than the base share `floor(questions /
    // families drawn)` already gives it. The rule was added on 2026-08-26 to
    // guarantee the d6 tail; withdrawing both d6 buckets a day later left no
    // band where it applies, so it currently redirects nothing anywhere. It is
    // kept rather than reverted because the property is worth having on its own
    // — a repeated family should show a bucket nobody has been asked yet — and
    // it starts working again the moment any family holds two buckets in one
    // band. This walks every band of both lengths so that change surfaces here
    // rather than as a quietly drifting analogy mean.
    const biting: string[] = [];
    for (const profile of EXPANDED_PROFILES) {
      for (const band of EXPANDED_PROFILE_BANDS) {
        const eligible = eligibleFamiliesForBand(REGISTRY, band);
        const drawn = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible.length, eligible.length);
        const base = Math.floor(BAND_SCHEDULE[profile][band] / drawn);
        const deepest = Math.max(...eligible.map((family) => family.bandBuckets.length));
        // Any draw can only be made of eligible families, so the deepest bucket
        // count in the pool bounds what any draw of it can ask for.
        const hasLeftover = BAND_SCHEDULE[profile][band] % drawn > 0;
        if (hasLeftover && base > 0 && base < deepest) biting.push(`${profile} ${band}`);
      }
    }
    expect(biting).toEqual([]);

    // ...and the rule itself still does what it says when it does apply. Three
    // questions over two drawn families gives a base share of 1 each with one
    // left over. `deep` holds two buckets here, so its second question reaches
    // a bucket the base share never would; `flat` holds one, so a second
    // question would only repeat its first. The leftover must go to `deep`
    // every time, never to a coin toss.
    const deep = { familyId: "deep", bandBuckets: [{ bucket: "deep-d4", difficulty: 4 }, { bucket: "deep-d5", difficulty: 5 }] };
    const flat = { familyId: "flat", bandBuckets: [{ bucket: "flat-d4", difficulty: 4 }] };
    for (let seed = 0; seed < 50; seed++) {
      const split = evenSplit(3, [deep, flat] as never, seededRng("leftover-rule", `${seed}`));
      expect(split.get("deep"), `seed ${seed}`).toBe(2);
      expect(split.get("flat"), `seed ${seed}`).toBe(1);
    }
  });
});

describe("public item ids", () => {
  it("never leaks the generation seed", () => {
    // Embedding the seed in the id let anyone brute-force four hex digits and
    // regenerate the whole quiz, answers included.
    // Still deterministic — the same seed replays the same ids — which the
    // deterministic-assembly test above proves by replaying this very quiz.
    for (const profile of EXPANDED_PROFILES) {
      const quiz = sharedQuiz(profile);
      for (const puzzle of quiz) {
        expect(puzzle.id).not.toContain(SHARED_SEED);
        expect(puzzle.id).not.toContain(SHARED_SEED.slice(0, 8));
      }
      const ids = quiz.map((puzzle) => puzzle.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("cross-band family draws", () => {
  // A family may be registered in two bands. Drawing it into both spends two of
  // a short test's five distinct families on one mechanism, so the seeded draw
  // skips it in the later band whenever another eligible family is free.
  const band = (
    name: (typeof EXPANDED_PROFILE_BANDS)[number],
    validatedDifficultyBuckets: readonly string[],
  ) => ({
    band: name,
    state: "code-valid" as const,
    validatedDifficultyBuckets,
    perItemTimeBudgetSeconds: BAND_TIME_BUDGET_SECONDS[name],
    fallbackAvailable: false,
  });

  const filler = (prefix: string, bandName: (typeof EXPANDED_PROFILE_BANDS)[number], count: number, difficulty: number) =>
    Array.from({ length: count }, (_, index) => ({
      familyId: `${prefix}-${index}-v1`,
      primaryReasoningFamily: prefix,
      bands: [band(bandName, [`${prefix}-${index}-d${difficulty}`])],
    }));

  /**
   * `shared-v1` sits in both composition and constraint-spatial.
   * `constraintAlternatives` is how many other families constraint-spatial can
   * draw instead of it.
   */
  const registryWith = (constraintAlternatives: number, warmupFamilies: number): FamilyPromotionRegistry => [
    ...filler("warm", "warmup", warmupFamilies, 2),
    {
      familyId: "shared-v1",
      primaryReasoningFamily: "analogical-transformation",
      bands: [band("composition", ["shared-d3"]), band("constraint-spatial", ["shared-d4"])],
    },
    ...filler("comp", "composition", 3, 3),
    ...filler("spatial", "constraint-spatial", constraintAlternatives, 4),
    ...filler("induct", "induction-transfer", 3, 5),
  ];

  it("keeps one family out of two bands of the same test when alternatives exist", () => {
    // A short-5 test must contain five distinct families, one per question, so
    // a cross-band repeat would make the test unbuildable rather than merely
    // repetitive. constraint-spatial can draw three of its four families here,
    // so the draw has room to leave the composition family alone.
    const registry = registryWith(3, 2);
    for (let seed = 0; seed < 50; seed++) {
      const schedule = planExpandedSchedule(`cross-band-${seed}`, "short-5", registry);
      const bandsUsed = new Set(schedule.filter((slot) => slot.familyId === "shared-v1").map((slot) => slot.band));
      expect(bandsUsed.size, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(new Set(schedule.map((slot) => slot.familyId)).size, `seed ${seed}`).toBe(5);
    }
  });

  it("still fills the band from used families when nothing else is left", () => {
    // The preference is soft on purpose: a thinner band is worse than a
    // repeated mechanism. Here constraint-spatial draws three families from a
    // pool of exactly three, so the composition family is drawn again.
    const registry = registryWith(2, 5);
    const schedule = planExpandedSchedule("cross-band-forced", "long-30", registry);
    const bandsUsed = new Set(schedule.filter((slot) => slot.familyId === "shared-v1").map((slot) => slot.band));
    expect([...bandsUsed].sort()).toEqual(["composition", "constraint-spatial"]);
  });
});
