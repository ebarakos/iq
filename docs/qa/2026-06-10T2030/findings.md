# ui-qa findings — aiq (run 2026-06-10T2030)

App under test: production build (`next start -p 3100`), bank-serving default, calibrated bank
(60 items, 5-run agent stats). Tours: see [qa/tours.md](../../../qa/tours.md). Journey detail:
per-tour `verdicts.md`; raw evidence in `T*/shots/` + `T*/steps.jsonl`.

## Error sweep (mechanical, 4a)

All captured driver error logs are **empty** — zero console errors, zero uncaught exceptions,
zero failed/4xx/5xx requests across every journey and the sweep (`T1/errorlog.json`,
`T3/errorlog.json`, `T4/errorlog.json`, `T5/errorlog.json`; wave-1 T2's log was lost to a
driver crash before capture). No automatic findings.

## Findings (deduped, ranked)

- **[high] `judge` `confirmed` — Fresh-AI failure banner exposes raw provider jargon.**
  When "Generate a fresh test with AI" fails, the banner reads: *"Could not generate puzzles
  via the relay (Access denied by 'groq'. Your key may be invalid, revoked, or the provider
  may be blocking your region.). Showing sample items from the item bank instead."*
  "groq", "key", "region", and "relay" mean nothing to a quiz-taker and read as something
  being broken. The recovery sentence is good; the diagnostic payload isn't for end users.
  (T4 step 2, `T4/shots/step-02-after.png`.)

- **[med] `judge` `confirmed` — No perceivable feedback that AI generation was attempted.**
  The provider rejects in under a second, so the user sees the start card replaced instantly
  by Q1 + error banner — no visible "generating…" moment ever appears. A loading screen
  exists but cannot be perceived on the fast-failure path, making the failure feel like the
  button simply misfired into an error. (T4 step 2, before/after pair.)

- **[med] `judge` `confirmed` — Hover/focus borders on option tiles read as selection.**
  Five independent observers (both rerun actors, three judges) at some point believed an
  option was "pre-selected" or "two options selected at once". Ground truth (`aria-pressed`,
  reverify R2/R4/R5) shows exactly one selection always — but a parked cursor's hover border
  and the focus ring are visually close enough to the selected border (grey-on-grey) that
  users can't reliably tell which answer is recorded, which undermines the back-to-verify
  workflow. (T1 steps 6/13/14, `T1/shots/step-14-after.png`; T2 step 2; T3 step 4; T5 step 6.)

- **[med] `judge` — Fallback error banner persists across all five questions.** Once fresh
  generation fails, the full error text dominates the top of every question for the whole
  session; after the first question it's noise. (T4 steps 2–9.)

- **[med] `sweep` — "Next →" button overlaps the widget gear FAB at mobile width.** At
  375×812 the fixed gear button sits partially behind the Next button's right edge, making
  both targets harder to hit. (`sweep/active-375x812-seg2.png`.)

- **[low] `judge` — Keyboard hint only appears once a question is on screen, in small light-
  grey text; nothing on the intro mentions keyboard support.** (T2 step 1.)

- **[low] `judge` — Hint says "Enter to continue" on the last question even though the button
  has become "See results".** (T2 steps 9–11.)

- **[low] `judge` — "Restart" is a plain header text link with no destructive styling;** the
  confirm dialog is the only guard (the dialog itself works correctly — dismiss preserves
  state, accept clears it, verified in T3). (T3 step 6–7.)

- **[low] `judge` — Review "Why" explanations use internal rule vocabulary** ("rotation
  decreases by one step (wrapping around)", "fill decreases") with no visual link to the
  cells they describe. (T1 step 17.)

- **[low] `judge` — "From the calibrated item bank" attribution is insider jargon** to a
  first-time test-taker. (T1 step 16.)

- **[low] `sweep` — At 375px the agent-stat chip wraps to two tight lines, and the A/B/C/D
  letters in review tiles are very light grey,** close to background contrast.
  (`sweep/result-375x812-seg1.png`, `-seg2.png`.)

- **[low] `sweep` — Intro card strands a large empty grey zone below it on tablet/desktop.**
  (`sweep/intro-768x1024-seg1.png`, `intro-1440x900-seg1.png`.)

## Downgraded / not app defects (4b reverification)

- **Wave-1 "state corruption" cluster — test-environment artifact, fully root-caused.** The
  first parallel run produced dramatic findings (answer overwritten on Back, Q1→Q4 jump,
  dual selections, mid-test start). Reverification could not reproduce any of them
  (R1–R3: fresh visit shows intro; Back preserves `aria-pressed`; Next from Q1 → Q2), and
  pixel comparison proved the T2 actor was driving T1's browser on the same port —
  `T2-contaminated/shots/step-02-after.png` is identical to
  `T1-contaminated/shots/step-06-before.png`. T2's key presses mutated T1's quiz; T2's stray
  `/goto` was masked by the (correctly working) session restore. Sequential reruns of both
  tours passed. Artifacts kept in `T1-contaminated/`, `T2-contaminated/`.
- **Driver context steals / "browser closed" (T1 rerun, T4 tail)** — an unrelated automation
  stack on this machine (app on :3101, driver on :4317) interferes with browsers/ports;
  wave-1 traces and T2 logs were lost to it. Infrastructure, not app.
- **Keyboard semantics** — R5 probe confirms the hint is accurate: digits select (no
  auto-advance), Enter advances, arrows navigate with answers preserved.

## Journey verdicts

| Tour | Verdict | Notes |
|---|---|---|
| T1 mouse quiz (rerun) | pass-with-friction | 5/5 score consistent; Back-verify works; friction = hover ambiguity, terse Why copy |
| T2 keyboard quiz (rerun) | pass-with-friction | every key matches the hint; low-severity hint placement/wording |
| T3 restart | pass | confirm dialog guards; dismiss preserves, accept truly resets |
| T4 fresh AI test (fallback path) | pass-with-friction | fallback works; banner jargon + no perceivable attempt feedback |
| T5 resume after reload | pass | restore is seamless and answer-faithful end-to-end |

## Appendix — error log dumps

All captured logs: `{"ok":true,"count":0,"errors":[]}` (T1, T3, T4, T5).
Traces: `T3/trace.zip`, `T5/trace.zip` (T1/T2/T4 traces lost to environment interference).
