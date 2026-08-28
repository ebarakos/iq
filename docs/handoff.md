# Handoff
from: codex → to: claude
stage: review→fix
updated: 2026-08-27
branch: main · plan: docs/plans/deterministic-novel-tests.md · tasks: TODO.md

## Just did
- Reviewed all eight uncommitted files against `HEAD`, including the deleted scene generators, registry cleanup, UI labels, verifier coverage, and combining-machine near misses.
- Confirmed the removed families were already unserved and the live assembler still has the same 19 family/band/bucket keys.
- Found two medium-priority review gaps and stale live descriptions; no project code was changed during review.

## State
- diff: `git diff HEAD` — 8 files; key files: src/items/scene-families.ts, src/items/scene-families.test.ts, src/items/family-promotion.ts, TODO.md
- tests: pass — typecheck, lint, full family verifier, bank verifier, and build pass; `npm test` passed 447/450 in the sandbox, and the three nested-process tests passed 29/29 in an unsandboxed focused rerun
- performance: the 200-seed verifier measured combining-machine d5 at 1.08s median and 3.90s p95 on this machine; its optimization remains an open TODO
- blockers: review findings below; no execution blocker

## You next
- Add a fixed-seed regression gate for the completed combining-machine aspect claim: d4 must stay at zero single-aspect leaks and d5 must stay within an explicit residual ceiling (`TODO.md:17`, `src/items/scene-families.test.ts:420`).
- Make the required human-before-public sitting executable: the pilot skips prototypes while the assembler immediately serves code-valid families (`src/items/prototype-pilot.ts:107`, `src/items/expanded-quiz.ts:421`).
- Correct stale live descriptions and examples in `src/items/family-promotion.ts:153`, `src/items/scene-families.ts:94`, `.env.example:43`, and `docs/architecture.md:13`.
- verify: `npm run typecheck && npm run lint && npm test && npm run families:verify && npm run bank:verify && npm run build`

## Open questions
- Should the human sitting use an in-app preview state that is not publicly servable, or a documented manual render procedure?
