# aiq — IQ tests for humans and agents

> A web app that generates visual IQ-style puzzles of increasing difficulty and
> administers them to **both humans and AI agents**, using a difficulty ladder to
> separate "human-hard" from "agent-hard" items.

**Status: PLANNING.** No application code yet. The concept and open design
questions live in [BRAINSTORM.md](BRAINSTORM.md); short-lived task state in
[TODO.md](TODO.md). Do not scaffold the app or write feature code until the
design is settled and a plan is approved (plan mode → TODO).

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

**When we implement model access, use the `/connect-relay` skill** rather than
hand-rolling the integration. It copies the battle-tested templates
(`relay-fetch.ts`, `relay-errors.ts`, and for Next.js `relay-api-helpers.ts` /
`relay-client.ts`), wires env vars, adds the widget loader, and registers this
project in `../llm-relay/CONSUMERS.md`. Reference consumers: `aletheia`,
`crystalball`, `oneiromancer`.

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
