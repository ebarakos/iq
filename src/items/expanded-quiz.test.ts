import { describe, expect, it } from "vitest";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
} from "./family-promotion";
import {
  assembleExpandedQuiz,
  assertProfilesRemainBuildable,
  BAND_SCHEDULE,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  FAMILY_SUBSAMPLE_SIZES,
  eligibleFamiliesForBand,
  MINIMUM_DISTINCT_FAMILIES,
  planExpandedSchedule,
  questionCount,
  type ExpandedProfile,
} from "./expanded-quiz";
import { OPTIONS_PER_ITEM, VisualPuzzleSetSchema, visualElementSignature } from "./schema";

const REGISTRY = CURRENT_FAMILY_PROMOTION_REGISTRY;

function bandOrder(profile: ExpandedProfile): string[] {
  return EXPANDED_PROFILE_BANDS.flatMap((band) =>
    new Array(BAND_SCHEDULE[profile][band]).fill(band) as string[]);
}

describe("eligible family pool", () => {
  it("offers every code-valid family, each only in its registered band", () => {
    const byBand = EXPANDED_PROFILE_BANDS.map((band) => eligibleFamiliesForBand(REGISTRY, band));
    expect(byBand.map((families) => families.length)).toEqual([3, 7, 5, 4]);
    expect(byBand.flat()).toHaveLength(19);
    expect(byBand.flat().every((family) => family.difficulty >= 2 && family.difficulty <= 5)).toBe(true);

    const composition = eligibleFamiliesForBand(REGISTRY, "composition").map((f) => f.familyId);
    expect(composition).toContain("spatial-transform-v2");
    expect(eligibleFamiliesForBand(REGISTRY, "warmup").map((f) => f.familyId))
      .not.toContain("spatial-transform-v2");
  });

  it("drops withdrawn families", () => {
    const withdrawn = new Set(["relational-outlier-v2"]);
    expect(eligibleFamiliesForBand(REGISTRY, "warmup", withdrawn).map((f) => f.familyId))
      .toEqual(["attribute-pairing-v1", "relational-sequence-v2"]);
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
      const first = assembleExpandedQuiz(`${profile}-scenes`, profile, REGISTRY);
      const replay = assembleExpandedQuiz(`${profile}-scenes`, profile, REGISTRY);

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
    });
  }

  it("keeps coverage, spread, and ramp invariants across many schedules", () => {
    for (const profile of EXPANDED_PROFILES) {
      for (let seed = 0; seed < 12; seed++) {
        const quiz = assembleExpandedQuiz(`schedule-${seed}`, profile, REGISTRY);
        const familyIds = quiz.map((puzzle) => puzzle.generation!.familyId);

        expect(new Set(familyIds).size).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_FAMILIES[profile]);
        for (let index = 1; index < familyIds.length; index++) {
          expect(familyIds[index]).not.toBe(familyIds[index - 1]);
        }

        // Even split: no family may take more than its share of a band.
        for (const band of EXPANDED_PROFILE_BANDS) {
          const inBand = quiz.filter((puzzle) => puzzle.band === band);
          const eligible = eligibleFamiliesForBand(REGISTRY, band).length;
          const pool = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible, eligible);
          const cap = Math.ceil(BAND_SCHEDULE[profile][band] / pool);
          const counts = new Map<string, number>();
          for (const puzzle of inBand) {
            const id = puzzle.generation!.familyId;
            counts.set(id, (counts.get(id) ?? 0) + 1);
          }
          expect(Math.max(...counts.values())).toBeLessThanOrEqual(cap);
        }

        // Rising ramp: each band's floor is at least the previous band's floor,
        // and inside a band the repeat rule may cost at most two dips.
        let previousFloor = 0;
        for (const band of EXPANDED_PROFILE_BANDS) {
          const difficulties = quiz
            .filter((puzzle) => puzzle.band === band)
            .map((puzzle) => puzzle.difficulty);
          const floor = Math.min(...difficulties);
          expect(floor).toBeGreaterThanOrEqual(previousFloor);
          previousFloor = floor;
          const dips = difficulties.filter((value, index) =>
            index > 0 && value < difficulties[index - 1]).length;
          expect(dips).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("draws a seeded eligible subset for each non-warmup band", () => {
    const seenByBand = new Map(
      EXPANDED_PROFILE_BANDS.map((band) => [band, new Set<string>()]),
    );

    for (let seed = 0; seed < 24; seed++) {
      const schedule = planExpandedSchedule(`pool-${seed}`, "long-30", REGISTRY);
      for (const band of EXPANDED_PROFILE_BANDS) {
        const eligible = eligibleFamiliesForBand(REGISTRY, band).map((family) => family.familyId);
        const drawn = schedule
          .filter((entry) => entry.band === band)
          .map((entry) => entry.familyId);
        const drawnIds = new Set(drawn);
        const target = FAMILY_SUBSAMPLE_SIZES[band] ?? eligible.length;

        expect(drawnIds.size).toBe(Math.min(target, eligible.length));
        expect([...drawnIds].every((familyId) => eligible.includes(familyId))).toBe(true);
        for (const familyId of drawnIds) seenByBand.get(band)!.add(familyId);
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
      const quiz = assembleExpandedQuiz(`options-${profile}`, profile, REGISTRY);
      for (const puzzle of quiz) {
        expect(puzzle.options.length, `${profile} ${puzzle.familyId}`).toBe(OPTIONS_PER_ITEM);
      }
    }
  });

  it("gives every option a distinct visual identity", () => {
    // The agent harness shuffles options and maps the model's pick back by this
    // identity, so two options that share one would silently mis-score a run.
    for (const profile of EXPANDED_PROFILES) {
      const quiz = assembleExpandedQuiz(`identity-${profile}`, profile, REGISTRY);
      for (const puzzle of quiz) {
        const identities = puzzle.options.map(visualElementSignature);
        expect(new Set(identities).size).toBe(identities.length);
      }
    }
  });

  it("plans the whole family schedule before generating anything", () => {
    const schedule = planExpandedSchedule("plan-only", "long-30", REGISTRY);
    expect(schedule).toHaveLength(30);
    expect(schedule.map((entry) => entry.band)).toEqual(bandOrder("long-30"));
  });

  it("refuses a long test when withdrawals leave a band too thin", () => {
    const withdrawn = new Set(["relational-outlier-v2", "attribute-pairing-v1"]);
    expect(() => assembleExpandedQuiz("thin-warmup", "long-30", REGISTRY, withdrawn))
      .toThrow(/at least 2 eligible warmup families but has 1/);
  });

  it("refuses a short test when a band has no family left", () => {
    const withdrawn = new Set([
      "relational-sequence-v2",
      "relational-outlier-v2",
      "attribute-pairing-v1",
    ]);
    expect(() => assembleExpandedQuiz("no-warmup", "short-5", REGISTRY, withdrawn))
      .toThrow(/at least 1 eligible warmup families but has 0/);
  });

  it("refuses to start when withdrawals leave a band too thin", () => {
    expect(() => assertProfilesRemainBuildable(REGISTRY, new Set())).not.toThrow();
    expect(() => assertProfilesRemainBuildable(
      REGISTRY,
      new Set(["relational-outlier-v2", "attribute-pairing-v1"]),
    ))
      .toThrow(/long-30 needs 2 warmup families but only 1 remain/);
    expect(() => assertProfilesRemainBuildable(
      REGISTRY,
      new Set(["relational-sequence-v2", "relational-outlier-v2", "attribute-pairing-v1"]),
    )).toThrow(/short-5 needs 1 warmup families but only 0 remain/);
  });

  it("rejects an empty seed", () => {
    expect(() => assembleExpandedQuiz("", "short-5", REGISTRY)).toThrow(/seed must not be empty/);
  });
});

describe("public item ids", () => {
  it("never leaks the generation seed", () => {
    // Embedding the seed in the id let anyone brute-force four hex digits and
    // regenerate the whole quiz, answers included.
    const seed = "0123456789abcdef0123456789abcdef";
    for (const profile of EXPANDED_PROFILES) {
      const quiz = assembleExpandedQuiz(seed, profile, REGISTRY);
      for (const puzzle of quiz) {
        expect(puzzle.id).not.toContain(seed);
        expect(puzzle.id).not.toContain(seed.slice(0, 8));
      }
      const ids = quiz.map((puzzle) => puzzle.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Still deterministic: the same seed replays the same ids.
      expect(assembleExpandedQuiz(seed, profile, REGISTRY).map((p) => p.id)).toEqual(ids);
    }
  });
});
