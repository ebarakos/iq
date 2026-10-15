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
  `optionsAloneOnAClue`. `sceneFamilyClueBases` and `sceneFamilyClueCheck` in
  `scene-families.ts` additionally track complete symbol outcomes, including missing
  and repeated shapes, and maximal-subset omission witnesses. Repeated symbols are
  checked individually; their joint state is an omission objective. `selectDistractors`
  favors more necessary clues among lists with the same options-only behavior.
  Generation, acceptance, fallback serving and both verification scripts reject
  single-clue answers. `scene-grammar.ts` supplies partial mistakes with explicit
  reasons in both selection pools and family solvers. Selection serves lists where every
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
- `src/items/gate-order.ts` — how much a gate question depends on the order of its gates:
  distinct boards over every order, adjacent swaps, and single-gate ablation that tells a
  wrong board from a run that cannot apply. The two gate families expose `queryGates` on
  their candidates; `npm run families:verify` reports it per bucket and fails only buckets
  listed in `ORDER_DEPENDENT_BUCKETS`. See `docs/plans/harden-reasoning.md`.
- `transformation-machine-v4` (in `scene-families.ts`) — the served interacting machine: its
  paint and copy gates read one square, so every adjacent gate swap changes the board. Declared
  and verified, including fill-specific competing readings. Replaces served v3 in v32; v3
  remains available for historical diagnostic comparisons.
- `composed-transform-v3` (in `scene-families.ts`) — diagnostic conditional prototype: board
  move, solid repaint, then simultaneous solid-only movement. Contrasting examples make every
  bounded fitting reading agree on the query before options are selected. A pre-movement option
  preserves fills but changes positions, making the movement necessary to choose the answer.
  It is outside the served registry; the legacy composed primitive pool remains separately defined.
- `src/items/spatial-assembly.ts` — disabled in v33 at the owner's request; retained for
  diagnostics. 3×3 fragment packing with a fixed two-square anchor,
  quarter turns and no reflections. An independent exhaustive solver proves one completion.
  All six options retain piece counts; omission witnesses make all three constraints necessary.
  Both renderers share categorical piece marks, boundaries and the visual turn/reflection legend.
- `src/items/overlapping-figures.ts` — v34 line matrices: five combining operations,
  with zero, one or two necessary turns/reflections. A 320-rule oracle checks both axes.
- `src/items/attribute-matrix.ts` — v34 shape/shading/count matrices: independent
  distributions, arithmetic counts, then weighted counts. Both axes constrain the missing tile.
  Collection placement varies independently; the oracle matches a unique attribute completion.
  Every intended attribute must have an omission witness among the six choices.
  The shared renderer draws line figures and uniform collections without internal board grids.
- `src/items/expanded-quiz.ts` — the live assembler (`scene-families-v38`):
  `SLOT_DIFFICULTIES` fixes each question number's level. Families are shuffled independently per slot,
  with one chance per family even when multiple bands offer it. Long tests cover every enabled family;
  samples use five different families. Backtracking preserves coverage, a five-question family cap,
  and no adjacent family repeats without changing a slot's difficulty.
  Both served level-5 machine families use three gates in a non-default order.
  Their worked rows, visible query, solver and explanations agree on that order.
  `machineGateNecessity` re-reads the examples and query, then hides each transform in turn.
  At least two choices must remain possible. Generation, acceptance and fallback enforce this for both served machine families.
- `src/items/render.tsx` / `src/items/compose-image.tsx` — deterministic human
  and agent renderers over the same visible data. Machine gates draw as jigsaw
  pieces (`JigsawPieces`); `src/items/gate-pieces.ts` says which texture each
  gate glyph gets, and the explanations name gates by the same word.
- `src/lib/solver.ts` / `scripts/agent-run.ts` `--debrief` — after each scored
  answer, two more turns ask the model for its confidence, rule and difficulty,
  then whether another option was also defensible. The scored turn is unchanged.
  A turn that completes is kept even if a later one fails, and a reply from any
  model other than the one that answered is dropped, with an error naming both.
- `src/lib/quiz-token.ts` — token sealing (AES-GCM envelopes), the answer deadline (separate
  from the token's own expiry) and grace window, and the answer-key shape scoring reads. The
  answer key is rebuilt from the seed token for every submission; no token carries it.
- `src/app/api/generate/route.ts` + `src/app/api/submit/route.ts` — the in-page test on the
  seed token (`docs/plans/leaderboard-integrity.md`). Generate returns each question as a
  `PicturePuzzle` (`src/items/picture-puzzle.ts`): layout, grid flow and PNG paths, no scenes,
  instruction or ids. Submit rebuilds the test, scores it through `submitQuizOnce`, and returns
  the full puzzles for the review in the response only, never in the receipt.
- `src/app/t/[token]/[n]/board/[part]` — one picture of a question: stem board `s<i>`, option
  `o<k>`, gate strip `g<i>-right`/`g<i>-down`, drawn from `SceneGraphic`'s own SVG
  (`pictureToSvg` in `compose-image.tsx`, `pictureToPng`). `StemView` lays out either scenes or
  pictures with the same markup, so the phone-width tests cover both.
- `src/lib/quiz-scoring.ts` — elapsed time and the bounded speed bonus over shared `src/lib/scoring.ts`;
  `src/lib/leaderboard.ts` — Redis first-submission receipts (atomic `SET NX`, retained
  until token expiry) in the deployment namespace, identical-retry recovery, changed-answer rejection and atomic
  publication of one persistent leaderboard entry per test. The first receipt binds publication
  to the selected board; older receipts use their original deployment's board. A result ranks
  only when 30 questions, on time, sealed with a release and `r` (ranking on at issue), and at
  least `MIN_RANKED_SECONDS` (120) long. Rows carry a self-declared `kind` (person or agent).
  `removeLeaderboardEntry` leaves a tombstone so a removed test cannot publish again; the owner
  runs it through `scripts/leaderboard-remove.ts` (`npm run leaderboard:remove`).
- `src/lib/nickname.ts` — NFKC, 2–24 letters/digits/spaces/`. - _ '`, no web addresses, and the
  `obscenity` matcher on the name and its joined form. `src/lib/rate-limit.ts` — one-hour Redis
  windows per hashed IP: 60 starts (fail open) and 20 publications.
- `src/lib/leaderboard-config.ts` — local development default, explicit deployment opt-in
  through `LEADERBOARD_ENABLED=true`, and two namespaces: shared dev (`aiq:local`) and
  production (`aiq:production`). Selecting the production board requires both `LEADERBOARD_ENV=production`
  and `VERCEL_ENV=production`; otherwise the board stays on dev. Token and receipt scope depends
  only on `VERCEL_ENV`: production uses `aiq:production`, everything else uses `aiq:local`.
  `src/app/api/leaderboard/route.ts` and `src/app/leaderboard/page.tsx` return 404 when
  disabled. `src/app/page.tsx` supplies the server flag to `src/app/quiz.tsx`, which owns
  the quiz UI and optional publication form.
- `src/lib/redis.ts` — server-side Upstash REST commands using the Vercel integration's
  `KV_REST_API_URL` and `KV_REST_API_TOKEN`; `scripts/redis-verify.ts` checks the connection
  with a temporary key. All scoring now requires Redis so answers never leave before
  the first submission is stored, even when the leaderboard is disabled.
- `src/lib/link-test.ts` — the test token for both flows (`docs/plans/link-only-test.md`): a
  short sealed token holding the seed, length, source, generator version,
  withdrawn-family hash (and bank hash for a fallback test), app release, leaderboard
  settings and deadline; every
  page rebuilds the test from it, and refuses it once any of those changed. A generated test
  also seals the attempt each slot kept (`assembleExpandedTest`), so `linkTestQuestion` builds
  only the question a page or picture asks for (`buildExpandedQuestion`, about 50 ms) on a
  server that does not hold the test; building all 30 takes about 4 seconds.
  `scoringPayload` turns a rebuilt test into the answer key both flows score against.
  `src/app/sample` and `src/app/test` mint one and redirect;
  `src/app/t/[token]/[n]` is a question, `…/[n]/puzzle.png` its picture, and
  `src/app/t/[token]/result` the scored review, with one `…/publish/<agent>` link per fixed
  agent name (`AGENT_NAMES`) when the result ranks. All plain HTML and links.
- `src/items/puzzle-png.ts` — `puzzleToPng`, the agent channel's SVG rasterized by
  `@resvg/resvg-js` with the bundled Noto Sans fonts: the harness, `render:item`
  and the link test's puzzle image all draw the same pixels.
- `src/lib/solver.ts` / `scripts/agent-run.ts` — relay-backed vision-model
  harness using the same answer-free public puzzle. Sources: generated tests, the
  bank, held-out programs, and `family` (one declared bucket; an unserved one is
  recorded as the `prototype` evaluation set). `--snapshot FILE --arm NAME` replays frozen
  selections, including v31 after generator integration. `scripts/report.ts` keeps prompt,
  generator, source/profile, thinking budget, channel and frozen corpus populations separate;
  only one public image population from the current bank can write calibration tags.
- `src/items/prototype-pilot.ts` — v38 prepares three representatives per new matrix key and machine v4,
  filling packet A with 24 items; packet B holds 12 familiar keys. Versioned manifests
  preserve item identity; packets contain no answers. Human collection remains separately approved.
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
