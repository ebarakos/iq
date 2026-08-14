# aiq

Visual IQ-style tests for **humans and AI agents** — the same puzzles, two audiences.

Items are generated from a fresh random seed after the test starts. Every item carries a
machine-readable **rule**; pure code re-derives its answer, and the new operator-induction
family searches its complete bounded rule grammar to reject ambiguous questions. Humans and
vision models receive the same answer-free visual contract.

**There is deliberately no single IQ score.** Humans get a plain score; agents get
pass-rate-by-difficulty-tier per model. The product headline is the **divergence** — items
that are human-easy but agent-hard, and vice versa. (First real data point: a mid-tier
vision model aces matrices ~93% but fails odd-one-out ~60% of the time.)

> **Status: generated reasoning-test prototype.** Each quiz is produced deterministically
> from a cryptographically random seed and contains one item from each of five visual-rule
> families. Answers stay encrypted in an opaque token until server-side submission. This is
> not yet a standardized human IQ score: generator difficulty needs a human pilot and a
> stable model panel. Design: [docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Local development works without an env file. Production must set a stable
`QUIZ_TOKEN_SECRET` of at least 32 characters for answer-key encryption. The agent harness
also needs relay settings; copy `.env.example` → `.env.local`:

```
RELAY_BASE_URL=https://llm-relay.ebarakos.workers.dev/v1
RELAY_PROVIDER=openrouter
RELAY_MODEL=deepseek/deepseek-chat-v3-0324
OPENROUTER_API_KEY=sk-or-...   # required for the default openrouter provider
```

No model call is made when a human starts or submits a test. Relay access is used only when
an agent takes the visual test or during offline model experiments.

---

## Architecture

```
fresh seed → versioned procedural generator → rule + uniqueness checks → public puzzle
                                                          │                 │
                                                          │                 └─► human UI
                                                          ▼
                                                  encrypted answer token
                                                          │
                                                          └─► server scoring

public puzzle → agent harness → vision model via relay → bucketed attempt artifacts
```

- `src/items/rules.ts` — the rule DSL, semantic validator, bounded operator grammar,
  and full-grammar uniqueness oracle.
- `src/items/generate.ts` — seeded, versioned quiz generator; `procedural-v1` remains
  replayable and `procedural-v2` adds operator induction.
- `src/items/schema.ts` / `src/items/render.tsx` — puzzle spec (Zod) and deterministic SVG
  renderer shared by generated and reference items.
- `src/items/bank.ts` + `data/bank/items.json` — regression corpus and emergency fallback.
- `src/lib/quiz-token.ts` + `src/app/api/submit/route.ts` — answer-free delivery and
  authenticated, encrypted server-side scoring.
- `src/lib/model.ts` — optional offline model item-writer; it is not in the human request path.
- `src/items/compose-image.tsx` + `src/lib/solver.ts` + `scripts/agent-run.ts` — agent
  mode: render the same SVG a human sees → PNG → vision model via the relay (symbolic JSON
  channel for text-only models; recorded separately, never pooled with image results).
- `src/lib/calibrate.ts` + `scripts/report.ts` — keep legacy item diagnostics and aggregate
  fresh attempts by stable generator feature bucket and model.
- `src/app/api/generate/route.ts` / `src/app/page.tsx` — fresh deterministic quiz generation,
  solving, server scoring, and review.

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
