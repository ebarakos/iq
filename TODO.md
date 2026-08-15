# TODO

Short-lived task/checklist state. Design lives in [BRAINSTORM.md](BRAINSTORM.md)
(ideation) and `docs/plans/<slug>.md` (once formalized).

## 2026-08-15 — quiz reliability

- [x] Stop local "quiz token is invalid" loops by making development token signing stable when QUIZ_TOKEN_SECRET is missing, and keep production requiring a configured secret.
  - File: `src/lib/quiz-token.ts`

## 2026-08-13 — deterministic novel tests

Design: [docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md)

- [x] Aggregate agent results by generator bucket, keeping the image and symbolic channels
  separate and retaining exact-item statistics only as diagnostics.
  - Shipped in `src/lib/calibrate.ts` (`imageBucketRollups` / `symbolicBucketRollups`) and
    printed by `scripts/report.ts`. The human half of this item is not possible yet — no human
    attempt is stored anywhere — so it now lives in the human pilot items below.

## 2026-08-14 — one genuinely hard test

- [x] Remove the easy, standard, and hard choices and the per-question difficulty dots. Start
  every test in one public mode whose initial minimum is the current hard ramp
  (`QUIZ_DIFFICULTY_RAMPS.hard`). Keep item feature vectors and measured difficulty available
  only for generation and calibration.
  - Files: `src/app/page.tsx`, `src/app/api/generate/route.ts`, `src/items/generate.ts`, `src/items/bank.ts`
  - Decide while doing it: whether `POST /api/generate` keeps accepting a `difficulty` field at
    all. Calibration scripts still need to request specific ramps, so either keep the parameter
    and stop sending it from the browser, or move ramp selection out of the HTTP route.
  - Verify: the UI exposes no level choice or level label, and every generated quiz satisfies
    the hard ramp before later hardening work raises that floor.
- [x] Lock the shape geometry with regression tests, and make apparent size consistent across
  shapes. The browser and agent-image renderers already share the same code — `compose-image.tsx`
  imports `CellGraphic` from `render.tsx` — so they cannot drift today, and the tests exist to
  keep it that way. `Shape` now draws the square with a half-side of `r / sqrt(2)`, giving its
  corners the same circumradius as every other polygon at the same nominal size.
  - Files: `src/items/render.tsx`, `src/items/compose-image.test.ts`
  - Verify: a test renders every combination of shape, count, fill, size, and allowed rotation
    and checks its shape type, style, rotation center, and circumradius. A second test asserts the
    agent image still draws cells through `CellGraphic` rather than a copy.
- [x] Add geometry constants and compose-image layout guards for operator-table triads.
  - Files: `src/items/render.tsx`, `src/items/compose-image.tsx`, `src/items/compose-image.test.ts`
  - Verify: a compose-image test checks the cell inset used for every embedded `CellGraphic` and
    enforces equal cell spacing and equal triad spacing in operator-table rows.
- [ ] Make the visual-equation puzzles require deeper reasoning.
  - First decide how a second operation uses the result of the first operation. This must be clear
    before the code is changed.
  - Then allow two operations in a row and allow more than one part of the answer to depend on an
    "if" rule.
  - Every puzzle must show examples of both outcomes of each "if" rule.
  - Files: `src/items/rules.ts`, `src/items/generate.ts`, `src/items/schema.ts`
  - Keep generation fast enough for the start button. Set and measure a maximum generation time.
  - Done means the same seed still creates the same valid puzzle, generation stays within the
    time limit, and every rule that fits the examples gives the same answer.
- [x] Extend near-miss distractors to the remaining families and prove the property with tests.
  Operator induction already builds its options from near-miss programs, and the derived
  families already use `generateDerivedDistractors` for single-dimension near-misses; neither
  has a test that each distractor traces back to a specific competing rule.
  - Files: `src/items/generate.ts`, `src/items/rules.ts`
  - Verify: tests show each distractor is produced by a near-miss program, is instantly distinct
    from every other option, and cannot also satisfy the complete evidence.
- [ ] Decide whether matrix cells should contain small grids of marks.
  - This would allow rules such as combining marks, keeping only shared marks, reflecting marks,
  and moving marks between positions.
  - It would require a new puzzle format and changes throughout generation, drawing, and answer
  checking. Recommendation: do not build it yet; deepen visual equations first.
  - If approved, write a separate plan before changing code.

- [x] Add a results flow where explanation cards are optional per question.
  - In `src/app/page.tsx`, each review item should let users choose to reveal the explanation only
    for items they want, instead of showing every explanation by default.

- [ ] Only serve puzzles that require more than one simple step.
  - Files: `src/items/generate.ts`, `src/items/bank.ts`, `src/items/schema.ts`
  - First decide whether a five-question test must still contain one puzzle of every type. The
  current odd-one-out and analogy puzzles are too simple for this rule, so keeping one of every
    type would make it impossible to build a full test.
  - Done means every served puzzle records why it counts as deep enough, and a test rejects any
    puzzle that only needs one simple step.
- [ ] Save human answers and timing on the server.
  - First choose permanent storage. Files written by the deployed app would be temporary and are
    not a safe place for human results.
  - Save the chosen option, whether it was correct, time spent, and the kind of generated puzzle.
  - Files: `src/app/api/submit/route.ts`, `src/lib/attempts.ts`, `src/lib/quiz-token.ts`
  - Done means each completed test saves one safe record per question without sending secret
    answers or generation seeds to the browser.
- [ ] Decide what counts as a good hard puzzle for people.
  - Before collecting results, choose the target success rate and the largest acceptable number
    of people who may report that a puzzle was unclear.
  - Writing these numbers first prevents changing the goal after seeing the results.
  - Files: `docs/plans/deterministic-novel-tests.md`
- [ ] Test the puzzles with a small group of people and a fixed group of vision models.
  - Report human accuracy and time separately from model accuracy. Group results by puzzle kind
    and rule difficulty instead of by individual randomly generated puzzle.
  - Files: `src/lib/calibrate.ts`, `scripts/report.ts`
  - Keep only puzzle groups that are hard for the intended reason and are still clear to people.
    Keep calling the product a visual reasoning test until there is enough human evidence to call
    it an IQ test.
