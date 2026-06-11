/**
 * Shared visual-dimension domains and render-identity helpers.
 *
 * These live apart from schema.ts so the rule DSL (rules.ts) can use them at
 * module-init time while schema.ts imports RuleSchema — keeping the import
 * graph acyclic (schema → rules → domains). schema.ts re-exports everything
 * here, so external callers keep importing from "./schema".
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
/**
 * Quarter turns only. Finer angles (the old 45° steps) produced near-identical
 * renders on symmetric shapes (a star rotated 45° is an 18° visual wobble) —
 * an eyesight test, not an IQ test. Legibility doctrine: every difference a
 * puzzle trades on must be readable instantly, at a glance.
 */
export const ROTATIONS = [0, 90, 180, 270] as const;

/**
 * Shapes whose orientation reads instantly. Only the triangle points somewhere:
 * up/right/down/left are four unmistakable glyphs. Every other shape is too
 * symmetric — quarter turns on squares/diamonds/circles render identically, and
 * on stars/hexagons they render as tiny wobbles. Rotation is therefore
 * triangle-only, enforced at the schema level (non-triangles must use 0).
 */
export const ORIENTABLE_SHAPES = ["triangle"] as const;

export type Shape = (typeof SHAPES)[number];
export type Fill = (typeof FILLS)[number];
export type Size = (typeof SIZES)[number];

/** Structural cell shape — equivalent to schema.ts's `Cell` (its z.infer). */
export interface CellSpec {
  shape: Shape;
  count: number;
  rotation: number;
  fill: Fill;
  size: Size;
}

/**
 * Rotational symmetry of each shape, in degrees. Rotating a shape by a multiple
 * of its period produces a visually identical figure (a circle looks the same at
 * any angle; a square at 0° and 90° are indistinguishable). Used to detect
 * options that would render identically — e.g. a "rotation" rule applied to a
 * circle, which is unsolvable by sight.
 */
export const ROTATION_PERIOD: Record<Shape, number> = {
  circle: 1, // any rotation looks identical
  square: 90,
  diamond: 90,
  triangle: 120,
  star: 72,
  hexagon: 60,
};

/** A signature that is equal for two cells iff they render identically. */
export function visualSignature(cell: CellSpec): string {
  const period = ROTATION_PERIOD[cell.shape];
  const rot = ((cell.rotation % period) + period) % period;
  return `${cell.shape}|${cell.count}|${cell.fill}|${cell.size}|${rot}`;
}

/**
 * Legibility doctrine: are two cells distinguishable INSTANTLY, at a glance?
 *
 * True iff the pair differs categorically on at least one dimension:
 *  - different shape, count, or fill (always categorical);
 *  - size, only as small-vs-large ("m" against either neighbour is a squint
 *    test — kept in the schema for legacy data, never relied on for identity);
 *  - rotation, only when both cells are orientable (triangles pointing in
 *    different quarter-turn directions). Rotation differences on symmetric
 *    shapes render as wobbles or nothing and never count.
 *
 * This is deliberately stronger than `visualSignature` inequality: the test
 * measures reasoning, so "different but you must look carefully" is as
 * ill-posed as "renders identically". Used pairwise across a puzzle's options
 * and along a rule's governed runs.
 */
export function isInstantlyDistinct(a: CellSpec, b: CellSpec): boolean {
  if (a.shape !== b.shape) return true;
  if (a.count !== b.count) return true;
  if (a.fill !== b.fill) return true;
  const sizes = [a.size, b.size];
  if (a.size !== b.size && sizes.includes("s") && sizes.includes("l")) return true;
  if (
    a.rotation !== b.rotation &&
    (ORIENTABLE_SHAPES as readonly string[]).includes(a.shape) &&
    (ORIENTABLE_SHAPES as readonly string[]).includes(b.shape) &&
    visualSignature(a) !== visualSignature(b)
  ) {
    return true;
  }
  return false;
}
