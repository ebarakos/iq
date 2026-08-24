# TODO

One agent works this single backlog top to bottom. Design and decisions: [deterministic novel tests](docs/plans/deterministic-novel-tests.md).

## 2026-08-19 — mechanism variety

Design and order of work: [mechanism variety](docs/plans/mechanism-variety.md).

- [x] Re-run the agent probe after each conversion wave and record whether the strong model starts missing items (`npm run agent:run`).

## 2026-08-23 — raise the ceiling

The battery is sound but too easy, and unsoundness keeps reaching people before code catches it. Design and order of work: [raise the ceiling](docs/plans/raise-the-ceiling.md).

- [ ] Fail the build when a sequence strand the solver must extrapolate shows fewer than three terms, so one observed transition can never ship again (`scripts/scene-family-verify.ts`).
- [ ] Extend `composed-transform-v1` to three ordered steps within the same complexity budget and enumeration oracle (`src/items/scene-grammar.ts`, `src/items/scene-families.ts`).
- [ ] Reserve some primitive combinations for a private evaluation set while exposing every primitive separately in the public pool (plan §Lever 2).
- [ ] Design a sound odd-one-out format that demonstrates its shared property instead of expecting it to be guessed; the battery has had none since 2026-08-23 (`src/items/scene-families.ts`).
- [ ] Move one family from `composition` down into `constraint-spatial` (user decided 2026-08-24; propose which family with difficulty evidence before touching the ladder — this changes it, so it needs a validated bucket at the new band and a generator version bump to `scene-families-v9`).
- [ ] Redesign `interleaved-sequence-v2` as `-v3` with a row long enough to show three terms in the answered strand, or drop the idea (`src/items/scene-families.ts`).

## 2026-08-16 — two test lengths and a timer

### Human verification — needs real participants

- [ ] Run the desktop and mobile human-solvability pilot for every family and difficulty (start with `composed-transform-v1`); the pilot withdraws families that fail rather than admitting ones that pass.
- [ ] Take one full 30-question test end to end and record whether the pooled timer, question ordering, skip-and-revisit, and the review screen hold up (`src/app/page.tsx`).
- [ ] Cover mobile with a `/ui-qa` browser pass and manual spot checks; `BRAINSTORM.md` holds the condition for bringing a visual regression suite back.
