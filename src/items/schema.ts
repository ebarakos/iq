import { z } from "zod";
import { FILLS, isInstantlyDistinct, ORIENTABLE_SHAPES, ROTATIONS, SHAPES, SIZES } from "./domains";
import { RuleSchema } from "./rules";

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

export const PUZZLE_TYPES = ["matrix", "sequence", "analogy", "oddOneOut"] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

/** How the stem panels are arranged on screen. */
export const LAYOUTS = ["grid3x3", "row", "analogy"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const PuzzleSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(PUZZLE_TYPES),
    /** Short, neutral instruction (kept minimal — the task should be visual). */
    instruction: z.string().min(3).max(140),
    /** 1 (easiest) … 5 (hardest). */
    difficulty: z.number().int().min(1).max(5),
    layout: z.enum(LAYOUTS),
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

/** A full test is exactly 5 puzzles for the MVP, each with a distinct id. */
export const PuzzleSetSchema = z
  .array(PuzzleSchema)
  .length(5)
  .refine((set) => new Set(set.map((p) => p.id)).size === set.length, {
    message: "puzzle ids must be unique across the set",
  });
export type PuzzleSet = z.infer<typeof PuzzleSetSchema>;

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
