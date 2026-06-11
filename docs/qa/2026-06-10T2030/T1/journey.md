# Journey: T1
goal_achieved: yes
steps_taken: 17

## As a user, this is what happened

I landed on a clean intro page for "aiq — visual IQ test" offering two options: Start test (uses the pre-built fallback item bank) and Generate a fresh test with AI. I clicked Start test and was taken through 5 visual puzzle questions with clear progress indicators (dots + progress bar). The puzzle types varied: a 3x3 matrix (rotation pattern), an analogy (shape count), another analogy (fill + count transformation), an odd-one-out (fill type), and a sequence (rotation + fill decreasing). I used the Back button to return to Q1 and confirmed my earlier answer C was still selected — no state loss on navigation. After answering all 5 questions I clicked "See results" and was shown a score of 5/5 (100% correct) with a full per-question review showing the puzzle, my selected answer (highlighted green), a "Why" explanation sentence, and an AI-agent calibration statistic for each question.

## Friction

- The browser driver (qa-driver.mjs) is shared across multiple browser tabs and crashed / had its context stolen twice during the session, forcing two full test restarts before completing the run. This is an infrastructure issue, not an app issue.
- The "Start test" button name mismatch (ARIA = "Start test" vs actual rendering) caused one NOT_FOUND click on a stale tab — driver must be on the correct tab before clicking.
- Text-based clicks on single-letter option labels (e.g. `{"text":"D"}`) are ambiguous (19 matches) because the option label "D" appears in multiple places in the DOM; keyboard shortcuts (press 1-6) and full aria-name clicks are more reliable.
- The "Next →" button name includes the arrow character, which was mildly surprising but worked when used exactly.
- No per-question timer or difficulty label is shown during the test itself — the calibration stats (e.g. "Most AI agents fail this one") only appear in the post-test review, not while answering.

## Final mental state
{"current_question": "done", "answers": {"1": "C", "2": "A", "3": "D", "4": "D", "5": "B"}, "score": "5/5", "score_pct": "100%", "back_verified": true, "q1_type": "matrix", "q2_type": "analogy", "q3_type": "analogy", "q4_type": "oddOneOut", "q5_type": "sequence", "q4_note": "Most AI agents fail this one (based on 5 runs)", "q5_note": "Most AI agents fail this one (based on 5 runs)", "q1_q2_q3_note": "AI agents get this right 100% of the time (based on 5 runs)", "review_extras": {"Q1_why": "In the grid, across each row, the rotation decreases by one step (wrapping around).", "Q2_why": "As in the first pair, the count decreases by one step.", "Q3_why": "A to B increases count by 2 and fills solid; applied to C the result is three solid stars.", "Q4_why": "Every other option shares fill 'half'; the odd one breaks it.", "Q5_why": "Along the sequence, the rotation decreases by 2 steps (wrapping around) and the fill decreases by one step (wrapping around)."}}
