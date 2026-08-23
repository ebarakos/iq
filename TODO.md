# TODO

One agent works this single backlog top to bottom. Design and decisions: [deterministic novel tests](docs/plans/deterministic-novel-tests.md).

## 2026-08-19 — mechanism variety

Design and order of work: [mechanism variety](docs/plans/mechanism-variety.md).

- [x] Re-run the agent probe after each conversion wave and record whether the strong model starts missing items (`npm run agent:run`).

## 2026-08-16 — two test lengths and a timer

### Human verification — needs real participants

- [ ] Run the desktop and mobile human-solvability pilot for every family and difficulty (start with `composed-transform-v1`); the pilot withdraws families that fail rather than admitting ones that pass.
- [ ] Take one full 30-question test end to end and record whether the pooled timer, question ordering, skip-and-revisit, and the review screen hold up (`src/app/page.tsx`).
- [ ] Cover mobile with a `/ui-qa` browser pass and manual spot checks; `BRAINSTORM.md` holds the condition for bringing a visual regression suite back.
