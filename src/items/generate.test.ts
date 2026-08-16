import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mulberry32, seededRng } from "../lib/rng";
import { checkRule, DIMENSIONS, type Rule } from "./rules";
import { CURRENT_GENERATOR_VERSION, generatePuzzle, generateQuiz, ruleComplexity } from "./generate";
import { PuzzleSchema, PuzzleSetSchema, PUZZLE_TYPES, type Cell, type PuzzleType } from "./schema";

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

describe("generateQuiz", () => {
  it("returns the same valid full quiz for identical inputs", () => {
    const first = generateQuiz("4a3d9414f6824e1c8952d98c93fd12b6", CURRENT_GENERATOR_VERSION, "standard");
    const replay = generateQuiz("4a3d9414f6824e1c8952d98c93fd12b6", CURRENT_GENERATOR_VERSION, "standard");

    expect(replay).toEqual(first);
    expect(PuzzleSetSchema.safeParse(first).success).toBe(true);
    expect(new Set(first.map((p) => p.type)).size).toBe(4);
    expect(first.some((puzzle) => puzzle.type === "operatorInduction")).toBe(false);
    expect(first).toHaveLength(5);
    expect(first.map((p) => p.difficulty)).toEqual([2, 2, 3, 3, 5]);
    for (const puzzle of first) {
      expect(checkRule(puzzle).ok).toBe(true);
      expect(puzzle.generation).toMatchObject({
        generatorVersion: CURRENT_GENERATOR_VERSION,
        familyId: expect.stringMatching(/-v1$/),
        programFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        featureBucket: expect.stringContaining(CURRENT_GENERATOR_VERSION),
        features: {
          difficulty: puzzle.difficulty,
          ruleComplexity: expect.any(Number),
          programDepth: expect.any(Number),
          activeDimensions: expect.any(Array),
          usesWrap: expect.any(Boolean),
          distractorStrategy: expect.stringMatching(/^(near-miss|coherent-outlier)$/),
        },
      });
    }
  });

  it("keeps v1 puzzle semantics stable and separates seed streams", () => {
    const quiz = generateQuiz("v1-golden-seed", "procedural-v1", "hard");
    // Provenance was added after the v1 semantic golden was established. Strip
    // that supplemental field so this guard still catches visual/rule drift.
    const core = quiz.map((puzzle) => {
      const copy = { ...puzzle };
      delete copy.generation;
      return copy;
    });
    const digest = createHash("sha256").update(JSON.stringify(core)).digest("hex");
    expect(digest).toBe("bcd378b4bbaf738ac82c2589172e82b526ab70e8899abb49d8a8fa68486cb75d");

    expect(generateQuiz("another-seed", "procedural-v1", "hard")).not.toEqual(quiz);
    expect(seededRng("same-seed", "a")()).not.toBe(seededRng("same-seed", "b")());
  });

  it("keeps v2 five-family puzzle semantics stable", () => {
    const quiz = generateQuiz("v2-golden-seed", "procedural-v2", "hard");
    const core = quiz.map((puzzle) => {
      const copy = { ...puzzle };
      delete copy.generation;
      return copy;
    });
    const digest = createHash("sha256").update(JSON.stringify(core)).digest("hex");
    expect(quiz).toHaveLength(5);
    expect(digest).toBe("ba82b218b68db96e2e38cd58df0b616870d9661a7d019615b8d0ca4255cdc406");
  });

  it("does not dump the operator syntax into current explanations", () => {
    const puzzle = generatePuzzle("operatorInduction", 5, mulberry32(91), CURRENT_GENERATOR_VERSION);
    expect(puzzle.explanation).toMatch(/hidden arithmetic is excluded/);
    expect(puzzle.explanation).not.toMatch(/shape=|count=|modulo 4|\? then/);
  });

  it("assigns the same program fingerprint to the same hidden rule", () => {
    const quiz = generateQuiz("program-fingerprint-seed", CURRENT_GENERATOR_VERSION, "standard");
    for (const puzzle of quiz) {
      const replay = generateQuiz("program-fingerprint-seed", CURRENT_GENERATOR_VERSION, "standard")
        .find((candidate) => candidate.id === puzzle.id);
      expect(replay?.generation).toEqual(puzzle.generation);
    }
  });

  it("rejects unknown versions, profiles, and invalid seeds", () => {
    expect(() => generateQuiz("seed", "procedural-v4", "standard")).toThrow(/unsupported generator version/);
    expect(() => generateQuiz("seed", CURRENT_GENERATOR_VERSION, "expert" as never)).toThrow(/unsupported quiz profile/);
    expect(() => generateQuiz("", CURRENT_GENERATOR_VERSION, "standard")).toThrow(/seed must be/);
  });

  it("honours each difficulty profile", () => {
    expect(generateQuiz("profile-seed", CURRENT_GENERATOR_VERSION, "easy").map((p) => p.difficulty)).toEqual([
      1, 1, 2, 2, 3,
    ]);
    expect(generateQuiz("profile-seed", CURRENT_GENERATOR_VERSION, "hard").map((p) => p.difficulty)).toEqual([
      3, 4, 4, 5, 5,
    ]);
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
