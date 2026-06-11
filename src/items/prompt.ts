/**
 * Prompts for generating a 5-item visual IQ test.
 *
 * The model emits a JSON array describing each puzzle in the schema from
 * `schema.ts`. It never draws — the app renders SVG from the description. We use
 * "manual" JSON mode (instructions in the prompt + our own extraction/validation)
 * because it is the most provider-portable approach through the relay.
 */

export const SYSTEM_PROMPT = `You are an item writer for a visual, language-independent IQ test (Raven's-matrix style).
You design puzzles as STRUCTURED DATA only — you never draw images. A separate renderer turns your
data into shapes, so every puzzle must be solvable purely from the abstract pattern you encode.

A "cell" is an object: { "shape", "count", "rotation", "fill", "size" }.
  - shape:    one of "circle" | "square" | "triangle" | "diamond" | "star" | "hexagon"
  - count:    integer 1..4  (how many copies of the shape are drawn)
  - rotation: one of 0, 90, 180, 270 (quarter turns) — allowed ONLY on triangles; every other
    shape MUST use rotation 0 (they are too symmetric for their orientation to be readable)
  - fill:     "solid" | "outline" | "half"
  - size:     use ONLY "s" or "l" (small or large) — never "m"; small-vs-large must be unmistakable

Design a clean rule per puzzle using ONE or TWO of these dimensions (shape, count, rotation, fill, size).
Make exactly one option correct; the other options must be plausible but wrong (vary a single dimension).
Increasing difficulty 1..5: difficulty 1 = a single obvious rule; difficulty 5 = two interacting rules.
Difficulty comes ONLY from the rule's complexity — NEVER from how hard the options are to tell apart.

LEGIBILITY RULES (this is an IQ test, not an eyesight test — every difference must be instant):
  - Every pair of options must be tellable apart AT A GLANCE: a different shape, a different
    count, a different fill, size "s" vs "l", or a triangle pointing a different direction.
  - NEVER trade on subtle differences. Forbidden: rotations on circles/squares/diamonds/stars/
    hexagons (invisible or near-invisible), size differences other than s-vs-l, any pair of
    options a viewer must inspect carefully to distinguish.
  - Rotation rules: triangles ONLY, quarter turns only (the triangle visibly points
    up / right / down / left).

RULE GRAMMAR — you MUST include a "rule" field in every puzzle JSON object.

Three transform ops (per dimension):
  { "op": "constant" }                           — dimension holds the same value everywhere
  { "op": "step", "delta": N, "wrap": bool }     — advance N steps in the ordered domain each move
  { "op": "cycle", "values": ["a","b","c"] }     — cycle through explicit values (only op for shape)

Ordered domains (transforms step through these in order):
  count:    1 → 2 → 3 → 4              (no implicit wrap — use wrap:true to go 4→1)
  rotation: 0 → 90 → 180 → 270         (always wraps; step delta 1 = a quarter turn; TRIANGLES ONLY)
  fill:     "outline" → "half" → "solid"
  size:     "s" → "l"                  (two values; a step flips small ↔ large, wrap for sequences)
  shape:    nominal — only "constant" or "cycle" allowed (no step)

Four rule kinds (kind MUST match the puzzle type):

  sequence — 1-D; each consecutive stem cell advances by the transform:
    { "kind": "sequence", "transforms": { "count": { "op": "step", "delta": 1, "wrap": false } } }

  matrix — 2-D; row transforms apply left→right in EVERY row; col transforms apply top→bottom:
    { "kind": "matrix", "row": { "count": { "op": "step", "delta": 1, "wrap": false } },
                        "col": { "fill":  { "op": "step", "delta": 1, "wrap": false } } }

  analogy — A→B single-step re-applied to C; shape must stay constant:
    { "kind": "analogy", "transforms": { "fill": { "op": "step", "delta": 2, "wrap": false } } }

  oddOneOut — all non-answer options share one value on one dimension; the answer breaks it:
    { "kind": "oddOneOut", "dimension": "shape", "value": "square" }

Rule constraints:
  - Unlisted dimensions are implicitly constant; they MUST stay constant across the entire stem.
  - matrix: a dimension may vary along AT MOST ONE axis (row or col, not both).
    Dimensions on neither axis must be constant across all 9 cells.
  - analogy: shape must be constant; A and B must differ ONLY by the declared transforms.
  - oddOneOut: EXACTLY ONE option must break the shared dimension value (that is answerIndex).
  - At least one dimension must be non-constant (a rule cannot be all-constant).
  - Rotation rules: every cell the rule governs must be a TRIANGLE (the only shape whose
    orientation reads instantly). A rotation rule on any other shape is rejected.`;

import type { DifficultyLevel } from "./bank";

/** The 5 dimensions a puzzle rule can vary — used to pick a fresh emphasis each test. */
const DIMENSIONS = ["shape", "count", "rotation", "fill", "size"] as const;

/** Per-level difficulty lineup: the two equal-difficulty pairs and the final matrix. */
const LINEUPS: Record<DifficultyLevel, { pair1: number; pair2: number; final: number }> = {
  easy: { pair1: 1, pair2: 2, final: 3 },
  standard: { pair1: 2, pair2: 3, final: 5 },
  hard: { pair1: 3, pair2: 4, final: 5 },
};

/** Pick `n` distinct items from `arr` at random (Fisher-Yates partial shuffle). */
function pickSome<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Build the user prompt for one test. A fully static prompt at temperature 0.3
 * makes consecutive tests near-identical, so we randomize three things while
 * keeping the requested difficulty lineup fixed:
 *   - the order within equal-difficulty pairs (matrix/sequence, analogy/
 *     oddOneOut) — the final hardest matrix always stays last;
 *   - which 2–3 dimensions to emphasize this time;
 *   - a short random variation seed line to decorrelate outputs.
 * Call this ONCE per test and reuse the same string across retries so the Zod
 * feedback stays coherent with the spec the model was given.
 */
export function buildUserPrompt(difficulty: DifficultyLevel = "standard"): string {
  const lineup = LINEUPS[difficulty];
  // (a) Randomize order within each equal-difficulty pair; keep the final matrix last.
  const pairA = Math.random() < 0.5 ? ["matrix", "sequence"] : ["sequence", "matrix"];
  const pairB = Math.random() < 0.5 ? ["analogy", "oddOneOut"] : ["oddOneOut", "analogy"];
  const order: { type: string; difficulty: number }[] = [
    { type: pairA[0], difficulty: lineup.pair1 },
    { type: pairA[1], difficulty: lineup.pair1 },
    { type: pairB[0], difficulty: lineup.pair2 },
    { type: pairB[1], difficulty: lineup.pair2 },
    { type: "matrix", difficulty: lineup.final },
  ];
  const orderLines = order
    .map((o, i) => `  ${i + 1}. "${o.type}"${" ".repeat(Math.max(1, 10 - o.type.length))}— difficulty ${o.difficulty}${o.difficulty >= 5 ? " (two interacting rules)" : ""}`)
    .join("\n");

  // (b) Emphasize 2–3 freshly-chosen dimensions so rules don't repeat every test.
  const emphasis = pickSome(DIMENSIONS, 2 + Math.floor(Math.random() * 2));

  // (c) A short random seed line to decorrelate outputs at low temperature.
  const seed = Math.random().toString(36).slice(2, 8);

  return `Generate a test of exactly 5 puzzles as a JSON array (no prose, no markdown fences).

Use these 5 types, in this order:
${orderLines}

This test should EMPHASIZE these dimensions where natural: ${emphasis.join(", ")}.
Vary the rules so they differ from a typical test — do not default to count-only patterns.
Variation seed: ${seed} (use it only to make distinct choices; never reference it in the output).

Each puzzle object MUST have:
  - "id": short unique string, distinct across the 5 puzzles (e.g. "p1".."p5")
  - "type": one of "matrix" | "sequence" | "analogy" | "oddOneOut"
  - "instruction": a SHORT neutral instruction (e.g. "Which option completes the grid?")
  - "difficulty": integer 1..5
  - "layout": "grid3x3" for matrix, "row" for sequence, "analogy" for analogy, "row" for oddOneOut
  - "stem": array of panels (each panel is a cell object, OR exactly the object {"blank": true})
  - "options": array of 4–6 cell objects (4 is standard; use 5 or 6 only for harder items)
  - "answerIndex": integer index into options of the correct answer
  - "explanation": one short sentence stating the rule
  - "rule": the machine-readable rule you followed (see RULE GRAMMAR above); kind must match type

Per-type stem rules (follow EXACTLY):
  - matrix:    layout "grid3x3", stem = 9 panels in reading order, with EXACTLY ONE {"blank": true}
               (put the blank last). The correct option is what belongs in the blank.
  - sequence:  layout "row", stem = 3 to 5 cells followed by EXACTLY ONE {"blank": true}
               (4–6 panels total); use more cells for harder items. The correct option
               continues the sequence.
  - analogy:   layout "analogy", stem = EXACTLY 3 cells [A, B, C] and NO blank.
               The rule mapping A->B applied to C gives the correct option (C is to ? as A is to B).
  - oddOneOut: stem = [] (empty). Provide 4+ options where ALL but one share a value on some
               dimension and the odd one breaks it. answerIndex points to the odd one.

MECHANICAL CONTRACT: We re-derive the correct answer from your "rule" field and reject the item
if options[answerIndex] does not match the derived cell — the derivation diff is sent back to you.
Declare the rule you actually used; do not write a rule after the fact.

Return ONLY the JSON array of 5 objects.`;
}
