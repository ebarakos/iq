/**
 * Verify the committed item bank: schema, rule check, fingerprint and id
 * integrity, uniqueness. Run in CI (npm run bank:verify) so a hand-edited or
 * merge-mangled bank fails fast.
 */
import { readFileSync } from "node:fs";
import { BankFileSchema, bankIdFor, fingerprintPuzzle } from "../src/items/bank";
import { checkRule } from "../src/items/rules";

const BANK_PATH = new URL("../data/bank/items.json", import.meta.url).pathname;

const errors: string[] = [];
const parsed = BankFileSchema.safeParse(JSON.parse(readFileSync(BANK_PATH, "utf8")));
if (!parsed.success) {
  errors.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
} else {
  const seen = new Set<string>();
  for (const item of parsed.data.items) {
    const id = item.puzzle.id;
    const check = checkRule(item.puzzle);
    if (!check.ok) errors.push(`${id}: checkRule failed — ${check.issues.join("; ")}`);
    const fp = fingerprintPuzzle(item.puzzle);
    if (fp !== item.fingerprint) errors.push(`${id}: fingerprint mismatch (stored ${item.fingerprint}, computed ${fp})`);
    if (id !== bankIdFor(item.puzzle)) errors.push(`${id}: id should be ${bankIdFor(item.puzzle)}`);
    if (seen.has(item.fingerprint)) errors.push(`${id}: duplicate fingerprint ${item.fingerprint}`);
    seen.add(item.fingerprint);
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
