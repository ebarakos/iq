# The answer must not be guessable from the options alone

Status: **built 2026-09-29 as `scene-families-v19`.** The work items are in
[TODO.md](../../TODO.md) under "the answer must not be guessable from the options alone";
the decisions, results and what is left are at the end of this file.

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

## What is left

- Nothing gated. The agent probe (`TODO.md`) is the next evidence.
