# IQ visual reasoning gym

A visual reasoning gym for **humans and AI agents** — the same puzzles, two audiences.

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

Local scoring requires the Upstash settings described below. Production must set a stable
`QUIZ_TOKEN_SECRET` of at least 32 characters for answer-key encryption. The agent harness
also needs relay settings; copy `.env.example` → `.env.local`:

```
RELAY_BASE_URL=http://localhost:8787/v1   # the local relay (../llm-relay under wrangler dev)
RELAY_PROVIDER=codex                      # your own Codex sign-in, through the relay's harness bridge
RELAY_MODEL=default                       # whatever Codex defaults to; runs record the model that answered
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

### Upstash Redis

Connect the Upstash resource to this Vercel project for Preview and Production.
The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN`. For local verification,
copy the REST URL and write token from Upstash into the ignored `.env.local` file alongside
existing relay settings. Vercel cannot export variables marked Sensitive; a connection
with sensitive variables cannot target Development.

```bash
npm run redis:verify
```

This checks authentication, write/read access, expiry and atomic duplicate protection,
then removes its unique test key. The connection uses native `fetch`, with no new package.
Server code can call `redisCommand` in `src/lib/redis.ts`. Both in-page and link-test submissions save
its first result before revealing answers. Identical retries return that result; changed
answers are refused. Redis failures leave the test retryable and reveal no answer key.
These private receipts expire with the two-hour quiz token.
New Vercel environment settings take effect on the next deployment.

### Leaderboard

Run `npm run dev` and open `/leaderboard` to see the top 20 published attempts. After an
on-time 30-question test in the in-page app, the result offers an optional nickname and a Publish score button.
The 5-question sample and late results cannot be published. One test creates at most one
entry, including simultaneous requests and retries. Entries keep the score, elapsed time,
submission date and the app version sealed when the test started (for example, `v0.1.2`).
Older tokens without this version cannot join the leaderboard.

Points are `round(100 × correct × (1 + 0.25 × fraction of time remaining))`. For example,
28/30 in 20 minutes earns 3,033 points; 30/30 in 30 minutes earns 3,000. Equal points rank
the faster attempt first. Raw accuracy stays visible; these points are not an IQ score.

The leaderboard is enabled by default only in local development. On deployments, its page
and both API methods return 404, and quiz results cannot be published. To enable it later,
set the **server-only** `LEADERBOARD_ENABLED=true` in the desired Vercel environment and
redeploy. Set it to `false` to disable it locally. No deployment settings were enabled as
part of this implementation. Redis keys separate local, Preview and Production entries.
The single-use submission protection applies even while the leaderboard is disabled.

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

- `src/items/expanded-quiz.ts` — seeded 5- and 30-question assembler over the live scene
  families and difficulty bands.
- `src/items/blind-options.ts` — the options-only solvers that check no answer can be
  picked from the six options alone (`npm run families:verify` fails a bucket above 30%).
- `src/items/schema.ts` / `src/items/render.tsx` — puzzle spec (Zod) and deterministic SVG
  renderer shared by generated and reference items.
- `src/items/bank.ts` + `data/bank/items.json` — regression corpus and emergency fallback.
- `src/lib/quiz-token.ts` + `src/app/api/submit/route.ts` + `src/lib/scoring.ts` — answer-free
  delivery and authenticated, encrypted server-side scoring.
- `src/lib/link-test.ts` + `src/app/sample`, `src/app/test`, `src/app/t/` — the link test: the
  same test taken by fetching pages and following links, for agents that run no JavaScript.
- `src/lib/model.ts` — the relay-routed model client for the offline agent harness; nothing in
  the human request path calls a model.
- `src/items/compose-image.tsx` + `src/lib/solver.ts` + `scripts/agent-run.ts` — agent
  mode: render the same SVG a human sees → PNG → vision model via the relay (symbolic JSON
  channel for text-only models; recorded separately, never pooled with image results).
- `src/lib/calibrate.ts` + `scripts/report.ts` — keep legacy item diagnostics and aggregate
  fresh attempts by stable generator feature bucket and model.
- `src/app/api/generate/route.ts` / `src/app/quiz.tsx` — fresh deterministic quiz generation,
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
npm run agent:run    # solver harness (--all --channel image --repeat N ...; --debrief asks the model
                     # for its confidence and rule, then whether another option was defensible)
npm run report       # calibration report (--write to tag the bank)
npm run render:item  # PNG fixtures of bank items (data/fixtures/)
npm run vercel:setup # one-time Vercel secrets + Git deployment bootstrap
```

See [CLAUDE.md](CLAUDE.md) for full project context, [docs/brainstorm.md](docs/brainstorm.md) for
deferred ideas, [TODO.md](TODO.md) for the single active pass, and
[docs/plans/deterministic-novel-tests.md](docs/plans/deterministic-novel-tests.md) for the
current design.
