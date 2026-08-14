# Deterministic novel tests

Status: **design decided 2026-08-13**. Implementation tasks live in
[TODO.md](../../TODO.md) under the matching dated heading.

This plan supersedes the earlier choice to use an LLM as a live item writer. The
existing rule validator, renderer, item bank, and agent harness remain useful.

## Decision

Generate every test with deterministic code from a fresh random seed. Do not call
an LLM to write puzzles in the user request path.

Use LLM calls for three jobs only:

1. An agent takes a generated test through the same visual channel as a human.
2. A fixed panel of vision models calibrates generator families and difficulty
   buckets offline.
3. During design work, models may suggest candidate rules or find confusing
   items. Pure code still defines the rule, derives the answer, and decides
   whether an item is valid.

The first deeper puzzle family will be **visual operator induction**. It shows
several worked visual examples of the same hidden operation, followed by a new
input pair and a missing output. The test-taker must infer the operation and
apply it. This reuses the existing cell vocabulary and renderer while adding the
kind of compositional and contextual reasoning that the current step/cycle
puzzles lack.

Do not add animations, interactive worlds, a public leaderboard, or several new
puzzle formats in this phase. They add surface area without first proving that
the core generated reasoning task is meaningful.

## Why this changes the current direction

The project already has the right correctness foundation:

- the procedural generator is seeded and correct by construction;
- `checkRule` derives answers instead of trusting an author;
- item fingerprints catch exact duplicates;
- humans and vision models can receive the same rendered puzzle.

The weak point is not exact-item variety. A local sample of 8,000 current
procedural items produced 7,860 distinct visual fingerprints. The weak point is
reasoning depth: the only calibrated vision model solved 87.7% overall and 100%
of all matrices, including difficulty 5. The current generator varies surface
attributes well, but most hidden programs are still one or two independent
step/cycle transforms.

The committed 60-item bank also cannot support a strong "unseen" claim after it
is public. It should become a regression and reference corpus, not the normal
source of tests.

## What “novel” can honestly mean

Novelty has three separate levels:

1. **Fresh instance.** A 128-bit seed is created after the model weights are
   fixed. It produces a new visual instance, checked against the other items in
   the quiz and the static regression corpus. This is the next implementation
   target.
2. **Fresh composition.** The item combines known primitives in a program and
   parameter arrangement not present in the reference corpus. The generator
   records a canonical program fingerprint so this can be measured.
3. **Held-out family.** A private evaluation family uses a rule structure that
   was not present in public practice items. This is the strongest test of
   transfer, but it requires private server configuration, human calibration,
   and careful rotation. Build it only after the public generator is useful.

Fresh generation makes exact training-set memorization implausible; it does not
prove that a model “thought.” A solver may still know the rule family, search the
small hypothesis space, or exploit a shortcut. Report accuracy together with
attempt count, time, and model cost, and keep the claim to “performance on fresh
generated instances.”

## Runtime contract

`generateQuiz(seed, generatorVersion, profile)` is a pure function. The same
inputs reproduce the same canonical quiz on any machine. The production route
creates the seed with a cryptographically secure random source; the seeded PRNG
is used only after that point so tests and replays stay deterministic.

Every item records:

- `generatorVersion` — changes whenever generation semantics change;
- `seed` or a server-safe derived identifier;
- `familyId` — the rule family, such as `operator-induction-v1`;
- `programFingerprint` — canonical hidden program identity;
- a feature vector used for provisional difficulty;
- the existing visual fingerprint.

The pre-answer API must not return `answerIndex`, `rule`, `explanation`, seed, or
other ground-truth fields. It returns only the rendered/public puzzle plus an
opaque server token. Submission is scored server-side by regenerating or
unsealing the canonical quiz. This matters for agents: an API benchmark that
sends the answer in its JSON is not a benchmark.

The deterministic generator becomes the default and fresh path. The static bank
stays as a regression suite and emergency fallback. It is not described as a
fresh test.

## Visual operator induction v1

Each item contains three to five worked rows and one query row:

```text
(left cell, right cell)  →  output cell
(left cell, right cell)  →  output cell
(left cell, right cell)  →  output cell
(left cell, right cell)  →  ?
```

There is no prose beyond the fixed instruction. All rows use the same hidden
program. The first version keeps the current `Cell` vocabulary so this deepens
the reasoning system without also replacing the visual system.

The bounded program grammar should contain only operators that remain clear in
the existing visuals:

- select a dimension from the left or right input;
- combine ordered values with modular add or difference;
- choose between two operations using an equality or parity condition;
- compose two primitive operations;
- use an explicit per-item shape cycle instead of a global shape order.

The grammar is deliberately small and enumerable. Do not add an operator until
the generator, mechanical solver, and renderer can all share its exact meaning.

### Uniqueness oracle

Correct-by-construction is necessary but not enough. A puzzle can follow its
declared rule while still admitting another reasonable answer. For every
candidate item:

1. Enumerate all programs allowed by that family and complexity budget.
2. Keep only programs that explain every worked row.
3. Apply every surviving program to the query.
4. Accept the item only when all survivors predict the same visual answer.
5. Create distractors from near-miss programs that fail at least one worked row.

This proves answer uniqueness within the declared hypothesis space. Human pilots
remain the check for plausible interpretations outside that space.

## Difficulty and calibration

Ephemeral items will rarely receive enough repeated attempts for useful
item-level statistics. Calibrate the **generator bucket**, not the exact item.
A bucket is keyed by generator version, family, program depth, active dimensions,
condition use, number of examples, and distractor strategy.

Before human data exists, bucket difficulty is provisional. Offline agent runs
may identify the frontier, but agent failure is not human difficulty. Once human
attempts are stored, show two separate measurements:

- human solve rate and median time for the bucket;
- agent solve rate, model, prompt version, attempt budget, latency, and cost.

The useful result is their gap. Do not collapse them into one IQ number.

## Offline work versus live calls

| Work | When | LLM involved? |
|---|---|---|
| Generate seed, rule program, examples, answer, and distractors | Live request | No |
| Validate schema, program semantics, legibility, and unique answer | Live request | No |
| Render, score, explain, and replay | Live request | No |
| Let an agent take the test | Live, only when requested | Yes: one solver call per item |
| Calibrate families against a stable model panel | Offline batch | Yes |
| Propose or red-team new rule families | Offline design work | Optional |
| Set ground truth or approve an item | Never | No; pure code owns this |

This split gives the normal human path instant, cheap, reproducible tests. Model
spend measures agents instead of subsidizing puzzle authorship.

## Evaluation protocol

- Render exactly the same public puzzle for both audiences. Symbolic JSON stays
  diagnostic and is never pooled with image results.
- Shuffle answer positions independently while keeping the canonical answer.
- Give an agent one fixed prompt and one answer attempt per item for headline
  results. Record larger reasoning budgets as different conditions.
- Never tune a generator family against the same private seeds used for its
  reported score.
- Rotate private seeds after exposure to model APIs. A later verified benchmark
  should use provider data-retention controls and held-out families.
- Require a human-solvability gate before calling a family an IQ test rather than
  merely a model trap.

## References informing the decision

- [Addressing the Abstraction and Reasoning Corpus via Procedural Example Generation](https://arxiv.org/abs/2404.07353)
  shows that a fixed transformation can support a much larger procedural instance
  distribution than a small static task set.
- [The ConceptARC Benchmark](https://arxiv.org/abs/2305.07141) argues for testing
  variations of a concept instead of relying on random examples that may reward
  shortcuts.
- [ARC-AGI-2](https://arcprize.org/arc-agi/2) identifies compositional reasoning,
  contextual rule application, and symbolic interpretation as useful frontier
  capabilities and calibrates tasks with both people and agents.
- [ARC Prize testing policy](https://arcprize.org/policy) separates public and
  private tasks and rotates exposed evaluation material; exact procedural
  freshness is useful, but public generation alone is not evaluation security.
