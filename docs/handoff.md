# Handoff
from: codex → to: claude
stage: review→fix
updated: 2026-08-16
branch: main · plan: docs/plans/deterministic-novel-tests.md · tasks: TODO.md

## Just did
- Re-reviewed all 28 open `TODO.md` items and the new decisions in `BRAINSTORM.md`; the 5/30 profiles, retention gate, late scoring, two agent modes, and parked work are now settled.
- Confirmed that keeping 12-item token reads is correct, but replacing the old assembler and deleting legacy profiles would still break the project's versioned replay promise.
- Found that the current preview pool contains only 13 of 18 code-valid scene families and remaps `spatial-transform-v1` outside its registered band, so it cannot become the production pool unchanged.
- Confirmed that the hidden-arithmetic concern belongs to retired `operator-induction-v1`, not its visible `transformation-machine-v2` replacement; the special warning in `TODO.md` is unsupported.
- Confirmed the LLM proposal source already says it is development-only and absent from the normal route, so the source-comment task is already satisfied.

## State
- diff: `git diff main` — 3 files; key files: `BRAINSTORM.md`, `TODO.md`, `docs/handoff.md`
- tests: not rerun — documentation-only changes; prior baton reports lint, typecheck, 220 tests, and build passing
- blockers: profile/replay semantics and HTTP result persistence still need design before `TODO.md` is executable top to bottom

## You next
- Amend the plan first with exact 5- and 30-item schedules, coverage, retention, deadline, and reporting contracts; then remove the copied decision prose from `TODO.md`.
- Add a new generator version for 5/30 while preserving old assemblers and profiles for replay; select every code-valid family only in its registered band, and cover both lengths in fallback and runtime withdrawal rules.
- Model `answerDeadline` separately from token `expiresAt`; return the former beside the opaque token, persist that server-issued value with the session, and apply one fixed grace/late rule.
- Design HTTP agent execution before coding it: durable storage on Vercel, a runner/provenance field, rate and cost controls, and an async strategy for long server-run tests; never combine server-run and self-reported results.
- Normalize the remaining list: remove duplicate coverage work and conditional progressive generation, reject legacy-profile deletion, drop the completed LLM comment and unsupported transformation warning, and move human pilots plus mobile `/ui-qa` to a human-verify section.
- verify: `npm run typecheck` and `npm test`

## Open questions
- What exact band split makes the 5-item profile a meaningful short sample of the 5/10/10/5 long profile?
- Where should server-run and self-reported HTTP attempt records persist in production?
- Should a 30-item server-run agent test use an asynchronous job, or should synchronous server-run mode support only 5 items?
- What operator-editable configuration backs family withdrawal without adding an admin system?
