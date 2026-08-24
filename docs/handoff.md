# Handoff
from: codex → to: claude
stage: review→fix
updated: 2026-08-24
branch: main · plan: docs/plans/raise-the-ceiling.md · tasks: TODO.md

## Just did
- Reviewed all uncommitted raise-the-ceiling work: the `interleaved-sequence-v2` withdrawal, rebuilt emergency bank, bank-test change, plan, and TODO section; no fixes were applied.
- Confirmed the bank has 56 replay-valid `scene-families-v7` items: four for each of the 14 currently eligible families, with no duplicate ids or fingerprints.
- Found that the withdrawal changes the released family pool without bumping `EXPANDED_GENERATOR_VERSION`, contrary to its contract in `src/items/expanded-quiz.ts`; old and new v7 populations are now different.
- Found two unsupported plan premises: the pilot record says no human saw `interleaved-sequence-v2`, and 10,000 live schedules average 14.16 analogy / 11.66 matrix / 4.18 sequence items across six families in the last two bands, not 13 / 9 / 8 across five.
- Found stale project truth in `CLAUDE.md` and a cardinality-only eligible-family assertion in `src/items/bank.test.ts` that does not compare the actual family-id sets.

## State
- diff: `git diff main` + `git status --short` — 5 tracked paths and 1 untracked plan; key files: `src/items/family-promotion.ts`, `data/bank/items.json`, `docs/plans/raise-the-ceiling.md`, `TODO.md`
- tests: pass — `npm run typecheck && npm run lint && npm test && npm run build && npm run bank:verify && npm run families:verify`
- blockers: none

## You next
- Give the changed family pool a new generator version (or preserve v7 through a recorded withdrawal input), then rebuild the bank so old v7 attempts and new runs cannot be pooled as one population.
- Reconcile the withdrawal rationale with `data/pilot/README.md`: it says this family had no human coverage, while the new comment and plan claim the pilot failed it and that nobody could solve it.
- Recompute the format-diversity section and replace the five-family TODO decision; the current last two bands use six distinct families, so do not ask the user to decide from the false premise.
- Update `CLAUDE.md` to the current eligible-family count, generator version, and completed human/agent evidence; strengthen the bank test to compare exact eligible and bank family-id sets.
- Scope the held-out-combinations task into an independently verifiable design before implementation; the plan does not yet define the split, private storage boundary, or leakage check.
- verify: `npm run typecheck && npm run lint && npm test && npm run build && npm run bank:verify && npm run families:verify`

## Open questions
- Was there later human evidence for `interleaved-sequence-v2` that has not been saved under `data/pilot/`? If not, keep the structural-soundness rationale but remove the pilot claim.
- After the pool counts are corrected, does a real band-placement/product-copy choice remain? If so, it is the user's `Decide` item and needs a formal question before implementation.
