# Verdicts: T5

## Steps

| step | verdict | evidence |
|---|---|---|
| 1 | match | shots/step-01-before.png: "Question 2 of 5" header confirmed; Option C tile has clearly darker/heavier border — genuine selected state. Progress bar at ~40%. No console or network errors. |
| 2 | match | Before: Q2 with C selected (consistent with step 1). After (shots/step-02-after.png): "Question 1 of 5"; Option B tile has dark heavy border — pre-reload answer preserved and displayed correctly on Back navigation. |
| 3 | match | Before: Q1 with B selected (consistent with step-02-after). After (shots/step-03-after.png): "Question 2 of 5"; Option C has dark heavy border — forward navigation re-shows restored answer correctly. |
| 4 | match | Before: Q2 C selected. After (shots/step-04-after.png): "Question 3 of 5" loaded; no option has a heavy border; Next button is grey/disabled — clean slate for unanswered question. |
| 5 | match | Before: Q3 clean. After (shots/step-05-after.png): Option A has dark heavy border; Next button is dark/enabled — selection registered correctly. |
| 6 | match | Before: Q3 A selected. After (shots/step-06-after.png): "Question 4 of 5" loaded; Next disabled. Option D carries a light, thin hover-border (parked cursor) but Next remains disabled — not a selection. Reported as benign-surprise per protocol. |
| 7 | match | Before: Q4 with D showing hover border only (no selection). After (shots/step-07-after.png): Option B has dark heavy border; D now plain; Next enabled — click on B correctly replaced the hover state with a genuine selection. |
| 8 | match | Before: Q4 B selected. After (shots/step-08-after.png): "Question 5 of 5" loaded; no option selected; "See results" button is grey/disabled — correct last-question state. |
| 9 | match | Before: Q5 clean. After (shots/step-09-after.png): Option B has dark heavy border; "See results" button is dark/enabled — Q5 answer registered correctly. |
| 10 | match | Before: Q5 B selected with See results enabled. After (shots/step-10-after.png): Score screen shows 3/5 (60%); Review Q1 shows user's answer B highlighted red (Incorrect) and correct answer C highlighted green — pre-reload B answer was carried through to the final review with correct fidelity. Score denominator is 5 (all questions counted). No console or network errors on any step. |

## Journey verdict: pass

The app correctly restored the user to Question 2 with Option C visually selected after the browser reload. Back navigation to Q1 showed Option B (the pre-reload answer) still selected with an unambiguous dark border. Forward navigation back to Q2 re-displayed C selected. The remaining three questions (Q3–Q5) each loaded with no spurious pre-selection and correctly enabled the Next/See results button only after an answer was chosen. The final score screen recorded all five answers — including the pre-reload B and C — and the Q1 review item confirmed B was preserved and attributed to the user. Score arithmetic (3/5) is consistent with the visible review evidence. The only non-ideal pixel was a light hover border on Option D at Q4 load, which is a parked-cursor artifact; Next was disabled throughout, confirming no false selection.

## Findings

- [low] Hover border on unselected option tile is visually similar to a weak selection ring (steps 6 and 7-before, shots/step-06-after.png and shots/step-07-before.png, Option D on Q4). When the cursor parks on an option tile at the moment of page transition, the hover outline appears before any answer is chosen. While distinguishable from the genuine selected state (Next remains disabled), users who glance at the tile label could momentarily believe they have already answered the question.
