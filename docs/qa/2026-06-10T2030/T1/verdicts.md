# Verdicts: T1

## Steps

| step | verdict | evidence (pixels/observations) |
|---|---|---|
| 1 | match | Intro screen shows "Take a 5-question visual IQ test" with Start test and Generate a fresh test with AI buttons. shots/step-01-before.png. |
| 2 | match | Clicking Start test loads Q1 of 5 ("Which option completes the analogy?") with progress bar, dot indicator, and greyed Next. shots/step-02-after.png. |
| 3 | match | Clicking D selects it with a dark border ring; Next button turns black/active. shots/step-03-after.png. |
| 4 | match | Clicking Next loads Q2 of 5 ("Which option continues the sequence?"); question counter advances to 2, second dot fills. shots/step-04-after.png. |
| 5 | match | Clicking D on Q2 highlights it with a dark border; Next becomes active. shots/step-05-after.png. |
| 6 | violation | After clicking Next from Q2, Q3 loads with option D **already pre-selected** (dark border) before any user action. A fresh question must arrive with no selection. shots/step-06-after.png shows D highlighted on first render of Q3. |
| 7 | match | Clicking B on Q3 selects it with a dark border; D loses its (spurious) highlight. shots/step-07-after.png. |
| 8 | match | Clicking Back from Q3 returns to Q2 with D still selected (dark border intact). Counter shows "Question 2 of 5". Back correctly preserves the earlier answer. shots/step-08-after.png. |
| 9 | n/a (environment) | Driver crash #1; app returned to intro on reload. shots/step-09-recovery.png. |
| 10 | match | Start test (second attempt) loads Q1 of 5. shots/step-10-after.png. |
| 11 | n/a (environment) | Driver crash #2; Zeldish foreign process visible. shots/step-11-recovery.png. |
| 12 | match | Start test (third attempt, coherent run) loads Q1 of 5 ("Which option completes the grid?") — a 3×3 matrix puzzle, no pre-selection. shots/step-12-q1.png. |
| 13 | violation | Press key "3" on Q1 selects C and auto-advances to Q2. The captured Q2 state (step-13-q2.png) shows option C selected on Q2. The very next screenshot (step-14-before.png, taken before any recorded click) shows Q2 with option A selected instead. A selection change on Q2 occurred between these two frames with no corresponding user action in the record. |
| 14 | violation | Clicking Back from Q2 returns to Q1 correctly (counter "Question 1 of 5"), but step-14-after.png shows **both option A and option C with dark selection borders simultaneously** — two options appear selected at once. Expectation was C alone (the answer entered by pressing "3"). The Back check cannot be confirmed clean from pixels. |
| 15 | match (progression) | Next from Q1 returns to Q2 showing A selected (step-15-after.png). Subsequent intermediary screenshots (step-15-q3.png, step-15-q4.png, step-15-q5.png) confirm Q3→Q4→Q5 load in order with correct counters. Q5 shows "See results" button. |
| 16 | match | Clicking See results renders the results screen: score **5 / 5, 100% correct**, "From the calibrated item bank", with a Take another test button and a Review section beginning. shots/step-16-after.png. |
| 17 | match | Scrolling reveals all 5 question reviews. Each shows the puzzle, the selected answer highlighted in green, a Correct badge, a "Why:" explanation, and an AI-agent calibration note. Fully readable. shots/step-17-scroll1.png, step-17-scroll2.png. |

---

## Journey verdict: pass-with-friction

The user completed all five questions, used Back to verify an earlier answer (confirmed at step 8 in the first run, where Q2's D was still selected on return from Q3), submitted, and read the final score (5/5) and per-question review with "Why:" explanations for all five items. The core goal was achieved. However, two distinct visual-state bugs were encountered: a pre-selection appearing on a fresh question (step 6) and a dual-option highlight after Back (step 14). Neither blocked completion — the underlying scoring appears correct (all 5 marked Correct in review, consistent with the answers entered) — but a real user would have been confused about which answer was actually saved on Q1 during the Back visit, and would have no way to trust that their intended answer was recorded.

---

## Findings

- **[med]** Fresh question arrives pre-selected: when the user advanced from Q2 to Q3 (first run, step 6), Q3 loaded with option D already highlighted by a dark selection border before any click. A first-time user has no way to know whether this is the app's suggestion, a retained answer from a previous session, or a glitch. shots/step-06-after.png.

- **[high]** Two answer options simultaneously show selected highlight after Back: returning to Q1 from Q2 (step 14, third run) shows both option A and option C with dark borders at the same time. A user relying on the visual to verify their answer cannot determine which option is actually recorded. The "double-highlight" state makes the Back-to-verify workflow unreliable as a trust signal. shots/step-14-after.png, shots/step-14-before.png.

- **[med]** An unrecorded selection change on Q2 between steps 13 and 14: the after state of step 13 (step-13-q2.png) shows Q2 with option C highlighted; the before state of step 14 (step-14-before.png) shows Q2 with option A highlighted, with no user action logged between them. The answer that was counted for scoring (A, per the review screen) differs from what pixels showed immediately after navigation. A user advancing quickly through questions may not notice their selection was silently altered.

- **[low]** The "Why:" explanations on the review screen are terse and reference internal rule vocabulary ("rotation decreases by one step wrapping around", "fill decreases by one step") that assumes the user knows what "wrapping around" means in this context. The review is present and readable, but provides no visual annotation connecting the explanation to the specific cells in the puzzle.
