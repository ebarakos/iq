/**
 * Calibration report — `npm run report`
 *
 * Loads all data/attempts/*.json attempt artifacts, aggregates image-channel
 * solve rates per item, and prints calibration tables. Default is DRY-RUN;
 * pass --write to persist tags and calibration blocks back to data/bank/items.json.
 *
 *   npm run report                              # print only
 *   npm run report -- --write                   # print + write bank
 *   npm run report -- --write --version solver-v2  # required when versions are mixed
 *
 * Note: a-priori difficulty is the human-difficulty proxy until a DB with human
 * attempt data exists. This report makes no combined human/agent scoring claims.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AttemptFileSchema, type AttemptFile } from "../src/lib/attempts";
import { BankFileSchema, type BankItem } from "../src/items/bank";
import {
  buildReport,
  applyCalibration,
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
  },
  allowPositionals: true,
});

const DRY_RUN = !args.write;

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

function printReport(files: AttemptFile[], bank: BankItem[], versionLabel?: string): void {
  const report = buildReport(files, bank);

  if (versionLabel) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  promptVersion: ${versionLabel}`);
    console.log(`  Files: ${files.length}  |  Items with image attempts: ${report.imageRollups.length}`);
    console.log(`${"═".repeat(60)}`);
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
  printByModelTable(report.imageRollups);
  printDivergenceSection(report.divergence);

  // Symbolic-channel secondary
  if (report.symbolicRollups.length > 0) {
    printItemTable(report.symbolicRollups, bank, "Per-item results  [symbolic channel — secondary / diagnostic]");
  } else {
    printHeader("Symbolic channel  [secondary / diagnostic]");
    console.log("  (no symbolic-channel attempts recorded)");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const attemptFiles = loadAttemptFiles();

if (attemptFiles.length === 0) {
  console.log("report: no attempt artifacts yet — run `npm run agent:run` first");
  process.exit(0);
}

const bank = loadBankFile();

// Group by promptVersion; when multiple exist, print per-version sections with a warning.
const byVersion = new Map<string, AttemptFile[]>();
for (const f of attemptFiles) {
  const list = byVersion.get(f.promptVersion) ?? [];
  list.push(f);
  byVersion.set(f.promptVersion, list);
}

const versions = [...byVersion.keys()].sort();

if (versions.length > 1) {
  console.log(`\n  ⚠  Multiple promptVersions detected: ${versions.join(", ")}`);
  console.log(`     Results below are grouped per version — cross-version aggregation would pollute comparisons.`);

  for (const version of versions) {
    printReport(byVersion.get(version)!, bank, version);
  }
} else {
  // Single version — full report without the version header clutter.
  console.log(`\n  promptVersion: ${versions[0]}  |  Files: ${attemptFiles.length}  |  Bank items: ${bank.length}`);
  printReport(attemptFiles, bank);
}

// ---------------------------------------------------------------------------
// --write
// ---------------------------------------------------------------------------

if (DRY_RUN) {
  console.log(`\n  ──────────────────────────────────────────────────────`);
  console.log(`  Dry-run complete. Pass --write to persist calibration data to data/bank/items.json.`);
} else {
  // Tags must come from a SINGLE prompt version — pooling attempts across solver
  // prompt revisions would mix incomparable populations into one solve rate.
  let writeVersion: string;
  if (args.version) {
    if (!byVersion.has(args.version)) {
      console.error(`\nreport: --version ${args.version} not found in attempts (have: ${versions.join(", ")})`);
      process.exit(1);
    }
    writeVersion = args.version;
  } else if (versions.length === 1) {
    writeVersion = versions[0];
  } else {
    console.error(`\nreport: refusing --write with multiple promptVersions (${versions.join(", ")}).`);
    console.error(`        Pass --version <one of them> to choose which population to calibrate from.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const writeFiles = byVersion.get(writeVersion)!;
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
  console.log(`  Bank written: ${BANK_PATH}  (calibrated from promptVersion ${writeVersion})`);
  console.log(`    agent-easy: ${easy}  |  agent-mid: ${mid}  |  agent-hard: ${hard}  |  untagged: ${untagged}`);
}
