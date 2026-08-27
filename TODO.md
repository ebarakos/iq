# TODO

Work this backlog top to bottom. Designs, branch targets, and evidence gates: [escalate the quiz](docs/plans/escalate-the-quiz.md) for v11, [raise the ceiling (d6 tail)](docs/plans/raise-the-ceiling-v12.md) for v12.

## After v11 — human verification

- [ ] Run the desktop and mobile multi-participant retention pilot for every enabled family/band/bucket; passing items stay experimental until the documented sample thresholds are met.
- [ ] Take one full 30-question test end to end and record whether the pooled timer, question ordering, skip-and-revisit, and review screen hold up (`src/app/page.tsx`).

## 2026-08-26 — raise the ceiling (d6 tail)

Design: [docs/plans/raise-the-ceiling-v12.md](docs/plans/raise-the-ceiling-v12.md).
Ships with the `containment-analogy-v2` withdrawal as one `scene-families-v12` bump.

- [ ] Probe v12 with the two pinned models so the d6 tail has agent evidence and the artifacts record the thinking budget; the v10 and v11 runs stay as they are, a run log (`data/attempts/`, `scripts/agent-run.ts`).
- [ ] Have the owner sit the v12 packet, save its aggregate, run `npm run pilot:report -- <aggregate.json>`, and apply the withdrawal gate plus the d6 success test: at least one clean miss among the two d6 items, and no notation report on either (`data/pilot/README.md`).
