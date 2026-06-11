# Journey: T1
goal_achieved: yes
steps_taken: 14

## As a user, this is what happened

I opened the app and was greeted by a clean intro screen with two options: "Start test" and "Generate a fresh test with AI." I clicked "Start test" and worked through 5 visual puzzles — a sequence, an analogy, an odd-one-out, a matrix, and another sequence. After answering Q3 I used the Back button twice to re-check Q1 (my answer, D, was still correctly shown as selected). However, navigating forward from Q1 with Next unexpectedly jumped me to Q4 instead of Q2, and Q2's review later showed my answer as D (circles) rather than the B (triangles) I had actually clicked — the app did not preserve my Q2 choice through the back-and-forward navigation. After answering Q4 and Q5, I clicked "See results" and got a score of 4/5 (80%). The per-question review showed each puzzle again with the correct answer highlighted, a plain-English "Why" explanation, and a statistic about how often AI agents get that question right.

## Friction

- After pressing Back twice and then Next once from Q1, the app jumped to Q4 instead of Q2 — I lost Q2 and Q3 and had to re-answer Q4 without ever being able to re-answer Q2 at all.
- Q2 was marked "Incorrect" in the review, but the app had stored D (circles) as my answer rather than B (triangles) which I had actually selected — my intended answer was overwritten by the back-navigation.
- The "See results" button change produced only 2 DOM mutations and no visible transition animation — the screen switch felt abrupt and I had a momentary doubt the click had registered.
- Q3 (odd-one-out) had 5 options while all other questions had 4; no prompt or visual cue signals the different option count before you arrive, which is a small surprise.
- The results screen says "From the calibrated item bank" — as a first-time user I have no idea what that means or whether it affects my score.

## Final mental state
{"screen":"results","q_number":5,"answers_picked":{"1":"D","2":"B_intended_but_D_recorded_by_app","3":"D","4":"C","5":"E"},"score_shown":"4/5","score_expected_if_Q2_correct":"5/5","q1":"correct","q2":"incorrect_due_to_back_nav_state_bug","q3":"correct","q4":"correct","q5":"correct","review_extras_noted":{"each_q":"puzzle type label, AI-agent pass rate with run count, plain-English why-explanation, full puzzle re-rendered","q1_ai_stat":"100% of the time, 5 runs","q2_ai_stat":"100% of the time, 5 runs","q3_ai_stat":"Most AI agents fail this one, 5 runs","q4_ai_stat":"100% of the time, 5 runs","q5_ai_stat":"Most AI agents fail this one, 5 runs"}}
