# ui-qa tours — aiq visual IQ test

User-goal journeys for the quiz app. Maintained by ui-qa runs; human-reviewable.
App under test: `npx next start -p 3100` (production build).

## T1 — Take the test with the mouse

start: http://localhost:3100/
precondition: none
goal: You want to measure your visual pattern-solving. Take the 5-question test from start to finish using your mouse — answer every question with your honest best guess, use Back at least once to double-check an earlier answer, then finish and read your final score and the per-question review. In the review, note anything the app tells you about each question beyond right/wrong (any extra context or statistics it offers).
max_steps: 22

## T2 — Take the test with the keyboard

start: http://localhost:3100/
precondition: none
goal: You prefer the keyboard to the mouse. Start the test, then complete all 5 questions using only key presses — the app mentions shortcut keys somewhere; find that hint and use those keys to select answers and move forward. Verify at the end that the score screen's count matches the number of questions you believe you answered.
max_steps: 22

## T3 — Change your mind and start over

start: http://localhost:3100/
precondition: none
goal: Start the test and answer the first two questions. Then decide you want a clean slate: find how to start over. Pay attention to whether the app checks before throwing away your progress. After starting over, confirm you are truly back at the beginning — a fresh test at question 1 with nothing pre-selected.
max_steps: 16

## T4 — Get a brand-new AI-generated test

start: http://localhost:3100/
precondition: none
goal: You've heard this app can create entirely fresh puzzles with AI instead of serving its standard set. Find that option from the start screen and use it. While it works, observe how the app keeps you informed. Complete the test it gives you (quick guesses are fine) and check the end screen for any mention of where these questions came from. If fresh generation fails, note exactly what the app tells you and whether you can still take a test.
max_steps: 28

## T5 — Pick up where you left off

start: http://localhost:3100/
precondition: A test was already in progress in this browser — the first two questions were answered — and the page was then reloaded.
goal: Your browser just reloaded while you were mid-test. Check whether the app put you back where you left off: you expect to be on the same question you were on, and going Back should show your earlier answers still selected. Then finish the remaining questions and view your score.
max_steps: 18
