import { z } from "zod";
import { FILLS, isInstantlyDistinct, ORIENTABLE_SHAPES, ROTATIONS, SHAPES, SIZES } from "./domains";
import { DIMENSIONS, RuleSchema } from "./rules";

/**
 * Visual puzzle schema — the contract between the generator (llm-relay model)
 * and the deterministic SVG renderer.
 *
 * The model never draws anything. It emits a compact, constrained description of
 * each visual. Compact cells retain shape/count/rotation/fill/size; richer scenes
 * use bounded board positions, containment, and edge connections. The app renders
 * identical SVG from that description, so the displayed puzzle and the marked
 * answer are always internally consistent — even with a weak model.
 *
 * Dimension domains and render-identity helpers live in domains.ts (re-exported
 * here); the machine-readable rule DSL + semantic validator live in rules.ts.
 */

export { SHAPES, FILLS, SIZES, ROTATIONS, visualSignature } from "./domains";

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

if (OPTIONS_PER_ITEM < MINIMUM_OPTIONS_PER_ITEM || OPTIONS_PER_ITEM > MAXIMUM_OPTIONS_PER_ITEM) {
  throw new Error(
    `OPTIONS_PER_ITEM must be between ${MINIMUM_OPTIONS_PER_ITEM} and ${MAXIMUM_OPTIONS_PER_ITEM}, ` +
      `but it is ${OPTIONS_PER_ITEM}. Raising the ceiling means changing the option letters in ` +
      "src/lib/solver.ts, the option grid in src/items/compose-image.tsx, and the keyboard " +
      "shortcuts in src/app/page.tsx first.",
  );
}

/** A single drawable cell: `count` copies of `shape`, arranged in a mini-grid. */
export const CellSchema = z
  .object({
    shape: z.enum(SHAPES),
    /** 1–4 copies of the shape, laid out automatically by the renderer. */
    count: z.number().int().min(1).max(4),
    /** Quarter turns only; meaningful (and allowed non-zero) only on triangles. */
    rotation: z.number().int().refine((r) => (ROTATIONS as readonly number[]).includes(r), {
      message: "rotation must be one of 0,90,180,270 (quarter turns)",
    }),
    fill: z.enum(FILLS),
    size: z.enum(SIZES),
  })
  .refine((c) => c.rotation === 0 || (ORIENTABLE_SHAPES as readonly string[]).includes(c.shape), {
    message:
      "only triangles may be rotated — every other shape is too symmetric for its orientation to be readable; use rotation 0",
    path: ["rotation"],
  });
export type Cell = z.infer<typeof CellSchema>;

/** Cardinal board edges, kept in this order so one tile has one canonical encoding. */
export const CONNECTION_EDGES = ["north", "east", "south", "west"] as const;
export type ConnectionEdge = (typeof CONNECTION_EDGES)[number];

const SceneTokenFields = {
  kind: z.literal("token"),
  shape: z.enum(SHAPES),
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
  .refine((token) => token.rotation === 0 || (ORIENTABLE_SHAPES as readonly string[]).includes(token.shape), {
    message: "only triangles may be rotated",
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

/** Current compact cells and richer board scenes share one renderer contract. */
export const VisualSchema = z.union([CellSchema, SceneSchema]);
export type Visual = z.infer<typeof VisualSchema>;

/** A stem panel is either a visual or an explicit blank (the "?" to solve). */
export const PanelSchema = z.union([VisualSchema, z.object({ blank: z.literal(true) }).strict()]);
export type Panel<V extends Visual = Cell> = V | { blank: true };

export const PUZZLE_TYPES = ["matrix", "sequence", "analogy", "oddOneOut", "operatorInduction"] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

/** How the stem panels are arranged on screen. */
export const LAYOUTS = ["grid3x3", "row", "analogy", "operatorTable", "machineTable", "conceptGroups", "singleScene"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const REASONING_BANDS = ["warmup", "composition", "constraint-spatial", "induction-transfer"] as const;
export type ReasoningBand = (typeof REASONING_BANDS)[number];

/** Public visual legend for the per-item nominal shape order used by an operator puzzle. */
export const OperatorLegendSchema = z.object({
  shapeCycle: z
    .array(z.enum(SHAPES))
    .min(3)
    .max(6)
    .refine((values) => new Set(values).size === values.length, {
      message: "operator shapeCycle values must be distinct",
    }),
});
export type OperatorLegend = z.infer<typeof OperatorLegendSchema>;

/** Stable, compact features used to calibrate generated puzzle buckets. */
export const GenerationFeatureVectorSchema = z.object({
  difficulty: z.number().int().min(1).max(5),
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

const RuntimePuzzleSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(PUZZLE_TYPES),
    /** Short, neutral instruction (kept minimal — the task should be visual). */
    instruction: z.string().min(3).max(140),
    /** 1 (easiest) … 5 (hardest). */
    difficulty: z.number().int().min(1).max(5),
    layout: z.enum(LAYOUTS),
    /** Versioned reasoning-family identity for family-aware results and calibration. */
    familyId: z.string().min(1).optional(),
    band: z.enum(REASONING_BANDS).optional(),
    /** Visible ordering for nominal shape arithmetic; never contains answer data. */
    operatorLegend: OperatorLegendSchema.optional(),
    /**
     * The question, as a list of panels.
     *  - matrix:    9 panels (grid3x3) with exactly one { blank: true }
     *  - sequence:  4–6 panels (row) with exactly one trailing { blank: true }
     *  - analogy:   exactly [A, B, C] visuals (layout "analogy"); renderer adds ":" "::" "?"
     *  - oddOneOut: empty [] — the options ARE the items; pick the one that doesn't belong
     */
    stem: z.array(PanelSchema),
    /** Multiple-choice options rendered through the shared visual contract. */
    options: z.array(VisualSchema).min(MINIMUM_OPTIONS_PER_ITEM).max(MAXIMUM_OPTIONS_PER_ITEM),
    /** 0-based index into `options` of the single correct answer. */
    answerIndex: z.number().int().min(0),
    /** Detailed answer reasoning, shown only in the completed-test review. */
    explanation: z.string().min(3).max(800),
    /** Present on deterministic runtime items; absent on legacy/authored items. */
    generation: GenerationMetadataSchema.optional(),
    /**
     * Machine-readable rule the puzzle follows (see rules.ts). Optional escape
     * hatch: items without a rule are "unvalidated" — renderable and servable,
     * but `checkRule` cannot verify them and the calibrated bank excludes them.
     */
    rule: RuleSchema.optional(),
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex out of range",
    path: ["answerIndex"],
  })
  .superRefine((p, ctx) => {
    if (p.rule && p.rule.kind !== p.type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rule"], message: `rule.kind "${p.rule.kind}" must match the puzzle type "${p.type}"` });
    }

    const blanks = p.stem.filter(isBlank).length;
    if (p.type === "matrix") {
      const grid = p.layout === "grid3x3" && p.stem.length === 9 && blanks === 1;
      const board = p.layout === "singleScene" && p.stem.length === 1 && blanks === 0 &&
        !isBlank(p.stem[0]) && isScene(p.stem[0]);
      const machine = p.layout === "machineTable" && (p.stem.length === 9 || p.stem.length === 12) && blanks === 1 &&
        isBlank(p.stem[p.stem.length - 1]);
      if (!grid && !board && !machine) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "matrix must be a 3x3 grid, one incomplete scene, or a three- or four-row machine table" });
      }
    } else if (p.type === "sequence") {
      // 4–6 panels total: 3–5 drawn cells + exactly one trailing blank. Variable
      // length is a difficulty lever (more cells → more pattern to infer).
      const lastIsBlank = p.stem.length > 0 && isBlank(p.stem[p.stem.length - 1]);
      if (p.layout !== "row" || p.stem.length < 4 || p.stem.length > 6 || blanks !== 1 || !lastIsBlank) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sequence must be a row of 4–6 panels whose ONLY blank is the trailing one" });
      }
    } else if (p.type === "analogy") {
      if (p.layout !== "analogy" || p.stem.length !== 3 || blanks !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "analogy must be layout 'analogy' with exactly 3 cells and no blank" });
      }
    } else if (p.type === "oddOneOut") {
      // Classic outliers use options only. Scene concept induction reuses the
      // same choose-one answer shape with three positive and three negative examples.
      const classic = p.layout === "row" && p.stem.length === 0;
      const concept = p.layout === "conceptGroups" && p.stem.length === 6 && blanks === 0 &&
        p.stem.every((panel) => !isBlank(panel) && isScene(panel));
      const repair = p.layout === "singleScene" && p.stem.length === 1 && blanks === 0 &&
        !isBlank(p.stem[0]) && isScene(p.stem[0]);
      if (!classic && !concept && !repair) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "oddOneOut must be an empty row, six conceptGroups examples, or one singleScene repair prompt" });
      }
    } else if (p.type === "operatorInduction") {
      // Consecutive triples encode (left, right) -> output. There are 3–5
      // worked triples followed by one query triple whose output is the blank.
      const validLength = p.stem.length === 12 || p.stem.length === 15 || p.stem.length === 18;
      const lastIsBlank = p.stem.length > 0 && isBlank(p.stem[p.stem.length - 1]);
      if (p.layout !== "operatorTable" || !validLength || blanks !== 1 || !lastIsBlank) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "operatorInduction must be 3–5 worked triples plus one query triple, with its only blank last",
        });
      }
      if (!p.operatorLegend) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operatorLegend"], message: "operatorInduction needs a visible shapeCycle legend" });
      } else {
        const allowed = new Set(p.operatorLegend.shapeCycle);
        const visuals: Visual[] = [...p.options];
        for (const panel of p.stem) {
          if (!isBlank(panel)) visuals.push(panel);
        }
        if (visuals.some((visual) => !isCell(visual) || !allowed.has(visual.shape))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["operatorLegend", "shapeCycle"],
            message: "operatorInduction supports compact cells only, and every shape must appear in its visible shapeCycle",
          });
        }
      }
    }

    if (p.type !== "operatorInduction" && p.operatorLegend !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operatorLegend"],
        message: "operatorLegend is only valid for operatorInduction puzzles",
      });
    }

    const optionKinds = new Set(p.options.map((visual) => isScene(visual) ? "scene" : "cell"));
    if (optionKinds.size > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "all answer options must use the same visual vocabulary",
      });
    }
    for (const [index, panel] of p.stem.entries()) {
      if (isBlank(panel)) continue;
      const kind = isScene(panel) ? "scene" : "cell";
      if (optionKinds.size === 1 && !optionKinds.has(kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stem", index],
          message: "stem visuals and answer options must use the same visual vocabulary",
        });
      }
    }

    // Legibility doctrine: every pair of options must be INSTANTLY tellable
    // apart (different shape, count, or fill; small-vs-large; or triangles
    // pointing different ways). Subtle pairs make the item a visual-acuity
    // test instead of a reasoning test, so they are as ill-posed as identical
    // renders — both are rejected here.
    for (let i = 0; i < p.options.length; i++) {
      for (let j = i + 1; j < p.options.length; j++) {
        const left = p.options[i];
        const right = p.options[j];
        const indistinct = isCell(left) && isCell(right)
          ? !isInstantlyDistinct(left, right)
          : isScene(left) && isScene(right)
            ? !areScenesCategoricallyDistinct(left, right)
            : false;
        if (indistinct) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: `options ${i} and ${j} are not instantly distinguishable — compact cells must differ obviously, and scene options must differ in a categorical board feature`,
          });
        }
      }
    }

    if (p.type === "oddOneOut") {
      // Group coherence: the NON-answer options must form a coherent "group"
      // that the answer breaks — at least one dimension on which every
      // non-answer shares a value AND the answer differs.
      if (p.options.every(isCell)) {
        const answer = p.options[p.answerIndex];
        const others = p.options.filter((_, i) => i !== p.answerIndex);
        const dims = ["shape", "count", "rotation", "fill", "size"] as const;
        const hasBreak = others.length > 0 && dims.some((d) => {
          const shared = others.every((o) => o[d] === others[0][d]);
          return shared && answer[d] !== others[0][d];
        });
        if (!hasBreak) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "oddOneOut: the 3+ non-answer compact cells must all share a value on at least one dimension (shape/count/rotation/fill/size) that the answer breaks" });
        }
      }
    }
  });

type RuntimePuzzle = z.infer<typeof RuntimePuzzleSchema>;
export type Puzzle<V extends Visual = Cell> = Omit<RuntimePuzzle, "stem" | "options"> & {
  stem: Panel<V>[];
  options: V[];
};

/** Existing generators stay cell-typed; new scene families opt into the visual-wide schema. */
export const PuzzleSchema = RuntimePuzzleSchema as z.ZodType<Puzzle>;
export const VisualPuzzleSchema = RuntimePuzzleSchema as z.ZodType<Puzzle<Visual>>;

/**
 * Answer-free puzzle contract served before a quiz is submitted.
 *
 * Keep this as an explicit schema rather than relying on TypeScript's `Omit`:
 * types disappear at runtime, while this schema also strips unknown private
 * fields if an internal puzzle is passed to it.
 */
const RuntimePublicPuzzleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PUZZLE_TYPES),
  instruction: z.string().min(3).max(140),
  difficulty: z.number().int().min(1).max(5),
  layout: z.enum(LAYOUTS),
  familyId: z.string().min(1).optional(),
  band: z.enum(REASONING_BANDS).optional(),
  operatorLegend: OperatorLegendSchema.optional(),
  stem: z.array(PanelSchema),
  options: z.array(VisualSchema).min(MINIMUM_OPTIONS_PER_ITEM).max(MAXIMUM_OPTIONS_PER_ITEM),
});
type RuntimePublicPuzzle = z.infer<typeof RuntimePublicPuzzleSchema>;
export type PublicPuzzle<V extends Visual = Cell> = Omit<RuntimePublicPuzzle, "stem" | "options"> & {
  stem: Panel<V>[];
  options: V[];
};
export const PublicPuzzleSchema = RuntimePublicPuzzleSchema as z.ZodType<PublicPuzzle>;
export const VisualPublicPuzzleSchema = RuntimePublicPuzzleSchema as z.ZodType<PublicPuzzle<Visual>>;

/** Strip the answer key and authoring metadata at the server boundary. */
export function toPublicPuzzle<V extends Visual>(puzzle: Puzzle<V>): PublicPuzzle<V> {
  return VisualPublicPuzzleSchema.parse(puzzle) as PublicPuzzle<V>;
}

/** The two public lengths are 5 and 30; 12 is the retired profile, kept for replay. */
export const PUZZLE_SET_LENGTHS = [5, 12, 30] as const;

const RuntimePuzzleSetSchema = z
  .array(VisualPuzzleSchema)
  .refine((set) => (PUZZLE_SET_LENGTHS as readonly number[]).includes(set.length), {
    message: "a puzzle set must contain 5, 12, or 30 items",
  })
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PuzzleSet<V extends Visual = Cell> = Puzzle<V>[];
export const PuzzleSetSchema = RuntimePuzzleSetSchema as z.ZodType<PuzzleSet>;
export const VisualPuzzleSetSchema = RuntimePuzzleSetSchema as z.ZodType<PuzzleSet<Visual>>;

const RuntimePublicPuzzleSetSchema = z
  .array(VisualPublicPuzzleSchema)
  .refine((set) => (PUZZLE_SET_LENGTHS as readonly number[]).includes(set.length), {
    message: "a public puzzle set must contain 5, 12, or 30 items",
  })
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PublicPuzzleSet<V extends Visual = Cell> = PublicPuzzle<V>[];
export const PublicPuzzleSetSchema = RuntimePublicPuzzleSetSchema as z.ZodType<PublicPuzzleSet>;
export const VisualPublicPuzzleSetSchema = RuntimePublicPuzzleSetSchema as z.ZodType<PublicPuzzleSet<Visual>>;

/** Strip private fields from a complete legacy or current quiz. */
export function toPublicPuzzleSet<V extends Visual>(puzzles: PuzzleSet<V>): PublicPuzzleSet<V> {
  return VisualPublicPuzzleSetSchema.parse(puzzles) as PublicPuzzleSet<V>;
}

/** Type guard: is this panel a blank placeholder? */
export function isBlank(panel: Panel<Visual>): panel is { blank: true } {
  return "blank" in panel;
}

/** Type guards used by both renderer paths and legacy rule code. */
export function isScene(visual: Visual): visual is Scene {
  return "kind" in visual && visual.kind === "scene";
}

export function isCell(visual: Visual): visual is Cell {
  return !isScene(visual);
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
    return isInstantlyDistinct({ ...left, count: 1 }, { ...right, count: 1 });
  }
  if (left.kind === "container" && right.kind === "container") {
    if (left.shape !== right.shape || left.contents.length !== right.contents.length) return true;
    return left.contents.some((token, index) =>
      isInstantlyDistinct({ ...token, count: 1 }, { ...right.contents[index], count: 1 }));
  }
  return true;
}

/**
 * Scene-option legibility mirrors compact-cell legibility: board position,
 * containment, edge topology, shape, fill, count, or a clearly separated size
 * must differ. Medium-vs-large alone is intentionally not enough.
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

export function visualElementSignature(visual: Visual): string {
  return isScene(visual) ? `scene:${sceneSignature(visual)}` : `cell:${JSON.stringify(visual)}`;
}

/**
 * Fisher-Yates shuffle of a puzzle's options, remapping `answerIndex` so the same
 * cell stays correct. Returns a new puzzle (does not mutate the input). Used to
 * remove the generating model's answer-position bias before the test is served.
 */
export function shuffleOptions<V extends Visual>(puzzle: Puzzle<V>): Puzzle<V> {
  const order = puzzle.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const options = order.map((i) => puzzle.options[i]);
  const answerIndex = order.indexOf(puzzle.answerIndex);
  return { ...puzzle, options, answerIndex };
}
