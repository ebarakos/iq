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
   records a canonical program fingerprint so this can be measured. Achieved
   locally on 2026-08-19: all 19 eligible scene families emit at least eight
   fingerprints across the fixed 200-seed probe, including ordered two-step
   composition. See [mechanism-variety.md](mechanism-variety.md).
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

## Test architecture: two lengths, one ladder

Decided 2026-08-16. The product ships **two test lengths, 5 and 30 questions**,
and no others. The 12-question profile this plan previously described is
withdrawn as a product target; the 12-slot assembler stays in the code only so
that tokens already issued and golden-seed replays keep working.

Both lengths are drawn from the same expanded family pool and use the same four
difficulty bands. The short test is a sample of the long test's curve, not an
easier test: someone who only wants a quick look gets the same kinds of question
in the same rising order.

The 2026-08-16 decisions in full:

- **Two lengths, 5 and 30 questions.** Both are built from the expanded family
  pool. There is no public difficulty selector; length is the only choice.
- **A flat 60 seconds per question.** The budget is one whole-test countdown of
  `60 seconds x question count` — 5 minutes for the short test, 30 minutes for
  the long one — not a per-question timer. A taker may spend the time unevenly.
- **A hard deadline with a grace window and a late marker.** The countdown ends
  the test. "The answer deadline" below fixes the exact rule.
- **Results are a raw score and a reasoning-family breakdown, and nothing else.**
  No IQ number, no percentile, no normalized scale. [`docs/brainstorm.md`](../brainstorm.md) Q8 records
  why an IQ figure is not available to us.
- **Code-valid families ship publicly.** This reverses the earlier rule that a
  family had to pass the human pilot
  before it could appear in a public test. The pilot becomes a **retention
  gate**: a family is public until pilot evidence removes it, instead of private
  until pilot evidence admits it. Withdrawal happens through an environment
  variable holding the excluded family ids, read at request time. On 2026-08-31
  the owner removed the visible experimental label; the retention gate itself
  did not change.

The reason for the reversal is that the pilot needs real takers and the only way
to reach real takers is to ship. The risk it accepts is that a confusing family
is briefly public; the withdrawal list and continuing retention pilot are what
contain that risk.

### Presentation contract

The solving screen shows only the visual evidence and answer options. It must
not name the family, describe the hidden relationship, or provide a
puzzle-specific instruction. One exemption, added 2026-08-19 after a taker met
a visually empty question: an item with no stem (the odd-one-out form, whose
evidence lives in its options) shows one fixed, rule-neutral task line — "All
options but one follow the same hidden rule — pick the one that breaks it." The
line states the task form and never the relationship. Every item shows at least two worked scenes or
stages so the relationship is learned from a sequence rather than inferred from
one unexplained board. After the full test is submitted, the review shows a rich
plain-language explanation of the evidence, operations, and answer.

Difficulty must rise across the test. Within a band the questions run from the
lower to the higher validated difficulty bucket, and no band starts below the
previous band's floor. The ramp is a property of the assembler, not of a
hand-written table of one family per slot.

### Four fixed difficulty bands

| Band | 30-question positions | 5-question positions | What the band tests |
|---|---|---|---|
| Relational warmup | 1–5 | 1 | Notice one clear relation and apply it without hidden notation. |
| Composition | 6–15 | 2 | Combine, reverse, or interleave two demonstrated relations or transformations. |
| Constraint or spatial reasoning | 16–25 | 3–4 | Satisfy interacting board, set, geometry, or connectivity constraints. |
| Induction or transfer | 26–30 | 5 | Infer a demonstrated system or carry the same structure into a changed representation. |

The long schedule is 5 / 10 / 10 / 5; the short schedule is 1 / 1 / 2 / 1. The
short one is not exactly one sixth of the long one, because 5 questions do not
divide into those shares evenly. The spare question goes to constraint and
spatial reasoning, the band that carries the most weight in the long test.

The whole-test budget is 60 seconds per question: **5 minutes** for the short
test and **30 minutes** for the long one. Unlike the earlier 20-minute figure,
this is an enforced deadline rather than only a design target. Pilot data must
show that a representative taker normally finishes inside it. If a band
consistently eats more than its share, simplify or remove its families instead
of extending the test or making the visuals denser.

Difficulty comes from the reasoning operation, not from smaller marks, more
answer choices, unexplained symbols, or a larger board. Each item carries one
primary reasoning-family tag matching its band and may carry secondary tags for
diagnostics. The primary tag owns its score so one item is never counted twice.

### The answer deadline

The deadline is its own value, `answerDeadline`, and it is not the token's
`expiresAt`. They answer two different questions:

| Value | Question it answers | Set to |
|---|---|---|
| `answerDeadline` | Is this submission on time? | `issuedAt + 60 seconds x question count` |
| `expiresAt` | May this token still be opened at all? | `issuedAt + the token lifetime` (2 hours) |

`expiresAt` is always later than `answerDeadline`, and the two must never be
collapsed into one field. A token whose deadline has passed can still be opened
and scored — the deadline decides how the result is marked, the expiry decides
whether the answer key can be read at all. Reusing `expiresAt` as the deadline
would mean a taker could not be told their score after running out of time, and
lengthening the token lifetime would silently lengthen the test.

The deadline is returned in plain form beside the opaque token, so the browser
can show a countdown without reading token contents. It is also sealed inside
the token, and the sealed copy is the one that scoring trusts.

One rule for lateness, used everywhere:

- **The server clock decides.** The countdown in the browser is a display. A
  wrong device clock, a paused tab, or an edited local value cannot buy time.
- **Grace window: 10 seconds.** A submission arriving at or before
  `answerDeadline + 10 seconds` is ordinary. It gets a normal score and carries
  no marker. The window exists to absorb the round trip of the automatic
  submission and small clock differences, and for no other reason.
- **After that, the submission is late, not refused.** It is still scored, and
  the response carries a late marker and the number of whole seconds past the
  deadline. Refusing would throw away a finished test because of a slow network;
  marking keeps the score honest.
- **A late result never enters calibration data.** It is shown to the person who
  took the test and excluded from any human or agent measurement.
- **Running out of time is not a special score.** When the countdown reaches
  zero the browser submits what it has, and unanswered questions count as wrong,
  exactly as they would if the taker had submitted early. That submission
  normally lands inside the grace window.

### Family eligibility by band

This table defines where a family may appear once it passes the shared
correctness contract below. A blank means the family is not eligible for that
band, even if its generator could produce an item at a superficially similar
difficulty. Since 2026-08-16 a code-valid family may be served publicly in an
eligible band before its human pilot; what the pilot decides is whether it stays
(see the retention gate above).

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
| Topology or path completion (withdrawn 2026-08-19: ambiguous by sight) |  |  |  |  |
| Transformation machine |  | yes |  | yes |
| Fold, punch, reflection, or rotation |  |  | yes | yes |
| Visual concept induction |  |  |  | yes |
| Minimal repair |  |  | yes |  |
| Rule switching or rule transfer |  |  |  | yes |

The old modular visual-operator family (`operator-induction-v1`) is not eligible
in any band. Its hidden shape indexes and parity conditions are implementation
conventions rather than visibly learned operations. Its replacement,
`transformation-machine-v2`, shows every gate it applies and is eligible in
induction/transfer. A band whose eligible families all get withdrawn makes the
test length unavailable; the assembler must fail visibly rather than fill the
band with a weaker substitute.

An eligibility registry is the single assembly input. Each entry contains a
versioned family id, allowed bands, primary reasoning-family tag, promotion
state, validated difficulty buckets, per-item time budget, and fallback
availability. Assembly selects a family only in a band it is registered for; it
never remaps a family into a different band. Changing any of these generation
semantics requires a new generator version.

### Deterministic assembly and coverage

`assembleExpandedQuiz(seed, profile, registry)` is a pure function.
`profile` is `long-30` or `short-5`, and the generator version for both is
`scene-families-v6`. The same seed, profile, generator version, and withdrawal
list reproduce the
same items, the same family order, and the same option order on every machine.
Assembly uses stable child seeds for the schedule, each slot, candidate retries,
and option shuffling, so one family's rejection count never perturbs a later
question. The 12-question `scene-families-v2` profile is withdrawn and its
assembler is gone; the `procedural-v1`, `v2`, and `v3` assemblers in
`src/items/generate.ts` stay untouched, because golden-seed replay tests depend
on them.

Assembly happens in this order:

1. Filter the registry to families that are code-valid or better in a band, and
   drop every family id named in the withdrawal list.
2. Use the schedule child seed to choose every family id for the whole test
   before generating any item.
3. Enforce the band counts and coverage rules below on that schedule.
4. Generate each slot from its own child seed with a bounded retry budget.
5. Reject any item that repeats a visible puzzle already in the test, and any
   whose difficulty does not match the bucket it was scheduled from.
6. Shuffle choices from an item-specific child seed after the canonical answer
   is fixed.

A program fingerprint names a family's *rule structure*, not one instance: most
families emit a single fingerprint across every seed. Requiring fingerprints to
be unique across a test would therefore mean "each family at most once", which
30 questions and 18 families cannot satisfy. Uniqueness is enforced on the
visible puzzle instead, and the fingerprint stays what it always was — the
calibration bucket key.

#### Band schedule

| Profile | Warmup | Composition | Constraint / spatial | Induction / transfer | Total |
|---|---:|---:|---:|---:|---:|
| `long-30` | 5 | 10 | 10 | 5 | 30 |
| `short-5` | 1 | 1 | 2 | 1 | 5 |

The counts are part of the generator version. A new version may change them; a
released one may not.

#### Family coverage and repeat caps

Within one band the schedule is **as even as the eligible pool allows**. With `n`
questions in a band and `k` eligible families, every chosen family appears either
`floor(n / k)` or `ceil(n / k)` times. That single rule fixes both the repeat cap
and the distinct-family count, and it keeps working when a withdrawal shrinks the
pool — nothing has to be re-tuned by hand.

What it produces from the 18 currently code-valid families (2 warmup, 6
composition, 6 constraint/spatial, 4 induction/transfer):

| Profile | Band | Questions | Eligible families | Used | Most from one family |
|---|---|---:|---:|---:|---:|
| `long-30` | Warmup | 5 | 2 | 2 | 3 |
| `long-30` | Composition | 10 | 6 | 6 | 2 |
| `long-30` | Constraint / spatial | 10 | 6 | 6 | 2 |
| `long-30` | Induction / transfer | 5 | 4 | 4 | 2 |
| `short-5` | every band | 1 or 2 | 2–6 | 1 or 2 | 1 |

A known thin spot: only two families are currently registered for warmup, so a
`long-30` test fills five warmup questions from two generators whose rule
structure does not vary — three of the five will share a rule with a different
surface. Adding a third warmup family is the fix; until then, the ramp's first
band is the weakest part of the long test.

On top of the even split, every test must satisfy:

- no two questions next to each other share a family id or a canonical rule
  structure, inside a band or across a band boundary;
- a `long-30` test uses at least 12 distinct family ids;
- a `short-5` test uses 5 distinct family ids, one per question; and
- no family supplies more than a fifth of any band, or more than a tenth of a
  `long-30` test.

#### Minimum eligible pool

Withdrawing families must not quietly produce a thinner test. A `long-30` test
requires at least **2 warmup, 4 composition, 4 constraint/spatial, and 3
induction/transfer** families after withdrawals, and at least 12 in total. Below
any of those, the long test is unavailable and the failure is loud: the server
refuses the request and logs which band is short, rather than serving a test
built from three families. A `short-5` test needs one eligible family per band.

#### Measured cost

Measured 2026-09-29 on the development machine on `scene-families-v19` (the 2026-08-18
figures of 18 ms per long test predate the gate machines and the balanced option lists):

| Profile | Seeds | Median | 95th percentile | Slowest | Failed assemblies |
|---|---:|---:|---:|---:|---:|
| `short-5` | 100 | 54 ms | 129 ms | 232 ms | 0 |
| `long-30` | 50 | 321 ms | 434 ms | 502 ms | 0 |

Most of a long test's time goes to choosing balanced option lists (see
[blind-answer-leak.md](blind-answer-leak.md)). A 30-question test is still built well inside
the browser's 20-second start timeout. Generating questions progressively would add a
loading state, a partial-test failure mode, and more token bookkeeping to solve a problem
the measurement says does not exist, so the test is still assembled in one request.

#### When generation fails

The assembler chooses a quota-valid family schedule first; it does not pool all
accepted candidates and take whichever generators finish first. If a selected
family exhausts its retry budget, use a validated fallback from the same family
and band. If none exists, fail the request visibly. Do not silently substitute a
more permissive family or return a shorter test. The emergency bank must obey
the same band schedule and coverage rules.

### Scoring and reporting

The canonical overall score is the raw number correct out of the test length —
out of 5 or out of 30. It is never converted into an IQ number, a percentile, or
any other normalized scale. Also report the four band subtotals and one
`correct / attempted` subtotal for every primary reasoning family present in
that test. Family results are meaningful even when
the denominator is small, but they are descriptive and must not be presented as
a standardized IQ subscore. Elapsed time is reported overall and by band; it
does not change correctness.

Owner-approved leaderboard addition, 2026-10-06: eligible on-time 30-question attempts may
publish a nickname and `round(100 × correct × (1 + 0.25 × fraction of time remaining))`
points. Raw accuracy stays visible; leaderboard points are not a standardized IQ scale.
Each entry records the app version sealed at issue time, elapsed time and submission date.
Local development enables this by default; deployments require `LEADERBOARD_ENABLED=true`.
Each environment keeps a separate ranking. First submissions are saved atomically before
revealing answers, even with the leaderboard disabled; identical retries recover the same
result and changed answers are refused. Publication is also atomic and cannot duplicate a
test or rename its first published entry. Private scoring receipts expire with the token;
published leaderboard entries persist. Older unversioned tokens cannot rank.

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
   retain the failure witness. Every item offers `OPTIONS_PER_ITEM` choices
   (`src/items/schema.ts`), so a family whose rule grammar cannot produce that
   many witnessed near misses has to be widened rather than shipped short.
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
Since the 2026-08-16 retention decision, `code-valid` is enough to be served
publicly, and the gate below decides whether a family/band pair is kept or
withdrawn. The states and thresholds are unchanged; only what a failing gate
means has changed — it now removes a family that is already public instead of
holding back one that is not. Judging is per band, because a clear introductory
form does not establish that a denser or composed form is readable.

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
- median solve time fits the band's per-item budget: 25 seconds for warmup, 40
  seconds for composition, 50 seconds for constraint/spatial, and 55 seconds for
  induction/transfer. These replace the earlier 60 / 90 / 120 / 120 second
  budgets, which were set when the 20-minute figure was a design target rather
  than a deadline. Three of those four allowed a median above the flat 60-second
  per-question budget, so a family could pass the gate and still make the
  countdown unreachable. Two rules now bind together: no band's median may
  exceed 60 seconds, and the band medians weighted by the 30-question schedule
  (5 / 10 / 10 / 5) must not exceed 45 seconds per question — three quarters of
  the budget, so that the slower half of takers also finishes. The four numbers
  above weigh 1300 seconds against a 1800-second budget, or 43 seconds per
  question. Any change to a band budget must be re-checked against both rules;
  and
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
5. Create distractors from near-miss programs that fail at least one worked row,
   enough of them to fill the option list.

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
