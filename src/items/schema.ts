import { z } from "zod";

/**
 * Visual puzzle schema — the contract between the generator (llm-relay model)
 * and the deterministic SVG renderer.
 *
 * The model never draws anything. It emits a compact, constrained description of
 * each cell (shape, count, rotation, fill, size). The app renders identical SVG
 * from that description, so the displayed puzzle and the marked answer are always
 * internally consistent — even with a weak model. This keeps items "visual-only"
 * (language-independent) while making generation feasible for a text model.
 */

export const SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
  "hexagon",
] as const;

export const FILLS = ["solid", "outline", "half"] as const;
export const SIZES = ["s", "m", "l"] as const;
export const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/** A single drawable cell: `count` copies of `shape`, arranged in a mini-grid. */
export const CellSchema = z.object({
  shape: z.enum(SHAPES),
  /** 1–4 copies of the shape, laid out automatically by the renderer. */
  count: z.number().int().min(1).max(4),
  /** Rotation in degrees; constrained to 45° steps. */
  rotation: z.number().int().refine((r) => (ROTATIONS as readonly number[]).includes(r), {
    message: "rotation must be one of 0,45,90,135,180,225,270,315",
  }),
  fill: z.enum(FILLS),
  size: z.enum(SIZES),
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

/**
 * Rotational symmetry of each shape, in degrees. Rotating a shape by a multiple
 * of its period produces a visually identical figure (a circle looks the same at
 * any angle; a square at 0° and 90° are indistinguishable). Used to detect
 * options that would render identically — e.g. a "rotation" rule applied to a
 * circle, which is unsolvable by sight.
 */
const ROTATION_PERIOD: Record<Cell["shape"], number> = {
  circle: 1, // any rotation looks identical
  square: 90,
  diamond: 90,
  triangle: 120,
  star: 72,
  hexagon: 60,
};

/** A signature that is equal for two cells iff they render identically. */
export function visualSignature(cell: Cell): string {
  const period = ROTATION_PERIOD[cell.shape];
  const rot = ((cell.rotation % period) + period) % period;
  return `${cell.shape}|${cell.count}|${cell.fill}|${cell.size}|${rot}`;
}

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
     *  - sequence:  3–6 panels (row) with exactly one trailing { blank: true }
     *  - analogy:   exactly [A, B, C] cells (layout "analogy"); renderer adds ":" "::" "?"
     *  - oddOneOut: empty [] — the options ARE the items; pick the one that doesn't belong
     */
    stem: z.array(PanelSchema),
    /** Multiple-choice options (drawn cells). */
    options: z.array(CellSchema).min(3).max(6),
    /** 0-based index into `options` of the single correct answer. */
    answerIndex: z.number().int().min(0),
    /** One-line reason the answer is correct (shown in review, not during solving). */
    explanation: z.string().min(3).max(240),
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex out of range",
    path: ["answerIndex"],
  })
  .superRefine((p, ctx) => {
    const blanks = p.stem.filter(isBlank).length;
    if (p.type === "matrix") {
      if (p.layout !== "grid3x3" || p.stem.length !== 9 || blanks !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "matrix must be grid3x3 with 9 panels and exactly 1 blank" });
      }
    } else if (p.type === "sequence") {
      const lastIsBlank = p.stem.length > 0 && isBlank(p.stem[p.stem.length - 1]);
      if (p.layout !== "row" || p.stem.length < 3 || blanks !== 1 || !lastIsBlank) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sequence must be a row of >=3 panels whose ONLY blank is the trailing one" });
      }
    } else if (p.type === "analogy") {
      if (p.layout !== "analogy" || p.stem.length !== 3 || blanks !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "analogy must be layout 'analogy' with exactly 3 cells and no blank" });
      }
    } else if (p.type === "oddOneOut") {
      if (p.stem.length !== 0 || p.options.length < 4) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "oddOneOut must have empty stem and >=4 options" });
      }
    }

    // Options must be visually distinguishable — otherwise the question is
    // ill-posed (e.g. a "rotation" rule on circles renders every option the same).
    const sigs = p.options.map(visualSignature);
    if (p.type === "oddOneOut") {
      // The odd one must at least be visibly different from the rest.
      const answerSig = sigs[p.answerIndex];
      const clashes = sigs.some((s, i) => i !== p.answerIndex && s === answerSig);
      if (clashes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "the odd-one-out option renders identically to another option" });
      }
    } else if (new Set(sigs).size !== sigs.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "two options render identically (after rotational symmetry) — make every option visually distinct" });
    }
  });

export type Puzzle = z.infer<typeof PuzzleSchema>;

/** A full test is exactly 5 puzzles for the MVP. */
export const PuzzleSetSchema = z.array(PuzzleSchema).length(5);
export type PuzzleSet = z.infer<typeof PuzzleSetSchema>;

/** Type guard: is this panel a blank placeholder? */
export function isBlank(panel: Panel): panel is { blank: true } {
  return "blank" in panel;
}
