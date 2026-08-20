# Mechanism variety

Status: **implemented locally 2026-08-19; external agent probes still need explicit approval.**
The shipped levers are per-test family subsampling, rule grammars inside families,
and a composition engine. The LLM rule-proposal path stays parked. Parent design:
[deterministic-novel-tests.md](deterministic-novel-tests.md), whose "What
novel can honestly mean" section names the target: this plan implements its
level 2, **fresh composition**.

## The problem, measured

A repeat taker faces the same methods every time:

- 13 of the 18 scene families emit **exactly one** program fingerprint across
  every seed (measured over 200 seeds per family, 2026-08-18). A fresh test
  reshuffles shapes; the hidden rule per family never changes.
- Every test draws from all eligible families with even coverage, so two
  consecutive tests contain nearly the same family list in the same band order.
- The warmup band has only two families, so every test opens the same way.

The same shallowness shows on the agent side: after withdrawal of
`topology-path-v1`, a flash-tier vision model solves 100% of every eligible
family. One fixed rule per family is learnable by people and trivial for
models; a deep program space is the shared fix.

## Lever 1 — per-test family subsampling (small, first)

Each test seeds a per-band draw of families instead of always using the whole
pool, so consecutive tests differ visibly. Contract changes, all inside
`assembleExpandedQuiz`:

- Warmup keeps its whole pool (it is too thin to subsample).
- Composition and constraint/spatial draw 4 of their eligible families per
  test; induction/transfer draws 3.
- The even-split and no-adjacent-repeat rules run on the drawn subset.
- Minimum-distinct-family and minimum-eligible-pool checks keep their current
  values, so withdrawals still fail loudly rather than thinning a test.
- Generator version bumps (subsampling changes which items a seed produces).

This is perceived variety only — the mechanism pool is unchanged — so it is a
stopgap that buys time for lever 2, not a substitute for it.

## Lever 2 — rule grammars inside families (the core)

A family stops being one hardcoded rule and becomes a **format plus an
enumerable program grammar**. Each generated item samples a program from the
grammar; the uniqueness oracle already used by `transformation-machine-v2` and
`rule-switching-v1` generalizes: enumerate every program in the family's
grammar, keep those consistent with all visible evidence, and accept the item
only when every survivor predicts the same answer. Distractors come from
near-miss programs that fail at least one visible example.

The older `procedural-v1..v3` generator (`src/items/rules.ts`) already contains
a bounded rule DSL with exactly this oracle — the scene families never used it.
Reuse its idea, not necessarily its code.

Acceptance per converted family, enforced by `scripts/scene-family-verify.ts`:

- at least **8 distinct program fingerprints** across 200 seeds (the probe that
  exposed the problem becomes the regression test);
- every item still passes the shared correctness contract and the legibility
  doctrine — difficulty comes from the rule, never from visual subtlety;
- a converted family ships as a new family version (`*-v2`/`-v3`), because its
  rule structure changed; calibration data never pools across the rename.

Conversion order, worst repetition first:

1. **Warmup band** — `relational-sequence-v1`, `relational-outlier-v1`, plus a
   third warmup family (the band's thinness is a known weak spot; fix both at
   once). First impressions repeat the most today.
2. **Sequence families** — `interleaved-sequence-v1`, `second-order-sequence-v1`.
3. **Analogy families** — compositional, containment, inverse.
4. **Board families** — relational-matrix, visual-set-algebra,
   constraint-mosaic, fold/punch pair, spatial-transform, minimal-repair.
5. **Induction families** — widen the already-enumerable grammars of
   transformation-machine, rule-switching, concept-induction.

Each wave ends with an agent probe (`npm run agent:run`, image channel, the
calibrated model pair) so we can watch whether a deeper program space starts
producing items the strong model misses. That is the signal the agent frontier
is refilling.

## Lever 3 — composition engine (after lever 2 starts paying)

Mint mechanisms instead of hand-building them: a bounded set of visible
primitive transforms (rotate, mirror, fill-toggle, size-step, count-step,
position-shift — most already exist in `scene-grammar.ts`), composed in ordered
pairs or guarded by a visible condition. The composer:

1. picks a composition within a complexity budget;
2. renders worked examples that show the composed effect (each primitive must
   be individually visible in at least one example — the legibility doctrine
   applies to every step, not just the result);
3. runs the same enumeration oracle over all compositions in budget; accepts
   only a unique answer;
4. builds distractors from near-miss compositions: wrong order, one step
   omitted, one step inverted.

Ships as a new family (`composed-transform-v1`) in the composition band —
code-valid behind the experimental label like everything else, withdrawable by
the same env list, and the most likely place for agent-hard items to appear.

## What this does not change

- No new item formats, boards, or visual vocabulary — variety comes from rules.
- Scoring, tokens, the deadline, and the band schedule stay as they are.
- The retention gate is unchanged: human pilots still withdraw what confuses
  people, exactly as they withdrew `topology-path-v1`.
