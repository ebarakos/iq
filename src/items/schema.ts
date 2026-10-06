import { z } from "zod";
import {
  DIMENSIONS,
  FILLS,
  isSceneTokenInstantlyDistinct,
  ROTATIONS,
  SCENE_ORIENTABLE_SHAPES,
  SCENE_SHAPES,
  SIZES,
} from "./domains";

/**
 * Visual puzzle schema — the contract between the generators and the
 * deterministic SVG renderer.
 *
 * Nothing draws freehand. Every picture is a scene: a small board with
 * bounded positions, containment, and edge connections. The app renders
 * identical SVG from that description, so the displayed puzzle and the marked
 * answer are always internally consistent.
 *
 * Dimension domains and render-identity helpers live in domains.ts (re-exported
 * here).
 */

export { SHAPES, SCENE_SHAPES, FILLS, FILL_LOOP, SIZES, ROTATIONS } from "./domains";
export type { Shape, SceneShape } from "./domains";

/**
 * How many answer options every generated item offers — **the single place this
 * number is set**. Change it here and the whole battery follows: families build
 * `DISTRACTORS_PER_ITEM` near misses, the assembler serves that many options,
 * and both renderers lay them out.
 *
 * More options make an item harder in the only way this project accepts: they
 * lower the value of a guess (1 in 6 rather than 1 in 4) without making any
 * single option harder to see. Difficulty still comes from the rule.
 */
export const OPTIONS_PER_ITEM = 6;

/** Wrong options per item. The answer plus these make one full option list. */
export const DISTRACTORS_PER_ITEM = OPTIONS_PER_ITEM - 1;

/**
 * Structural bounds on an option list, wider than `OPTIONS_PER_ITEM` on purpose.
 * The floor keeps items authored under an earlier setting readable, so lowering
 * the constant never invalidates a stored item; the ceiling is the real limit of
 * the agent image composer, which fits one row of six options.
 */
export const MINIMUM_OPTIONS_PER_ITEM = 4;
export const MAXIMUM_OPTIONS_PER_ITEM = 6;

/**
 * Hardest difficulty an item may claim.
 *
 * The ceiling moved from 5 to 6 on 2026-08-26 (`docs/plans/raise-the-ceiling-v12.md`).
 * The v11 battery topped out at 5 and the pilot participant solved five of its
 * six d5 items, so the top of the ladder was no longer measuring anything: a
 * test that nobody misses cannot tell two people apart at the top. Difficulty 6
 * is reserved for buckets whose program has one more step that provably changes
 * the answer — never for a smaller mark, a busier board, or a relabelled d5.
 * No served bucket uses 6 since the d6 tail was withdrawn on 2026-08-27.
 */
export const MAXIMUM_DIFFICULTY = 6;

if (OPTIONS_PER_ITEM < MINIMUM_OPTIONS_PER_ITEM || OPTIONS_PER_ITEM > MAXIMUM_OPTIONS_PER_ITEM) {
  throw new Error(
    `OPTIONS_PER_ITEM must be between ${MINIMUM_OPTIONS_PER_ITEM} and ${MAXIMUM_OPTIONS_PER_ITEM}, ` +
      `but it is ${OPTIONS_PER_ITEM}. Raising the ceiling means changing the option letters in ` +
      "src/lib/solver.ts, the option grid in src/items/compose-image.tsx, and the keyboard " +
      "shortcuts in src/app/quiz.tsx first.",
  );
}

/** Cardinal board edges, kept in this order so one tile has one canonical encoding. */
export const CONNECTION_EDGES = ["north", "east", "south", "west"] as const;
export type ConnectionEdge = (typeof CONNECTION_EDGES)[number];

const SceneTokenFields = {
  kind: z.literal("token"),
  /** Scenes use the wider vocabulary: the legacy six shapes plus the arrow. */
  shape: z.enum(SCENE_SHAPES),
  rotation: z.number().int().refine((r) => (ROTATIONS as readonly number[]).includes(r), {
    message: "rotation must be one of 0,90,180,270 (quarter turns)",
  }),
  fill: z.enum(FILLS),
  size: z.enum(SIZES).refine((size) => size !== "s", {
    message: "scene tokens must be medium or large enough to read at answer-option size",
  }),
} as const;

/** One independently drawable token in a scene. Counts come from separate placements. */
export const SceneTokenSchema = z
  .object(SceneTokenFields)
  .strict()
  .refine((token) => token.rotation === 0 || (SCENE_ORIENTABLE_SHAPES as readonly string[]).includes(token.shape), {
    message: "only triangles and arrows may be rotated",
    path: ["rotation"],
  });
export type SceneToken = z.infer<typeof SceneTokenSchema>;

/**
 * A visible outline containing one or two tokens. Scene tokens deliberately
 * exclude the small size at the shared token schema: at answer-option size it
 * would turn containment into a visual-acuity test.
 */
export const SceneContainerSchema = z.object({
  kind: z.literal("container"),
  /** Outer outlines stay symmetric on purpose: an arrow is a token, never a container. */
  shape: z.enum(["circle", "square", "diamond", "hexagon"]),
  contents: z.array(SceneTokenSchema).min(1).max(2),
}).strict();
export type SceneContainer = z.infer<typeof SceneContainerSchema>;

export const SceneObjectSchema = z.union([SceneTokenSchema, SceneContainerSchema]);
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const ScenePlacementSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  object: SceneObjectSchema,
}).strict();
export type ScenePlacement = z.infer<typeof ScenePlacementSchema>;

export const ConnectionTileSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  edges: z
    .array(z.enum(CONNECTION_EDGES))
    .min(1)
    .max(CONNECTION_EDGES.length)
    .refine((edges) => new Set(edges).size === edges.length, {
      message: "connection edges must be distinct",
    })
    .refine(
      (edges) => edges.every((edge, index) => index === 0 ||
        CONNECTION_EDGES.indexOf(edges[index - 1]) < CONNECTION_EDGES.indexOf(edge)),
      { message: "connection edges must use north, east, south, west order" },
    ),
}).strict();
export type ConnectionTile = z.infer<typeof ConnectionTileSchema>;

/** A centred dashed fold guide. It is visually distinct from connection paths. */
export const SceneGuideSchema = z.object({
  kind: z.literal("crease"),
  axis: z.enum(["horizontal", "vertical"]),
  direction: z.enum(["leftToRight", "rightToLeft", "topToBottom", "bottomToTop"]),
}).strict().refine((guide) => guide.axis === "vertical"
  ? guide.direction === "leftToRight" || guide.direction === "rightToLeft"
  : guide.direction === "topToBottom" || guide.direction === "bottomToTop", {
  message: "fold direction must cross the declared crease axis",
  path: ["direction"],
});
export type SceneGuide = z.infer<typeof SceneGuideSchema>;

/**
 * A small categorical board shared by relational, constraint, and topology
 * families. Coordinates are zero-based and validated against the declared board.
 */
export const SceneSchema = z.object({
  kind: z.literal("scene"),
  rows: z.number().int().min(2).max(3),
  columns: z.number().int().min(2).max(3),
  objects: z.array(ScenePlacementSchema).max(9).default([]),
  tiles: z.array(ConnectionTileSchema).max(9).default([]),
  guides: z.array(SceneGuideSchema).max(2).optional(),
}).strict().superRefine((scene, ctx) => {
  if (scene.objects.length + scene.tiles.length + (scene.guides?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a scene must contain at least one object or connection tile" });
  }

  if (scene.guides && new Set(scene.guides.map((guide) => `${guide.kind}:${guide.axis}:${guide.direction}`)).size !== scene.guides.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["guides"], message: "scene guides must be distinct" });
  }

  const occupied = new Set<string>();
  for (const [collection, entries] of [["objects", scene.objects], ["tiles", scene.tiles]] as const) {
    entries.forEach((entry, index) => {
      if (entry.row >= scene.rows || entry.column >= scene.columns) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [collection, index],
          message: `position (${entry.row}, ${entry.column}) is outside the ${scene.rows}x${scene.columns} board`,
        });
      }
      const key = `${entry.row}:${entry.column}`;
      if (occupied.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [collection, index],
          message: `board position (${entry.row}, ${entry.column}) may contain only one visible primitive`,
        });
      }
      occupied.add(key);
    });
  }
});
export type Scene = z.infer<typeof SceneSchema>;

/** A stem panel is either a scene or an explicit blank (the "?" to solve). */
export const PanelSchema = z.union([SceneSchema, z.object({ blank: z.literal(true) }).strict()]);
export type Panel = z.infer<typeof PanelSchema>;

export const PUZZLE_TYPES = ["matrix", "sequence", "analogy"] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

/** How the stem panels are arranged on screen. */
export const LAYOUTS = ["grid3x3", "row", "analogy", "machineTable"] as const;
export type Layout = (typeof LAYOUTS)[number];

/**
 * Which directions of a `grid3x3` carry a rule. Only a one-way grid draws
 * arrows: "rows" puts one before the third board of every row. A
 * "rowsAndColumns" grid reads both ways and draws none (owner's decision,
 * 2026-10-03), nor does a grid built before the field existed. It says where a
 * rule applies, never what it is, so it is public.
 */
export const GRID_FLOWS = ["rows", "rowsAndColumns"] as const;
export type GridFlow = (typeof GRID_FLOWS)[number];
/**
 * Legal stem lengths for a `machineTable`: one triple per worked (input, gate,
 * output) row, plus the query triple whose output is the blank. Two or three
 * worked rows: no item shows more than three gates (owner, 2026-08-27), and
 * every gate a row shows is one the query runs.
 */
export const MACHINE_TABLE_PANEL_COUNTS: readonly number[] = [9, 12];

export const REASONING_BANDS = ["warmup", "composition", "constraint-spatial", "induction-transfer"] as const;
export type ReasoningBand = (typeof REASONING_BANDS)[number];

/** Stable, compact features used to calibrate generated puzzle buckets. */
export const GenerationFeatureVectorSchema = z.object({
  difficulty: z.number().int().min(1).max(MAXIMUM_DIFFICULTY),
  ruleComplexity: z.number().int().nonnegative(),
  programDepth: z.number().int().positive(),
  activeDimensions: z.array(z.enum(DIMENSIONS)).max(DIMENSIONS.length),
  usesWrap: z.boolean(),
  distractorStrategy: z.enum(["near-miss", "coherent-outlier"]),
}).strict();
export type GenerationFeatureVector = z.infer<typeof GenerationFeatureVectorSchema>;

/** Internal generator provenance. Explicit public DTOs below omit this object. */
export const GenerationMetadataSchema = z.object({
  generatorVersion: z.string().min(1),
  familyId: z.string().min(1),
  programFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  featureBucket: z.string().min(1),
  features: GenerationFeatureVectorSchema,
}).strict();
export type GenerationMetadata = z.infer<typeof GenerationMetadataSchema>;

export const PuzzleSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(PUZZLE_TYPES),
    /** Short, neutral instruction (kept minimal — the task should be visual). */
    instruction: z.string().min(3).max(140),
    /** 1 (easiest) … 6 (hardest). */
    difficulty: z.number().int().min(1).max(MAXIMUM_DIFFICULTY),
    layout: z.enum(LAYOUTS),
    /** Versioned reasoning-family identity for family-aware results and calibration. */
    familyId: z.string().min(1).optional(),
    band: z.enum(REASONING_BANDS).optional(),
    /** Directions of a 3x3 grid that carry a rule; see GRID_FLOWS. */
    gridFlow: z.enum(GRID_FLOWS).optional(),
    /**
     * The question, as a list of panels.
     *  - matrix:   9 panels (grid3x3) with exactly one { blank: true }, or a
     *              machine table of (input, gate, output) triples whose last
     *              output is the blank
     *  - sequence: 4–8 panels (row) with exactly one trailing { blank: true }
     *  - analogy:  exactly [A, B, C] visuals (layout "analogy"); the renderer adds the "?"
     */
    stem: z.array(PanelSchema),
    /** Multiple-choice options rendered through the shared visual contract. */
    options: z.array(SceneSchema).min(MINIMUM_OPTIONS_PER_ITEM).max(MAXIMUM_OPTIONS_PER_ITEM),
    /** 0-based index into `options` of the single correct answer. */
    answerIndex: z.number().int().min(0),
    /** Detailed answer reasoning, shown only in the completed-test review. */
    explanation: z.string().min(3).max(800),
    /** Present on deterministic runtime items; absent on legacy/authored items. */
    generation: GenerationMetadataSchema.optional(),
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex out of range",
    path: ["answerIndex"],
  })
  .superRefine((p, ctx) => {
    const blanks = p.stem.filter(isBlank).length;
    if (p.type === "matrix") {
      const grid = p.layout === "grid3x3" && p.stem.length === 9 && blanks === 1;
      // 9 or 12 panels: two or three worked (input, gate, output) rows plus the
      // query row. The 15- and 18-panel forms of the four- and five-gate
      // buckets left with the d6 tail.
      const machine = p.layout === "machineTable" &&
        MACHINE_TABLE_PANEL_COUNTS.includes(p.stem.length) && blanks === 1 &&
        isBlank(p.stem[p.stem.length - 1]);
      if (!grid && !machine) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "matrix must be a 3x3 grid or a two- to five-row machine table" });
      }
    } else if (p.type === "sequence") {
      // 4–8 panels total: 3–7 drawn cells + exactly one trailing blank. Variable
      // length is a difficulty lever (more cells → more pattern to infer), and
      // the top widened from 6 to 8 on 2026-08-24 so a two-strand interleaved
      // row can show every strand's step at least twice (extrapolation gate).
      const lastIsBlank = p.stem.length > 0 && isBlank(p.stem[p.stem.length - 1]);
      if (p.layout !== "row" || p.stem.length < 4 || p.stem.length > 8 || blanks !== 1 || !lastIsBlank) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sequence must be a row of 4–8 panels whose ONLY blank is the trailing one" });
      }
    } else if (p.type === "analogy") {
      if (p.layout !== "analogy" || p.stem.length !== 3 || blanks !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "analogy must be layout 'analogy' with exactly 3 cells and no blank" });
      }
    }

    if (p.gridFlow !== undefined && p.layout !== "grid3x3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gridFlow"],
        message: "gridFlow is only valid for grid3x3 puzzles",
      });
    }

    // Every gate a table shows must take part in the answer (owner's rule,
    // 2026-09-29). A worked row demonstrating a gate the query never runs shows
    // a transformation for nothing, and a query gate no worked row demonstrates
    // cannot be read. So the glyphs in the worked rows' gate column and the
    // glyphs in the query's gate panel must be the same set.
    const tableRowLength = 3;
    if (p.layout === "machineTable" && p.stem.length > tableRowLength && p.stem.length % tableRowLength === 0) {
      const glyphs = (panel: Panel) => new Map(!isBlank(panel)
        ? panel.objects.map(({ object }) => [JSON.stringify(object),
          object.kind === "token" ? `${object.fill} ${object.shape}` : object.kind] as const)
        : []);
      const queryGate = glyphs(p.stem[p.stem.length - tableRowLength + 1]);
      const workedGates = new Map(p.stem.slice(0, -tableRowLength)
        .filter((_, index) => index % tableRowLength === 1)
        .flatMap((panel) => [...glyphs(panel)]));
      const unused = [...workedGates].filter(([key]) => !queryGate.has(key)).map(([, label]) => label);
      const unshown = [...queryGate].filter(([key]) => !workedGates.has(key)).map(([, label]) => label);
      if (unused.length > 0 || unshown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stem"],
          message: "every demonstrated gate must be run by the query, and every query gate demonstrated " +
            `(never run: ${unused.join(", ") || "none"}; never demonstrated: ${unshown.join(", ") || "none"})`,
        });
      }
    }
    // Legibility doctrine: every pair of options must be INSTANTLY tellable
    // apart (a different board feature: position, shape, fill, small-vs-large,
    // or arrows and triangles pointing different ways). Subtle pairs make the
    // item a visual-acuity test instead of a reasoning test, so they are as
    // ill-posed as identical renders — both are rejected here.
    for (let i = 0; i < p.options.length; i++) {
      for (let j = i + 1; j < p.options.length; j++) {
        if (!areScenesCategoricallyDistinct(p.options[i], p.options[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: `options ${i} and ${j} are not instantly distinguishable — scene options must differ in a categorical board feature`,
          });
        }
      }
    }
  });

export type Puzzle = z.infer<typeof PuzzleSchema>;

/**
 * Answer-free puzzle contract served before a quiz is submitted.
 *
 * Keep this as an explicit schema rather than relying on TypeScript's `Omit`:
 * types disappear at runtime, while this schema also strips unknown private
 * fields if an internal puzzle is passed to it.
 *
 * Since 2026-09-28 it also leaves out `familyId`, `band` and `difficulty`.
 * Each is a hint about the question before it is answered — which mechanism,
 * how hard — and the page needs them only on the review screen, which reads
 * them from the submit response instead.
 */
export const PublicPuzzleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PUZZLE_TYPES),
  instruction: z.string().min(3).max(140),
  layout: z.enum(LAYOUTS),
  gridFlow: z.enum(GRID_FLOWS).optional(),
  stem: z.array(PanelSchema),
  options: z.array(SceneSchema).min(MINIMUM_OPTIONS_PER_ITEM).max(MAXIMUM_OPTIONS_PER_ITEM),
});
export type PublicPuzzle = z.infer<typeof PublicPuzzleSchema>;

/**
 * One scene written the same way however it was built: objects and tiles in
 * reading order (row, then column).
 *
 * Near misses are built by several routes, and a few of them appended a moved
 * token at the end of the list instead of in its place. The list order is
 * invisible on screen but not in the payload: when exactly one option's list
 * was out of order, that option was never the answer (0 of 28 such items in a
 * 600-item sample, 2026-09-28). Serving every option in one canonical order
 * leaves nothing to read off it.
 */
function canonicalSceneOrder(visual: Scene): Scene {
  const byPosition = <T extends { row: number; column: number }>(left: T, right: T) =>
    left.row - right.row || left.column - right.column;
  return {
    ...visual,
    objects: [...visual.objects].sort(byPosition),
    tiles: [...visual.tiles].sort(byPosition),
  };
}

/** Strip the answer key and authoring metadata at the server boundary. */
export function toPublicPuzzle(puzzle: Puzzle): PublicPuzzle {
  const parsed = PublicPuzzleSchema.parse(puzzle);
  return { ...parsed, options: parsed.options.map(canonicalSceneOrder) };
}

/** The two public lengths. */
export const PUZZLE_SET_LENGTHS = [5, 30] as const;

export const PuzzleSetSchema = z
  .array(PuzzleSchema)
  .refine((set) => (PUZZLE_SET_LENGTHS as readonly number[]).includes(set.length), {
    message: "a puzzle set must contain 5 or 30 items",
  })
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PuzzleSet = Puzzle[];

export const PublicPuzzleSetSchema = z
  .array(PublicPuzzleSchema)
  .refine((set) => (PUZZLE_SET_LENGTHS as readonly number[]).includes(set.length), {
    message: "a public puzzle set must contain 5 or 30 items",
  })
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PublicPuzzleSet = PublicPuzzle[];

/** Strip private fields from a complete legacy or current quiz. */
export function toPublicPuzzleSet(puzzles: PuzzleSet): PublicPuzzleSet {
  return PublicPuzzleSetSchema.parse(puzzles.map(toPublicPuzzle));
}

/** Type guard: is this panel a blank placeholder? */
export function isBlank(panel: Panel): panel is { blank: true } {
  return "blank" in panel;
}

/** Canonical signature for exact visual-scene duplicate rejection. */
export function sceneSignature(scene: Scene): string {
  const objects = [...scene.objects].sort((a, b) => a.row - b.row || a.column - b.column);
  const tiles = [...scene.tiles].sort((a, b) => a.row - b.row || a.column - b.column);
  const guides = [...(scene.guides ?? [])].sort((a, b) => a.axis.localeCompare(b.axis));
  return JSON.stringify({ rows: scene.rows, columns: scene.columns, objects, tiles, guides });
}

function sceneObjectIsDistinct(left: SceneObject, right: SceneObject): boolean {
  if (left.kind !== right.kind) return true;
  if (left.kind === "token" && right.kind === "token") {
    return isSceneTokenInstantlyDistinct(left, right);
  }
  if (left.kind === "container" && right.kind === "container") {
    if (left.shape !== right.shape || left.contents.length !== right.contents.length) return true;
    return left.contents.some((token, index) =>
      isSceneTokenInstantlyDistinct(token, right.contents[index]));
  }
  return true;
}

/**
 * Scene-option legibility: board position, containment, edge topology, shape,
 * fill, count, or a clearly separated size must differ. Medium-vs-large alone is
 * intentionally not enough.
 */
export function areScenesCategoricallyDistinct(left: Scene, right: Scene): boolean {
  if (left.rows !== right.rows || left.columns !== right.columns) return true;

  const leftObjects = new Map(left.objects.map((entry) => [`${entry.row}:${entry.column}`, entry.object]));
  const rightObjects = new Map(right.objects.map((entry) => [`${entry.row}:${entry.column}`, entry.object]));
  if (leftObjects.size !== rightObjects.size) return true;
  for (const [position, object] of leftObjects) {
    const other = rightObjects.get(position);
    if (!other || sceneObjectIsDistinct(object, other)) return true;
  }

  const tileKey = (tile: ConnectionTile) => `${tile.row}:${tile.column}:${tile.edges.join(",")}`;
  const leftTiles = new Set(left.tiles.map(tileKey));
  const rightTiles = new Set(right.tiles.map(tileKey));
  if (leftTiles.size !== rightTiles.size) return true;
  if ([...leftTiles].some((tile) => !rightTiles.has(tile))) return true;

  const leftGuides = new Set((left.guides ?? []).map((guide) => `${guide.kind}:${guide.axis}:${guide.direction}`));
  const rightGuides = new Set((right.guides ?? []).map((guide) => `${guide.kind}:${guide.axis}:${guide.direction}`));
  return leftGuides.size !== rightGuides.size || [...leftGuides].some((guide) => !rightGuides.has(guide));
}

/**
 * Fisher-Yates shuffle of a puzzle's options, remapping `answerIndex` so the same
 * cell stays correct. Returns a new puzzle (does not mutate the input). Used to
 * remove the generating model's answer-position bias before the test is served.
 */
export function shuffleOptions(puzzle: Puzzle): Puzzle {
  const order = puzzle.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const options = order.map((i) => puzzle.options[i]);
  const answerIndex = order.indexOf(puzzle.answerIndex);
  return { ...puzzle, options, answerIndex };
}
