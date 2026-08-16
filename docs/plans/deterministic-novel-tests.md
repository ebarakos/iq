# Deterministic novel tests

Status: **design decided 2026-08-13; core generator implemented**. The current
reliability and reasoning-depth pass lives in [TODO.md](../../TODO.md).

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

The first deeper puzzle family is **visual operator induction**. It shows
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
   the quiz and the static regression corpus. This is the current runtime
   baseline.
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

## Expanded 12-question test architecture

The next test profile is a fixed 12-question assessment. It is a design target,
not a description of the current five-question generator. Its shape is part of
the versioned generation contract: a generator version may change the families
or their weights, but it must not silently change the number or order of bands.

### Presentation contract

The solving screen shows only the visual evidence and answer options. It must
not name the family, describe the hidden relationship, or provide a
puzzle-specific instruction. Every item shows at least two worked scenes or
stages so the relationship is learned from a sequence rather than inferred from
one unexplained board. After the full test is submitted, the review shows a rich
plain-language explanation of the evidence, operations, and answer.

Difficulty must rise across the test. The development preview uses 12 distinct
families, does not decrease from difficulty 2 through 5, and reserves the last
questions for rule switching and composed visible transformations. It remains
development-only until the human-solvability gate and representative fallback
bank are complete.

### Four fixed difficulty bands

| Positions | Band | Item count | What the band tests | Intended time |
|---|---|---:|---|---:|
| 1–2 | Relational warmup | 2 | Notice one clear relation and apply it without hidden notation. | 2 minutes |
| 3–6 | Composition | 4 | Combine, reverse, or interleave two demonstrated relations or transformations. | 6 minutes |
| 7–10 | Constraint or spatial reasoning | 4 | Satisfy interacting board, set, geometry, or connectivity constraints. | 8 minutes |
| 11–12 | Induction or transfer | 2 | Infer a demonstrated system or carry the same structure into a changed representation. | 4 minutes |

The maximum intended completion time is **20 minutes**. This is a design budget,
not an automatic failure deadline: the product records elapsed time and still
accepts a later submission. Pilot data must show that a representative user can
normally complete the full profile within the budget. If a band consistently
exceeds its share, simplify or remove its families instead of extending the test
or making the visuals denser.

Difficulty comes from the reasoning operation, not from smaller marks, more
answer choices, unexplained symbols, or a larger board. Each item carries one
primary reasoning-family tag matching its band and may carry secondary tags for
diagnostics. The primary tag owns its score so one item is never counted twice.

### Family eligibility by band

This table defines where a family may appear after it passes the correctness and
human-solvability gates below. A blank means that the family is not eligible for
that band, even if its generator could produce an item at a superficially similar
difficulty.

| Family or query mode | Warmup | Composition | Constraint / spatial | Induction / transfer |
|---|:---:|:---:|:---:|:---:|
| Simple first-order sequence | yes |  |  |  |
| Interleaved or relational sequence | yes | yes |  |  |
| Simple property outlier | yes |  |  |  |
| Relational outlier | yes | yes |  |  |
| Compositional or inverse analogy |  | yes |  | yes |
| Relational matrix |  | yes | yes |  |
| Visual set algebra |  | yes | yes |  |
| Constraint mosaic |  |  | yes |  |
| Topology or path completion |  |  | yes |  |
| Transformation machine |  | yes |  | yes |
| Fold, punch, reflection, or rotation |  |  | yes | yes |
| Visual concept induction |  |  |  | yes |
| Minimal repair |  |  | yes |  |
| Rule switching or rule transfer |  |  |  | yes |

The current modular visual-operator family is not eligible for this expanded
profile. Its hidden shape indexes and parity conditions are implementation
conventions rather than visibly learned operations. The transformation-machine
replacement becomes eligible only after its gates pass; until then, the
expanded profile remains unavailable rather than filling its final band with a
weaker substitute.

An eligibility registry is the single assembly input. Each entry contains a
versioned family id, allowed bands, primary reasoning-family tag, enabled status,
validated difficulty buckets, per-item time budget, and fallback availability.
Changing any of these generation semantics requires a new generator version.

### Deterministic assembly and coverage

`generateQuiz(seed, generatorVersion, expandedProfile)` must reproduce the same
canonical 12 items, option order, and family order on every machine. Assembly
uses stable child seeds for the schedule, each slot, candidate retries, and
option shuffling. One family's rejection count must therefore not perturb later
questions.

Assembly happens in this order:

1. Filter the registry to families enabled for each band and difficulty bucket.
2. Use the schedule child seed to choose all 12 family ids before generating any
   item.
3. Enforce the band counts and coverage rules on that schedule.
4. Generate each slot from its own child seed with a bounded retry budget.
5. Reject duplicate program fingerprints, duplicate visual fingerprints, and
   adjacent items with the same family or rule structure.
6. Shuffle choices from an item-specific child seed after the canonical answer
   is fixed.

Every generated test must satisfy all of these coverage rules:

- exactly 2 warmup, 4 composition, 4 constraint/spatial, and 2
  induction/transfer items;
- at least 6 distinct family ids overall;
- no family may supply more than 2 questions;
- the 2 warmups come from different families;
- each four-item middle band contains at least 3 distinct families;
- the 2 induction/transfer items come from different families; and
- adjacent questions may not share a family or canonical rule structure.

The assembler chooses a quota-valid family schedule first; it does not pool all
accepted candidates and take whichever generators finish first. If a selected
family exhausts its retry budget, use a validated fallback from the same family
and band. If none exists, fail the expanded-profile request visibly. Do not
silently substitute a more permissive family or return a narrower test. The
emergency bank must obey the same band and coverage contract.

### Scoring and reporting

The canonical overall score is the number correct out of 12. Also report the
four band subtotals and one `correct / attempted` subtotal for every primary
reasoning family present in that test. Family results are meaningful even when
the denominator is small, but they are descriptive and must not be presented as
a standardized IQ subscore. Elapsed time is reported overall and by band; it
does not change correctness.

Human and agent results remain separate datasets and separate result views:

- human results record correctness, elapsed time, band, family, generator
  bucket, and anonymous pilot or attempt cohort;
- agent results record those fields plus model, prompt version, input channel,
  attempt budget, latency, and cost; and
- image and symbolic agent runs remain separate conditions.

Do not pool human and agent accuracy, normalize one population against the
other, or collapse family results into one claimed IQ number. Comparisons use
the same generator buckets and report the human–agent gap per reasoning family
as well as overall.

## Shared correctness contract for every family

A family may enter the eligibility registry only when every served candidate
satisfies the same contract:

1. **Seeded replay.** A versioned generator and seed reproduce the canonical
   item, including its hidden rule, answer, and unshuffled choices.
2. **Pure-code meaning.** A bounded rule, transformation, constraint system, or
   geometry program defines every meaningful visual element. An LLM never owns
   ground truth.
3. **Mechanical derivation.** Pure code derives the answer from that program;
   it does not trust an authored answer index or explanation.
4. **Complete uniqueness check.** Exhaustive enumeration, a complete bounded
   solver, or an equivalent proof keeps only candidates for which every allowed
   interpretation consistent with the evidence predicts the same visible
   answer.
5. **Witnessed distractors.** Every wrong choice is the prediction of a concrete
   failed rule, omitted step, reversed operation, or violated constraint. Tests
   retain the failure witness.
6. **Visual integrity.** Choices are distinct in rendered meaning, no two
   choices render identically, meaningful cues are visible at normal desktop and
   mobile sizes, and decorative or unused cues are rejected.
7. **Shared presentation.** Human and image-agent renderers expose the same
   information. The public puzzle omits answers, rules, explanations, seeds, and
   other ground-truth fields; scoring remains server-side.
8. **Invariant sweep.** A many-seed local sweep covers every enabled family and
   bucket, proves bounded generation, replays exact output, and rechecks the
   preceding invariants.

A code-valid family is still only a candidate. Mechanical uniqueness proves the
answer within the declared grammar; it does not prove that a person can discover
the notation or that another human interpretation is unreasonable.

## Human-solvability promotion gate

Families move through four states: **prototype → code-valid → pilot → enabled**.
Only `enabled` family/band pairs may enter the expanded profile. Promotion is per
band because a clear introductory form does not establish that a denser or
composed form is readable.

For an initial pilot, prepare at least three representative items from every
band in which the family seeks eligibility. Each item is attempted by at least
eight people without the hidden rule or answer. Include both desktop and mobile
attempts for any family whose spatial layout changes between those viewports.
Immediately after answering and before revealing the rule, ask the participant
to explain the relationship or constraint in plain language and to mark any
symbol or visual distinction they did not understand.

Promote a family/band pair only when all of the following hold:

- every pilot item still passes the shared correctness contract;
- at least 75% of attempts describe the intended relationship, allowing plain
  wording rather than implementation terms;
- no more than 20% of attempts report misunderstanding the notation, encoding,
  or a required visual distinction;
- no repeated alternative interpretation produces a different defensible
  answer; any such interpretation returns the family to correctness design;
- median solve time fits the band's per-item budget: 1 minute for warmup, 90
  seconds for composition, and 2 minutes for constraint/spatial or
  induction/transfer; and
- the observed ordering supports the intended curve: the promoted warmup bucket
  is easier and faster than the family's later promoted bucket. Do not infer a
  curve from provisional generator complexity alone.

Wrong answers caused by an understood but difficult rule are calibration data.
Wrong answers caused by hidden numeric encodings, unfamiliar conventions,
ambiguous diagrams, or details that disappear at normal size fail the gate.
Store only aggregate results by versioned family and difficulty bucket. After a
material renderer, notation, or rule-grammar change, return the affected pair to
`pilot` and repeat the gate.

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

### Development-only LLM proposal experiment

The optional experiment lets a model propose only a program in a strict,
bounded, versioned grammar. Pure code constructs the visuals, derives the
answer, enumerates competing rules, and verifies every distractor. Each proposal
gets at most two attempts with an eight-second timeout; provenance, token use,
acceptance, latency, and deterministic fallback are recorded.

Compare its cost, visual variety, rule-structure novelty, and human pilot quality
with direct procedural sampling. Do not put it in the normal test path unless it
adds meaningful validated variety that deterministic generation cannot provide
more cheaply and reliably. The runner is built, but relay measurements and
human pilot results have not yet been collected.

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
