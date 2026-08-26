# Escalate the quiz: depth, closeness, and new mechanisms (rev 3)

Revision after the 2026-08-25 code and backlog audit. Rev 3 keeps the owner's
one-batch decision, but makes the order executable: capture the v10 evidence
before changing semantics, define distance before recording its baseline, add
the arrow/turn foundation before grammars use it, settle the proof-gated family
before building pilot and bank artifacts, and rebuild the emergency bank only
after the complete v11 population exists.

## Goal and evidence

One capable adult nearly swept the battery twice: 14/15 across the first pilot
packets, then 15/16 in the full-battery sitting. The misses and notation failures
were withdrawn; most surviving items took 15–30 seconds. The exceptions are useful:
`composed-transform-v2` took 60 seconds against its 40-second band budget, and
`transformation-machine-v3` previously took 135 seconds. Deeper visible programs,
not denser pictures, are the only lever that has made a person slow down.

The strongest committed model run scored 62/75 (82.7% strict accuracy) on
`scene-families-v7`; five attempts timed out. The weak model scored 12/75 (16.0%),
near the 1-in-6 guess floor. These are historical signals, not a v10 baseline:
the family pool, prompt outcomes, and generator have since changed.

The current code exposes four causes of the low ceiling:

- difficulty buckets label generated output instead of selecting the generator path;
- wrong options are sampled uniformly from each grammar, so avoidably distant answers ship;
- 16 of 56 public `composed-transform-v2` programs allow one displayed gate to
  be removed without changing the answer, so the nominal three-step family does
  not always require three steps; and
- the hardest format is a three-gate machine, while most of the battery still
  applies one analogy or one board rule.

The batch succeeds only if it deepens those existing mechanisms. New vocabulary and
families are supporting work, not a reason to expand the product surface.

## Fixed decisions and limits

- Tight distractors: keep required contrasts, then fill the remaining wrong-answer
  slots from the nearest candidates plus two seeded-slack candidates.
- One final human sitting, capped at 24 items. It judges the combined v11 batch and
  cannot identify which lever caused an effect.
- Difficulty may come from more visible structure. It may not come from smaller marks,
  clutter, hidden conventions, or a lower legibility floor.
- Every displayed program step must be necessary: removing any one gate changes
  the answer. A program that fails this ablation is not servable.
- The 4×4 constraint board remains out of scope. A four-symbol machine gate strip is
  allowed only as a machine-table control, never as a general board or answer option.
- No new dependency, score, timer, answer-token format, band schedule, fill value,
  or three-operand set algebra. The failed odd-one-out format is not attempted
  again in this batch.

## Evidence gates

### Human escalation signal

The final packet contains one fixed item for every enabled
`(familyId, band, difficultyBucket)` key: 21 items if the dual-constraint proof
passes, otherwise 20. The packet remains a retention probe, not calibration and
not evidence that a family has passed the multi-participant promotion thresholds.

A **clean miss** is an incorrect d4/d5 response where the participant identified
the intended relationship and reported neither unclear notation nor a defensible
alternative. Confused or ambiguous responses trigger the normal withdrawal review;
they do not count as difficulty.

The combined batch shows a higher human ceiling when either:

1. the final sitting contains at least two clean misses among d4/d5 items; or
2. every d5 item stays within its band's time budget and the median of
   `band budget - five-second time-bin upper bound` across d5 keys is at most
   10 seconds.

The v3 aggregate format uses five-second bins and exports defensible-alternative
counts so `npm run pilot:report -- <aggregate.json>` can compute this result. If
neither branch passes, record the failure; the next change is more program depth,
not looser correctness or legibility.

### Agent signal

Before any generator semantic changes, the owner may authorize these two public
v10 baselines. This is the only comparable pre-change window; if it is skipped,
the v7 artifacts remain labelled historical and no v10→v11 agent-delta claim is made.

The v10 baselines, exactly as run on 2026-08-25 (75 items; the strong run carries
the thinking budget the endpoint now requires — see the deviation below):

```bash
npm run agent:run -- --source generated --profile long-30 --items 75 --seed probe-escalation --channel image --provider openrouter --model google/gemini-3.5-flash --repeat 1 --concurrency 2 --thinking-budget 1024
npm run agent:run -- --source generated --profile long-30 --items 75 --seed probe-escalation --channel image --provider openrouter --model google/gemini-2.5-flash-lite --repeat 1 --concurrency 2
```

The v11 public probes, exactly as run on 2026-08-25 (90 items — 75 cannot satisfy
v11's coverage floor; see the item-count deviation below):

```bash
npm run agent:run -- --source generated --profile long-30 --items 90 --seed probe-escalation --channel image --provider openrouter --model google/gemini-3.5-flash --repeat 1 --concurrency 2 --thinking-budget 1024
npm run agent:run -- --source generated --profile long-30 --items 90 --seed probe-escalation --channel image --provider openrouter --model google/gemini-2.5-flash-lite --repeat 1 --concurrency 2
```

Only complete artifacts with the same prompt version enter the comparison.

**Protocol deviation, 2026-08-25:** the first strong-model baseline run failed
75/75 with transport-failure — the provider now answers "Reasoning is mandatory
for this endpoint and cannot be disabled", and reasoning-off is the relay's
default. The harness gained `--thinking-budget N` (forwarded as the relay's
X-Thinking-Budget header), and the strong-model baseline was re-run with
`--thinking-budget 1024`. The prompt text is unchanged. Every future
gemini-3.5-flash probe, including the pinned v11 commands, must carry the same
`--thinking-budget 1024` or the comparison is void. The weak-model runs stay
without a budget (that endpoint accepts reasoning-off). The failed artifact is
`data/attempts/2026-08-25T09-11-28.381Z-google-gemini-3-5-flash-image.json`
(75 transport-failure) and enters no comparison. The leading signal is at least a 10-point drop in
the strong model's strict public accuracy. The weak diagnostic must also complete
all 75 attempts with no rate-limit or transport-failure outcome; timeouts and
unparseable answers remain model outcomes and are reported separately. Public,
held-out, bank, prompt, channel, model, and generator populations remain separate
in reports.

**Protocol deviation, 2026-08-25 (item count):** the pinned public commands say
`--items 75`. v11's coverage floor (at least 5 items per eligible family and per
program-complexity bucket) cannot be met at 75: the pool grew to 15 families with
per-bucket strata, and the rarest stratum (`compositional-analogy-d4`, served only
when that family appears twice in one test) needs 17 assembled long tests before
the minimal covering set closes at exactly 90 items with the pinned seed. With
owner approval (2026-08-25) both v11 public probes run `--items 90`. Accuracy is a
rate, so the 10-point-drop bar is unchanged; any v10-versus-v11 comparison carries
this footnote because the artifacts differ in item count (75 vs 90).

**Measured result, 2026-08-25.** Strong model: v10 65/75 = 86.67%, v11 71/90 =
78.89% — a drop of **7.78 points**, short of the 10-point signal the plan set. (An
earlier report of "8.1 points" was arithmetic against a rounded 87% baseline and
is wrong; the figure is 7.78.) Ten of the 90 v11 attempts ended in timeout, which
counts against the model exactly as a wrong answer does. Weak model: v10 17/75 =
22.67%, v11 17/90 = 18.89%, at the 1-in-6 guess floor. Held-out diagnostics,
reported separately and never pooled: strong 27/40 = 67.50%, weak 7/40 = 17.50%.
Per-family, the deepened composed-transform (30%), second-order-sequence (20%) and
inverse-fold-punch (40%) are now the hard end for the strong model, while eight
families remain at 100%.

**Auditability gap.** None of these artifacts records the thinking budget the run
used, so the equal-reasoning condition this section makes load-bearing cannot be
verified from the files themselves — only from the run log. The harness now
persists protocol metadata, so runs made from here on are auditable; the recorded
v10/v11 pairs are not, and the probe checklist item stays open until a comparison
is reproducible from artifacts alone.

After v11, run these held-out diagnostics separately. The held-out source rejects
`--profile`, selects 20 items from each final composed-transform bucket, and must
cover every reserved primitive and program-complexity class declared by those
buckets. It never inherits the public-family coverage policy.

```bash
npm run agent:run -- --source held-out --items 40 --seed probe-escalation-held-out --channel image --provider openrouter --model google/gemini-3.5-flash --repeat 1 --concurrency 2 --thinking-budget 1024
npm run agent:run -- --source held-out --items 40 --seed probe-escalation-held-out --channel image --provider openrouter --model google/gemini-2.5-flash-lite --repeat 1 --concurrency 2
```

Each held-out artifact must be complete, contain exactly 20 attempts per final
composed bucket, and pass the source-specific coverage check. Report strict
accuracy and outcome counts for each model and bucket, but set no release
threshold and make no v10→v11 claim: the final d5 population does not exist in
v10. These diagnostics test transfer beyond the public grammar, not the public
accuracy gate.

External model calls and the human sitting are owner-gated. Local implementation
prepares the exact commands and packet but never runs either without approval.

## Phase 0 — make the evidence trustworthy

1. Replace the declared extrapolation count with
   `answeredStrandPanelIndexes`. A tested source helper verifies that indexes are
   sorted, unique, in range, point to visible panels, and lead to the trailing
   blank at a constant stride; extrapolated strands need at least three visible
   terms. `scripts/scene-family-verify.ts` calls the helper, and a mismatch fixture
   proves `npm test` exercises the guard.
2. Add `held-out` as a real agent-run source over the existing reserved composed
   programs. It rejects profiles, balances the requested count across composed
   buckets, and enforces source-specific primitive and complexity coverage rather
   than public-family coverage. Preserve the source in the attempt artifact and
   in every report/calibration population key; test selection, coverage failure,
   and serialization without a relay call. A held-out run is never pooled with
   the public `generated` source.
3. Run or explicitly skip the two owner-gated v10 baseline commands above before
   Phase 1 changes distractors. Record only complete artifacts.

## Phase 1 — sharpen near misses

### Distance contract

Add `src/items/scene-distance.ts`. For equal board dimensions,
`sceneEditDistance` returns a lexicographic integer tuple
`[differingPositions, differingAtoms]`:

- each coordinate is canonicalized as empty, token, container (including ordered
  contents), or connection tile (sorted edges); a coordinate contributes one to
  `differingPositions` when those tagged values differ;
- `differingAtoms` is the padded Hamming distance over the tag and visible fields
  (`shape`, `rotation`, `fill`, `size`, container contents, or tile edges), plus
  the canonical sorted crease-guide fields;
- unequal board dimensions are semantically infinite and serialize as the tagged
  value `"incomparable"`, which the comparator always ranks last. JavaScript
  `Infinity` is not written to JSON because it serializes as `null`.

Unit tests cover empty/occupied changes, moves, token fields, containers, tile
edges, guides, stable ordering, and unequal dimensions.

**Metric correction, 2026-08-26.** The first implementation keyed objects, tiles
and creases as three independent spaces and summed them, so one coordinate could
cost two positions and a crease difference counted as a position. That is not the
contract above. The metric was rewritten to the per-coordinate form as written,
and the v10 baseline was re-measured with it by running the pre-batch generator
out of git (commit 72ffdb3) — the recipe is recorded in the fixture's
`howThisWasRegenerated` field. Re-measuring also showed the original fixture
listed two keys the v10 generator could not produce (`composed-transform-d4`,
which existed at v10 only as the differently-named and shallower
`composed-transform-v1`, and `containment-analogy` under its pre-move band), so
the honest comparable set is 13 keys, not 14. Result under the corrected metric:
**summed p50 positions 33 versus a baseline of 36**, no key regressed at either
percentile, three keys tightened by one position and ten tied. The earlier
"36 vs 40" and "37 vs 40" figures were computed on the superseded metric against
the mismatched fixture and do not compare with these.

### Baseline, selection, and gate

1. With the old uniform selector still active, run 200 fixed seeds per eligible
   v10 `(family, band, bucket)` and commit p50/p90 answer-to-distractor tuples to
   `data/fixtures/scene-distance-v10.json`. The verifier derives distance from
   the final shuffled puzzle options, never from copied candidate metadata.
   Percentiles use nearest rank after lexicographic tuple sorting.
2. `selectDistractors` first validates and deduplicates the required wrong scenes;
   required scenes must be categorically distinct from the answer and from one
   another. It then deduplicates the ordinary pool, ranks by distance, takes the
   closest `remaining slots + 2` candidates, seeded-shuffles that window, and greedily
   keeps candidates categorically distinct from the answer and every selected
   option. A thin or incompatible window rejects the candidate normally.
3. The verifier reports p50/p90 for every final `(family, band, bucket)`. Every
   v10-comparable key must be lexicographically no farther than its fixture at
   both percentiles, and the aggregate median must improve strictly. New v11
   keys report their values without inventing a v10 baseline.
4. Assemble 200 seeded long-30 tests after the change; no slot may exhaust its
   retry budget.

## Phase 2 — scene-only arrow and token turn

Keep the legacy compact-cell vocabulary byte-for-byte stable:
`SHAPES`, `Shape`, `CellSchema`, `ORIENTABLE_SHAPES`, `ROTATION_PERIOD`,
`visualSignature`, and both generate-test goldens do not change.

Add a separate `SCENE_SHAPES = [...SHAPES, "arrow"]`, `SceneShape`, scene
orientation-period map, and scene-token distinctness helper. `SceneTokenSchema`,
scene descriptions, scene rendering, and `areScenesCategoricallyDistinct` use
the scene-only types; containers keep their current outer-shape set. Both human
and agent render paths show arrows at 0/90/180/270 degrees, with option-size and
stem-size legibility tests.

Add `{kind: "turn", quarterTurns: 1 | 2 | 3}` to the scene operation type. It
rotates every orientable token in place, including container contents, leaves
positions/tiles/guides and non-orientable tokens unchanged, and rejects a no-op
scene. The shared exhaustive unary grammar does not silently adopt it; each
family that uses turn adds it explicitly to its declared oracle. This phase tests
the primitive but does not change a public family grammar yet.

## Phase 3 — named generation buckets and deeper existing families

Replace the post-hoc numeric input with a required named-bucket API:
`generateSceneFamilyCandidate(familyId, rng, difficultyBucket)`. Export
`SCENE_FAMILY_BUCKETS`, mapping every current scene family to its supported bucket
ids, numeric difficulties, and visible program depths. Registry tests require
every enabled registry bucket to map to the same family, difficulty, and depth
exactly once; withdrawn families may retain verifier-only buckets but can never
enter a public schedule. Generation metadata and standard agent-probe coverage
read program depth from this declaration rather than inferring it from the band.

The family verifier iterates every declared bucket. Difficulty plumbing preserves
seeded output for all unchanged buckets; changes below are the only intentional
semantic differences.

Deepen four existing families:

- `fold-punch-v2` d5 uses two-crease programs only; d4 remains byte-identical.
- Before deepening either machine family, close QA finding `af2011ec0ce1`:
  multi-gate controls render as a full-width ordered strip, never inside the
  current 56px gate cell, and each glyph retains at least the current single-gate
  size. At 375px the strip and every long stem row must wrap or expose an obvious
  horizontal-scroll affordance; a clipped sliver is a failure. Check both human
  and agent render paths before the final pilot.
- `composed-transform-v2` d4 admits the clockwise and counterclockwise token-turn
  primitives (`quarterTurns: 1` and `3`). Its new d5
  bucket in `induction-transfer` uses four ordered steps, four worked gate rows,
  and one query row. The schema admits a 1×4 scene only as the full-width middle
  gate strip of a `machineTable`; ordinary scenes remain 2–3 by 2–3, and no option
  may be four-wide. Matrix machine tables gain the 15-panel form, with 375px
  browser and agent-image checks.
- `visual-set-algebra-v2` d5 applies the binary set rule, a board transform, then
  a visible token turn; the final grammar and oracle include all three steps.
- `compositional-analogy-v2` d4 combines board movement, fill cycling, and a
  visible arrow/triangle turn. Its d3 spatial-plus-fill output stays unchanged.

`spatial-transform-v2` also adopts turn so its oracle and distractors distinguish
moving the board from rotating tokens in place.

Partition the **final** three- and four-step composed grammars only after these
primitives exist. Extend the fixed held-out predicate to servable programs whose
first two steps move board positions and whose remaining steps are token-local
fill/turn changes. Tests prove public and held-out sets are nonempty, disjoint and
exhaustive; exhaustive single-gate ablation proves every retained program needs
every displayed gate; every primitive remains public; the public assembler and
bank cannot emit a held-out program; and held-out generation supports each
composed bucket. Exact grammar, servable, public, and held-out counts are locked
only after the ablation filter defines the final v11 population.

Schedule slots now carry `(familyId, band, difficultyBucket, difficulty)` before
ordering. A family's first occurrence in a band takes its easiest bucket and
later occurrences take progressively deeper buckets, clamped at its deepest.
Ordering is monotone by slot difficulty subject to the no-adjacent-family rule.
When a family is enabled in two bands, a seeded draw avoids selecting it twice in
one test whenever another eligible family exists — unless this band offers it a
bucket no band it has already served offered, and the profile can still meet its
distinct-family floor. That exception is an owner decision of 2026-08-25: without
it the four-gate `composed-transform-d5` bucket, the deepest item in the battery,
could never appear in a 30-question test. Long-30's floor is therefore 11 distinct
families, not 12, and the exception fires in about 75% of long tests. Short-5 has
no slack at all, so it still shows five distinct families in every test.

## Phase 4 — one new family plus one proof-gated family

### `parallel-evolution-v1`

Add one composition family with d3 and d4 buckets. Each of five visible 3×3
boards contains three distinct-shape tokens. Each token follows its own member of
a finite 15-rule perimeter-ring × fill-cycle grammar; the sixth board is blank.
Reject token collisions and any draw whose full declared grammar leaves more than
one next value for a token. Distractors change exactly one token's predicted next
state. The family needs at least eight program fingerprints over 200 seeds, five
valid one-token-off wrong scenes, the full eight-point contract, and a 375px
render check. It uses legacy shapes only and does not use `turn`; arrow
orientation is not decorative noise.

### `dual-constraint-matrix-v1`

Prove the mechanism before adding a registry entry. Enumerate the complete final
`(row operation, column operation, composition order)` grammar over non-commuting
same-aspect operations. Across 200 accepted fixed draws, the proof must show:

- at least eight program fingerprints;
- all stem-consistent programs predict one visible answer;
- removing either the row evidence or column evidence leaves at least two answer
  predictions, so both constraints are necessary;
- the naive row-only and column-only neighbor predictions are distinct from the
  answer and from each other; and
- at least five other distinct, categorically legible wrong scenes exist.

On success, the enumerator becomes the production oracle and a permanent test;
the family enters `constraint-spatial` at d5 with both naive predictions required.
On failure, add no proof-only production module and record the enumerated result
here; the fixed fallback below applies without a new owner decision.

**Enumerated result (2026-08-25): FAIL — the family is dropped.**
`scripts/dual-constraint-proof.ts` enumerated the whole mechanism class: 420
ordered spatial-op pairs × 16 bases × 4 composition orders = 26,880 grids, 5,390
of them well-posed with nine distinct panels — and **0 escaped both single-rule
shortcuts**. The reason is structural, not a bad op list: under any monotone
composition convention the blank corner is one operation away from a visible
neighbour, so one rule alone always reproduces the answer; non-commutation
removes one shortcut, never both (the abelian control reproduced the rev-1
failure exactly: both shortcuts exact in 174/174). Variety was never the weak
point — 34 distinct fingerprints and a median of 17 legible near misses among
the well-posed draws. Revival would need R and C to be operation *sets* rather
than single operations (each neighbour then yields several candidates and the
answer is the unique scene in both intersections) — a different mechanism that
needs its own proof. The **dual-proof-fails branch of Phase 5 applies.**

## Phase 5 — final population, schedule, pilot, and emergency bank

Select uniformly from the small set of seeded family subsets that satisfy the
format and cross-band rules, rather than shuffle-and-slice followed by repair.
Composition and constraint draws contain at most one analogy-layout family.

| Final branch | Eligible pools (composition / constraint / induction) | Draw sizes | Long floors | Pilot keys | Bank items | 30-question mean analogy target |
|---|---:|---:|---:|---:|---:|---:|
| dual proof passes | 6 / 5 / 4 | 4 / 4 / 3 | 4 / 4 / 3 | 21 | 84 | ≤ 9.0 (expected 8.75) |
| dual proof fails | 6 / 4 / 4 | 4 / 3 / 3 | 4 / 3 / 3 | 20 | 80 | ≤ 10.0 (expected 9.58) |

Short-profile floors and the 5/10/10/5 and 1/1/2/1 band schedules stay unchanged.
Over 10,000 seeds, every profile must build, short-5 must contain five distinct
families, a family may repeat across bands only within the slack described above
and only to serve a bucket it has not already served, no adjacent questions share a
family, the branch's analogy target must hold, and the last two long-test bands
must contain at least six d5 items.

The analogy means include warmup. The pass branch expectation is
`2.5 + 2.5 + 2.5 + 1.25 = 8.75`; the fallback is
`2.5 + 2.5 + 10/3 + 1.25 = 115/12 ≈ 9.58`. Assertions use the table's
quarter-item headroom and a documented floating-point tolerance.

After the branch is fixed:

1. Pilot v3 flattens every enabled registry band and bucket. Item ids and candidate
   seeds use the full `${familyId}:${band}:${difficultyBucket}:r1` identity;
   packet ids become `pilot-v3-*`, cap 24, packet schema v3. Save an answer-free
   packet manifest so an aggregate remains checkable after the live registry moves
   on. The aggregate schema becomes v2 with five-second bins and
   defensible-alternative counts. Parsing, grading, and answer-route tests use the
   same full identity. `pilot:report` validates aggregate v2 against packet v3 and
   its content fingerprint, then computes the exact clean-miss and time-headroom
   rules before reporting pass or fail.
2. Bank coverage keys on `familyId:band:generation.featureBucket`. Top-up accepts
   `--per-bucket 4`; verification asserts four current-version items for every
   enabled key, fallback selection matches the exact bucket, then the existing
   100-seed fallback sweep proves both profiles build.
3. Once all semantics and registry entries are final, bump exactly once to
   `scene-families-v11`, rebuild with
   `npm run bank:topup -- --source expanded --replace --per-bucket 4 --seed emergency-v11`,
   and do not reuse any intermediate bank artifact.

## Verification and release gate

After each implementation phase before final integration:

```bash
npm run typecheck && npm run lint && npm test && npm run families:verify
```

After the v11 bump and one final bank rebuild:

```bash
npm run typecheck && npm run lint && npm test && npm run families:verify
npm run bank:verify && npm run build
```

Then prepare the two pinned v11 public probes, the two exact held-out commands
above, and the single v3 pilot packet. Run external probes only with owner approval;
the owner runs the human sitting. Save accepted artifacts under `data/attempts/`
and `data/pilot/`, run the report commands, and apply the existing withdrawal gate
before treating v11 as the released battery.

## Out of scope and rejected additions

No scoring, token, timer, band-schedule, dependency, 4×4 board, new fill, or
three-operand set-algebra change. No new odd-one-out attempt: two presentations
have already failed the human gate, and this batch is better without a third.
The dual-constraint family is omitted automatically if its necessity proof fails;
pool size is not a reason to keep an unproven mechanism.
