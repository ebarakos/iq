/**
 * Verify the committed item bank: schema, expanded-seed replay or legacy rule
 * check, fingerprint and id integrity, uniqueness, four items for every
 * family/band/bucket key the registry can schedule, and fallback coverage for
 * both public lengths.
 */
import { readFileSync } from "node:fs";
import {
  BANK_ITEMS_PER_KEY,
  BankFileSchema,
  bankIdFor,
  expandedBankCoverage,
  fingerprintPuzzle,
  sampleExpandedBankQuiz,
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
import { checkRule } from "../src/items/rules";

const BANK_PATH = new URL("../data/bank/items.json", import.meta.url).pathname;

const errors: string[] = [];
const parsed = BankFileSchema.safeParse(JSON.parse(readFileSync(BANK_PATH, "utf8")));
if (!parsed.success) {
  errors.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
} else {
  const seen = new Set<string>();
  const withdrawn = readWithdrawnFamilyIds();
  const replayCache = new Map<string, ReturnType<typeof assembleExpandedQuiz>>();
  for (const item of parsed.data.items) {
    const id = item.puzzle.id;
    if (item.provenance.source === "expanded") {
      const { seed, profile, generatorVersion, withdrawnFamilyIds } = item.provenance;
      if (
        typeof seed !== "string" ||
        (profile !== "short-5" && profile !== "long-30") ||
        generatorVersion !== EXPANDED_GENERATOR_VERSION ||
        withdrawnFamilyIds === undefined
      ) {
        errors.push(
          `${id}: expanded provenance must name the current generator, profile, string seed, and withdrawal list`,
        );
      } else {
        // Replay against the withdrawal list the item was BUILT with, never the
        // runtime one: withdrawing a family is a legitimate operator action and
        // must not invalidate every previously banked item.
        const storedWithdrawn = normalizeWithdrawnFamilyIds(withdrawnFamilyIds);
        const replayKey = `${profile}:${seed}:${storedWithdrawn.join(",")}`;
        let replay = replayCache.get(replayKey);
        if (!replay) {
          replay = assembleExpandedQuiz(
            seed,
            profile as ExpandedProfile,
            CURRENT_FAMILY_PROMOTION_REGISTRY,
            new Set(storedWithdrawn),
          );
          replayCache.set(replayKey, replay);
        }
        const replayed = replay.find((puzzle) => fingerprintPuzzle(puzzle) === item.fingerprint);
        if (!replayed) {
          errors.push(`${id}: expanded seed replay does not contain this puzzle`);
        } else {
          const canonicalReplay = { ...replayed, id: bankIdFor(replayed) };
          if (JSON.stringify(canonicalReplay) !== JSON.stringify(item.puzzle)) {
            errors.push(`${id}: expanded seed replay differs from the stored puzzle`);
          }
        }
      }
    } else {
      const check = checkRule(item.puzzle);
      if (!check.ok) errors.push(`${id}: checkRule failed — ${check.issues.join("; ")}`);
    }
    const fp = fingerprintPuzzle(item.puzzle);
    if (fp !== item.fingerprint) errors.push(`${id}: fingerprint mismatch (stored ${item.fingerprint}, computed ${fp})`);
    if (id !== bankIdFor(item.puzzle)) errors.push(`${id}: id should be ${bankIdFor(item.puzzle)}`);
    if (seen.has(item.fingerprint)) errors.push(`${id}: duplicate fingerprint ${item.fingerprint}`);
    seen.add(item.fingerprint);
  }
  // Per-key coverage. The fallback sampler answers a slot from the exact
  // family/band/bucket the schedule asked for; every rung below that exists
  // only for a bank that has fallen behind the registry. Checking the built
  // file for four items per enabled key — and for items that no longer belong
  // to any enabled key — is what keeps those rungs unreachable in practice.
  const coverage = expandedBankCoverage(
    parsed.data.items,
    CURRENT_FAMILY_PROMOTION_REGISTRY,
    withdrawn,
  );
  for (const { key, have } of coverage.short) {
    errors.push(`${key}: bank holds ${have} current-version items, needs ${BANK_ITEMS_PER_KEY}`);
  }
  for (const stray of coverage.strays) {
    errors.push(`${stray}: expanded item outside every enabled family/band/bucket key`);
  }
  const overStocked = [...coverage.countsByKey]
    .filter(([, have]) => have > BANK_ITEMS_PER_KEY)
    .map(([key, have]) => `${key} ${have}`);
  if (overStocked.length > 0) {
    errors.push(
      `coverage should be exactly ${BANK_ITEMS_PER_KEY} items per key; over-stocked: ${overStocked.join(", ")}. ` +
        "Rebuild with --replace rather than topping an existing expanded bank up.",
    );
  }
  console.log(
    `bank: ${coverage.countsByKey.size} enabled keys x ${BANK_ITEMS_PER_KEY} items ` +
      `= ${coverage.countsByKey.size * BANK_ITEMS_PER_KEY} expected`,
  );

  for (const profile of EXPANDED_PROFILES) {
    for (let run = 0; run < 100; run++) {
      try {
        sampleExpandedBankQuiz(
          parsed.data.items,
          profile,
          `bank-verify:${profile}:${run}`,
          CURRENT_FAMILY_PROMOTION_REGISTRY,
          withdrawn,
        );
      } catch (error) {
        errors.push(
          `${profile} fallback coverage failed for seed ${run}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
        break;
      }
    }
  }
  console.log(`bank: ${parsed.data.items.length} items checked`);
}

if (errors.length > 0) {
  console.error(`bank verification FAILED (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log("bank verification passed");
}
