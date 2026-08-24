import { describe, expect, it } from "vitest";
import {
  bankIdFor,
  fingerprintPuzzle,
  loadBank,
  sampleExpandedBankQuiz,
  sampleQuiz,
} from "./bank";
import {
  BAND_SCHEDULE,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
} from "./expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds } from "./family-promotion";
import { PuzzleSetSchema, shuffleOptions } from "./schema";

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
        profile: "long-30",
      });
      expect(typeof item.provenance.seed).toBe("string");
      expect(item.puzzle.generation?.generatorVersion).toBe(EXPANDED_GENERATOR_VERSION);
    }
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
      expect(new Set(puzzles.map((puzzle) => puzzle.familyId)).size)
        .toBeGreaterThanOrEqual(profile === "long-30" ? 12 : 5);
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
    const availableTypes = new Set(loadBank().map((item) => item.puzzle.type));
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
