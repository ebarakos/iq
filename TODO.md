# TODO

Short-lived task/checklist state. Design lives in [BRAINSTORM.md](BRAINSTORM.md)
(ideation) and `docs/plans/<slug>.md` (once formalized).

## 2026-08-13 — deterministic novel tests

Design: [docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md)

- [ ] Aggregate human and agent results by generator bucket while keeping their solve rates
  separate; retain exact-item statistics only as diagnostics.
  - Files: `src/lib/calibrate.ts`, `scripts/report.ts`
- [ ] Run a small human pilot and a fixed vision-model panel; enable the new family in normal
  quizzes only if humans find it clear and it produces a wider, repeatable agent difficulty
  range than the current matrices.
  - Verify: record the human protocol and versioned agent attempt artifacts before changing
    the default quiz mix.
