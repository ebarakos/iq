# aiq — IQ tests for humans and agents

> A web app that generates visual IQ-style puzzles of increasing difficulty and
> administers them to **both humans and AI agents**, using a difficulty ladder to
> separate "human-hard" from "agent-hard" items.

The app serves two test lengths, 5 and 30 questions, both drawn from the same pool of eligible
visual reasoning families and the same four difficulty bands. Every test is generated from a
fresh seed, validated in pure code, served without answers, and scored server-side against a
whole-test deadline of 60 seconds per question. Every question offers six answer options, so a
blind guess is worth 1 in 6. Family/band pairs can be withdrawn through configuration when the
retention pilot finds that they miss its documented thresholds. See
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

## Commands

```bash
npm install
npm run dev              # http://localhost:3000
npm run build
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm test                 # vitest run
npm run families:verify  # scene-family acceptance contract
npm run bank:verify      # bank integrity gate (run before committing bank changes)
./qa/run.sh              # QA runner, all suites (from project root)
```

Full local gate, before landing generator, family, or assembler changes:

```bash
npm run typecheck && npm run lint && npm test && npm run families:verify && npm run bank:verify && npm run build
```

The agent harness and offline experiments (`agent:smoke`, `agent:run`, `bank:topup`,
`report`, `render:item`, `pilot:report`) need relay env; see `README.md` and `package.json`.

## Hard rules

- **Visual-only ("visibility only"):** Items are intended to be purely visual /
  language-independent — no text comprehension, no culture-specific knowledge —
  so the test is fair across humans and vision-capable agents.
- `OPTIONS_PER_ITEM` (`src/items/schema.ts`) is the one place the number of answer options
  is set, and every family, both renderers, and the assembler follow it.
- The served puzzle is answer-free: answers ride in the encrypted quiz token and scoring is
  server-side (`src/lib/quiz-token.ts`, `src/app/api/submit/route.ts`).
- Production requires `QUIZ_TOKEN_SECRET` for encrypted answer tokens. Relay env is
  needed only for the agent harness and offline model experiments; human tests do
  not make model calls. See `.env.example`.
- Nothing is locked except **JS/TS + Vercel + llm-relay** (explicit user requirements).
- If you improve a general-purpose relay file, append a note to
  `~/.claude/skills/connect-relay/UPSTREAM.md` under `## Pending` (project, date, file,
  what changed) so it can flow back to the templates.

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
RELAY_EFFORT     # harness providers only — low|medium|high, default for agent:run
```

**Project default since 2026-08-27: `codex` / `sol` at effort `high`**, over the
LOCAL relay (`http://localhost:8787/v1`). That needs `../llm-relay` running under
`wrangler dev` AND the codex harness bridge up; without both, `agent:run` fails to
connect and the hosted OpenRouter line in `.env.example` is the fallback.

- Production relay: `https://llm-relay.ebarakos.workers.dev/v1`
- Local relay (running `../llm-relay` via `wrangler dev`): `http://localhost:8787/v1`
- Allowed providers/models: see [`../llm-relay/allowed-models.json`](../llm-relay/allowed-models.json).
- BYO keys (optional): per-provider keys (`CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are forwarded as
  `X-User-Api-Key` to bypass the relay's shared quota. `.env` only — never commit.
- Local harness providers `claude-code` and `codex` route through the relay to the Claude Code / Codex CLIs signed in on this machine. They appear only when llm-relay is running on localhost (`npm run dev` there) — never in production — and every call spends the same subscription plan limits as using the CLIs interactively. Their
  effort/thinking picks come from the widget through `X-Relay-Effort` / `X-Thinking-Budget`
  and become body fields on the relay hop.

## Where things live

- Single source of truth: design → `docs/plans/<slug>.md` (or BRAINSTORM.md while
  still ideating), status → `TODO.md`, baton → `docs/handoff.md`.
- `docs/architecture.md` — per-file module map plus the relay integration files and widget
  wiring. Open it before changing item generation, rendering, scoring, or relay code.
- `docs/reference.md` — the tech-stack table. Open it when the stack itself is in question.
- `docs/plans/history.md` — the dated status narrative, the original concept definition, and
  the pre-repo layout plan. Background only, never current fact.
- Capture files: `docs/bugs.md` (bugs, proof required) and `docs/brainstorm.md` (ideas);
  root `BRAINSTORM.md` also holds ideas.
