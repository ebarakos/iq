# Journey: T2
goal_achieved: yes
steps_taken: 11
## As a user, this is what happened
I landed on the intro screen and clicked "Start test" with the mouse — the only mouse action in the entire journey. Question 1 immediately showed a tip at the bottom: "press 1–6 to answer, ← → to navigate, Enter to continue", which gave me everything I needed. I used number keys (1–4) to select an answer on each of the 5 questions, then pressed Enter to advance; every key did exactly what the hint said — the selected option card gained a dark border, the Next/See results button lit up, and Enter moved me forward. On the last question the button changed to "See results" and Enter submitted all answers, landing me on the score screen showing 1 / 5 (20% correct) with a per-question review below. The "/ 5" denominator on the score screen matches the 5 questions I navigated through.

## Friction
- The tip text is subtle grey and small — easy to miss on a quick first glance; there is no dedicated "keyboard shortcuts" section or tooltip.
- The first question loaded with option A already appearing visually selected (highlighted border), but pressing "1" still registered as selecting A — so the pre-highlight was cosmetic focus, not a confirmed selection. A first-time user might assume they can skip pressing a key for Q1.
- No arrow-key navigation was tested (not needed), but the hint promises it; its behavior is unverified.
- The score screen does not explicitly label what the denominator represents (e.g., "out of 5 questions") — the format "1 / 5" is self-explanatory but could be clearer with a label.

## Final mental state
{"current_question":"results","answers_selected":{"q1":"B","q2":"C","q3":"A","q4":"D","q5":"C"},"keys_pressed":["2","Enter","3","Enter","1","Enter","4","Enter","3","Enter"],"score":"1/5","all_keys_matched_hint":true,"surprise_count":0}
