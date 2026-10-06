# aiq architecture

Moved verbatim from CLAUDE.md on 2026-08-26.

## Current architecture

- `src/items/schema.ts` — internal puzzle schema plus the explicit answer-free
  public contract. `OPTIONS_PER_ITEM` lives here: it is the one place the number
  of answer options is set, and every family, both renderers, and the assembler
  follow it.
- `src/items/scene-families.ts` — the visual families (`SCENE_FAMILY_IDS`) and their
  acceptance contract; `src/items/family-promotion.ts` — which family may appear in which
  band, and the `WITHDRAWN_FAMILY_IDS` list that pulls one back out.
- `src/items/blind-options.ts` — the options-only solvers (most typical,
  per-aspect majority, per-cell majority), the 28 options-only strategies built on
  them (every rank of each measure, the middle rank, the ruled-out extremes, and
  the two lone-aspect ones), `DISTRACTOR_ASPECTS`, and the clue check
  `optionsAloneOnAClue`. `selectDistractors` serves only option lists where every
  clue appears on two options (under the family's `SCENE_FAMILY_CLUE_MODELS`
  entry) and balances the answer's rank against the strategies;
  `npm run families:verify` fails a served bucket where one strategy picks the
  answer more than 30% of the time over 200 fixed-seed items (chance is 1 in 6),
  or where any item leaves a clue on one option. See
  `docs/plans/blind-answer-leak.md`.
- `src/items/worked-row-readings.ts` — the readings a person might give a worked row
  (flips and turns of the board, a mirror that turns arrows too, token turns, fill
  changes, copies of every shape, set algebra with either board first and one-square
  slides that wrap) and `secondReadings`, which lists the wrong options one of them
  reaches in composed transform, the transformation machine and set algebra. `npm run
  families:verify` fails a bucket where any of its 200 items has one; the
  transformation machine and set algebra also use it while drawing. See
  `docs/plans/one-reading-per-worked-row.md`.
- `src/items/expanded-quiz.ts` — the live assembler (`scene-families-v30`): band
  schedules of 5/10/10/5 and 1/1/2/1, seeded 4/2/2 non-warmup family draws (`FAMILY_SUBSAMPLE_SIZES`), an
  even split over each draw, and an easiest-first order without adjacent repeats.
- `src/items/render.tsx` / `src/items/compose-image.tsx` — deterministic human
  and agent renderers over the same visible data. Machine gates draw as jigsaw
  pieces (`JigsawPieces`); `src/items/gate-pieces.ts` says which texture each
  gate glyph gets, and the explanations name gates by the same word.
- `src/lib/solver.ts` / `scripts/agent-run.ts` `--debrief` — after each scored
  answer, two more turns ask the model for its confidence, rule and difficulty,
  then whether another option was also defensible. The scored turn is unchanged.
  A turn that completes is kept even if a later one fails, and a reply from any
  model other than the one that answered is dropped, with an error naming both.
- `src/lib/quiz-token.ts` + `src/app/api/submit/route.ts` — encrypted answer
  token, the answer deadline (separate from the token's own expiry), and
  server-side scoring with a late marker. The token seals the app release and
  leaderboard eligibility/environment when issued; legacy tokens cannot rank.
- `src/lib/quiz-scoring.ts` — elapsed time and the bounded speed bonus over shared `src/lib/scoring.ts`;
  `src/lib/leaderboard.ts` — Redis first-submission receipts (atomic `SET NX`, retained
  until token expiry), identical-retry recovery, changed-answer rejection and atomic
  publication of one persistent leaderboard entry per test.
- `src/lib/leaderboard-config.ts` — local development default, explicit deployment opt-in
  through `LEADERBOARD_ENABLED=true`, and separate local/Preview/Production namespaces.
  `src/app/api/leaderboard/route.ts` and `src/app/leaderboard/page.tsx` return 404 when
  disabled. `src/app/page.tsx` supplies the server flag to `src/app/quiz.tsx`, which owns
  the quiz UI and optional publication form.
- `src/lib/redis.ts` — server-side Upstash REST commands using the Vercel integration's
  `KV_REST_API_URL` and `KV_REST_API_TOKEN`; `scripts/redis-verify.ts` checks the connection
  with a temporary key. All scoring now requires Redis so answers never leave before
  the first submission is stored, even when the leaderboard is disabled.
- `src/lib/link-test.ts` — the link test (`docs/plans/link-only-test.md`): a
  short sealed token holding the seed, length, source, generator version,
  withdrawn-family hash (and bank hash for a fallback test), app release, leaderboard
  settings and deadline; every
  page rebuilds the test from it, and refuses it once any of those changed.
  `src/app/sample` and `src/app/test` mint one and redirect;
  `src/app/t/[token]/[n]` is a question, `…/[n]/puzzle.png` its picture, and
  `src/app/t/[token]/result` the scored review. All plain HTML and links.
- `src/items/puzzle-png.ts` — `puzzleToPng`, the agent channel's SVG rasterized by
  `@resvg/resvg-js` with the bundled Noto Sans fonts: the harness, `render:item`
  and the link test's puzzle image all draw the same pixels.
- `src/lib/solver.ts` / `scripts/agent-run.ts` — relay-backed vision-model
  harness using the same answer-free public puzzle.
- `src/lib/calibrate.ts` — separate image/symbolic model results aggregated by
  generator feature bucket; exact-item results remain diagnostics.
- `src/app/icon.svg`, `src/app/apple-icon.tsx`, `src/app/opengraph-image.tsx` —
  the favicon, home-screen icon and 1200×630 link preview (Next file conventions,
  rendered at build). The preview draws its text with the Noto Sans subsets in
  `src/app/fonts/` (OFL).

---

## LLM Relay

Only the offline tools call a model: the agent harness (`scripts/agent-run.ts`,
`scripts/agent-smoke.ts`) and the dormant rule-proposal experiment. The human app
makes no model call and loads no relay widget; its start and submission requests are plain
`fetch` calls in `src/app/quiz.tsx`, with an optional third call to publish a result. The files,
from the `/connect-relay` templates:

- `src/lib/relay-fetch.ts` — custom fetch: injects provider, intercepts relay 429s,
  and sends effort, thinking budget and session id as body fields for the local
  harness providers (`claude-code`, `codex`).
- `src/lib/relay-errors.ts` — typed rate-limit parsing (relay vs provider).
- `src/lib/model.ts` — `relayModel()`, the AI SDK client routed through the relay,
  with `ModelOverrides` from the harness's `--provider`, `--model`, `--effort` and
  `--thinking-budget` flags over the `RELAY_*` env defaults.

The widget template files (`relay-client.ts`, `relay-api-helpers.ts`) were removed
on 2026-09-28: the widget was never loaded here. If a model-backed feature ever
reaches the human app, rerun `/connect-relay` rather than restoring them by hand.

### Relay upstream feedback

The relay integration files are based on shared templates in
`~/.claude/skills/connect-relay/templates/`. If you improve a general-purpose
relay file, append a note to `~/.claude/skills/connect-relay/UPSTREAM.md` under
`## Pending` (project, date, file, what changed) so it can flow back to the
templates.
