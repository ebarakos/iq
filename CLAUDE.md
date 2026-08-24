# aiq — IQ tests for humans and agents

> A web app that generates visual IQ-style puzzles of increasing difficulty and
> administers them to **both humans and AI agents**, using a difficulty ladder to
> separate "human-hard" from "agent-hard" items.

**Status: GENERATED REASONING-TEST PROTOTYPE.** The app serves two test lengths,
5 and 30 questions, both drawn from the same pool of 14 eligible visual reasoning
families (20 code-valid families, six withdrawn on human or structural evidence)
and the same four difficulty bands. Every test is generated from a fresh seed,
validated in pure code, served without answers, and scored server-side against a
whole-test deadline of 60 seconds per question. Every question offers six
answer options, so a blind guess is worth 1 in 6. Families ship behind a visible
experimental label: they pass the code-correctness contract, and the first human
pilots (one participant, 14 of 15 items correct — see `data/pilot/README.md`) and
the first trustworthy agent probes have run. That evidence is enough to withdraw
families, not to calibrate difficulty, so this is not a standardized IQ score. See
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

### Running the MVP

```bash
npm install
npm run dev          # http://localhost:3000
```

Production requires `QUIZ_TOKEN_SECRET` for encrypted answer tokens. Relay env is
needed only for the agent harness and offline model experiments; human tests do
not make model calls. See `.env.example`.

### Current architecture

- `src/items/schema.ts` — internal puzzle schema plus the explicit answer-free
  public contract. `OPTIONS_PER_ITEM` lives here: it is the one place the number
  of answer options is set, and every family, both renderers, and the assembler
  follow it.
- `src/items/rules.ts` — rule DSL, semantic validator, bounded operator grammar,
  and full-grammar uniqueness oracle.
- `src/items/scene-families.ts` — the 20 visual families and their acceptance
  contract; `src/items/family-promotion.ts` — which family may appear in which
  band, and the `WITHDRAWN_FAMILY_IDS` list that pulls one back out.
- `src/items/expanded-quiz.ts` — the live assembler (`scene-families-v8`): band
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

## Concept (working definition)

- **What:** A growing battery of IQ-style test items (Mensa-style matrices,
  sequences, analogies — or a novel format if we find a better one) ordered by
  increasing complexity.
- **Audience:** Dual — the same item pool is presented to **humans** and to
  **agents** (LLMs / multimodal models). 
- **Visual-only ("visibility only"):** Items are intended to be purely visual /
  language-independent — no text comprehension, no culture-specific knowledge —
  so the test is fair across humans and vision-capable agents. *(Assumption to
  confirm — see BRAINSTORM Q1.)*
- **Adaptive audience routing:** Difficulty is calibrated against agents. If
  agents solve an item trivially, it is tagged/defaulted as a **human** test;
  items that still challenge agents are the frontier. The interesting signal is
  the gap between human-hard and agent-hard.
- **Open to a novel format.** Standard Mensa-style is the baseline, not a
  constraint. Better ideas are welcome and should be captured in BRAINSTORM.md.

This is a deliberately loose definition — it will be sharpened in later
brainstorming sessions before any implementation.

---

## Tech stack (proposed — confirm before scaffolding)

| Layer | Proposed choice | Rationale |
|---|---|---|
| Host | **Vercel** | Required by the user; first-class Next.js support |
| Framework | Next.js (App Router) | Frontend + API routes in one deploy, no separate proxy |
| Language | TypeScript (strict) | Type safety across item schemas and scoring |
| Model access | **llm-relay** (see below) | All model calls (item generation + agent solving) go through the relay |
| Validation | Zod | Validate generated item structures and model responses |

Nothing here is locked except **JS/TS + Vercel + llm-relay** (explicit user
requirements). Framework and libraries are proposals open to revision.

---

## LLM Relay

All model calls (generating test items, and any agent-side solving/calibration)
go through [`llm-relay`](../llm-relay) — a Cloudflare Worker proxy. **No provider
API keys live in this repo.** The relay manages keys, enforces rate limits, and
lets us swap providers centrally.

Configure via env vars only — never hardcode URLs, providers, or model names:

```
RELAY_BASE_URL   # required — relay endpoint, e.g. https://llm-relay.ebarakos.workers.dev/v1
RELAY_PROVIDER   # required — provider the relay routes to, e.g. cerebras
RELAY_MODEL      # required — model name, e.g. llama3.1-8b
```

- Production relay: `https://llm-relay.ebarakos.workers.dev/v1`
- Local relay (running `../llm-relay` via `wrangler dev`): `http://localhost:8787/v1`
- Allowed providers/models: see [`../llm-relay/allowed-models.json`](../llm-relay/allowed-models.json).
- BYO keys (optional): per-provider keys (`CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are forwarded as
  `X-User-Api-Key` to bypass the relay's shared quota. `.env` only — never commit.

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

---

## Planned repo layout (not yet created)

```
src/            # app + core (TBD once framework confirmed)
src/lib/        # relay integration (added by /connect-relay)
src/items/      # item generators / schemas (visual puzzle definitions)
docs/plans/     # formalized design docs (slug per design)
BRAINSTORM.md   # free-form ideation + open questions  ← current focus
TODO.md         # short task/checklist state
```

---

## Workflow (see ~/.claude/CLAUDE.md for the full Flow)

- Planning ends at **TODO.md**, never at implementation. A plan-mode session
  produces checkable `- [ ]` items, not code.
- Single source of truth: design → `docs/plans/<slug>.md` (or BRAINSTORM.md while
  still ideating), status → `TODO.md`, baton → `docs/handoff.md`.
- Conventional commits. Never commit or push without explicit permission.
- Prefer editing existing files over creating new ones; don't add docs unless asked.
