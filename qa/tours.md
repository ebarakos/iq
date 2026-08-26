# ui-qa tours — aiq visual IQ test

User-goal journeys for the quiz app. Maintained by ui-qa runs; human-reviewable.
App under test: `npx next start -p 3100` (production build). `QUIZ_TOKEN_SECRET` must be set in the server's environment or every test start fails with "Test scoring is temporarily unavailable" — use a throwaway local value for QA.

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

## T6 — Long test on your phone

start: http://localhost:3100/
precondition: viewport is set to 375x812 (phone) before the journey starts
goal: You only have your phone. Take the LONG test (the one with 30 questions) from start to finish on this small screen. Answer at your own pace but keep an eye on the time the app gives you for the whole test. Along the way: skip at least two questions you find hard, come back to them later and answer them, and double-check that every panel of every puzzle is actually readable on this screen — if you ever have to guess because pieces are too small, cramped, or cut off, say so in that step. Finish, read your score, and skim the per-question review to the bottom.
max_steps: 60

## T7 — Quick test on your phone

start: http://localhost:3100/
precondition: viewport is set to 375x812 (phone) before the journey starts
goal: Five spare minutes on the bus. Take the SHORT 5-question test on your phone. For every question, look at the whole puzzle before answering — report any question where options overlap, panels shrink to the point of ambiguity, or you must scroll sideways. Then finish and check your score and the review screen fit the phone screen.
max_steps: 22

## T8 — Try the pilot on your phone

start: http://localhost:3100/prototypes
precondition: viewport is set to 375x812 (phone) before the journey starts
goal: You agreed to help pilot new puzzle prototypes from your phone. Work through the first three items honestly: for each one, study the puzzle, lock in your answer, and answer whatever follow-up questions the page asks after revealing the result. Report any place where the puzzle art is cramped, cut off, or you must guess from too-small pieces. After the third item, look for where the page shows your progress so far and whether there is a way to hand your results back at the end — describe what you find without finishing all items.
max_steps: 26

## T9 — Follow a broken link

start: http://localhost:3100/
precondition: viewport is set to 375x812 (phone) before the journey starts
goal: A friend texted you a link to this app but mistyped it. Go directly to http://localhost:3100/tesst (that exact address). Judge how the app treats you: does it explain the page doesn't exist, and does it offer a way to the real start? Use whatever it offers to reach the actual test start screen. If it dumps you somewhere confusing with no way out, that is the finding.
max_steps: 10
