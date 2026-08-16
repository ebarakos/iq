# Handoff
from: codex → to: claude
stage: implement→human-verify
updated: 2026-08-16
branch: main · plan: docs/plans/deterministic-novel-tests.md · tasks: TODO.md

## Just did
- Built the deterministic 12-question visual preview, shared scene vocabulary,
  family acceptance contract, promotion gate, pilot workflow, and LLM proposal experiment.
- Removed puzzle descriptions during solving and moved rich explanations to the completed review.
- Replaced the compact test's hidden arithmetic operator and ended the preview with a
  demonstrated three-gate rotate, fill, and duplicate transformation.

## State
- diff: `git diff main` — implementation and task pointers are in `TODO.md`.
- tests: pass — lint, typecheck, 220 tests, production build, and diff check.
- blocker: production enablement still requires desktop/mobile human pilot evidence and a
  representative fallback bank.

## You next
- Run the human-solvability pilot described in `TODO.md`; do not enable code-valid families
  from uniqueness evidence alone.

## Open questions
- Whether the validated LLM proposal experiment adds enough variety to justify its runtime cost.
