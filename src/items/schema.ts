import { z } from "zod";
import { FILLS, isInstantlyDistinct, ORIENTABLE_SHAPES, ROTATIONS, SHAPES, SIZES } from "./domains";
import { DIMENSIONS, RuleSchema } from "./rules";

/**
 * Visual puzzle schema — the contract between the generator (llm-relay model)
 * and the deterministic SVG renderer.
 *
 * The model never draws anything. It emits a compact, constrained description of
 * each cell (shape, count, rotation, fill, size). The app renders identical SVG
 * from that description, so the displayed puzzle and the marked answer are always
 * internally consistent — even with a weak model. This keeps items "visual-only"
 * (language-independent) while making generation feasible for a text model.
 *
 * Dimension domains and render-identity helpers live in domains.ts (re-exported
 * here); the machine-readable rule DSL + semantic validator live in rules.ts.
 */

export { SHAPES, FILLS, SIZES, ROTATIONS, visualSignature } from "./domains";

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

/** A stem panel is either a drawn cell or an explicit blank (the "?" to solve). */
export const PanelSchema = z.union([
  CellSchema,
  z.object({ blank: z.literal(true) }),
]);
export type Panel = z.infer<typeof PanelSchema>;

export const PUZZLE_TYPES = ["matrix", "sequence", "analogy", "oddOneOut", "operatorInduction"] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

/** How the stem panels are arranged on screen. */
export const LAYOUTS = ["grid3x3", "row", "analogy", "operatorTable"] as const;
export type Layout = (typeof LAYOUTS)[number];

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

export const PuzzleSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(PUZZLE_TYPES),
    /** Short, neutral instruction (kept minimal — the task should be visual). */
    instruction: z.string().min(3).max(140),
    /** 1 (easiest) … 5 (hardest). */
    difficulty: z.number().int().min(1).max(5),
    layout: z.enum(LAYOUTS),
    /** Visible ordering for nominal shape arithmetic; never contains answer data. */
    operatorLegend: OperatorLegendSchema.optional(),
    /**
     * The question, as a list of panels.
     *  - matrix:    9 panels (grid3x3) with exactly one { blank: true }
     *  - sequence:  4–6 panels (row) with exactly one trailing { blank: true }
     *  - analogy:   exactly [A, B, C] cells (layout "analogy"); renderer adds ":" "::" "?"
     *  - oddOneOut: empty [] — the options ARE the items; pick the one that doesn't belong
     */
    stem: z.array(PanelSchema),
    /** Multiple-choice options (drawn cells). */
    options: z.array(CellSchema).min(4).max(6),
    /** 0-based index into `options` of the single correct answer. */
    answerIndex: z.number().int().min(0),
    /** One-line reason the answer is correct (shown in review, not during solving). */
    explanation: z.string().min(3).max(240),
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
      if (p.layout !== "grid3x3" || p.stem.length !== 9 || blanks !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "matrix must be grid3x3 with 9 panels and exactly 1 blank" });
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
      // Option count is already constrained to >=4 by the array schema.
      if (p.layout !== "row" || p.stem.length !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "oddOneOut must have layout 'row' and an empty stem" });
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
        const cells = [
          ...p.stem.filter((panel): panel is Cell => !isBlank(panel)),
          ...p.options,
        ];
        if (cells.some((cell) => !allowed.has(cell.shape))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["operatorLegend", "shapeCycle"],
            message: "every operatorInduction cell shape must appear in its visible shapeCycle",
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

    // Legibility doctrine: every pair of options must be INSTANTLY tellable
    // apart (different shape, count, or fill; small-vs-large; or triangles
    // pointing different ways). Subtle pairs make the item a visual-acuity
    // test instead of a reasoning test, so they are as ill-posed as identical
    // renders — both are rejected here.
    for (let i = 0; i < p.options.length; i++) {
      for (let j = i + 1; j < p.options.length; j++) {
        if (!isInstantlyDistinct(p.options[i], p.options[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: `options ${i} and ${j} are not instantly distinguishable — every pair must differ obviously: different shape, count, or fill; size "s" vs "l"; or triangles pointing different directions`,
          });
        }
      }
    }

    if (p.type === "oddOneOut") {
      // Group coherence: the NON-answer options must form a coherent "group"
      // that the answer breaks — at least one dimension on which every
      // non-answer shares a value AND the answer differs.
      const answer = p.options[p.answerIndex];
      const others = p.options.filter((_, i) => i !== p.answerIndex);
      const dims = ["shape", "count", "rotation", "fill", "size"] as const;
      const hasBreak = others.length > 0 && dims.some((d) => {
        const shared = others.every((o) => o[d] === others[0][d]);
        return shared && answer[d] !== others[0][d];
      });
      if (!hasBreak) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "oddOneOut: the 3+ non-answer options must all share a value on at least one dimension (shape/count/rotation/fill/size) that the answer breaks" });
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
 */
export const PublicPuzzleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(PUZZLE_TYPES),
  instruction: z.string().min(3).max(140),
  difficulty: z.number().int().min(1).max(5),
  layout: z.enum(LAYOUTS),
  operatorLegend: OperatorLegendSchema.optional(),
  stem: z.array(PanelSchema),
  options: z.array(CellSchema).min(4).max(6),
});
export type PublicPuzzle = z.infer<typeof PublicPuzzleSchema>;

/** Strip the answer key and authoring metadata at the server boundary. */
export function toPublicPuzzle(puzzle: Puzzle): PublicPuzzle {
  return PublicPuzzleSchema.parse(puzzle);
}

/** A full test is exactly 5 puzzles for the MVP, each with a distinct id. */
export const PuzzleSetSchema = z
  .array(PuzzleSchema)
  .length(5)
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PuzzleSet = z.infer<typeof PuzzleSetSchema>;

export const PublicPuzzleSetSchema = z
  .array(PublicPuzzleSchema)
  .length(5)
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PublicPuzzleSet = z.infer<typeof PublicPuzzleSetSchema>;

/** Strip private fields from a complete five-question quiz. */
export function toPublicPuzzleSet(puzzles: PuzzleSet): PublicPuzzleSet {
  return PublicPuzzleSetSchema.parse(puzzles);
}

/** Type guard: is this panel a blank placeholder? */
export function isBlank(panel: Panel): panel is { blank: true } {
  return "blank" in panel;
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
