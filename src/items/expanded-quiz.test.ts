import { describe, expect, it } from "vitest";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, EXPANDED_PROFILE_BANDS, type FamilyPromotionRegistry } from "./family-promotion";
import {
  assembleExpandedQuiz, assembleExpandedTest, assertProfilesRemainBuildable, bucketDifficulty, fillExpandedSlots,
  buildExpandedQuestion, drawExpandedSlot, type AssembledTest,
  EXPANDED_GENERATOR_VERSION, EXPANDED_PROFILES, EXPANDED_SLOT_RETRY_BUDGET,
  eligibleFamiliesForBand, eligibleFamiliesForDifficulty, familyQuestionLimit, isAnalogyLayoutFamily,
  maximumDistinctFamilies, MAXIMUM_FAMILY_QUESTIONS, MINIMUM_DISTINCT_FAMILIES, RAMPED_FAMILIES,
  planExpandedSchedule, questionCount, questionFingerprint, sceneFamilyLayout, SLOT_DIFFICULTIES,
  type ExpandedProfile,
} from "./expanded-quiz";
import { OPTIONS_PER_ITEM, PuzzleSchema, PuzzleSetSchema, sceneSignature, type PuzzleSet } from "./schema";
import { generateSceneFamilyCandidate, requireSceneFamilyBucket, sceneFamilyBucketsFor, type SceneFamilyId } from "./scene-families";
import { seededRng } from "../lib/rng";

const REGISTRY = CURRENT_FAMILY_PROMOTION_REGISTRY;
const eligibleFamilyIds = [...new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
  eligibleFamiliesForBand(REGISTRY, band).map((family) => family.familyId)))].sort();
function expectFixedDifficulties(items: readonly { difficulty: number }[], profile: ExpandedProfile): void {
  expect(items.map((item) => item.difficulty)).toEqual(SLOT_DIFFICULTIES[profile]);
}
function expectIncreasingDifficulty(items: readonly { difficulty: number }[]): void {
  const difficulties = items.map((item) => item.difficulty);
  expect(difficulties).toEqual([...difficulties].sort((left, right) => left - right));
  expect(items.at(-1)!.difficulty).toBe(Math.max(...difficulties));
}
const SHARED_SEED = "0123456789abcdef0123456789abcdef";
/** Every level a family has a validated bucket at. */
function servedLevels(familyId: string): number[] {
  return [2, 3, 4, 5].filter((difficulty) =>
    eligibleFamiliesForDifficulty(REGISTRY, difficulty).some((slot) => slot.familyId === familyId));
}
const sharedTests = new Map<ExpandedProfile, AssembledTest>();
function sharedTest(profile: ExpandedProfile): AssembledTest {
  let test = sharedTests.get(profile);
  if (!test) {
    test = assembleExpandedTest(SHARED_SEED, profile, REGISTRY);
    sharedTests.set(profile, test);
  }
  return test;
}
function sharedQuiz(profile: ExpandedProfile): PuzzleSet {
  return sharedTest(profile).puzzles;
}

describe("validated family pools and generated questions", () => {
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
      expect(byBand[index].length, band).toBeGreaterThan(0);
    });
    expect(byBand.flat().every((family) => family.difficulty >= 2 && family.difficulty <= 5)).toBe(true);

    const composition = eligibleFamiliesForBand(REGISTRY, "composition").map((f) => f.familyId);
    expect(composition).not.toContain("spatial-transform-v2");
    expect(eligibleFamiliesForBand(REGISTRY, "warmup").map((f) => f.familyId))
      .toContain("spatial-transform-v2");
  });

  it("holds exactly the twenty-one family/band/bucket keys the battery serves", () => {
    // v34 adds six matrix buckets and a d5 spatial overlap ramp; v39 the one-gate machine.
    const keys = EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(REGISTRY, band).flatMap((family) =>
        family.bandBuckets.map((bucket) => `${family.familyId}:${band}:${bucket.bucket}`)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(21);
    expect(EXPANDED_PROFILE_BANDS.map((band) => eligibleFamiliesForBand(REGISTRY, band).length))
      .toEqual([5, 6, 4, 3]);
    expect(keys.some((key) => key.startsWith("spatial-assembly-v1:"))).toBe(false);
    // No key is d6 any more. The two that were are withdrawn, so the ladder
    // tops out at d5 until a mechanism earns a sixth rung some way other than
    // by adding gates — the lever the owner ruled out on 2026-08-27.
    expect(keys.filter((key) => key.endsWith("-d6"))).toEqual([]);
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

  it("keeps one-step mechanisms below d4 and reserves the final band for three steps", () => {
    const served = EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(REGISTRY, band).flatMap((family) =>
        family.bandBuckets.map((bucket) => ({
          band,
          familyId: family.familyId,
          bucket: requireSceneFamilyBucket(family.familyId as SceneFamilyId, bucket.bucket),
        }))));
    const oneStep = served.filter((entry) => entry.bucket.programDepth === 1);
    expect(oneStep.length).toBeGreaterThan(0);
    const existingOneStep = oneStep.filter((entry) => entry.familyId !== "overlapping-figures-v1");
    expect(existingOneStep.every((entry) => entry.band === "warmup" && entry.bucket.difficulty === 2)).toBe(true);
    expect(oneStep.filter((entry) => entry.familyId === "overlapping-figures-v1")
      .map((entry) => ({ band: entry.band, difficulty: entry.bucket.difficulty })))
      .toEqual([{ band: "composition", difficulty: 3 }]);

    const hardTransforms = served.filter((entry) => entry.band === "induction-transfer");
    expect(hardTransforms.map((entry) => entry.familyId).sort())
      .toEqual(["composed-transform-v2", "overlapping-figures-v1", "transformation-machine-v4"]);
    expect(hardTransforms.every((entry) => entry.bucket.programDepth === 3)).toBe(true);
  });

  it("drops withdrawn families", () => {
    const withdrawn = new Set(["attribute-pairing-v1"]);
    expect(eligibleFamiliesForBand(REGISTRY, "warmup", withdrawn).map((f) => f.familyId))
      .toEqual(["attribute-matrix-v1", "composed-transform-v2", "relational-sequence-v2", "spatial-transform-v2"]);
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
        const identities = puzzle.options.map(sceneSignature);
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

  it("rejects an empty seed", () => {
    expect(() => assembleExpandedQuiz("", "short-5", REGISTRY)).toThrow(/seed must not be empty/);
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
      const mostPerFamily = MAXIMUM_FAMILY_QUESTIONS["long-30"];
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

  for (const profile of EXPANDED_PROFILES) {
    it(`assembles a deterministic ${profile} test from code-valid families`, () => {
      const first = sharedQuiz(profile);
      const replay = assembleExpandedQuiz(SHARED_SEED, profile, REGISTRY);

      expect(replay).toEqual(first);
      expect(PuzzleSetSchema.safeParse(first).success).toBe(true);
      expect(first).toHaveLength(questionCount(profile));
      expectFixedDifficulties(first, profile);
      expectIncreasingDifficulty(first);
      expect(first.every((puzzle) =>
        puzzle.generation!.generatorVersion === EXPANDED_GENERATOR_VERSION)).toBe(true);
      expect(first.every((puzzle) =>
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

    it(`rebuilds each ${profile} question alone, from the attempt its slot kept`, () => {
      const { puzzles, attempts } = sharedTest(profile);
      expect(attempts).toHaveLength(questionCount(profile));
      attempts.forEach((attempt, slot) => {
        expect(buildExpandedQuestion(SHARED_SEED, profile, slot, attempt, REGISTRY), `question ${slot + 1}`)
          .toEqual(puzzles[slot]);
      });
    }, 60_000);

    it(`fills the ${profile} test over several sittings into the very test built at once`, () => {
      // Each sitting resumes from what the earlier ones kept, as across requests.
      const progress = { attempts: [] as number[], questions: [] as string[] };
      const puzzles: unknown[] = [];
      let sittings = 0;
      while (progress.attempts.length < questionCount(profile)) {
        sittings += 1;
        const resumed = JSON.parse(JSON.stringify(progress)) as typeof progress;
        let filledThisSitting = 0;
        for (const filled of fillExpandedSlots(SHARED_SEED, profile, REGISTRY, new Set(), resumed)) {
          progress.attempts.push(filled.attempt);
          progress.questions.push(filled.question);
          puzzles.push(filled.puzzle);
          if (++filledThisSitting === 2) break;
        }
      }
      expect(sittings).toBe(Math.ceil(questionCount(profile) / 2));
      expect(progress.attempts).toEqual(sharedTest(profile).attempts);
      expect(PuzzleSetSchema.parse(puzzles)).toEqual(sharedTest(profile).puzzles);
    }, 60_000);
  }

  it("ramps machine tables through a 30-question test: one gate, then two, then three", () => {
    // Owner, 2026-10-15: machine questions used to arrive only near the end.
    expect(servedLevels("composed-transform-v2")).toEqual([2, 4, 5]);
    const machines = sharedQuiz("long-30").flatMap((puzzle, index) =>
      puzzle.generation!.familyId === "composed-transform-v2"
        ? [{ question: index + 1, difficulty: puzzle.difficulty, gates: puzzle.stem.length / 3 - 1 }]
        : []);
    for (const machine of machines) expect(machine.gates).toBe({ 2: 1, 4: 2, 5: 3 }[machine.difficulty]);
    const firstWith = (gates: number) => machines.find((machine) => machine.gates === gates)!.question;
    expect(firstWith(1)).toBeLessThanOrEqual(5);
    expect(firstWith(1)).toBeLessThan(firstWith(2));
    expect(firstWith(2)).toBeLessThan(firstWith(3));
  });

  it("builds the attempt it is given, and refuses a question the test does not have", () => {
    // Every slot of the shared tests kept its first attempt, so take a later
    // attempt that also passes: built alone, it must be that draw, not the first.
    const schedule = planExpandedSchedule(SHARED_SEED, "short-5", REGISTRY);
    const later = schedule.flatMap((selected, slot) => {
      const draw = drawExpandedSlot(SHARED_SEED, "short-5", slot, 1, selected);
      return draw.accepted ? [{ slot, puzzle: draw.puzzle }] : [];
    })[0];
    expect(later).toBeDefined();
    const built = buildExpandedQuestion(SHARED_SEED, "short-5", later.slot, 1, REGISTRY);
    expect(built).toEqual(PuzzleSchema.parse(later.puzzle));
    expect(built).not.toEqual(sharedQuiz("short-5")[later.slot]);
    expect(() => buildExpandedQuestion(SHARED_SEED, "short-5", 5, 0, REGISTRY)).toThrow(/no question 6/);
  }, 30_000);

});

describe("fixed difficulty slots", () => {
  it("hardcodes both difficulty curves independently of the seed", () => {
    expect(EXPANDED_GENERATOR_VERSION).toBe("scene-families-v39");
    expect(SLOT_DIFFICULTIES["short-5"]).toEqual([2, 3, 4, 4, 5]);
    expect(SLOT_DIFFICULTIES["long-30"]).toEqual([
      ...Array(5).fill(2), ...Array(4).fill(3), ...Array(13).fill(4), ...Array(8).fill(5),
    ]);
    for (const profile of EXPANDED_PROFILES) {
      expect(questionCount(profile)).toBe(profile === "long-30" ? 30 : 5);
      expectFixedDifficulties(sharedQuiz(profile), profile);
    }
  });

  it("offers only validated buckets at a slot's exact difficulty", () => {
    for (const difficulty of [2, 3, 4, 5]) {
      const pool = eligibleFamiliesForDifficulty(REGISTRY, difficulty);
      expect(pool.length).toBeGreaterThan(1);
      for (const slot of pool) {
        expect(slot.difficulty).toBe(difficulty);
        expect(requireSceneFamilyBucket(slot.familyId as SceneFamilyId, slot.difficultyBucket).difficulty)
          .toBe(difficulty);
        expect(REGISTRY.find((family) => family.familyId === slot.familyId)!.bands
          .find((band) => band.band === slot.band)!.validatedDifficultyBuckets).toContain(slot.difficultyBucket);
      }
    }
  });

  it("varies every slot's family while preserving fixed difficulties, coverage and bounded repeats", () => {
    const enabled = new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(REGISTRY, band).map((slot) => slot.familyId)));
    for (const profile of EXPANDED_PROFILES) {
      const positions = SLOT_DIFFICULTIES[profile].map(() => new Set<string>());
      const firstFamilies = new Map<string, number>();
      const seenKeys = new Set<string>();
      for (let seed = 0; seed < 10_000; seed++) {
        const schedule = planExpandedSchedule(`fixed-slots-${seed}`, profile, REGISTRY);
        expectFixedDifficulties(schedule, profile);
        const families = schedule.map((slot) => slot.familyId);
        const distinct = new Set(families);
        expect(distinct.size).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_FAMILIES[profile]);
        if (profile === "long-30") expect(distinct).toEqual(enabled);
        const counts = new Map<string, number>();
        schedule.forEach((slot, index) => {
          positions[index].add(slot.familyId);
          seenKeys.add(`${slot.familyId}:${slot.band}:${slot.difficultyBucket}`);
          counts.set(slot.familyId, (counts.get(slot.familyId) ?? 0) + 1);
          if (index > 0) expect(slot.familyId).not.toBe(schedule[index - 1].familyId);
        });
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(MAXIMUM_FAMILY_QUESTIONS[profile]);
        for (const [familyId, count] of counts) expect(count).toBeLessThanOrEqual(familyQuestionLimit(profile, familyId));
        // The owner's order of 2026-10-15: the growing-jump sequence only among
        // the first ten questions, and machine tables at every level they serve.
        schedule.forEach((slot, index) => {
          if (slot.familyId === "second-order-sequence-v2") expect(index).toBeLessThan(10);
        });
        if (profile === "long-30") {
          for (const familyId of RAMPED_FAMILIES) {
            expect(new Set(schedule.filter((slot) => slot.familyId === familyId).map((slot) => slot.difficulty)))
              .toEqual(new Set(servedLevels(familyId)));
          }
        }
        firstFamilies.set(families[0], (firstFamilies.get(families[0]) ?? 0) + 1);
      }
      for (const [index, families] of positions.entries()) {
        const eligible = new Set(eligibleFamiliesForDifficulty(REGISTRY, SLOT_DIFFICULTIES[profile][index])
          .map((slot) => slot.familyId));
        expect(families, `${profile} slot ${index + 1}`).toEqual(eligible);
      }
      expect(firstFamilies.size).toBe(new Set(eligibleFamiliesForDifficulty(REGISTRY, 2).map((slot) => slot.familyId)).size);
      for (const count of firstFamilies.values()) {
        expect(count).toBeGreaterThan(1500);
        expect(count).toBeLessThan(3500);
      }
      if (profile === "long-30") {
        const expectedKeys = new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
          eligibleFamiliesForBand(REGISTRY, band).flatMap((slot) =>
            slot.bandBuckets.map((bucket) => `${slot.familyId}:${band}:${bucket.bucket}`))));
        expect(seenKeys).toEqual(expectedKeys);
      }
    }
  }, 300_000);

  it("does not give a family an extra chance when the same difficulty is registered in two bands", () => {
    const duplicated = REGISTRY.map((family) => family.familyId !== "attribute-pairing-v1" ? family : {
      ...family,
      bands: [...family.bands, { band: "composition" as const, state: "code-valid" as const,
        validatedDifficultyBuckets: ["attribute-pairing-d2"] }],
    });
    for (const profile of EXPANDED_PROFILES) {
      for (let seed = 0; seed < 40; seed++) {
        expect(planExpandedSchedule(`duplicate-band-${seed}`, profile, duplicated).map((slot) => slot.familyId))
          .toEqual(planExpandedSchedule(`duplicate-band-${seed}`, profile, REGISTRY).map((slot) => slot.familyId));
      }
    }
  });

  it("replays the same family and bucket choices for the same seed", () => {
    for (const profile of EXPANDED_PROFILES) {
      const first = planExpandedSchedule("slot-replay", profile, REGISTRY);
      expect(planExpandedSchedule("slot-replay", profile, REGISTRY)).toEqual(first);
      expect(planExpandedSchedule("different-slot-seed", profile, REGISTRY)).not.toEqual(first);
    }
  });

  it("keeps both profiles buildable after any one family withdrawal without changing a slot difficulty", () => {
    expect(() => assertProfilesRemainBuildable(REGISTRY, new Set())).not.toThrow();
    for (const family of REGISTRY) {
      const withdrawn = new Set([family.familyId]);
      expect(() => assertProfilesRemainBuildable(REGISTRY, withdrawn), family.familyId).not.toThrow();
      for (const profile of EXPANDED_PROFILES) {
        for (let seed = 0; seed < 40; seed++) {
          const schedule = planExpandedSchedule(`withdrawal-slot-${seed}`, profile, REGISTRY, withdrawn);
          expectFixedDifficulties(schedule, profile);
          expect(schedule.some((slot) => slot.familyId === family.familyId)).toBe(false);
          expect(schedule.some((slot) => slot.familyId === "spatial-assembly-v1")).toBe(false);
          if (profile === "long-30") {
            const enabled = new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
              eligibleFamiliesForBand(REGISTRY, band, withdrawn).map((slot) => slot.familyId)));
            expect(new Set(schedule.map((slot) => slot.familyId))).toEqual(enabled);
          }
        }
      }
    }
  }, 60_000);

  it("refuses an empty difficulty pool rather than filling its slots at another level", () => {
    const withdrawn = new Set(["attribute-matrix-v1", "overlapping-figures-v1", "compositional-analogy-v2",
      "second-order-sequence-v2"]);
    expect(() => planExpandedSchedule("missing-d3", "short-5", REGISTRY, withdrawn))
      .toThrow(/needs at least 1 eligible d3 families but has 0/);
    expect(() => assertProfilesRemainBuildable(REGISTRY, withdrawn))
      .toThrow(/WITHDRAWN_FAMILY_IDS has left the test unbuildable/);
  });

  it("refuses a repeated difficulty tier that has only one family instead of moving a harder question forward", () => {
    const withdrawn = new Set(["attribute-matrix-v1", "overlapping-figures-v1", "second-order-sequence-v2"]);
    expect(() => planExpandedSchedule("one-d3-family", "long-30", REGISTRY, withdrawn))
      .toThrow(/needs at least 2 eligible d3 families but has 1/);
  });

  it("counts families shared across levels once when checking distinct coverage", () => {
    expect(maximumDistinctFamilies("long-30", REGISTRY)).toBe(12);
    expect(maximumDistinctFamilies("short-5", REGISTRY)).toBe(5);
    const registry: FamilyPromotionRegistry = [
      { familyId: "shared", primaryReasoningFamily: "shared", bands: [
        { band: "warmup", state: "code-valid", validatedDifficultyBuckets: ["shared-d2"] },
        { band: "composition", state: "code-valid", validatedDifficultyBuckets: ["shared-d3"] },
      ] },
      ...["left", "right"].map((familyId) => ({ familyId, primaryReasoningFamily: familyId, bands: [
        { band: "constraint-spatial" as const, state: "code-valid" as const,
          validatedDifficultyBuckets: [`${familyId}-d4`] },
      ] })),
      { familyId: "last", primaryReasoningFamily: "last", bands: [
        { band: "induction-transfer", state: "code-valid", validatedDifficultyBuckets: ["last-d5"] },
      ] },
    ];
    expect(maximumDistinctFamilies("short-5", registry)).toBe(4);
    expect(() => planExpandedSchedule("thin-distinct", "short-5", registry))
      .toThrow(/needs at least 5 distinct families but has 4/);
  });
});
