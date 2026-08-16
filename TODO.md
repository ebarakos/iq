# TODO

One ordered implementation pass for one agent. Work from top to bottom; there is
no second active backlog. Design: [deterministic novel tests](docs/plans/deterministic-novel-tests.md).

## 2026-08-16 — the 30-question test, a timer, and the agent gap report

Decisions behind this group: 60 seconds of budget per question, one shared
countdown, raw score plus reasoning-family breakdown with no IQ number, agent
results reported only as a per-family gap, and the expanded families shipped in
production behind a visible experimental label.

- [ ] Accept 30-item quizzes in the token payload's item-count rule (`src/lib/quiz-token.ts:32`).
- [ ] Add a 5 / 10 / 10 / 5 band schedule for 30 questions beside the existing 12-slot curve (`src/items/expanded-quiz.ts:29`).
- [ ] Replace the fixed family-per-slot lookup with a rule that produces a rising difficulty ramp at any test length, then re-verify the ramp (`src/items/expanded-quiz.ts:76`).
- [ ] Raise the per-family repeat cap and the minimum distinct-family count so no single family dominates a 30-item test (`src/items/expanded-quiz.ts:44`).
- [ ] Measure generation latency and rejection rate for a 30-item test; keep the start button inside the 20 second client timeout or generate questions progressively.
- [ ] Extend the emergency bank so a 30-question fallback keeps the same family spread as a healthy generated test (`data/bank/items.json`, `src/items/bank.ts`).
- [ ] Offer 5, 12, and 30 question tests on the start screen and carry the choice through generation, session restore, and the result screen (`src/app/page.tsx`).
- [ ] Show the experimental notice on every test built from expanded families, and remove the development-only preview gate (`src/app/page.tsx:39`).
- [ ] Store a deadline of 60 seconds per question in the quiz token and refuse or flag submissions that arrive after it (`src/lib/quiz-token.ts`, `src/app/api/submit/route.ts`).
- [ ] Show one countdown for the whole test with a low-time warning, restored from the token rather than from localStorage after a reload (`src/app/page.tsx`).
- [ ] Auto-submit when the countdown reaches zero, scoring every unanswered question as wrong.
- [ ] Add a documented HTTP agent mode that serves the same answer-free items and rendered images and scores through the same endpoint.
- [ ] Record channel, prompt version, attempt budget, model, and latency with every agent run so different conditions are never pooled together (`src/lib/solver.ts`, `src/lib/calibrate.ts`).
- [ ] Report human and agent solve rates side by side for each reasoning family, and never as one combined number.
- [ ] Delete the `easy` and `standard` quiz profiles, which no user interface can reach (`src/items/generate.ts:71`).
- [ ] Set a date by which the LLM rule-proposal experiment is either kept or deleted (`src/lib/llm-rule-proposal.ts`, `scripts/llm-rule-experiment.ts`).

## 2026-08-15 — broaden the test into varied, deep visual reasoning

- [ ] Run the desktop and mobile human-solvability pilot for every candidate family and difficulty, promoting only family/band pairs that meet the thresholds in the design plan.
- [ ] Promote the preview-only transformation-machine replacement after it passes the human gate; keep hidden arithmetic out of the compact test.
- [ ] Run and evaluate the flagged LLM rule-proposal experiment for acceptance, latency, cost, novelty, and pilot quality; retain pure-code validation and deterministic fallback.
- [ ] Finish expanded-test verification with mobile visual regression and real human pilots; remove or redesign trivial or confusing families.
