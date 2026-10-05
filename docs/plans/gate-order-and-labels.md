# Gates show their order, and stop looking like board shapes

**Status: built as jigsaw pieces (2026-10-04, `scene-families-v22`, `solver-v5`).** Earlier
the same day the owner kept the dashed box of board shapes and declined three small fixes
("Leave it as it is today"). Later they asked to see ten more designs and ways of chaining
gates (canvas page "Ten gate designs"), chose design 8, and asked: "Please apply jigsaw
pieces, do them all as jigsaw pieces."

What shipped: every gate is one jigsaw outline, told apart by texture only (dark, dotted,
striped; `src/items/gate-pieces.ts`). A question's pieces snap tab into notch, and the tabs
point the way the board travels. The dashed box and the arrows between gates are gone. On a
phone a question's pieces stack top to bottom with tabs down, as the dashed box stacked
before, because three pieces side by side would shrink a combining row's boards to about
50px, under the 64px the legibility tests hold. The puzzle data is unchanged; the
explanations name gates by their piece ("the dotted piece").

The rest of this file records what was explored before that, so it is not proposed again.

Written 2026-10-04 from the owner's report: in a two-gate question the gates sit in one dashed
box with an arrow between them, which does not say which gate runs first or what each gate
combines. The gate labels are also big copies of board shapes (an outline triangle, a solid
square, a half-filled diamond), so a label reads like part of a board.

The owner chose from twelve sketches on the
[Gate order ideas](https://claude.ai/artifact/RiU4zR6Mtp5N5CB2PdiRTN) canvas (2026-10-04):

- **Combining machine: D · Circuit.** The boards flow along lines into each gate. **On hold
  (2026-10-04):** the owner is not yet sure about the circuit and is reconsidering the layout;
  nothing is built until they decide.
- **One-board machines (composed transform, transformation machine): keep today's layout.**
- **Gate labels: J3 · Notched keys, in all three gate families** (confirmed 2026-10-04).

## What the combining machine hides today

The query row reads `L [gate 1 → gate 2] R → ?`. What it means is `gate 2(gate 1(L, R), R)`:
gate 1 combines the left and right boards, then gate 2 combines that result with the right
board again. Nothing on screen shows the intermediate step or that the right board is used
twice; only the post-test explanation says so.

## Design

**Gate labels: notched keys.** Three dark grey tiles, each with its own notch:

- gate A: a round bite out of the top edge;
- gate B: two square notches in the bottom edge;
- gate C: a V notch in each side.

They share no outline with any board shape, and they differ by shape alone, so colour vision
does not matter. This is drawing only. The data keeps today's glyph tokens (`GATE_GLYPHS` in
`src/items/scene-families.ts`), and both renderers draw a key wherever a gate panel holds one
of them. Item content, the oracle, replay keys and the bank are untouched, so the generator
version stays the same.

**Combining machine: a circuit.** Every row becomes a small tree read top to bottom:

- **Worked trees.** The left and right boards sit side by side. A line runs down from each into
  the gate's key, and one line runs from the key down into the output board.
- **The query tree.** The left and right boards sit on top, and both feed key 1. Key 1's result
  and a second line from the right board feed key 2, and at d5 key 3 the same way. The last key
  feeds the "?". The keys carry their step number (1, 2, 3) beside them. The right board's line
  visibly reaches every key, which is the fact today's layout hides.
- **Phone layout.** Worked trees sit two to a line, so d5's third tree wraps to a line of its
  own, with boards no smaller than 44px (the legibility floor). The query tree is centred below
  them.
- **Desktop layout.** Up to three worked trees sit side by side.

**One-board machines.** The input → dashed gate box → output rows stay as they are; only the
glyphs inside the box become keys.

**Agent image.** `compose-image.tsx` draws the same circuit and keys (the owner's rule that
agents see the cues people see), and `SOLVER_PROMPT_VERSION` moves to `solver-v5` so probe
results never pool across the change.

**Sample note.** The 5-question sample's note for the combining machine changes to follow the
lines ("each key combines the two boards whose lines run into it…"). It still describes how to
read the picture, never the rule.

## Verification

- Tests:
  - the circuit fits a 301px phone stem with boards of at least 44px;
  - in the query, the right board's line reaches every key, and each key after the first takes
    the previous key's result;
  - no gate panel draws a board shape in either renderer;
  - each key is drawn for its gate.
- Re-render one item of each gate bucket at 375px and 1024px and look at it.
- The full local gate.
