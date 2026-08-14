import { describe, expect, it } from "vitest";
import {
  PuzzleSchema,
  PuzzleSetSchema,
  SHAPES,
  shuffleOptions,
  visualSignature,
  type Cell,
  type Panel,
  type Puzzle,
} from "./schema";
import { generatePuzzle } from "./generate";
import { mulberry32 } from "../lib/rng";

const c = (
  shape: Cell["shape"],
  count: Cell["count"],
  rotation: number,
  fill: Cell["fill"],
  size: Cell["size"] = "m",
): Cell => ({ shape, count, rotation, fill, size });

const BLANK: Panel = { blank: true };

/** Minimal valid puzzle per type; tests mutate copies of these. */
const validMatrix: Puzzle = {
  id: "t-matrix",
  type: "matrix",
  instruction: "Which option completes the grid?",
  difficulty: 2,
  layout: "grid3x3",
  stem: [
    c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), c("circle", 3, 0, "solid"),
    c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), c("circle", 3, 0, "solid"),
    c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), BLANK,
  ],
  options: [c("circle", 3, 0, "solid"), c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), c("circle", 4, 0, "solid")],
  answerIndex: 0,
  explanation: "Each row counts 1, 2, 3.",
};

const validSequence: Puzzle = {
  id: "t-seq",
  type: "sequence",
  instruction: "What comes next?",
  difficulty: 2,
  layout: "row",
  stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
  options: [c("square", 4, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "outline")],
  answerIndex: 0,
  explanation: "The count increases by one each step.",
};

const validAnalogy: Puzzle = {
  id: "t-analogy",
  type: "analogy",
  instruction: "Complete the analogy.",
  difficulty: 3,
  layout: "analogy",
  stem: [c("triangle", 1, 0, "outline"), c("triangle", 1, 0, "solid"), c("star", 1, 0, "outline")],
  options: [c("star", 1, 0, "solid"), c("star", 1, 0, "half"), c("triangle", 1, 0, "half"), c("star", 2, 0, "solid")],
  answerIndex: 0,
  explanation: "Outline becomes solid.",
};

const validOddOneOut: Puzzle = {
  id: "t-odd",
  type: "oddOneOut",
  instruction: "Which one does not belong?",
  difficulty: 3,
  layout: "row",
  stem: [],
  // Non-answer options all share shape "square"; the answer breaks it.
  options: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("circle", 2, 0, "solid"), c("square", 3, 0, "solid")],
  answerIndex: 2,
  explanation: "Three are squares; one is a circle.",
};

describe("visualSignature", () => {
  it("treats rotations within a shape's symmetry period as identical", () => {
    expect(visualSignature(c("square", 1, 0, "solid"))).toBe(visualSignature(c("square", 1, 90, "solid")));
    expect(visualSignature(c("triangle", 1, 0, "solid"))).toBe(visualSignature(c("triangle", 1, 120, "solid")));
    expect(visualSignature(c("hexagon", 1, 0, "solid"))).toBe(visualSignature(c("hexagon", 1, 180, "solid")));
    expect(visualSignature(c("circle", 1, 45, "solid"))).toBe(visualSignature(c("circle", 1, 315, "solid")));
  });

  it("distinguishes rotations that change the rendering", () => {
    expect(visualSignature(c("square", 1, 0, "solid"))).not.toBe(visualSignature(c("square", 1, 45, "solid")));
    expect(visualSignature(c("star", 1, 0, "solid"))).not.toBe(visualSignature(c("star", 1, 45, "solid")));
  });

  it("distinguishes every non-rotation dimension", () => {
    const base = c("square", 1, 0, "solid");
    expect(visualSignature({ ...base, count: 2 })).not.toBe(visualSignature(base));
    expect(visualSignature({ ...base, fill: "half" })).not.toBe(visualSignature(base));
    expect(visualSignature({ ...base, size: "l" })).not.toBe(visualSignature(base));
    expect(visualSignature({ ...base, shape: "diamond" })).not.toBe(visualSignature(base));
  });
});

describe("PuzzleSchema — matrix", () => {
  it("accepts a valid 3x3 matrix", () => {
    expect(PuzzleSchema.safeParse(validMatrix).success).toBe(true);
  });

  it("rejects a matrix without exactly 9 panels / 1 blank / grid3x3 layout", () => {
    expect(PuzzleSchema.safeParse({ ...validMatrix, stem: validMatrix.stem.slice(0, 8) }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validMatrix, layout: "row" }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validMatrix, stem: [...validMatrix.stem.slice(0, 7), BLANK, BLANK] }).success).toBe(false);
  });
});

describe("PuzzleSchema — sequence", () => {
  it("accepts 4–6 panels with a single trailing blank", () => {
    expect(PuzzleSchema.safeParse(validSequence).success).toBe(true);
    const six = {
      ...validSequence,
      stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), c("square", 4, 0, "solid"), c("square", 1, 0, "outline"), BLANK],
    };
    expect(PuzzleSchema.safeParse(six).success).toBe(true);
  });

  it("rejects too-short, too-long, non-trailing-blank, and wrong-layout stems", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), BLANK] }).success).toBe(false);
    const seven = { ...validSequence, stem: [...Array.from({ length: 6 }, (_, i) => c("square", ((i % 4) + 1) as Cell["count"], 0, "solid")), BLANK] };
    expect(PuzzleSchema.safeParse(seven).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validSequence, stem: [BLANK, c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid")] }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validSequence, layout: "grid3x3" }).success).toBe(false);
  });
});

describe("PuzzleSchema — analogy", () => {
  it("accepts exactly 3 cells with no blank", () => {
    expect(PuzzleSchema.safeParse(validAnalogy).success).toBe(true);
  });

  it("rejects a blank or wrong cell count", () => {
    expect(PuzzleSchema.safeParse({ ...validAnalogy, stem: [...validAnalogy.stem.slice(0, 2), BLANK] }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validAnalogy, stem: validAnalogy.stem.slice(0, 2) }).success).toBe(false);
  });
});

describe("PuzzleSchema — oddOneOut", () => {
  it("accepts an empty-stem row where the answer breaks a shared dimension", () => {
    expect(PuzzleSchema.safeParse(validOddOneOut).success).toBe(true);
  });

  it("rejects a non-row layout and a non-empty stem", () => {
    expect(PuzzleSchema.safeParse({ ...validOddOneOut, layout: "grid3x3" }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validOddOneOut, stem: [c("square", 1, 0, "solid")] }).success).toBe(false);
  });

  it("rejects options where the non-answers share no dimension the answer breaks", () => {
    const incoherent = {
      ...validOddOneOut,
      // Non-answers share nothing across shape/count/rotation/fill/size.
      options: [c("circle", 1, 0, "solid", "m"), c("square", 2, 0, "half", "l"), c("star", 4, 0, "solid", "m"), c("triangle", 3, 45, "outline", "s")],
      answerIndex: 2,
    };
    expect(PuzzleSchema.safeParse(incoherent).success).toBe(false);
  });

  it("rejects an answer that renders identically to another option", () => {
    const clash = {
      ...validOddOneOut,
      // The "odd" circle is render-identical to another option (circle ignores rotation).
      options: [c("circle", 2, 0, "solid"), c("square", 2, 0, "solid"), c("circle", 2, 45, "solid"), c("square", 3, 0, "solid")],
      answerIndex: 0,
    };
    expect(PuzzleSchema.safeParse(clash).success).toBe(false);
  });
});

describe("PuzzleSchema — options and answerIndex", () => {
  it("requires 4–6 options", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, options: validSequence.options.slice(0, 3) }).success).toBe(false);
  });

  it("rejects an out-of-range answerIndex", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, answerIndex: 4 }).success).toBe(false);
  });

  it("rejects render-identical options (rotational symmetry)", () => {
    const dup = {
      ...validSequence,
      // square at 0° and 90° render identically.
      options: [c("square", 4, 0, "solid"), c("square", 4, 90, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "solid")],
    };
    expect(PuzzleSchema.safeParse(dup).success).toBe(false);
  });
});

describe("PuzzleSchema — operator induction", () => {
  it("accepts the generated triple contract and rejects missing public legend or a misplaced blank", () => {
    const valid = generatePuzzle("operatorInduction", 4, mulberry32(7));
    expect(PuzzleSchema.safeParse(valid).success).toBe(true);
    expect(PuzzleSchema.safeParse({ ...valid, operatorLegend: undefined }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...valid, stem: [{ blank: true }, ...valid.stem.slice(1)] }).success).toBe(false);
  });

  it("rejects a shape outside the displayed per-item order", () => {
    const valid = generatePuzzle("operatorInduction", 4, mulberry32(8));
    const outside = SHAPES.find((shape) => !valid.operatorLegend!.shapeCycle.includes(shape));
    if (!outside) throw new Error("fixture needs a shape outside the operator cycle");
    const first = valid.stem[0];
    if ("blank" in first) throw new Error("operator fixture starts with a cell");
    expect(PuzzleSchema.safeParse({ ...valid, stem: [{ ...first, shape: outside }, ...valid.stem.slice(1)] }).success).toBe(false);
  });
});

describe("PuzzleSetSchema", () => {
  const five = [validMatrix, validSequence, validAnalogy, validOddOneOut, { ...validMatrix, id: "t-matrix-2" }];

  it("accepts 5 puzzles with unique ids", () => {
    expect(PuzzleSetSchema.safeParse(five).success).toBe(true);
  });

  it("rejects duplicate ids and wrong set sizes", () => {
    expect(PuzzleSetSchema.safeParse([...five.slice(0, 4), { ...validMatrix }]).success).toBe(false);
    expect(PuzzleSetSchema.safeParse(five.slice(0, 4)).success).toBe(false);
  });
});

describe("shuffleOptions", () => {
  it("preserves the option multiset and keeps the same cell correct", () => {
    for (let i = 0; i < 50; i++) {
      const shuffled = shuffleOptions(validAnalogy);
      expect(shuffled.options).toHaveLength(validAnalogy.options.length);
      expect(shuffled.options[shuffled.answerIndex]).toEqual(validAnalogy.options[validAnalogy.answerIndex]);
      const sort = (cells: Cell[]) => [...cells].map((x) => JSON.stringify(x)).sort();
      expect(sort(shuffled.options)).toEqual(sort(validAnalogy.options));
    }
  });

  it("does not mutate the input puzzle", () => {
    const snapshot = JSON.stringify(validAnalogy);
    shuffleOptions(validAnalogy);
    expect(JSON.stringify(validAnalogy)).toBe(snapshot);
  });
});
