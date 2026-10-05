# The answer must not be guessable from the options alone

Status: **built 2026-09-29 as `scene-families-v19`;** tightened on 2026-10-03 in
`scene-families-v21` so that one clue is never enough (see the section of that name). The
work items are in [TODO.md](../../TODO.md) under "the answer must not be guessable from the
options alone" and "One clue is never enough"; the decisions, results and what is left are
at the end of this file.

## What was measured

A solver that never looks at the question, only at the six answer options, picks the right
answer about **60% of the time**. A blind guess should be worth 1 in 6 (16.7%). Two
independent review passes and a third rerun agree to within two points.

Three options-only solvers were used, all reading nothing but the public payload:

- **most typical option** — the option with the smallest total edit distance
  (`sceneEditDistance`) to the other five;
- **per-aspect majority** — for each aspect in `DISTRACTOR_ASPECTS` (footprint, shapes,
  fills, rotations, token count), count how many other options share this option's value,
  and pick the option with the highest total;
- **per-cell majority** — the same count, cell by cell.

| Test length | Most typical | Per-aspect majority | Per-cell majority |
|---|---|---|---|
| 30 questions (200 tests, 6,000 items) | 60.7% | 58.4% | 56.2% |
| 5 questions (100 tests, 500 items) | 61.4% | 60.3% | 56.8% |

By family (best of the three solvers, 30-question tests): `parallel-evolution-v1` 100%,
`transformation-machine-v3` 96%, `relational-matrix-v2` 88%, `combining-machine-v1` 84%,
`rule-switching-v2` 76%, `visual-set-algebra-v2` 68%, `spatial-transform-v2` 66%,
`composed-transform-v2` 58%, `inverse-analogy-v2` 40%, `attribute-pairing-v1` 35%,
`compositional-analogy-v2` 34%, `relational-sequence-v2` 33%, `second-order-sequence-v2`
17% (the only family at chance).

The difficulty ladder is inverted under this attack: the warmup band is about 50%
blind-solvable, while the constraint-spatial band, the hardest-looking stage, is about 79%.

A smaller leak rides along: when exactly one option's `objects` list is out of row/column
order, that option was never the answer (0 of 28 cases in 600 items).

## Why it happens

Every wrong option is built as a near miss of the answer: one failed program, one aspect
wrong. Since 2026-08-27, `selectDistractors` (`src/items/scene-families.ts:442`) also
makes sure that, for every aspect, at least one wrong option shares the answer's value, so
that no single aspect singles the answer out. Together these two rules place the answer
at the centre of a star. Each wrong option differs from the answer in one direction, and
the wrong options differ from each other in two. So the answer holds the most common value
on every aspect, and it is the option closest to all the others.

`parallel-evolution-v1` is the extreme case: every wrong option is exactly one token away
from the answer, so a cell-by-cell vote rebuilds the answer every time. The test at
`src/items/scene-families.test.ts:1376` pins that design.

## What it breaks

- The product claim that a blind guess is worth 1 in 6.
- Agent evidence. Vision models are known to exploit this cue. The recorded agent numbers,
  from 93% at v4 to the v10→v11 drop from 86.67% to 78.89%, include an unknown share of
  shortcut. The pending v18 probe would measure the shortcut, not reasoning.
- Human scores, for anyone who spots the pattern. Test-savvy people do.

## The rule to add

Keep the existing rule, and add its mirror image:

1. **Existing:** for every aspect, at least one wrong option shares the answer's value,
   so no aspect picks the answer out as the odd one.
2. **New:** for every aspect, some value other than the answer's appears at least as often
   as the answer's value. The answer must not be the majority on any aspect.
3. **New:** the answer must not be the single option closest to all the others.

The usual way to meet all three is the one I-RAVEN used for the same flaw in the RAVEN
dataset. Build the wrong options as a tree rather than a star: some wrong options are
variations of other wrong options, sharing their wrong value. Each such option still needs
exactly one witnessing failed program (a program with two mistakes is still one program),
so the `family.ts` witness contract is unchanged. With six options a perfect balance is
not always possible; rules 2 and 3 ask only that the answer never wins outright.

**Refined 2026-09-29, after a Codex review.** Rules 2 and 3 as hard bans were themselves a
signal: with the top forbidden and the bottom discouraged, the answer piled up in the middle
ranks, and picking the option closest to the middle on all three solvers scored 36–52%. The
rule that ships is **rank uniformity**: on every options-only measure the answer's rank among
the six should look like a random option's, including being the most typical about 1 time
in 6. Aspect agreement (rule 1) stays a hard rule. `selectDistractors` lists every option
list in the nearest 20 near misses that keeps agreement, then plays a small game per item
against the gated strategies and picks one of its lists with the item's own seeded RNG.

## The gate

`npm run families:verify` (`scripts/scene-family-verify.ts`) reads 200 items per served
bucket from fixed seeds (`blind-gate-v2`), so it never flakes, and fails the bucket if any of
28 options-only strategies picks the answer more than **30%** of the time: the option at
each rank 1–6 on the three solvers and on their composite (mean rank), the option closest to
the middle rank on all three, ruling out every unique extreme before guessing among the
rest, picking an option alone in its value on some aspect, and ruling those out before
guessing among the rest (the last two since 2026-09-30). Ties split credit fairly. `src/items/blind-options.test.ts` repeats a smaller
fixed-seed sweep inside `npm test` with a 50% bound, which catches the old star (58–92%) and
the middle pile-up (53%).

## Order of work

1. Build the gate, record today's per-bucket numbers as the baseline.
2. Optional, no code: withdraw `parallel-evolution-v1` through `WITHDRAWN_FAMILY_IDS` at
   once. Checked 2026-09-28: both test lengths still assemble without it (20 of 20 each).
3. Rebuild distractor selection family by family, worst first: parallel-evolution,
   transformation-machine, relational-matrix, combining-machine, rule-switching,
   visual-set-algebra, spatial-transform, composed-transform.
4. Ride-alongs for the same generator-version bump: sort each option's `objects` into
   row/column order before serving; remove `familyId`, `band` and `difficulty` from the
   pre-answer payload (the page reads `familyId` only on the review screen, which can take
   it from the submit response); widen `transformation-machine-d5`'s 96-stem space; the
   combining-machine speed-up.
5. Bump to `scene-families-v19`, rebuild the emergency bank, and only then run the agent
   probe. A useful extra arm for that probe: give the model the six options with no
   question. Its score is the size of whatever shortcut survives.

## Decisions (owner, 2026-09-28 and 2026-09-29)

- The threshold is 30% per solver per bucket, over 100 fresh items.
- `parallel-evolution-v1` is retired in code rather than rebuilt.
- With it gone, the composition band's pool is four families, two of them analogy-layout, so
  a long test serves about 7.5 analogy-layout questions instead of 5. Accepted: they are two
  different mechanisms sharing a layout.
- `combining-machine-v1` is demoted to prototype. Its query pair has four role cells with the
  same token in both exclusive cells, which leaves 22 legible boards besides the answer; an
  exhaustive search found no option list that keeps the answer out of the aspect-majority top
  group (best case a four-way tie). It returns after its query pair is widened, through the
  normal gate. **Revised 2026-09-30:** the pair was not widened, because it cannot be — every
  binary operation works cell by cell and there are only four cell patterns, so a fifth cell
  copies one of them — and it did not need to be. The four-way tie was a product of the
  agreement rule; once agreement became a balanced strategy the same 22-board pool passes the
  gate at about 21% on both buckets, and the family is served again unchanged.
- `visual-set-algebra-d4` is exempt from the v10 closeness baseline (the distance fixture's
  `keysNotCarried`). That baseline predates the family's 2026-08-27 redesign, and the balance
  rules above win where the two conflict.

## Result

The best top-pick solver fell from about 60% to 17% on 5-question tests and 13% on 30-question
tests. After the rank-uniformity refinement, every served bucket's worst gated strategy is at
most 28.5% (`relational-matrix-d4`), against up to 54.4% before it; Codex's own middle-rank
script, on its own seeds, now reads 12–19% where it read 36–52%. Per-bucket numbers print in
the `families:verify` output.

## Agreement became a balanced strategy (2026-09-30)

Ruling out every option that is alone in its value on some aspect, then guessing among the
rest, scored 42.9% on `relational-matrix-d4` while agreement was a hard rule (16.7–23% in
every other served bucket): in that family fills and rotations are constant, so three of the
five aspects repeat the token count, and agreement left few lists. Decided 2026-09-29, built
2026-09-30: agreement is no longer required. "Pick an option alone on some aspect" and "rule
out the options alone on some aspect" joined the gate at 30% like the other strategies (28 in
all), and `selectDistractors` plays them in its per-item game.

One more strategy plays in the game but not in the gate, because it is not options-only: the
one-inference solver of 2026-08-27, who has worked out one aspect of the answer from the
question and is done when the answer alone holds it. Balancing the blind strategies alone
left that solver finished in up to 62% of transformation-machine-d5 items (0% under the old
rule); scoring an isolating list as a whole leak to that solver brings it to at most 26% in
any served bucket, with the blind gate still passing everywhere. Weighing the solver by how
many options share the aspect instead pulled the mix back towards the star and failed
compositional-analogy-d4 at 31.3%, so it was not kept.

Result: every served bucket's worst gated strategy is at most 25.6% (`relational-matrix-d4`,
exclude-lone-aspect), against 28.5% before; a long test assembles in about 0.63 s at the
median (0.40 s before, when agreement pruned the search).

## Agent probe (2026-09-30)

`codex` / `gpt-5.6-sol` at effort `high` over the local relay, image channel, `solver-v3`,
`scene-families-v19` as committed that day. Artifacts in `data/attempts/2026-09-30T*`.

| Arm | Items | Right | Notes |
|---|---|---|---|
| Public long-test items, question shown (seed `probe-v19`) | 90 | 76% (68/90); 82% of the 83 answered | 7 timeouts: 5 at the 300 s limit (4 of them `combining-machine-v1`), 2 spanning a laptop suspend |
| Same 90 items, options only (`--channel options-only`) | 90 | 13% (12/90) | chance is 16.7%; no shortcut detected (95% interval about 6–20%) |
| Held-out composed programs (seed `probe-v19-held-out`) | 40 | 95% (38/40) | the transfer split is not hard for this model |

The options-only arm is the answer to this plan's question: a frontier model shown only the
six options does no better than a blind guess. Where the question is shown, the families it
got wrong most often when it answered were `second-order-sequence-v2` (9 of 14),
`compositional-analogy-v2` (5 of 8) and `attribute-pairing-v1` (6 of 9, a warmup family);
`combining-machine-v1` answered only 2 of 6 inside 300 s, both right. None of these numbers
pool with the v10/v11 probes: the model, provider and effort all differ.

## One clue is never enough (2026-10-03, `scene-families-v21`)

The owner's report: "The options to select should be very close to the correct answer. You
should never be able to guess this answer through them or with 1 out of x clues needed to
solve a test."

**What was measured under `v20`** (200 items per served bucket). Options alone were near
chance (worst strategy 25.6%), but one clue alone often finished the item:

| Bucket | One whole-board clue picks the answer | One shape's clue picks it |
|---|---|---|
| relational-matrix-d4 | 31% | 55% |
| relational-sequence-d2 | 22% | 22% |
| spatial-transform-d2 | 20% | 30% |
| combining-machine-d4 / d5 | 20% / 19% | 4% / 3% |
| visual-set-algebra-d4 / d5 | 19% / 18% | 61% / 34% |
| transformation-machine-d5 | 19% | 0% |
| compositional-analogy-d3 / d4 | 14% / 17% | 12% / 15% |
| inverse-analogy-d4 | 16% | 16% |
| composed-transform-d4 / d5 | 0% / 1% | 66% / 37% |
| attribute-pairing-d2 | 0% | 50% |

That was the trade-off above: the one-inference solver was only a cost in the option game,
because a hard agreement rule made the answer the one option that always shared everything.

**The rule.** Every clue any option shows appears on at least two options
(`optionsAloneOnAClue` in `src/items/blind-options.ts`). It holds for every option, not only
the answer, which is what keeps it from feeding the options-only strategies: no option is
ever alone on a clue, so "rule out the options alone on a clue" has nothing to rule out.
`selectDistractors` serves only lists that meet it and throws `CluesNotSharedError` when none
exists; a family that draws its inputs can catch that and draw again.

**What one clue is** depends on how the family's rule acts on a board
(`SCENE_FAMILY_CLUE_MODELS` in `src/items/scene-families.ts`):

- `features`, for rules made of separate changes (moves, fill steps, turns, copies): each
  whole-board aspect (where the shapes stand, which shapes, which fills, which turns, how
  many), and the square, fill and turn of every shape each option holds exactly once ("the
  triangle ends up black"). A shape some option lacks or doubles is itself part of what the
  rule decides, so it is not followed on its own.
- `squares`, for the relational matrix and the combining machine, which combine boards square
  by square: what stands on each square. There one square is the smallest thing a solver works
  out alone, and every whole-board aspect takes all of them. Measured, no option list in any
  of 100 combining-machine items could share every aspect, so `features` would have shut the
  family out for a rule its clues do not have.
- `whole-rule`, for the second-order sequence: its whole rule is one clue (where the token
  lands), so knowing it is solving it. Kept as is (owner's decision, 2026-10-03).

**What changed to make every bucket meet it** (owner's decision: rebuild the families that
could not, rather than withdraw them or redraw blindly):

- With the first `features` definition (every shape followed, whether or not every option
  held it), attribute pairing could never meet the rule: its shape is one of the three things
  the rule decides. Following only shapes every option holds once fixed it.
- The relational matrix and the combining machine moved to `squares` (0% and 31% of items
  met the rule under `features`; 100% under `squares`).
- The transformation machine no longer has to offer the run that stops before its
  duplication gate: with it required, three items in four had no list that shared every
  clue; without it, every item does. It still competes like any other near miss.
- Set algebra d4 redraws its inputs when no list shares every clue (about one draw in
  twelve), after the cheap aspect-cover check, so the draws that already worked keep their
  stems.
- The one-inference cost left the option game: under the hard rule it never finishes an
  item, and under `squares` it read aspects that are not single clues, which pushed
  relational-matrix-d4's exclude-lone-aspect strategy to 31.8%.
- The search prunes a partial list once some clue has more lone values than slots left.
  This skips only lists the rule refuses, so it changes the cost, not the result; without it
  three searches in the test sweep ran out of budget.

**Result** (`npm run families:verify`, 200 items per bucket): one clue picks out an option in
0 items of every bucket except the exempt second-order sequence. The worst options-only
strategy is 22.4% (set-algebra d4) against 25.6% before; most buckets sit at 17–21%. Wrong
options stay as close as before: on average 0.7–1.9 of the five aspects differ from the
answer in the `features` buckets, and about 2 of 4 role squares in the `squares` buckets.
A long test assembles in about 0.56 s at the median. Stems and answers did not change, only
options, except in the redrawn set-algebra draws; the `v20` and `v21` populations must not be
pooled.

## What is left

- Nothing gated. A fresh agent probe is needed before quoting agent numbers: `solver-v4`
  changed the image on 2026-10-03 and `v21` changed the options.
