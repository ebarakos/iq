# TODO

Work this backlog top to bottom. Designs, branch targets, and evidence gates: [escalate the quiz](docs/plans/escalate-the-quiz.md) for v11; [raise the ceiling (d6 tail)](docs/plans/raise-the-ceiling-v12.md) records the d6 tier that was built and then withdrawn.

## After v11 — human verification

- [ ] Run the desktop and mobile multi-participant retention pilot for every enabled family/band/bucket; passing items stay experimental until the documented sample thresholds are met.
- [ ] Take one full 30-question test end to end and record whether the pooled timer, question ordering, skip-and-revisit, and review screen hold up (`src/app/page.tsx`).

## 2026-08-27 — the owner's correction: novelty over depth

- [ ] Close the last five buckets where one inference still isolates the answer — `relational-matrix-d4` (92%), `spatial-transform-d3` (63%), `rule-switching-d5` (49%), `visual-set-algebra-d4` (43%), `second-order-sequence-d4` (100%); each needs its near-miss pool to contain a board sharing the answer's footprint (`src/items/scene-families.ts`).
- [ ] Add the eight set-algebra operations to the gate vocabulary of the machine families, so a gate can combine two boards rather than only transform one (`src/items/scene-families.ts`, `src/items/scene-grammar.ts`).
- [ ] Stop treating prototype-pilot aggregates as difficulty evidence: the owner multitasks during them, so times and misses measure engagement, not hardness (`scripts/pilot-report.ts`, `data/pilot/README.md`).
- [ ] Probe `scene-families-v14` with the two pinned models so the rebuilt set algebra and the reversed gates have agent evidence, and the artifacts record the thinking budget; the v10 and v11 runs stay as they are, a run log (`data/attempts/`, `scripts/agent-run.ts`).
