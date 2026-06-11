# Journey: T3
goal_achieved: yes
steps_taken: 8

## As a user, this is what happened
I landed on a clean intro screen for a 5-question visual IQ test and started the test. On Question 1, an analogy puzzle appeared with four shape-based answer options; I picked Option A and clicked Next. On Question 2, a grid-completion puzzle appeared; I selected Option A again. At that point I decided I wanted a clean slate and clicked the "Restart" button visible throughout the quiz. The app showed a browser confirmation dialog — "Discard your current test and start over?" — protecting my in-progress answers. I first dismissed the dialog to verify my test was untouched (it was — still on Q2 with my answer selected). I then clicked Restart a second time and accepted the dialog. The app returned me to the intro screen with no quiz state. Clicking "Start test" again brought up a brand-new Question 1 with a completely different puzzle, no pre-selected answers, and both navigation buttons in their initial (disabled) state — confirming a true fresh start.

## Friction
- The app did NOT confirm the restart was happening visually before showing the dialog — the button label "Restart" is clear but there is no inline tooltip or destructive styling (e.g., red color) to prime the user that this will discard progress.
- The native browser confirm dialog is functional but plain; it carries no context about how many questions were already answered or that the action is irreversible once accepted.
- After accepting the restart, the transition goes to the intro screen (not directly to Q1), requiring one extra click to begin a new test — a minor extra step.

## Final mental state
{"current_screen": "question", "questions_answered": [], "current_question": 1, "fresh_test_confirmed": true, "puzzle_changed_after_restart": true, "no_preselected_answers": true, "restart_guards_progress": true}
