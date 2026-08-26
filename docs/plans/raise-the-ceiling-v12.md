# Raise the ceiling: a d6 tier for the tail

Owner direction, 2026-08-26, after the v11 pilot passed its escalation test:
"I like hard tests, the harder the better. And even more hard than these would be
good towards the end." The v11 battery tops out at difficulty 5 and the
participant solved five of its six d5 items. This plan adds a tier above it.

Companion decision the same day: `containment-analogy-v2` is withdrawn on human
evidence (the one notation-misunderstanding report, and the only family that draws
a token inside another shape). That withdrawal and this tier ship together as
`scene-families-v12`, so the population bumps once.

## What "harder at the end" has to mean

The long test is ordered easiest-first and its last band is `induction-transfer`.
A deeper bucket placed anywhere else would still be answered before that band, so
**every d6 bucket lives in `induction-transfer`**. Within the band, slot difficulty
already orders occurrences, so a family drawn twice serves d5 and then d6, and the
final questions of a 30-question test are the deepest the battery can generate.

Difficulty stays an honest claim about structure, never about clutter or size: a
d6 item is harder because its program has more steps that each change the answer,
not because anything is smaller or busier. The legibility floors do not move.

## The d6 buckets

Each extends a family already in `induction-transfer` and already proven at d5.

- **`composed-transform-d6` — five ordered gates.** Extends the depth-generic
  composer from four gates to five. The machine table grows from 15 panels to 18
  (five worked rows plus the query row); both render paths already wrap, and the
  1×5 gate strip must fit the 261px a 375px phone has, or the glyph size drops the
  way the four-gate strip already does. Every existing rule carries over
  unchanged: distinct primitives, not all board moves, at most one turn, and
  **single-gate ablation** — a program whose answer survives deleting any one gate
  is not servable. The public/held-out partition extends to depth five and must be
  re-proved exhaustive, disjoint, and leak-free.
- **`transformation-machine-d6` — four worked gates.** The family demonstrates
  gates separately and applies them along the query path; d5 shows three, d6 shows
  four. Same ablation requirement.
- **`inverse-fold-punch-d6` — attempted, then dropped (2026-08-26).** The plan
  wanted three creases. `SceneSchema` allows a board at most two guides, and on a
  3-wide board a second fold on the same axis is a mirror about the same centre
  line, so a three-crease program cannot be drawn at all — a test now proves the
  schema refuses the third guide. Built instead as two-crease-only, it was
  withdrawn the same day: d5 already draws from the whole eight-program grammar,
  including those same four two-crease programs, so the bucket produced nothing
  d5 could not and only dropped the easy half of an existing draw. Going deeper
  needs a bigger board, which collides with the 24px legibility floor at 375px.
  The d6 tail is therefore two buckets, not three.

`fold-punch-v2` is deliberately NOT deepened: it sits in `constraint-spatial`, so a
d6 there would be answered before the final band and would not serve the intent.

## Schema and range

`difficulty` is capped at 5 in three places in `src/items/schema.ts`, and
`bucketDifficulty` parses `-d([1-5])$`. Both widen to 6. The legacy compact-cell
generators (`procedural-v1..v3`) never emit above 5 and a test must pin that, so
widening the range cannot silently loosen what the old golden-seed paths produce.

## Pools, floors, and the withdrawal

Withdrawing `containment-analogy-v2` leaves 19 enabled family/band/bucket keys and
drops `constraint-spatial` from four families to three — exactly its draw size, so
that band loses its subsampling variety. The two d6 buckets bring the battery to
21 keys and give `induction-transfer` a genuine d5→d6 ramp. Floors stay as the v11
fallback branch set them except where the count forces a change; the 10,000-seed
acceptance test must still hold, with one added target: **every long-30 test ends
on a d6 item**, and the last two bands still carry at least six items at d5 or
deeper.

### How the tail is guaranteed (decided 2026-08-26, while implementing)

Ordering was never the problem. Slot difficulty already put a d6 item last
whenever the test had one — measured over 10,000 seeds, no schedule ever held a
d6 item anywhere but its final positions. Availability was: only 8,289 of 10,000
long tests contained a d6 item at all, because `induction-transfer` asks five
questions of three drawn families, the base share is therefore one question each,
and a family reaches its d6 bucket only on a second occurrence. Which two of the
three families got the band's two leftover questions was a coin toss.

The fix is one rule in `evenSplit`: **a band's leftover questions go first to the
families whose next occurrence reaches a bucket the base share never would**, and
only then to everyone else, shuffled as before. In `induction-transfer` those are
exactly the two d6 families, and both leftovers are enough for however many of
them a draw contains. Every draw of three from that pool of four contains at
least one, because only two of the four lack a d6 bucket. Measured: 10,000 of
10,000 long tests now end on a d6 item, and the d6 items are always the last
questions asked — position 30 in every test, and position 29 as well in the
5,035 tests that hold two of them.

Alternatives rejected: reserving the final slot (a special case in the ordering
rule that would have to know about "the deepest bucket", and a second place where
band order is decided), and forcing a d6 family into the draw (unnecessary — the
pool already guarantees it, and it would have narrowed the draw).

What it costs, stated in numbers rather than in principle:

- **Family draw variety in `induction-transfer` is untouched.** All four subsets
  of three still come up about a quarter of the time each (2,552 / 2,486 / 2,483
  / 2,479 over 10,000 seeds).
- **The last question is now always one of two mechanisms** — `composed-transform-v2`
  50.29% and `transformation-machine-v3` 49.71%. It is not the same family every
  time, which was the condition for shipping this without asking the owner, but
  the tail is narrower than it was: previously the final item was one of four
  families and 17% of the time it was only d5.
- **Which family repeats inside the band is no longer random.** The two d6
  families now always take the two repeats, so `rule-switching-v2` and
  `inverse-fold-punch-v2` are asked exactly once whenever they are drawn.
- **The mean number of analogy-layout questions in a long test falls** from
  115/12 = 9.5833 to 28/3 = 9.3333 (measured 9.3383), because
  `inverse-fold-punch-v2` — the one analogy family in that pool — no longer
  competes for the leftovers. Still under the 10.0 cap.

The rule is deliberately general and deliberately narrow: it changes an
allocation only where a drawn family has more validated buckets in a band than
the base share already gives it, and `long-30 induction-transfer` is the only
band in the battery where that is true today. A test walks all eight
profile/band pairs and asserts exactly that, so a future pool change that starts
biasing another band's split fails loudly.

## Verification

Per bucket: uniqueness within the declared grammar, five witnessed near misses
through the closeness window, the eight-point acceptance contract, the diversity
gate on the family's bucket union, a 375px render check in both paths, and the
`families:verify` distance gates with no regression on any comparable key.

Then the full local gate, a single bump to `scene-families-v12`, a bank rebuild
keyed by family/band/bucket, and a fresh pilot packet covering all 21 keys.

A withdrawal also has to leave the `families:verify` distance fixture usable.
`data/fixtures/scene-distance-v10.json` had a baseline row for
`containment-analogy-v2`, and a run that no longer measures that key failed the
gate outright. The row is not deleted — deleting it would make the gate green by
forgetting what the key measured. It moves to a `withdrawnKeys` object with the
date and the reason, the no-regression comparison keeps running over the twelve
keys that are still comparable, and the verifier now fails if a key is listed in
both places or if a key recorded as withdrawn is served again.

## Success test, stated so it can fail

On the next sitting: **at least one clean miss among the two d6 items, and no
notation-misunderstanding report on any of them.** A d6 item that is missed with a
notation report is not hard, it is unreadable, and it is withdrawn like any other.
If both d6 items are solved cleanly and quickly, the ceiling is still too low
and the answer is more program depth, not more decoration.

## Out of scope

Combining two families' rules in one item (rejected 2026-08-26: composed rules
across families are the easiest route to an ambiguous item and the uniqueness
proof is far harder). New shapes, new fills, new bands, changes to the 5/10/10/5
schedule, scoring, or the timer.
