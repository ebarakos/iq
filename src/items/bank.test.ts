import { describe, expect, it } from "vitest";
import shortcutFixture from "../../data/fixtures/machine-gate-shortcut-v37.json";
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
  type BankItem,
} from "./bank";
import {
  SLOT_DIFFICULTIES,
  MAXIMUM_FAMILY_QUESTIONS,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  eligibleFamiliesForBand,
  MINIMUM_DISTINCT_FAMILIES,
  planExpandedSchedule,
} from "./expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
  readWithdrawnFamilyIds,
} from "./family-promotion";
import { PuzzleSchema, PuzzleSetSchema, shuffleOptions, type Puzzle, type SceneToken } from "./schema";
import { machineGateNecessity, sceneFamilyClueCheck } from "./scene-families";

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
      // left thin. Across its family draws, long tests reach all 20 keys. A
      // 5-question test asks each band for one or two questions, so it only
      // ever gets a family's entry-point bucket.
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
    // V34 adds seven matrix keys to the thirteen retained keys; v39 the one-gate machine.
    expect(coverage.countsByKey.size).toBe(21);
    expect(loadBank()).toHaveLength(coverage.countsByKey.size * BANK_ITEMS_PER_KEY);
  });
});

describe("expanded bank coverage", () => {
  it("refuses current-version machine entries that can be solved without the last transform", () => {
    const shortcut = PuzzleSchema.parse(shortcutFixture.puzzle);
    expect(sceneFamilyClueCheck(shortcut).singleClueAnswerIds).toEqual([]);
    expect(machineGateNecessity(shortcut)!.valid).toBe(false);
    const items = loadBank().map((item) => item.puzzle.familyId === "transformation-machine-v4"
      ? { ...item, puzzle: { ...item.puzzle, stem: shortcut.stem, options: shortcut.options, answerIndex: shortcut.answerIndex } }
      : item);
    expect(() => sampleExpandedBankQuiz(items, "long-30", "gate-necessity-fallback", REGISTRY))
      .toThrow(/transformation-machine-v4 at d5 needs another current-version item/);
  });

  it("refuses a missing fixed level even when the same family is stocked at another level", () => {
    const seed = Array.from({ length: 100 }, (_, index) => `missing-fixed-level-${index}`)
      .find((value) => planExpandedSchedule(value, "short-5", REGISTRY)
        .some((slot) => slot.familyId === "compositional-analogy-v2" && slot.difficulty === 4));
    expect(seed).toBeDefined();
    const items = loadBank().filter((item) =>
      item.puzzle.familyId !== "compositional-analogy-v2" || item.puzzle.difficulty !== 4);
    expect(items.some((item) => item.puzzle.familyId === "compositional-analogy-v2" &&
      item.puzzle.difficulty === 3)).toBe(true);
    expect(() => sampleExpandedBankQuiz(items, "short-5", seed!, REGISTRY))
      .toThrow(/compositional-analogy-v2 at d4 needs another current-version item/);
  });

  it("stocks enough of every key that no schedule can reach the fallback ladder", () => {
    // The family cap bounds every exact key, even when a family spans levels or bands.
    for (const profile of EXPANDED_PROFILES) {
      expect(MAXIMUM_FAMILY_QUESTIONS[profile]).toBeLessThanOrEqual(BANK_ITEMS_PER_KEY);
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
  const guardSeed = "bank-clue-guard";
  // The poisoning below assumes two-token sequence pictures. Global mixing
  // can put a collection matrix first; target the known fixture family instead.
  const guardedFamily = "relational-sequence-v2";
  const poisonFamily = (change: (puzzle: Puzzle) => Puzzle): BankItem[] =>
    loadBank().map((item) => item.puzzle.familyId === guardedFamily
      ? { ...item, puzzle: change(structuredClone(item.puzzle)) }
      : item);

  it("refuses bank entries whose family identity disagrees with their generation metadata", () => {
    const items = poisonFamily((puzzle) => ({
      ...puzzle,
      generation: { ...puzzle.generation!, familyId: "forged-family" },
    }));
    expect(() => sampleExpandedBankQuiz(items, "long-30", guardSeed, REGISTRY))
      .toThrow("expanded emergency bank cannot fill");
  });

  it("refuses an undersized bank option list even if the stored version is current", () => {
    const items = poisonFamily((puzzle) => {
      const removed = puzzle.options.findIndex((_, index) => index !== puzzle.answerIndex);
      return {
        ...puzzle,
        options: puzzle.options.filter((_, index) => index !== removed),
        answerIndex: puzzle.answerIndex - (removed < puzzle.answerIndex ? 1 : 0),
      };
    });
    expect(() => sampleExpandedBankQuiz(items, "long-30", guardSeed, REGISTRY))
      .toThrow("expanded emergency bank cannot fill");
  });

  it("refuses wrong bank options that satisfy every intended clue", () => {
    const items = poisonFamily((puzzle) => {
      const wrong = puzzle.options.findIndex((_, index) => index !== puzzle.answerIndex);
      puzzle.options[wrong] = structuredClone(puzzle.options[puzzle.answerIndex]);
      expect(sceneFamilyClueCheck(puzzle).indistinguishableWrongOptionIndexes).toContain(wrong);
      return puzzle;
    });
    expect(() => sampleExpandedBankQuiz(items, "long-30", guardSeed, REGISTRY))
      .toThrow("expanded emergency bank cannot fill");
  });

  it("refuses a bank puzzle that one intended clue answers on its own", () => {
    const items = poisonFamily((puzzle) => {
      const answer = puzzle.options[puzzle.answerIndex];
      const perimeter = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]];
      const target = answer.objects.findIndex(({ row, column }) => row !== 1 || column !== 1);
      expect(target).toBeGreaterThanOrEqual(0);
      let wrongIndex = 0;
      puzzle.options = puzzle.options.map((option, index) => {
        if (index === puzzle.answerIndex) return option;
        const [row, column] = perimeter[wrongIndex++];
        return {
          ...structuredClone(answer),
          objects: answer.objects.map((placement, placementIndex) => placementIndex !== target
            ? structuredClone(placement)
            : {
                row, column,
                object: placement.object.kind === "token"
                  ? { ...placement.object, fill: placement.object.fill === "solid" ? "outline" as const : "solid" as const }
                  : placement.object,
              }),
        };
      });
      // Five distinct, schema-valid wrong pictures: this isolates a clue
      // shortcut rather than relying on duplicate-option/schema rejection.
      expect(PuzzleSchema.safeParse(puzzle).success).toBe(true);
      expect(new Set(puzzle.options.map((option) => JSON.stringify(option))).size).toBe(puzzle.options.length);
      expect(sceneFamilyClueCheck(puzzle).singleClueAnswerIds.some((id) => id === "fill" || id.endsWith(":fill"))).toBe(true);
      return puzzle;
    });
    expect(() => sampleExpandedBankQuiz(items, "long-30", guardSeed, REGISTRY))
      .toThrow("expanded emergency bank cannot fill");
  });

  it("refuses attribute bank entries whose count relationship can be skipped", () => {
    const items = loadBank().filter((item) => item.puzzle.familyId !== "attribute-matrix-v1" || item.puzzle.difficulty === 3);
    const seed = Array.from({ length: 50 }, (_, index) => `attribute-bank-guard-${index}`)
      .find((value) => planExpandedSchedule(value, "short-5", REGISTRY).some((slot) => slot.familyId === "attribute-matrix-v1" && slot.difficulty === 3) &&
        planExpandedSchedule(value, "short-5", REGISTRY).every((slot) => slot.familyId !== "attribute-matrix-v1" || slot.difficulty === 3))!;
    expect(seed).toBeDefined();
    expect(sampleExpandedBankQuiz(items, "short-5", seed, REGISTRY).puzzles).toHaveLength(5);
    const poisoned = items.map((item) => {
      if (item.puzzle.familyId !== "attribute-matrix-v1") return item;
      const puzzle = structuredClone(item.puzzle);
      const answer = puzzle.options[puzzle.answerIndex];
      const token = answer.objects[0].object as SceneToken;
      const otherShape = (puzzle.stem.find((panel) => !("blank" in panel) && panel.objects[0].object.shape !== token.shape) as typeof answer)
        .objects[0].object.shape;
      const otherFill = token.fill === "outline" ? "solid" : "outline";
      // There is a shape-only and a shading-only error, but no count-only
      // error. Each individual attribute value still appears at least twice.
      puzzle.options = [0, 1, 2, 3, 5, 7].map((bits) => {
        const count = bits & 4 ? (answer.objects.length === 1 ? 2 : 1) : answer.objects.length;
        return { ...answer, objects: Array.from({ length: count }, (_, cell) => ({
          row: Math.floor(cell / 3), column: cell % 3,
          object: { ...token, shape: bits & 1 ? otherShape : token.shape, fill: bits & 2 ? otherFill : token.fill },
        })) };
      });
      puzzle.answerIndex = 0;
      expect(PuzzleSchema.safeParse(puzzle).success).toBe(true);
      expect(sceneFamilyClueCheck(puzzle)).toEqual({ singleClueAnswerIds: [], dispensableClueIds: ["0:count"],
        indistinguishableWrongOptionIndexes: [] });
      return { ...item, puzzle };
    });
    expect(() => sampleExpandedBankQuiz(poisoned, "short-5", seed, REGISTRY))
      .toThrow("expanded emergency bank cannot fill");
  });

  it("refuses rearranged attribute options that repeat another wrong option's outcome", () => {
    const poisoned = loadBank().map((item) => {
      if (item.puzzle.familyId !== "attribute-matrix-v1") return item;
      const puzzle = structuredClone(item.puzzle);
      const wrong = puzzle.options.map((_, index) => index).filter((index) => index !== puzzle.answerIndex);
      puzzle.options[wrong[1]] = structuredClone(puzzle.options[wrong[0]]);
      for (const placed of puzzle.options[wrong[1]].objects) placed.column = (placed.column + 1) % 3;
      return { ...item, puzzle };
    });
    // Every long schedule includes the attribute warmup family.
    expect(() => sampleExpandedBankQuiz(poisoned, "long-30", guardSeed, REGISTRY))
      .toThrow("expanded emergency bank cannot fill");
  });

  it.each(EXPANDED_PROFILES)("serves %s with fixed slot difficulties and family constraints", (profile) => {
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
      expect(puzzles.map((puzzle) => puzzle.difficulty)).toEqual(SLOT_DIFFICULTIES[profile]);
      for (let index = 1; index < puzzles.length; index++) {
        expect(puzzles[index].familyId).not.toBe(puzzles[index - 1].familyId);
        expect(puzzles[index].difficulty).toBeGreaterThanOrEqual(puzzles[index - 1].difficulty);
      }
      expect(puzzles.at(-1)!.difficulty).toBe(Math.max(...puzzles.map((puzzle) => puzzle.difficulty)));
      if (profile === "long-30") {
        const eligible = new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
          eligibleFamiliesForBand(REGISTRY, band, withdrawn).map((family) => family.familyId)));
        expect(new Set(puzzles.map((puzzle) => puzzle.familyId))).toEqual(eligible);
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
