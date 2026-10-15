# IQ visual reasoning gym (repo `aiq`) — for humans and agents

> Visual IQ-style puzzles for **humans and AI agents**, using a difficulty ladder
> to separate "human-hard" from "agent-hard" items.

The app serves two test lengths, 5 and 30 questions, both drawn from the same pool of eligible
visual reasoning families, with fixed difficulty per question number. Families are randomized
within each slot's validated level. Every test is generated from a
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
npm run redis:verify     # Upstash connection check with one temporary key (needs .env.local)
./qa/run.sh              # the full local gate below, logged to qa/runs/ (from project root)
# Full local gate before landing generator, family, or assembler changes:
npm run typecheck && npm run lint && npm test && npm run families:verify && npm run bank:verify && npm run build
```

Only the model-calling scripts (`agent:smoke`, `agent:run`, `experiment:llm-rules`) need relay
env in `.env.local`; `bank:topup`, `report`, `render:item` and `pilot:report` run offline.
Scoring, local included, needs Upstash `KV_REST_API_URL` and `KV_REST_API_TOKEN` there. See
`README.md` and `package.json`.

## Hard rules

- **Clues and near misses:** Offer six options: one right answer and five plausible near misses.
  Prefer more necessary independent clues among balanced six-option lists, within the five-near-miss budget.
  A single symbol or clue must not identify the answer when there are multiple independent outcomes,
  even when another option omits or duplicates a symbol. Whole-rule sequences are the documented exception.
  See [docs/plans/blind-answer-leak.md](docs/plans/blind-answer-leak.md).
- **Necessary transformations:** Every transform in a served machine must be needed to choose among all six options.
  Hiding any one transform's example must leave at least two choices possible from the other examples and shown order.
  Changing the generated answer when a step is omitted is insufficient. Enforce this in generation, acceptance and fallback.
  Level 5 uses all three transforms in a mixed order, never the default worked-row order.
- **Explanations are for the taker:** an item's `explanation` (the review screen) says what to look at
  and how to reach the answer, in the picture's words. Never how the item was made — no distractors,
  near misses, grammars, programs, worked rows, tokens. A test in `scene-families.test.ts` enforces it.
- **Visual-only ("visibility only"):** Items are intended to be purely visual /
  language-independent — no text comprehension, no culture-specific knowledge —
  so the test is fair across humans and vision-capable agents.
- `OPTIONS_PER_ITEM` (`src/items/schema.ts`) is the one place the number of answer options
  is set, and every family, both renderers, and the assembler follow it.
- Before scoring, puzzles leave the server only as PNGs, never as scene data: the repo is public,
  so shape data lets a script solve with its own solvers. One sealed seed token per test serves
  both flows (`src/lib/link-test.ts`); the server rebuilds and scores it, saves the first result in
  Redis before revealing any answer, and reveals none if that fails (`src/lib/leaderboard.ts`).
- Production requires `QUIZ_TOKEN_SECRET` and the Upstash `KV_REST_API_*` settings; human tests
  make no model calls, so they never need relay env. See `.env.example`.
- Nothing is locked except **JS/TS + Vercel + llm-relay** (explicit user requirements).
- If you improve a general-purpose relay file, append a note to
  `~/.claude/skills/connect-relay/UPSTREAM.md` under `## Pending` (project, date, file,
  what changed) so it can flow back to the templates.

## LLM Relay

All model calls go through [`llm-relay`](../llm-relay), a Cloudflare Worker proxy.
**No provider API keys live in this repo.** The relay manages keys, rate limits and providers.
Test items are generated in pure code; model calls are for agent solving and calibration.

Configure via env vars only — never hardcode URLs, providers, or model names:

```
RELAY_BASE_URL   # required — relay endpoint, e.g. https://llm-relay.ebarakos.workers.dev/v1
RELAY_PROVIDER   # required — provider the relay routes to, e.g. cerebras
RELAY_MODEL      # required — model name, e.g. llama3.1-8b
RELAY_EFFORT     # harness providers only — low|medium|high, default for agent:run
```

**Project default since 2026-08-27: `codex` / `default` at effort `high`** (Codex's own default model, recorded per run as the model that answered), over the
LOCAL relay (`http://localhost:8787/v1`). That needs `../llm-relay` running under
`wrangler dev` AND the codex harness bridge up; without both, `agent:run` fails to
connect and the hosted OpenRouter line in `.env.example` is the fallback.

- Production relay: `https://llm-relay.ebarakos.workers.dev/v1`
- Local relay (running `../llm-relay` via `wrangler dev`): `http://localhost:8787/v1`
- Allowed providers/models: see [`../llm-relay/allowed-models.json`](../llm-relay/allowed-models.json).
- BYO provider keys and the local harness providers (`claude-code`, `codex`): see `docs/reference.md`.

## Where things live

- `docs/architecture.md` — per-file module map plus the relay integration files. Open it
  before changing item generation, rendering, scoring, or relay code.
- `docs/reference.md` — the tech-stack table. Open it when the stack itself is in question.
- `docs/plans/history.md` — the dated status narrative, the original concept definition, and
  the pre-repo layout plan. Background only, never current fact.
- Capture files: `docs/bugs.md` (bugs, proof required) and `docs/brainstorm.md` (ideas).
