# Handoff
from: codex → to: claude
stage: review→fix
updated: 2026-06-11
branch: main · plan: docs/plans/rules-bank-agent-calibration.md · tasks: TODO.md

## Just did
- Reviewed the current uncommitted rules/bank/agent-calibration/difficulty-selector work; no code fixes made.
- Local verify is green: lint, typecheck, tests, bank verify, and production build all pass.
- Main findings: remote CI violates repo policy; report write path can pool prompt versions; bank topup count semantics are off; fresh-AI fallback UI leaks raw provider errors.
- Existing UI QA artifacts also point to fresh-failure banner persistence, hover/selection ambiguity, and mobile widget/button overlap.

## State
- diff: `git diff` — 13 tracked files, 6671 insertions / 4025 deletions; plus 264 status entries incl. new bank/data/QA/scripts/tests.
- key files: `.github/workflows/ci.yml`, `scripts/report.ts`, `scripts/bank-topup.ts`, `src/app/api/generate/route.ts`, `src/app/page.tsx`.
- tests: pass — run: `npm run lint && npm run typecheck && npm test && npm run bank:verify && npm run build`.
- blockers: none; review findings need fix/triage.

## You next
- Remove `.github/workflows/ci.yml` and scrub CI references from README/TODO/plan docs per global no-GitHub-CI rule.
- Fix `scripts/report.ts --write` so it refuses multiple prompt versions or requires an explicit version; do not write pooled cross-version tags.
- Fix `scripts/bank-topup.ts` so `--source model --count N` actually respects count, and `both` does not exceed the requested total.
- Sanitize fresh-generation fallback messaging in `src/app/api/generate/route.ts` / `src/app/page.tsx`; consider showing one concise banner only on Q1.
- verify: `npm run lint && npm run typecheck && npm test && npm run bank:verify && npm run build`.

## Open questions
- Should the large `docs/qa/2026-06-10T2030/` artifact set be committed as project history, or kept local and ignored?
