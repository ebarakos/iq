import { describe, expect, it } from "vitest";
import { mulberry32 } from "../lib/rng";
import { checkRule, DIMENSIONS, type Rule } from "./rules";
import { generatePuzzle, ruleComplexity } from "./generate";
import { PuzzleSchema, PUZZLE_TYPES, type Cell, type PuzzleType } from "./schema";

type Difficulty = 1 | 2 | 3 | 4 | 5;
const DIFFICULTIES: Difficulty[] = [1, 2, 3, 4, 5];

/** A non-answer is a defensible second odd-one iff some dim makes it the unique breaker. */
function isSecondCandidate(cell: Cell, options: Cell[]): boolean {
  const others = options.filter((o) => o !== cell);
  return DIMENSIONS.some((d) => others.every((o) => o[d] === others[0][d]) && cell[d] !== others[0][d]);
}

describe("generatePuzzle — invariant sweep", () => {
  it("every (seed × type × difficulty) puzzle parses and passes checkRule", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const type of PUZZLE_TYPES) {
        for (const difficulty of DIFFICULTIES) {
          const puzzle = generatePuzzle(type, difficulty, mulberry32(seed * 1000 + difficulty));
          const parsed = PuzzleSchema.safeParse(puzzle);
          expect(
            parsed.success,
            `${type} d${difficulty} seed${seed}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
          ).toBe(true);
          const check = checkRule(puzzle);
          expect(check.ok, `${type} d${difficulty} seed${seed}: ${check.ok ? "" : check.issues.join("; ")}`).toBe(true);
        }
      }
    }
  });

  it("oddOneOut puzzles have no defensible second odd-one (ambiguity guard)", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const difficulty of DIFFICULTIES) {
        const puzzle = generatePuzzle("oddOneOut", difficulty, mulberry32(seed * 7 + difficulty));
        const nonAnswers = puzzle.options.filter((_, i) => i !== puzzle.answerIndex);
        for (const o of nonAnswers) {
          expect(
            isSecondCandidate(o, puzzle.options),
            `seed${seed} d${difficulty}: a non-answer option is itself a defensible odd-one`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("generatePuzzle — determinism", () => {
  it("same seed + type + difficulty → deeply equal puzzles", () => {
    for (const type of PUZZLE_TYPES) {
      for (const difficulty of DIFFICULTIES) {
        const a = generatePuzzle(type, difficulty, mulberry32(42));
        const b = generatePuzzle(type, difficulty, mulberry32(42));
        expect(a).toEqual(b);
      }
    }
  });
});

describe("generatePuzzle — difficulty correlation", () => {
  it("mean ruleComplexity is non-decreasing from d1 to d5", () => {
    // oddOneOut rules carry no complexity signal (proximity is the lever); exclude them.
    const derivedTypes = PUZZLE_TYPES.filter((t) => t !== "oddOneOut") as PuzzleType[];
    const means = DIFFICULTIES.map((difficulty) => {
      let total = 0;
      let n = 0;
      for (const type of derivedTypes) {
        for (let seed = 1; seed <= 80; seed++) {
          const puzzle = generatePuzzle(type, difficulty, mulberry32(seed * 31 + difficulty));
          total += ruleComplexity(puzzle.rule as Rule);
          n++;
        }
      }
      return total / n;
    });
    // Non-decreasing, with a small tolerance: d1/d2 and d4/d5 each share one
    // complexity budget by design, so those means tie up to sampling noise.
    const TOL = 0.3;
    for (let i = 1; i < means.length; i++) {
      expect(means[i], `mean complexity dropped at d${i + 1}: ${means.join(", ")}`).toBeGreaterThanOrEqual(means[i - 1] - TOL);
    }
  });
});

describe("generatePuzzle — answerIndex distribution", () => {
  it("the answer is not always at the same index across ~200 puzzles", () => {
    const indices = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      for (const type of PUZZLE_TYPES) {
        const puzzle = generatePuzzle(type, 3, mulberry32(seed * 13));
        indices.add(puzzle.answerIndex);
      }
    }
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe("ruleComplexity", () => {
  it("scores wrap, large deltas, long cycles, and dual-axis matrices higher", () => {
    expect(ruleComplexity({ kind: "sequence", transforms: { count: { op: "step", delta: 1, wrap: false } } })).toBe(1);
    expect(ruleComplexity({ kind: "sequence", transforms: { count: { op: "step", delta: 1, wrap: true } } })).toBe(2);
    expect(ruleComplexity({ kind: "sequence", transforms: { count: { op: "step", delta: 2, wrap: false } } })).toBe(2);
    expect(
      ruleComplexity({ kind: "sequence", transforms: { shape: { op: "cycle", values: ["circle", "square", "triangle"] } } }),
    ).toBe(2);
    expect(
      ruleComplexity({ kind: "matrix", row: { count: { op: "step", delta: 1, wrap: false } }, col: { fill: { op: "step", delta: 1, wrap: false } } }),
    ).toBe(3); // 1 (row) + 1 (col) + 1 (both axes active)
  });
});
