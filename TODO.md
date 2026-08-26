# TODO

Work this backlog top to bottom. Designs, branch targets, and evidence gates: [escalate the quiz](docs/plans/escalate-the-quiz.md) for v11, [raise the ceiling (d6 tail)](docs/plans/raise-the-ceiling-v12.md) for v12.

## 2026-08-24 — escalate the quiz

### Phase 0 — make the evidence trustworthy

- [x] Validate extrapolated sequence evidence from answered-strand panel indexes in a source helper used by `npm test`, with invalid-index, ordering, visible-panel, and constant-stride regressions (`src/items/scene-families.ts`, `src/items/scene-families.test.ts`, `scripts/scene-family-verify.ts`).
- [x] Add a profile-free held-out composed-transform source with even bucket selection and its own primitive/complexity coverage, and preserve the source in attempt artifacts, calibration, and reports with network-free tests (initial `--held-out N` arm shipped; the `--source held-out` per-final-bucket interface completes with Phase 5 integration) (`scripts/agent-run.ts`, `src/lib/attempts.ts`, `src/lib/agent-probe.ts`, `src/lib/calibrate.ts`, `scripts/report.ts`).
- [x] Before generator semantics change, run the plan's two pinned v10 public probes — done with owner approval: strong 87% (65/75, `--thinking-budget 1024` now required by the endpoint and pinned for v11), weak 23% (17/75); artifacts in `data/attempts/2026-08-25T*`, deviation recorded in plan §Agent signal.

### Phase 1 — sharpen near misses

- [x] Add the canonical lexicographic `sceneEditDistance`, including the serializable incomparable-dimensions result, with object, container, tile, guide, and ordering tests (`src/items/scene-distance.ts`).
- [x] Record p50/p90 distractor distances from 200 fixed v10 seeds per enabled family/band/bucket before changing selection (`data/fixtures/scene-distance-v10.json`, `scripts/scene-family-verify.ts`).
- [x] Rank optional distractors by distance, sample only the closest remaining-slots-plus-two window, and preserve required contrasts and pairwise legibility (`src/items/scene-families.ts`).
- [x] Report distance percentiles for every bucket, fail any v10-comparable regression, and require a strict aggregate improvement (summed p50 positions 33 vs 36 over 13 keys under the plan's per-coordinate metric; three keys tightened, ten tied) (`scripts/scene-family-verify.ts`).
- [x] Prove 200 seeded long-30 assemblies exhaust no slot retries after distance ranking (`src/items/expanded-quiz.test.ts`).

### Phase 2 — scene-only arrow and token turn

- [x] Add scene-only arrow types, four-direction human and agent rendering, descriptions, and scene-legibility tests without changing legacy compact-cell shapes or goldens (`src/items/domains.ts`, `src/items/schema.ts`, `src/items/render.tsx`, `src/items/compose-image.tsx`).
- [x] Add the token-local `turn` operation with container, no-op, and board-rotation distinction tests, without adding it to family grammars yet (`src/items/scene-grammar.ts`).

### Phase 3 — named buckets and deeper existing families

- [x] Require a named difficulty bucket in scene-family generation, export every supported family bucket, and verify enabled-registry parity plus every declared bucket (`src/items/scene-families.ts`, `src/items/family-promotion.ts`, `scripts/scene-family-verify.ts`).
- [x] Derive generation and agent-probe program depth from the declared family bucket instead of the band, with a composed-transform depth regression (`src/items/expanded-quiz.ts`, `src/lib/agent-probe.ts`, `src/items/expanded-quiz.test.ts`).
- [x] Assign buckets before band ordering and prefer families no earlier band drew, letting a long test repeat one family only to reach a bucket it has not served (owner decision 2026-08-25; long-30 floor 11), while preserving monotone difficulty and no adjacent repeats (`src/items/expanded-quiz.ts`, `src/items/expanded-quiz.test.ts`).
- [x] Add the two-crease-only `fold-punch-v2` d5 bucket while keeping fixed-seed d4 output unchanged (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Close the current 375px machine-gate and clipped-row QA findings with a full-width ordered gate strip, single-gate-size glyphs, and an obvious wrap or scroll affordance in both render paths (`src/items/render.tsx`, `src/items/compose-image.tsx`, `qa/baseline.json`).
- [x] Add token turns to `composed-transform-v2`, build its four-step d5 bucket in `induction-transfer` and its restricted full-width 1×4 gate strip, and test the 15-panel machine table at 375px in both render paths (`src/items/scene-families.ts`, `src/items/schema.ts`, `src/items/render.tsx`, `src/items/compose-image.tsx`).
- [x] Reject every composed d4/d5 program whose answer survives any single-gate ablation, then lock the final grammar and servable counts with an exhaustive test — 276 three-gate and 1296 four-gate programs, 192 and 552 servable (`src/items/scene-grammar.ts`, `src/items/scene-families.ts`, `src/items/scene-families.test.ts`).
- [x] Partition the final three- and four-step composed grammars and prove public/held-out exhaustiveness, primitive coverage, bucket coverage, gate necessity, and zero public leakage — 168/24 at three gates, 520/32 at four (`src/items/scene-grammar.ts`, `src/items/scene-families.ts`, `src/items/scene-families.test.ts`).
- [x] Add the `visual-set-algebra-v2` d5 binary-plus-board-plus-token-turn bucket and its complete oracle (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Add the `compositional-analogy-v2` d4 movement-plus-fill-plus-token-turn bucket while keeping d3 fixed-seed output unchanged (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Add token-turn versus board-rotation programs to `spatial-transform-v2` and extend its oracle and required contrasts (`src/items/scene-families.ts`).

### Phase 4 — new mechanisms

- [x] Build `parallel-evolution-v1` d3/d4 with per-token survivor uniqueness, one-token-off wrong answers, diversity, retry, and 375px rendering gates — 15-rule grammar, 0 rejections and 165 distinct fingerprints over 200 seeds per bucket (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Run the deterministic dual-constraint necessity proof — verdict FAIL, recorded in the plan: 0 of 5,390 well-posed grids escaped both single-rule shortcuts; structural to monotone composition (`scripts/dual-constraint-proof.ts`).
- [x] If the dual-constraint proof passes, ship its d5 family — not applicable: the proof failed, no production module is added.
- [x] If the dual-constraint proof fails, omit the production module and apply the plan's fixed 20-key fallback pools and floors — applied: no dual-constraint module, pools 6/4/4, draws and long floors 4/3/3, 20 enabled keys asserted from the registry (`src/items/family-promotion.ts`, `src/items/expanded-quiz.ts`).

### Phase 5 — integrate and prepare evidence

- [x] Select seeded family subsets that satisfy the branch's draw sizes, analogy caps, cross-band rule, and floors, then prove both profiles and all 10,000-schedule targets (`src/items/expanded-quiz.ts`, `src/items/expanded-quiz.test.ts`).
- [x] Build a pilot-v3 packet from every final family/band/bucket key with full item identity, deterministic reconstruction, an answer-free saved manifest, a content fingerprint, and server grading tests (`src/items/prototype-pilot.ts`, `src/app/api/prototypes/answer/route.ts`).
- [x] Collect aggregate-v2 pilot data with five-second bins and explicit defensible-alternative counts while preserving the no-raw-participant-data rule (`src/app/prototypes/prototype-pilot.tsx`, `src/items/family-promotion.ts`).
- [x] Add `npm run pilot:report -- <aggregate.json>` to validate aggregate v2 against packet v3 identity and fingerprint and compute the exact clean-miss/time gate, with parser tests (`scripts/pilot-report.ts`, `package.json`).
- [x] Key expanded-bank top-up, exact coverage, fallback selection, and verification by family, band, and feature bucket, with four items per final key (`scripts/bank-topup.ts`, `src/items/bank.ts`, `scripts/bank-verify.ts`).
- [x] Bump once to `scene-families-v11` and rebuild the emergency bank with `npm run bank:topup -- --source expanded --replace --per-bucket 4 --seed emergency-v11` (`src/items/expanded-quiz.ts`, `data/bank/items.json`).
- [x] Run the complete local v11 gate: `npm run typecheck && npm run lint && npm test && npm run families:verify && npm run bank:verify && npm run build`.

## After v11 — human verification

- [ ] Run the desktop and mobile multi-participant retention pilot for every enabled family/band/bucket; passing items stay experimental until the documented sample thresholds are met.
- [ ] Take one full 30-question test end to end and record whether the pooled timer, question ordering, skip-and-revisit, and review screen hold up (`src/app/page.tsx`).
- [x] Cover mobile with a `/ui-qa` browser pass and manual spot checks; `docs/brainstorm.md` holds the condition for restoring visual regression tests.

## 2026-08-26 — raise the ceiling (d6 tail)

Design: [docs/plans/raise-the-ceiling-v12.md](docs/plans/raise-the-ceiling-v12.md).
Ships with the `containment-analogy-v2` withdrawal as one `scene-families-v12` bump.

- [x] Withdraw `containment-analogy-v2` on the pilot's notation evidence and record the sitting in `data/pilot/README.md` (`src/items/family-promotion.ts`).
- [x] Widen the difficulty range to 6 in the puzzle schema and the bucket parser, and pin that the legacy compact-cell generators still never exceed 5 (`src/items/schema.ts`, `src/items/expanded-quiz.ts`).
- [x] Add the five-gate `composed-transform-d6` bucket with its 18-panel machine table and a 1×5 gate strip that fits 261px in both render paths (`src/items/scene-families.ts`, `src/items/render.tsx`, `src/items/compose-image.tsx`).
- [x] Extend single-gate ablation and the public/held-out partition proofs to the five-gate grammar, and lock the servable and per-side counts (`src/items/scene-grammar.ts`, `src/items/scene-families.test.ts`).
- [x] Add the four-gate `transformation-machine-d6` bucket with ablation, keeping its d5 fixed-seed output unchanged (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Drop the `inverse-fold-punch-d6` bucket: the schema caps a board at two creases and d5 already draws those, so it raised no ceiling (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Prove over 10,000 seeds that every long-30 test ends on a d6 item, the last two bands still hold at least six items at d5 or deeper, and all floors and adjacency rules survive the withdrawal (`src/items/expanded-quiz.ts`, `src/items/expanded-quiz.test.ts`).
- [x] Rebuild the pilot packet over all 21 enabled keys and refresh the saved answer-free manifest (`src/items/prototype-pilot.ts`, `data/pilot/pilot-v3-manifest.json`).
- [x] Bump once to `scene-families-v12`, rebuild the bank with `--per-bucket 4 --seed emergency-v12`, and run the full local gate (`src/items/expanded-quiz.ts`, `data/bank/items.json`).
- [ ] Probe v12 with the two pinned models so the d6 tail has agent evidence and the artifacts record the thinking budget; the v10 and v11 runs stay as they are, a run log (`data/attempts/`, `scripts/agent-run.ts`).
- [ ] Have the owner sit the v12 packet, save its aggregate, run `npm run pilot:report -- <aggregate.json>`, and apply the withdrawal gate plus the d6 success test: at least one clean miss among the two d6 items, and no notation report on either (`data/pilot/README.md`).
