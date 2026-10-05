/**
 * Top up the item bank (data/bank/items.json) with validated expanded-family
 * puzzles.
 *
 *   npm run bank:topup -- --per-bucket 4 --seed emergency-v11
 *   npm run bank:topup -- --replace --per-bucket 5   # rebuild the whole bank
 *   flags: --per-bucket N (default BANK_ITEMS_PER_KEY)  --seed S  --replace
 *
 * `--per-family` was retired on 2026-08-25. It counted items per family, which
 * stopped describing coverage once a family could hold two buckets in one band
 * and two bands in one test: a family could be "complete" with every item drawn
 * from its shallowest bucket. `--per-bucket` counts against the
 * family/band/bucket keys the registry can actually schedule, which is what the
 * emergency fallback needs in stock.
 *
 * The legacy `procedural`, `model`, and `both` sources were retired on
 * 2026-09-28 along with the procedural generator and the LLM item writer: quiz
 * tokens expire after 2 hours and no procedural or model-written data exists
 * anywhere, so `expanded` (replaying `assembleExpandedQuiz`) is the only
 * source the bank ever needed, and this script no longer makes a model call.
 *
 * Every banked item is re-id'd to its content-addressed id, deduped by
 * fingerprint, and schema-validated before the file is written.
 * (The 12 hand-authored MVP items were migrated in on 2026-06-10; the retired
 * fallback.ts is gone — the bank itself is the resilience path now.)
 */
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BANK_ITEMS_PER_KEY,
  BankFileSchema,
  BankItemSchema,
  bankIdFor,
  enabledExpandedBankKeys,
  expandedBankKeyOf,
  fingerprintPuzzle,
  type BankItem,
} from "../src/items/bank";
import {
  assembleExpandedQuiz,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  type ExpandedProfile,
} from "../src/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  normalizeWithdrawnFamilyIds,
  readWithdrawnFamilyIds,
} from "../src/items/family-promotion";
import type { Puzzle } from "../src/items/schema";

const BANK_PATH = new URL("../data/bank/items.json", import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    seed: { type: "string" },
    replace: { type: "boolean", default: false },
    "per-bucket": { type: "string", default: String(BANK_ITEMS_PER_KEY) },
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
function toBankItem(puzzle: Puzzle, provenance: BankItem["provenance"]): BankItem {
  const canonical = { ...puzzle, id: bankIdFor(puzzle) };
  if (
    canonical.generation?.generatorVersion !== EXPANDED_GENERATOR_VERSION ||
    !canonical.familyId ||
    !canonical.band
  ) {
    throw new Error(`refusing to bank ${canonical.id}: expanded provenance is incomplete`);
  }
  return BankItemSchema.parse({
    puzzle: canonical,
    fingerprint: fingerprintPuzzle(canonical),
    provenance,
    tags: [],
  });
}

async function main() {
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

  const perBucket = Number(args["per-bucket"]);
  if (!Number.isInteger(perBucket) || perBucket <= 0) {
    throw new Error(`--per-bucket must be a positive integer, got "${args["per-bucket"]}"`);
  }
  const seedText = args.seed ?? String(Date.now() % 2 ** 31);

  const withdrawn = readWithdrawnFamilyIds();
  const counts = new Map(enabledExpandedBankKeys(CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn)
    .map((key) => [key, 0]));
  // A top-up fills only what the bank lacks: count what it already holds first,
  // or the default command would add a full bank on top of the existing one.
  // Items banked under another generator version no longer replay, so a bank
  // holding any is rebuilt with --replace rather than topped up around.
  if (!args.replace) {
    const stale = file.items.filter(
      (item) => item.puzzle.generation?.generatorVersion !== EXPANDED_GENERATOR_VERSION);
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} banked items were built under another generator version than ` +
          `${EXPANDED_GENERATOR_VERSION}; rebuild the bank with --replace`,
      );
    }
    for (const item of file.items) {
      const key = expandedBankKeyOf(item.puzzle);
      if (key !== null && counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }
  }
  const complete = () => [...counts.values()].every((value) => value >= perBucket);

  // Both lengths, long first. A long test reaches every key its schedule can
  // draw, which is nearly all of them; a short test asks each band for one or
  // two questions and so only ever draws a family's entry-point bucket.
  // Keeping the short length in the round is what catches the case this loop
  // exists for — a key that the long schedule stops reaching after a pool
  // change — instead of spinning a thousand long tests and then failing.
  const profileOrder: readonly ExpandedProfile[] = [
    "long-30",
    ...EXPANDED_PROFILES.filter((profile) => profile !== "long-30"),
  ];
  for (let quizIndex = 0; quizIndex < 1_000 && !complete(); quizIndex++) {
    for (const profile of profileOrder) {
      if (complete()) break;
      const quizSeed = `${seedText}:${profile}:${quizIndex}`;
      const puzzles = assembleExpandedQuiz(
        quizSeed,
        profile,
        CURRENT_FAMILY_PROMOTION_REGISTRY,
        withdrawn,
      );
      for (const puzzle of puzzles) {
        const key = expandedBankKeyOf(puzzle);
        if (key === null || !counts.has(key) || counts.get(key)! >= perBucket) continue;
        if (add(toBankItem(puzzle, {
          source: "expanded",
          seed: quizSeed,
          profile,
          generatorVersion: EXPANDED_GENERATOR_VERSION,
          withdrawnFamilyIds: normalizeWithdrawnFamilyIds(withdrawn),
          createdAt: now(),
        }))) {
          counts.set(key, counts.get(key)! + 1);
        }
      }
    }
  }

  const missing = [...counts].filter(([, value]) => value < perBucket);
  if (missing.length > 0) {
    throw new Error(
      `expanded bank could not reach ${perBucket} items per family/band/bucket key: ` +
        missing.map(([key, value]) => `${key} ${value}`).join(", "),
    );
  }
  console.log(`expanded coverage: ${counts.size} keys x ${perBucket} items`);

  console.log(`topup (expanded, seed ${args.seed ?? "time-based"}): added ${added.length}, skipped ${skipped.duplicate} duplicates`);

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
