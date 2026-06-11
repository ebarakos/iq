# aiq

Visual IQ-style tests for **humans and AI agents** — the same puzzles, two audiences.

Items are purely visual (shapes, patterns, a short neutral instruction, no language skill)
so they are fair across humans and vision-capable models. Every item carries a
machine-readable **rule**; the answer is re-derived from the rule in pure code, so a
generated puzzle can never ship with a mis-marked answer. Difficulty starts a priori (rule
complexity) and is recalibrated from real agent attempts.

**There is deliberately no single IQ score.** Humans get a plain score; agents get
pass-rate-by-difficulty-tier per model. The product headline is the **divergence** — items
that are human-easy but agent-hard, and vice versa. (First real data point: a mid-tier
vision model aces matrices ~93% but fails odd-one-out ~60% of the time.)

> **Status: calibrated-bank prototype.** Quizzes serve instantly from a committed,
> rule-verified item bank; fresh relay generation is opt-in. A CLI agent harness runs the
> same items against vision models through the relay and feeds solve rates back into the
> bank — shown after each question in review ("AI agents get this right N% of the time").
> Design: [docs/plans/rules-bank-agent-calibration.md](docs/plans/rules-bank-agent-calibration.md).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

The quiz itself works with **no env at all** — it serves from the committed item bank.
For fresh relay generation and the agent harness, copy `.env.example` → `.env.local`:

```
RELAY_BASE_URL=https://llm-relay.ebarakos.workers.dev/v1
RELAY_PROVIDER=openrouter
RELAY_MODEL=deepseek/deepseek-chat-v3-0324
OPENROUTER_API_KEY=sk-or-...   # required for the default openrouter provider
```

No API key needed for the free `groq` alternative. If fresh generation fails (relay down,
rate-limited, invalid output after retries), the app falls back to the item bank and says
so in the UI.

---

## Architecture

```
rule DSL (rules.ts) ──► semantic validator (checkRule)
        │                        │ gates
        ▼                        ▼
procedural generator      relay generation        item bank (data/bank/items.json)
(generate.ts, seeded)     (model.ts, retry loop)  └─► serves the quiz (route → page.tsx)
        └──────────► bank topup CLI ◄──────────┘
                                                  agent harness (scripts/agent-run.ts)
                                                  └─► attempts (data/attempts/*.json)
                                                      └─► report CLI → tags back into bank
```

- `src/items/rules.ts` — the rule DSL (step/cycle/constant transforms over ordered
  dimension domains) + `checkRule`, which re-derives the answer and must explain the
  whole stem. This is the semantic validator.
- `src/items/generate.ts` — seeded procedural generator; correct by construction.
- `src/items/schema.ts` / `src/items/render.tsx` — puzzle spec (Zod) and deterministic SVG
  renderer; the model emits structured specs and **never draws**.
- `src/items/bank.ts` + `data/bank/items.json` — committed, content-addressed item bank;
  default serving path. `npm run bank:topup` adds items, `npm run bank:verify` is the
  local integrity gate.
- `src/lib/model.ts` — relay client; generate → parse → schema + rule validation → retry
  with derivation diffs fed back to the model.
- `src/items/compose-image.tsx` + `src/lib/solver.ts` + `scripts/agent-run.ts` — agent
  mode: render the same SVG a human sees → PNG → vision model via the relay (symbolic JSON
  channel for text-only models; recorded separately, never pooled with image results).
- `src/lib/calibrate.ts` + `scripts/report.ts` — aggregate attempts into per-item solve
  rates and tags (`agent-easy` ≥ 90%, `agent-hard` ≤ 40%, `MIN_ATTEMPTS = 5`);
  `npm run report -- --write` flows them back into the bank.
- `src/app/api/generate/route.ts` / `src/app/page.tsx` — bank-default API + quiz UI
  (intro → 5 questions → score + review with agent-stat chips).

All model calls go through [llm-relay](../llm-relay). No provider API keys live in this
repo — configure via `.env.local` only.

**Deferred until a DB exists** (by design — see the plan doc): human attempt persistence,
human percentile norms, adaptive routing. The attempt-artifact schema mirrors the future
`attempts` table 1:1, so the upgrade is a new data source, not a rewrite. Until then,
a-priori difficulty is the human-difficulty proxy in divergence reports.

---

## Dev commands

```bash
npm run dev          # dev server — http://localhost:3000
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # production build
npm run bank:topup   # add items (--count N --source procedural|model --seed N)
npm run bank:verify  # bank integrity gate (run before committing bank changes)
npm run agent:smoke  # relay multimodal smoke test (vision models)
npm run agent:run    # solver harness (--all --channel image --repeat N ...)
npm run report       # calibration report (--write to tag the bank)
npm run render:item  # PNG fixtures of bank items (data/fixtures/)
```

See [CLAUDE.md](CLAUDE.md) for full project context, [BRAINSTORM.md](BRAINSTORM.md) for
the design history, and [docs/plans/](docs/plans/) for the roadmap.
