# aiq architecture

Moved verbatim from CLAUDE.md on 2026-08-26.

## Current architecture

- `src/items/schema.ts` — internal puzzle schema plus the explicit answer-free
  public contract. `OPTIONS_PER_ITEM` lives here: it is the one place the number
  of answer options is set, and every family, both renderers, and the assembler
  follow it.
- `src/items/rules.ts` — rule DSL, semantic validator, bounded operator grammar,
  and full-grammar uniqueness oracle.
- `src/items/scene-families.ts` — the 15 visual families and their acceptance
  contract; `src/items/family-promotion.ts` — which family may appear in which
  band, and the `WITHDRAWN_FAMILY_IDS` list that pulls one back out.
- `src/items/expanded-quiz.ts` — the live assembler (`scene-families-v15`): band
  schedules of 5/10/10/5 and 1/1/2/1, seeded 4/4/3 non-warmup family draws, an
  even split over each draw, and an easiest-first order without adjacent repeats.
- `src/items/generate.ts` — the older seeded generator. `procedural-v1`, `v2`,
  and `v3` are kept only so golden-seed replay tests keep passing.
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

Model access is wired (via `/connect-relay`) using the battle-tested templates:
- `src/lib/relay-fetch.ts` — custom fetch: injects provider, intercepts relay 429s.
- `src/lib/relay-errors.ts` — typed rate-limit parsing (relay vs provider).
- `src/lib/relay-client.ts` — client widget headers + `apiFetch()` (UI).
- `src/lib/relay-api-helpers.ts` — `readWidgetOverrides()` + `errorResponse()` (server).

### Widget — per-user model selection

The root layout (`src/app/layout.tsx`) loads the relay **widget** (`/widget.js`,
derived from `RELAY_BASE_URL`). It gives users an in-browser control to pick
provider/model and enter a BYO key, persisted to localStorage. `apiFetch()`
forwards the choice as headers (`X-Relay-Provider`/`X-Relay-Model`/`X-User-Api-Key`),
`readWidgetOverrides()` reads them server-side, and `generatePuzzles(overrides)`
uses them over the env defaults (the env BYO key is auto-picked when the chosen
provider matches). Unlike most relay apps, the widget here is **optional** — aiq
works on the env default + sample fallback — so a widget load failure is
non-blocking (console warning, not a full-screen overlay).

### Relay upstream feedback

The relay integration files (once added) are based on shared templates in
`~/.claude/skills/connect-relay/templates/`. If you improve a general-purpose
relay file, append a note to `~/.claude/skills/connect-relay/UPSTREAM.md` under
`## Pending` (project, date, file, what changed) so it can flow back to the
templates.
