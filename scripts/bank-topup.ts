/**
 * Top up the item bank (data/bank/items.json) with validated puzzles.
 *
 *   npm run bank:topup -- --count 48 --seed 42        # legacy procedural items
 *   npm run bank:topup -- --count 10 --source model   # relay-generated (needs .env.local)
 *   npm run bank:topup -- --source expanded --replace --per-family 3 --seed emergency-v5
 *   flags: --count N (procedural/model/both only)  --source procedural|model|both|expanded
 *          --per-family N (expanded only; --count is ignored for that source)
 *          --type <puzzleType>
 *          --difficulty 1..5  --seed S  --replace  --per-family N
 *
 * `--count` is an exact ceiling for every source: `model` keeps calling the relay
 * (5 validated puzzles per call) until N new items are banked, and `both` splits
 * the budget — model first (half, rounded up), procedural fills the rest.
 *
 * Every banked item is re-id'd to its content-addressed id, deduped by
 * fingerprint, schema-validated, and rule-checked before the file is written.
 * (The 12 hand-authored MVP items were migrated in on 2026-06-10; the retired
 * fallback.ts is gone — the bank itself is the resilience path now.)
 */
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BankFileSchema,
  BankItemSchema,
  bankIdFor,
  fingerprintPuzzle,
  type BankItem,
} from "../src/items/bank";
import { generatePuzzle } from "../src/items/generate";
import {
  assembleExpandedQuiz,
  eligibleFamiliesForBand,
  EXPANDED_GENERATOR_VERSION,
} from "../src/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
  normalizeWithdrawnFamilyIds,
  readWithdrawnFamilyIds,
} from "../src/items/family-promotion";
import { checkRule } from "../src/items/rules";
import { PUZZLE_TYPES, type Puzzle, type PuzzleType, type Visual } from "../src/items/schema";
import { mulberry32 } from "../src/lib/rng";

const BANK_PATH = new URL("../data/bank/items.json", import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    count: { type: "string", default: "20" },
    source: { type: "string", default: "procedural" },
    type: { type: "string" },
    difficulty: { type: "string" },
    seed: { type: "string" },
    replace: { type: "boolean", default: false },
    "per-family": { type: "string", default: "3" },
  },
});

function loadFile(): { version: 1; items: BankItem[] } {
  try {
    return BankFileSchema.parse(JSON.parse(readFileSync(BANK_PATH, "utf8")));
  } catch {
    return { version: 1, items: [] };
  }
}

/** Re-id to the content-addressed id, validate, and wrap as a BankItem. */
function toBankItem(puzzle: Puzzle<Visual>, provenance: BankItem["provenance"]): BankItem {
  const canonical = { ...puzzle, id: bankIdFor(puzzle) };
  if (provenance.source === "expanded") {
    if (
      canonical.generation?.generatorVersion !== EXPANDED_GENERATOR_VERSION ||
      !canonical.familyId ||
      !canonical.band
    ) {
      throw new Error(`refusing to bank ${canonical.id}: expanded provenance is incomplete`);
    }
  } else {
    const check = checkRule(canonical as Puzzle);
    if (!check.ok) {
      throw new Error(`refusing to bank ${canonical.id}: ${check.issues.join("; ")}`);
    }
  }
  return BankItemSchema.parse({
    puzzle: canonical,
    fingerprint: fingerprintPuzzle(canonical),
    provenance,
    tags: [],
  });
}

async function main() {
  const source = args.source as "procedural" | "model" | "both" | "expanded";
  if (args.replace && source !== "expanded") {
    throw new Error("--replace is reserved for building the expanded emergency bank");
  }
  const file = args.replace ? { version: 1 as const, items: [] } : loadFile();
  const have = new Set(file.items.map((i) => i.fingerprint));
  const added: BankItem[] = [];
  const skipped = { duplicate: 0 };
  const now = () => new Date().toISOString();

  const add = (item: BankItem) => {
    if (have.has(item.fingerprint)) {
      skipped.duplicate++;
      return false;
    }
    have.add(item.fingerprint);
    added.push(item);
    return true;
  };

  const count = Number(args.count);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`--count must be a positive integer, got "${args.count}"`);
  }
  const types: PuzzleType[] = args.type ? [args.type as PuzzleType] : [...PUZZLE_TYPES];
  const difficulties = args.difficulty ? [Number(args.difficulty)] : [1, 2, 3, 4, 5];
  const seedText = args.seed ?? String(Date.now() % 2 ** 31);
  const seed = Number(seedText);
  if ((source === "procedural" || source === "both") && !Number.isFinite(seed)) {
    throw new Error(`procedural --seed must be numeric, got "${seedText}"`);
  }
  const rng = mulberry32(seed);

  if (source === "expanded") {
    const perFamily = Number(args["per-family"]);
    if (!Number.isInteger(perFamily) || perFamily <= 0) {
      throw new Error(`--per-family must be a positive integer, got "${args["per-family"]}"`);
    }
    const withdrawn = readWithdrawnFamilyIds();
    const familyIds = [...new Set(EXPANDED_PROFILE_BANDS.flatMap((band) =>
      eligibleFamiliesForBand(CURRENT_FAMILY_PROMOTION_REGISTRY, band, withdrawn)
        .map((family) => family.familyId)))].sort();
    const counts = new Map(familyIds.map((familyId) => [familyId, 0]));
    const complete = () => [...counts.values()].every((value) => value >= perFamily);

    for (let quizIndex = 0; quizIndex < 1_000 && !complete(); quizIndex++) {
      const quizSeed = `${seedText}:${quizIndex}`;
      const puzzles = assembleExpandedQuiz(
        quizSeed,
        "long-30",
        CURRENT_FAMILY_PROMOTION_REGISTRY,
        withdrawn,
      );
      for (const puzzle of puzzles) {
        const familyId = puzzle.familyId;
        if (!familyId || !counts.has(familyId) || counts.get(familyId)! >= perFamily) continue;
        if (add(toBankItem(puzzle, {
          source: "expanded",
          seed: quizSeed,
          profile: "long-30",
          generatorVersion: EXPANDED_GENERATOR_VERSION,
          withdrawnFamilyIds: normalizeWithdrawnFamilyIds(withdrawn),
          createdAt: now(),
        }))) {
          counts.set(familyId, counts.get(familyId)! + 1);
        }
      }
    }

    const missing = [...counts].filter(([, value]) => value < perFamily);
    if (missing.length > 0) {
      throw new Error(
        `expanded bank could not reach ${perFamily} items per family: ` +
          missing.map(([familyId, value]) => `${familyId} ${value}`).join(", "),
      );
    }
  }

  // Per-source budgets: `both` gives the model half (rounded up) and lets the
  // procedural pass fill the remainder, so the total never exceeds --count.
  const modelTarget = source === "model" ? count : source === "both" ? Math.ceil(count / 2) : 0;

  if (source !== "expanded" && modelTarget > 0) {
    const { generatePuzzles } = await import("../src/lib/model");
    // Each relay call yields 5 validated puzzles; trim the last batch to the
    // budget. Cap calls so a dedup-saturated bank doesn't loop the relay forever.
    const maxCalls = Math.ceil(modelTarget / 5) + 2;
    for (let calls = 0; added.length < modelTarget && calls < maxCalls; calls++) {
      const { puzzles, providerUsed, modelId } = await generatePuzzles();
      for (const p of puzzles) {
        if (added.length >= modelTarget) break;
        add(toBankItem(p, { source: "model", provider: providerUsed ?? undefined, model: modelId, createdAt: now() }));
      }
    }
  }

  if (source === "procedural" || source === "both") {
    // Round-robin type × difficulty so the bank stays balanced; cap attempts
    // since near-full banks mostly produce duplicates.
    let attempts = 0;
    const maxAttempts = count * 25;
    outer: while (added.length < count && attempts < maxAttempts) {
      for (const difficulty of difficulties) {
        for (const type of types) {
          if (added.length >= count || attempts >= maxAttempts) break outer;
          attempts++;
          const p = generatePuzzle(type, difficulty as 1 | 2 | 3 | 4 | 5, rng);
          add(toBankItem(p, { source: "procedural", seed, createdAt: now() }));
        }
      }
    }
  }

  console.log(`topup (${source}, seed ${args.seed ?? "time-based"}): added ${added.length}, skipped ${skipped.duplicate} duplicates`);

  const items = [...file.items, ...added].sort((a, b) => a.puzzle.id.localeCompare(b.puzzle.id));
  mkdirSync(dirname(BANK_PATH), { recursive: true });
  writeFileSync(BANK_PATH, JSON.stringify(BankFileSchema.parse({ version: 1, items }), null, 2) + "\n");

  const byType = new Map<string, number>();
  const byDifficulty = new Map<number, number>();
  for (const i of items) {
    byType.set(i.puzzle.type, (byType.get(i.puzzle.type) ?? 0) + 1);
    byDifficulty.set(i.puzzle.difficulty, (byDifficulty.get(i.puzzle.difficulty) ?? 0) + 1);
  }
  console.log(`bank now has ${items.length} items`);
  console.log(`  by type:       ${[...byType].map(([t, n]) => `${t} ${n}`).join(", ")}`);
  console.log(`  by difficulty: ${[...byDifficulty].sort(([a], [b]) => a - b).map(([d, n]) => `d${d} ${n}`).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
