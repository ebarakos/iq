/**
 * Attempt artifacts: the public/held-out label and the held-out source that
 * writes it.
 *
 * No relay call happens here. Importing scripts/agent-run.ts only pulls in its
 * item selection — the script starts a run only when it is the command being
 * executed — so the source that costs money is checked without spending any.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import {
  AttemptFileSchema,
  AttemptSchema,
  EVALUATION_SETS,
  evaluationSetOf,
  evaluationSetOfFile,
  groupAttemptFilesByPopulation,
  thinkingBudgetLabelOf,
  type AttemptFile,
} from "./attempts";
import { partitionComposedTransformPrograms, sceneFamilyBucketsFor } from "@/items/scene-families";
import { EXPANDED_GENERATOR_VERSION } from "@/items/expanded-quiz";
import { VisualPuzzleSchema } from "@/items/schema";
import {
  formatMissingHeldOutCoverage,
  heldOutBucketPool,
  heldOutBuckets,
  heldOutCoverage,
  heldOutCoverageComplete,
  heldOutItemId,
  heldOutSourcePool,
  reservedHeldOutPrimitives,
} from "../../scripts/agent-run";

const ATTEMPTS_DIR = new URL("../../data/attempts/", import.meta.url).pathname;

/** A recorded attempt, minus the field under test. */
const BASE_ATTEMPT = {
  itemId: "item-1",
  chosen: 0,
  correct: true,
  outcome: "correct",
  latencyMs: 1200,
  ts: "2026-08-24T10:00:00.000Z",
} as const;

describe("evaluation set label", () => {
  it("offers exactly the two populations the harness can produce", () => {
    expect([...EVALUATION_SETS]).toEqual(["public", "held-out"]);
  });

  it("round-trips a held-out attempt through the schema and JSON", () => {
    const parsed = AttemptSchema.parse({ ...BASE_ATTEMPT, evaluationSet: "held-out" });
    expect(parsed.evaluationSet).toBe("held-out");
    expect(evaluationSetOf(parsed)).toBe("held-out");

    // The artifact is written as JSON and read back by report.ts, so the label
    // has to survive that trip, not just one parse.
    const file = AttemptFileSchema.parse({
      runId: "run-1",
      startedAt: BASE_ATTEMPT.ts,
      provider: "openrouter",
      model: "model-a",
      channel: "image",
      promptVersion: "solver-v3",
      attempts: [
        { ...BASE_ATTEMPT, evaluationSet: "public" },
        { ...BASE_ATTEMPT, itemId: "item-2", evaluationSet: "held-out" },
      ],
    });
    const reloaded = AttemptFileSchema.parse(JSON.parse(JSON.stringify(file)));
    expect(reloaded.attempts.map(evaluationSetOf)).toEqual(["public", "held-out"]);
  });

  it("reads an attempt recorded before the label as public", () => {
    // Every run that predates the held-out arm probed publicly servable items
    // only, so an absent label means public — it must never block the parse.
    const parsed = AttemptSchema.parse(BASE_ATTEMPT);
    expect(parsed.evaluationSet).toBeUndefined();
    expect(evaluationSetOf(parsed)).toBe("public");
  });

  it("rejects a label that is neither population", () => {
    expect(AttemptSchema.safeParse({ ...BASE_ATTEMPT, evaluationSet: "holdout" }).success).toBe(false);
  });

  it("still accepts every committed attempt artifact", () => {
    // These files ARE the calibration corpus. A schema change that stopped them
    // parsing would silently empty every report.
    const names = readdirSync(ATTEMPTS_DIR).filter((name) => name.endsWith(".json"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const raw: unknown = JSON.parse(readFileSync(`${ATTEMPTS_DIR}${name}`, "utf8"));
      const result = AttemptFileSchema.safeParse(raw);
      expect(result.success, `${name}: ${result.error?.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
      if (result.success) {
        // One artifact holds one population. Public and held-out results answer
        // different questions and are never pooled, so a file mixing them would
        // make every number computed from it meaningless.
        const sets = new Set(result.data.attempts.map(evaluationSetOf));
        expect(sets.size, `${name}: mixes ${[...sets].join(" and ")} attempts in one artifact`).toBe(1);
      }
    }
  });
});

/** Same recipe as the leakage test in scene-families.test.ts. */
const fingerprintOf = (program: unknown): string =>
  createHash("sha256").update(`composed-transform-v2:${JSON.stringify(program)}`).digest("hex").slice(0, 16);

describe("held-out source of the agent harness", () => {
  const buckets = heldOutBuckets();

  it("covers every composed bucket that reserves programs, reading gates and band from the declarations", () => {
    // Nothing about the count is written down here: the source follows the
    // family's own bucket declaration and the promotion registry.
    //
    // It covers the buckets that HAVE a held-out twin, which is a subset of the
    // declared ones: the reserved shape is two board moves followed by
    // token-local steps, and at five gates that shape has no servable member at
    // all (it forces both fills plus a turn, and a turn never repaints the slot
    // the first fill painted, so single-gate ablation rejects every one). A
    // bucket reserving nothing is skipped rather than fatal, which is what keeps
    // the pinned two-bucket probe and its even --items 40 split valid.
    const declared = sceneFamilyBucketsFor("composed-transform-v2").map((bucket) => bucket.bucket);
    const covered = buckets.map((entry) => entry.bucket.bucket);
    expect(covered).toEqual(declared.filter((bucket) => covered.includes(bucket)));
    expect(covered.length).toBeGreaterThan(1);
    for (const entry of buckets) {
      const { heldOutPrograms } = partitionComposedTransformPrograms(entry.gateCount);
      expect(heldOutPrograms.length, entry.bucket.bucket).toBeGreaterThan(0);
    }
    for (const entry of buckets) {
      // The declared program depth IS the number of displayed gates.
      expect(entry.gateCount).toBe(entry.bucket.programDepth);
      expect([3, 4]).toContain(entry.gateCount);
      // A feature bucket of its own, so a rollup can never merge a reserved
      // program with its public twin.
      expect(entry.featureBucket).toBe(`held-out-${entry.bucket.bucket}`);
      expect(entry.featureBucket).not.toBe(entry.bucket.bucket);
    }
  });

  it("splits the requested count evenly and refuses a count that cannot split", () => {
    const items = heldOutSourcePool("held-out-source-seed", buckets.length * 4);
    expect(items).toHaveLength(buckets.length * 4);
    for (const entry of buckets) {
      expect(items.filter((item) => item.generation?.featureBucket === entry.featureBucket)).toHaveLength(4);
    }
    // Unequal buckets cannot be compared with each other, so an uneven request
    // is refused rather than quietly rounded.
    expect(() => heldOutSourcePool("held-out-source-seed", buckets.length * 4 + 1)).toThrow(/divides evenly/);
    expect(() => heldOutSourcePool("held-out-source-seed", 0)).toThrow(/divides evenly/);
  });

  it("serves only reserved combinations the public pool can never produce", () => {
    for (const entry of buckets) {
      const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(entry.gateCount);
      const publicFingerprints = new Set(publicPrograms.map(fingerprintOf));
      const heldOutFingerprints = new Set(heldOutPrograms.map(fingerprintOf));
      for (const item of heldOutBucketPool("held-out-source-seed", entry, 5)) {
        const fingerprint = item.generation?.programFingerprint;
        expect(fingerprint, entry.bucket.bucket).toBeDefined();
        expect(heldOutFingerprints.has(fingerprint!), entry.bucket.bucket).toBe(true);
        expect(publicFingerprints.has(fingerprint!), entry.bucket.bucket).toBe(false);
      }
    }
  });

  it("passes the same puzzle contract as a public item, in its own bucket and band", () => {
    for (const entry of buckets) {
      for (const item of heldOutBucketPool("held-out-source-contract", entry, 4)) {
        expect(VisualPuzzleSchema.safeParse(item).success).toBe(true);
        expect(item.familyId).toBe("composed-transform-v2");
        expect(item.generation?.featureBucket).toBe(entry.featureBucket);
        expect(item.band).toBe(entry.band);
        // Difficulty and depth come from the bucket declaration, the same
        // source the public twin reads, so the two stay in one stratum.
        expect(item.generation?.features.difficulty).toBe(entry.bucket.difficulty);
        expect(item.generation?.features.programDepth).toBe(entry.bucket.programDepth);
        expect(item.generation?.generatorVersion).toBe(EXPANDED_GENERATOR_VERSION);
      }
    }
  });

  it("gives every held-out item its own id, including across buckets", () => {
    // The family prototype stamps one literal id on every candidate; reusing it
    // would collapse the whole source into a single row in every report.
    const items = heldOutSourcePool("held-out-source-seed", buckets.length * 3);
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id === "prototype-composed-transform")).toBe(false);
    for (const entry of buckets) {
      expect(heldOutItemId("held-out-source-seed", entry.bucket.bucket, 0)).toBe(ids.find(
        (id) => id.endsWith(`-1-${entry.bucket.bucket}`),
      ));
    }
  });

  it("replays item for item from the same seed and differs across seeds", () => {
    const first = heldOutSourcePool("replay-seed", buckets.length * 2);
    expect(heldOutSourcePool("replay-seed", buckets.length * 2)).toEqual(first);
    const other = heldOutSourcePool("another-seed", buckets.length * 2);
    expect(other.map((item) => item.stem)).not.toEqual(first.map((item) => item.stem));
  });

  it("enforces its own reserved-primitive and program-complexity coverage", () => {
    // Six items a bucket, not four. Until 2026-08-27 the two held-out buckets
    // ran at three and four gates, so four items gave 12 and 16 gate slots
    // against a reserved pool of 8 primitives. `composed-transform-d5` is now
    // three gates run backwards rather than four run forwards, so both buckets
    // are three gates and four items is 12 slots either side — enough on
    // average, not enough to guarantee. That is a property of the sample, not a
    // fault in the harness: the very next test checks a thin run is REPORTED
    // rather than passed.
    const PER_BUCKET = 6;
    const items = heldOutSourcePool("held-out-source-seed", buckets.length * PER_BUCKET);
    const coverage = heldOutCoverage(items);
    expect(heldOutCoverageComplete(coverage)).toBe(true);
    expect(coverage.itemsPerBucket)
      .toEqual(buckets.map((entry) => ({ bucket: entry.bucket.bucket, items: PER_BUCKET })));
    // Every reserved primitive really is required, not just listed.
    for (const entry of buckets) {
      expect(reservedHeldOutPrimitives(entry.gateCount).length).toBeGreaterThan(0);
    }
  });

  it("reports what a thin run is missing instead of passing it", () => {
    const items = heldOutSourcePool("held-out-source-seed", buckets.length * 4);
    // Keep one item from the first bucket only: the other bucket disappears
    // entirely and the vocabulary is nowhere near covered.
    const thin = items.slice(0, 1);
    const coverage = heldOutCoverage(thin);
    expect(heldOutCoverageComplete(coverage)).toBe(false);
    const message = formatMissingHeldOutCoverage(coverage);
    expect(message).toContain("missing required coverage");
    expect(message).toContain(buckets[0].bucket.bucket);
    expect(message).toContain("program-complexity classes absent");
    expect(message).toContain(`complexity-${buckets[1].bucket.difficulty}-depth-${buckets[1].bucket.programDepth}`);
  });

  it("builds the plan's pinned 40-item probe with complete coverage", () => {
    // The exact selection behind the two commands in escalate-the-quiz.ts
    // §Agent signal: `--source held-out --items 40 --seed probe-escalation-held-out`.
    // Checked here so the pinned run is known to be buildable before anybody
    // spends a model call on it.
    const items = heldOutSourcePool("probe-escalation-held-out", 40);
    expect(items).toHaveLength(40);
    const coverage = heldOutCoverage(items);
    expect(coverage.itemsPerBucket.map((row) => row.items)).toEqual(buckets.map(() => 20));
    expect(heldOutCoverageComplete(coverage)).toBe(true);
  });

  it("records the source and the population so a report can never pool them", () => {
    const artifact = AttemptFileSchema.parse({
      runId: "held-out-run",
      startedAt: BASE_ATTEMPT.ts,
      provider: "openrouter",
      model: "model-a",
      channel: "image",
      promptVersion: "solver-v3",
      source: "held-out",
      profile: null,
      runSeed: "probe-escalation-held-out",
      generatorVersion: EXPANDED_GENERATOR_VERSION,
      attempts: [{ ...BASE_ATTEMPT, evaluationSet: "held-out" }],
    });
    const reloaded = AttemptFileSchema.parse(JSON.parse(JSON.stringify(artifact)));
    expect(reloaded.source).toBe("held-out");
    // A held-out run never carries a profile: it is not a test anybody sits.
    expect(reloaded.profile).toBeNull();
    expect(reloaded.attempts.map(evaluationSetOf)).toEqual(["held-out"]);
  });
});

// ---------------------------------------------------------------------------
// Populations
// ---------------------------------------------------------------------------

/** A complete one-attempt run, minus the fields a given test varies. */
const BASE_FILE = {
  runId: "run-base",
  startedAt: BASE_ATTEMPT.ts,
  provider: "openrouter",
  model: "model-a",
  channel: "image",
  promptVersion: "solver-v3",
  generatorVersion: "scene-families-v11",
  attempts: [BASE_ATTEMPT],
} as const;

const fileWith = (overrides: Record<string, unknown>): AttemptFile =>
  AttemptFileSchema.parse({ ...BASE_FILE, ...overrides });

describe("populations a report may not pool", () => {
  it("splits a public run from a held-out one with the same prompt and generator", () => {
    // The exact shape of the four v11 artifacts: same prompt, same generator,
    // different populations. Keyed on prompt and generator alone they collapse
    // into one group, and every number computed from that group — headline
    // accuracy, buckets, models — describes neither population.
    const publicRun = fileWith({
      runId: "public-run",
      source: "generated",
      attempts: [{ ...BASE_ATTEMPT, evaluationSet: "public" }],
    });
    const heldOutRun = fileWith({
      runId: "held-out-run",
      source: "held-out",
      profile: null,
      attempts: [{ ...BASE_ATTEMPT, evaluationSet: "held-out" }],
    });

    const populations = groupAttemptFilesByPopulation([publicRun, heldOutRun]);
    expect(populations).toHaveLength(2);
    expect(populations.map((population) => population.evaluationSet).sort())
      .toEqual(["held-out", "public"]);
    // No population may hold files from both sets, whichever order they arrive in.
    for (const population of populations) {
      expect(population.files).toHaveLength(1);
      expect(new Set(population.files.map(evaluationSetOfFile)).size).toBe(1);
    }
    expect(groupAttemptFilesByPopulation([heldOutRun, publicRun])).toHaveLength(2);
  });

  it("names the evaluation set and the thinking budget in the label", () => {
    const [population] = groupAttemptFilesByPopulation([fileWith({
      thinkingBudget: 1024,
      attempts: [{ ...BASE_ATTEMPT, evaluationSet: "public" }],
    })]);
    expect(population.label).toBe(
      "prompt solver-v3 · generator scene-families-v11 · set public · thinking-budget 1024",
    );
  });

  it("keeps two runs apart when only the thinking budget differs", () => {
    // The plan's protocol deviation: the strong model now requires a budget, and
    // "every future probe must carry the same --thinking-budget 1024 or the
    // comparison is void". Pooling 1024 with reasoning-off would void it silently.
    const reasoned = fileWith({ runId: "reasoned", thinkingBudget: 1024 });
    const reasoningOff = fileWith({ runId: "reasoning-off", thinkingBudget: null });
    const unrecorded = fileWith({ runId: "unrecorded" });

    const populations = groupAttemptFilesByPopulation([reasoned, reasoningOff, unrecorded]);
    expect(populations).toHaveLength(3);
    expect(populations.map((population) => population.thinkingBudgetLabel).sort())
      .toEqual(["1024", "off", "unrecorded"]);
  });

  it("does not read an unrecorded budget as reasoning-off", () => {
    // Absent means the artifact predates the field. Calling that "off" would
    // pool the whole legacy corpus with runs known to have reasoned.
    expect(thinkingBudgetLabelOf(fileWith({ thinkingBudget: null }))).toBe("off");
    expect(thinkingBudgetLabelOf(fileWith({}))).toBe("unrecorded");
    expect(thinkingBudgetLabelOf(fileWith({ thinkingBudget: 1024 }))).toBe("1024");
  });

  it("pools two runs that agree on all four population fields", () => {
    const first = fileWith({ runId: "first", thinkingBudget: 1024 });
    const second = fileWith({ runId: "second", thinkingBudget: 1024, model: "model-b" });
    // Two models in one population is fine: every rollup carries its own
    // per-model breakdown, so models are never silently averaged.
    const populations = groupAttemptFilesByPopulation([first, second]);
    expect(populations).toHaveLength(1);
    expect(populations[0].files).toHaveLength(2);
  });

  it("refuses to give one population to an artifact that mixes sets", () => {
    const mixed = fileWith({
      runId: "mixed-run",
      attempts: [
        { ...BASE_ATTEMPT, evaluationSet: "public" },
        { ...BASE_ATTEMPT, itemId: "item-2", evaluationSet: "held-out" },
      ],
    });
    expect(() => evaluationSetOfFile(mixed)).toThrow(/mixes held-out and public/);
    expect(() => groupAttemptFilesByPopulation([mixed])).toThrow(/mixed-run/);
  });

  it("puts every committed artifact in a single-set population", () => {
    // The invariant over the real corpus, not a fixture: no population the
    // report prints may contain files from two evaluation sets.
    const files = readdirSync(ATTEMPTS_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => AttemptFileSchema.parse(JSON.parse(readFileSync(`${ATTEMPTS_DIR}${name}`, "utf8"))));
    for (const population of groupAttemptFilesByPopulation(files)) {
      expect(new Set(population.files.map(evaluationSetOfFile)).size, population.label).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Run protocol recorded in the artifact
// ---------------------------------------------------------------------------

describe("run protocol metadata", () => {
  it("round-trips the thinking budget, repeat, and concurrency through JSON", () => {
    // Without these the pinned commands cannot be checked after the fact: the
    // plan voids a gemini-3.5-flash comparison whose budget differs, and an
    // artifact that does not record the budget cannot show that it matched.
    const artifact = fileWith({ thinkingBudget: 1024, repeat: 1, concurrency: 2 });
    const reloaded = AttemptFileSchema.parse(JSON.parse(JSON.stringify(artifact)));
    expect(reloaded.thinkingBudget).toBe(1024);
    expect(reloaded.repeat).toBe(1);
    expect(reloaded.concurrency).toBe(2);
  });

  it("keeps an explicit reasoning-off run distinct from an unrecorded one", () => {
    const off = AttemptFileSchema.parse(JSON.parse(JSON.stringify(fileWith({ thinkingBudget: null }))));
    expect(off.thinkingBudget).toBeNull();
    const legacy = AttemptFileSchema.parse(JSON.parse(JSON.stringify(fileWith({}))));
    expect(legacy.thinkingBudget).toBeUndefined();
  });

  it("still parses an artifact that carries no protocol fields at all", () => {
    // The ten-plus committed artifacts predate every field above. The corpus
    // test covers them wholesale; this states the rule on its own.
    const parsed = AttemptFileSchema.safeParse(BASE_FILE);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.thinkingBudget).toBeUndefined();
      expect(parsed.data.repeat).toBeUndefined();
      expect(parsed.data.concurrency).toBeUndefined();
    }
  });

  it("rejects a budget that is not a positive whole number", () => {
    expect(AttemptFileSchema.safeParse({ ...BASE_FILE, thinkingBudget: 0 }).success).toBe(false);
    expect(AttemptFileSchema.safeParse({ ...BASE_FILE, thinkingBudget: -1 }).success).toBe(false);
    expect(AttemptFileSchema.safeParse({ ...BASE_FILE, thinkingBudget: 1.5 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// report.ts --write refuses an ambiguous population
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const REPORT_SCRIPT = new URL("../../scripts/report.ts", import.meta.url).pathname;
const BANK_PATH = new URL("../../data/bank/items.json", import.meta.url).pathname;

/** Run the report script exactly as `npm run report` does. No network call happens. */
function runReport(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", REPORT_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

describe("report --write population gate", () => {
  it("refuses when prompt and generator alone leave two populations, and writes nothing", { timeout: 60_000 }, () => {
    const files = readdirSync(ATTEMPTS_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => AttemptFileSchema.parse(JSON.parse(readFileSync(`${ATTEMPTS_DIR}${name}`, "utf8"))));
    const populations = groupAttemptFilesByPopulation(files);
    // The precondition this test exists for: the corpus really does hold a
    // public and a held-out run under one prompt and one generator version.
    const ambiguous = populations.filter((population) =>
      population.promptVersion === "solver-v3" &&
      population.generatorVersion === "scene-families-v11");
    expect(ambiguous.map((population) => population.evaluationSet).sort())
      .toEqual(["held-out", "public"]);

    const before = readFileSync(BANK_PATH, "utf8");
    const result = runReport([
      "--write", "--version", "solver-v3", "--generator-version", "scene-families-v11",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing --write");
    expect(result.stderr).toContain("--evaluation-set");
    // The point of the refusal: mixed calibration never reaches the bank.
    expect(readFileSync(BANK_PATH, "utf8")).toBe(before);
  });

  it("refuses a held-out population outright, even when named exactly", { timeout: 60_000 }, () => {
    const before = readFileSync(BANK_PATH, "utf8");
    const result = runReport(["--write", "--evaluation-set", "held-out"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing --write for a held-out population");
    expect(readFileSync(BANK_PATH, "utf8")).toBe(before);
  });

  it("rejects an evaluation set that is neither population", { timeout: 60_000 }, () => {
    const result = runReport(["--write", "--evaluation-set", "holdout"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--evaluation-set must be one of public, held-out");
  });
});
