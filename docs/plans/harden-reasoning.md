# Harden reasoning within three gates

Requested planning pass, 2026-10-09. Machine v4 and spatial assembly were implemented in v32.
The owner disabled spatial assembly in v33 on 2026-10-09; its generator remains diagnostic.
The owner rejected the first three replacement designs on 2026-10-10 and asked for designs closer to Mensa.
The owner approved overlapping figures and shape/count/shading for implementation on 2026-10-10.
Approved design previews: `qa/runs/2026-10-10-mensa-designs/review.html`.
Implemented examples: `qa/runs/2026-10-10-matrix-implementation/review.html`.
The owner approved the conditional composed prototype on 2026-10-09; model and human evaluations have not run.
The checklist lives in [TODO.md](../../TODO.md); this file holds evidence, examples and acceptance conditions.

## Fixed difficulty slots (2026-10-12)

The owner requested random families in every slot, with hardcoded difficulty and comparable family levels.
V36 replaces band quotas and occurrence-based bucket allocation with fixed difficulty slots.
The sample is 2/3/4/4/5. Long questions 1–5 are d2, 6–9 d3, 10–22 d4, and 23–30 d5.
Every slot shuffles its eligible family ids independently; duplicate band offers do not add chances.
Long tests cover all enabled families, capped at five questions each. Samples retain five distinct families.
No adjacent family repeats are allowed. The generator and reference fallback refuse a missing level instead
of replacing it with another difficulty. Historical QA run sources are excluded from current compilation;
application code, scripts and tests remain checked. The old quota-based tests are replaced by fixed-slot,
family-variation, withdrawal and exact-level fallback checks; item acceptance checks remain intact.
The bank is regenerated for v36, and earlier pilot manifests remain unchanged.

Verification passed: typecheck, lint, production build, all 566 tests, family acceptance, and bank integrity.
The fixed-slot regression covers 10,000 seeds per length; every eligible family reaches each slot at its level.
All individual family withdrawals retain both exact difficulty curves. Reference stock holds 100 items over
20 keys. Old quota-policy tests were replaced to reflect the requested behavior; acceptance thresholds stayed intact.
The initial sandbox run lost subprocess output in five CLI tests. They and the full suite passed outside it.
Logs and the 19-example feedback page: `qa/runs/2026-10-12-fixed-slots/`.

Comparable human difficulty is still unmeasured. The owner requested matched examples for feedback.
Equal bucket labels are provisional until timed attempts and relationship reports support them.

## Mixed hard machine orders (2026-10-12)

The owner reviewed the 19 matched examples and accepted their presentation.
The requested adjustment is that the last machine level must mix all three transforms, never using the default order.
V37 applies this to both served machine families: interacting machine v4 and composed transform v2.
Queries draw from the five permutations other than the worked-row order; each transform appears once.
The interacting machine's paint and copy examples reflect the board each receives in that permutation.
Copy-before-paint examples distinguish the copy source by square, with separate shape and fill contrasts.
The oracle reads the visible query order, and explanations follow it. Acceptance rejects the default order
or a mismatch between the displayed order and the gate runner. Fixed slot difficulties remain as in v36.
The reference bank and pilot manifest use v37; earlier manifests and recorded evaluation corpora remain unchanged.
Tests now require every hard query to be mixed, and retain the worked-reading ambiguity and necessary-gate checks.
Only the composed d5 golden digest is reissued; the d4 digest remains unchanged.
This qualitative feedback does not supply human solve times or establish calibrated cross-family difficulty.

## Every machine transformation must be necessary (2026-10-12)

The owner found hard examples where the first two transformations already identified the answer among six choices.
The v37 bank audit confirms this: 14 of its 15 machine examples allow at least one transformation to be skipped.
Changing the generated board when a gate is omitted does not establish that the gate is needed to select an option.

V38 adds a hard rule for every served machine question, covering composed transform v2 at d4/d5 and machine v4 at d5.
Hide any one transformation's example, keep the other examples and the visible query order, and enumerate fitting programs.
At least two offered choices must remain possible, including the correct answer. With every example present,
the visible machine must predict one board matching the marked answer. The same check guards generated and fallback items.
Every level-5 query still uses all three transformations in a non-default order.

Selection reserves a wrong choice that survives each missing transformation. Compound mistakes balance those comparisons.
Three isolated errors otherwise make the correct answer the centre of the options-only strategies.
The existing 30% options-only limit also bounds the machine selector's unavoidable credit and expected choice mix.
Machine selection uses raw strategy credit rather than subtracting unavoidable floors.
Reversed runs remain eligible but are no longer compulsory: they must share the five-choice budget with necessity proofs.
Draws that cannot meet these rules are retried within a fixed bound; no rule is relaxed to fill a slot.

`data/fixtures/machine-gate-shortcut-v37.json` preserves a v37 example that passed all former symbol checks.
It can be solved without the last transform. Regressions reject it in acceptance and current-version fallback data.
Positive checks hide each transform and shuffle choices. Earlier manifests and recorded human or model results remain preserved.

Verification passed: typecheck, lint, all 575 tests, production build, 100-item bank integrity, and the full family gate.
All 4,400 acceptance samples over 22 buckets passed. The 200-item options-only sweeps score at most
25.38% for machine v4, 17.42% for composed d4, and 23.88% for composed d5, below the unchanged 30% limit.
Every one of the 15 stocked machine items needs every transform, as do sampled fallback quizzes of both lengths.
Both composed-transform goldens and machine v4's four-permutation coverage reflect the changed choice contract.
Logs, the failing v37 audit, passing proofs and updated examples live in `qa/runs/2026-10-12-gate-necessity/`.
The first typecheck overlapped build-generated file replacement; rerunning after the build passed.

## Approved Mensa-style matrix designs (2026-10-10)

The owner requested mixed families with the hardest questions last on 2026-10-10.
V35 keeps the band quotas, eligibility and validated buckets, but bands no longer fix question positions.
The 30-question test includes every enabled family; the five-question sample retains five distinct families.
The assembler orders the whole test by actual question difficulty and separates repeated families.
Hard set algebra and overlapping figures share the final difficulty tier with transformation questions.
The highest tier supplies the final question through a seeded feasible family choice.
The old one-analogy draw preference applies to short samples; complete long-test coverage takes priority.
If withdrawals make strict difficulty order impossible, the assembler chooses easier available questions first
while preserving family separation and a hardest final question.
Schedule evidence: `qa/runs/2026-10-10-mixed-families/schedule.json`; preview: `review.html` in the same directory.

V35 passed 20,000 live schedules with no difficulty drops and 4,800 individual-withdrawal schedules
with coverage, separation and a hardest final question preserved. All 580 tests and the full local gate passed.
The family sweep accepted and replayed 4,400 samples across 22 buckets; 4,400 options-only samples passed too.
The regenerated bank holds 100 items across 20 enabled keys and all 12 public families.
The ordering-dependent bank fixture now targets its sequence family explicitly, retaining every rejection
assertion and adding distinct-option checks. Its first run's failure and final passing result are recorded in
`qa/runs/2026-10-10-mixed-families/checks.json`. Independent review found no remaining blockers.

Mensa Norway's [public example](https://test.mensa.no/Home/Test/en-US) specifies a 3×3 grid,
one missing tile and six choices. [Mensa International](https://www.mensa.org/mensa-iq-challenge/)
uses that public practice test. These samples match that format with original artwork and rules.
The owner selected overlapping figures and shape/count/shading. Position patterns remains a proposal.

Implementation keeps the approved 3×3 format and six choices. Overlapping figures supports combining
strokes, turning one input before combining, and giving both inputs different turns before combining.
Each added turn must change the missing figure. Shape/count/shading supports two attribute distributions, adds a count
relationship, then uses weighted counts. These are structural difficulty levels, pending human calibration.
Both solvers re-read the visible grid and enumerate bounded competing rules. All surviving readings must
predict the same missing tile. Existing option balance and single-clue acceptance gates remain unchanged.

The implementation uses two families with six structural levels:

| Family | Level | Visible relationships |
| --- | --- | --- |
| Overlapping figures | d3 | Merge, shared-stroke removal, intersection or either subtraction order |
| Overlapping figures | d4 | Turn or reflect the second figure before combining |
| Overlapping figures | d5 | Different turns or reflections on both figures before combining; both changes affect the answer |
| Shape/count/shading | d2 | Independent shape and shading distributions; constant count |
| Shape/count/shading | d3 | Shape and shading distributions plus addition or subtraction of counts |
| Shape/count/shading | d4 | Shape and shading distributions plus weighted count relationships on both axes |

Overlapping figures checks all 320 operation/orientation combinations on each axis independently.
Equal input orientations commute with every combining operation and collapse to one common turn.
The d5 generator rejects these two-step readings, including competing readings of the visible grid.
The attribute solver checks 125 affine count relationships per axis, absolute difference and count
distribution, then intersects compatible row/column predictions. A fitting pair must complete the same grid.
Count distributions are checked as competing readings but never generated: with three values, they can
duplicate the shape or shading relationship. Weighted counts use double-and-add or double-and-subtract
on both axes. Neither axis admits a simpler affine, absolute-difference or distribution completion.
Shading uses the app's clear white/grey/black categories. All six choices share every individual ray or
attribute outcome with another choice. Each attribute relationship has a separate omission witness,
so removing any one leaves an additional choice. Collection placement varies independently of the rules;
the solver reads shape, shading and count, rather than a fixed footprint. Fixed footprints made the
correct count too central among the choices. The selector checks the full attribute pool while preserving
the existing options-only contract. The overlap selector prefers more necessary rays within that contract.
The 40-candidate overlap search avoids a central-answer pattern found with the ordinary 20-candidate window.
Fallback serving rechecks every attribute relationship and the visible-data oracle, including semantic
option uniqueness. Independent review found and fixed a simpler-axis bypass in d4 and a missing fallback
omission guard. Regressions cover both, plus rearranged duplicate options. The selector's generic error
for an absent omission witness is not a serving issue: the complete attribute pool guarantees witnesses.
Attribute mechanism fingerprints contain the category distributions and count coefficients only.
Palettes, Latin phases, placement and actual numeric counts do not count as new mechanisms.
The diversity regression now checks that distinction; its former 100-key floor counted picture variations.

The final 1,200-item new-family probe passed acceptance in every difficulty bucket.
Its strongest options-only strategies scored 18.25%, 21.50% and 20.63% for overlapping figures,
and 20.68%, 25.71% and 27.25% for shape/count/shading, below the unchanged 30% limit.
Every attribute relationship remained necessary. Independent overlap tests check all fitting rules,
including the shared-orientation shortcut. All 578 tests, typecheck, lint, 100-item bank verification
and the production build passed. Phone screenshots show the hardest levels at 390×900 without clipping.
Expected family counts, bank coverage, pilot contents and grid-flow assertions changed for the approved
families. The existing deadline test and acceptance thresholds were preserved.
The full 200-seed family sweep passed across all 22 declared buckets, including replay, diversity,
option balance and distance guards. Logs and the final passing check record live in
`qa/runs/2026-10-10-matrix-implementation/checks.json`.

1. **Overlapping figures — recommended first.** Infer how the first two figures produce the third.
   The sample removes shared strokes, consistently across both rows and columns.
   Only that operation fits among merge, cancellation, intersection and either subtraction order.
   All choices contain four strokes. Every individual stroke outcome appears on three choices.
2. **Position patterns.** A dot and a square follow different movements across the grid.
   Both axes constrain the missing positions. Each marker alone leaves two choices.
   The two visible marks have separate radii, so neither can cover the other.
3. **Shape, count and shading.** Shapes and shading each distribute once per row and column.
   Counts add across rows and down columns. The missing tile follows all three relationships.
   Each clue appears on three choices; removing any one leaves one additional answer.

All three samples passed their fixed arithmetic and geometry checks and were visually inspected.
`qa/runs/2026-10-10-mensa-designs/verification.json` records the bounded rule checks and answer keys.
The design preview hides answers behind a reveal control. At proposal time, no generator, renderer,
registry, bank or backlog item changed; the approved two families are now integrated in v34.
These original rules are adaptations to Mensa's public matrix format; no exact Mensa item mechanism is claimed.

## Rejected replacement designs (2026-10-09)

The owner rejected all three designs below on 2026-10-10. The earlier preview remains at
`qa/runs/2026-10-09-iq-candidates/review.html` as the record of those proposals.

These original samples have six choices and one mechanically checked answer.
Professional test precedents establish the format, not validity or norms for these new items.
No replacement family is implemented or added to the backlog.

1. **Balance scales — recommended first.** Infer two weight relationships and combine them.
   The sample shows two circles balancing one square, and circle plus square balancing triangle.
   Two triangles must balance three squares. Both shown relationships are needed; all options hold three symbols.
   This adds quantitative reasoning with little rendering machinery.
   Precedent: [WAIS-IV Figure Weights](https://www.pearsonassessments.com/en-us/Store/Professional-Assessments/Cognition-%26-Neuro/Wechsler-Adult-Intelligence-Scale/p/100000392).
2. **Cube rotation.** Preserve face relationships and mark directions through a spatial turn.
   Three reference views reveal all six face marks. Exactly one option matches a proper cube rotation.
   The sample checks all 24 rotations; reflections and independently turned face marks fail.
   This adds a distinct spatial skill but requires new 3D rendering support.
   Precedent: [IST Cubes, publisher report page 9](https://www.hogrefe.com/uk/shop/media/downloads/sample-reports/5535902_mr.pdf).
3. **Geometric conditions.** Preserve a dot's inside/outside relationships after contours move.
   The sample dot is inside circle and triangle, outside square. All three relationships are necessary.
   Every candidate point has clearance from every boundary. This is simpler but has a lower difficulty ceiling.
   It differs from the retired loop-completion family.
   Precedent: [CFT 20-R Topological Conclusions](https://www.hogrefe.com/uk/shop/cattell-s-fluid-intelligence-test.html).

The answer keys are hidden behind a reveal control in the preview.
Static drawings and geometric checks live beside it; none enters the production app.

V33 verification passed: typecheck, lint, all 555 tests, family acceptance, 65-item bank
replay and production build. The subprocess suite passed outside the sandbox after `spawnSync` was blocked inside it.
Generated and fallback tests of both lengths excluded assembly across three fixed seeds each.
Existing population, ordering and deep-question checks still cover 10,000 schedule seeds.
Evidence: `qa/runs/2026-10-09-iq-candidates/disabled-family-verification.json` and `checks.json`.
Registry, bank and packet assertions changed to match the requested withdrawal; no acceptance check was relaxed.

The original v32 recommendation was local repaint followed by copying, then one spatial prototype.
The three-gate ceiling and ambiguity checks remain in force.

## Audit before v32 integration

The audited working tree used `scene-families-v31`, with ten families and thirteen family/band/bucket keys.
This describes local code, not a verified production deployment.

| Band | Families available | Questions in a long test |
| --- | ---: | ---: |
| Warmup | 3 | 5 |
| Composition | 4 | 10 |
| Constraint-spatial | 2 | 10 |
| Induction-transfer | 2 | 5 |

Composed transform belongs to two bands. Constraint-spatial repeats relational matrix and visual set algebra five times each.
Every non-warmup pool sits at its minimum, and the whole pool equals the ten-family floor.
Withdrawing any v31 served family therefore stopped long tests from building.
Sources: `src/items/family-promotion.ts`, `src/items/expanded-quiz.ts`.

### Why transformations feel easier

The transformation machine always moves the board, repaints every symbol, then copies one symbol into the centre.
Repainting commutes with both other gates. Three necessary steps therefore contain only one potentially order-sensitive interaction.
Exhaustive enumeration of all 880 servable geometric draws found:

- 768 have only one distinct valid output across the six gate orders; other orders agree or cannot run.
- 112 have two distinct valid outputs.
- 96 allow all six orders and give the same answer under every order.

Composed transform uses eight primitives: four board moves, two top-left repaint operations, and two token turns.
Of its 128 public three-gate programs, 104 include a token turn that commutes with the other operations.
Each of those 104 programs gives only two distinct boards across the six orders on the canonical query.
The other 24 give three, four, or six distinct boards.

These are grammar counts, not live sampling rates or measured human difficulty.
The live composer samples program/order pairs and can reject options afterward.
Sources: `scene-families.ts` machine grammar, servable draws, composed partition; `scene-grammar.ts` composition primitive pool.

### Recorded results support a ceiling concern, provisionally

The latest recorded probes use v28, `solver-v6`, generated long tests, image input, and high effort.
Two runs per model give the following counts of correct responses among actual answers:

| Mechanism | Opus 5.5 | GPT-6 Astra |
| --- | ---: | ---: |
| Composed transform, d4 and d5 | 12/12 | 11/11, plus one transport failure |
| Transformation machine, d5 | 4/4 | 4/4 |
| Arrow/triangle set algebra, d5 | 2/4 | 3/4 |

Files: `data/attempts/2026-10-05T09-26-44.489Z-claude-opus-5-5-image.json`,
`2026-10-05T09-40-11.711Z-claude-opus-5-5-image.json`,
`2026-10-05T09-26-46.895Z-gpt-6-astra-image.json`, and
`2026-10-05T09-40-14.387Z-gpt-6-astra-image.json` in the same directory.

The arrow/triangle mechanism combines occupancy, board movement, and token direction.
Its misses included position inference after the direction change was understood.
The samples are small, and v29 fixed a competing reading in set algebra.
No recorded model probe uses v29, v30, or v31. No historical human aggregate matches the current pilot packet.
The current difficulty remains unmeasured; earlier ambiguity must not become the target for restoring lower scores.

## 1. Freeze a baseline and measure dependencies

Before changing generation, prepare a reproducible v31 baseline using the existing harness and saved attempt format.
Coverage must name every `(family, band, bucket)`, not just family and shared complexity totals.
The current bank has five items per key, useful as a fixed diagnostic arm; fresh generated items remain a separate arm.
Five observations per key are screening evidence, not calibration.

Prepare the exact commands, item counts, provider/model/effort, seeds, and expected coverage offline.
Model execution requires separate owner approval; if skipped, record that no before/after accuracy claim is available.
Use image and options-only runs on the same selected items. Keep the held-out source separate.
Keep generator, prompt, model, channel, source, effort, and thinking budget distinct in reports.
Report strict scored outcomes and transport failures/timeouts separately; neither failure type establishes reasoning difficulty.

Extend the existing family verifier with valid output counts under gate permutations and adjacent-swap outcomes.
Preserve single-gate ablation, but distinguish an applicable wrong board from an undefined run.
For new hard three-gate variants, both adjacent swaps must yield valid different boards, or an equally explicit dependency proof.
Measure old variants without rejecting the whole existing pool before replacements exist.

Files: `src/lib/agent-probe.ts`, `scripts/agent-run.ts`, `scripts/scene-family-verify.ts`, `src/items/scene-families.ts`.

### v31 baseline: prepared, not run (2026-10-09)

The standard probe now also requires five items per `family:band:bucket` key, on top of five per
family and per program-complexity bucket (`src/lib/agent-probe.ts`). `agent:run --plan` selects
exactly what a run would, prints items per key, the workload and an item-set digest, and stops
before any model call. The same source, profile and seed select the same items on every channel,
so the digest proves that an image arm and its options-only arm answered one item set.

The actual items and answers are frozen in `data/evaluations/harden-reasoning-v31.json` under
arms `generated`, `bank`, `held-out`, and `machine-before`. Replay them with
`--snapshot FILE --arm NAME`; this preserves their original source, generator version, seed and
evaluation set after integration changes the live generator, registry or bank. A seed and digest
alone cannot reproduce an older generator. Snapshot replay verifies each arm's item-set digest.
All frozen expanded items used an empty withdrawal list and `scene-families-v31`;
the bank harness records its source version as `bank-v1`.

| Arm | Source and seed | Items | Item set |
| --- | --- | ---: | --- |
| Generated, image | `generated long-30`, seed `baseline-v31` | 65 (5 × 13 keys) | `9f8ebd8e3f9fe11c` |
| Generated, options-only | same | 65 | `9f8ebd8e3f9fe11c` |
| Bank, image | `bank --all` (fixed diagnostic arm) | 65 (5 × 13 keys) | `054f29a420a37dc9` |
| Bank, options-only | same | 65 | `054f29a420a37dc9` |
| Held-out, image (kept separate) | `held-out --items 20`, seed `baseline-v31-held-out` | 20 (composed d5) | `7a330da2e56ad4a8` |

Models match the last recorded probes (v28), so the settings stay comparable: `claude-code` /
`claude-opus-5-5` with `--effort high --thinking-budget 1`, and `codex` / `default` with
`--effort high`. Prompt `solver-v6`, concurrency 2, no debrief. Each model makes 280 calls
(65 + 65 + 65 + 65 + 20); both models make 560. The two generated arms alone are 130 calls per
model. Every call spends the signed-in CLI plan's limits, and needs `../llm-relay` running locally
with the harness bridge.

Check, then run (one model shown; repeat with `--provider codex --model default --effort high`):

```bash
S="--snapshot data/evaluations/harden-reasoning-v31.json"
node --import tsx scripts/agent-run.ts --plan $S --arm generated            # digest 9f8ebd8e3f9fe11c
M="--provider claude-code --model claude-opus-5-5 --effort high --thinking-budget 1"
npm run agent:run -- $S --arm generated --channel image $M
npm run agent:run -- $S --arm generated --channel options-only $M
npm run agent:run -- $S --arm bank --channel image $M
npm run agent:run -- $S --arm bank --channel options-only $M
npm run agent:run -- $S --arm held-out --channel image $M
npm run report
```

**Not run: model calls need the owner's separate approval.** Until these runs exist, no before/after
accuracy claim is available for any change in this plan.

### Gate-order outcomes before v32 integration (2026-10-09)

`npm run families:verify` now runs each gate item's query in every gate order
(`src/items/gate-order.ts`) and reports, per bucket over its 200 seeds:

| Bucket | Distinct boards over all orders | Adjacent swaps (first/second) | Single-gate ablations |
| --- | --- | --- | --- |
| `transformation-machine-d5` | 1: 177 · 2: 23 | same/same: 200 | wrong board 438 · no board 162 |
| `composed-transform-d5` | 2: 171 · 3: 2 · 4: 25 · 6: 2 | both different 13 · one 104 · one plus no board 16 · neither 67 | wrong board 600 |
| `composed-transform-d4` (two gates) | 2: 200 | different: 200 | wrong board 400 |

No v31 served machine item depends on the order of any adjacent pair, and only 13 composed d5 items
depend on both. Swaps are measured against the order the query asks for, which in composed d5 is
not always the displayed order. These buckets are measured, not failed. A bucket enters
`ORDER_DEPENDENT_BUCKETS` in `scripts/scene-family-verify.ts` when it is built to make the order
matter; from then on every item must reach a different valid board under both adjacent swaps.

## 2. Make local repaint and copying interact

The first machine redesign reuses existing operations: rotate the board, repaint a demonstrated square, then copy its current symbol.
It requires tracking both which symbol reaches the square and which fill the copy inherits.

Concrete query, verified offline with the current operation implementations:

1. Start with an outline circle at top-left and an outline triangle at bottom-left.
2. Rotate positions clockwise, leaving token directions unchanged.
3. Shade the symbol now at top-left grey.
4. Copy that symbol into the empty centre.

The three gates produce a grey triangle at top-left and centre, and an outline circle at top-right.
All six gate orders are applicable and give six distinct boards.
Painting before rotating colours the circle; copying before painting leaves the centre triangle outline.
This proves useful interaction, not that six order outcomes automatically form an acceptable option list.

Worked rows must distinguish square-specific paint from global or shape-specific paint.
Copy examples must distinguish source position from symbol identity before asking for a different symbol in the query.
Vary query layouts and servable orderings where these distinctions remain visible.
Each gate must remain necessary, and each row must demonstrate a gate used in the query.
Keep six balanced options with five plausible near misses under the existing clue and options-only checks.
Do not force all five wrong permutations into the options when that creates a shortcut.

Files: `src/items/scene-families.ts`, `src/items/scene-grammar.ts`, `src/items/worked-row-readings.ts`.

### Built and reviewed: `transformation-machine-v4` (2026-10-09)

V32 serves bucket `transformation-machine-v4-d5` (difficulty 5, three gates), replacing v3.
V3 remains diagnostic code; its original evaluation items are frozen for matched comparisons.

- The machine moves the board, repaints an outer square grey or black, then copies that
  square into the empty centre. All gates remain necessary; both adjacent swaps change
  the answer to a different valid board. Paint and copy share the source square.
- The paint example distinguishes local paint from painting every matching shape.
  Review found that the original copy example still allowed “copy only the white shape”.
  The checker now enumerates fill-specific copy readings too. The corrected copy row shows
  three tokens: the source matches one token by shape and another by fill. Shape or fill
  alone cannot identify the source. Every bounded reading fitting the rows agrees on the query.
- The query uses different shapes from the paint and copy examples, requiring transfer by square.
  Wrong runs, omitted gates and compound mistakes supply balanced near misses.
- Acceptance now rejects a missing gate runner. Order proofs cannot silently disappear.

The reviewed 200-seed acceptance run passed with no rejected draws or second readings.
Every item produced six valid order outcomes, both adjacent swaps changed the answer,
and all 600 single-gate removals produced wrong boards. There were 55 distinct programs.
The worst options-only strategy reached 20.9%, below the existing 30% ceiling.
The measured median generation time was 445 ms; this includes stronger ambiguity checks
and was measured while other local checks ran. Structural interaction does not establish
higher difficulty for people or models.

### Matched machine evaluation: prepared, not run (2026-10-09)

`agent:run --source family --bucket B` draws `--items N` from one declared bucket through the
assembler's own slot checks. A served bucket is recorded as `public`; any other is recorded as
`prototype` and needs `--band`. A family run's family/band/bucket is its own report population, so one bucket's rate
never joins another bucket or a test's headline. Reports also separate provider/model, effort,
channel, source/profile, prompt, generator, thinking budget and frozen corpus. `report --write`
accepts only a public image population from the bank source with measured current-bank items.
One seed and count give v3 and v4 the same draw procedure and size.

| Arm | Command flags | Items | Item set |
| --- | --- | ---: | --- |
| Before, image | `--snapshot data/evaluations/harden-reasoning-v31.json --arm machine-before` | 20 | `fba52eb9d2b831a1` |
| Before, options-only | same | 20 | `fba52eb9d2b831a1` |
| After, image, with debrief | `--source family --bucket transformation-machine-v4-d5 --band induction-transfer` | 20 | `da73ba1d53b9e6a4` |
| After, options-only | same | 20 | `da73ba1d53b9e6a4` |
| Control, image | the baseline's held-out arm above, not repeated | 20 | `7a330da2e56ad4a8` |

Both machine selections originally used seed `harden-machine-v4` and 20 items. The before arm
now replays that frozen selection. Both use the same two models and settings as the baseline. Only the v4 image arm asks for a debrief: its turns come after the scored answer, so
scores stay matched. The debrief is how a v4 miss gets audited against the picture before it counts
as a reasoning miss. That is 120 model calls per model (20 + 20 + 60 + 20) and 240 for both.

```bash
M="--provider claude-code --model claude-opus-5-5 --effort high --thinking-budget 1"
V3="--snapshot data/evaluations/harden-reasoning-v31.json --arm machine-before"
V4="--source family --bucket transformation-machine-v4-d5 --band induction-transfer --items 20 --seed harden-machine-v4"
node --import tsx scripts/agent-run.ts --plan $V4 $M           # digest da73ba1d53b9e6a4
npm run agent:run -- $V3 --channel image $M
npm run agent:run -- $V3 --channel options-only $M
npm run agent:run -- $V4 --channel image --debrief $M
npm run agent:run -- $V4 --channel options-only $M
npm run report
```

How to read it. Options-only should stay near chance (17%) in both arms; if it does not, the
options give the answer away and the image result means nothing. A lower v4 image score counts
only where the debriefs show misses on the intended state tracking, not on reading the picture. A
v4 score as high as v3's means the interaction alone does not raise the ceiling for that model.
Those results inform further hardening; the owner approved section 3 before these runs. Replay the frozen held-out arm for the control;
regenerating it after a grammar change could change its items.

**Not run: model calls need the owner's separate approval.**

## 3. Prototype one gate that acts on current state

The owner chose to implement the prototype on 2026-10-09 without waiting for the machine evaluation.
The prototype deepens composed transform with one conditional primitive:
**move only currently solid symbols one square in a fixed direction.**
A preceding local repaint changes which symbols the gate moves. Arrows need not carry the difficulty.

Demonstrate matching kinds of symbol with different fills, two solid symbols in different positions, and an unchanged outline symbol.
Enumerate bounded competing readings: global movement, one shape kind, fixed positions, and other fill predicates.
Every fitting reading must agree on the query answer before options are selected.
Removing disagreeing options alone is insufficient evidence for this new mechanism.

Start without wrapping or collisions. Movement is simultaneous; an empty selected set is a no-op.
Reject draws needing an unshown edge or collision convention.
Keep at most three gate rows and three query gates. Require the affected set to change because of a preceding gate.
Retain the adjacent-swap proof, ablation, legibility, and option checks.
Stop if visible evidence cannot distinguish the operation in that layout; do not build a general conditional-rule engine.

Files: `src/items/scene-grammar.ts`, `src/items/scene-families.ts`, `src/items/worked-row-readings.ts`.

### Implemented: conditional composed prototype (2026-10-09)

`composed-transform-v3`, bucket `composed-transform-v3-d5`, demonstrates a board move,
solid repaint of one square, and simultaneous one-square movement of currently solid shapes.
It is a separate diagnostic prototype outside the served registry. The public v32 selection,
bank, pilot manifest and prepared machine evaluation remain reproducible.

The primitive rejects edges, stationary collisions, tiles and containers. Moving shapes may
enter squares another moving shape vacates; no solid shapes is a valid no-op. The prototype's
intended queries never require an edge or collision convention. There are 88 geometric queries
across 40 gate programs, covering all four directions. Both adjacent swaps and all three gate
omissions produce valid, different boards. Repainting changes the moving set from one to two.

The movement example shows two solid shapes of different kinds, a matching outline shape,
and a matching grey shape. Every query-occupied square appears with its same selected or
stationary status, so fixed-square alternatives also predict the same query. The repaint
example changes only one of two matching outline shapes. A three-shape board-move example
replaces a sparse example that allowed selective slides composed with a board symmetry.
The query uses other shape kinds, requiring transfer from the demonstrated positions and fills.

The checker enumerates shape, fill, fixed-square, global and wrapping alternatives, including
board symmetries around fitting operations. Every fitting chain must produce the same valid
query answer before options are selected. Removing disagreeing options is insufficient.
The oracle independently derives the gates from the visible examples and query strip.

Visual review found option sets that varied only fills, letting the taker bypass movement.
A required wrong option now stops after repainting: the same shapes and fills occupy different
squares. The final movement is therefore needed to choose between these two boards.
Other near misses retain the shared clue and six-option checks. Review also fixed undefined
ablations passing acceptance and incorrect witnesses after a query strip changed order.

The full verifier then caught a 43.8% options-only shortcut: the answer sat near too many
wrong boards. The final pool keeps two plausible per-shape fill patterns: correct repainting
or its omission. Wrong selection, direction, wrapping, gate order and combined mistakes
supply alternative layouts, including misreading repaint and stopping before movement.
This prototype searches 40 nearby candidates to include those layouts; existing families
retain their 20-candidate search. No rate limit or clue check was relaxed. Review also fixed
the missing family guard that had skipped the competing-reading check in the verifier.
Review rejected a concern that required-option partner selection was new to this prototype:
those shared rules predated it, and the served v32 bank still replays unchanged.

Phone (390px), desktop (1280px) and agent PNG previews use the existing machine renderers.
Local evidence is in `qa/runs/conditional-gate/`, including `trace.zip` and an answer-free item.
The offline evaluation arm is prepared without model calls:

```bash
node --import tsx scripts/agent-run.ts --plan --source family \
  --bucket composed-transform-v3-d5 --band induction-transfer \
  --items 20 --seed harden-conditional-v3
```

It records prototype population, `solver-v6`, generator `scene-families-v32`, and item-set
digest `7fb021e7645961d0`. Image and options-only channels use the same items. Actual model
runs remain separately approved.

Final validation passed: typecheck, lint, **555 tests**, full family acceptance,
70-item bank replay and production build. Across 200 prototype draws there were no rejections,
single-clue answers, indistinguishable wrong options or competing readings reaching wrong options.
Both adjacent swaps changed every answer; all 600 gate omissions produced different valid boards.
The sample covered 37 programs. The strongest options-only strategy scored **19.6%**, below
the unchanged 30% ceiling. A separate 200-item probe exhausted no selection search budgets.
Median verifier time per seed was 867 ms, including generation, replay and acceptance under
concurrent local checks. This is structural evidence; human and model difficulty remain unmeasured.
Phone and desktop views had six options, no overflow and no page errors. Final evidence,
including the agent PNG and `verification.json`, lives in `qa/runs/conditional-gate/`.

For the two models and settings above, the conditional image arm with `--debrief` makes
60 calls per model; the matched options-only arm makes 20. This prototype costs 160 calls
across both models. Together with the matched machine comparison (240) and frozen held-out
control (40), the targeted evaluation costs **440 model calls**. It does not run the full
560-call baseline battery. No calls in this targeted evaluation have been made.

## 4. Add a different spatial skill

### First recommendation: 2D spatial assembly

Show two or three connected fragments and a target frame with one fragment already placed.
Choose the completed arrangement that fits the remaining fragments after permitted quarter turns.
All six options retain the same fragment contents and target footprint, preventing a count or silhouette from identifying the answer.
Wrong options reflect a forbidden mirror, broken fragment, or incompatible placement, with a mechanical witness for each.

Start on a 3×3 board. Enumerate placements and turns to prove exactly one completion, independent of the answer choices.
The placed fragment anchors orientation. The picture must establish allowed turns and rule out reflection without relying on prose.
Use existing categorical marks where possible; render fragment boundaries clearly in both channels.
Physical-looking pieces must remain distinct from machine gate labels.
This requires the small assembly layout/schema extension now implemented in v32.

First prove enough varied, unique items and five plausible balanced wrong options at phone size.
Stop the prototype if the 3×3 format cannot support useful reasoning; do not enlarge the board or relax visual checks automatically.
Target constraint-spatial, which repeated two mechanisms ten times in v31.

Files: `src/items/schema.ts`, `src/items/scene-families.ts`, both renderers, `src/items/family-promotion.ts`.

### Built: `spatial-assembly-v1` (2026-10-09)

V32 serves `spatial-assembly-d4` in constraint-spatial. Pieces contain two, three and four
squares; the two-square piece is already placed. Quarter turns are permitted, reflections
are visibly crossed out. Categorical marks identify each piece in both renderers.

The generator enumerates 420 labelled partitions and retains 32 unique anchored geometries.
A separate packing solver tries every allowed placement before the options are selected.
All six options fill nine squares and retain the same marks and counts. Three required wrong
options each omit one necessary constraint; two further errors break all three. Each wrong
answer has a mechanical witness. Connectivity alone cannot finish the question.

The 200-seed acceptance run had zero rejected draws, no single-clue answers, no dispensable
constraints and a worst options-only rate of 25.5%, below 30%. Median generation was 73 ms.
Phone and desktop previews cover both human layouts and agent PNGs. Review found and fixed
an oversized browser arrow; the shared piece drawing retains visible boundaries and marks.

### Alternative: 3D multi-view reconstruction

Show aligned views of one small block structure and choose the structure consistent with every view.
This adds reconstruction across views, but requires a new scene kind and deterministic renderer.
Enumerate small solids, reject underdetermined projections, and balance block count and individual-view clues across the six options.
Camera direction, visibility, and hidden blocks must be established by the picture; shading alone must not decide depth.
It is an alternative to the first spatial prototype, not a second committed feature in this backlog.
The formal family question remains optional; absent another choice, 2D assembly comes first.

Research supports exploring these skills, not claiming they will defeat today's models:
[SpatialViz-Bench](https://wangst0181.github.io/SpatialViz-Bench/) separates mental rotation, folding, penetration, and animation;
[TriViewBench](https://arxiv.org/abs/2606.26029) studies structural reconstruction across views.
Compositional transfer is also a separate evaluation target in
[CVR](https://arxiv.org/abs/2206.05379). These sources inform the prototypes; no dataset or dependency is proposed.

## Evaluation and integration

Compare changed mechanisms by bucket on fresh fixed seeds, with matched model settings and separate versions.
Reuse existing reports and debriefs. Audit concrete alternative readings and visibility complaints against the picture.
Lower accuracy counts as a promising result only when the extra errors concern the intended reasoning.
Correctness, ambiguity, and legibility are hard gates; structural dependencies alone do not prove higher human difficulty.

Prepare a new human packet only when a genuinely new mechanism exists.
The existing retention design calls for three representative items per affected family/band, each attempted by at least eight people.
Keep the existing interpretation, notation, mobile, and median-time thresholds; do not ask the owner to repeat familiar packets.
Participant invitations and model calls remain separately approved outward actions.

Integrate successful variants through the existing registry, assembler, and fallback bank.
Version changed family grammars and bump the generator for each shipped semantic batch.
Preserve historical attempts/manifests; create the current manifest and rebuild the current bank.
Keep schedules, deadlines, scores, and pool floors. Adding one spatial family does not create withdrawal slack in every band.
Check seeded assembly reliability and latency as well as the full local gate:
`npm run typecheck`, `npm run lint`, `npm test`, `npm run families:verify`, `npm run bank:verify`, `npm run build`.
Renderer changes also need phone/desktop checks in the human and agent channels.

### Integration verification (2026-10-09)

V32 has eleven served families and fourteen family/band/bucket keys. The rebuilt bank holds
70 questions, five per key. Long tests draw all three constraint-spatial families, preserving
the existing minimum of six deep questions. Both test lengths, band schedules, deadlines,
pool floors and six options remain as designed. V3 distance measurements were moved intact
to withdrawn history; no new-family distance baseline was invented.

The versioned v32 pilot manifest holds packet A's six new representatives and packet B's
12 familiar items. Historical attempts and manifests remain unchanged. The v31 frozen baseline
still replays digest `9f8ebd8e3f9fe11c`; the reviewed v4 arm is `da73ba1d53b9e6a4`.
These offline plans made no model calls.

Validation passed: typecheck, lint, **520 tests**, family acceptance, bank replay/integrity
and production build. The schedule test covers both profiles over 10,000 seeds, retaining
coverage, deep-question floors and ordering checks. Registry and report assertions were updated
for the changed behavior; the old nine-distinct-family regression keeps a pre-v32 pool fixture.

Three seeded tests per length assembled without failures. Short tests took 339–1068 ms;
long tests took 1902–2384 ms and each included eleven distinct families. These local figures
are a small reliability sample, not a serverless latency guarantee. Evidence lives in
`qa/runs/v32-layout/latency.json`. Four browser views (390px phone and 1280px desktop for
each new family) had six options, no overflow and no page errors. Both agent PNGs were inspected.
Screenshots, `checks.json` and `trace.zip` are in `qa/runs/v32-layout/`.

Review accepted the reproduced copy ambiguity, missing-runner enforcement, unreplayable
baseline and mixed report populations. It rejected these concerns:

- A fixed query order is not a bug; the plan permits it and both adjacent swaps are checked.
- All six permutation outputs need not be options; forcing them can break option balance.
- V3 diagnostic code is not a duplicate served family; it is outside the registry.
- The empty adjacent-swap helper is valid; the boundary now enforces runner coverage and depth.

The conditional composed gate was an owner decision; the owner subsequently approved the prototype.
No model accuracy claim, participant collection, deployment, commit or push was made.

## Considered and rejected or deferred

- More than three gates: the owner withdrew that route; it adds procedure and conflicts with the standing limit.
- Restoring ambiguous arrow-fill or mirror rows: the lower scores included unfair readings.
- Forcing every clue to be indispensable: five wrong options cannot always cover that goal; preserve v31's stronger-clue preference.
- Random textures, extra shapes, or more layouts as the main hardening claim: variety alone does not deepen reasoning.
- Overlapping worked gate chains: a useful later induction alternative, but adds evidence/layout complexity before simpler interaction is measured.
- Reviving combining machines, fold/punch, odd-one-out, or interleaving unchanged: their documented failures remain unresolved.
- A second generic constraint engine or many conditional gates: one successful mechanism must earn further machinery.
- A numerical difficulty-drop target now: current-version and multi-person evidence are missing; choose a target from a real baseline.

## Audit provenance

Two explicitly selected agents audited gate code and recorded evidence independently.
Their findings were checked against the source, reproduced gate enumerations, and the four v28 attempt files above.
Four current bank images were rendered and inspected: composed transform, transformation machine, set algebra d5, and relational matrix.
The local repaint/copy example was executed using the existing primitives and produced six distinct valid order outcomes.
That planning pass changed only this plan and the requested TODO items.
The subsequent implementation review reproduced the machine ambiguity, corrected it,
froze baseline selections, separated report populations and added the spatial family.
