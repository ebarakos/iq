# ui-qa storyboard — aiq (run 2026-06-10T2030)

One section per journey. Full step tables in each tour's `verdicts.md`; this is the skim.
All shots are 1:1 viewport pixels at 1440×900 unless noted.

## T1 — Take the test with the mouse (rerun) — **pass-with-friction**

intro → Start test → Q1..Q5 (answers C/A/D/D/B) with a Back-verify detour → 5/5 (100%).

| moment | shot | expectation | verdict |
|---|---|---|---|
| intro | [step-01-before](T1/shots/step-01-before.png) | two start options | match |
| select on Q1 | [step-03-after](T1/shots/step-03-after.png) | tile highlights, Next enables | match |
| Back-verify | [step-08-after](T1/shots/step-08-after.png) | earlier answer still selected | match |
| hover artifact | [step-14-after](T1/shots/step-14-after.png) | one selection visible | violation → reclassified: hover/selected ambiguity (see findings) |
| results | [step-16-after](T1/shots/step-16-after.png) | score + review | match (5/5, agent-stat chips present) |

Two mid-journey restarts were environment interference (driver context stolen), not app behavior.

## T2 — Keyboard-only quiz (rerun) — **pass-with-friction**

Start (one mouse click) → keys `2 ⏎ 3 ⏎ 1 ⏎ 4 ⏎ 3 ⏎` → 1/5 (20%).

| moment | shot | expectation | verdict |
|---|---|---|---|
| hint found | [step-01-after](T2/shots/step-01-after.png) | shortcut hint visible | match (small grey text) |
| digit selects | [step-02-after](T2/shots/step-02-after.png) | select, no auto-advance | match |
| Enter advances | [step-03-after](T2/shots/step-03-after.png) | exactly one question forward | match |
| submit | [step-11-after](T2/shots/step-11-after.png) | score with /5 denominator | match |

Every key did exactly what the hint promises (confirmed independently by probe R5).

## T3 — Change your mind and start over — **pass**

Start → answer Q1+Q2 → Restart (dismiss first, then accept) → fresh test.

| moment | shot | expectation | verdict |
|---|---|---|---|
| dialog dismissed | [step-06-after](T3/shots/step-06-after.png) | progress untouched | match |
| dialog accepted | [step-07-after](T3/shots/step-07-after.png) | back to intro, state gone | match |
| fresh start | [step-08-after](T3/shots/step-08-after.png) | Q1, nothing selected | match |

## T4 — Generate a fresh AI test (failure path) — **pass-with-friction**

Fresh-AI click → instant fallback with error banner → completed fallback questions.

| moment | shot | expectation | verdict |
|---|---|---|---|
| generation attempt | [step-02-after](T4/shots/step-02-after.png) | visible generating state | violation: instant Q1 + jargon banner |
| fallback works | [step-06-after](T4/shots/step-06-after.png) | questions function normally | match |

Journey tail cut by environment (browser killed); fallback path itself fully functional.

## T5 — Pick up where you left off — **pass**

Reload mid-test (Q1=B, Q2=C answered) → restored to Q2 with C selected → Back shows B → finish → 3/5.

| moment | shot | expectation | verdict |
|---|---|---|---|
| post-reload | [step-01-before](T5/shots/step-01-before.png) | Q2, answer still selected | match |
| Back check | [step-02-after](T5/shots/step-02-after.png) | Q1 shows B | match |
| results | [step-10-after](T5/shots/step-10-after.png) | score counts restored answers | match (review attributes B/C correctly) |

## Sweep — 3 phases × 375/768/1440 — see [sweep/verdicts.md](sweep/verdicts.md)

Key shots: [active-375x812-seg2](sweep/active-375x812-seg2.png) (Next/gear overlap),
[result-375x812-seg1](sweep/result-375x812-seg1.png) (chip wrap),
[intro-1440x900-seg1](sweep/intro-1440x900-seg1.png) (dead space).

## Invalidated first run

`T1-contaminated/` and `T2-contaminated/` hold the first parallel run, invalidated by
cross-driver contamination (proof: `T2-contaminated/shots/step-02-after.png` ≡
`T1-contaminated/shots/step-06-before.png`). Kept for the record; see findings.md §Downgraded.
