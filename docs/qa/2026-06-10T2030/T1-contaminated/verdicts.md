# Verdicts: T1

## Steps

| step | verdict | evidence (pixels/observations) |
|---|---|---|
| 1 | match | Intro card with "Take a 5-question visual IQ test", "Start test" (dark/filled) and "Generate a fresh test with AI" (outline) both visible. Expectation: intro screen with both options — confirmed. |
| 2 | match | After clicking "Start test", the page transitions to "Question 1 of 5" with a sequence puzzle (alternating diamonds and squares) and 4 option buttons. Progress bar and dot indicator update. Next is disabled (grey). Expectation: question 1 with visual puzzle — confirmed. |
| 3 | match | Option D (outline square, rotated 0°) gains a thick dark border; Next button changes from grey to dark/active. Expectation: Option D highlighted, Next enabled — confirmed by pixels. |
| 4 | match | Header changes to "Question 2 of 5", progress bar advances, a new analogy puzzle appears (diamond shapes :: solid diamonds :: outline triangles : ?). Back becomes active, Next is disabled. Expectation: Q2 with new puzzle — confirmed. |
| 5 | **violation** | After clicking Option B (triangles), Option B gains a thick border — visually selected. However, the before-shot for step 6 (which is step 5's immediate continuation) shows **both B and D simultaneously highlighted** with thick borders. A single-select question is displaying two options as selected at the same time; only one answer should be active. The user selected B, but D is also visually marked. The state shown to the user going into the Next click is ambiguous and incorrect. |
| 6 | match | "Question 3 of 5" appears with an odd-one-out puzzle (circles of varying fill/size). Navigation coherent (Q2 → Q3). Expectation: Q3 with new puzzle — confirmed. Note: the before-shot still carries the two-selection artefact from step 5. |
| 7 | match | User intends to select Option D; before-shot shows Option B selected on Q3. After-shot shows Option D (outline grey circles) gains thick border, Next enabled. Expectation: D pressed, Next enabled — confirmed. Note: the user's intent record names Option D as "3 half medium circles, rotated 90°" and that is the D tile shown highlighted. |
| 8 | **violation** | User clicks Back from Q3 expecting to return to Q2 with their earlier answer (Option B — triangles) still selected. After-shot shows Q2 with **Option D (circles) highlighted**, not Option B. The answer the user actually selected (B, step 5) has been replaced by D. This is a state-loss on Back navigation: the preserved answer shown does not match what the user chose. |
| 9 | match | User clicks Back from Q2 (which now incorrectly shows D). After-shot shows Q1 with Option D (outline square) still highlighted — matches the original Q1 selection from step 3. Q1 answer state was preserved correctly. |
| 10 | **violation** | User clicks Next from Q1 expecting to land on Q2. After-shot shows **"Question 4 of 5"** — the app skipped from Q1 directly to Q4. Q2 and Q3 were bypassed entirely. The question counter jumps from 1 to 4 in a single Next click, which is incoherent navigation. The user never sees Q2 or Q3 again, yet answers for those questions were recorded. |
| 11 | match | On Q4 (matrix puzzle, stars/squares grid), user selects Option C (stars). After-shot shows Option C with thick border, Next enabled. Expectation: C pressed, Next enabled — confirmed. |
| 12 | match | After clicking Next from Q4, the header shows "Question 5 of 5" with a new sequence puzzle (triangles decreasing in fill). The Submit button has changed from "Next →" to "See results" (still disabled until answered). Expectation: Q5 with new puzzle and a submit-equivalent button — confirmed, though the button label is "See results" not "See results button" — this is fine and expected. |
| 13 | **violation** | Before-shot shows Q5 with **Option C already highlighted** (the action from step 11 selecting C on Q4 has apparently bled into Q5, or Q5 pre-selected C). The user then clicks Option E; after-shot shows E highlighted and C deselected. While the user's final intent (E selected) is satisfied, the user saw a pre-selected option on a fresh question they had not yet answered — this is a misleading initial state that a reasonable user would not expect. |
| 14 | **violation** | Results screen appears. Score shows 4/5 (80%). The review shows Q2 marked **Incorrect** with Option D (circles) highlighted in red as "your answer" and Option B (triangles) in green as the correct answer. However, the user chose Option B at step 5 — the app has recorded a wrong answer (D) for Q2 because the answer state was corrupted on Back navigation (step 8). The score and the "Your answer" display in the review are both wrong for Q2: the user correctly selected B, but was scored as if they selected D. This is a wrong computed score caused by the state-loss bug. |

---

## Journey verdict: fail

The user completed all 5 questions and reached the results screen, but the core Back-navigation guarantee was broken: pressing Back from Q3 to Q2 silently replaced the user's Q2 answer (B) with a different option (D). When the user then pressed Next from Q1, the app skipped two questions and jumped to Q4, giving no opportunity to catch the corruption. As a direct consequence, the final score of 4/5 is wrong — the user was marked incorrect on Q2 despite having selected the right option. The review screen reinforces the error by displaying the corrupted answer ("Your answer: D") as fact. The test's core promise — take 5 questions, use Back to double-check, get an accurate score — was not fulfilled.

---

## Findings

- [high] **Back navigation replaces a previously given answer with a different option, silently corrupting the recorded answer.** Navigating Back from Q3 to Q2 (step 8) displayed Option D highlighted instead of the user's actual choice (Option B). The user had no indication the answer changed. This caused the final score to be wrong (4/5 instead of a potentially higher score) and the review to display an incorrect "Your answer". Steps 8, 14; screenshots `shots/step-08-after.png`, `shots/step-15-results-scrolled.png`.

- [high] **Next from Q1 after Back-and-return navigation jumps directly to Q4, skipping Q2 and Q3.** After going Back to Q1 (step 9) and pressing Next (step 10), the app landed on Question 4 of 5 rather than Question 2 of 5. Two questions were silently skipped; the user had no way to verify or re-answer them. Steps 9–10; screenshots `shots/step-09-after.png`, `shots/step-10-after.png`.

- [high] **The final score and per-question review reflect the corrupted answer state, not the user's actual choices.** Q2 is marked Incorrect with "Your answer: D (circles)" when the user selected B (triangles) at step 5. A user reviewing their performance is given false information about what they answered. Step 14; screenshot `shots/step-14-after.png`, `shots/step-15-results-scrolled.png`.

- [med] **Q2 shows two options simultaneously highlighted (B and D) before the user clicks Next.** The before-shot at step 6 shows both Option B and Option D with thick selection borders on a single-answer question. A user glancing at their selection before advancing cannot tell which answer is actually recorded. Step 5/6 transition; screenshot `shots/step-06-before.png`.

- [med] **Q5 opens with Option C already visually selected before the user has touched it.** The before-shot at step 13 shows Option C highlighted on a fresh question. A user who does not notice would proceed with a pre-selected answer they did not choose. Step 13; screenshot `shots/step-13-before.png`.
