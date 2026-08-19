/**
 * Agent solver harness — runs test items through a vision/text model via the
 * relay and writes an attempt artifact to data/attempts/.
 *
 *   npm run agent:run                                      # 20 generated items, image channel
 *   npm run agent:run -- --source bank --items 40          # the legacy reference bank instead
 *   npm run agent:run -- --profile short-5 --items 15 --seed run-a
 *   npm run agent:run -- --all --channel symbolic --repeat 2 --concurrency 3
 *
 *   flags: --source generated|bank (default generated)
 *          --profile short-5|long-30 (default long-30; generated source only)
 *          --seed S (default random; makes a generated run replayable)
 *          --items N (default 20; --all takes every item the source offers)
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
 * so artifacts stay comparable across runs. An unparseable reply (chosen: null)
 * counts incorrect. A relay 429 aborts the whole run, still writing the partial
 * artifact (the items solved so far are real data).
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { loadBank } from "../src/items/bank";
import {
  assembleExpandedQuiz,
  questionCount,
  EXPANDED_PROFILES,
  type ExpandedProfile,
} from "../src/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds } from "../src/items/family-promotion";
import {
  shuffleOptions,
  toPublicPuzzle,
  visualElementSignature,
  type Puzzle,
  type PuzzleType,
  type Visual,
} from "../src/items/schema";
import { solveItem, SOLVER_PROMPT_VERSION } from "../src/lib/solver";
import { AttemptFileSchema, type Attempt, type AttemptFile, type Channel } from "../src/lib/attempts";
import { isRateLimitError } from "../src/lib/relay-errors";

const ATTEMPTS_DIR = new URL("../data/attempts/", import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    items: { type: "string", default: "20" },
    all: { type: "boolean", default: false },
    source: { type: "string", default: "generated" },
    profile: { type: "string", default: "long-30" },
    seed: { type: "string" },
    channel: { type: "string", default: "image" },
    provider: { type: "string" },
    model: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "2" },
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

  const wanted = args.all ? Number.POSITIVE_INFINITY : Math.max(1, Number(args.items));
  const seed = args.seed ?? randomBytes(8).toString("hex");
  const pool = source === "bank"
    ? loadBank().map((item) => item.puzzle as Puzzle<Visual>)
    // `--all` on the generated source means one whole test, not an endless pool.
    : generatedPool(profile, seed, args.all ? questionCount(profile) : Number(args.items));
  const items = wanted >= pool.length ? pool : sampleItems(pool, wanted);

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
          latencyMs: outcome.latencyMs,
          generation: canonical.generation,
          attemptBudget: 1,
          raw: outcome.raw.slice(0, 200),
          ts: new Date().toISOString(),
        });
      } catch (err) {
        if (isRateLimitError(err)) {
          // Relay 429 — abort the whole run; the partial artifact still gets written.
          aborted = true;
          console.error(`\nrate limited — aborting run after ${attempts.length} attempts`);
          return;
        }
        // Other errors: record an unparseable (incorrect) attempt and keep going.
        attempts.push({
          itemId: canonical.id,
          chosen: null,
          correct: false,
          latencyMs: 0,
          generation: canonical.generation,
          attemptBudget: 1,
          raw: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          ts: new Date().toISOString(),
        });
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
    attempts,
  });

  const outPath = `${ATTEMPTS_DIR}${runId}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`\nwrote ${attempts.length} attempts → ${outPath}${aborted ? " (PARTIAL — run aborted)" : ""}`);

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
