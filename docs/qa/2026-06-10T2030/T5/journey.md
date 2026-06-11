# Journey: T5
goal_achieved: yes
steps_taken: 10

## As a user, this is what happened
After my browser reloaded mid-test, the app put me back exactly on Question 2 of 5 with my answer (Option C) still selected — exactly where I expected to be. Navigating Back to Question 1 confirmed that answer B was also still selected, meaning both pre-reload answers survived the page reload intact. I then moved forward through Questions 3, 4, and 5, answering A, B, and B respectively, and clicked "See results." The score screen showed 3/5 (60% correct): my reloaded answers for Q1 and Q2 turned out to be wrong (correct answers were C and D), while Q3, Q4, and Q5 were correct. The score of 3 matches exactly the three items marked Correct in the review, so there are no consistency violations.

## Friction
- None meaningful. The reload recovery was seamless — no loss of progress, no prompt to restart, no warning banner.
- The "See results" button label replacing "Next →" on the last question is clear and well-timed.
- Q1 and Q2 being incorrect was a reasoning miss on my part (not app misbehavior); the app faithfully preserved and counted those answers.

## Final mental state
{"final_score": "3/5", "q1": "B = incorrect (correct was C)", "q2": "C = incorrect (correct was D)", "q3": "A = correct", "q4": "B = correct", "q5": "B = correct", "reload_recovery": "confirmed — both Q1=B and Q2=C survived reload", "score_verified": true, "surprises": "none", "violations": "none"}
