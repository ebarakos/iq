# TODO

One agent works this single backlog top to bottom. Design and decisions: [deterministic novel tests](docs/plans/deterministic-novel-tests.md).

## 2026-08-16 — two test lengths and a timer

### Then implement

- [ ] Build a new emergency bank from the expanded families. The current 69-item bank holds only legacy families, so this is a new bank rather than an extension of the old one, and it must cover both test lengths (`data/bank/items.json`, `src/items/bank.ts`, `scripts/bank-topup.ts`).

### Human verification — needs real participants

- [ ] Run the desktop and mobile human-solvability pilot for every family and difficulty. Every family is already public behind the experimental label, so the pilot's job is to withdraw the ones that fail, not to admit the ones that pass.
- [ ] Finish 30-question-test verification with real human pilots, and remove or redesign families that prove trivial or confusing.
- [ ] Cover mobile with a `/ui-qa` browser pass and manual spot checks. There is no visual regression suite and it is not a release requirement; see the parked note in `BRAINSTORM.md` for the condition that brings one back.
