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

## Generator version history of the expanded quiz (`scene-families-v2` to `v19`)

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
