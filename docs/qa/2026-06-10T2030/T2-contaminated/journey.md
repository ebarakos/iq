# Journey: T2
goal_achieved: yes
steps_taken: 8

## As a user, this is what happened
I arrived at the app already showing Question 1 of 5 (the test had been started before my session began). I spotted the keyboard shortcut hint at the bottom of each question screen: "Tip: press 1–6 to answer, ← → to navigate, Enter to continue." I used number keys to select answers throughout: pressing a number key both selected the option AND auto-advanced to the next question (not just selected, as I expected). Navigating the middle questions was bumpy — pressing "4" on Q3 reported 0 DOM mutations and the snapshot appeared to show Q2, then pressing ArrowRight and Enter skipped Q3's visual display and jumped to Q4. Despite this confusion about Q3, the results screen showed all 5 questions scored correctly except Q2 (which I had answered D/circles instead of the correct B/solid triangles). The final score was 4 out of 5, matching my count of 5 questions answered.

## Friction
- Number keys auto-advance to the next question immediately after selection — the hint says "press 1–6 to answer" with separate Enter to continue, but the actual behavior is single keypress = select + advance. This is undiscoverable from the hint alone.
- Q3 with 5 options (A–E) had inconsistent keyboard behavior: pressing "4" reported 0 mutations and appeared to go back to Q2, leading to confusion about which question was being displayed.
- ArrowRight navigation with 50 DOM mutations still showed Q2 content in the snapshot, suggesting a rendering/state mismatch that made it hard to know which question I was actually on.
- On Q5 with 5 options, pressing "5" reported 0 mutations but then the results screen appeared, suggesting the results transition happened asynchronously or key "5" was not the actual trigger.
- Q2 was answered incorrectly (D instead of B) partly because navigating back through Q2 with ArrowRight and Enter reset my intended answer.

## Final mental state
{"question": "results_screen", "total": 5, "score": "4/5", "score_percent": "80%", "q1": "D — Correct", "q2": "D — Incorrect (correct was B)", "q3": "unknown key pressed — Correct per results", "q4": "C — Correct", "q5": "C (pre-selected) — Correct", "questions_answered": 5, "score_matches_answered": true, "shortcut_hint_found": true, "hint_location": "bottom of each question screen", "friction": "auto-advance on number key, Q3/Q5 5-option key behavior inconsistent"}
