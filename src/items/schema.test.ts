import { describe, expect, it } from "vitest";
import {
  ConnectionTileSchema,
  PublicPuzzleSchema,
  MACHINE_TABLE_PANEL_COUNTS,
  MAXIMUM_DIFFICULTY,
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
  sceneSignature,
  shuffleOptions,
  toPublicPuzzle,
  type Panel,
  type Puzzle,
  type Scene,
  type SceneToken,
} from "./schema";
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

/** A 3×3 board holding one large token. */
const board = (row: number, column: number, shape: SceneToken["shape"] = "circle"): Scene => ({
  kind: "scene",
  rows: 3,
  columns: 3,
  objects: [{ row, column, object: token(shape) }],
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
    board(0, 0), board(0, 1), board(0, 2),
    board(1, 0), board(1, 1), board(1, 2),
    board(2, 0), board(2, 1), BLANK,
  ],
  options: [board(2, 2), board(0, 0, "square"), board(1, 1, "square"), board(2, 2, "square")],
  answerIndex: 0,
  explanation: "The circle visits every square in reading order.",
};

const validSequence: Puzzle = {
  id: "t-seq",
  type: "sequence",
  instruction: "What comes next?",
  difficulty: 2,
  layout: "row",
  stem: [board(0, 0), board(0, 1), board(0, 2), BLANK],
  options: [board(1, 0), board(0, 0, "square"), board(0, 1, "square"), board(0, 2, "square")],
  answerIndex: 0,
  explanation: "The circle moves one square along each step.",
};

const validAnalogy: Puzzle = {
  id: "t-analogy",
  type: "analogy",
  instruction: "Complete the analogy.",
  difficulty: 3,
  layout: "analogy",
  stem: [board(0, 0), board(0, 1), board(1, 0, "star")],
  options: [board(1, 1, "star"), board(1, 0, "triangle"), board(0, 0, "star"), board(2, 2, "star")],
  answerIndex: 0,
  explanation: "The shape moves one square to the right.",
};

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

describe("PuzzleSchema", () => {
  it("accepts tokens, containers and connections in stem panels and answer options", () => {
    const visualPuzzle: Puzzle = {
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

    expect(PuzzleSchema.safeParse(visualPuzzle).success).toBe(true);
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
    const visualPuzzle: Puzzle = {
      ...validSequence,
      stem: [first, scene(1), scene(0, token("triangle")), BLANK],
      options: [first, reordered, scene(1), scene(0, token("star"))],
    };

    expect(PuzzleSchema.safeParse(visualPuzzle).success).toBe(false);
  });

  it("rejects scene options distinguished only by a subtle medium-to-large size change", () => {
    const medium = scene(0, { ...token("circle"), size: "m" });
    const large = scene(0, { ...token("circle"), size: "l" });
    const visualPuzzle: Puzzle = {
      ...validSequence,
      stem: [scene(0), scene(1), scene(0, token("triangle")), BLANK],
      options: [medium, large, scene(1), scene(0, token("star"))],
    };

    expect(PuzzleSchema.safeParse(visualPuzzle).success).toBe(false);
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

  it("accepts a grid flow on a 3x3 grid only, and serves it with the public puzzle", () => {
    expect(PuzzleSchema.safeParse({ ...validMatrix, gridFlow: "rows" }).success).toBe(true);
    expect(PuzzleSchema.safeParse({ ...validMatrix, gridFlow: "rowsAndColumns" }).success).toBe(true);
    expect(PuzzleSchema.safeParse({ ...validMatrix, gridFlow: "diagonals" }).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validSequence, gridFlow: "rows" }).success).toBe(false);
    // It says where a rule applies, never what it is, so the public puzzle keeps it.
    expect(toPublicPuzzle({ ...validMatrix, gridFlow: "rows" } as Puzzle).gridFlow).toBe("rows");
  });
});

describe("PuzzleSchema — sequence", () => {
  it("accepts 4–8 panels with a single trailing blank", () => {
    expect(PuzzleSchema.safeParse(validSequence).success).toBe(true);
    const six = {
      ...validSequence,
      stem: [board(0, 0), board(0, 1), board(0, 2), board(1, 0), board(1, 1), BLANK],
    };
    expect(PuzzleSchema.safeParse(six).success).toBe(true);
    // Eight panels: the two-strand interleaved row (extrapolation gate needs
    // the answered strand shown three times).
    const eight = {
      ...validSequence,
      stem: [...Array.from({ length: 7 }, (_, i) => board(Math.floor(i / 3), i % 3)), BLANK],
    };
    expect(PuzzleSchema.safeParse(eight).success).toBe(true);
  });

  it("rejects too-short, too-long, non-trailing-blank, and wrong-layout stems", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, stem: [board(0, 0), board(0, 1), BLANK] }).success).toBe(false);
    const nine = { ...validSequence, stem: [...Array.from({ length: 8 }, (_, i) => board(Math.floor(i / 3), i % 3)), BLANK] };
    expect(PuzzleSchema.safeParse(nine).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...validSequence, stem: [BLANK, board(0, 0), board(0, 1), board(0, 2)] }).success).toBe(false);
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

describe("PuzzleSchema — difficulty range", () => {
  it("admits difficulty 6 and nothing above it, in every schema that carries one", () => {
    // The ceiling moved from 5 to 6 on 2026-08-26 so the `-d6` buckets at the
    // tail of induction-transfer can state their difficulty honestly.
    expect(MAXIMUM_DIFFICULTY).toBe(6);
    for (const difficulty of [1, 5, MAXIMUM_DIFFICULTY]) {
      expect(PuzzleSchema.safeParse({ ...validMatrix, difficulty }).success, `difficulty ${difficulty}`)
        .toBe(true);
      expect(PublicPuzzleSchema.safeParse(toPublicPuzzle({ ...validMatrix, difficulty })).success, `public ${difficulty}`)
        .toBe(true);
    }
    for (const difficulty of [0, MAXIMUM_DIFFICULTY + 1, 2.5]) {
      expect(PuzzleSchema.safeParse({ ...validMatrix, difficulty }).success, `difficulty ${difficulty}`)
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
    expect(PuzzleSchema.safeParse({
      ...validMatrix,
      difficulty: MAXIMUM_DIFFICULTY,
      generation,
    }).success).toBe(true);
    expect(PuzzleSchema.safeParse({
      ...validMatrix,
      difficulty: MAXIMUM_DIFFICULTY,
      generation: { ...generation, features: { ...generation.features, difficulty: MAXIMUM_DIFFICULTY + 1 } },
    }).success).toBe(false);
  });
});

describe("PuzzleSchema — options and answerIndex", () => {
  it("requires 4–6 options", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, options: validSequence.options.slice(0, 3) }).success).toBe(false);
  });

  it("rejects an out-of-range answerIndex", () => {
    expect(PuzzleSchema.safeParse({ ...validSequence, answerIndex: 4 }).success).toBe(false);
  });

  it("rejects render-identical options", () => {
    const dup = {
      ...validSequence,
      options: [board(1, 0), board(1, 0), board(0, 0, "square"), board(0, 1, "square")],
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

  it("accepts a three-row transformation machine", () => {
    const machine: Puzzle = {
      ...validMatrix,
      id: "machine-table",
      layout: "machineTable",
      stem: [scene(0), scene(1), scene(0, token("square")), scene(1), scene(0), scene(1, token("square")), scene(0), scene(1), { blank: true }],
      options: sceneOptions,
    };
    expect(PuzzleSchema.safeParse(machine).success).toBe(true);
    expect(PuzzleSchema.safeParse({ ...machine, stem: machine.stem.slice(0, 8) }).success).toBe(false);
  });

  it("keeps every board 2–3 by 2–3 and a machine table to two or three worked rows", () => {
    // The one-row strip that four- and five-gate questions needed left with the
    // d6 buckets, and with it the four- and five-row machine tables.
    const oneRow = (columns: number): Scene => ({
      kind: "scene",
      rows: 1,
      columns,
      objects: Array.from({ length: columns }, (_, column) => ({ row: 0, column, object: token("circle") })),
      tiles: [],
    });
    for (const columns of [3, 4, 5]) {
      expect(SceneSchema.safeParse(oneRow(columns)).success, `1x${columns}`).toBe(false);
    }
    expect(SceneSchema.safeParse({ ...board(0, 0), columns: 4 }).success).toBe(false);
    expect(MACHINE_TABLE_PANEL_COUNTS).toEqual([9, 12]);

    const gate = (...shapes: SceneToken["shape"][]): Scene => ({
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: shapes.map((shape, column) => ({ row: 1, column, object: token(shape) })),
      tiles: [],
    });
    const threeGateMachine: Puzzle = {
      ...validMatrix,
      id: "three-gate-machine",
      layout: "machineTable",
      stem: [
        scene(0), gate("triangle"), scene(1),
        scene(0), gate("square"), scene(1),
        scene(0), gate("diamond"), scene(1),
        scene(0), gate("triangle", "square", "diamond"), { blank: true },
      ],
      options: sceneOptions,
    };
    expect(PuzzleSchema.safeParse(threeGateMachine).success).toBe(true);
    // A fourth worked row makes fifteen panels, which is no longer a machine table.
    expect(PuzzleSchema.safeParse({
      ...threeGateMachine,
      stem: [scene(0), gate("triangle"), scene(1), ...threeGateMachine.stem],
    }).success).toBe(false);
  });

  it("shows only the gates the query runs, and runs only gates it shows", () => {
    // Owner's rule, 2026-09-29. rule-switching-v2 demonstrated two gates and
    // its query ran one, so every item showed a transformation that played no
    // part in the answer.
    const gate = (...shapes: SceneToken["shape"][]): Scene => ({
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: shapes.map((shape, column) => ({ row: 1, column, object: token(shape) })),
      tiles: [],
    });
    const machine: Puzzle = {
      ...validMatrix,
      id: "every-gate-used",
      layout: "machineTable",
      stem: [
        scene(0), gate("triangle"), scene(1),
        scene(0), gate("square"), scene(1),
        scene(0), gate("square", "triangle"), { blank: true },
      ],
      options: sceneOptions,
    };
    expect(PuzzleSchema.safeParse(machine).success).toBe(true);

    const queryRuns = (query: Scene) => PuzzleSchema.safeParse({
      ...machine,
      stem: machine.stem.map((panel, index) => index === 7 ? query : panel),
    });
    const unused = queryRuns(gate("triangle"));
    expect(unused.success).toBe(false);
    expect(unused.error?.issues.map((issue) => issue.message).join("\n"))
      .toMatch(/never run: solid square; never demonstrated: none/);
    const unshown = queryRuns(gate("square", "triangle", "diamond"));
    expect(unshown.success).toBe(false);
    expect(unshown.error?.issues.map((issue) => issue.message).join("\n"))
      .toMatch(/never run: none; never demonstrated: solid diamond/);
  });

  it("serves no answer and no hint about the question before it is answered", () => {
    // Family, band and difficulty left the pre-answer payload on 2026-09-28:
    // each says something about the question (which mechanism, how hard) that
    // the taker should work out, and the review screen reads them from the
    // submit response instead.
    const publicPuzzle = toPublicPuzzle({
      ...validSequence,
      familyId: "relational-sequence-v1",
      band: "warmup",
    });
    expect(Object.keys(publicPuzzle).sort()).toEqual(["id", "instruction", "layout", "options", "stem", "type"]);
    expect(publicPuzzle).not.toHaveProperty("answerIndex");
    expect(publicPuzzle).not.toHaveProperty("explanation");
    expect(publicPuzzle).not.toHaveProperty("familyId");
    expect(publicPuzzle).not.toHaveProperty("band");
    expect(publicPuzzle).not.toHaveProperty("difficulty");
    expect(PublicPuzzleSchema.safeParse(publicPuzzle).success).toBe(true);
  });

  it("serves every scene option's objects in reading order, however it was built", () => {
    // When exactly one option's object list was out of row/column order, that
    // option was never the answer (0 of 28 cases in 600 items, 2026-09-28): the
    // order was a leak nobody could see on screen. The public payload now lists
    // every option's objects row by row, then column by column.
    const at = (row: number, column: number, shape: SceneToken["shape"]) => ({
      row, column, object: { kind: "token" as const, shape, rotation: 0, fill: "outline" as const, size: "l" as const },
    });
    const board = (objects: ReturnType<typeof at>[]): Scene =>
      ({ kind: "scene", rows: 3, columns: 3, objects, tiles: [] });
    const options = [
      board([at(2, 2, "circle"), at(0, 1, "square")]),
      board([at(0, 0, "circle"), at(1, 2, "square")]),
      board([at(1, 0, "circle"), at(0, 2, "star"), at(0, 1, "square")]),
      board([at(2, 0, "circle")]),
    ];
    const puzzle = {
      id: "t-scene-order",
      type: "analogy" as const,
      instruction: "Complete the analogy.",
      difficulty: 3,
      layout: "analogy" as const,
      stem: [options[1], options[3], options[2]],
      options,
      answerIndex: 0,
      explanation: "fixture",
    };
    const served = toPublicPuzzle(puzzle as never) as unknown as { options: Scene[] };
    for (const option of served.options) {
      const cells = option.objects.map((placement) => placement.row * 3 + placement.column);
      expect(cells).toEqual([...cells].sort((left, right) => left - right));
    }
    // Only the order moved: every option is the same board, in the same place.
    expect(served.options.map(sceneSignature)).toEqual(options.map(sceneSignature));
  });
});

describe("PuzzleSetSchema", () => {
  const five = [validMatrix, validSequence, validAnalogy, { ...validSequence, id: "t-seq-2" }, { ...validMatrix, id: "t-matrix-2" }];
  const sized = (length: number) => Array.from({ length }, (_, index) => ({ ...validMatrix, id: `t-matrix-${index + 1}` }));

  it("accepts 5-item and 30-item sets with unique ids", () => {
    expect(PuzzleSetSchema.safeParse(five).success).toBe(true);
    expect(PuzzleSetSchema.safeParse(sized(30)).success).toBe(true);
    expect(PublicPuzzleSetSchema.safeParse(five.map(toPublicPuzzle)).success).toBe(true);
    expect(PublicPuzzleSetSchema.safeParse(sized(30).map(toPublicPuzzle)).success).toBe(true);
  });

  it("rejects duplicate ids and wrong set sizes", () => {
    expect(PuzzleSetSchema.safeParse([...five.slice(0, 4), { ...validMatrix }]).success).toBe(false);
    expect(PuzzleSetSchema.safeParse(five.slice(0, 4)).success).toBe(false);
    expect(PuzzleSetSchema.safeParse([...five, { ...validMatrix, id: "sixth" }]).success).toBe(false);
    // 12 was the length of a retired profile.
    expect(PuzzleSetSchema.safeParse(sized(12)).success).toBe(false);
  });
});

describe("shuffleOptions", () => {
  it("preserves the option multiset and keeps the same option correct", () => {
    for (let i = 0; i < 50; i++) {
      const shuffled = shuffleOptions(validAnalogy);
      expect(shuffled.options).toHaveLength(validAnalogy.options.length);
      expect(shuffled.options[shuffled.answerIndex]).toEqual(validAnalogy.options[validAnalogy.answerIndex]);
      const sort = (options: Scene[]) => [...options].map((x) => JSON.stringify(x)).sort();
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

  it("adds the arrow to the six base shapes", () => {
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
    const puzzle: Puzzle = {
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
    expect(PuzzleSchema.safeParse(puzzle).success).toBe(true);
  });
});
