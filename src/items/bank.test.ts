import { describe, expect, it } from "vitest";
import {
  BANK_ITEMS_PER_KEY,
  bankIdFor,
  enabledExpandedBankKeys,
  expandedBankCoverage,
  expandedBankKey,
  expandedBankKeyOf,
  fingerprintPuzzle,
  loadBank,
  sampleExpandedBankQuiz,
  sampleQuiz,
} from "./bank";
import {
  BAND_SCHEDULE,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  FAMILY_SUBSAMPLE_SIZES,
  eligibleFamiliesForBand,
  MINIMUM_DISTINCT_FAMILIES,
  planExpandedSchedule,
} from "./expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
  readWithdrawnFamilyIds,
} from "./family-promotion";
import { PuzzleSetSchema, shuffleOptions } from "./schema";

const REGISTRY = CURRENT_FAMILY_PROMOTION_REGISTRY;

describe("fingerprintPuzzle", () => {
  const base = loadBank()[0].puzzle;

  it("is invariant under option shuffling", () => {
    for (let i = 0; i < 20; i++) {
      expect(fingerprintPuzzle(shuffleOptions(base))).toBe(fingerprintPuzzle(base));
    }
  });

  it("changes when the marked answer changes", () => {
    // Any banked item will do. This used to reach for an oddOneOut item, which
    // stopped existing on 2026-08-23 when the last odd-one-out family was
    // withdrawn — the assertion is about the fingerprint, not about a type.
    const item = loadBank()[0]!.puzzle;
    const otherIndex = item.options.findIndex((_, i) => i !== item.answerIndex);
    expect(otherIndex).toBeGreaterThanOrEqual(0);
    expect(fingerprintPuzzle({ ...item, answerIndex: otherIndex })).not.toBe(fingerprintPuzzle(item));
  });

  it("prefixes ids by type", () => {
    expect(bankIdFor(base)).toMatch(/^(mx|sq|an|oo)-[0-9a-f]{10}$/);
  });
});

describe("loadBank", () => {
  it("parses the expanded emergency bank with current replay provenance", () => {
    const items = loadBank();
    // Sized by the eligible family list, which shrinks whenever a family is
    // withdrawn. A hardcoded floor just goes stale with every withdrawal, and a
    // count-only check would pass with the wrong families — compare the id sets.
    const eligibleIds = CURRENT_FAMILY_PROMOTION_REGISTRY.filter((family) =>
      family.bands.some((band) => band.state !== "prototype" && band.validatedDifficultyBuckets.length > 0))
      .map((family) => family.familyId)
      .sort();
    expect(items.length).toBeGreaterThanOrEqual(eligibleIds.length);
    expect([...new Set(items.map((item) => item.puzzle.familyId))].sort()).toEqual(eligibleIds);
    for (const item of items) {
      expect(item.provenance).toMatchObject({
        source: "expanded",
        generatorVersion: EXPANDED_GENERATOR_VERSION,
      });
      // The top-up draws on both public lengths and records which one each item
      // came from, so a key no length reaches is caught rather than silently
      // left thin. In v16 a long test reaches all 16 keys on its own and a
      // short one reaches 13. A 5-question test asks each band for
      // one or two questions, so it only ever gets a family's entry-point
      // bucket.
      expect(EXPANDED_PROFILES).toContain(item.provenance.profile);
      expect(typeof item.provenance.seed).toBe("string");
      expect(item.puzzle.generation?.generatorVersion).toBe(EXPANDED_GENERATOR_VERSION);
    }
  });

  it("holds exactly five items for every family, band, and bucket the registry can schedule", () => {
    const coverage = expandedBankCoverage(
      loadBank(),
      CURRENT_FAMILY_PROMOTION_REGISTRY,
      readWithdrawnFamilyIds(),
    );
    expect(coverage.short).toEqual([]);
    expect(coverage.strays).toEqual([]);
    expect([...coverage.countsByKey.values()].every((have) => have === BANK_ITEMS_PER_KEY)).toBe(true);
    // The v16 battery has 16 enabled keys, each stocked for the five times a
    // constraint family can appear in one long test.
    expect(coverage.countsByKey.size).toBe(16);
    expect(loadBank()).toHaveLength(coverage.countsByKey.size * BANK_ITEMS_PER_KEY);
  });
});

describe("expanded bank coverage", () => {
  it("stocks enough of every key that no schedule can reach the fallback ladder", () => {
    // Two facts together make the ladder below the exact-key rung dead code on
    // a freshly built bank, and neither depends on a lucky sampling run.
    //
    // One: the bank holds BANK_ITEMS_PER_KEY items for every enabled key
    // (asserted above). Two: no schedule can ask for one key more times than
    // that. A band splits its questions as evenly as its draw allows, so the
    // most any one family gets is ceil(questions / families drawn) — and a key
    // is at most a whole family's share, since a family with several buckets
    // spreads its questions across them.
    for (const profile of EXPANDED_PROFILES) {
      for (const band of EXPANDED_PROFILE_BANDS) {
        const eligible = eligibleFamiliesForBand(REGISTRY, band).length;
        const drawn = Math.min(FAMILY_SUBSAMPLE_SIZES[band] ?? eligible, eligible);
        expect(Math.ceil(BAND_SCHEDULE[profile][band] / drawn), `${profile} ${band}`)
          .toBeLessThanOrEqual(BANK_ITEMS_PER_KEY);
      }
    }

    // And the same thing measured, over the schedules the sampler actually sees.
    for (const profile of EXPANDED_PROFILES) {
      for (let seed = 0; seed < 500; seed++) {
        const counts = new Map<string, number>();
        for (const slot of planExpandedSchedule(`bank-key-load-${seed}`, profile, REGISTRY)) {
          const key = expandedBankKey(slot.familyId, slot.band, slot.difficultyBucket);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        expect(Math.max(...counts.values()), `${profile} seed ${seed}`)
          .toBeLessThanOrEqual(BANK_ITEMS_PER_KEY);
      }
    }
  });

  it("names every key both public lengths can schedule", () => {
    const enabled = new Set(enabledExpandedBankKeys(REGISTRY, readWithdrawnFamilyIds()));
    const scheduled = new Set<string>();
    for (const profile of EXPANDED_PROFILES) {
      for (let seed = 0; seed < 500; seed++) {
        for (const slot of planExpandedSchedule(`bank-key-reach-${seed}`, profile, REGISTRY)) {
          scheduled.add(expandedBankKey(slot.familyId, slot.band, slot.difficultyBucket));
        }
      }
    }
    // Nothing is scheduled that the bank is not stocked for, and nothing is
    // stocked that no schedule can ask for.
    expect([...scheduled].filter((key) => !enabled.has(key))).toEqual([]);
    expect([...enabled].filter((key) => !scheduled.has(key))).toEqual([]);
  });
});

describe("sampleExpandedBankQuiz", () => {
  it.each(EXPANDED_PROFILES)("serves %s with the live band schedule and family constraints", (profile) => {
    const withdrawn = readWithdrawnFamilyIds();
    for (let run = 0; run < 100; run++) {
      const { puzzles, items } = sampleExpandedBankQuiz(
        loadBank(),
        profile,
        `bank-test:${profile}:${run}`,
        CURRENT_FAMILY_PROMOTION_REGISTRY,
        withdrawn,
      );
      expect(PuzzleSetSchema.safeParse(puzzles).success).toBe(true);
      expect(puzzles).toHaveLength(profile === "long-30" ? 30 : 5);
      expect(items.map((item) => item.puzzle.id)).toEqual(puzzles.map((puzzle) => puzzle.id));
      for (const band of Object.keys(BAND_SCHEDULE[profile]) as Array<keyof typeof BAND_SCHEDULE[typeof profile]>) {
        expect(puzzles.filter((puzzle) => puzzle.band === band)).toHaveLength(BAND_SCHEDULE[profile][band]);
      }
      for (let index = 1; index < puzzles.length; index++) {
        expect(puzzles[index].familyId).not.toBe(puzzles[index - 1].familyId);
      }
      // Read from the constant rather than written out: the long floor dropped
      // to eleven on 2026-08-25 so a long test could spend one distinct family
      // on composed-transform-v2 holding both of its bands.
      expect(new Set(puzzles.map((puzzle) => puzzle.familyId)).size)
        .toBeGreaterThanOrEqual(MINIMUM_DISTINCT_FAMILIES[profile]);
    }
  });

  it.each(EXPANDED_PROFILES)("answers every %s slot from its exact bucket", (profile) => {
    // The direct proof that the fallback ladder never runs on a fresh bank:
    // replay the same schedule the sampler used and check, slot by slot, that
    // the item it chose carries that slot's family, band, and bucket. A rung
    // below the first would show up here as a bucket mismatch.
    const withdrawn = readWithdrawnFamilyIds();
    for (let run = 0; run < 100; run++) {
      const seed = `bank-exact-bucket:${profile}:${run}`;
      const schedule = planExpandedSchedule(seed, profile, REGISTRY, withdrawn);
      const { items } = sampleExpandedBankQuiz(loadBank(), profile, seed, REGISTRY, withdrawn);
      expect(items).toHaveLength(schedule.length);
      schedule.forEach((slot, index) => {
        expect(expandedBankKeyOf(items[index].puzzle), `${seed} slot ${index + 1}`)
          .toBe(expandedBankKey(slot.familyId, slot.band, slot.difficultyBucket));
      });
    }
  });
});

describe("sampleQuiz", () => {
  it("returns a valid, ramped, type-diverse quiz aligned with its bank items (100 runs)", () => {
    for (let run = 0; run < 100; run++) {
      const { puzzles, items } = sampleQuiz();
      const parsed = PuzzleSetSchema.safeParse(puzzles);
      expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
      expect(puzzles).toHaveLength(5);

      for (let i = 1; i < puzzles.length; i++) {
        expect(puzzles[i].difficulty).toBeGreaterThanOrEqual(puzzles[i - 1].difficulty);
      }
      expect(new Set(puzzles.map((p) => p.type)).size).toBeGreaterThanOrEqual(3);
      expect(puzzles.some((p) => p.difficulty >= 4)).toBe(true);
      // items[i] is the canonical bank record of puzzles[i]
      expect(items.map((i) => i.puzzle.id)).toEqual(puzzles.map((p) => p.id));
    }
  });

  it("throws when the bank is too small", () => {
    expect(() => sampleQuiz(loadBank().slice(0, 3))).toThrow(/need at least/);
  });

  it("honours difficulty profiles (50 runs each)", () => {
    for (let run = 0; run < 50; run++) {
      const easy = sampleQuiz(loadBank(), 5, "easy");
      expect(Math.max(...easy.puzzles.map((p) => p.difficulty))).toBeLessThanOrEqual(3);
      expect(PuzzleSetSchema.safeParse(easy.puzzles).success).toBe(true);

      const hard = sampleQuiz(loadBank(), 5, "hard");
      expect(Math.min(...hard.puzzles.map((p) => p.difficulty))).toBeGreaterThanOrEqual(3);
      expect(hard.puzzles.filter((p) => p.difficulty >= 4).length).toBeGreaterThanOrEqual(3);
      expect(PuzzleSetSchema.safeParse(hard.puzzles).success).toBe(true);
    }
  });

  it("covers every puzzle type available in the bank in a hard five-item sample", () => {
    // Available means reachable at the hard profile's difficulty floor (3):
    // the demonstrated outliers live at d2, so hard samples skip them rather
    // than dilute the profile.
    const availableTypes = new Set(loadBank()
      .filter((item) => item.puzzle.difficulty >= 3)
      .map((item) => item.puzzle.type));
    for (let run = 0; run < 80; run++) {
      const { items } = sampleQuiz(loadBank(), 5, "hard");
      expect(new Set(items.map((item) => item.puzzle.type)).size).toBe(availableTypes.size);
    }
  });
});

describe("expanded provenance replay", () => {
  it("records the withdrawal list every expanded item was built under", () => {
    const expanded = loadBank().filter((item) => item.provenance.source === "expanded");
    expect(expanded.length).toBeGreaterThan(0);
    // Without this, replay verifies against the runtime withdrawal list, so a
    // legitimate withdrawal invalidates every previously banked item at once.
    for (const item of expanded) {
      expect(Array.isArray(item.provenance.withdrawnFamilyIds), item.puzzle.id).toBe(true);
    }
  });
});
