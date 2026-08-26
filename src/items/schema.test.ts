import { describe, expect, it } from "vitest";
import {
  ConnectionTileSchema,
  GATE_STRIP_COLUMNS,
  PublicPuzzleSchema,
  GATE_STRIP_ROWS,
  MACHINE_TABLE_PANEL_COUNTS,
  MAXIMUM_DIFFICULTY,
  MAXIMUM_GATE_STRIP_COLUMNS,
  PublicPuzzleSetSchema,
  PuzzleSchema,
  PuzzleSetSchema,
  SceneContainerSchema,
  SceneSchema,
  SceneTokenSchema,
  SCENE_SHAPES,
  ROTATIONS,
  areScenesCategoricallyDistinct,
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
import { generatePuzzle, generateQuiz } from "./generate";
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
  it("accepts 4–8 panels with a single trailing blank", () => {
    expect(PuzzleSchema.safeParse(validSequence).success).toBe(true);
    const six = {
      ...validSequence,
      stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), c("square", 4, 0, "solid"), c("square", 1, 0, "outline"), BLANK],
    };
    expect(PuzzleSchema.safeParse(six).success).toBe(true);
    // Eight panels: the two-strand interleaved row (extrapolation gate needs
    // the answered strand shown three times).
    const eight = {
      ...validSequence,
      stem: [...Array.from({ length: 7 }, (_, i) => c("square", ((i % 4) + 1) as Cell["count"], 0, "solid")), BLANK],
    };
    expect(PuzzleSchema.safeParse(eight).success).toBe(true);
  });

  it("rejects too-short, too-long, non-trailing-blank, and wrong-layout stems", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), BLANK] }).success).toBe(false);
    const nine = { ...validSequence, stem: [...Array.from({ length: 8 }, (_, i) => c("square", ((i % 4) + 1) as Cell["count"], 0, "solid")), BLANK] };
    expect(PuzzleSchema.safeParse(nine).success).toBe(false);
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

describe("PuzzleSchema — difficulty range", () => {
  it("admits difficulty 6 and nothing above it, in every schema that carries one", () => {
    // The ceiling moved from 5 to 6 on 2026-08-26 so the `-d6` buckets at the
    // tail of induction-transfer can state their difficulty honestly.
    expect(MAXIMUM_DIFFICULTY).toBe(6);
    for (const difficulty of [1, 5, MAXIMUM_DIFFICULTY]) {
      expect(VisualPuzzleSchema.safeParse({ ...validMatrix, difficulty }).success, `difficulty ${difficulty}`)
        .toBe(true);
      expect(PublicPuzzleSchema.safeParse(toPublicPuzzle({ ...validMatrix, difficulty })).success, `public ${difficulty}`)
        .toBe(true);
    }
    for (const difficulty of [0, MAXIMUM_DIFFICULTY + 1, 2.5]) {
      expect(VisualPuzzleSchema.safeParse({ ...validMatrix, difficulty }).success, `difficulty ${difficulty}`)
        .toBe(false);
    }
    // Generation metadata carries its own copy of the number and moved with it,
    // so a d6 item can record what it is rather than being labelled a d5.
    const generation = {
      generatorVersion: "scene-families-test",
      familyId: "composed-transform-v2",
      programFingerprint: "0123456789abcdef",
      featureBucket: "composed-transform-d6",
      features: {
        difficulty: MAXIMUM_DIFFICULTY,
        ruleComplexity: 6,
        programDepth: 5,
        activeDimensions: [],
        usesWrap: false,
        distractorStrategy: "near-miss" as const,
      },
    };
    expect(VisualPuzzleSchema.safeParse({
      ...validMatrix,
      difficulty: MAXIMUM_DIFFICULTY,
      generation,
    }).success).toBe(true);
    expect(VisualPuzzleSchema.safeParse({
      ...validMatrix,
      difficulty: MAXIMUM_DIFFICULTY,
      generation: { ...generation, features: { ...generation.features, difficulty: MAXIMUM_DIFFICULTY + 1 } },
    }).success).toBe(false);
  });

  it("keeps the legacy compact-cell generators at difficulty 5 or below", () => {
    // Widening the puzzle schema's range must not quietly loosen what the older
    // paths produce. `procedural-v1`, `v2`, and `v3` have sha256 golden-seed
    // tests in generate.test.ts that would notice a changed ITEM; this notices a
    // changed RANGE, which is the thing the schema edit could have opened up.
    // Their own difficulty ramps top out at 5 and nothing here may exceed it.
    for (const version of ["procedural-v1", "procedural-v2", "procedural-v3"] as const) {
      for (const profile of ["easy", "standard", "hard"] as const) {
        for (let seed = 0; seed < 12; seed++) {
          const quiz = generateQuiz(`legacy-difficulty-cap-${seed}`, version, profile);
          for (const puzzle of quiz) {
            expect(puzzle.difficulty, `${version} ${profile} seed ${seed}`).toBeLessThanOrEqual(5);
            expect(puzzle.generation?.features.difficulty ?? 1, `${version} ${profile} seed ${seed}`)
              .toBeLessThanOrEqual(5);
          }
        }
      }
    }
    // And the per-item entry point refuses a difficulty above its own ramp,
    // whatever the puzzle schema now allows.
    expect(() => generatePuzzle("matrix", MAXIMUM_DIFFICULTY as 5, mulberry32(11))).toThrow();
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

  it("allows a four- or five-gate strip only as a machine table's gate, and never as an option", () => {
    const gate = (shape: SceneToken["shape"]): Scene => ({
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: [{ row: 1, column: 0, object: token(shape) }],
      tiles: [],
    });
    const strip: Scene = {
      kind: "scene",
      rows: GATE_STRIP_ROWS,
      columns: GATE_STRIP_COLUMNS,
      objects: (["triangle", "square", "diamond", "star"] as const)
        .map((shape, column) => ({ row: 0, column, object: token(shape) })),
      tiles: [],
    };
    // The five-gate strip is the same shape one column wider — the `-d6` bucket
    // added on 2026-08-26. Everything else about the strip is unchanged.
    const wideStrip: Scene = {
      kind: "scene",
      rows: GATE_STRIP_ROWS,
      columns: MAXIMUM_GATE_STRIP_COLUMNS,
      objects: (["triangle", "square", "diamond", "star", "hexagon"] as const)
        .map((shape, column) => ({ row: 0, column, object: token(shape) })),
      tiles: [],
    };
    // The wide board is a legal scene on its own; where it may appear is a
    // puzzle-level rule, not a board-level one.
    expect(SceneSchema.safeParse(strip).success).toBe(true);
    expect(SceneSchema.safeParse(wideStrip).success).toBe(true);
    // ...but nothing else may be that shape. Widening the strip to five columns
    // did NOT widen the ordinary board: two rows of five, or one row of six, is
    // still not a board this project draws.
    expect(SceneSchema.safeParse({ ...strip, rows: 2 }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...wideStrip, rows: 2 }).success).toBe(false);
    expect(SceneSchema.safeParse({
      ...wideStrip,
      columns: MAXIMUM_GATE_STRIP_COLUMNS + 1,
      objects: [...wideStrip.objects, { row: 0, column: 5, object: token("circle") }],
    }).success).toBe(false);
    expect(SceneSchema.safeParse({
      kind: "scene",
      rows: 1,
      columns: 3,
      objects: [{ row: 0, column: 0, object: token() }],
      tiles: [],
    }).success).toBe(false);

    const fourGateMachine: Puzzle<Visual> = {
      ...validMatrix,
      id: "four-gate-machine",
      layout: "machineTable",
      stem: [
        scene(0), gate("triangle"), scene(1),
        scene(0), gate("square"), scene(1),
        scene(0), gate("diamond"), scene(1),
        scene(0), gate("star"), scene(1),
        scene(0), strip, { blank: true },
      ],
      options: sceneOptions,
    };
    expect(VisualPuzzleSchema.safeParse(fourGateMachine).success).toBe(true);
    // Fifteen panels is the four-row form; fourteen is not a machine table.
    expect(VisualPuzzleSchema.safeParse({
      ...fourGateMachine,
      stem: fourGateMachine.stem.slice(0, 14),
    }).success).toBe(false);

    // Eighteen panels is the five-row form: five worked (input, gate, output)
    // rows plus the query row, with the five-gate strip as its gate. The 9, 12,
    // and 15 panel forms stay exactly as valid as they were.
    const fiveGateMachine: Puzzle<Visual> = {
      ...fourGateMachine,
      id: "five-gate-machine",
      difficulty: MAXIMUM_DIFFICULTY,
      stem: [
        scene(0), gate("triangle"), scene(1),
        scene(0), gate("square"), scene(1),
        scene(0), gate("diamond"), scene(1),
        scene(0), gate("star"), scene(1),
        scene(0), gate("hexagon"), scene(1),
        scene(0), wideStrip, { blank: true },
      ],
    };
    expect(fiveGateMachine.stem).toHaveLength(18);
    expect(VisualPuzzleSchema.safeParse(fiveGateMachine).success).toBe(true);
    expect(MACHINE_TABLE_PANEL_COUNTS).toEqual([9, 12, 15, 18]);
    // Seventeen and twenty-one are not machine tables, so the new length did
    // not open the layout to any stem length that happens to divide by three.
    for (const length of [17, 21]) {
      expect(VisualPuzzleSchema.safeParse({
        ...fiveGateMachine,
        stem: length < 18
          ? fiveGateMachine.stem.slice(0, length)
          : [...fiveGateMachine.stem.slice(0, 15), scene(0), gate("circle"), scene(1), ...fiveGateMachine.stem.slice(15)],
      }).success, `${length} panels`).toBe(false);
    }
    // A five-glyph strip is no more allowed outside a gate column than a
    // four-glyph one, and it is never an answer.
    expect(VisualPuzzleSchema.safeParse({
      ...fiveGateMachine,
      stem: fiveGateMachine.stem.map((panel, index) => index === 15 ? wideStrip : panel),
    }).success).toBe(false);
    expect(VisualPuzzleSchema.safeParse({
      ...fiveGateMachine,
      options: [...sceneOptions.slice(0, 3), wideStrip],
    }).success).toBe(false);
    // The strip may only sit in the gate column of a machine table.
    expect(VisualPuzzleSchema.safeParse({
      ...fourGateMachine,
      stem: fourGateMachine.stem.map((panel, index) => index === 12 ? strip : panel),
    }).success).toBe(false);
    expect(VisualPuzzleSchema.safeParse({
      ...fourGateMachine,
      layout: "grid3x3",
      stem: [scene(0), strip, scene(1), scene(0), scene(1), scene(0), scene(1), scene(0), { blank: true }],
    }).success).toBe(false);
    // And it is never an answer.
    expect(VisualPuzzleSchema.safeParse({
      ...fourGateMachine,
      options: [...sceneOptions.slice(0, 3), strip],
    }).success).toBe(false);
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

describe("scene-only arrow shape", () => {
  const arrowToken = (rotation: number): SceneToken => ({
    kind: "token",
    shape: "arrow",
    rotation,
    fill: "solid",
    size: "l",
  });

  const arrowScene = (rotation: number): Scene => ({
    kind: "scene",
    rows: 2,
    columns: 2,
    objects: [{ row: 0, column: 0, object: arrowToken(rotation) }],
    tiles: [],
  });

  it("extends the scene vocabulary without touching the frozen cell vocabulary", () => {
    expect(SCENE_SHAPES).toEqual([...SHAPES, "arrow"]);
    expect(SHAPES as readonly string[]).not.toContain("arrow");
  });

  it("accepts an arrow token at every quarter turn", () => {
    for (const rotation of ROTATIONS) {
      expect(SceneTokenSchema.safeParse(arrowToken(rotation)).success).toBe(true);
      expect(SceneSchema.safeParse(arrowScene(rotation)).success).toBe(true);
    }
  });

  it("still refuses rotation on shapes whose orientation cannot be seen", () => {
    for (const shape of ["circle", "square", "diamond", "star", "hexagon"] as const) {
      expect(SceneTokenSchema.safeParse({ kind: "token", shape, rotation: 90, fill: "solid", size: "l" }).success)
        .toBe(false);
      expect(SceneTokenSchema.safeParse({ kind: "token", shape, rotation: 0, fill: "solid", size: "l" }).success)
        .toBe(true);
    }
    expect(SceneTokenSchema.safeParse({ kind: "token", shape: "triangle", rotation: 270, fill: "solid", size: "l" }).success)
      .toBe(true);
  });

  it("keeps arrows out of container outlines", () => {
    expect(SceneContainerSchema.safeParse({ kind: "container", shape: "arrow", contents: [arrowToken(0)] }).success)
      .toBe(false);
    expect(SceneContainerSchema.safeParse({ kind: "container", shape: "circle", contents: [arrowToken(90)] }).success)
      .toBe(true);
  });

  it("reads all four arrow rotations as categorically different boards", () => {
    for (const rotation of ROTATIONS) {
      for (const other of ROTATIONS) {
        expect(areScenesCategoricallyDistinct(arrowScene(rotation), arrowScene(other)))
          .toBe(rotation !== other);
      }
    }
  });

  it("serves six arrow-rotation options as an instantly distinguishable option list", () => {
    const puzzle: Puzzle<Visual> = {
      id: "arrow-options",
      type: "sequence",
      instruction: "What comes next?",
      difficulty: 3,
      layout: "row",
      stem: [arrowScene(0), arrowScene(90), arrowScene(180), BLANK],
      options: [
        arrowScene(270),
        arrowScene(0),
        arrowScene(90),
        arrowScene(180),
        { ...arrowScene(0), objects: [{ row: 1, column: 1, object: arrowToken(0) }] },
        { ...arrowScene(0), objects: [{ row: 0, column: 0, object: { ...arrowToken(0), fill: "outline" } }] },
      ],
      answerIndex: 0,
      explanation: "The arrow turns a quarter clockwise each step.",
    };
    expect(VisualPuzzleSchema.safeParse(puzzle).success).toBe(true);
  });
});
