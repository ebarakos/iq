# aiq

Visual IQ-style tests for **humans and AI agents** — the same puzzles, two audiences.

Items are generated from a fresh random seed after the test starts. Every item carries a
machine-readable **rule** or constraint witness, and pure code re-derives its answer. Humans
and vision models receive the same answer-free visual contract.

Humans get a score and a breakdown by reasoning family. Agent runs report performance by
difficulty tier and model, making it possible to compare where people and models find the
same generated questions easy or hard.

The public product offers a 5-question sample and a 30-question test drawn from the same
generated visual-family pool. Answers stay encrypted until server-side submission. Design:
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md).

### Test generation latency

Measured 2026-09-29 on the development machine on `scene-families-v19`, fresh random seeds:

| Test | Seeds | Median | 95th percentile | Slowest |
|---|---:|---:|---:|---:|
| 30 questions | 50 | 321 ms | 434 ms | 502 ms |
| 5 questions | 100 | 54 ms | 129 ms | 232 ms |

The browser gives up on starting a test after 20 seconds, so this leaves a wide margin even on
slower serverless hardware.

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
RELAY_BASE_URL=http://localhost:8787/v1   # the local relay (../llm-relay under wrangler dev)
RELAY_PROVIDER=codex                      # your own Codex sign-in, through the relay's harness bridge
RELAY_MODEL=sol
RELAY_EFFORT=high
```

Without a local relay and bridge, use the hosted relay with a vision model instead, as the
recorded probes did: `RELAY_BASE_URL=https://llm-relay.ebarakos.workers.dev/v1`,
`RELAY_PROVIDER=openrouter`, `RELAY_MODEL=google/gemini-3.5-flash`, plus `OPENROUTER_API_KEY`.

No model call is made when a human starts or submits a test. Relay access is used only when
an agent takes the visual test or during offline model experiments.

### Vercel: one-time setup, then push

Run this once from a clone with an `origin` remote:

```bash
npm run vercel:setup
```

The command uses the official Vercel CLI through `npx`, links or creates the project, creates
separate sensitive `QUIZ_TOKEN_SECRET` values for production and preview when they are missing,
connects `origin` to Vercel, and assigns `iq.ebarakos.com` to the production project. Secret values
go directly from memory to Vercel: they are never printed or written to disk. Existing values are
kept, so rerunning setup does not invalidate an active test. The domain is never moved with
`--force`; if another project owns it, setup stops instead of breaking that site. The first run
may ask you to sign in to Vercel; after it completes, normal pushes trigger preview deployments
and pushes to the production branch trigger production deployments.

The setup command prints Vercel's domain inspection after assignment. If DNS lives elsewhere,
add the exact A or CNAME record reported there. The current Cloudflare setup requires an A record
named `iq` pointing to `76.76.21.21`, with Cloudflare's proxy disabled.
Vercel provisions HTTPS after DNS verification.

Use `npm run vercel:setup -- --dry-run` to inspect the intended work without contacting Vercel.

---

## Architecture

```
fresh seed → versioned scene generator → rule + uniqueness checks → public puzzle
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
- `src/items/expanded-quiz.ts` — seeded 5- and 30-question assembler over the live scene
  families and difficulty bands.
- `src/items/blind-options.ts` — the options-only solvers that check no answer can be
  picked from the six options alone (`npm run families:verify` fails a bucket above 30%).
- `src/items/schema.ts` / `src/items/render.tsx` — puzzle spec (Zod) and deterministic SVG
  renderer shared by generated and reference items.
- `src/items/bank.ts` + `data/bank/items.json` — regression corpus and emergency fallback.
- `src/lib/quiz-token.ts` + `src/app/api/submit/route.ts` — answer-free delivery and
  authenticated, encrypted server-side scoring.
- `src/lib/model.ts` — the relay-routed model client for the offline agent harness; nothing in
  the human request path calls a model.
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
npm run bank:topup   # rebuild the emergency bank (--replace --per-bucket N --seed S)
npm run bank:verify  # bank integrity gate (run before committing bank changes)
npm run agent:smoke  # relay multimodal smoke test (vision models)
npm run agent:run    # solver harness (--all --channel image --repeat N ...)
npm run report       # calibration report (--write to tag the bank)
npm run render:item  # PNG fixtures of bank items (data/fixtures/)
npm run vercel:setup # one-time Vercel secrets + Git deployment bootstrap
```

See [CLAUDE.md](CLAUDE.md) for full project context, [docs/brainstorm.md](docs/brainstorm.md) for
deferred ideas, [TODO.md](TODO.md) for the single active pass, and
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md) for the
current design.
