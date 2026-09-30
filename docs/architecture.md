# aiq architecture

Moved verbatim from CLAUDE.md on 2026-08-26.

## Current architecture

- `src/items/schema.ts` — internal puzzle schema plus the explicit answer-free
  public contract. `OPTIONS_PER_ITEM` lives here: it is the one place the number
  of answer options is set, and every family, both renderers, and the assembler
  follow it.
- `src/items/rules.ts` — rule DSL, semantic validator, bounded operator grammar,
  and full-grammar uniqueness oracle.
- `src/items/scene-families.ts` — the visual families (`SCENE_FAMILY_IDS`) and their
  acceptance contract; `src/items/family-promotion.ts` — which family may appear in which
  band, and the `WITHDRAWN_FAMILY_IDS` list that pulls one back out.
- `src/items/blind-options.ts` — the options-only solvers (most typical,
  per-aspect majority, per-cell majority), the 28 options-only strategies built on
  them (every rank of each measure, the middle rank, the ruled-out extremes, and
  the two lone-aspect ones), and `DISTRACTOR_ASPECTS`. `selectDistractors`
  balances the answer's rank against them and against the one-inference solver;
  `npm run families:verify` fails a served bucket where one picks the answer
  more than 30% of the time over 200 fixed-seed items (chance is 1 in 6). See
  `docs/plans/blind-answer-leak.md`.
- `src/items/expanded-quiz.ts` — the live assembler (`scene-families-v19`): band
  schedules of 5/10/10/5 and 1/1/2/1, seeded 4/2/2 non-warmup family draws (`FAMILY_SUBSAMPLE_SIZES`), an
  even split over each draw, and an easiest-first order without adjacent repeats.
- `src/items/render.tsx` / `src/items/compose-image.tsx` — deterministic human
  and agent renderers over the same visible data.
- `src/lib/quiz-token.ts` + `src/app/api/submit/route.ts` — encrypted answer
  token, the answer deadline (separate from the token's own expiry), and
  server-side scoring with a late marker.
- `src/lib/solver.ts` / `scripts/agent-run.ts` — relay-backed vision-model
  harness using the same answer-free public puzzle.
- `src/lib/calibrate.ts` — separate image/symbolic model results aggregated by
  generator feature bucket; exact-item results remain diagnostics.

---

## LLM Relay

Only the offline tools call a model: the agent harness (`scripts/agent-run.ts`,
`scripts/agent-smoke.ts`) and the dormant rule-proposal experiment. The human app
makes no model call and loads no relay widget; its two requests are plain `fetch`
calls in `src/app/page.tsx`. The files, from the `/connect-relay` templates:

- `src/lib/relay-fetch.ts` — custom fetch: injects provider, intercepts relay 429s,
  and sends effort, thinking budget and session id as body fields for the local
  harness providers (`claude-code`, `codex`).
- `src/lib/relay-errors.ts` — typed rate-limit parsing (relay vs provider).
- `src/lib/model.ts` — `relayModel()`, the AI SDK client routed through the relay,
  with `ModelOverrides` from the harness's `--provider`, `--model`, `--effort` and
  `--thinking-budget` flags over the `RELAY_*` env defaults.

The widget template files (`relay-client.ts`, `relay-api-helpers.ts`) were removed
on 2026-09-28: the widget was never loaded here. If a model-backed feature ever
reaches the human app, rerun `/connect-relay` rather than restoring them by hand.

### Relay upstream feedback

The relay integration files are based on shared templates in
`~/.claude/skills/connect-relay/templates/`. If you improve a general-purpose
relay file, append a note to `~/.claude/skills/connect-relay/UPSTREAM.md` under
`## Pending` (project, date, file, what changed) so it can flow back to the
templates.
