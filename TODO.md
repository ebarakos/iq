# TODO

Work this backlog top to bottom. Designs, branch targets, and evidence gates: [escalate the quiz](docs/plans/escalate-the-quiz.md) for v11; [raise the ceiling (d6 tail)](docs/plans/raise-the-ceiling-v12.md) records the d6 tier that was built and then withdrawn.

## After v11 — human verification

- [ ] Run the desktop and mobile multi-participant retention pilot for every enabled family/band/bucket; passing items stay experimental until the documented sample thresholds are met.
- [ ] Take one full 30-question test end to end and record whether the pooled timer, question ordering, skip-and-revisit, and review screen hold up — blocked until the ui-qa skill is restored to `~/.claude/skills` (it is absent from `claude-automation/skills` too) (`src/app/page.tsx`).

## 2026-08-27 — the owner's correction: novelty over depth

- [x] Close the four buckets where one inference still isolated the answer — `relational-matrix-d4`, `spatial-transform-d3`, `rule-switching-d5`, `visual-set-algebra-d4`, all now at 0% over 120 seeds (`src/items/scene-families.ts`).
- [x] Record that `second-order-sequence-d4` was on that list by mistake: every option is one token at a different ring slot, so an option sharing the answer's footprint would be the answer (`src/items/scene-families.test.ts`).
- [x] Add gates that combine two boards: `combining-machine-v1`, a new family on a new `combineTable` row where the gate glyph sits between its two operands (`src/items/scene-families.ts`, `src/items/schema.ts`, `src/items/render.tsx`).
- [ ] Promote `combining-machine-v1` out of prototype: one aspect still decides 63% of its d4 items and 90% of its d5 ones, so it needs near misses that share the answer's footprint before it can be served (`src/items/scene-families.ts`, `src/items/family-promotion.ts`).
- [x] Stop treating prototype-pilot aggregates as difficulty evidence: the report prints the miss and time numbers with no PASS/FAIL verdict (`scripts/pilot-report.ts`, `data/pilot/README.md`).
- [ ] Probe `scene-families-v15` for agent evidence — blocked on the relay default: the codex harness bridge rejects images, so it cannot run the image channel at all, and it answered 502 for every model on 2026-08-27 (`data/attempts/`, `scripts/agent-run.ts`).
