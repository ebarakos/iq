# Handoff
from: codex → to: claude
stage: review→fix
updated: 2026-10-15
branch: main · plan: docs/plans/history.md (v39), docs/plans/link-only-test.md · tasks: TODO.md

## Just did
- Reviewed all 26 changed or new files against `65c4338`, excluding this baton. Product files remain unchanged.
- Checked the v39 schedule, one-piece machines, regenerated bank and pilot manifest, sample guidance, home-page links and related docs. One minor finding remains below.
- Confirmed yesterday's five findings are addressed in committed code. This replaces the stale Oct14 baton.

## State
- diff: `git diff HEAD` plus `git ls-files --others --exclude-standard` — 24 tracked changes and two new implementation/data files, plus this baton. Key files: `src/items/expanded-quiz.ts`, `src/items/scene-families.ts`, `src/app/quiz.tsx`.
- tests: typecheck, lint and `bank:verify` passed; the bank has 105 items across 21 keys. 109 focused repository tests passed: scheduler/ramp (10), schema/grammar/sample guides/link walks (90), generation fallback/clock (4), pilot manifest (2), and composed compatibility (3). An isolated homepage reproduction also passed.
- evidence: `/tmp/aiq-one-gate-review.ts` checked 80 seeds across all eight one-gate programs: distinct choices, necessary transformation, no competing readings or single-clue answers, and JSON roundtrips. Erasing the worked transformation was rejected in every case. Existing d4/d5 digests remain unchanged.
- full gate: not rerun on v39. The morning log predates these changes; its four generation failures now pass. Before landing, run `agentrun ./qa/run.sh`. The existing TODO about build and dev sharing `.next` remains open; this review started neither server nor build.
- blockers: none for the local copy fix; nothing staged or committed.

## You next
- **P3: agent instructions promise ranking while the board is disabled.** `src/app/quiz.tsx:595` always says “30 questions, ranked”; `:599` promises publication links. With `LEADERBOARD_ENABLED=false`, the actual result hides publication (`src/app/t/[token]/result/page.tsx:92`). Make both claims conditional on the existing feature flag and cover the disabled homepage. Reproduced with real homepage SSR: `/tmp/aiq-intro-review.test.ts`, using `/tmp/aiq-intro-review.config.mjs`.
- verify: `agentrun npm test -- src/app/t/link-walk.test.ts src/items/sample-guides.test.ts`, then the full local gate before landing. Account for the existing shared-output bug if a dev server is running.

## Open questions
- None requiring an owner decision.
- Rejected the proposed reversal regression: a single gate has no distinct reverse order, and necessity is still enforced.
- Rejected the proposed six-panel acceptance bypass or held-out leak: existing readers handle six panels, and the held-out harness still selects reserved three-gate programs.
- Rejected the removed self-declared-tag disclosure as a defect: it is a deliberate copy change. Relative start links remain correct; no supported-deployment evidence established a forwarded-header defect.
