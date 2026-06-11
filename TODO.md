# TODO

Short-lived task/checklist state. Design lives in [BRAINSTORM.md](BRAINSTORM.md)
(ideation) and `docs/plans/<slug>.md` (once formalized).

## 2026-06-04 — Project init (planning phase)

- [x] Create init files (CLAUDE.md, README, .gitignore, .env.example, BRAINSTORM, TODO)
- [x] `git init`
- [x] Confirm interpretation of "visibility only" (BRAINSTORM Q1) — visual + short fixed
      neutral instruction (current MVP behavior)
- [x] Brainstorm session: settle item format — Mensa baseline with rules as machine-readable
      data, hybrid procedural+model generation (Q3/Q4); novel formats (Q6) stay open in
      BRAINSTORM — see docs/plans/rules-bank-agent-calibration.md
- [x] Decide how agents attempt visual items — dual-channel, image first (same SVG → PNG →
      vision model via relay); symbolic JSON secondary; only image-channel results are
      human-comparable (Q2)
- [x] Define difficulty ladder + calibration approach — a priori from `ruleComplexity`,
      recalibrated empirically from attempt artifacts (Q5)
- [x] Define scoring / human–agent comparability — no single IQ score; separate human score
      and agent pass-rate-by-tier; the divergence is the headline (Q7)

## 2026-06-05 — MVP prototype (human-facing, relay-generated)

- [x] Scaffold Next.js + TS + Tailwind app (deployable on Vercel)
- [x] Zod puzzle schema: structured cell spec (matrix / sequence / analogy / odd-one-out)
- [x] Deterministic SVG renderer (drawn puzzle always matches declared answer)
- [x] Relay client via `createRelayFetch` + `client.chat()`; generate → validate → retry
- [x] `/api/generate` route + hand-authored fallback bank for resilience
- [x] Quiz UI: intro → 5 questions → final score + per-item review
- [x] End-to-end verified against live relay (openrouter/deepseek: 5/5 correct)
- [x] Register aiq in `../llm-relay/CONSUMERS.md` — done; widget added (loaded in
      `src/app/layout.tsx`, per-user provider/model switching via headers)

## Next (needs design before building — plan mode → TODO)

All four designed 2026-06-10 — see docs/plans/rules-bank-agent-calibration.md; actionable
tasks live under the Roadmap section below.

- [x] Semantic validator → designed: rule DSL + `checkRule` re-derivation (Phase A)
- [x] Agent mode → designed: CLI solver harness, image-first dual channel (Phase C)
- [x] Difficulty calibration → designed: attempt-artifact aggregation + agent tags (Phase D)
- [x] Persist results / item bank → designed: file-based bank + attempt artifacts, DB
      deferred (Phase B)

## 2026-06-10 — Repo review: fixes & improvements

From a full code review (schema/prompt drift, generation robustness, UX/a11y, infra).
Ordered roughly by value; items needing design stay in "Next" above.

### Correctness & validation

- [x] Reconcile sequence length: chose variable length as a difficulty lever — schema and
      prompt both now say 3–5 cells + one trailing blank (4–6 panels total)
      (src/items/schema.ts, src/items/prompt.ts)
- [x] Add missing `layout === "row"` check for oddOneOut in the superRefine
      (src/items/schema.ts)
- [x] Reconcile option count: schema raised to 4–6, prompt says "4–6 cell objects (4 is
      standard; 5–6 for harder items)" (src/items/prompt.ts, src/items/schema.ts)
- [x] Strengthen oddOneOut structural check: non-answer options must share ≥1 dimension value
      that the answer breaks (cheap precursor to the full semantic validator)
      (src/items/schema.ts)
- [x] Enforce unique puzzle ids within a set (refine on PuzzleSetSchema)
      (src/items/schema.ts)

### Generation quality & robustness

- [x] Shuffle options server-side after validation (remap answerIndex) — removes LLM
      answer-position bias so the correct letter isn't guessable (`shuffleOptions` in
      src/items/schema.ts, applied in src/lib/model.ts)
- [x] Vary generation per request: `buildUserPrompt()` randomizes type order within difficulty
      tiers + rule-dimension hints + a variation seed (src/items/prompt.ts, src/lib/model.ts)
- [x] Add a timeout (AbortSignal 45s) to the generateText call so a hung relay request fails
      fast to the fallback; abort/timeout skips remaining retries (src/lib/model.ts)
- [x] Harden JSON extraction: `parseJsonArray` tries ordered candidates and only returns a
      string that actually parses to an array (src/lib/model.ts)
- [x] Guard `JSON.parse(options.body)` in relay-fetch with try/catch — logged in
      ~/.claude/skills/connect-relay/UPSTREAM.md under Pending (src/lib/relay-fetch.ts)
- [x] Basic abuse guard on POST /api/generate: per-IP sliding window (10 req / 5 min,
      per-instance) returning a relay-shaped 429; `maxDuration = 60`
      (src/app/api/generate/route.ts)

### UX & accessibility

- [x] Keyboard shortcuts in the solver: 1–6/A–F select an option, ←/→ navigate, Enter advances
      (with focused-button double-fire guard) (src/app/page.tsx)
- [x] A11y pass: `describeCell()` labels on SVG cells and option buttons, visible focus rings
      on all interactive elements (src/app/page.tsx, src/items/render.tsx)
- [x] Confirm before Restart discards an in-progress test (active phase only)
      (src/app/page.tsx)
- [x] Options/review grids handle 4/5/6 options (sm:grid-cols-4 for 4, sm:grid-cols-3 for 5–6;
      complete literal class strings for Tailwind) (src/app/page.tsx)
- [x] Persist in-progress test to sessionStorage (`aiq-test-v1`, restored in a mount effect to
      avoid hydration mismatch; cleared on restart/fresh start) (src/app/page.tsx)
- [x] Expand the fallback bank to 12 items (3 per type) with `getFallbackPuzzles()` sampling
      5 across ≥3 types in ascending difficulty, options shuffled (src/items/fallback.ts)

### Infrastructure & docs

- [x] Update README — rewritten: MVP status, quick start, env setup, architecture overview,
      dev commands (README.md)
- [x] Add Vitest + unit tests: 30 tests covering visualSignature symmetry, PuzzleSchema
      per-type accept/reject, shuffleOptions invariants, parseJsonArray edge cases, fallback
      sampling (vitest.config.ts, src/items/schema.test.ts, src/items/fallback.test.ts,
      src/lib/model.test.ts)
- [x] ~~CI: GitHub Actions workflow~~ — removed 2026-06-11: no remote CI by policy
      (global CLAUDE.md); verification is local (lint + typecheck + test + bank:verify + build)

## 2026-06-10 — Roadmap: rules → bank → agent mode → calibration (design approved)

Design: [docs/plans/rules-bank-agent-calibration.md](docs/plans/rules-bank-agent-calibration.md).
Phases are sequential (A → B → C → D), each independently shippable. C1 gates the image
channel; everything else in C/D is channel-agnostic.

### Phase A — Rules as data + semantic validator ✅ (implemented 2026-06-10)

- [x] A1 — Rule DSL: `DIM_DOMAINS`, `DimTransformSchema`, `RuleSchema` (4 kinds,
      disjoint-axes superRefine for matrix); shared constants hoisted to
      src/items/domains.ts to keep schema → rules → domains acyclic (src/items/rules.ts)
- [x] A2 — `applyTransform`/`deriveAnswer`/`checkRule`: whole-stem consistency, answer
      derivation via `visualSignature`, oddOneOut exactly-one-breaker, degeneracy checks
      via `ROTATION_PERIOD` (src/items/rules.ts)
- [x] A3 — Optional `rule` field + kind/type match refine on `PuzzleSchema`
      (src/items/schema.ts)
- [x] A4 — `validatePuzzleSet()` (schema parse + checkRule) hooked into the generation
      retry loop with derivation-diff feedback strings (src/lib/model.ts)
- [x] A5 — SYSTEM_PROMPT rule grammar + `"rule"` required in `buildUserPrompt()`;
      self-check paragraph replaced with the mechanical-re-derivation contract
      (src/items/prompt.ts)
- [x] A6 — Procedural generator: seeded RNG, `sampleRule`/`generateStem`/
      `generateDistractors`/`generatePuzzle` (+ oddOneOut ambiguity guard),
      `ruleComplexity` (src/items/generate.ts, src/lib/rng.ts)
- [x] A7 — Rules on all 12 fallback items (none needed adjusting); `FALLBACK_BANK`
      exported for the Phase B migration; checkRule test per item
      (src/items/fallback.ts, src/items/fallback.test.ts)
- [x] A8 — Unit tests: per-kind accept/reject fixtures, derivation goldens, 600-run
      seeded generator sweep, validatePuzzleSet cases — 68 tests total
      (src/items/rules.test.ts, src/items/generate.test.ts, src/lib/model.test.ts)

### Phase B — Item bank as data ✅ (implemented 2026-06-10)

- [x] B1 — `BankItemSchema`/`BankFileSchema` + content-addressed `fingerprintPuzzle()`
      (sha256 over type/layout/stem sigs/sorted option sigs/answer sig) (src/items/bank.ts)
- [x] B2 — `loadBank()` (static JSON import + Zod parse) + `sampleQuiz()` (type coverage,
      hard finisher, ascending, serve-time shuffle; returns index-aligned BankItems)
      (src/items/bank.ts, src/items/bank.test.ts)
- [x] B3 — `scripts/bank-topup.ts`: `--source procedural|model|both`, dedup by fingerprint,
      provenance stamping; `tsx` devDep + npm scripts for all CLIs (package.json)
- [x] B4 — 12 hand-authored items migrated into data/bank/items.json (one-time
      `--seed-fallback` flag, removed after the migration)
- [x] B5 — Bank topped up procedurally to 60 items (15 per type, d1–d5 spread, seed 42)
      (data/bank/items.json)
- [x] B6 — Route: bank-default serving (instant), `fresh: true` opt-in, bank as failure
      fallback; src/items/fallback.ts deleted (src/app/api/generate/route.ts)
- [x] B7 — UI: Source union ("bank" | "relay" | "fallback"), "Generate a fresh test with
      AI" affordance, source-aware loading + attribution (src/app/page.tsx)
- [x] B8 — `bank:verify` (schema + checkRule + fingerprint/id integrity) as a local
      pre-commit gate (scripts/bank-verify.ts) — CI workflow removed per no-remote-CI policy

### Phase C — Agent mode (CLI solver harness) ✅ (implemented 2026-06-10)

- [x] C1 — GATE passed: relay forwards multimodal payloads — openrouter
      gemini-3-flash-preview answers composed PNGs (openai needs BYO key; groq
      llama-4-scout region-blocked). Image channel is primary, as designed
      (scripts/agent-smoke.ts)
- [x] C2 — Pure-SVG composition `PuzzleImage`/`puzzleToSvg` (all four layouts, "?" blanks,
      A–F labels, explicit fills, no CSS) (src/items/compose-image.tsx)
- [x] C3 — SVG→PNG via `@resvg/resvg-js` + fixture script; 4 sample PNGs verified
      (scripts/render-item.ts, data/fixtures/)
- [x] C4 — `solveItem()` image + symbolic channels, `parseAnswerLetter()`, per-attempt
      shuffle with canonical-index mapping (src/lib/solver.ts)
- [x] C5 — Shared attempt-artifact Zod schema; data/attempts/ committed as the calibration
      corpus (src/lib/attempts.ts)
- [x] C6 — Harness CLI: --items/--all/--channel/--provider/--model/--repeat/--concurrency,
      429-abort with partial artifact, pass-rate tables (scripts/agent-run.ts)
- [x] C7 — First real run: 60 items × gemini-3-flash × image → 73% overall (matrix 93%,
      analogy 87%, sequence 73%, oddOneOut 40%) + 4-repeat corpus run for tagging
      (data/attempts/)
- [x] C8 — Unit tests: parseAnswerLetter, AttemptFileSchema round-trip, puzzleToSvg
      structure per layout (src/lib/solver.test.ts, src/items/compose-image.test.ts)

### Phase D — Calibration & scoring ✅ (implemented 2026-06-10)

- [x] D1 — Aggregation core: rollups, `agentTag()` (≥0.90 / ≤0.40, MIN_ATTEMPTS=5),
      divergence matrix + mismatch ranking, orphan detection (src/lib/calibrate.ts)
- [x] D2 — `scripts/report.ts`: per-item / by-tier / by-type / by-model / divergence
      tables; image headline, symbolic secondary; per-promptVersion sections (npm run report)
- [x] D3 — `--write` back-flow of tags + calibration block into data/bank/items.json,
      idempotent, dry-run by default (scripts/report.ts)
- [x] D4 — Route attaches `agentStats {solveRate, attempts, tag}` per served bank item
      (src/app/api/generate/route.ts)
- [x] D5 — UI: agent-stat chip in ReviewItem ("AI agents get this right N% of the time ·
      based on M runs"); review-only (src/app/page.tsx)
- [x] D6 — Unit tests for calibrate.ts (23 tests: thresholds, gate, ordering, idempotence,
      orphans) (src/lib/calibrate.test.ts)
- [x] D7 — README rewritten: divergence-not-IQ framing, bank-first architecture,
      deferred-DB note, CLI commands; BRAINSTORM Q1–Q5/Q7 already marked resolved
      (README.md, BRAINSTORM.md)

## 2026-06-11 — Legibility doctrine (user decision: no subtle visual differences)

Difficulty comes ONLY from rule complexity — never from how hard options are to tell
apart. An IQ test, not an eyesight test. Design note recorded in
docs/plans/rules-bank-agent-calibration.md §Settled decisions.

- [x] Rotation → quarter turns only (0/90/180/270) and triangles only — the one shape
      whose orientation reads instantly; rotated symmetric shapes rejected at the cell
      level (src/items/domains.ts, src/items/schema.ts)
- [x] Size → two-value DSL domain (s/l); "m" legacy-render-only; render contrast widened
      (s 0.55 vs l 1.3) (src/items/rules.ts, src/items/render.tsx)
- [x] `isInstantlyDistinct()` — categorical-difference test, enforced pairwise across ALL
      options (schema superRefine) and along governed runs (checkRule visibility)
      (src/items/domains.ts, src/items/schema.ts, src/items/rules.ts)
- [x] Generator: rotation rules anchor triangles; distractors near-miss in RULE space but
      always bold in visual space; oddOneOut schema-valid by construction; difficulty no
      longer tightens perceptual proximity (src/items/generate.ts)
- [x] Prompt: LEGIBILITY RULES replace the old symmetry math; new domains in the rule
      grammar (src/items/prompt.ts)
- [x] Bank regenerated under the doctrine (60 items, seed 7, d1–d5 ×12 each); PNG fixtures
      regenerated; 113 tests + lint + typecheck + build + bank:verify green
- [x] Recalibrated: old attempt corpus archived (data/attempts/archive-pre-legibility/),
      fresh 300-attempt image-channel run + `report --write` over the new bank

## 2026-06-11 — Difficulty selector before starting a test

- [x] `DifficultyLevel` (easy/standard/hard) + per-slot ramps (easy 1,1,2,2,3 ·
      standard 2,2,3,3,5 · hard 3,4,4,5,5); `sampleQuiz` rewritten as a ramp-based
      sampler (nearest-available difficulty, type-coverage preference) (src/items/bank.ts)
- [x] Route accepts `difficulty` in the POST body on all paths (bank, fresh, fallback)
      (src/app/api/generate/route.ts)
- [x] Fresh-AI path: `buildUserPrompt(difficulty)` lineups per level;
      `generatePuzzles(..., difficulty)` (src/items/prompt.ts, src/lib/model.ts)
- [x] Intro UI: Easy/Standard/Hard segmented control (aria-pressed, focus rings,
      per-level blurb); choice reused by error-screen retry (src/app/page.tsx)
- [x] Tests: profile assertions (easy ≤3, hard ≥3 with ≥3 items d4+) — 114 tests green;
      live route smoke returns exact ramps per level

## 2026-06-11 — Codex review fixes (docs/handoff.md, review→fix)

- [x] Removed `.github/workflows/ci.yml` + scrubbed CI references from README/TODO/plan
      doc — no remote CI by policy; verification is local
- [x] `report.ts --write` refuses mixed promptVersions; `--version <v>` selects the
      population to calibrate from (never pools incomparable runs) (scripts/report.ts)
- [x] `bank-topup.ts --count` is now an exact ceiling for every source: model loops the
      relay until N banked (call cap), `both` splits model/procedural (scripts/bank-topup.ts)
- [x] Fallback notice sanitized — raw relay/provider errors logged server-side only;
      plain one-line banner shown on Q1 only (src/app/api/generate/route.ts, src/app/page.tsx)
