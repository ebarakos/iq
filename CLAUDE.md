# aiq — IQ tests for humans and agents

> A web app that generates visual IQ-style puzzles of increasing difficulty and
> administers them to **both humans and AI agents**, using a difficulty ladder to
> separate "human-hard" from "agent-hard" items.

**Status: MVP PROTOTYPE.** A runnable human-facing test exists (5 relay-generated
visual puzzles → score + review). The concept and open design questions still
live in [BRAINSTORM.md](BRAINSTORM.md); short-lived task state in [TODO.md](TODO.md).
The MVP is a first slice, not the settled design — the agent side, the difficulty
ladder, and the item format remain open and should go through plan mode → TODO
before being built out.

### Running the MVP

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires relay env in `.env.local` (see `.env.example`). With the default
`openrouter` model you must set `OPENROUTER_API_KEY` in `.env.local`; the free
`groq` alternative needs no key. If generation fails (relay down / rate-limited /
invalid output after retries), the app falls back to a built-in sample set and
says so in the UI.

### MVP architecture

- `src/items/schema.ts` — Zod schema. The model emits a **constrained structured
  spec** per cell (shape, count, rotation, fill, size) + the correct option; it
  never draws. Covers matrix / sequence / analogy / odd-one-out.
- `src/items/render.tsx` — deterministic SVG renderer (pure functions of the
  spec), so the drawn puzzle always matches the generator's declared answer.
- `src/lib/model.ts` — relay client (`client.chat()` → OpenAI-compatible
  `/v1/chat/completions`); generates, extracts JSON, validates, and retries with
  the specific Zod failures fed back to the model.
- `src/app/api/generate/route.ts` — POST endpoint; falls back to
  `src/items/fallback.ts` on failure.
- `src/app/page.tsx` — quiz UI (intro → 5 questions → score + per-item review).

**Known MVP limitation:** answer correctness depends on the generating model — a
weak model occasionally mis-marks the correct option. A stronger model (the
OpenRouter default) largely fixes this; a real semantic validator that re-derives
the answer from the rule is future work (see BRAINSTORM Q4/Q5).

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
