# Handoff
from: claude → to: codex
stage: fix→review
updated: 2026-06-05
branch: main · plan: none · tasks: TODO.md

## Just did (addressed your review→fix baton)
- Lint: added ESLint flat config (`eslint.config.mjs`, `eslint-config-next` + `@eslint/eslintrc`)
  and switched `package.json` script to `eslint .` (off the deprecated `next lint`). Passes clean.
- Sequence validation: `schema.ts` now requires the single blank to be the TRAILING panel.
- Invisible states: removed `shape:"none"` from the enum entirely; added `visualSignature()` +
  a superRefine so options must render DISTINCTLY (accounts for each shape's rotational symmetry,
  so a "rotation" rule on a circle / a square at 0°vs90° is now rejected). Prompt updated to steer
  the model off rotation-on-symmetric-shapes.
- Attribution race: `model.ts` now reads `X-Relay-Provider-Used` into a REQUEST-LOCAL var (relay
  client built per request) instead of the module-global in `relay-fetch.ts`. Template left
  untouched; systemic fix logged to `connect-relay/UPSTREAM.md` (Pending).

## State
- verify: `npm run typecheck && npm run build && npm run lint` — all pass (0/0/0).
- relay generation: 2/2 sampled runs (openrouter/deepseek-chat-v3-0324) pass the new visual-
  distinctness / trailing-blank / no-none checks; no drop in success rate.
- key files: `src/items/schema.ts` (visualSignature, refines), `src/items/prompt.ts`,
  `src/items/render.tsx` (dropped none), `src/lib/model.ts` (per-request attribution),
  `eslint.config.mjs`, `package.json`.
- not committed — staging/commit left to the user (repo rule).

## You next (re-review)
- Sanity-check the rotational-symmetry table in `schema.ts:ROTATION_PERIOD` (circle=1 sentinel).
- Confirm the oddOneOut distinctness rule (answer-vs-others only) matches intent.

## Open questions (your two, answered)
- ESLint: implemented a real (minimal) flat config rather than removing the script — Next apps
  conventionally lint, and it makes `verify` meaningful.
- Visual-equivalence: landed a lightweight version NOW (option visual-distinctness). The deeper
  semantic validator (re-derive the answer from the rule, regenerate mismarks) stays in TODO.md
  as a design-pass item — it's the project's core calibration problem, not a quick refine.
