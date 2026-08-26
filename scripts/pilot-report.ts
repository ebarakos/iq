/**
 * Human pilot report — `npm run pilot:report -- <aggregate.json>`
 *
 *   npm run pilot:report -- data/pilot/2026-08-25-pilot-v3-a.json
 *
 * Reads one aggregate-v2 export from the pilot screen, checks it against the
 * saved answer-free packet manifest, and applies the two evidence gates in
 * docs/plans/escalate-the-quiz.md:
 *
 *   - the documented per-item withdrawal review, which FLAGS items for the
 *     owner's decision and never withdraws anything by itself; and
 *   - the escalation success test, which passes on either at least two clean
 *     misses among d4/d5 items or a tight median d5 time headroom.
 *
 * Any identity mismatch — wrong packet, wrong fingerprint, wrong schema, a
 * different item set — is a hard error naming exactly what disagreed, and the
 * command exits 1 without printing a result. A valid aggregate always exits 0,
 * including when the escalation gate fails: a recorded failure is a result, not
 * a crash.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
  PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
  PROTOTYPE_PILOT_TIME_BIN_SECONDS,
  PrototypePilotAggregateSchema,
  PrototypePilotManifestSchema,
  analysePrototypePilotAggregate,
  type PrototypePilotManifest,
  type PrototypePilotReport,
} from "../src/items/prototype-pilot";

const ROOT = new URL("../", import.meta.url).pathname;
export const PILOT_MANIFEST_PATH = join(ROOT, "data", "pilot", "pilot-v3-manifest.json");

function readJson(path: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read the ${label} at ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`the ${label} at ${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

/** Turn a zod failure into one line per problem, naming the field that failed. */
function describeSchemaFailure(label: string, issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return [
    `${label} does not match its schema:`,
    ...issues.map((issue) => `  ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`),
  ].join("\n");
}

export function loadPilotManifest(path = PILOT_MANIFEST_PATH): PrototypePilotManifest {
  const parsed = PrototypePilotManifestSchema.safeParse(readJson(path, "saved packet manifest"));
  if (!parsed.success) throw new Error(describeSchemaFailure(`the saved packet manifest at ${path}`, parsed.error.issues));
  return parsed.data;
}

/**
 * Parse an aggregate, saying plainly which schema it actually is.
 *
 * A v1 aggregate parses as neither, and the generic "invalid literal" a raw
 * zod failure produces sends the reader hunting. The two version fields are
 * checked by name first so the message is the one fact that matters.
 */
export function parsePilotAggregate(value: unknown, label: string) {
  const envelope = value as { schemaVersion?: unknown; packetSchemaVersion?: unknown } | null;
  const schemaVersion = envelope && typeof envelope === "object" ? envelope.schemaVersion : undefined;
  if (schemaVersion !== PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION) {
    throw new Error(
      `${label} declares aggregate schema ${JSON.stringify(schemaVersion ?? null)}; ` +
        `this report reads ${PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION} only`,
    );
  }
  const packetSchemaVersion = (envelope as { packetSchemaVersion?: unknown }).packetSchemaVersion;
  if (packetSchemaVersion !== PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION) {
    throw new Error(
      `${label} was collected against packet schema ${JSON.stringify(packetSchemaVersion ?? null)}; ` +
        `this report reads ${PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION} only`,
    );
  }
  const parsed = PrototypePilotAggregateSchema.safeParse(value);
  if (!parsed.success) throw new Error(describeSchemaFailure(label, parsed.error.issues));
  return parsed.data;
}

/** Read, validate, and score one aggregate file against the saved manifest. */
export function runPilotReport(aggregatePath: string, manifestPath = PILOT_MANIFEST_PATH): {
  report: PrototypePilotReport;
  manifestPath: string;
} {
  const manifest = loadPilotManifest(manifestPath);
  const aggregate = parsePilotAggregate(readJson(aggregatePath, "aggregate"), `the aggregate at ${aggregatePath}`);
  return { report: analysePrototypePilotAggregate(manifest, aggregate), manifestPath };
}

const verdict = (pass: boolean) => (pass ? "PASS" : "FAIL");

export function formatPilotReport(
  report: PrototypePilotReport,
  aggregatePath: string,
  manifestPath: string,
): string {
  const attempts = report.items.reduce((sum, item) => sum + item.attempts, 0);
  const correct = report.items.reduce((sum, item) => sum + item.correctAttempts, 0);
  const lines: string[] = [
    `pilot:report — ${aggregatePath}`,
    "",
    `aggregate  ${PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION} · ${PROTOTYPE_PILOT_TIME_BIN_SECONDS}-second bins`,
    `packet     ${report.packetId} · ${PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION} · fingerprint ${report.packetContentFingerprint}`,
    `manifest   ${manifestPath} — packet identity, item set, and fingerprint all match`,
    `items      ${report.items.length} checked · ${attempts} attempts · ${correct} correct`,
    "",
    "Withdrawal review — the documented per-item gate (flags for the owner; withdraws nothing)",
  ];

  if (report.withdrawalReview.flagged.length === 0) {
    lines.push(`  CLEAR  all ${report.items.length} items raised nothing`);
  } else {
    for (const item of report.withdrawalReview.flagged) {
      lines.push(`  FLAG   ${item.itemId}`);
      for (const reason of item.withdrawalReasons) lines.push(`           ${reason}`);
    }
    lines.push(`  CLEAR  ${report.withdrawalReview.clearedItems} other items raised nothing`);
  }

  const clean = report.cleanMissGate;
  lines.push(
    "",
    `Escalation branch 1 — at least ${clean.minimum} clean misses among d4/d5 items`,
    `  ${verdict(clean.pass)}   ${clean.cleanMisses} clean ${clean.cleanMisses === 1 ? "miss" : "misses"} across ${clean.deepItems} d4/d5 items`,
  );
  for (const contributor of clean.contributors) {
    lines.push(`           ${contributor.itemId}  ${contributor.cleanMisses}`);
  }

  const time = report.timeHeadroomGate;
  lines.push(
    "",
    `Escalation branch 2 — every d5 item inside its band budget, median headroom at most ${time.maximumMedianHeadroomSeconds}s`,
    `  ${verdict(time.pass)}   ${time.deepestItems - time.overBudget.length} of ${time.deepestItems} d5 items stayed inside their band budget`,
  );
  for (const item of time.overBudget) {
    lines.push(`           ${item.itemId}  median ${item.medianSolveTimeSeconds}s against a ${item.bandTimeBudgetSeconds}s budget`);
  }
  lines.push(
    time.medianHeadroomSeconds === null
      ? "           no d5 solve times recorded, so no median headroom"
      : `           median headroom ${time.medianHeadroomSeconds}s (nearest rank over ${time.deepestItems} d5 items) — ` +
        `${time.medianHeadroomSeconds <= time.maximumMedianHeadroomSeconds ? "within" : "over"} ` +
        `the ${time.maximumMedianHeadroomSeconds}s limit`,
  );

  lines.push(
    "",
    report.escalation.pass
      ? `RESULT  PASS — the combined batch shows a higher human ceiling (branch ${report.escalation.branch === "clean-misses" ? "1, clean misses" : "2, time headroom"})`
      : "RESULT  FAIL — neither branch passed. Record the failure; the next change is more program depth, not looser correctness or legibility.",
  );
  return lines.join("\n");
}

function main() {
  const [aggregatePath] = process.argv.slice(2);
  if (!aggregatePath) {
    throw new Error("usage: npm run pilot:report -- <aggregate.json>");
  }
  const { report, manifestPath } = runPilotReport(aggregatePath);
  console.log(formatPilotReport(report, aggregatePath, manifestPath));
}

// Only run when this file IS the command being executed, so the tests can
// import the parser without the CLI reading the test runner's argv.
const executedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
