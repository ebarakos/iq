import { z } from "zod";
import {
  FILLS,
  isInstantlyDistinct,
  isSceneTokenInstantlyDistinct,
  ORIENTABLE_SHAPES,
  ROTATIONS,
  SCENE_ORIENTABLE_SHAPES,
  SCENE_SHAPES,
  SHAPES,
  SIZES,
} from "./domains";
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

export { SHAPES, SCENE_SHAPES, FILLS, SIZES, ROTATIONS, visualSignature } from "./domains";
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

/**
 * The one board shape wider than three columns the schema allows: a machine
 * table's four- or five-gate query strip.
 *
 * A four-step machine has to show four gate glyphs side by side, and the
 * ordinary 2–3 by 2–3 board has nowhere to put the fourth. The strip is a
 * single row of glyphs, drawn full width across the machine row. It is
 * restricted on purpose: it may only appear in a `machineTable`'s gate column,
 * and never as an answer option, so widening the board here cannot widen the
 * puzzle vocabulary anywhere else. See `docs/plans/escalate-the-quiz.md`,
 * Phase 3.
 *
 * The five-column form arrived with `composed-transform-d6` on 2026-08-26
 * (`docs/plans/raise-the-ceiling-v12.md`): a five-gate program needs a fifth
 * glyph in the same single row. Nothing else about the strip changed, and an
 * ordinary board is still 2–3 by 2–3.
 */
export const GATE_STRIP_ROWS = 1;
export const GATE_STRIP_COLUMNS = 4;
export const MAXIMUM_GATE_STRIP_COLUMNS = 5;

/** Is this a legal gate-strip width — the four-gate strip or the five-gate one? */
function isGateStripShape(rows: number, columns: number): boolean {
  return rows === GATE_STRIP_ROWS &&
    columns >= GATE_STRIP_COLUMNS && columns <= MAXIMUM_GATE_STRIP_COLUMNS;
}

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
  rows: z.number().int().min(GATE_STRIP_ROWS).max(3),
  columns: z.number().int().min(2).max(MAXIMUM_GATE_STRIP_COLUMNS),
  objects: z.array(ScenePlacementSchema).max(9).default([]),
  tiles: z.array(ConnectionTileSchema).max(9).default([]),
  guides: z.array(SceneGuideSchema).max(2).optional(),
}).strict().superRefine((scene, ctx) => {
  // An ordinary board is 2–3 by 2–3. The single exception is the machine gate
  // strip: one row of four or five glyphs. The puzzle-level check below then
  // confines that shape to a machine table's gate column, so no other layout
  // and no answer option can ever be more than three columns wide.
  const ordinaryBoard = scene.rows >= 2 && scene.rows <= 3 && scene.columns >= 2 && scene.columns <= 3;
  const gateStrip = isGateStripShape(scene.rows, scene.columns);
  if (!ordinaryBoard && !gateStrip) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a board is 2–3 by 2–3, or the ${GATE_STRIP_ROWS}x${GATE_STRIP_COLUMNS} or ` +
        `${GATE_STRIP_ROWS}x${MAXIMUM_GATE_STRIP_COLUMNS} machine gate strip, ` +
        `but this one is ${scene.rows}x${scene.columns}`,
    });
  }

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
export const LAYOUTS = ["grid3x3", "row", "analogy", "operatorTable", "machineTable", "combineTable", "conceptGroups", "singleScene"] as const;
export type Layout = (typeof LAYOUTS)[number];
/**
 * Legal stem lengths for a `machineTable`: one triple per worked (input, gate,
 * output) row, plus the query triple whose output is the blank. Two through
 * five worked rows.
 */
export const MACHINE_TABLE_PANEL_COUNTS: readonly number[] = [9, 12, 15, 18];

/**
 * Legal stem lengths for a `combineTable`: one quad per worked
 * (left, gate, right, output) row, plus the query quad whose output is the
 * blank. Two or three worked rows, so 12 or 16 panels.
 *
 * A machine table's gate transforms ONE board, so its row is a triple. This
 * layout exists for a gate that COMBINES TWO, which a triple cannot show — the
 * gate glyph sits between the two operands instead of before a single one. The
 * three-gate ceiling of 2026-08-27 caps it at three worked rows.
 */
export const COMBINE_TABLE_PANEL_COUNTS: readonly number[] = [12, 16];

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

const RuntimePuzzleSchema = z
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
    /** Visible ordering for nominal shape arithmetic; never contains answer data. */
    operatorLegend: OperatorLegendSchema.optional(),
    /**
     * The question, as a list of panels.
     *  - matrix:    9 panels (grid3x3) with exactly one { blank: true }
     *  - sequence:  4–8 panels (row) with exactly one trailing { blank: true }
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
      // 9 / 12 / 15 / 18 panels: two, three, four, or five worked (input, gate,
      // output) rows plus the query row. The 15-panel form arrived with the
      // four-step composed-transform bucket (escalate-the-quiz, Phase 3); the
      // 18-panel form with the five-step `composed-transform-d6` bucket
      // (raise-the-ceiling-v12, 2026-08-26). The shorter forms are unchanged.
      const machine = p.layout === "machineTable" &&
        MACHINE_TABLE_PANEL_COUNTS.includes(p.stem.length) && blanks === 1 &&
        isBlank(p.stem[p.stem.length - 1]);
      // Added 2026-08-27 for gates that combine two boards — see
      // COMBINE_TABLE_PANEL_COUNTS.
      const combine = p.layout === "combineTable" &&
        COMBINE_TABLE_PANEL_COUNTS.includes(p.stem.length) && blanks === 1 &&
        isBlank(p.stem[p.stem.length - 1]);
      if (!grid && !board && !machine && !combine) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "matrix must be a 3x3 grid, one incomplete scene, a two- to five-row machine table, or a two- to three-row combine table" });
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
    } else if (p.type === "oddOneOut") {
      // Classic outliers use options only. Scene concept induction reuses the
      // same choose-one answer shape with three positive and three negative examples.
      // The demonstrated shape (2026-08-24) shows three example boards that all
      // satisfy the shared rule, so the rule is worked evidence, not a guess.
      const classic = p.layout === "row" && p.stem.length === 0;
      const demonstrated = p.layout === "row" && p.stem.length === 3 && blanks === 0 &&
        p.stem.every((panel) => !isBlank(panel) && isScene(panel));
      const concept = p.layout === "conceptGroups" && p.stem.length === 6 && blanks === 0 &&
        p.stem.every((panel) => !isBlank(panel) && isScene(panel));
      const repair = p.layout === "singleScene" && p.stem.length === 1 && blanks === 0 &&
        !isBlank(p.stem[0]) && isScene(p.stem[0]);
      if (!classic && !demonstrated && !concept && !repair) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "oddOneOut must be an empty row, three demonstrated example boards, six conceptGroups examples, or one singleScene repair prompt" });
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
      // The wide board exists to hold four or five gate glyphs in one row. A
      // machine table's panels run (input, gate, output), so the gate column is
      // every index whose remainder is 1; anywhere else a four- or five-wide
      // board would be a playing surface, which this project does not have.
      const gateColumn = p.layout === "machineTable" ? index % 3 === 1
        : p.layout === "combineTable" ? index % 4 === 1
          : false;
      if (isGateStrip(panel) && !gateColumn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stem", index],
          message: `a ${GATE_STRIP_ROWS}-row board of ${GATE_STRIP_COLUMNS} or more columns is only allowed as a machine table's gate strip`,
        });
      }
    }
    // Every gate a table shows must take part in the answer (owner's rule,
    // 2026-09-29). A worked row demonstrating a gate the query never runs shows
    // a transformation for nothing, and a query gate no worked row demonstrates
    // cannot be read. So the glyphs in the worked rows' gate column and the
    // glyphs in the query's gate panel must be the same set.
    const tableRowLength = p.layout === "machineTable" ? 3 : p.layout === "combineTable" ? 4 : 0;
    if (tableRowLength > 0 && p.stem.length > tableRowLength && p.stem.length % tableRowLength === 0) {
      const glyphs = (panel: Panel<Visual>) => new Map(!isBlank(panel) && isScene(panel)
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
    for (const [index, option] of p.options.entries()) {
      if (isGateStrip(option)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options", index],
          message: `an answer option may not be ${GATE_STRIP_COLUMNS} or more columns wide`,
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
 *
 * Since 2026-09-28 it also leaves out `familyId`, `band` and `difficulty`.
 * Each is a hint about the question before it is answered — which mechanism,
 * how hard — and the page needs them only on the review screen, which reads
 * them from the submit response instead.
 */
const RuntimePublicPuzzleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PUZZLE_TYPES),
  instruction: z.string().min(3).max(140),
  layout: z.enum(LAYOUTS),
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
function canonicalSceneOrder<V extends Visual>(visual: V): V {
  if (!isScene(visual)) return visual;
  const byPosition = <T extends { row: number; column: number }>(left: T, right: T) =>
    left.row - right.row || left.column - right.column;
  return {
    ...visual,
    objects: [...visual.objects].sort(byPosition),
    tiles: [...visual.tiles].sort(byPosition),
  };
}

/** Strip the answer key and authoring metadata at the server boundary. */
export function toPublicPuzzle<V extends Visual>(puzzle: Puzzle<V>): PublicPuzzle<V> {
  const parsed = VisualPublicPuzzleSchema.parse(puzzle) as PublicPuzzle<V>;
  return { ...parsed, options: parsed.options.map(canonicalSceneOrder) };
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
  return VisualPublicPuzzleSetSchema.parse(puzzles.map(toPublicPuzzle)) as PublicPuzzleSet<V>;
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

/** Is this the wide one-row board a four-gate machine strip is drawn on? */
export function isGateStrip(visual: Visual): boolean {
  return isScene(visual) && isGateStripShape(visual.rows, visual.columns);
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
