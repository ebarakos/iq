# aiq history

Moved verbatim from CLAUDE.md on 2026-08-26.

Paths and links in this file are relative to the repo root.

## Status narrative (as written 2026-08-26)

**Status: GENERATED REASONING-TEST PROTOTYPE.** The app serves two test lengths,
5 and 30 questions, both drawn from the same pool of 14 eligible visual reasoning
families (22 code-valid families; withdrawals on human or structural evidence,
including two 2026-08-24 redesigns that failed their pilot and the
`containment-analogy-v2` withdrawal of 2026-08-26) and the same four
difficulty bands. Every test is generated from a fresh seed,
validated in pure code, served without answers, and scored server-side against a
whole-test deadline of 60 seconds per question. Every question offers six
answer options, so a blind guess is worth 1 in 6. Families ship behind a visible
experimental label: they pass the code-correctness contract, and four human
pilot sittings from one participant have run — most recently the 20-item v11
escalation pilot of 2026-08-26, 15 of 20 correct with four clean misses at d4/d5
(see `data/pilot/README.md`) — alongside the first trustworthy agent probes.
That evidence is enough to withdraw families, not to calibrate difficulty, so
this is not a standardized IQ score. See
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

---

## Concept (working definition)

- **What:** A growing battery of IQ-style test items (Mensa-style matrices,
  sequences, analogies — or a novel format if we find a better one) ordered by
  increasing complexity.
- **Audience:** Dual — the same item pool is presented to **humans** and to
  **agents** (LLMs / multimodal models). 
- **Visual-only ("visibility only"):** Items are intended to be purely visual /
  language-independent — no text comprehension, no culture-specific knowledge —
  so the test is fair across humans and vision-capable agents. *(Assumption to
  confirm — see BRAINSTORM Q1.)*
- **Adaptive audience routing:** Difficulty is calibrated against agents. If
  agents solve an item trivially, it is tagged/defaulted as a **human** test;
  items that still challenge agents are the frontier. The interesting signal is
  the gap between human-hard and agent-hard.
- **Open to a novel format.** Standard Mensa-style is the baseline, not a
  constraint. Better ideas are welcome and should be captured in BRAINSTORM.md.

This is a deliberately loose definition — it will be sharpened in later
brainstorming sessions before any implementation.

---

Historical: the layout below was written before the repo existed. The real module map
is in `docs/architecture.md`.

## Planned repo layout (not yet created)

```
src/            # app + core (TBD once framework confirmed)
src/lib/        # relay integration (added by /connect-relay)
src/items/      # item generators / schemas (visual puzzle definitions)
docs/plans/     # formalized design docs (slug per design)
BRAINSTORM.md   # free-form ideation + open questions  ← current focus
TODO.md         # short task/checklist state
```

## Generator version history of the expanded quiz (`scene-families-v2` to `v30`)

Moved verbatim on 2026-09-28 from the comment above `EXPANDED_GENERATOR_VERSION` in
`src/items/expanded-quiz.ts`. Background only: each entry records what changed in the
population at that bump and why results from either side must never be pooled.

Generation semantics for the two public test lengths.

Bump this whenever the band schedule, the family pool rule, the ordering
rule, or any family's item semantics change. `scene-families-v2` was the
retired 12-question profile; `v3` carried the ill-posed `minimal-repair-v1`,
so attempt data recorded under it must not be pooled with `v4`. `v5` adds
seeded family-pool subsampling, so it is likewise a separate population.
`v6` serves `OPTIONS_PER_ITEM` options instead of four, which lowers the value
of a guess and changes every family's near misses — results from `v5` and `v6`
are not comparable and must never be pooled. `v7` withdraws the four families
the first human pilot ruled out, so its family pool is smaller than `v6`'s.
`v8` withdraws `interleaved-sequence-v2` (one observed transition is not
evidence a step repeats), shrinking the pool again — attempts recorded under
`v7` and `v8` are different populations and must never be pooled. `v9`
raises the ceiling: composed-transform grows to three ordered steps (as
`-v2`), the redesigned `interleaved-sequence-v3` and `relational-outlier-v3`
enter at their predecessors' positions, and `containment-analogy-v2` moves
down into constraint-spatial — a different pool and ladder than `v8`'s.
`v10` withdraws both redesigns after the 2026-08-24 full-battery pilot:
`relational-outlier-v3` failed it outright, and `interleaved-sequence-v3`
was answered correctly but with the notation misread, which the human gate
does not accept as proof of legibility.

`v11` is the escalate-the-quiz batch, bumped once on 2026-08-25 after every
semantic change and registry entry was final, so no attempt or bank artifact
was ever recorded under a half-finished population. It changes what a
question is made of, in six ways. Difficulty buckets are now an INPUT to
generation rather than a label put on the output, so a bucket selects the
program the family draws; `fold-punch`, `visual-set-algebra`,
`compositional-analogy` and `composed-transform` each gained a deeper bucket
on top of their existing one, and a family asked for twice in a band now
gets its deeper bucket the second time. Wrong answers are no longer sampled
uniformly: required contrasts are kept, then the remaining slots are filled
from the closest candidates by scene edit distance, so every option is a
near miss. Composed transforms grew a four-gate form and admit token turns,
and every displayed gate is now proved load-bearing — a program whose answer
survives deleting any one gate is not servable — with the deep half of that
grammar held out of public tests entirely. `parallel-evolution-v1` joins the
composition band, three tokens on one board each following their own rule.
Band draws became format-aware: at most one analogy-layout family per draw,
chosen uniformly from the subsets that satisfy that and the cross-band rule
— which now yields for a family whose bucket only this band can serve, so a
long test can spend one of its distinct families on the four-gate machine
and its floor moved from twelve to eleven to pay for it.
And the family pools are the plan's fallback branch — six composition, four
constraint-spatial, four induction-transfer, twenty enabled family/band/bucket
keys — because the `dual-constraint-matrix-v1` necessity proof failed and
that family was never added. Every one of those changes moves what a score
means, so `v10` and `v11` results are different populations and must never be
pooled. See docs/plans/escalate-the-quiz.md.

`v12` is the raise-the-ceiling batch of 2026-08-26, bumped once for four
changes that all move what a score means. The difficulty range gained a sixth
rung, and two buckets sit on it: `composed-transform-d6` shows five ordered
gates and `transformation-machine-d6` demonstrates four. Both live in
`induction-transfer` because the long test is ordered easiest-first and that
band is last, so a deeper bucket anywhere else would still be answered before
the end. A band's leftover questions now go first to the families whose next
occurrence reaches a bucket their base share never would, which is what turns
"a long test usually ends on the hardest thing the battery has" into "always".
And `containment-analogy-v2` is withdrawn on the pilot's notation evidence,
which drops `constraint-spatial` from four families to three — exactly its
draw size, so that band no longer subsamples. `v11` and `v12` results are
different populations and must never be pooled. See
docs/plans/raise-the-ceiling-v12.md.

`v13` is the owner's correction of 2026-08-27, one day after v12, and it
moves the population twice:

- **Both d6 buckets are withdrawn.** The rule is now **never more than three
  gates**: a fourth or fifth adds procedure, not reasoning. The owner knew
  the mechanism instantly and answered the five-gate item wrong in under five
  seconds because applying it once more was boring. The ladder tops out at d5
  again, and the leftover-question rule from v12 stays but redirects nothing
  until some family holds two buckets in one band again.
- **`visual-set-algebra-v2` is rebuilt.** Its inputs were a fixed diagonal of
  two tokens that could never disagree, which the owner called toys. Boards
  are now three tokens drawn into four roles — shared, clashing, left-only,
  right-only — and the combining vocabulary went from four operations to
  eight, because a clash finally makes "which side wins" and "does identity
  count" real questions. `relational-matrix-v2` moves with it: it draws from
  the same widened operation set.

The battery is 19 enabled family/band/bucket keys over pools of two warmup,
six composition, three constraint-spatial and four induction-transfer
families.

`v14`, later the same day, changes what the WRONG options are in every
family at once. The owner reported that "using only one first inference you
can select the right answer without looking at the other rules", and it
measured true of every item in four buckets: the answer was the only board
with its footprint, so working out where the tokens go finished the item
without ever reading a shape or a fill. Distractor selection now takes, for
each aspect a solver can infer on its own — footprint, shapes, fills,
rotations, token count — the closest wrong option that AGREES with the answer
on it, before filling the remaining slots by closeness as before. Knowing one
aspect therefore no longer narrows six options to one. `relational-matrix-v2`
needed its inputs widened for the same reason `visual-set-algebra-v2` did a
few hours earlier: its four corner atoms were fixed, so two input boards
could never disagree and no wrong option could share the answer's footprint.

Every family's option lists moved, so `v13` and `v14` are different
populations. Measured over 120 seeds a bucket, items solvable from a single
aspect fell from 13 buckets to 8, and the five multi-rule families that
carried the ladder — composed-transform, transformation-machine,
compositional-analogy, visual-set-algebra d5 and inverse-analogy — went to
zero.

`v15` finishes that job in the four buckets `v14` left leaking, each at the
source of its near misses rather than in the shared selection:

- **`relational-matrix-d4`** (88% of items decided by one aspect) gets three
  tokens per corner instead of two, so a shape has three possible homes and a
  wrong option can carry the answer's shapes in other cells; and a fourth
  witnessed mistake, combining the right rule with the wrong two boards of the
  grid, which is the commonest real error on a 3x3.
- **`spatial-transform-d2`** (64%) pairs every board move with an extra token
  turn, so the option list holds the board the solver gets by moving correctly
  and turning the tokens as well — the exact mix-up the family tests.
- **`rule-switching-d2`** (48%) adds the correct board carried one operation
  further, which keeps the answer's cells and changes only the fill.
- **`visual-set-algebra-d4`** (45%) redraws its inputs until the pool can
  cover every aspect, the way its `-d5` sibling already did for free through
  its third turning step.

Every servable bucket that can hide its answer now does. Four cannot and are
not defects: `fold-punch` d4/d5, `inverse-fold-punch-d5` and
`second-order-sequence-d4` offer one token or one punched sheet at different
places, so an option agreeing on the footprint would BE the answer.

`v15` also adds `combining-machine-v1`, the first family whose gates take TWO
boards — the owner asked for the set-algebra idea inside the gate machines,
and a machine row of (input, gate, output) cannot show a second operand, so it
ships with a new row shape where the gate glyph sits between its operands. It
is registered as a PROTOTYPE, not code-valid, so the assembler does not serve
it: no human has seen it. Its aspect gap was closed the same day — d4 to 0%
and d5 to 8%, from 63% and 90% — by giving the pool the two boards that sit
beside the answer: the clash read the wrong way round, and the exclusive token
kept from the wrong board.

`v15` also DELETES the ten families that were carried in the registry but
served in no test: operator-induction-v1, containment-analogy-v2, both
relational-outliers, constraint-mosaic-v2, topology-path-v1,
concept-induction-v2, both interleaved-sequences and minimal-repair-v3. Each
had been withdrawn on evidence recorded in git and in data/pilot/README.md, so
the code carried nothing the history does not. The served battery is unchanged
at the same 19 keys as `v14`.

`v16` withdraws both fold-and-punch families because their corner mirroring
is too easy to earn repeated slots in the battery. Constraint-spatial now
consists only of relational matrix and visual set algebra. The deep composed
transform no longer adds a separate order-demonstration row and then asks
for all three gates; it demonstrates A, B and C once, then asks for two of
those gates in a recombined order. Results from v15 and v16 are different
populations and must not be pooled.

`v17` makes the transformation ladder literal. The intermediate composed
bucket demonstrates and applies two gates; the hard bucket demonstrates and
applies three, with varied order. The one-step rule-switching family moves
from the hard tail into warmup. Every composed worked row is now required by
its query, so v16 and v17 results must not be pooled.

`v18` promotes `combining-machine-v1` into constraint-spatial — the first
family whose gates combine two boards — growing the served pool from 16 keys
to 18. A new family is a new population, so v17 and v18 results must not be
pooled.

`v19` answers the flaw found in the 2026-09-28 review: a solver that never looked at the
question could pick the right answer from the six options alone about 60% of the time,
because every wrong option was one change away from the answer and so the answer sat at the
centre of the list. Distractor selection now builds the options as a tree rather than a
star, and the answer's rank on every options-only measure is spread evenly, so it is the most
typical option about as often as any other; several families gained wrong options that make
two mistakes in one run, so wrong options can share a mistake with each other.
`npm run families:verify` now fails any served bucket where one of 26 options-only strategies
beats 30%.
`parallel-evolution-v1` was retired, `combining-machine-v1` went back to prototype because
its boards are too few to hide the answer this way, and `visual-set-algebra-d4` stopped
being compared with its v10 closeness baseline. Every served option list changed, so `v18`
and `v19` results are different populations and must never be pooled.

The same review (2026-09-28) cleared out code that only tests reached. Two of those were
decisions rather than tidying: the relay widget plumbing (`relay-client.ts`,
`relay-api-helpers.ts`) was dropped because the widget was never loaded, and the page now uses
plain `fetch`; and the legacy `procedural-v1`–`v3` generator with the LLM item writer
(`generate.ts`, `prompt.ts`, the writer in `model.ts`, the procedural and model sources of
`bank:topup`) was deleted because nothing served or banked had come from them since the scene
families took over, while `rules.ts` stays for the schema. The withdrawn d6 code paths, the
topology and constraint-engine modules, and `sampleQuiz` went the same day.

Still under `v19`, before it was committed, `rule-switching-v2` was retired on 2026-09-29
(owner's decision). It demonstrated two gates and its query ran one, so every item showed a
transformation that played no part in the answer, and the owner's rule is that a test shows
only the transformations the answer uses. The puzzle schema now rejects any machine or
combine table whose worked gates and query gates differ, so no family can do this again.
Warmup keeps three families, two of them analogy-shaped, so a long test now serves about 8.3
analogy-layout questions where it served 7.5. The ten families served are exactly the ten a
long test needs, so `WITHDRAWN_FAMILY_IDS` has no slack until a family is added.

On 2026-09-30, still under `v19`, the agreement rule for wrong options (some wrong option
shares each aspect of the answer) stopped being a hard rule: it fed a solver that rules out
every option alone on some aspect (42.9% on relational-matrix-d4). Being alone on an aspect,
and being ruled out for it, are now two more strategies the option mix balances and the gate
holds to 30%; the one-inference solver the rule protected against stays in the mix as a cost,
so one inference decides the answer in at most about a quarter of items in any bucket. On the
same day `combining-machine-v1` returned to constraint-spatial unchanged: its 22-board pool
passes the gate once agreement is balanced, and its query pair cannot be widened. That gives
the withdrawal list one family of slack again, in constraint-spatial only. Every served
option list changed again, so results from before this day must not be pooled with results
after it.

`v20` (2026-10-03) makes every fill-stepping puzzle show the loop's seam before an answer
depends on it. Fills run white, gray, black, then white again, and takers on phones looked for
a fourth fill. Measuring showed why: compositional and inverse analogies always put a white
and a gray shape on the worked board and a gray and a black one on the question board, so the
question asked what a black shape becomes without ever showing one (about 55% of items needed
it to turn white), and a relational sequence's step into its missing picture was never one it
had shown. Analogies now give both boards the same two fills, drawn at random, and a
relational sequence shows four pictures before its blank instead of three: one full lap of the
fills, so the missing step repeats the first. The second-order sequence dots the squares
each jump passed (a new optional `trail` on scenes), so a long jump around the ring can no
longer read as a short one the other way, and drops its one rule whose jump would exceed a
lap. The worst
options-only strategy moved from 21.0% to 20.3% (compositional d3), 23.5% to 21.2% (d4), 20.3%
to 18.8% (inverse) and stayed at 18.2% (sequence). The same day grids gained a public
`gridFlow` field; a grid whose rule runs across the rows only draws arrows from it (it changes
no item content). Item
content changed in three families, so `v19` and `v20` results must never be pooled; see
`docs/plans/unambiguous-reading.md`.

`v21` (2026-10-03, the same day) makes one clue never enough. The owner's rule: "You should
never be able to guess this answer through them or with 1 out of x clues needed to solve a
test." Measured under `v20`, one clue about the whole board picked the answer in up to 31% of
items, and one shape's fill in up to 66% (composed-transform-d4). Every option list must now
let every clue appear on at least two options, the answer's and every wrong option's alike, so
the answer cannot stand out as the one option never alone. A clue is a whole-board aspect or
one shape's square, fill or turn; in the two families that combine boards square by square
(relational matrix, combining machine) it is one square. The second-order sequence is exempt:
its whole rule is one clue. The one-inference cost left the option game, the transformation
machine no longer has to offer the run that stops before its duplication gate, and set
algebra d4 redraws the one draw in twelve that cannot share every clue. The worst
options-only strategy in any bucket fell from 25.6% (relational-matrix-d4, untouched by
`v20`) to 22.4% (set-algebra d4). Stems and answers did not change, only options, except in
those redrawn set-algebra draws. `v20` and `v21` results must never be pooled; see
`docs/plans/blind-answer-leak.md`, "One clue is never enough".

`v22` (2026-10-04) removes the ring dots `v20` added. The owner asked for the second-order
sequence to look as it did in `v0.1.0`: one shape per picture, nothing marking the squares a
jump passed. The `trail` field is gone from scenes, and the rule `v20` dropped (start 3, grow
2) is back. A jump of 6 one way again looks like 2 the other way; the answer stays unique
because every wrong option comes from a rule that misses a shown landing. Only that family's
items changed, so `v21` and `v22` results must never be pooled.
The same day gates became jigsaw pieces (owner's choice from ten designs): one outline, told
apart by texture, snapped tab into notch in a question, with no dashed box. The puzzle data is
unchanged; the explanations of the three machine families now name each gate by its piece. The
agent image changed with it, so the solver version is `solver-v5`. See
`docs/plans/gate-order-and-labels.md`. Also folded into `v22`: the composed transform's fill
gate shows its worked arrow off the diagonal, because a diagonal flip fitted that row and led to
a wrong option in 131 of 200 d4 items (`docs/plans/one-reading-per-worked-row.md`). Last, every
explanation was rewritten for the person reading it on the review screen: what to look at and how
to reach the answer, never how the item was made. The owner had read "Distractors stop early, run
the gates in another order…" there. The rewrite also corrected the flip names: a left-right mirror
had been called "reflects across the horizontal axis". Questions and answers did not change.

`v23` (2026-10-04) acts on two agent tests of `v22`. Sonnet 5.5 and Opus 5.5 each took three
30-question tests with `--debrief` and scored 76/90 and 80/90; 9 of their 24 wrong answers came
from the items (`docs/plans/one-reading-per-worked-row.md`). Composed transform no longer serves
a program whose fill piece lands on the arrow: two gates went from 16 servable programs to 12,
three gates from 192 to 152. Its left-right mirror is shown on a sideways arrow, so "a mirror turns
arrows round too" no longer fits. The transformation machine's copy row shows a second shape that
stays put, so neither "flip, then copy" nor "copy every shape" fits it. Set algebra redraws when
both worked results stand on the same squares or a step of its rule never shows. It keeps any
board another reading of the rows predicts out of the options, and d5 always offers the answer's
shapes on other squares. A new gate in `families:verify` checks that no reading every worked row
allows lands on a wrong option (`src/items/worked-row-readings.ts`). Stars have fatter arms (inner
radius 0.55 of the outer, was 0.42) so grey reads inside them; the agent image changed with them,
so the solver version is `solver-v6`. Those three families' items changed, so `v22` and `v23`
results must never be pooled.

`v24` (2026-10-04) changes one row. Opus 5.5 and Codex default each took one 30-question test
of `v23` with `--debrief`; both scored 29/30 and missed the same composed-transform question the
same way. Its fill example coloured a star in the top-left square, the question started with a
star there, and "colour the star" fitted the example as well as "colour the top-left square". The
fill gate's worked row now shows its shape twice and colours only the top-left one, and the
reading check tries "colour that kind of shape" too. Only the fill rows changed, so `v23` and
`v24` results must never be pooled.

`v25` (2026-10-04) fixes the other flag of that re-run. In attribute pairing, a one-step fill
change such as white to grey also reads as "one step darker", and when the question's shape was
already black, that reading stopped at black, which is the option that keeps the fill; a wrong
option followed in 20 of 200 items. The fill order is now redrawn when the example's step cannot
continue from the question's fill. Only that family's items changed, so `v24` and `v25` results
must never be pooled.

`v26` (2026-10-04) finishes that fix. In a re-run of `v25` both Opus 5.5 and Codex missed an
attribute-pairing question whose example went from black to white: "swap black and white" leaves
grey alone, and both kept the question's grey. The question's shape now starts in the worked
pair's first fill and, when the fill changes, takes the worked pair's second, so the one change
the answer needs is the one shown, as the owner's rule of 2026-10-03 asks. Only that family's
items changed, so `v25` and `v26` results must never be pooled.

`v27` (2026-10-05) gives the combining machine worked rows of their own. A re-run of `v26` found
that its pieces also read as "one kind of shape" ("striped removes triangles, dotted adds squares
from the right board"), and such a reading led to a wrong option in about half of all items: the
worked rows used the question's boards, whose left-only and right-only shapes share a kind on
purpose. Each worked row now draws its own boards, with one more shape when it needs it, until its
combine is the only reading. The question keeps the family's own boards. The reading check covers
the family too. Only that family's items changed, so `v26` and `v27` results must never be pooled.

`v28` (2026-10-05) shows the combining machine's chain. In a re-run of `v27` Codex twice called a
wrong option defensible by keeping the left board fixed and feeding the board so far in on the
right: every example row showed one piece alone, so nothing showed how pieces chain, and some
other way of chaining led to a wrong option in about 6 of 10 items. A row of two of the question's
pieces snapped together now sits above the question, drawn so that every way of chaining it allows
gives the question's answer, and the reading check tries every way of chaining. d4 items gain a
fourth row and d5 items a fifth. Only that family's items changed, so `v27` and `v28` results must
never be pooled.

`v29` (2026-10-05) widens the set-algebra readings that keep boards out of the options. Codex's
review found a d5 item whose two rows both fit "keep the right board's shapes where the left board
is empty, slide them one square left, wrapping, turn them a quarter", and which offered that board
as a wrong option. The readings now combine the boards either way round and include one-square
slides that wrap. Options changed in 3 of 200 d5 items and no d4 item; no example row changed.
Only that family's items changed, so `v28` and `v29` results must never be pooled.

`v30` (2026-10-05) retires `combining-machine-v1` in code (owner's decision). Its chained pieces
each meet the same right board again; no single-piece example could show that, and it took an
extra chained example row (`v28`) to read one way after Codex named other chainings. Constraint-
spatial now draws both of its two families, relational matrix and set algebra, so the band has no
family to spare: withdrawing any served family now stops 30-question tests from building. 13
family/band/bucket keys; the bank holds 65 items. `v29` and `v30` results must never be pooled.

The same day, still under `v30`, the code no served question reaches was removed (owner's
request). Every served picture is a scene, so the compact-cell format went, and with it the
rule language (`rules.ts`) the schema had kept for banked cell items since 2026-09-28; no
banked item carried a rule. The odd-one-out and operator question types went, as did the
combine-table, groups and single-board layouts, the one-row strip for four or five gates (the
three-gate ceiling made it unreachable, so machine tables are now two or three worked rows),
the two textures only those gates used, the concept and expression grammars, and the dormant
pilot-promotion state machine; the human-solvability gate stays in
`docs/plans/deterministic-novel-tests.md`, and pilots run through `npm run pilot:report`. No
item changed: `families:verify` and `bank:verify` read the same as before.
