# TODO

Short-lived task/checklist state. Design lives in [BRAINSTORM.md](BRAINSTORM.md)
(ideation) and `docs/plans/<slug>.md` (once formalized).

## 2026-06-04 — Project init (planning phase)

- [x] Create init files (CLAUDE.md, README, .gitignore, .env.example, BRAINSTORM, TODO)
- [x] `git init`
- [ ] Confirm interpretation of "visibility only" (BRAINSTORM Q1)
- [ ] Brainstorm session: settle item format (Mensa baseline vs novel) — BRAINSTORM Q3–Q6
- [ ] Decide how agents attempt visual items (vision model vs symbolic form) — Q2
- [ ] Define difficulty ladder + calibration approach — Q5
- [ ] Define scoring / human–agent comparability — Q7

## 2026-06-05 — MVP prototype (human-facing, relay-generated)

- [x] Scaffold Next.js + TS + Tailwind app (deployable on Vercel)
- [x] Zod puzzle schema: structured cell spec (matrix / sequence / analogy / odd-one-out)
- [x] Deterministic SVG renderer (drawn puzzle always matches declared answer)
- [x] Relay client via `createRelayFetch` + `client.chat()`; generate → validate → retry
- [x] `/api/generate` route + hand-authored fallback bank for resilience
- [x] Quiz UI: intro → 5 questions → final score + per-item review
- [x] End-to-end verified against live relay (openrouter/deepseek: 5/5 correct)
- [ ] Register aiq in `../llm-relay/CONSUMERS.md` — done; run `/connect-relay` later to
      add the widget (per-user provider/model switching) the full template includes

## Next (needs design before building — plan mode → TODO)

- [ ] Semantic validator: re-derive the answer from the rule, reject/regenerate
      mis-marked items (the core reliability gap — see BRAINSTORM Q4/Q5)
- [ ] Agent mode: run the same items against a relay model, report pass rate by tier
- [ ] Difficulty calibration from attempt data (human vs agent gap)
- [ ] Persist results / item bank as data; more item types & generators
