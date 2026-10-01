/**
 * Calibration report — `npm run report`
 *
 * Loads all data/attempts/*.json attempt artifacts, aggregates image-channel
 * solve rates per item, and prints calibration tables. Default is DRY-RUN;
 * pass --write to persist tags and calibration blocks back to data/bank/items.json.
 *
 *   npm run report                              # print only
 *   npm run report -- --write                   # print + write bank
 *   npm run report -- --include-partial             # diagnostic only
 *   npm run report -- --write --version solver-v3 --generator-version scene-families-v11 \
 *                            --evaluation-set public --thinking-budget 1024
 *
 * Populations are never pooled. A population is one (prompt version, generator
 * version, evaluation set, thinking budget) combination, and every number this
 * report prints is computed inside exactly one of them — headline accuracy,
 * difficulty tiers, types, buckets, models, outcomes, and divergence alike.
 * Pooling a public run with a held-out one, or a run that reasoned with one
 * that did not, would make every rate meaningless.
 *
 * Selection flags narrow --write to a single population; they do not filter
 * what is printed:
 *
 *   --version V            solver prompt version, e.g. solver-v3
 *   --generator-version V  e.g. scene-families-v11, or bank-v1 for bank runs
 *   --evaluation-set S     public | held-out
 *   --thinking-budget B    the number a run used, or "off" (asked for none),
 *                          or "unrecorded" (artifact predates the field)
 *
 * --write refuses unless exactly one population matches, and always refuses a
 * held-out population: reserved items are generated per run and are not bank
 * items, so there is nothing in the bank for them to calibrate.
 *
 * Note: a-priori difficulty is the human-difficulty proxy until a DB with human
 * attempt data exists. This report makes no combined human/agent scoring claims.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  ATTEMPT_OUTCOMES,
  AttemptFileSchema,
  EVALUATION_SETS,
  evaluationSetOfFile,
  groupAttemptFilesByPopulation,
  outcomeOf,
  type AttemptFile,
  type AttemptOutcome,
  type AttemptPopulation,
} from "../src/lib/attempts";
import { BankFileSchema, type BankItem } from "../src/items/bank";
import {
  buildReport,
  applyCalibration,
  harnessFailureAttemptFiles,
  reportableAttemptFiles,
  type ItemRollup,
  type CalibrationReport,
} from "../src/lib/calibrate";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ATTEMPTS_DIR = join(ROOT, "data", "attempts");
const BANK_PATH = join(ROOT, "data", "bank", "items.json");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    write: { type: "boolean", default: false },
    version: { type: "string" },
    "generator-version": { type: "string" },
    // Evaluation set and thinking budget are population separators like the two
    // above, so --write needs the same way to name one of them.
    "evaluation-set": { type: "string" },
    "thinking-budget": { type: "string" },
    "include-partial": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const DRY_RUN = !args.write;

// Fail on a mistyped set before anything is printed: silently matching no
// population would look like "the data is missing" rather than "the flag is wrong".
if (
  args["evaluation-set"] !== undefined &&
  !(EVALUATION_SETS as readonly string[]).includes(args["evaluation-set"])
) {
  console.error(
    `report: --evaluation-set must be one of ${EVALUATION_SETS.join(", ")} ` +
      `(got "${args["evaluation-set"]}")`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load attempt files
// ---------------------------------------------------------------------------

function loadAttemptFiles(): AttemptFile[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(ATTEMPTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  if (fileNames.length === 0) return [];

  const files: AttemptFile[] = [];
  for (const name of fileNames) {
    const path = join(ATTEMPTS_DIR, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      console.error(`report: failed to parse ${name}: ${(err as Error).message}`);
      process.exit(1);
    }
    const result = AttemptFileSchema.safeParse(raw);
    if (!result.success) {
      console.error(`report: schema validation failed for ${name}:`);
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    // One artifact holds one population. A file mixing public and held-out
    // attempts cannot be reported at all — nothing downstream could say which
    // of its numbers belonged to which — so name it and stop rather than
    // silently pooling it.
    try {
      evaluationSetOfFile(result.data);
    } catch (err) {
      console.error(`report: ${name}: ${(err as Error).message}`);
      process.exit(1);
    }
    files.push(result.data);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Load bank
// ---------------------------------------------------------------------------

function loadBankFile(): BankItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(BANK_PATH, "utf8"));
  } catch (err) {
    console.error(`report: could not read bank at ${BANK_PATH}: ${(err as Error).message}`);
    process.exit(1);
  }
  const result = BankFileSchema.safeParse(raw);
  if (!result.success) {
    console.error(`report: bank schema validation failed:`);
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data.items;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(width) : str.padEnd(width);
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function printHeader(title: string): void {
  const line = "─".repeat(title.length + 4);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${title}  │`);
  console.log(`└${line}┘`);
}

function printItemTable(rollups: ItemRollup[], bank: BankItem[], label: string): void {
  printHeader(label);
  if (rollups.length === 0) {
    console.log("  (no items)");
    return;
  }

  const bankById = new Map(bank.map((item) => [item.puzzle.id, item]));
  const header = [
    pad("id", 20),
    pad("type", 12),
    pad("diff", 5),
    pad("attempts", 9, true),
    pad("solveRate", 10, true),
    pad("tag", 12),
  ].join("  ");
  const sep = "─".repeat(header.length);

  console.log("  " + header);
  console.log("  " + sep);
  for (const r of rollups) {
    const item = bankById.get(r.itemId);
    const type = item?.puzzle.type ?? "?";
    const diff = item?.puzzle.difficulty ?? "?";
    const row = [
      pad(r.itemId, 20),
      pad(type, 12),
      pad(String(diff), 5),
      pad(r.attempts, 9, true),
      pad(pct(r.solveRate), 10, true),
      pad(r.tag ?? "(untagged)", 12),
    ].join("  ");
    console.log("  " + row);
  }
}

function printTierTable(byTier: CalibrationReport["byTier"]): void {
  printHeader("By difficulty tier  [image channel, a-priori difficulty used as human proxy]");
  if (byTier.length === 0) {
    console.log("  (no data)");
    return;
  }
  const header = [pad("difficulty", 12), pad("attempts", 10, true), pad("solveRate", 10, true)].join("  ");
  const sep = "─".repeat(header.length);
  console.log("  " + header);
  console.log("  " + sep);
  for (const row of byTier) {
    console.log("  " + [pad(row.difficulty, 12), pad(row.attempts, 10, true), pad(pct(row.solveRate), 10, true)].join("  "));
  }
}

function printTypeTable(byType: CalibrationReport["byType"]): void {
  printHeader("By puzzle type  [image channel]");
  if (byType.length === 0) {
    console.log("  (no data)");
    return;
  }
  const header = [pad("type", 14), pad("attempts", 10, true), pad("solveRate", 10, true)].join("  ");
  const sep = "─".repeat(header.length);
  console.log("  " + header);
  console.log("  " + sep);
  for (const row of byType) {
    console.log("  " + [pad(row.type, 14), pad(row.attempts, 10, true), pad(pct(row.solveRate), 10, true)].join("  "));
  }
}

function printByModelTable(rollups: ItemRollup[]): void {
  printHeader("By model  [image channel, all tested models — not silently pooled]");

  // Aggregate across all items
  const modelAcc = new Map<string, { attempts: number; correct: number }>();
  for (const r of rollups) {
    for (const [model, md] of Object.entries(r.byModel)) {
      let acc = modelAcc.get(model);
      if (!acc) { acc = { attempts: 0, correct: 0 }; modelAcc.set(model, acc); }
      acc.attempts += md.attempts;
      acc.correct += Math.round(md.solveRate * md.attempts);
    }
  }

  if (modelAcc.size === 0) {
    console.log("  (no data)");
    return;
  }

  const header = [pad("model", 40), pad("attempts", 10, true), pad("solveRate", 10, true)].join("  ");
  const sep = "─".repeat(header.length);
  console.log("  " + header);
  console.log("  " + sep);
  for (const [model, acc] of [...modelAcc.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log("  " + [
      pad(model, 40),
      pad(acc.attempts, 10, true),
      pad(pct(acc.attempts > 0 ? acc.correct / acc.attempts : 0), 10, true),
    ].join("  "));
  }
}

function printBucketTable(rollups: CalibrationReport["imageBucketRollups"]): void {
  printHeader("By generated feature bucket  [image channel]");
  if (rollups.length === 0) {
    console.log("  (no generated-item attempts with bucket metadata)");
    return;
  }
  for (const row of rollups) {
    console.log(`  ${row.featureBucket}`);
    console.log(`    attempts=${row.attempts}  solveRate=${pct(row.solveRate)}`);
  }
}

/**
 * Index of every population found, one row each, side by side and never averaged.
 *
 * This replaces the old public-versus-held-out table. That table existed
 * because the rest of the report pooled the two sets and something had to show
 * them apart; now the evaluation set is part of the population key, so each set
 * gets its own block below and this table is only a map of what those blocks
 * are. Each row is computed inside one population, so reading down the accuracy
 * column compares populations without averaging any two of them.
 */
function printPopulationIndex(populations: AttemptPopulation[]): void {
  printHeader("Populations  [image channel — each row is one population, never pooled]");
  const header = [
    pad("prompt", 12),
    pad("generator", 20),
    pad("set", 9),
    pad("thinking", 11),
    pad("files", 6, true),
    pad("attempts", 9, true),
    pad("accuracy", 9, true),
  ].join("  ");
  console.log("  " + header);
  console.log("  " + "─".repeat(header.length));
  for (const population of populations) {
    let attempts = 0;
    let correct = 0;
    for (const file of population.files) {
      if (file.channel !== "image") continue;
      for (const attempt of file.attempts) {
        attempts += 1;
        if (attempt.correct) correct += 1;
      }
    }
    console.log("  " + [
      pad(population.promptVersion, 12),
      pad(population.generatorVersion, 20),
      pad(population.evaluationSet, 9),
      pad(population.thinkingBudgetLabel, 11),
      pad(population.files.length, 6, true),
      pad(attempts, 9, true),
      pad(attempts > 0 ? pct(correct / attempts) : "—", 9, true),
    ].join("  "));
  }
  console.log("\n  thinking = the reasoning budget the run asked the relay for.");
  console.log("             \"off\" means the run asked for none; \"unrecorded\" means the artifact");
  console.log("             predates the field, which is not evidence that reasoning was off.");
}

function printOutcomeTable(report: CalibrationReport): void {
  printHeader("Attempt outcomes  [strict accuracy denominator]");
  console.log("  Every non-correct outcome remains an incorrect one-attempt result.");
  for (const channel of ["image", "symbolic"] as const) {
    const counts = report.outcomes[channel];
    const total = ATTEMPT_OUTCOMES.reduce((sum, outcome) => sum + counts[outcome], 0);
    if (total === 0) continue;
    console.log(`\n  ${channel}: ${total}`);
    for (const outcome of ATTEMPT_OUTCOMES) {
      console.log(`    ${pad(outcome, 20)} ${counts[outcome]}`);
    }
  }
}

function printDivergenceSection(divergence: CalibrationReport["divergence"]): void {
  printHeader("Divergence: a-priori difficulty × agent calibration tag");
  console.log("  NOTE: Until a DB exists, a-priori puzzle difficulty is the human-difficulty proxy.");
  console.log("        No combined human/agent score is computed here.\n");

  const tags: (string)[] = ["agent-easy", "agent-mid", "agent-hard", "untagged"];
  const difficulties = Object.keys(divergence.matrix).map(Number).sort((a, b) => a - b);

  if (difficulties.length === 0) {
    console.log("  (no data)");
    return;
  }

  const header = [pad("diff", 6), ...tags.map((t) => pad(t, 12, true))].join("  ");
  const sep = "─".repeat(header.length);
  console.log("  " + header);
  console.log("  " + sep);
  for (const d of difficulties) {
    const row = divergence.matrix[d];
    console.log("  " + [
      pad(d, 6),
      ...tags.map((t) => pad(row[t as keyof typeof row] ?? 0, 12, true)),
    ].join("  "));
  }

  if (divergence.mismatches.length > 0) {
    console.log("\n  Top mismatches (both directions, by severity):");
    for (const m of divergence.mismatches) {
      console.log(`    ${m.itemId}  attempts=${m.attempts}  solveRate=${pct(m.solveRate)}  — ${m.note}`);
    }
  } else {
    console.log("\n  No mismatches detected (all items either untagged or consistent with difficulty).");
  }
}

// ---------------------------------------------------------------------------
// Print a full report for a set of files (one version group)
// ---------------------------------------------------------------------------

/**
 * Every table below is built from one population's files only, so no number
 * here can mix two populations. The banner names the population so a reader
 * always knows which one a block belongs to.
 */
function printReport(population: AttemptPopulation, bank: BankItem[]): void {
  const files = population.files;
  // Without the flag, buildReport re-filters partial runs out, so a
  // --include-partial report silently aggregated only the complete ones.
  const report = buildReport(files, bank, { includePartial: args["include-partial"] });

  console.log(`\n${"═".repeat(78)}`);
  console.log(`  population: ${population.label}`);
  console.log(`  Files: ${files.length}  |  Items with image attempts: ${report.imageRollups.length}`);
  console.log(`${"═".repeat(78)}`);

  if (population.evaluationSet === "held-out") {
    // Said out loud rather than left to be inferred from empty tables.
    console.log("\n  Held-out items are reserved composed programs generated per run, not bank items.");
    console.log("  They answer whether the model transfers beyond the public grammar, they set no");
    console.log("  release threshold, and the bank-joined tables below (tier, type, divergence) are");
    console.log("  empty for them by design.");
  }

  if (report.orphanItemIds.length > 0) {
    console.log(`\n  ⚠  ${report.orphanItemIds.length} orphan itemId(s) found in attempts but not in bank:`);
    for (const id of report.orphanItemIds) console.log(`     ${id}`);
  }

  // Image-channel headline tables
  printItemTable(report.imageRollups, bank, "Per-item results  [image channel — headline]");
  printTierTable(report.byTier);
  printTypeTable(report.byType);
  printBucketTable(report.imageBucketRollups);
  printOutcomeTable(report);
  printByModelTable(report.imageRollups);
  printDivergenceSection(report.divergence);

  // Symbolic-channel secondary
  if (report.symbolicRollups.length > 0) {
    printItemTable(report.symbolicRollups, bank, "Per-item results  [symbolic channel — secondary / diagnostic]");
  } else {
    printHeader("Symbolic channel  [secondary / diagnostic]");
    console.log("  (no symbolic-channel attempts recorded)");
  }

  printOptionsOnlyTable(reportableAttemptFiles(files, args["include-partial"]));
}

/**
 * The options-only arm (docs/plans/blind-answer-leak.md): the model saw the six
 * options and not the question, so chance is 1 in 6 and anything above it is a
 * shortcut the options give away. Its own table, never pooled with the image
 * channel's.
 *
 * The shortcut is read off the attempts where the model picked a letter. A
 * harness failure (timeout, rate limit, transport) or a reply with no letter
 * counts as wrong in the strict denominator everywhere else, but here it would
 * make the shortcut look smaller than it is, so both are shown apart. Rows are
 * one provider and model each: the same model behind two providers is two rows.
 */
function printOptionsOnlyTable(files: AttemptFile[]): void {
  const HARNESS_FAILURES = new Set<AttemptOutcome>(["timeout", "rate-limit", "transport-failure"]);
  const rows = new Map<string, { attempts: number; failed: number; noLetter: number; picked: number; correct: number }>();
  for (const file of files) {
    if (file.channel !== "options-only") continue;
    const key = `${file.provider}/${file.model}`;
    const row = rows.get(key) ?? { attempts: 0, failed: 0, noLetter: 0, picked: 0, correct: 0 };
    for (const attempt of file.attempts) {
      const outcome = outcomeOf(attempt);
      row.attempts += 1;
      if (HARNESS_FAILURES.has(outcome)) row.failed += 1;
      else if (outcome === "unparseable") row.noLetter += 1;
      else {
        row.picked += 1;
        if (outcome === "correct") row.correct += 1;
      }
    }
    rows.set(key, row);
  }
  if (rows.size === 0) return;
  printHeader("Options-only arm  [question hidden — chance is 16.7%]");
  console.log("  " + [
    pad("provider/model", 36), pad("attempts", 8, true), pad("failed", 6, true),
    pad("no letter", 9, true), pad("picked", 6, true), pad("right of picked", 15, true),
  ].join("  "));
  for (const [key, row] of rows) {
    console.log("  " + [
      pad(key, 36), pad(row.attempts, 8, true), pad(row.failed, 6, true), pad(row.noLetter, 9, true),
      pad(row.picked, 6, true), pad(row.picked > 0 ? pct(row.correct / row.picked) : "—", 15, true),
    ].join("  "));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const allAttemptFiles = loadAttemptFiles();

if (allAttemptFiles.length === 0) {
  console.log("report: no attempt artifacts yet — run `npm run agent:run` first");
  process.exit(0);
}

const attemptFiles = reportableAttemptFiles(allAttemptFiles, args["include-partial"]);
const partialCount = allAttemptFiles.filter((file) => file.status === "partial").length;
if (!args["include-partial"] && partialCount > 0) {
  console.log(`\n  Excluded ${partialCount} partial run(s). Pass --include-partial for diagnostics.`);
}
const harnessFailures = harnessFailureAttemptFiles(allAttemptFiles);
if (harnessFailures.length > 0) {
  console.log(`\n  ⚠  ${harnessFailures.length} run(s) never reached the model — excluded from every table below.`);
  console.log("     These recorded attempts but produced no model answer (transport, timeout, or rate limit),");
  console.log("     so they measure the harness, not the items. They cannot support any capability claim.");
  for (const file of harnessFailures) {
    const outcomes = new Set(file.attempts.map((attempt) => attempt.outcome ?? "unknown"));
    console.log(`     ${file.runId} — ${file.attempts.length} attempts, all ${[...outcomes].sort().join("/")}`);
  }
}
if (attemptFiles.length === 0) {
  console.log("report: no complete attempt artifacts to report");
  process.exit(0);
}

const bank = loadBankFile();

// Prompt version, generator version, evaluation set, and thinking budget are
// four separate populations; never pool any of them.
const populations = groupAttemptFilesByPopulation(attemptFiles);

console.log(`\n  Bank items: ${bank.length}  |  Reportable files: ${attemptFiles.length}  |  Populations: ${populations.length}`);
if (populations.length > 1) {
  console.log(`\n  ⚠  ${populations.length} incompatible populations detected` +
    ` (prompt version × generator version × evaluation set × thinking budget).`);
  console.log("     Results below are separated; cross-population aggregation would pollute comparisons.");
}
printPopulationIndex(populations);

for (const population of populations) {
  printReport(population, bank);
}

// ---------------------------------------------------------------------------
// --write
// ---------------------------------------------------------------------------

if (DRY_RUN) {
  console.log(`\n  ──────────────────────────────────────────────────────`);
  console.log(`  Dry-run complete. Pass --write to persist calibration data to data/bank/items.json.`);
} else {
  const candidates = populations.filter((population) =>
    (!args.version || population.promptVersion === args.version) &&
    (!args["generator-version"] || population.generatorVersion === args["generator-version"]) &&
    (!args["evaluation-set"] || population.evaluationSet === args["evaluation-set"]) &&
    (!args["thinking-budget"] || population.thinkingBudgetLabel === args["thinking-budget"]));
  if (candidates.length !== 1) {
    console.error(`\nreport: refusing --write; ${candidates.length} population(s) matched, and exactly one is required.`);
    console.error("        Calibration written from two populations at once is meaningless: a public solve");
    console.error("        rate and a held-out one, or a reasoning run and a reasoning-off one, would be");
    console.error("        averaged into a number that describes neither.");
    console.error("        Narrow it with --version, --generator-version, --evaluation-set, --thinking-budget.");
    console.error("        Populations found:");
    for (const population of populations) console.error(`          ${population.label}`);
    process.exit(1);
  }

  const selectedPopulation = candidates[0];
  if (selectedPopulation.evaluationSet === "held-out") {
    // Refused outright, not merely by requiring a flag. Held-out items are
    // generated per run from the reserved programs and never enter the bank, so
    // applyCalibration would match no item and the run would report "Bank
    // written" after changing nothing. The plan also sets no release threshold
    // on held-out accuracy — it is a transfer diagnostic, not calibration.
    console.error("\nreport: refusing --write for a held-out population.");
    console.error("        Held-out items are reserved composed programs generated per run, not bank items,");
    console.error("        so data/bank/items.json has nothing for them to calibrate. Held-out accuracy is a");
    console.error("        transfer diagnostic with no release threshold. Select a public population instead:");
    console.error("        --evaluation-set public");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const writeFiles = selectedPopulation.files;
  const { imageRollups } = buildReport(writeFiles, bank);
  const updated = applyCalibration(bank, imageRollups, now);

  // Count changes
  const easy = updated.filter((i) => i.tags.includes("agent-easy")).length;
  const mid = updated.filter((i) => i.tags.includes("agent-mid")).length;
  const hard = updated.filter((i) => i.tags.includes("agent-hard")).length;
  const untagged = updated.filter((i) => !i.tags.some((t) => t.startsWith("agent-"))).length;

  // Sort by puzzle.id for stable diffs (matches bank-topup convention)
  const sorted = [...updated].sort((a, b) => a.puzzle.id.localeCompare(b.puzzle.id));

  const fileContent: { version: 1; items: BankItem[] } = { version: 1, items: sorted };
  writeFileSync(BANK_PATH, JSON.stringify(fileContent, null, 2) + "\n", "utf8");

  console.log(`\n  ──────────────────────────────────────────────────────`);
  console.log(`  Bank written: ${BANK_PATH}`);
  console.log(`    from population: ${selectedPopulation.label}`);
  console.log(`    agent-easy: ${easy}  |  agent-mid: ${mid}  |  agent-hard: ${hard}  |  untagged: ${untagged}`);
}
