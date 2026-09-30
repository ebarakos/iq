# TODO

Work this backlog top to bottom. Designs, branch targets, and evidence gates: [escalate the quiz](docs/plans/escalate-the-quiz.md) for v11; [raise the ceiling (d6 tail)](docs/plans/raise-the-ceiling-v12.md) records the d6 tier that was built and then withdrawn; [the answer must not be guessable from the options alone](docs/plans/blind-answer-leak.md) for v19.

## 2026-09-30 — from the bug inbox

- [ ] On a 375 px phone, land each question change on the puzzle diagram, not the top of the page: today the header, countdown and 30 question pills push the diagram 424 px down and `scrollTo(0)` scrolls to the pills (accepted from `docs/bugs.md` 2026-09-28; `src/app/page.tsx:682`, `:755`).

## 2026-08-27 — the owner's correction: novelty over depth

- [ ] Probe the first generator after the blind-answer fix (not `scene-families-v18`, whose options give away about 60% of answers) for agent evidence; the previous attempt was blocked because the Codex harness bridge rejected images and returned 502 for every model (`data/attempts/`, `scripts/agent-run.ts`).
