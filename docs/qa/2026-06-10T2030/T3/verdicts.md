# Verdicts: T3

## Steps

| step | verdict | evidence |
|---|---|---|
| 1 | match | shots/step-01-before.png: intro screen shows "Take a 5-question visual IQ test" with "Start test" and "Generate a fresh test with AI" buttons. Matches expectation exactly. No errors. |
| 2 | match | shots/step-02-after.png: Q1 of 5 appears with a visual analogy puzzle, four option tiles (A–D), all unselected, Next → button is disabled (grey). Expected transition confirmed. No errors. |
| 3 | match | shots/step-03-after.png: Option A tile gains a thick dark border (genuine selection border, clearly heavier than the unselected tiles). Next → turns dark/enabled. domMutations:4 confirms state change. Expected. |
| 4 | benign-surprise | shots/step-04-after.png: Q2 appears as expected with no genuinely selected option and Next → disabled. However, Option D carries a noticeably lighter border compared to B and C — consistent with a parked-cursor hover artifact (environment note), not genuine selection (Next remains grey, border weight is thin, unlike the thick dark selection ring on A in step 3). Hover border is visually ambiguous and could briefly mislead a real user into thinking D is pre-selected. |
| 5 | match | shots/step-05-before.png and step-05-after.png: Q2 before the click still shows Option D with the same light hover border (parked mouse), all confirmed non-selected. After click, Option A gains a thick dark border and Next → enables. Correct. |
| 6 | match | Record shows dialogs:[{type:"confirm", message:"Discard your current test and start over?", action:"dismiss"}]. After dismiss, shots/step-06-after.png shows Q2 unchanged — Option A selected, Next → enabled, question counter "Question 2 of 5" intact. App correctly protected in-progress answers on cancel. domMutations:0 confirms no state change. |
| 7 | match | Record shows dialogs:[{type:"confirm", message:"Discard your current test and start over?", action:"accept"}]. shots/step-07-after.png: app returns to the intro screen ("Take a 5-question visual IQ test", Start test button). All quiz state discarded. domMutations:3 (minimal — just tearing down quiz state). No errors. |
| 8 | match | shots/step-08-after.png: clicking Start test produces Q1 of 5 with a completely different puzzle (triangles/circles analogy, distinct from the original squares/hexagons puzzle). No option is pre-selected. Next → is disabled (grey). Progress dot indicator shows one filled dot (●○○○○). Progress bar reset. State is genuinely fresh. |

## Journey verdict: pass

The restart flow is correctly guarded: the app shows a native confirm dialog before discarding progress, dismissing it leaves all answers intact, and accepting it returns to the intro screen and then to a clean Q1 with no residual state. The critical question — does restart truly zero out prior answers — is answered affirmatively from the pixels. The one noteworthy surface imperfection is the hover-border ambiguity on Option D when Q2 first loads (step 4), which a real user could momentarily misread as a pre-selection; it resolves immediately on interaction and does not affect test integrity.

## Findings

- [low] **Hover border on first-load option tile is visually ambiguous (steps 4, 5; shots/step-04-after.png, shots/step-05-before.png).** When a question loads and the mouse cursor is parked over an option tile, that tile receives a thin border that is lighter/different enough from unselected peers to be momentarily mistaken for a pre-selection. The "selected" state uses a clearly heavier dark ring (step 3), but the hover state's contrast against the unselected border is narrow. A real user landing here without immediately moving the mouse may briefly believe an answer has been pre-filled for them. This is a styling concern (hover vs. selected differentiation), not a logic bug — Next correctly remains disabled.
- [low] **"Restart" is a low-affordance plain text link in the header (visible in shots/step-02-after.png through step-06-before.png).** It carries no button styling, icon, or visual weight to signal destructive intent before interaction. A user who is not careful could tap it accidentally, relying entirely on the confirm dialog as the sole guard. The dialog itself is adequate, but the trigger's invisibility as a destructive action increases the risk of accidental activation.
