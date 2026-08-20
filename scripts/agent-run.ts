/**
 * Agent solver harness — runs test items through a vision/text model via the
 * relay and writes an attempt artifact to data/attempts/.
 *
 *   npm run agent:run                                      # coverage-driven generated probe
 *   npm run agent:run -- --source bank --items 40          # the expanded reference bank instead
 *   npm run agent:run -- --profile short-5 --items 50 --seed run-a
 *   npm run agent:run -- --all --no-coverage --channel symbolic --repeat 2 --concurrency 3
 *
 *   flags: --source generated|bank (default generated)
 *          --profile short-5|long-30 (default long-30; generated source only)
 *          --seed S (default random; makes a generated run replayable)
 *          --items N (coverage is still required; --all takes one whole generated test)
 *          --no-coverage (custom generated run; default 20 items)
 *          --channel image|symbolic
 *          --provider X  --model Y (default RELAY_PROVIDER/RELAY_MODEL env)
 *          --repeat N (default 1)  --concurrency N (default 2)
 *
 * The default source is the live generator, so a run measures the same
 * questions people get. The bank stays available as the fixed regression
 * corpus, which is what makes two runs months apart comparable.
 *
 * Per attempt: options are shuffled (per-attempt position-bias removal) and the
 * chosen SHUFFLED index is mapped back to the canonical option before recording,
 * so artifacts stay comparable across runs. Every non-correct outcome counts
 * incorrect, but artifacts distinguish reasoning, parser, and harness failures.
 * A relay 429 aborts the run after recording that failed attempt; reports omit
 * the resulting partial artifact unless explicitly asked to include it.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { loadBank } from "../src/items/bank";
import {
  assembleExpandedQuiz,
  questionCount,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  type ExpandedProfile,
} from "../src/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  normalizeWithdrawnFamilyIds,
  readWithdrawnFamilyIds,
} from "../src/items/family-promotion";
import {
  shuffleOptions,
  toPublicPuzzle,
  visualElementSignature,
  type Puzzle,
  type PuzzleType,
  type Visual,
} from "../src/items/schema";
import { solveItem, SOLVER_PROMPT_VERSION } from "../src/lib/solver";
import {
  AttemptFileSchema,
  ATTEMPT_OUTCOMES,
  outcomeOf,
  type Attempt,
  type AttemptFile,
  type AttemptOutcome,
  type Channel,
} from "../src/lib/attempts";
import { isRateLimitError } from "../src/lib/relay-errors";

/** Outcomes where the model actually answered. Mirrors calibrate's reporting rule. */
const MODEL_ANSWER_OUTCOMES = new Set(["correct", "wrong", "unparseable"]);
import {
  coverageComplete,
  formatMissingCoverage,
  probeCoverage,
  selectCoverageItems,
  standardProbeRequirements,
} from "../src/lib/agent-probe";

const ATTEMPTS_DIR = new URL("../data/attempts/", import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    items: { type: "string" },
    all: { type: "boolean", default: false },
    source: { type: "string", default: "generated" },
    profile: { type: "string", default: "long-30" },
    seed: { type: "string" },
    channel: { type: "string", default: "image" },
    provider: { type: "string" },
    model: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "2" },
    "no-coverage": { type: "boolean", default: false },
  },
});

/** Sample N items spread across types/difficulties (group by type, round-robin). */
function sampleItems(pool: Puzzle<Visual>[], n: number): Puzzle<Visual>[] {
  const byType = new Map<PuzzleType, Puzzle<Visual>[]>();
  for (const puzzle of pool) {
    const list = byType.get(puzzle.type) ?? [];
    list.push(puzzle);
    byType.set(puzzle.type, list);
  }
  // Within each type, spread across difficulty by sorting then interleaving.
  for (const list of byType.values()) {
    list.sort((a, b) => a.difficulty - b.difficulty);
  }
  const queues = [...byType.values()];
  const picked: Puzzle<Visual>[] = [];
  let i = 0;
  while (picked.length < n && queues.some((q) => q.length > 0)) {
    const q = queues[i % queues.length];
    if (q.length > 0) picked.push(q.shift()!);
    i++;
  }
  return picked;
}

/** Map a chosen index in the shuffled puzzle back to the canonical option index. */
function canonicalIndex(
  canonical: Puzzle<Visual>,
  shuffled: Puzzle<Visual>,
  chosenShuffled: number | null,
): number | null {
  if (chosenShuffled === null) return null;
  const chosenVisual = shuffled.options[chosenShuffled];
  if (!chosenVisual) return null;
  // Identity covers both compact cells and board scenes; options are guaranteed
  // distinct by the schema, so the first match is unambiguous.
  const sig = visualElementSignature(chosenVisual);
  const idx = canonical.options.findIndex((opt) => visualElementSignature(opt) === sig);
  return idx >= 0 ? idx : null;
}

/**
 * Enough freshly generated tests to cover the requested item count.
 *
 * Each test gets its own child seed off the run seed, so `--seed` replays the
 * whole run item for item.
 */
function generatedPool(profile: ExpandedProfile, seed: string, wanted: number): Puzzle<Visual>[] {
  const registry = CURRENT_FAMILY_PROMOTION_REGISTRY;
  const withdrawn = readWithdrawnFamilyIds();
  const tests = Math.max(1, Math.ceil(wanted / questionCount(profile)));
  const pool: Puzzle<Visual>[] = [];
  for (let index = 0; index < tests; index++) {
    pool.push(...assembleExpandedQuiz(`${seed}:${index}`, profile, registry, withdrawn));
  }
  return pool;
}

/** Generate enough complete tests for both the target size and fixed coverage. */
function generatedCoveragePool(
  profile: ExpandedProfile,
  seed: string,
  wanted: number | undefined,
): { pool: Puzzle<Visual>[]; coverageItems: Puzzle<Visual>[] } {
  const registry = CURRENT_FAMILY_PROMOTION_REGISTRY;
  const withdrawn = readWithdrawnFamilyIds();
  const requirements = standardProbeRequirements(registry, withdrawn);
  const pool: Puzzle<Visual>[] = [];
  let coverageItems: Puzzle<Visual>[] = [];

  for (let index = 0; index < 100; index++) {
    pool.push(...assembleExpandedQuiz(`${seed}:${index}`, profile, registry, withdrawn));
    coverageItems = selectCoverageItems(pool, requirements);
    const coverage = probeCoverage(coverageItems, requirements);
    if (coverageComplete(coverage) && (wanted === undefined || pool.length >= wanted)) {
      return { pool, coverageItems };
    }
  }

  throw new Error(formatMissingCoverage(probeCoverage(coverageItems, requirements)));
}

function timeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      if (current.name === "TimeoutError" || current.name === "AbortError" || /timed?\s*out|timeout/i.test(current.message)) {
        return true;
      }
      current = current.cause;
    } else {
      break;
    }
  }
  return false;
}

function errorOutcome(error: unknown): AttemptOutcome {
  if (isRateLimitError(error)) return "rate-limit";
  if (timeoutError(error)) return "timeout";
  return "transport-failure";
}

const DIFFICULTY_TIER = (d: number): string => (d <= 2 ? "easy (1-2)" : d === 3 ? "mid (3)" : "hard (4-5)");

async function main() {
  const channel = args.channel as Channel;
  if (channel !== "image" && channel !== "symbolic") {
    throw new Error(`--channel must be "image" or "symbolic" (got "${args.channel}")`);
  }

  const provider = args.provider ?? process.env.RELAY_PROVIDER;
  const model = args.model ?? process.env.RELAY_MODEL;
  if (!provider || !model) {
    throw new Error("provide --provider/--model or set RELAY_PROVIDER/RELAY_MODEL in .env.local");
  }

  const repeat = Math.max(1, Number(args.repeat));
  const concurrency = Math.max(1, Number(args.concurrency));

  const source = args.source;
  if (source !== "generated" && source !== "bank") {
    throw new Error(`--source must be "generated" or "bank" (got "${source}")`);
  }
  const profile = args.profile as ExpandedProfile;
  if (source === "generated" && !EXPANDED_PROFILES.includes(profile)) {
    throw new Error(`--profile must be one of ${EXPANDED_PROFILES.join(", ")} (got "${args.profile}")`);
  }

  const requestedItems = args.items === undefined ? undefined : Number(args.items);
  if (requestedItems !== undefined && (!Number.isInteger(requestedItems) || requestedItems < 1)) {
    throw new Error(`--items must be a positive integer (got "${args.items}")`);
  }
  if (!Number.isInteger(repeat) || !Number.isInteger(concurrency)) {
    throw new Error("--repeat and --concurrency must be positive integers");
  }
  const seed = args.seed ?? randomBytes(8).toString("hex");
  let items: Puzzle<Visual>[];
  if (source === "bank") {
    const pool = loadBank().map((item) => item.puzzle as Puzzle<Visual>);
    const wanted = args.all ? pool.length : (requestedItems ?? 20);
    items = wanted >= pool.length ? pool : sampleItems(pool, wanted);
  } else if (args["no-coverage"]) {
    const wanted = args.all ? questionCount(profile) : (requestedItems ?? 20);
    const pool = generatedPool(profile, seed, wanted);
    items = wanted >= pool.length ? pool : sampleItems(pool, wanted);
  } else if (args.all) {
    // For the bank, `--all` means every banked item. For the generator there is
    // no finite pool, so it means the whole eligible battery at the standard
    // minimum. Taking a single test could never satisfy that: subsampling puts
    // ~14 of the 19 eligible families in any one test, so this branch used to
    // fail every time it was run.
    const { coverageItems } = generatedCoveragePool(profile, seed, undefined);
    items = coverageItems;
  } else {
    const { pool, coverageItems } = generatedCoveragePool(profile, seed, requestedItems);
    if (requestedItems !== undefined && coverageItems.length > requestedItems) {
      throw new Error(formatMissingCoverage(probeCoverage(coverageItems.slice(0, requestedItems),
        standardProbeRequirements(CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds()))));
    }
    const chosenIds = new Set(coverageItems.map((item) => item.id));
    const extrasNeeded = requestedItems === undefined ? 0 : requestedItems - coverageItems.length;
    const extras = extrasNeeded > 0
      ? sampleItems(pool.filter((item) => !chosenIds.has(item.id)), extrasNeeded)
      : [];
    items = [...coverageItems, ...extras];
    const requirements = standardProbeRequirements(CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds());
    const coverage = probeCoverage(items, requirements);
    if (!coverageComplete(coverage)) throw new Error(formatMissingCoverage(coverage));
    console.log(`coverage: ${requirements.minimum} per ${requirements.families.length} eligible families and ${requirements.programComplexities.length} program-complexity buckets`);
  }

  // Build the full work list: each sampled item × repeat.
  const work: Puzzle<Visual>[] = [];
  for (let r = 0; r < repeat; r++) work.push(...items);

  const startedAt = new Date().toISOString();
  const sourceLabel = source === "bank" ? "bank" : `generated ${profile} · seed ${seed}`;
  console.log(
    `agent:run — ${items.length} items × ${repeat} = ${work.length} attempts · ${sourceLabel} · ${channel} channel · ${provider}/${model} · concurrency ${concurrency}`,
  );

  const attempts: Attempt[] = [];
  let aborted = false;
  let nextIndex = 0;

  const worker = async () => {
    while (!aborted) {
      const idx = nextIndex++;
      if (idx >= work.length) return;
      const canonical = work[idx];
      const shuffled = shuffleOptions(canonical);
      const attemptStarted = Date.now();
      try {
        // The solver receives the same answer-free contract as a browser. The
        // canonical puzzle stays local only for scoring and artifact metadata.
        const outcome = await solveItem(toPublicPuzzle(shuffled), channel, { provider, model });
        const chosen = canonicalIndex(canonical, shuffled, outcome.chosen);
        const correct = chosen !== null && chosen === canonical.answerIndex;
        attempts.push({
          itemId: canonical.id,
          chosen,
          correct,
          outcome: correct ? "correct" : chosen === null ? "unparseable" : "wrong",
          latencyMs: outcome.latencyMs,
          generation: canonical.generation,
          attemptBudget: 1,
          raw: outcome.raw.slice(0, 200),
          ts: new Date().toISOString(),
        });
      } catch (err) {
        const outcome = errorOutcome(err);
        attempts.push({
          itemId: canonical.id,
          chosen: null,
          correct: false,
          outcome,
          latencyMs: Date.now() - attemptStarted,
          generation: canonical.generation,
          attemptBudget: 1,
          raw: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          ts: new Date().toISOString(),
        });
        if (outcome === "rate-limit") {
          // Relay 429 — abort the whole run; the failed attempt remains visible.
          aborted = true;
          console.error(`\nrate limited — aborting run after ${attempts.length} attempts`);
          return;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // ── Artifact ──
  const modelSlug = model.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const runId = `${startedAt.replace(/:/g, "-")}-${modelSlug}-${channel}`;
  const artifact: AttemptFile = AttemptFileSchema.parse({
    runId,
    startedAt,
    provider,
    model,
    channel,
    promptVersion: SOLVER_PROMPT_VERSION,
    source,
    profile: source === "generated" ? profile : null,
    runSeed: seed,
    generatorVersion: source === "generated" ? EXPANDED_GENERATOR_VERSION : "bank-v1",
    // Only meaningful for generated runs: the bank ships its own provenance.
    withdrawnFamilyIds: source === "generated"
      ? normalizeWithdrawnFamilyIds(readWithdrawnFamilyIds())
      : undefined,
    plannedAttempts: work.length,
    completedAttempts: attempts.length,
    // A run where nothing reached the model is `failed`, not `complete`: every
    // attempt may be recorded and still measure nothing about the items.
    status: attempts.every((attempt) =>
      attempt.outcome !== undefined && !MODEL_ANSWER_OUTCOMES.has(attempt.outcome))
      ? "failed"
      : attempts.length === work.length ? "complete" : "partial",
    attempts,
  });

  const outPath = `${ATTEMPTS_DIR}${runId}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`\nwrote ${attempts.length} attempts → ${outPath}${artifact.status === "partial" ? " (PARTIAL — run aborted)" : ""}`);

  // ── End-of-run report ──
  report(attempts, items);
}

/** Console table: pass rate overall, by difficulty tier, type, and family. */
function report(attempts: Attempt[], items: Puzzle<Visual>[]) {
  if (attempts.length === 0) {
    console.log("\nno attempts recorded.");
    return;
  }
  const difficultyOf = new Map(items.map((i) => [i.id, i.difficulty]));
  const typeOf = new Map(items.map((i) => [i.id, i.type]));
  const familyOf = new Map(items.map((i) => [i.id, i.familyId]));

  const rate = (rows: Attempt[]) =>
    rows.length === 0 ? "—" : `${((rows.filter((a) => a.correct).length / rows.length) * 100).toFixed(0)}% (${rows.filter((a) => a.correct).length}/${rows.length})`;

  const group = <K>(keyOf: (a: Attempt) => K | undefined): Map<K, Attempt[]> => {
    const m = new Map<K, Attempt[]>();
    for (const a of attempts) {
      const k = keyOf(a);
      if (k === undefined) continue;
      const list = m.get(k) ?? [];
      list.push(a);
      m.set(k, list);
    }
    return m;
  };

  console.log(`\noverall:   ${rate(attempts)}`);
  console.log("\nby outcome (all non-correct outcomes remain incorrect):");
  for (const outcome of ATTEMPT_OUTCOMES) {
    console.log(`  ${outcome.padEnd(20)} ${attempts.filter((attempt) => outcomeOf(attempt) === outcome).length}`);
  }

  console.log("\nby difficulty tier:");
  const byTier = group((a) => {
    const d = difficultyOf.get(a.itemId);
    return d === undefined ? undefined : DIFFICULTY_TIER(d);
  });
  for (const tier of ["easy (1-2)", "mid (3)", "hard (4-5)"]) {
    const rows = byTier.get(tier);
    if (rows) console.log(`  ${tier.padEnd(12)} ${rate(rows)}`);
  }

  console.log("\nby type:");
  const byType = group((a) => typeOf.get(a.itemId));
  for (const [type, rows] of byType) {
    console.log(`  ${String(type).padEnd(12)} ${rate(rows)}`);
  }

  // Reasoning family is the unit the human-agent gap is reported in, so a run
  // over generated items prints it too. Bank items carry no family.
  const byFamily = group((a) => familyOf.get(a.itemId));
  if (byFamily.size > 0) {
    console.log("\nby reasoning family:");
    for (const [family, rows] of [...byFamily].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
      console.log(`  ${String(family).padEnd(26)} ${rate(rows)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
