# Verdicts: T2

## Steps

| step | verdict | evidence (pixels/observations) |
|---|---|---|
| 1 — click "Start test" | match | Intro screen (step-01-before.png) shows the two buttons; no hint visible here, which is expected since hints are quiz-scoped. After shot (step-01-after.png) confirms Q1 of 5 loaded with progress bar, dot indicator at position 1, and the tip line "Tip: press 1–6 to answer, ← → to navigate, Enter to continue" rendered in small grey text below the answer tiles. Next → button is grey/inactive (no answer yet). |
| 2 — press "2" to select B on Q1 | match | step-02-before.png = Q1 with option A showing a thin rounded grey border (browser focus ring on first tile — not a confirmed selection; no label emphasis, Next still grey). step-02-after.png: option B acquires a thick dark border with the letter label gaining weight; Next → button turns solid dark/active. Option A's focus ring is gone. Key "2" = option B (1-indexed A=1, B=2) as the hint promises. |
| 3 — press Enter to advance to Q2 | match | step-03-before.png = Q1 with B selected and Next active. step-03-after.png = "Question 2 of 5" loaded (sequence puzzle, 4 options A–D, no pre-selection, Next grey). Progress bar visibly longer; second dot filled. Enter advanced exactly as the hint states. |
| 4 — press "3" to select C on Q2 | match | step-04-before.png = Q2 no selection. step-04-after.png: option C has thick dark border; Next active. Key "3" = option C. Consistent with hint. |
| 5 — press Enter to advance to Q3 | match | step-05-before.png = Q2 C selected, Next active. step-05-after.png = "Question 3 of 5" (3×3 matrix, 4 options, no pre-selection). Third dot group updating in header. |
| 6 — press "1" to select A on Q3 | match | step-06-before.png = Q3 no selection, Next grey. step-06-after.png: option A has thick dark border; Next active. Key "1" = option A. |
| 7 — press Enter to advance to Q4 | match | step-07-before.png = Q3 A selected. step-07-after.png = "Question 4 of 5" (hexagon grid, 4 options, no pre-selection, Next grey). |
| 8 — press "4" to select D on Q4 | match | step-08-before.png = Q4 no selection. step-08-after.png: option D has thick dark border; Next active. Key "4" = option D. |
| 9 — press Enter to advance to Q5 | match | step-09-before.png = Q4 D selected, Next active. step-09-after.png = "Question 5 of 5" (analogy, 5 options A–E in a 3+2 grid, no pre-selection). The navigation button now reads "See results" (grey/inactive), not "Next →". The hint still reads "Enter to continue" — the button label changed but the hint did not update to reflect the terminal action. Functionally harmless here (Enter still submits), but the hint wording trails the button. |
| 10 — press "3" to select C on Q5 | match | step-10-before.png = Q5 no selection, "See results" grey. step-10-after.png: option C has thick dark border; "See results" turns solid dark/active. Key "3" = option C (third tile). 5-option layout is A B C / D E; key "3" correctly maps to C. |
| 11 — press Enter to submit and see results | match | step-11-before.png = Q5 C selected, "See results" active. step-11-after.png = score screen shows "YOUR SCORE / 1 / 5 / 20% correct". Denominator 5 matches exactly the 5 questions navigated. Per-question review below shows Q1 (Incorrect, user chose B, correct was A with green border) and Q2 (Incorrect, user chose C, correct was B with green border). Score arithmetic and denominator are consistent with the session. |

## Journey verdict: pass-with-friction

The user successfully completed all 5 questions using only number keys (1–4) and Enter, never touching the mouse after the initial "Start test" click. Every key behaved exactly as the tip promised: number keys selected the corresponding option (thick dark border appeared, Next/See-results button activated), and Enter advanced to the next question or submitted. The final score denominator "/ 5" correctly matches the 5 questions answered. Two low-severity friction points were observed: (1) option A arrives on Q1 with a thin focus ring that is visually distinct from but potentially confusable with a selection state, and (2) the hint reads "Enter to continue" on Q5 even though the button has changed to "See results," creating a minor mismatch between hint copy and the visible button label.

## Findings

- [low] On Q1 load, option A displays a thin rounded grey border before any key is pressed (shots/step-01-after.png, shots/step-02-before.png). The border is noticeably lighter and thinner than the thick dark selection border that appears after a number key is pressed, but a first-time user may momentarily read it as "A is already selected," potentially causing them to skip pressing a key for Q1 or feel uncertain about the initial state. (steps 1–2)

- [low] The keyboard-shortcut tip "Tip: press 1–6 to answer, ← → to navigate, Enter to continue" is absent from the intro screen (shots/step-01-before.png); it only appears after the quiz begins. A user who wants to navigate the intro entirely by keyboard has no hint until Q1 is already on screen. The tip text is also small and grey, placed below the answer tiles where it competes with low-contrast surroundings and is easy to overlook on first glance. (step 1)

- [low] On Q5, the action button label changes from "Next →" to "See results" (shots/step-09-after.png), but the in-card tip still reads "Enter to continue" — the same copy used for all previous questions. The hint does not reflect the terminal nature of this step (e.g., "Enter to see results"). Functionally Enter still works, but the wording mismatch is a small inconsistency that could cause a brief moment of doubt. (steps 9–11)
