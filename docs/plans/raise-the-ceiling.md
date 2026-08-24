# Raise the ceiling without breaking the floor

Status: **planned 2026-08-23, nothing built.** Direction chosen by the user after
the first human pilots and the first trustworthy agent probes. Parent design:
[deterministic-novel-tests.md](deterministic-novel-tests.md).

## What the evidence actually says

Two independent measurements landed on the same day, and they disagree with the
picture the code had of itself.

**The test has no ceiling.** One participant answered 14 of 15 pilot items
correctly, averaging 36 seconds against a 60-second-per-question budget. The
single miss was a family that turned out to be unreadable, not hard. A battery a
capable adult sweeps has not measured that adult; it has only confirmed the items
are legible.

**The test has a floor, and the floor is real.** On identical items, a strong
vision model scored 82.7% and a weak one 16.0% against a 16.7% guess floor — the
weak model is indistinguishable from guessing, and the strong model ramps
100/90/78 across the difficulty tiers. So the difficulty ladder orders items
correctly. It just stops too early.

**Five families were withdrawn in one day**, four of them because a person could
not tell what the item was asking. Every one had passed the code-correctness
contract. That is the recurring failure of this project, and it is now the third
time it has happened (`topology-path-v1`, `minimal-repair-v1`,
`interleaved-sequence-v2`).

## Lever 1 — make unsoundness machine-detectable

The uniqueness oracle proves that every program in a family's grammar consistent
with the visible evidence predicts the same answer. That is a real guarantee, and
it is not the guarantee anyone assumes. It proves uniqueness **inside the
family's own grammar**, while a human solver does not share that grammar and
cannot see its edges.

`interleaved-sequence-v2` is the clean example. Its row interleaves two strands,
and the strand holding the blank shows two terms — one observed transition — on
every seed. From one transition a solver cannot check that the step repeats, only
assume it. The oracle assumed it too, because its grammar contains only
constant-step rules, so it reported a unique answer on an item that failed in
the field: no human ever attempted it (its pilot packet was never run), and the
strong vision model answered it wrongly four times in five
(`data/pilot/README.md`).

The invariant that catches this is **not** "every rule must be demonstrated
twice". Measuring that first was worth the ten minutes it took: seven of the
fourteen surviving families demonstrate their rule exactly once, and five of
those seven were solved by the pilot in 15 to 60 seconds. They are all the
analogy format — A is to B as C is to what — where the single worked pair *is*
the definition of the rule. The format announces what to look for, so one
demonstration is honest.

The narrower, correct rule:

> When a solver must **extrapolate a step** — a sequence strand, a repeated
> transformation, anything where the rule is "keep going" — the strand must show
> at least three terms, so the step is observed at least twice.

Analogies are exempt by construction: they do not extrapolate, they apply once.

Work:

- Add the check to `scripts/scene-family-verify.ts` so it fails at build time,
  next to the fingerprint-diversity gate. Sequence layouts only.
- Re-check every family against it and record the result here.
- Consider whether a second, softer signal is worth having: for each family, the
  count of visible transitions the solver may verify. A family at one is not
  automatically wrong, but it should be looked at by a person before it ships.

## Lever 2 — build a genuinely hard end

Nothing here should make items harder to *see*. The legibility doctrine is not
negotiable and has already withdrawn one family for breaking it.

Two candidates, cheapest first:

**Deeper compositions.** `composed-transform-v1` composes two visible primitives
in a fixed order and is already the family the strong model most often fails to
finish. Extend the composer to three ordered steps within the same complexity
budget and the same enumeration oracle. The near misses come free — wrong order
is now five wrong orders instead of one.

**Held-out combinations.** Expose every primitive separately in the public pool,
but reserve some *combinations* of them for a private evaluation set. This tests
whether a solver recombines known operations or recognises a practised family
procedure, and it is a much cheaper bridge to the held-out-family idea in the
parent plan. Captured earlier in `BRAINSTORM.md` under high-value measurement
ideas; this is the promotion of that entry.

Scoped design (do this only after the three-step extension, which grows the
space worth splitting):

- *The split.* `enumerateSceneOrderedCompositions()` in `src/items/scene-grammar.ts`
  is the whole combination space. Add one pure function that partitions it into
  a public list and a held-out list by a fixed rule written in code (not by
  seed), chosen so every primitive still appears in several public combinations.
  The rule is committed and deterministic, so both halves are reproducible.
- *The boundary.* The public assembler and the emergency bank draw only from the
  public list. The held-out list is consumed only by the agent harness
  (`scripts/agent-run.ts`) and a future private pilot packet — never by
  `assembleExpandedQuiz`, so no public test and no banked item can serve one.
  Secrecy from repo readers is not the goal; solvers only ever see served items.
- *The leakage check.* A test generates the public pool across many seeds plus
  the committed bank and asserts no item's program matches a held-out
  combination. It fails the build, next to the other family gates.
- *The measurement.* Same solver, same primitives, public vs held-out accuracy.
  A gap says the solver learned the practised procedure, not the operations.

The success test is explicit: **a capable adult should not sweep the hard band.**
If the next pilot again scores 14 of 15 at 36 seconds, this lever has not worked,
whatever the item count says.

## Lever 3 — restore format diversity

Withdrawals removed every odd-one-out item. Measured over 10,000 generated
30-question schedules, a test now averages about 14 analogy, 12 matrix (7 grid,
5 machine-table), and 4 sequence items, drawn from the 14 eligible families.
`constraint-spatial` and `induction-transfer` are both down to three families —
exactly their subsample size, so every long test uses all six, and half the test
(the 15 questions of those two bands) always comes from those six families, with
each `constraint-spatial` family appearing three or four times.

Two separate problems, and the second is the one that matters:

- **No odd-one-out format.** All three that existed were withdrawn for showing no
  worked evidence. A sound version has to demonstrate the shared property rather
  than expecting it to be guessed — which is the same requirement as lever 1, so
  design it after that check exists.
- **Thin bands.** Either move a family down from `composition` (six families for
  ten questions, the only comfortable band) or accept the repetition and say so
  in the product copy. This changes the difficulty ladder, so it was the user's
  call — and on 2026-08-24 the user decided to move a family down. Which family
  moves is proposed with difficulty evidence at implementation time; the move
  needs a validated bucket at the new band and a bump to `scene-families-v9`.

## What this plan does not do

- It does not add new visual vocabulary. Variety comes from rules, as before.
- It does not touch scoring, tokens, the pooled timer, or the band schedule.
- It does not treat one participant's results as calibration. Nothing here
  assumes a difficulty number; the pilot is a retention gate until there are
  other participants.
