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
  - rotation: one of 0,45,90,135,180,225,270,315  (degrees)
  - fill:     "solid" | "outline" | "half"
  - size:     "s" | "m" | "l"

Design a clean rule per puzzle using ONE or TWO of these dimensions (shape, count, rotation, fill, size).
Make exactly one option correct; the other options must be plausible but wrong (vary a single dimension).
Increasing difficulty 1..5: difficulty 1 = a single obvious rule; difficulty 5 = two interacting rules.

VISIBILITY RULES (the puzzle must be solvable by sight):
  - If your rule varies ROTATION, do NOT use circles — a rotated circle looks identical. Use
    triangle/square/star/hexagon. Also avoid rotations that land on a shape's symmetry (e.g. a
    square at 0 and 90 look the same; a triangle at 0 and 120 look the same).
  - Every option must render DIFFERENTLY from every other option. Two options that look the same
    make the question unanswerable.`;

export const USER_PROMPT = `Generate a test of exactly 5 puzzles as a JSON array (no prose, no markdown fences).

Use these 5 types, in this order:
  1. "matrix"     — difficulty 2
  2. "sequence"   — difficulty 2
  3. "analogy"    — difficulty 3
  4. "oddOneOut"  — difficulty 3
  5. "matrix"     — difficulty 5 (two interacting rules)

Each puzzle object MUST have:
  - "id": short unique string (e.g. "p1")
  - "type": one of "matrix" | "sequence" | "analogy" | "oddOneOut"
  - "instruction": a SHORT neutral instruction (e.g. "Which option completes the grid?")
  - "difficulty": integer 1..5
  - "layout": "grid3x3" for matrix, "row" for sequence, "analogy" for analogy, "row" for oddOneOut
  - "stem": array of panels (each panel is a cell object, OR exactly the object {"blank": true})
  - "options": array of 4 cell objects (the multiple-choice answers)
  - "answerIndex": integer index into options of the correct answer
  - "explanation": one short sentence stating the rule

Per-type stem rules (follow EXACTLY):
  - matrix:    layout "grid3x3", stem = 9 panels in reading order, with EXACTLY ONE {"blank": true}
               (put the blank last). The correct option is what belongs in the blank.
  - sequence:  layout "row", stem = 4 cells followed by EXACTLY ONE {"blank": true} (5 panels total).
               The correct option continues the sequence.
  - analogy:   layout "analogy", stem = EXACTLY 3 cells [A, B, C] and NO blank.
               The rule mapping A->B applied to C gives the correct option (C is to ? as A is to B).
  - oddOneOut: stem = [] (empty). Provide 4 options where 3 share a property and 1 breaks it.
               answerIndex points to the odd one.

CRITICAL self-check before you answer: for each puzzle, re-apply your stated rule to the stem and
confirm that options[answerIndex] is EXACTLY the option your rule produces. If it isn't, fix
answerIndex (or the options) so the marked answer truly satisfies the rule. A common mistake is
off-by-one counts — double-check counts and rotations.

Return ONLY the JSON array of 5 objects.`;
