# TODO

Short-lived task/checklist state. Design lives in [BRAINSTORM.md](BRAINSTORM.md)
(ideation) and `docs/plans/<slug>.md` (once formalized).

## 2026-06-04 — Project init (planning phase)

- [x] Create init files (CLAUDE.md, README, .gitignore, .env.example, BRAINSTORM, TODO)
- [x] `git init`
- [ ] Confirm interpretation of "visibility only" (BRAINSTORM Q1)
- [ ] Brainstorm session: settle item format (Mensa baseline vs novel) — BRAINSTORM Q3–Q6
- [ ] Decide how agents attempt visual items (vision model vs symbolic form) — Q2
- [ ] Decide generation strategy: procedural vs relay-model vs hybrid — Q4
- [ ] Define difficulty ladder + calibration approach — Q5
- [ ] Define scoring / human–agent comparability — Q7

## Deferred to implementation phase (do NOT start until design is approved)

- [ ] Confirm framework (Next.js?) and scaffold the Vercel app
- [ ] Run `/connect-relay` to wire llm-relay (env vars, relay-fetch, widget, CONSUMERS.md)
- [ ] Define item schema (Zod) + item bank format
- [ ] First generator (one item type, procedural) + render-to-image
- [ ] Agent eval mode: run items against a relay model, report pass rate by tier
