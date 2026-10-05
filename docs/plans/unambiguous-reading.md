# Every puzzle reads one way only, on a phone too

Written 2026-10-03 from user feedback: on a phone, people cannot tell what a
question is asking for.

## What people reported

1. The order of the pictures is ambiguous. Nothing marks where to look for the
   repeated change, or which picture leads to which.
2. On a phone, rows fold onto a second line and the series of changes stops
   reading as a series.
3. Fills run in a loop of three (white, gray, black, then white again). A new
   test taker who sees white, gray, black looks for a fourth fill that does
   not exist.
4. The 5-question sample gives no help with how to approach a question.

"Do not leave empty squares" is read here as: no two pictures sit side by side
with a bare gap between them; every gap carries a connector (an arrow, a
number, an operator) that says how the pictures relate. No served item ever
shows a fully empty board (checked over 2,250 generated items on 2026-10-03),
so there is nothing to change inside the boards themselves.

## What a 375px phone shows today

Rendered from one item of every served bucket at 375px wide:

- **Sequences** (`row`: relational sequence, 4 pictures; second-order
  sequence, 6) fold into a block. Four pictures become three plus a lone "?";
  six become a 3 × 2 block that looks exactly like a matrix question. No
  arrows, no numbers.
- **Analogies** (`analogy`: attribute pairing, compositional analogy, spatial
  transform, inverse analogy) split "A : B" from ":: C : ?" onto two lines, and
  the ":" / "::" notation itself is unfamiliar to many people.
- **Machine tables** (`machineTable`: composed transform, transformation
  machine) fold every row: input and gate on line one, "→ output" alone on line
  two. The query row's three-gate strip pushes its input onto a line of its own.
- **Combine tables** (`combineTable`: combining machine) fold the same way,
  with the left board and the gate on one line and the right board and output
  on the next.
- **3 × 3 grids** (`grid3x3`: relational matrix, visual set algebra) do not
  fold, but nothing says that the first two boards of a row make the third, or
  that columns matter in one family and not in the other.

The stem has 261px on a 375px phone; most of the rest is padding (the card's
24px and the diagram panel's 16px on each side).

## Design

**More room.** Below `sm:` the question card's padding drops to 12px and the
diagram panel's to 8px, so the stem gets about 301px. `NARROW_VIEWPORT_STEM_WIDTH`
moves with it, and the width tests keep pricing every layout against it.

**Sequences.** Every picture carries its position number above it (1, 2, 3 …;
the "?" carries the next number), and every picture after the first has an
arrow in front of it. A line that starts after a fold therefore starts with
"→ 4", which says "continued". On phones the row folds into balanced lines of
at most three (4 → 2 + 2, 6 → 3 + 3); from `md:` up it is one line when it fits.
Numbers make a fold harmless, and a folded sequence no longer looks like a
matrix, because matrices carry no numbers. Not folding at all is ruled out: six
pictures in 301px would be 44px each, below the legibility floor
([[legibility-doctrine]]).

**Analogies.** "A : B :: C : ?" becomes two aligned rows at every width:
"A → B" on top, "C → ?" below, the second row's pictures directly under the
first row's. The arrow means "becomes", and the stacking shows where the
parallel lies. This holds for inverse analogy too: whatever turns A into B
turns C into the answer.

**Machine tables.** Each row stays on one line on a phone: input → gate →
output fits in 276px. A query strip with two or three gates stacks its gates
top to bottom below `sm:`, with "↓" between them, so the row stays one line and
the gates still read in order. From `sm:` up the strip stays horizontal.

**Combine tables.** Each row stays on one line: left board, gate, right board,
arrow, output. At 375px that needs the boards about 67–71px wide instead of 80,
so the board columns are fluid (at most 80px) and shrink only on screens that
need it; from a 415px-wide screen they are full size again. The panel's inner
padding drops from 6px to 3px on phones to give the drawing back most of what
the box loses.

**3 × 3 grids.** Arrows appear only when the rule runs one way. Visual set
algebra works across the rows alone, so an arrow stands between the second and
third column of every row: "these two make this one". The relational matrix
works across the rows and down the columns; it reads both ways, so it draws no
arrows (owner's decision, 2026-10-03, after a first version drew "↓" arrows
too). The direction is a new optional puzzle field, `gridFlow` (`"rows"` or
`"rowsAndColumns"`), set by the two grid families at generation and public like
`operatorLegend`. It shows where the rule applies, never what it is.

**The fill loop: the puzzle shows it.** A legend under every question shipped
first and was replaced the same day (owner's decision, 2026-10-03): it explained
too much, and measuring showed the confusion was built into three families,
not missing from the screen.

- Compositional and inverse analogies always put a white and a gray shape on
  the worked board and a gray and a black shape on the question board. The
  question therefore always asks what happens to a black shape, which the
  worked pair never shows. When fills step forward (about 55% of items) the
  black shape must turn white, a step nobody has seen.
- In the relational sequence, the step into the missing picture was never one
  the pictures had shown (0 of 271 fill-stepping items), so a taker could not
  tell a loop from, say, black-gray-white-gray-black.

The rule that replaces the legend: **every fill change the answer needs is shown
in the worked evidence.** Analogies give both boards the same two fills, drawn
at random, so every change the question needs has a worked twin. A sequence
shows four pictures before its "?", three steps, which is one full lap of the
three fills: every fill change appears once and the step into the missing
picture repeats the first. Both hold by construction, and a test checks every fill-stepping
bucket over hundreds of draws, so the three families cannot drift back. This
changes generated content, so the generator becomes `scene-families-v20`, the
reference bank is rebuilt, and the pilot-v3 manifest is regenerated as
`data/pilot/README.md` prescribes (both v3 aggregates already fail its
fingerprint check, since they predate v17).

**Ring jumps: dots show the way round.** The second-order sequence moves a
token around the 8 outer squares by growing jumps. Every item had a jump of half
the ring or more, and on a ring of 8 a jump of 6 one way looks exactly like 2
the other way, while 8 looks like no move. Each picture after the first now dots
the squares its jump passed (`Scene.trail`, drawn about 5px across, a third of
the smallest shape, by the shared board renderer, so the agent image has them
too). The one rule whose fourth jump would exceed a full lap (start 3, grow 2)
is dropped, since dots cannot show a square passed twice. Owner's decision,
2026-10-03, under the rule that no hidden convention may decide an answer.
**Removed 2026-10-04** (`scene-families-v22`): the owner asked for the ring to
look as it did in `v0.1.0`, so the dots and the `trail` field are gone and the
dropped rule is back.

**Sample-test guidance.** On the 5-question sample only, a short note above the
diagram says how to read this kind of question and which features to compare
(positions, fills, shapes, arrow directions), and never what the change is. It
is chosen by layout, which the page already knows, so it reveals nothing the
picture does not. This is a deliberate exception to "no instruction while
solving" ([[visual-test-presentation]]): the sample is practice, and the
30-question test stays as it is.

**Agents.** The agent image (`compose-image.tsx`) draws the same reading cues
the person sees (owner's decision, 2026-10-03), and `SOLVER_PROMPT_VERSION`
moves to `solver-v4` so probe numbers from before and after are never pooled.
The v19 probe (76%) therefore needs a fresh run before it can be compared.

## Verification

- The width tests price every phone layout against the new budget from the
  classes the markup really carries.
- New tests: numbers and arrows on every sequence, two analogy rows, the grid
  arrows on one-way grids only, and every fill change an answer needs shown in
  the worked evidence.
- Re-render one item of every bucket at 375px and 1024px and look at it.
- The full local gate, including `bank:verify` after the v20 bank rebuild and
  the options-only gate (the worst strategy fell or held in all three
  fill-stepping families; numbers in `docs/plans/history.md`, `v20`).
