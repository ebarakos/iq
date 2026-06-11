# Roadmap: rules → item bank → agent mode → calibration

Status: **design approved 2026-06-10** (plan-mode session; decisions confirmed with user).
Tasks live in [TODO.md](../../TODO.md) under the matching dated heading.
Grounded in: `src/items/schema.ts`, `src/items/render.tsx`, `src/items/prompt.ts`,
`src/lib/model.ts`, `src/items/fallback.ts`, `src/app/api/generate/route.ts`,
`src/app/page.tsx`, [BRAINSTORM.md](../../BRAINSTORM.md) Q1–Q7.

Four phases, **A → B → C → D**, each independently shippable. B depends on A's
`rule`/`checkRule`; C depends on B's bank ids; D depends on C's artifacts.

---

## Settled decisions (do not relitigate)

- **Legibility doctrine (added 2026-06-11, user decision):** difficulty may come ONLY from
  rule complexity — never from perceptual proximity. Every visual difference a puzzle trades
  on must be readable instantly: different shape/count/fill, size small-vs-large only (the
  "m" size is legacy-render-only), rotation as quarter turns on triangles only (all other
  shapes are too symmetric and must use rotation 0). Enforced by `isInstantlyDistinct()`
  (domains.ts) pairwise across options (schema) and along governed runs (checkRule), by
  cell-level schema refinements, and by the generator's sampling constraints. Distractors
  stay near-misses in rule space but are always bold in visual space.

- **Q1 — visibility only**: items are visual + a short fixed neutral `instruction`
  ("Which option completes the grid?"). Current MVP behavior, kept. No language skill tested.
- **Q2 — agent channel**: dual-channel, **image first** — render the same SVG a human sees to
  PNG → vision model via relay; symbolic JSON (the raw cell spec) is a secondary channel for
  text-only models. Every attempt records its channel; **only image-channel results are
  human-comparable**. Vision-capable relay models: openrouter `google/gemini-3-flash-preview`,
  openai `gpt-4o-mini` / `gpt-4.1-mini`, groq `meta-llama/llama-4-scout-17b-16e-instruct`
  (free; default dev model). Project preference: mid-tier value models, no flagships.
- **Q3 — generator vs solver models**: generator = env default (`RELAY_*`) / widget override;
  solver = per-run CLI flag from the vision-capable list. Different jobs, freely different models.
- **Q4 — generation strategy**: hybrid — rules are first-class machine-readable data;
  **procedural re-derivation IS the semantic validator**; LLM generation stays for variety and
  must pass it.
- **Q5 — difficulty**: a priori first (`ruleComplexity`), recalibrated empirically from
  attempt data later.
- **Q7 — scoring**: **no single comparable IQ score.** Human score and agent
  pass-rate-by-tier stay separate; the headline product is the **divergence**
  (human-easy/agent-hard and vice versa).
- **Persistence**: file-based. Item bank = `data/bank/items.json` (committed); agent attempts =
  `data/attempts/<run-id>.json` artifacts (committed — they are the calibration corpus). No DB;
  human attempt aggregation is explicitly deferred. The attempt-artifact schema is shaped so a
  future DB table is a 1:1 import.
- **Stack**: TS strict / Next 15 / Vercel; all model traffic through llm-relay via
  `createRelayFetch` + `client.chat(model)` (Chat Completions only).

---

## Phase A — Rules as data + semantic validator

### Goal

Every puzzle carries a machine-readable rule from which pure code re-derives the correct
answer. The validator (re-derivation + comparison) closes the MVP's core reliability gap: a
weak model can no longer ship a mis-marked answer. The same DSL powers a procedural generator
with guaranteed-correct items.

### Design

**New file `src/items/rules.ts`** — the rule DSL, Zod-typed. Each cell dimension gets an
ordered domain (the DSL's own ordering — `fill` is deliberately ordinal here, unlike the
unordered `FILLS` in schema.ts):

```ts
export const DIMENSIONS = ["shape", "count", "rotation", "fill", "size"] as const;
export type Dim = (typeof DIMENSIONS)[number];

// Ordered value domains. Transforms operate on the INDEX into these arrays.
export const DIM_DOMAINS = {
  shape:    SHAPES,                       // nominal — only constant/cycle allowed
  count:    [1, 2, 3, 4],
  rotation: ROTATIONS,                    // index step of 1 = 45°; always cyclic
  fill:     ["outline", "half", "solid"], // ordinal: outline < half < solid
  size:     ["s", "m", "l"],
} as const;
```

A **per-dimension transform** describes how one dimension changes per step along one axis:

```ts
export const DimTransformSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("constant") }),
  // Index-step in the ordered domain. wrap=true → modular (4→1, l→s, solid→outline).
  z.object({ op: z.literal("step"), delta: z.number().int().min(-3).max(3), wrap: z.boolean() }),
  // Explicit value cycle: position i → values[i % values.length]. Only non-constant op for `shape`.
  z.object({ op: z.literal("cycle"), values: z.array(z.union([z.string(), z.number()])).min(2).max(6) }),
]);
// `transforms` maps dims to non-constant behavior; unlisted dims are implicitly constant
// (and the validator CHECKS they are constant in the stem).
export type DimTransforms = Partial<Record<Dim, DimTransform>>;
```

The four rule kinds, discriminated on `kind` and matched to `Puzzle.type`:

```ts
export const RuleSchema = z.discriminatedUnion("kind", [
  // 1-D: each consecutive stem cell pair must satisfy every transform; answer = one more
  // step from the last drawn cell.
  z.object({ kind: z.literal("sequence"), transforms: DimTransformsSchema }),

  // 2-D: row = transforms applied left→right within EVERY row (each row anchors on its own
  // first cell); col = top→bottom within every column. A dim may be governed by at most ONE
  // axis (superRefine: row/col key sets disjoint); dims in neither are globally constant.
  z.object({ kind: z.literal("matrix"), row: DimTransformsSchema, col: DimTransformsSchema }),

  // A→B single-step transform, re-applied to C. v1 restriction: shape constant
  // (shape-changing analogies are not expressible — see escape hatch).
  z.object({ kind: z.literal("analogy"), transforms: DimTransformsSchema }),

  // All non-answer options share `value` on `dimension`; the answer breaks it. Formalizes
  // the existing group-coherence superRefine as declared data.
  z.object({ kind: z.literal("oddOneOut"), dimension: z.enum(DIMENSIONS), value: z.union([z.string(), z.number()]) }),
]);
export type Rule = z.infer<typeof RuleSchema>;
```

**The validator** — single pure entry point:

```ts
export type RuleCheck =
  | { ok: true; derived: Cell | null }   // null for oddOneOut (rule selects an index, no derived cell)
  | { ok: false; issues: string[] };     // human-readable, fed verbatim into the LLM retry loop

export function checkRule(puzzle: Puzzle): RuleCheck;
```

Checks, in order:
1. **Rule/type match** and rule values belong to the right domains.
2. **Whole-stem consistency** — the rule must explain the *entire* stem, not just produce an
   answer: every consecutive pair along each governed axis satisfies its transform; unlisted
   dims are constant; analogy A→B matches `transforms` exactly. (Catches incoherent items,
   not just mis-marked answers — the actual observed failure mode.)
3. **Answer match** — `visualSignature(options[answerIndex]) === visualSignature(derivedCell)`.
   oddOneOut: exactly one option breaks `{dimension, value}` and it is `options[answerIndex]`.
4. **Unique solution** — free for sequence/matrix/analogy: the rule derives exactly one cell
   and the existing options-distinctness superRefine guarantees no other option renders like
   it (documented, not re-implemented). For oddOneOut the exactly-one-breaker check in (3) is
   the uniqueness check.
5. **Degeneracy / visibility** — reuse `ROTATION_PERIOD`: reject a `rotation` step when
   `(delta*45) % ROTATION_PERIOD[shape] === 0` for any governed cell's shape; reject rules
   with zero non-constant transforms; consecutive governed stem cells must differ in
   `visualSignature`.

**Schema change (`src/items/schema.ts`)** — `PuzzleSchema` gains:

```ts
rule: RuleSchema.optional()   // + superRefine: rule.kind must equal puzzle.type when present
```

Items without `rule` are **unvalidated** (escape hatch): still renderable/servable by the
legacy path, but excluded from the Phase B calibrated bank. Import direction: rules.ts imports
only constants/types from schema.ts; schema.ts imports only `RuleSchema` back. If Zod
circularity bites, hoist shared constants to `src/items/domains.ts`.

**Generation hook (`src/lib/model.ts`)** — after `PuzzleSetSchema.safeParse` succeeds in the
retry loop, run `checkRule` per puzzle. A missing rule or failed check produces feedback lines
in the established style (`- p3 (matrix): rule derives {…} but options[answerIndex] is {…};
fix answerIndex or the options`) and the loop retries. Factor the parse + rule-check pair into
an exported `validatePuzzleSet(parsed)` so the Phase B CLI reuses it identically.

**Prompt (`src/items/prompt.ts`)** — SYSTEM_PROMPT gains a compact rule grammar (three ops,
four kinds, one example each); `buildUserPrompt()` requires the `"rule"` field and replaces
the "CRITICAL self-check" paragraph with: *we mechanically re-derive the answer from your
rule; if options[answerIndex] is not the derived cell the item is rejected with the
derivation shown*. Randomized order/dimension-emphasis machinery untouched.

**Procedural generator — new `src/items/generate.ts`** (+ `src/lib/rng.ts`, seeded
mulberry32-style RNG for reproducibility):

```ts
export function sampleRule(type: PuzzleType, difficulty: 1|2|3|4|5, rng: Rng): Rule;
export function generateStem(rule: Rule, rng: Rng): Panel[];     // picks anchors; guarantees visibility
export function generateDistractors(rule: Rule, answer: Cell, stem: Panel[], difficulty: number, rng: Rng): Cell[];
export function generatePuzzle(type: PuzzleType, difficulty: number, rng: Rng): Puzzle;  // passes schema + checkRule by construction
export function ruleComplexity(rule: Rule): number;              // Q5 a-priori difficulty anchor
```

- Difficulty drives sampling: d1–2 = one non-constant dim, |delta|=1, no wrap; d3 = one dim
  with wrap/|delta|≥2 or two dims on one axis; d4 = two dims; d5 = matrix with both axes
  active, 5–6 options.
- Distractors are near-misses: single-dimension ±1-step perturbations of the answer, the
  previous sequence value, off-by-one rule application — filtered `visualSignature`-distinct
  from the answer and each other. Harder difficulty = closer distractors.
- `ruleComplexity` also audits model-declared difficulty (warn-level mismatch, not rejection).

**Fallback bank** — all 12 items in `src/items/fallback.ts` gain a `rule` (all 12 verified
expressible in the DSL); a unit test asserts each passes `checkRule`.

**Not expressible in v1 (documented escape hatch)**: multiplicative count rules,
shape-changing analogies, Latin-square / distribution-of-3 matrices, XOR/set-operation rules,
position-dependent layouts. Latin-square (`latin: Dim[]` on the matrix rule) is the first
planned DSL extension. Unexpressible items omit `rule` → unvalidated → excluded from bank.

### Key decisions

| Decision | Why |
|---|---|
| Index-step over ordered domains, single `DimTransform` shape | One mechanism covers count/rotation/fill/size and both 1-D and 2-D axes; trivially derivable in pure code |
| Rule must explain the whole stem | Catches incoherent model items, not just mis-marked answers |
| Matrix = disjoint row/col transform maps | Keeps derivation unambiguous; still covers all current items incl. the d5 two-rule matrix |
| `rule` optional on PuzzleSchema | Backward compatible; the escape hatch falls out for free |
| Uniqueness via existing distinctness superRefine | Invariant already enforced and tested; no duplicate logic |

### Risks

- LLM rule-emission quality: stricter validation → more retries/fallbacks on weak models.
  Mitigated by Phase B: the bank becomes the primary serving path, so live-generation success
  rate stops being user-facing.
- Zod circular import schema↔rules — resolve with `src/items/domains.ts` if needed.
- DSL expressiveness ceiling is intentional; resist widening before calibration data shows need.

---

## Phase B — Item bank as data

### Goal

Validated items live as JSON in the repo. Quizzes serve instantly from the bank; live
generation becomes the opt-in variety path; the hand-authored fallback set folds into the bank
so there is one item store.

### Design

**Layout** (single pretty-printed file, items sorted by id for stable diffs; shard by type
only if it grows past ~1k items):

```
data/
  bank/items.json        # BankFile: { version: 1, items: BankItem[] }
  attempts/              # Phase C artifacts, one file per run
```

**New `src/items/bank.ts`**:

```ts
export const BankItemSchema = z.object({
  puzzle: PuzzleSchema,                    // canonical authored option order (UNshuffled; shuffle at serve time)
  fingerprint: z.string(),                 // dedup identity, see below
  provenance: z.object({
    source: z.enum(["procedural", "model", "handAuthored"]),
    provider: z.string().optional(),       // when source = "model"
    model: z.string().optional(),
    seed: z.number().optional(),           // when source = "procedural"
    createdAt: z.string(),                 // ISO 8601
  }),
  tags: z.array(z.string()).default([]),   // Phase D writes "agent-easy" | "agent-mid" | "agent-hard"
  calibration: z.object({                  // Phase D summary, optional until first report
    attempts: z.number().int(),
    solveRate: z.number(),                 // image channel only
    byModel: z.record(z.string(), z.object({ attempts: z.number(), solveRate: z.number() })),
    updatedAt: z.string(),
  }).optional(),
});
export const BankFileSchema = z.object({ version: z.literal(1), items: z.array(BankItemSchema) });

export function fingerprintPuzzle(p: Puzzle): string;
export function loadBank(): BankItem[];                 // static JSON import + Zod parse at module load
export function sampleQuiz(items: BankItem[], n = 5): PuzzleSet;
```

- **ID scheme**: content-addressed — `fingerprint = sha256(type | layout | stem panel
  signatures in order ("·" for blank) | SORTED option visualSignatures | answer's
  visualSignature).slice(0,10)`; `puzzle.id = "<prefix>-<fingerprint>"` (`mx-`, `sq-`, `an-`,
  `oo-`). Sorted option signatures make identity shuffle-invariant; the answer signature is
  separate so the same stem with a different correct answer is a different item.
- **Dedup**: top-up skips existing fingerprints (catches LLM near-duplicates and procedural
  collisions).
- **Bank invariant**: every bank item has a `rule` and passes `checkRule` — re-verified on
  write (CLI) and on read (local `bank:verify` / unit test).
- **Sampler `sampleQuiz`** ports the `getFallbackPuzzles` contract: ≥3 types, target
  [2,2,3,3,5] difficulty ramp with nearest-available matching, ascending sort, `shuffleOptions`
  per item, unique ids. **`fallback.ts` is then deleted**; the embedded bank (static import —
  always available, no fs, no Vercel tracing config) IS the resilience path.

**CLI — `scripts/bank-topup.ts`** (run as `node --env-file=.env.local --import tsx
scripts/bank-topup.ts`; `tsx` devDependency — scripts import TS app modules):

- Flags: `--count 20 --source procedural|model|both --type matrix --difficulty 4 --seed 123`.
- Procedural path: `generatePuzzle()` loop. Model path: `generatePuzzles()` (already returns 5
  validated, rule-checked puzzles per call), bank every item with provider/model provenance.
- One-time `--seed-fallback` migrates the 12 hand-authored items (with Phase A rules) as
  `source: "handAuthored"`.
- npm scripts: `bank:topup`, `bank:verify` (schema + checkRule + fingerprint integrity over
  the whole bank; run locally before committing bank changes).

**Serving — `src/app/api/generate/route.ts`**: request body gains `{ fresh?: boolean }`.
- Default: `sampleQuiz(loadBank())` → instant response, `source: "bank"`.
- `fresh: true`: existing relay path; on failure falls back to the bank with a `notice`
  (`source: "fallback"` semantics preserved for the UI banner).
- `src/app/page.tsx`: `Source` becomes `"bank" | "relay" | "fallback"`; intro gains a
  secondary "generate a fresh test" affordance; attribution shows "from the calibrated item
  bank" for bank-served tests.

### Key decisions

| Decision | Why |
|---|---|
| Static JSON import, not fs reads | Identical behavior on Vercel serverless, zero tracing config; Zod-parsed once at module load |
| Content-addressed ids | Dedup, shuffle-invariance, stable identity from one mechanism |
| Canonical (unshuffled) storage + serve-time shuffle | Stable bank diffs; position-bias removal stays in `shuffleOptions` |
| Bank as default serving path | Instant start; live-generation reliability stops being user-facing |
| Delete fallback.ts after migration | One item store; "fallback" becomes "bank" (strictly more items) |

### Risks

- New bank items reach Vercel only on deploy (by design of file-based persistence).
- `next build` bundles items.json into the route bundle — fine for hundreds of items.
- Repeat players can see repeat items: mitigated by sampler randomness + top-ups; solved only
  with per-user history (DB-deferred).

---

## Phase C — Agent mode (CLI solver harness, local-only)

### Goal

A local CLI renders bank items to PNG, sends them through the relay to a vision model
("answer with the option letter only"), and writes attempt artifacts to `data/attempts/`.
Image channel primary; symbolic JSON channel recorded-but-secondary.

### Design

**Gate task — relay multimodal passthrough smoke test.** The relay is
`/v1/chat/completions`-only and has only been exercised with string content. First task sends
one tiny composed PNG to each candidate vision model (gemini-3-flash-preview, gpt-4o-mini,
gpt-4.1-mini, llama-4-scout free) and prints pass/fail per model. **If blocked**: ship the
harness symbolic-channel-first (artifacts already record channel — no schema change) and file
the relay fix upstream (`../llm-relay`).

**Rendering — new `src/items/compose-image.tsx`.** `CellGraphic` is pure SVG and reusable;
`StemView`/`PanelBox` lay out with Tailwind-classed divs that are meaningless outside the
app's CSS, so the agent image **cannot** reuse `StemView`. New pure-SVG composition (inline
attributes only, no CSS):

```tsx
// Stem + lettered options composed into ONE self-contained <svg>: nested
// <svg x y width height viewBox="0 0 100 100"> per cell (reusing CellGraphic internals),
// <rect> cell borders, <text> for "?", ":" "::" separators, A–F option labels.
export function PuzzleImage({ puzzle }: { puzzle: Puzzle }): ReactElement;
export function puzzleToSvg(puzzle: Puzzle): string;  // renderToStaticMarkup(<PuzzleImage/>)
```

PNG via **`@resvg/resvg-js`** (devDependency; native module imported only by scripts, never by
Next app code — Vercel build unaffected). Text is only "?", separators, and letters; render
with `loadSystemFonts: true` (CLI runs locally). Font fallback if needed: dashed empty rect
for "?", drawn markers for letters (noted, not built).

**Solver — new `src/lib/solver.ts`.** Reuses the `relayModel()` pattern (createOpenAI +
`createRelayFetch` + `client.chat(model)`) with multimodal content parts:

```ts
export type Channel = "image" | "symbolic";
// image: content parts [{type:"image", image: pngBase64DataUrl}, {type:"text", text: prompt}]
// symbolic: raw cell-spec JSON (stem + options; answerIndex/explanation/rule STRIPPED)
export async function solveItem(puzzle: Puzzle, channel: Channel, opts: SolverOpts): Promise<SolveOutcome>;
export function parseAnswerLetter(raw: string, optionCount: number): number | null;  // tolerant
```

Solver prompt is neutral, fixed, and versioned (`promptVersion: "solver-v1"`): *"This is a
visual puzzle. Exactly one lettered option is correct. Reply with ONLY the letter."* Options
are shuffled per attempt (`shuffleOptions`) and the chosen index mapped back to the canonical
option before recording — position bias cannot inflate scores.

**Harness — `scripts/agent-run.ts`** (`npm run agent:run`):

- Flags: `--items 20` (sampled across types/difficulties; or `--all`), `--channel
  image|symbolic`, `--provider/--model` (default from RELAY_* env), `--repeat 1`,
  `--concurrency 2` (gentle on relay limits; abort run on 429, mirroring model.ts).
- Artifact `data/attempts/<run-id>.json`, `run-id = <ISO-ts>-<model-slug>-<channel>`; schema
  shared with Phase D in **`src/lib/attempts.ts`**:

```ts
export const AttemptFileSchema = z.object({
  runId: z.string(), startedAt: z.string(),
  provider: z.string(), model: z.string(),
  channel: z.enum(["image", "symbolic"]),
  promptVersion: z.string(),
  attempts: z.array(z.object({
    itemId: z.string(),
    chosen: z.number().int().nullable(),   // canonical option index; null = unparseable reply
    correct: z.boolean(),
    latencyMs: z.number(),
    raw: z.string().max(200).optional(),   // truncated model reply, for debugging
    ts: z.string(),
  })),
});
```

- End-of-run console report: pass rate by difficulty tier / type / channel.

### Key decisions

| Decision | Why |
|---|---|
| CLI-first, local-only; resvg + tsx as devDeps | Native module + long batch runs don't belong on Vercel; zero deploy impact |
| New pure-SVG composition instead of StemView | Tailwind layout doesn't survive outside app CSS; nested SVGs give the agent deterministically "the same picture" |
| AI SDK content parts (not raw fetch) | Same plumbing as model.ts (provider injection, 429 interception, attribution) with multimodal built in |
| Per-attempt shuffle, canonical-index recording | Position bias removed; artifacts comparable across runs |
| Smoke test first | The image channel hinges on relay passthrough; fail fast, fall back to symbolic-first |

### Risks

- Relay multimodal passthrough (gated above) — primary risk.
- Image size/cost: one ~800px composed PNG is well within mid-tier limits; smoke test verifies.
- Chatty models defeating letter parsing — `parseAnswerLetter` tolerant; unparseable replies
  recorded `chosen: null`, counted incorrect, visible in artifacts.

---

## Phase D — Calibration & scoring (from file artifacts)

### Goal

Aggregate `data/attempts/` into per-item agent solve rates, tag items (agent-easy → "human
item", agent-hard → "frontier"), report a-priori-vs-empirical divergence, flow tags back into
the bank. Human percentile is deferred (no DB); the quiz UI surfaces the agent-tag per item
after answering.

### Design

**Aggregation core — `src/lib/calibrate.ts`** (pure, unit-testable; scripts are thin shells):

```ts
export const MIN_ATTEMPTS = 5;           // below this → untagged ("insufficient data")
export function agentTag(solveRate: number): "agent-easy" | "agent-mid" | "agent-hard";
// ≥ 0.90 → "agent-easy" (route to humans)   ≤ 0.40 → "agent-hard" (frontier)   else "agent-mid"
```

**Report — `scripts/report.ts`** (`npm run report`, dry-run by default; `--write` updates the
bank in place):

1. Load + Zod-validate all `data/attempts/*.json`; **headline stats use channel === "image"
   only** (symbolic in a separate secondary table, per Q2).
2. Per item: attempts, solveRate, byModel breakdown (different models are never silently
   pooled — the pooled rate is labeled "all tested models").
3. **Divergence report** (the product headline, per Q7): a priori `puzzle.difficulty` (1–5) ×
   empirical tag matrix, plus top-N mismatches both directions ("d5 but agents ace it", "d2
   but agents fail it"). Until a DB exists, a priori difficulty is the human-difficulty proxy
   and the report says so explicitly. No combined score is ever computed.
4. `--write`: sets `tags` and the `calibration` block in `data/bank/items.json` (schema from
   Phase B), idempotent.
5. The report groups by `promptVersion` when artifact versions differ (prompt drift never
   silently pollutes comparisons).

**UI surfacing**: the generate route attaches per-served-item
`agentStats?: { solveRate, attempts, tag }` from the bank's calibration field (client never
receives the whole bank; only bank-served items have stats). `ReviewItem` renders a chip:
*"AI agents get this right 90% of the time — based on N runs"* / *"Most AI agents fail this
one"*. **Review-only, never during solving** (would bias human answers).

**Deferred-DB note (design only, do not build)**: future `attempts` table mirrors
`AttemptFileSchema.attempts[]` + `subject: "human" | "agent"`; existing artifacts import 1:1;
`calibrate.ts` gains a data source, not a rewrite. Human percentile, IRT-style recalibration,
and adaptive routing start there.

### Key decisions

| Decision | Why |
|---|---|
| Image-channel-only headline stats | Q2: only image attempts are human-comparable; symbolic is diagnostic |
| Tags + calibration written into bank files | Single source of truth travels with items; serving and reporting need no join |
| Aggregation in `calibrate.ts`, scripts as shells | Unit-testable; reusable verbatim when the DB arrives |
| Review-screen chip only | Mid-test agent stats would bias humans |
| Thresholds as named constants | They WILL move with real attempt volume; recalibration = one-line diff |

### Risks

- Small-n noise — `MIN_ATTEMPTS` gate + attempt counts shown next to every rate.
- Model mix — `byModel` always reported.
- Prompt-version drift — artifacts carry `promptVersion`; report groups by it.

---

## Cross-phase notes

- **New dependencies**: `tsx`, `@resvg/resvg-js` — devDependencies only; the deployed Next app
  gains zero runtime deps.
- **Script env**: `node --env-file=.env.local --import tsx scripts/<name>.ts` (Next's
  automatic `.env.local` loading doesn't apply outside `next dev/build`).
- **Local verification** (no remote CI by policy): `npm run bank:verify` catches a hand-edited
  or merge-mangled bank; run it with lint/typecheck/test/build before committing.
