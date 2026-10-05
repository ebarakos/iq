/**
 * Shared visual-dimension domains and render-identity helpers. schema.ts
 * re-exports most of them, so callers usually import from "./schema".
 */

/** The ways two drawings can differ, as named in an item's generation features. */
export const DIMENSIONS = ["shape", "count", "rotation", "fill", "size"] as const;

export const SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
  "hexagon",
] as const;

export const FILLS = ["solid", "outline", "half"] as const;
/**
 * The order every fill step follows, and wraps around: outline (white), half
 * (gray), solid (black), then outline again. Nothing on screen explains it; a
 * puzzle that steps fills shows every change its answer needs, the wrap
 * included, in its worked evidence instead (scene-families.ts,
 * `RELATIONAL_SEQUENCE_SHOWN_PICTURES` and `sharedAnalogyFills`).
 */
export const FILL_LOOP = ["outline", "half", "solid"] as const;
export const SIZES = ["s", "m", "l"] as const;
/**
 * Quarter turns only. Finer angles (the old 45° steps) produced near-identical
 * renders on symmetric shapes (a star rotated 45° is an 18° visual wobble) —
 * an eyesight test, not an IQ test. Legibility doctrine: every difference a
 * puzzle trades on must be readable instantly, at a glance.
 */
export const ROTATIONS = [0, 90, 180, 270] as const;

/**
 * Every shape a scene token can take: the original six plus the `arrow`, the
 * one shape whose four quarter turns are all unmistakable, which is what makes
 * a visible token turn readable as a puzzle step.
 */
export const SCENE_SHAPES = [...SHAPES, "arrow"] as const;

/**
 * Shapes whose orientation reads instantly: the triangle and the arrow point
 * somewhere. Every other shape is too symmetric — quarter turns on squares,
 * diamonds and circles render identically, and on stars and hexagons they
 * render as tiny wobbles — so the schema refuses to rotate them.
 */
export const SCENE_ORIENTABLE_SHAPES = ["triangle", "arrow"] as const;

export type Shape = (typeof SHAPES)[number];
export type SceneShape = (typeof SCENE_SHAPES)[number];
export type Fill = (typeof FILLS)[number];
export type Size = (typeof SIZES)[number];

/**
 * Rotational symmetry of each scene shape, in degrees. Rotating a shape by a
 * multiple of its period produces a visually identical figure (a circle looks
 * the same at any angle; a square at 0° and 90° are indistinguishable). An
 * arrow has no rotational symmetry at all (period 360), so all four quarter
 * turns — up, right, down, left — are four different pictures. That is exactly
 * why the `turn` operation needs it.
 */
export const SCENE_ROTATION_PERIOD: Record<SceneShape, number> = {
  circle: 1, // any rotation looks identical
  square: 90,
  diamond: 90,
  triangle: 120,
  star: 72,
  hexagon: 60,
  arrow: 360, // no symmetry: 0/90/180/270 are four distinct glyphs
};

/** One scene token's visible attributes. Scenes place one token per slot, so there is no count. */
export interface SceneTokenSpec {
  shape: SceneShape;
  rotation: number;
  fill: Fill;
  size: Size;
}

/** Does this scene shape point somewhere, so that its rotation is readable? */
export function isSceneShapeOrientable(shape: string): boolean {
  return (SCENE_ORIENTABLE_SHAPES as readonly string[]).includes(shape);
}

/** A signature that is equal for two scene tokens iff they render identically. */
export function sceneTokenSignature(token: SceneTokenSpec): string {
  const period = SCENE_ROTATION_PERIOD[token.shape];
  const rot = ((token.rotation % period) + period) % period;
  return `${token.shape}|${token.fill}|${token.size}|${rot}`;
}

/**
 * Legibility doctrine: are two scene tokens distinguishable INSTANTLY, at a
 * glance?
 *
 * True iff the pair differs categorically: a different shape or fill; size
 * only as small-vs-large ("m" against either neighbour is a squint test); and
 * rotation only between two orientable shapes pointing different ways.
 * Rotation differences on symmetric shapes render as wobbles or nothing and
 * never count. This is deliberately stronger than signature inequality: the
 * test measures reasoning, so "different but you must look carefully" is as
 * ill-posed as "renders identically".
 */
export function isSceneTokenInstantlyDistinct(a: SceneTokenSpec, b: SceneTokenSpec): boolean {
  if (a.shape !== b.shape) return true;
  if (a.fill !== b.fill) return true;
  const sizes = [a.size, b.size];
  if (a.size !== b.size && sizes.includes("s") && sizes.includes("l")) return true;
  if (
    a.rotation !== b.rotation &&
    isSceneShapeOrientable(a.shape) &&
    isSceneShapeOrientable(b.shape) &&
    sceneTokenSignature(a) !== sceneTokenSignature(b)
  ) {
    return true;
  }
  return false;
}
