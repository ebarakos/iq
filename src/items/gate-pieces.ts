/**
 * Machine gates are drawn as jigsaw pieces (owner's choice, 2026-10-04): one
 * outline for every gate, told apart by its texture alone, so a gate never
 * looks like a shape on a board. Pieces in a question snap tab into notch, and
 * the tabs point the way the board travels through them.
 *
 * The puzzle data is unchanged: a gate panel still carries one glyph token per
 * gate (`gateVisual` in scene-families.ts). This table is the one place that
 * says which texture each glyph is drawn with, and the explanations name a
 * gate by the same word ("the dotted piece"), so the two cannot disagree.
 */
export const GATE_PIECE_TEXTURES = ["dark", "dotted", "striped"] as const;
export type GatePieceTexture = (typeof GATE_PIECE_TEXTURES)[number];

const TEXTURE_BY_GLYPH: Readonly<Record<string, GatePieceTexture>> = {
  "triangle:outline": "dark",
  "square:solid": "dotted",
  "diamond:half": "striped",
};

/** The texture a gate glyph is drawn with, or null when it is not a gate glyph. */
export function gatePieceTexture(shape: string, fill: string): GatePieceTexture | null {
  return TEXTURE_BY_GLYPH[`${shape}:${fill}`] ?? null;
}
