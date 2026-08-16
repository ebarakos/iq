# TODO

One agent works this single backlog top to bottom. Design and decisions: [deterministic novel tests](docs/plans/deterministic-novel-tests.md).

## 2026-08-16 — two test lengths and a timer

### Amend the design first

- [ ] Record the 2026-08-16 decisions in `docs/plans/deterministic-novel-tests.md`: two test lengths of 5 and 30 instead of 12, both drawn from the expanded family pool, a flat 60 seconds per question, a hard client deadline with a grace window and a late marker, results as a raw score and family breakdown with no IQ number, and code-valid families public behind an experimental label so the pilot acts as a retention gate.
- [ ] Re-check the human gate's median-solve-time thresholds against the flat 60 second budget, since three of the four bands currently allow a median above it (`docs/plans/deterministic-novel-tests.md:296`).
- [ ] Write the versioned assembly contract for both lengths into the plan — band schedule, family-coverage numbers, and repeat caps — before changing the assembler.
- [ ] Model the answer deadline as its own value, separate from the token's `expiresAt`, and fix one rule for the grace window and the late marker.

### Then implement

- [ ] Add a new generator version for the 5- and 30-question profiles, and leave the `procedural-v1`, `v2`, and `v3` assemblers and the `easy`, `standard`, and `hard` profiles in place; golden-seed replay tests depend on them (`src/items/generate.test.ts:94`, `src/items/generate.ts:838`).
- [ ] Replace the 12-slot curve with a 5 / 10 / 10 / 5 schedule for 30 questions and a 1 / 1 / 2 / 1 schedule for 5 questions, and remove the development-only preview path (`src/items/expanded-quiz.ts:29`).
- [ ] Accept 30-item quizzes in the token payload's item-count rule, and keep accepting 5 and 12 on read so tokens issued before the change can still be replayed and scored (`src/lib/quiz-token.ts:32`).
- [ ] Draw from all 18 code-valid families and select each one only in the band it is registered for; the preview pool uses 13 and places `spatial-transform-v1` in the warmup band although it is registered for composition (`src/items/expanded-quiz.ts:63`, `src/items/family-promotion.ts:191`).
- [ ] Replace the fixed family-per-slot lookup with a rule that produces a rising difficulty ramp (`src/items/expanded-quiz.ts:76`).
- [ ] Raise the per-family repeat cap and the minimum distinct-family count so no single family dominates a 30-item test (`src/items/expanded-quiz.ts:44`).
- [ ] Measure generation latency and rejection rate for a 30-item test.
- [ ] Generate questions progressively if that measurement shows a 30-item test cannot start inside the 20 second client timeout (`src/app/page.tsx:38`).
- [ ] Build a new emergency bank from the expanded families. The current 69-item bank holds only legacy families, so this is a new bank rather than an extension of the old one, and it must cover both test lengths (`data/bank/items.json`, `src/items/bank.ts`, `scripts/bank-topup.ts`).
- [ ] Build the 5-question test from the expanded family pool as a short sample of the 30-question curve (`src/items/expanded-quiz.ts`, `src/app/api/generate/route.ts`).
- [ ] Offer the 5- and 30-question tests on the start screen and carry the choice through generation, session restore, and the result screen (`src/app/page.tsx`).
- [ ] Show the experimental notice on both tests, since both are now built from expanded families, and remove the development-only preview gate (`src/app/page.tsx:39`).
- [ ] Withdraw families through an environment variable holding the excluded family ids, read at request time and applied to both test lengths and the fallback bank; this is the only safety net now that code-valid families ship before their pilot (`src/items/family-promotion.ts`).
- [ ] Fail loudly at startup when the withdrawal list leaves too few families to build a 30-item test, so pulling several families cannot quietly degrade the long test.
- [ ] Store the answer deadline in the quiz token at 60 seconds per question, accept submissions inside the grace window as ordinary, and score later ones with a late marker (`src/lib/quiz-token.ts`, `src/app/api/submit/route.ts`).
- [ ] Return the deadline beside the opaque token so the browser can show a countdown without reading token contents (`src/app/api/generate/route.ts`).
- [ ] Show one countdown for the whole test with a low-time warning, restored from the server-issued deadline rather than from localStorage after a reload (`src/app/page.tsx`).
- [ ] Auto-submit when the countdown reaches zero, scoring every unanswered question as wrong.
- [ ] Keep the offline agent harness working against the new 5- and 30-question tests, so `npm run agent:run` still produces a trustworthy corpus after the generator changes (`scripts/agent-run.ts`, `src/lib/solver.ts`).

### Human verification — needs real participants

- [ ] Run the desktop and mobile human-solvability pilot for every family and difficulty. Every family is already public behind the experimental label, so the pilot's job is to withdraw the ones that fail, not to admit the ones that pass.
- [ ] Finish 30-question-test verification with real human pilots, and remove or redesign families that prove trivial or confusing.
- [ ] Cover mobile with a `/ui-qa` browser pass and manual spot checks. There is no visual regression suite and it is not a release requirement; see the parked note in `BRAINSTORM.md` for the condition that brings one back.
