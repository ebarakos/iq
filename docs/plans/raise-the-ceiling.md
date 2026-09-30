# Raise the ceiling without breaking the floor

Status: **built 2026-08-24** (generator `scene-families-v10` after the same-day
pilot), except the success test, which needs the next multi-participant pilot.
The full-battery pilot withdrew both redesigns (`relational-outlier-v3`,
`interleaved-sequence-v3` — see `data/pilot/README.md`); the gate, the
three-step composer, the held-out split, and the band move all survived. Direction chosen by the user after the
first human pilots and the first trustworthy agent probes. Parent design:
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

Work — done 2026-08-24:

- The gate lives in `scripts/scene-family-verify.ts`: every generated candidate
  with a sequence row must declare how many terms of the strand containing the
  blank are visible (`observedTermsInAnsweredStrand` on the candidate), and the
  build fails below three or when the declaration is missing. Odd-one-out rows
  are exempt: their stem is not extrapolated.
- Re-check results: `relational-sequence-v2` shows 3 terms,
  `second-order-sequence-v2` shows 5, and the redesigned
  `interleaved-sequence-v3` shows 3 in the answered strand (its predecessor
  showed 2 and is what the gate exists to block). Every other family uses a
  non-extrapolating layout. All 21 code-valid families pass.
- The softer signal exists as the declared count itself: it is printed per
  family in the verify report, so a person can see exactly how much verifiable
  evidence each sequence family shows before it ships.

## Lever 2 — build a genuinely hard end

Nothing here should make items harder to *see*. The legibility doctrine is not
negotiable and has already withdrawn one family for breaking it.

Two candidates, cheapest first:

**Deeper compositions — done 2026-08-24.** `composed-transform-v1` composed two
visible primitives and was already the family the strong model most often
failed to finish (2/7). It is now `composed-transform-v2`: three ordered steps
from the same six-primitive pool, same worked-row demonstration, same
enumeration oracle over all 96 mixed triples. 64 programs are servable on the
fixed query template; wrong order is now five wrong orders instead of one, and
the verify probe sees 55 distinct programs in 200 seeds. Strong-model evidence
on the three-step version is pending the next agent probe.

**Held-out combinations.** Expose every primitive separately in the public pool,
but reserve some *combinations* of them for a private evaluation set. This tests
whether a solver recombines known operations or recognises a practised family
procedure, and it is a much cheaper bridge to the held-out-family idea in the
parent plan. Captured earlier in `docs/brainstorm.md` under high-value measurement
ideas; this is the promotion of that entry.

Implemented 2026-08-24 exactly as scoped below: the split lives in
`partitionComposedTransformPrograms()` (56 public, 8 held out — every program
that runs both spatial moves before the fill), evaluation harnesses draw
reserved combinations through `generateHeldOutComposedTransformCandidate()`,
and the leakage test in `scene-families.test.ts` proves the public generator
cannot emit a reserved combination while every primitive stays publicly
practised.

The scoped design (kept for the record):

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

- **No odd-one-out format — attempted 2026-08-24, failed its pilot the same
  day.** `relational-outlier-v3` demonstrated the shared relation with three
  example boards and checked well-posedness against stem-consistent relations —
  structurally sound, and the human pilot still answered it wrongly with a
  notation-misunderstanding report (`data/pilot/2026-08-24-pilot-v2-a.json`).
  Withdrawn. The lesson is sharper than lever 1: this format has now failed
  with no evidence (-v2) and with demonstrated evidence (-v3), so the next
  attempt has to change how the examples are *presented*, not just that they
  exist. The battery again has no odd-one-out item.
- **Thin bands — solved 2026-08-24.** The user decided to move a family down,
  and chose `containment-analogy-v2` (strong model 3/7 — the hardest
  non-composed family; d4 bucket matches the band; containment reads as a
  spatial constraint). `constraint-spatial` now draws 3 of 4 families per test,
  so its per-family repetition drops from 3.3 to 2.5 questions. Measured over
  10,000 fresh `v9` schedules, a long test averages about 13 analogy, 10
  matrix, 5 sequence, and 2 demonstrated-outlier items from 16 eligible
  families; the last two bands still always use six distinct families.

## What this plan does not do

- It does not add new visual vocabulary. Variety comes from rules, as before.
- It does not touch scoring, tokens, the pooled timer, or the band schedule.
- It does not treat one participant's results as calibration. Nothing here
  assumes a difficulty number; the pilot is a retention gate until there are
  other participants.
