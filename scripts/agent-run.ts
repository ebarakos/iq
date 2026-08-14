/**
 * Agent solver harness — runs bank items through a vision/text model via the
 * relay and writes an attempt artifact to data/attempts/.
 *
 *   npm run agent:run                                      # 20 items, image channel, env model
 *   npm run agent:run -- --items 40 --provider openai --model gpt-4o-mini
 *   npm run agent:run -- --all --channel symbolic --repeat 2 --concurrency 3
 *
 *   flags: --items N (default 20; --all overrides)  --channel image|symbolic
 *          --provider X  --model Y (default RELAY_PROVIDER/RELAY_MODEL env)
 *          --repeat N (default 1)  --concurrency N (default 2)
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
import { loadBank, type BankItem } from "../src/items/bank";
import { shuffleOptions, toPublicPuzzle, visualSignature, type Puzzle, type PuzzleType } from "../src/items/schema";
import { solveItem, SOLVER_PROMPT_VERSION } from "../src/lib/solver";
import { AttemptFileSchema, type Attempt, type AttemptFile, type Channel } from "../src/lib/attempts";
import { isRateLimitError } from "../src/lib/relay-errors";

const ATTEMPTS_DIR = new URL("../data/attempts/", import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    items: { type: "string", default: "20" },
    all: { type: "boolean", default: false },
    channel: { type: "string", default: "image" },
    provider: { type: "string" },
    model: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "2" },
  },
});

/** Sample N items spread across types/difficulties (group by type, round-robin). */
function sampleItems(bank: BankItem[], n: number): BankItem[] {
  const byType = new Map<PuzzleType, BankItem[]>();
  for (const item of bank) {
    const list = byType.get(item.puzzle.type) ?? [];
    list.push(item);
    byType.set(item.puzzle.type, list);
  }
  // Within each type, spread across difficulty by sorting then interleaving.
  for (const list of byType.values()) {
    list.sort((a, b) => a.puzzle.difficulty - b.puzzle.difficulty);
  }
  const queues = [...byType.values()];
  const picked: BankItem[] = [];
  let i = 0;
  while (picked.length < n && queues.some((q) => q.length > 0)) {
    const q = queues[i % queues.length];
    if (q.length > 0) picked.push(q.shift()!);
    i++;
  }
  return picked;
}

/** Map a chosen index in the shuffled puzzle back to the canonical option index. */
function canonicalIndex(canonical: Puzzle, shuffled: Puzzle, chosenShuffled: number | null): number | null {
  if (chosenShuffled === null) return null;
  const chosenCell = shuffled.options[chosenShuffled];
  if (!chosenCell) return null;
  const sig = visualSignature(chosenCell);
  // Identity by visualSignature; options are guaranteed distinct by the schema,
  // so the first signature match is unambiguous.
  const idx = canonical.options.findIndex((opt) => visualSignature(opt) === sig);
  return idx >= 0 ? idx : null;
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
  const bank = loadBank();
  const items = args.all ? bank : sampleItems(bank, Math.min(Number(args.items), bank.length));

  // Build the full work list: each sampled item × repeat.
  const work: BankItem[] = [];
  for (let r = 0; r < repeat; r++) work.push(...items);

  const startedAt = new Date().toISOString();
  console.log(
    `agent:run — ${items.length} items × ${repeat} = ${work.length} attempts · ${channel} channel · ${provider}/${model} · concurrency ${concurrency}`,
  );

  const attempts: Attempt[] = [];
  let aborted = false;
  let nextIndex = 0;

  const worker = async () => {
    while (!aborted) {
      const idx = nextIndex++;
      if (idx >= work.length) return;
      const item = work[idx];
      const canonical = item.puzzle;
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

/** Console table: pass rate overall, by difficulty tier, and by type. */
function report(attempts: Attempt[], items: BankItem[]) {
  if (attempts.length === 0) {
    console.log("\nno attempts recorded.");
    return;
  }
  const difficultyOf = new Map(items.map((i) => [i.puzzle.id, i.puzzle.difficulty]));
  const typeOf = new Map(items.map((i) => [i.puzzle.id, i.puzzle.type]));

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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
