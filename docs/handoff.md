# Handoff
from: claude → to: codex
stage: plan→implement
updated: 2026-08-14
branch: main · plan: docs/plans/deterministic-novel-tests.md · tasks: TODO.md

## Just did
- Reviewed every open TODO item against the code. No code changed this session — only `TODO.md`.
- Three items described work that already exists, and were rewritten to name the real gap:
  the two renderers already share `CellGraphic`; the operator grammar already has conditionals;
  near-miss distractors already exist in both the operator and derived families.
- Marked the 2026-08-13 bucket-aggregation item done — it shipped in `src/lib/calibrate.ts`.
- Added the missing prerequisite for the human pilot: no human attempt is stored anywhere today.
- Flagged the micro-grid matrix item as a decision, not a task, and recommended deferring it.

## State
- diff: `git diff` — 1 file (`TODO.md`); documentation only.
- tests: pass — 143 tests, 12 files. Run: `npx vitest run`.
- blockers: two items in `TODO.md` need a human decision before anyone implements them —
  the micro-grid matrix go/no-go, and the sequencing conflict on the hard-item gate.

## You next
- Start with the first `TODO.md` item: remove the easy/standard/hard choice and the difficulty
  dots, leaving one public mode pinned to `QUIZ_DIFFICULTY_RAMPS.hard`. It is self-contained and
  blocks nothing else.
- Then the geometry regression tests, which are also independent of the open decisions.
- Do not start the hard-item eligibility gate yet: `generateQuiz` fills five slots with one item
  per family, and the gate would disqualify `oddOneOut` and `analogy` outright, leaving the quiz
  unable to fill five slots.
- If you take the operator grammar item, measure the uniqueness oracle's runtime first —
  `enumerateOperatorExpressions` runs inside the live request path.
- verify: `npx vitest run && npm run typecheck && npm run build`.

## Open questions
- Micro-grid matrix family: go ahead with its own plan doc, or defer? It needs a `Cell` that is
  a set of marks, so it changes the schema, both renderers, and the legibility rules.
- Should `POST /api/generate` keep accepting a `difficulty` field for calibration scripts once
  the browser stops sending one?
