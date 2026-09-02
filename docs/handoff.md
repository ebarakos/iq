# Handoff
from: claude → to: codex
stage: implement→review
updated: 2026-09-02
branch: main · plan: docs/plans/escalate-the-quiz.md · tasks: TODO.md

## Just did
- Reviewed the uncommitted `scene-families-v17` rework: composed-transform-d4 now shows and
  applies two gates (new 16-pair board-move+fill grammar in `src/items/scene-grammar.ts`),
  d5 shows and applies all three in varied order; `spatial-transform-v2` and
  `rule-switching-v2` demoted to warmup at d2 (`src/items/scene-families.ts`,
  `src/items/family-promotion.ts`, `src/items/expanded-quiz.ts`).
- `src/items/bank.ts` fix rides along: required-type widening in `sampleQuiz` now respects
  the profile floor, so a d2 warmup item sharing a type with hard items can no longer leak
  into a hard quiz. This deliberately reverses the old comment's "outliers must stay
  reachable" rule — necessary once one-step families moved to d2.
- Bank regenerated (80 items, 16 keys, all v17); fixture keys in
  `data/fixtures/scene-distance-v10.json` renamed with numbers kept (correct: the moved
  families' generators are unchanged, only labels moved); composed d4/d5 digests reissued.
- Verified the pilot-manifest edit orphans nothing new: both recorded v3 sittings already
  fail the fingerprint check at HEAD, and `data/pilot/README.md` declares sittings ended.

## State
- diff: `git diff main` — 16 files; key files: src/items/scene-families.ts,
  src/items/expanded-quiz.ts, src/items/bank.ts, scripts/agent-run.ts
- tests: pass — run: `npm run typecheck && npm run lint && npm test && npm run families:verify && npm run bank:verify && npm run build` (full gate green 2026-09-02; families:verify summed p50 21 vs baseline 30)
- blockers: none

## You next
- Review the two deliberate test loosenings and confirm you agree: `src/lib/attempts.test.ts`
  dropped the uneven-split refusal (held-out source is now the single d5 bucket, so any count
  divides), and `src/items/expanded-quiz.test.ts` pins "families that can finish a long test"
  to exactly 2 (induction pool shrank to two families).
- Judge the rule-switching demotion d5 → d2: three bands in one step. The one-operation
  rationale fits the depth-honesty doctrine and all near-miss tests pass, but it is the
  largest single reclassification so far and deserves a second reader.
- One doc nit if you touch the file anyway: the `MINIMUM_DISTINCT_FAMILIES` comment in
  `src/items/expanded-quiz.ts` still says the long profile has room for "one" repeated family
  (12 slots vs floor 10 now tolerates two). The pilot README nit was already fixed in the
  working tree and landed with this commit.
- The open TODO item stands: probe `scene-families-v17` for agent evidence — v17 is unprobed
  and the held-out probe is now 40 items of composed-transform-d5 alone (`scripts/agent-run.ts`).
- verify: `npm test && npm run families:verify && npm run bank:verify`

## Open questions
- none
