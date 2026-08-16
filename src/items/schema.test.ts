import { describe, expect, it } from "vitest";
import {
  ConnectionTileSchema,
  PublicPuzzleSetSchema,
  PuzzleSchema,
  PuzzleSetSchema,
  SceneSchema,
  SHAPES,
  VisualPuzzleSchema,
  shuffleOptions,
  toPublicPuzzle,
  visualSignature,
  type Cell,
  type Panel,
  type Puzzle,
  type Scene,
  type SceneToken,
  type Visual,
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

const token = (
  shape: SceneToken["shape"] = "circle",
  fill: SceneToken["fill"] = "solid",
  size: SceneToken["size"] = "l",
): SceneToken => ({ kind: "token", shape, rotation: 0, fill, size });

const scene = (column: number, object: Scene["objects"][number]["object"] = token()): Scene => ({
  kind: "scene",
  rows: 2,
  columns: 2,
  objects: [{ row: 0, column, object }],
  tiles: [],
});

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

describe("SceneSchema", () => {
  it("accepts positioned tokens, contained tokens, and categorical edge connections", () => {
    const fixture: Scene = {
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: [
        { row: 0, column: 2, object: token("triangle", "half", "l") },
        {
          row: 2,
          column: 0,
          object: { kind: "container", shape: "square", contents: [token("star", "solid", "m")] },
        },
      ],
      tiles: [{ row: 1, column: 1, edges: ["north", "east", "south"] }],
      guides: [{ kind: "crease", axis: "vertical", direction: "rightToLeft" }],
    };

    expect(SceneSchema.safeParse(fixture).success).toBe(true);
    expect(SceneSchema.safeParse({ ...fixture, guides: [...fixture.guides!, fixture.guides![0]] }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...fixture, guides: [{ kind: "crease", axis: "vertical", direction: "topToBottom" }] }).success).toBe(false);
  });

  it("rejects out-of-bounds and overlapping board geometry", () => {
    expect(SceneSchema.safeParse({ ...scene(0), objects: [{ row: 2, column: 0, object: token() }] }).success).toBe(false);
    expect(SceneSchema.safeParse({
      ...scene(0),
      tiles: [{ row: 0, column: 0, edges: ["north"] }],
    }).success).toBe(false);
  });

  it("rejects ambiguous connection aliases and illegibly small contained tokens", () => {
    expect(ConnectionTileSchema.safeParse({ row: 0, column: 0, edges: ["east", "north"] }).success).toBe(false);
    expect(ConnectionTileSchema.safeParse({ row: 0, column: 0, edges: ["north", "north"] }).success).toBe(false);
    expect(SceneSchema.safeParse({
      kind: "scene",
      rows: 2,
      columns: 2,
      tiles: [],
      objects: [{
        row: 0,
        column: 0,
        object: {
          kind: "container",
          shape: "circle",
          contents: [{ kind: "token", shape: "diamond", rotation: 0, fill: "solid", size: "s" }],
        },
      }],
    }).success).toBe(false);
  });
});

describe("VisualPuzzleSchema", () => {
  it("accepts scenes in both stem panels and answer options without changing legacy cells", () => {
    const visualPuzzle: Puzzle<Visual> = {
      ...validSequence,
      id: "scene-sequence",
      stem: [scene(0), scene(1), scene(0, token("square")), BLANK],
      options: [
        scene(1, token("square")),
        scene(0, token("triangle")),
        scene(1, { kind: "container", shape: "circle", contents: [token("star", "solid", "m")] }),
        { kind: "scene", rows: 2, columns: 2, objects: [], tiles: [{ row: 0, column: 0, edges: ["east", "south"] }] },
      ],
    };

    expect(VisualPuzzleSchema.safeParse(visualPuzzle).success).toBe(true);
    expect(PuzzleSchema.safeParse(validSequence).success).toBe(true);
  });

  it("rejects render-identical scenes even when placement arrays use a different order", () => {
    const first: Scene = {
      kind: "scene",
      rows: 2,
      columns: 2,
      objects: [
        { row: 0, column: 0, object: token("circle") },
        { row: 1, column: 1, object: token("square") },
      ],
      tiles: [],
    };
    const reordered: Scene = { ...first, objects: [...first.objects].reverse() };
    const visualPuzzle: Puzzle<Visual> = {
      ...validSequence,
      stem: [first, scene(1), scene(0, token("triangle")), BLANK],
      options: [first, reordered, scene(1), scene(0, token("star"))],
    };

    expect(VisualPuzzleSchema.safeParse(visualPuzzle).success).toBe(false);
  });

  it("rejects scene options distinguished only by a subtle medium-to-large size change", () => {
    const medium = scene(0, { ...token("circle"), size: "m" });
    const large = scene(0, { ...token("circle"), size: "l" });
    const visualPuzzle: Puzzle<Visual> = {
      ...validSequence,
      stem: [scene(0), scene(1), scene(0, token("triangle")), BLANK],
      options: [medium, large, scene(1), scene(0, token("star"))],
    };

    expect(VisualPuzzleSchema.safeParse(visualPuzzle).success).toBe(false);
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

describe("PuzzleSchema — scene-specific layouts", () => {
  const sceneOptions = [
    scene(0, token("circle")),
    scene(1, token("circle")),
    scene(0, token("square")),
    scene(1, token("triangle")),
  ];

  it("accepts one incomplete board and a three-row transformation machine", () => {
    const singleBoard: Puzzle<Visual> = {
      ...validMatrix,
      id: "single-board",
      layout: "singleScene",
      stem: [scene(0)],
      options: sceneOptions,
    };
    const machine: Puzzle<Visual> = {
      ...validMatrix,
      id: "machine-table",
      layout: "machineTable",
      stem: [scene(0), scene(1), scene(0, token("square")), scene(1), scene(0), scene(1, token("square")), scene(0), scene(1), { blank: true }],
      options: sceneOptions,
    };
    expect(VisualPuzzleSchema.safeParse(singleBoard).success).toBe(true);
    expect(VisualPuzzleSchema.safeParse(machine).success).toBe(true);
    expect(VisualPuzzleSchema.safeParse({ ...machine, stem: machine.stem.slice(0, 8) }).success).toBe(false);
  });

  it("keeps the reasoning family in the answer-free public contract", () => {
    const publicPuzzle = toPublicPuzzle({ ...validSequence, familyId: "relational-sequence-v1" });
    expect(publicPuzzle.familyId).toBe("relational-sequence-v1");
    expect(publicPuzzle).not.toHaveProperty("answerIndex");
    expect(publicPuzzle).not.toHaveProperty("explanation");
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
  const twelve = Array.from({ length: 12 }, (_, index) => ({ ...validMatrix, id: `t-matrix-${index + 1}` }));

  it("accepts replayable 5-item and current 12-item sets with unique ids", () => {
    expect(PuzzleSetSchema.safeParse(five).success).toBe(true);
    expect(PuzzleSetSchema.safeParse(twelve).success).toBe(true);
    expect(PublicPuzzleSetSchema.safeParse(five.map(toPublicPuzzle)).success).toBe(true);
    expect(PublicPuzzleSetSchema.safeParse(twelve.map(toPublicPuzzle)).success).toBe(true);
  });

  it("rejects duplicate ids and wrong set sizes", () => {
    expect(PuzzleSetSchema.safeParse([...five.slice(0, 4), { ...validMatrix }]).success).toBe(false);
    expect(PuzzleSetSchema.safeParse(five.slice(0, 4)).success).toBe(false);
    expect(PuzzleSetSchema.safeParse([...five, { ...validMatrix, id: "sixth" }]).success).toBe(false);
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
