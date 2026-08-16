import { describe, expect, it } from "vitest";
import { bankIdFor, fingerprintPuzzle, loadBank, sampleQuiz } from "./bank";
import { PUZZLE_TYPES, PuzzleSetSchema, shuffleOptions } from "./schema";
import { checkRule } from "./rules";

describe("fingerprintPuzzle", () => {
  const base = loadBank()[0].puzzle;

  it("is invariant under option shuffling", () => {
    for (let i = 0; i < 20; i++) {
      expect(fingerprintPuzzle(shuffleOptions(base))).toBe(fingerprintPuzzle(base));
    }
  });

  it("changes when the marked answer changes", () => {
    const odd = loadBank().find((i) => i.puzzle.type === "oddOneOut")!.puzzle;
    const otherIndex = odd.options.findIndex((_, i) => i !== odd.answerIndex);
    expect(fingerprintPuzzle({ ...odd, answerIndex: otherIndex })).not.toBe(fingerprintPuzzle(odd));
  });

  it("prefixes ids by type", () => {
    expect(bankIdFor(base)).toMatch(/^(mx|sq|an|oo)-[0-9a-f]{10}$/);
  });
});

describe("loadBank", () => {
  it("parses the embedded bank and every item passes checkRule", () => {
    const items = loadBank();
    expect(items.length).toBeGreaterThanOrEqual(60);
    for (const item of items) {
      const res = checkRule(item.puzzle);
      expect(res.ok, `${item.puzzle.id}: ${res.ok ? "" : res.issues.join("; ")}`).toBe(true);
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

  it("enforces full family coverage in hard fallback quizzes when all families are present", () => {
    for (let run = 0; run < 80; run++) {
      const { items } = sampleQuiz(loadBank(), 5, "hard");
      expect(new Set(items.map((item) => item.puzzle.type)).size).toBe(PUZZLE_TYPES.length);
    }
  });
});
