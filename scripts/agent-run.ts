/**
 * Agent solver harness — runs test items through a vision/text model via the
 * relay and writes an attempt artifact to data/attempts/.
 *
 *   npm run agent:run                                      # coverage-driven generated probe
 *   npm run agent:run -- --source bank --items 40          # the expanded reference bank instead
 *   npm run agent:run -- --profile short-5 --items 50 --seed run-a
 *   npm run agent:run -- --all --no-coverage --channel symbolic --repeat 2 --concurrency 3
 *
 *   npm run agent:run -- --source held-out --items 40 --seed probe-escalation-held-out
 *
 *   flags: --source generated|bank|held-out (default generated)
 *          --profile short-5|long-30 (default long-30; generated source only)
 *          --seed S (default random; makes a generated or held-out run replayable)
 *          --items N (coverage is still required; --all takes one whole generated test)
 *          --no-coverage (custom generated run; default 20 items)
 *          --channel image|symbolic
 *          --provider X  --model Y (default RELAY_PROVIDER/RELAY_MODEL env)
 *          --repeat N (default 1)  --concurrency N (default 2)
 *          --thinking-budget N (forwarded as the relay X-Thinking-Budget header,
 *                              and recorded in the artifact — a probe run under a
 *                              different budget is a different population)
 *
 * The default source is the live generator, so a run measures the same
 * questions people get. The bank stays available as the fixed regression
 * corpus, which is what makes two runs months apart comparable.
 *
 * `--source held-out` is a whole run of items built from the reserved composed
 * programs the public assembler can never serve. It splits the requested count
 * evenly across every final composed-transform bucket, enforces its own
 * reserved-primitive and program-complexity coverage instead of the public
 * family policy, and refuses `--profile`, because a held-out run is not a test
 * anybody sits. Items go through the same renderer, prompt, and scoring as
 * public ones and are recorded with `evaluationSet: "held-out"`, so the arm
 * answers "does the model transfer to combinations the public pool never
 * practises" without ever being averaged into public accuracy.
 *
 * It replaced the interim `--held-out N` arm on 2026-08-25. That flag appended
 * reserved items to a public run, which put two populations the plan requires
 * to stay separate into one artifact; the separation is now structural.
 *
 * Per attempt: options are shuffled (per-attempt position-bias removal) and the
 * chosen SHUFFLED index is mapped back to the canonical option before recording,
 * so artifacts stay comparable across runs. Every non-correct outcome counts
 * incorrect, but artifacts distinguish reasoning, parser, and harness failures.
 * A relay 429 aborts the run after recording that failed attempt; reports omit
 * the resulting partial artifact unless explicitly asked to include it.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { loadBank } from "../src/items/bank";
import {
  assembleExpandedQuiz,
  questionCount,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  type ExpandedProfile,
} from "../src/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  normalizeWithdrawnFamilyIds,
  readWithdrawnFamilyIds,
} from "../src/items/family-promotion";
import {
  declaredGateCounts,
  generateHeldOutComposedTransformCandidate,
  partitionComposedTransformPrograms,
  sceneFamilyBucketsFor,
  validateSceneFamilyCandidate,
  type ComposedGateCount,
  type SceneFamilyBucket,
} from "../src/items/scene-families";
import {
  sceneComposedProgramKey,
  sceneComposedProgramSteps,
  type SceneComposedProgram,
} from "../src/items/scene-grammar";
import {
  shuffleOptions,
  toPublicPuzzle,
  visualElementSignature,
  VisualPuzzleSchema,
  type Puzzle,
  type PuzzleType,
  type ReasoningBand,
  type Visual,
} from "../src/items/schema";
import { seededRng } from "../src/lib/rng";
import { solveItem, SOLVER_PROMPT_VERSION } from "../src/lib/solver";
import {
  AttemptFileSchema,
  ATTEMPT_OUTCOMES,
  EVALUATION_SETS,
  evaluationSetOf,
  outcomeOf,
  type Attempt,
  type AttemptFile,
  type AttemptOutcome,
  type Channel,
  type EvaluationSet,
} from "../src/lib/attempts";
import { isRateLimitError } from "../src/lib/relay-errors";

/** Outcomes where the model actually answered. Mirrors calibrate's reporting rule. */
const MODEL_ANSWER_OUTCOMES = new Set(["correct", "wrong", "unparseable"]);
import {
  coverageComplete,
  formatMissingCoverage,
  probeCoverage,
  programComplexityBucket,
  selectCoverageItems,
  standardProbeRequirements,
} from "../src/lib/agent-probe";

const ATTEMPTS_DIR = new URL("../data/attempts/", import.meta.url).pathname;

/** Matches the AttemptSchema cap; enough to audit a reasoning reply after the run. */
const RAW_REPLY_CHARS = 2000;

/**
 * Command line, read inside main() rather than at module scope so the item
 * selection below can be imported and unit-tested without a relay call: at
 * module scope this would parse the test runner's own argv and throw.
 */
function readArgs() {
  return parseArgs({
    options: {
      items: { type: "string" },
      all: { type: "boolean", default: false },
      source: { type: "string", default: "generated" },
      // No default: the held-out source has to be able to tell "--profile was
      // given" from "--profile was left alone", and it rejects the former.
      profile: { type: "string" },
      seed: { type: "string" },
      channel: { type: "string", default: "image" },
      provider: { type: "string" },
      model: { type: "string" },
      repeat: { type: "string", default: "1" },
      concurrency: { type: "string", default: "2" },
      // Retired 2026-08-25 in favour of `--source held-out`. Still parsed so
      // the run stops with an explanation instead of "unknown option".
      "held-out": { type: "string" },
      "no-coverage": { type: "boolean", default: false },
      // Some endpoints (google/gemini-3.5-flash since 2026-08) refuse requests
      // with reasoning disabled, the relay's default. This forwards the relay's
      // X-Thinking-Budget so those models can run; record the value used
      // alongside any accuracy comparison.
      "thinking-budget": { type: "string" },
      // Reasoning effort for the harness providers (claude-code, codex), which
      // read it as a body field. Defaults to RELAY_EFFORT so a project can pin
      // one without repeating the flag; recorded in the artifact either way.
      effort: { type: "string" },
    },
  }).values;
}

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

/** Generate enough complete tests for both the target size and fixed coverage. */
function generatedCoveragePool(
  profile: ExpandedProfile,
  seed: string,
  wanted: number | undefined,
): { pool: Puzzle<Visual>[]; coverageItems: Puzzle<Visual>[] } {
  const registry = CURRENT_FAMILY_PROMOTION_REGISTRY;
  const withdrawn = readWithdrawnFamilyIds();
  const requirements = standardProbeRequirements(registry, withdrawn);
  const pool: Puzzle<Visual>[] = [];
  let coverageItems: Puzzle<Visual>[] = [];

  for (let index = 0; index < 100; index++) {
    pool.push(...assembleExpandedQuiz(`${seed}:${index}`, profile, registry, withdrawn));
    coverageItems = selectCoverageItems(pool, requirements);
    const coverage = probeCoverage(coverageItems, requirements);
    if (coverageComplete(coverage) && (wanted === undefined || pool.length >= wanted)) {
      return { pool, coverageItems };
    }
  }

  throw new Error(formatMissingCoverage(probeCoverage(coverageItems, requirements)));
}

/**
 * The family whose reserved programs the held-out source draws from.
 *
 * There is exactly one: the public/held-out split is a property of the composed
 * transform grammar, not a general facility every family offers.
 */
const HELD_OUT_FAMILY_ID = "composed-transform-v2" as const;

/** Items the held-out source draws per final composed bucket unless told otherwise. */
export const HELD_OUT_ITEMS_PER_BUCKET = 20;

/** Draws allowed per held-out slot before the source gives up, as the assembler does. */
const HELD_OUT_RETRY_BUDGET = 24;

export interface HeldOutBucket {
  bucket: SceneFamilyBucket;
  /** Number of worked gates displayed, which may exceed the selected query depth. */
  gateCount: ComposedGateCount;
  /** The band the public twin of this bucket sits in, so the two stay comparable. */
  band: ReasoningBand;
  /** Bucket rollups must never merge a reserved program with its public twin. */
  featureBucket: string;
}

/**
 * Every FINAL composed-transform bucket the held-out source covers.
 *
 * Read from the family's own bucket declaration and the promotion registry, so
 * a bucket added or renamed there is picked up here without editing this file.
 * The even split follows whatever the live declarations hold.
 */
export function heldOutBuckets(): HeldOutBucket[] {
  const registry = CURRENT_FAMILY_PROMOTION_REGISTRY.find((entry) => entry.familyId === HELD_OUT_FAMILY_ID);
  if (!registry) throw new Error(`${HELD_OUT_FAMILY_ID} is not in the promotion registry`);
  const gateCounts = declaredGateCounts();
  return sceneFamilyBucketsFor(HELD_OUT_FAMILY_ID).flatMap((bucket) => {
    // A bucket earns a held-out twin only if the reserved shape has programs at
    // its depth. At five gates it provably has none: the reserved shape is two
    // board moves then token-local steps, which at that length forces both fills
    // plus a turn — and a turn never repaints the slot the first fill painted, so
    // single-gate ablation rejects every one of them. Skipping such a bucket
    // keeps the pinned two-bucket probe and its --items 40 even split valid;
    // throwing here would take the whole held-out source down with it.
    const gateCount = gateCounts[bucket.bucket];
    if (gateCount !== 3 && gateCount !== 4) return [];
    const band = registry.bands.find((entry) => entry.validatedDifficultyBuckets.includes(bucket.bucket));
    if (!band) throw new Error(`${bucket.bucket} is not enabled in any band, so it has no held-out twin`);
    return {
      bucket,
      gateCount: gateCount as ComposedGateCount,
      band: band.band,
      featureBucket: `held-out-${bucket.bucket}`,
    };
  });
}

/** Same recipe the family definition uses, so a fingerprint maps back to its program. */
function composedProgramFingerprint(program: SceneComposedProgram): string {
  return createHash("sha256")
    .update(`${HELD_OUT_FAMILY_ID}:${sceneComposedProgramKey(program)}`)
    .digest("hex")
    .slice(0, 16);
}

/** Every reserved program of one depth, keyed by the fingerprint a built item carries. */
function heldOutProgramsByFingerprint(gateCount: ComposedGateCount): Map<string, SceneComposedProgram> {
  const { heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
  return new Map(heldOutPrograms.map((program) => [composedProgramFingerprint(program), program]));
}

/**
 * The distinct primitives the reserved programs of one depth are built from.
 *
 * This is the held-out source's own coverage unit. It deliberately has nothing
 * to do with the public family policy in agent-probe.ts: a held-out run proves
 * nothing about which families a person meets, and everything about whether the
 * reserved vocabulary is represented.
 */
export function reservedHeldOutPrimitives(gateCount: ComposedGateCount): string[] {
  const primitives = new Set<string>();
  for (const program of partitionComposedTransformPrograms(gateCount).heldOutPrograms) {
    for (const step of sceneComposedProgramSteps(program)) primitives.add(JSON.stringify(step));
  }
  return [...primitives].sort();
}

/**
 * Id for a held-out item.
 *
 * The family prototype stamps every candidate with the same literal id, so
 * without this every held-out attempt in a run would share one itemId and the
 * report would collapse the whole source into a single row. The bucket is part
 * of the hashed identity so two buckets of one run never collide.
 */
export function heldOutItemId(seed: string, bucket: string, index: number): string {
  const digest = createHash("sha256")
    .update(`aiq.held-out-item-id.v2 ${JSON.stringify([seed, bucket, index])}`)
    .digest("hex")
    .slice(0, 16);
  return `held-out-${digest}-${index + 1}-${bucket}`;
}

/** Hash of everything a solver can see, used to keep two held-out items distinct. */
function visibleHeldOutFingerprint(puzzle: Pick<Puzzle<Visual>, "stem" | "options" | "answerIndex">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      stem: puzzle.stem,
      options: puzzle.options,
      answerIndex: puzzle.answerIndex,
    }))
    .digest("hex");
}

/**
 * Items for ONE final composed bucket, built from the reserved programs the
 * public assembler can never serve.
 *
 * Same family code, same renderer, same answer-free contract as a public item —
 * only the combination is withheld, which is what makes the public/held-out
 * comparison a transfer measurement rather than two unrelated tests.
 *
 * Selection is coverage first, exactly as the public probe does it: while a
 * reserved primitive is still unseen a draw is kept only if it shows one, and
 * once the vocabulary is covered every further draw is kept. Draws come off one
 * seeded stream per bucket, so `--seed` replays the source item for item.
 */
export function heldOutBucketPool(
  seed: string,
  entry: HeldOutBucket,
  count: number,
): Puzzle<Visual>[] {
  const items: Puzzle<Visual>[] = [];
  const seenVisible = new Set<string>();
  const programs = heldOutProgramsByFingerprint(entry.gateCount);
  const uncovered = new Set(reservedHeldOutPrimitives(entry.gateCount));
  const rejections: string[] = [];
  let draw = 0;

  while (items.length < count) {
    if (draw >= count * HELD_OUT_RETRY_BUDGET) {
      throw new Error(
        `held-out bucket ${entry.bucket.bucket} filled only ${items.length} of ${count} slots ` +
          `in ${draw} draws: ${[...new Set(rejections)].join(" | ")}`,
      );
    }
    const drawIndex = draw++;
    let candidate;
    try {
      candidate = generateHeldOutComposedTransformCandidate(
        seededRng(seed, `held-out:${entry.bucket.bucket}:${drawIndex}`),
        entry.gateCount,
        entry.bucket.bucket,
      );
    } catch (error) {
      rejections.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    const programFingerprint = candidate.definition.programFingerprint!(candidate.puzzle);
    const program = programs.get(programFingerprint);
    if (!program) {
      // The map is built from the same partition the generator draws from, so a
      // miss means the fingerprint recipe has drifted apart from the family's.
      // Failing loudly beats silently reporting coverage nobody has.
      throw new Error(
        `held-out item carries program fingerprint ${programFingerprint}, which is not a reserved ` +
          `${entry.gateCount}-gate program — the fingerprint recipe has drifted`,
      );
    }
    const primitives = sceneComposedProgramSteps(program).map((step) => JSON.stringify(step));
    if (uncovered.size > 0 && !primitives.some((primitive) => uncovered.has(primitive))) {
      rejections.push("draw covered no unseen reserved primitive");
      continue;
    }

    const puzzle = {
      ...candidate.puzzle,
      id: heldOutItemId(seed, entry.bucket.bucket, items.length),
      band: entry.band,
      generation: {
        generatorVersion: EXPANDED_GENERATOR_VERSION,
        familyId: candidate.familyId,
        programFingerprint,
        featureBucket: entry.featureBucket,
        features: {
          difficulty: entry.bucket.difficulty,
          ruleComplexity: entry.bucket.difficulty,
          // Depth comes from the bucket declaration, the same source the public
          // twin reads: if the two disagreed they would land in different
          // complexity strata and stop being comparable, which is the whole
          // point of the source.
          programDepth: entry.bucket.programDepth,
          activeDimensions: [],
          usesWrap: false,
          distractorStrategy: "near-miss" as const,
        },
      },
    };

    // The reserved programs pass the same correctness contract as public items;
    // checking it here means a broken held-out item fails the run instead of
    // quietly becoming an unanswerable question.
    const acceptance = validateSceneFamilyCandidate({ ...candidate, puzzle });
    if (!acceptance.accepted) {
      rejections.push(acceptance.issues.map((issue) => issue.message).join("; "));
      continue;
    }
    const visible = visibleHeldOutFingerprint(puzzle);
    if (seenVisible.has(visible)) {
      rejections.push("duplicate visible puzzle");
      continue;
    }
    seenVisible.add(visible);
    for (const primitive of primitives) uncovered.delete(primitive);
    items.push(VisualPuzzleSchema.parse(puzzle));
  }

  return items;
}

/**
 * A whole held-out run: the requested count split evenly across every final
 * composed bucket.
 *
 * An uneven count is refused rather than rounded. Two buckets of unequal size
 * cannot be compared with each other, and quietly returning 21 and 19 items
 * would make that invisible in the artifact.
 */
export function heldOutSourcePool(seed: string, count: number): Puzzle<Visual>[] {
  const buckets = heldOutBuckets();
  if (!Number.isInteger(count) || count <= 0 || count % buckets.length !== 0) {
    throw new Error(
      `--source held-out needs an item count that divides evenly across its ${buckets.length} ` +
        `composed buckets (${buckets.map((entry) => entry.bucket.bucket).join(", ")}); got ${count}`,
    );
  }
  const perBucket = count / buckets.length;
  return buckets.flatMap((entry) => heldOutBucketPool(seed, entry, perBucket));
}

export interface HeldOutCoverageReport {
  /** Reserved primitives no selected item shows, per bucket. */
  missingPrimitives: { bucket: string; primitives: string[] }[];
  /** Program-complexity classes the buckets declare but the run does not contain. */
  missingComplexities: string[];
  /** Items per bucket, so an uneven split is visible even when coverage passes. */
  itemsPerBucket: { bucket: string; items: number }[];
}

/**
 * The held-out source's own coverage check.
 *
 * It answers two questions the public policy cannot: does the run show every
 * reserved primitive its buckets are built from, and does it contain every
 * program-complexity class those buckets declare.
 */
export function heldOutCoverage(items: readonly Puzzle<Visual>[]): HeldOutCoverageReport {
  const buckets = heldOutBuckets();
  const missingPrimitives: { bucket: string; primitives: string[] }[] = [];
  const itemsPerBucket: { bucket: string; items: number }[] = [];
  const seenComplexities = new Set(items.flatMap((item) =>
    item.generation ? [programComplexityBucket(item.generation)] : []));

  for (const entry of buckets) {
    const programs = heldOutProgramsByFingerprint(entry.gateCount);
    const mine = items.filter((item) => item.generation?.featureBucket === entry.featureBucket);
    itemsPerBucket.push({ bucket: entry.bucket.bucket, items: mine.length });
    const shown = new Set(mine.flatMap((item) => {
      const program = programs.get(item.generation?.programFingerprint ?? "");
      return program ? sceneComposedProgramSteps(program).map((step) => JSON.stringify(step)) : [];
    }));
    const missing = reservedHeldOutPrimitives(entry.gateCount).filter((primitive) => !shown.has(primitive));
    if (missing.length > 0) missingPrimitives.push({ bucket: entry.bucket.bucket, primitives: missing });
  }

  const missingComplexities = buckets
    .map((entry) => `complexity-${entry.bucket.difficulty}-depth-${entry.bucket.programDepth}`)
    .filter((key) => !seenComplexities.has(key));

  return { missingPrimitives, missingComplexities, itemsPerBucket };
}

export function heldOutCoverageComplete(report: HeldOutCoverageReport): boolean {
  return report.missingPrimitives.length === 0 && report.missingComplexities.length === 0;
}

export function formatMissingHeldOutCoverage(report: HeldOutCoverageReport): string {
  const lines = ["held-out run is missing required coverage:"];
  for (const row of report.missingPrimitives) {
    lines.push(`  ${row.bucket} never shows: ${row.primitives.join(", ")}`);
  }
  if (report.missingComplexities.length > 0) {
    lines.push(`  program-complexity classes absent: ${report.missingComplexities.join(", ")}`);
  }
  return lines.join("\n");
}

function timeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      if (current.name === "TimeoutError" || current.name === "AbortError" || /timed?\s*out|timeout/i.test(current.message)) {
        return true;
      }
      current = current.cause;
    } else {
      break;
    }
  }
  return false;
}

function errorOutcome(error: unknown): AttemptOutcome {
  if (isRateLimitError(error)) return "rate-limit";
  if (timeoutError(error)) return "timeout";
  return "transport-failure";
}

const DIFFICULTY_TIER = (d: number): string => (d <= 2 ? "easy (1-2)" : d === 3 ? "mid (3)" : "hard (4-5)");

async function main() {
  const args = readArgs();
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
  if (source !== "generated" && source !== "bank" && source !== "held-out") {
    throw new Error(`--source must be "generated", "bank", or "held-out" (got "${source}")`);
  }
  if (args["held-out"] !== undefined) {
    // Retired on 2026-08-25. The old flag appended reserved items to a public
    // run, which put two populations the plan requires to stay separate into
    // one artifact.
    throw new Error(
      "--held-out N was replaced by a source of its own: run " +
        `\`npm run agent:run -- --source held-out --items ${args["held-out"]}\` as a separate run`,
    );
  }
  if (source === "held-out") {
    if (args.profile !== undefined) {
      throw new Error("--source held-out rejects --profile: reserved items are not assembled into a test anybody sits");
    }
    if (args.all) {
      throw new Error("--source held-out has no --all: give --items N, split evenly across its composed buckets");
    }
    if (args["no-coverage"]) {
      throw new Error("--source held-out always enforces its own reserved-primitive and program-complexity coverage");
    }
  }
  // Only the generated source reads a profile; its default lives here rather
  // than in the parser so the held-out source can tell an explicit flag apart
  // from an absent one.
  const profile = (args.profile ?? "long-30") as ExpandedProfile;
  if (source === "generated" && !EXPANDED_PROFILES.includes(profile)) {
    throw new Error(`--profile must be one of ${EXPANDED_PROFILES.join(", ")} (got "${args.profile}")`);
  }

  const requestedItems = args.items === undefined ? undefined : Number(args.items);
  if (requestedItems !== undefined && (!Number.isInteger(requestedItems) || requestedItems < 1)) {
    throw new Error(`--items must be a positive integer (got "${args.items}")`);
  }
  if (!Number.isInteger(repeat) || !Number.isInteger(concurrency)) {
    throw new Error("--repeat and --concurrency must be positive integers");
  }

  const thinkingBudget = args["thinking-budget"] === undefined ? undefined : Number(args["thinking-budget"]);
  if (thinkingBudget !== undefined && (!Number.isInteger(thinkingBudget) || thinkingBudget <= 0)) {
    throw new Error("--thinking-budget must be a positive integer");
  }

  const effort = args.effort ?? process.env.RELAY_EFFORT;
  if (effort !== undefined && !["low", "medium", "high"].includes(effort)) {
    throw new Error("--effort (or RELAY_EFFORT) must be low, medium, or high");
  }

  const seed = args.seed ?? randomBytes(8).toString("hex");
  let items: Puzzle<Visual>[];
  if (source === "held-out") {
    const buckets = heldOutBuckets();
    items = heldOutSourcePool(seed, requestedItems ?? buckets.length * HELD_OUT_ITEMS_PER_BUCKET);
    const coverage = heldOutCoverage(items);
    if (!heldOutCoverageComplete(coverage)) throw new Error(formatMissingHeldOutCoverage(coverage));
    console.log(
      `held-out coverage: ${coverage.itemsPerBucket.map((row) => `${row.bucket} ${row.items}`).join(" · ")} · ` +
        `every reserved primitive and program-complexity class present`,
    );
  } else if (source === "bank") {
    const pool = loadBank().map((item) => item.puzzle as Puzzle<Visual>);
    const wanted = args.all ? pool.length : (requestedItems ?? 20);
    items = wanted >= pool.length ? pool : sampleItems(pool, wanted);
  } else if (args["no-coverage"]) {
    const wanted = args.all ? questionCount(profile) : (requestedItems ?? 20);
    const pool = generatedPool(profile, seed, wanted);
    items = wanted >= pool.length ? pool : sampleItems(pool, wanted);
  } else if (args.all) {
    // For the bank, `--all` means every banked item. For the generator there is
    // no finite pool, so it means the whole eligible battery at the standard
    // minimum. Taking a single test could never satisfy that: subsampling puts
    // ~14 of the 19 eligible families in any one test, so this branch used to
    // fail every time it was run.
    const { coverageItems } = generatedCoveragePool(profile, seed, undefined);
    items = coverageItems;
  } else {
    const { pool, coverageItems } = generatedCoveragePool(profile, seed, requestedItems);
    if (requestedItems !== undefined && coverageItems.length > requestedItems) {
      throw new Error(formatMissingCoverage(probeCoverage(coverageItems.slice(0, requestedItems),
        standardProbeRequirements(CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds()))));
    }
    const chosenIds = new Set(coverageItems.map((item) => item.id));
    const extrasNeeded = requestedItems === undefined ? 0 : requestedItems - coverageItems.length;
    const extras = extrasNeeded > 0
      ? sampleItems(pool.filter((item) => !chosenIds.has(item.id)), extrasNeeded)
      : [];
    items = [...coverageItems, ...extras];
    const requirements = standardProbeRequirements(CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds());
    const coverage = probeCoverage(items, requirements);
    if (!coverageComplete(coverage)) throw new Error(formatMissingCoverage(coverage));
    console.log(`coverage: ${requirements.minimum} per ${requirements.families.length} eligible families and ${requirements.programComplexities.length} program-complexity buckets`);
  }

  // A run is entirely one population or entirely the other; the two are never
  // pooled, and no public coverage requirement can be paid with a reserved item.
  const heldOutItemIds = source === "held-out" ? new Set(items.map((item) => item.id)) : new Set<string>();

  // Build the full work list: each sampled item × repeat.
  const work: Puzzle<Visual>[] = [];
  for (let r = 0; r < repeat; r++) work.push(...items);

  const startedAt = new Date().toISOString();
  const sourceLabel = source === "bank"
    ? "bank"
    : source === "held-out"
      ? `held-out · seed ${seed}`
      : `generated ${profile} · seed ${seed}`;
  console.log(
    `agent:run — ${items.length} items × ${repeat} = ${work.length} attempts · ${sourceLabel} · ${channel} channel · ` +
      `${provider}/${model} · concurrency ${concurrency} · thinking budget ${thinkingBudget ?? "off"} · ` +
      `effort ${effort ?? "provider default"}`,
  );

  const attempts: Attempt[] = [];
  let aborted = false;
  let nextIndex = 0;

  const worker = async () => {
    while (!aborted) {
      const idx = nextIndex++;
      if (idx >= work.length) return;
      const canonical = work[idx];
      const evaluationSet: EvaluationSet = heldOutItemIds.has(canonical.id) ? "held-out" : "public";
      const shuffled = shuffleOptions(canonical);
      const attemptStarted = Date.now();
      try {
        // The solver receives the same answer-free contract as a browser. The
        // canonical puzzle stays local only for scoring and artifact metadata.
        const outcome = await solveItem(toPublicPuzzle(shuffled), channel, { provider, model, thinkingBudget, effort });
        const chosen = canonicalIndex(canonical, shuffled, outcome.chosen);
        const correct = chosen !== null && chosen === canonical.answerIndex;
        attempts.push({
          itemId: canonical.id,
          chosen,
          correct,
          outcome: correct ? "correct" : chosen === null ? "unparseable" : "wrong",
          evaluationSet,
          latencyMs: outcome.latencyMs,
          generation: canonical.generation,
          attemptBudget: 1,
          raw: outcome.raw.slice(0, RAW_REPLY_CHARS),
          ts: new Date().toISOString(),
        });
      } catch (err) {
        const outcome = errorOutcome(err);
        attempts.push({
          itemId: canonical.id,
          chosen: null,
          correct: false,
          outcome,
          evaluationSet,
          latencyMs: Date.now() - attemptStarted,
          generation: canonical.generation,
          attemptBudget: 1,
          raw: (err instanceof Error ? err.message : String(err)).slice(0, RAW_REPLY_CHARS),
          ts: new Date().toISOString(),
        });
        if (outcome === "rate-limit") {
          // Relay 429 — abort the whole run; the failed attempt remains visible.
          aborted = true;
          console.error(`\nrate limited — aborting run after ${attempts.length} attempts`);
          return;
        }
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
    source,
    profile: source === "generated" ? profile : null,
    runSeed: seed,
    // Protocol the run was executed under. The thinking budget is recorded as
    // an explicit null when the run asked for none, so a reader can tell "this
    // run had reasoning off" from "this artifact predates the field": the plan
    // voids any gemini-3.5-flash comparison whose budget differs, and that
    // check is impossible if the two look alike on disk.
    thinkingBudget: thinkingBudget ?? null,
    // Same reasoning: an explicit null means "this run asked for no particular
    // effort", not "this artifact predates the field". Comparing two harness
    // runs at different efforts is comparing two different models.
    effort: effort ?? null,
    repeat,
    concurrency,
    // Held-out items come out of the same live generator as public ones, so
    // they carry its version; only the bank ships its own provenance.
    generatorVersion: source === "bank" ? "bank-v1" : EXPANDED_GENERATOR_VERSION,
    // The withdrawal list is an assembler input. Held-out items never go
    // through the assembler, so recording one would imply a dependency the run
    // does not have.
    withdrawnFamilyIds: source === "generated"
      ? normalizeWithdrawnFamilyIds(readWithdrawnFamilyIds())
      : undefined,
    plannedAttempts: work.length,
    completedAttempts: attempts.length,
    // A run where nothing reached the model is `failed`, not `complete`: every
    // attempt may be recorded and still measure nothing about the items.
    status: attempts.every((attempt) =>
      attempt.outcome !== undefined && !MODEL_ANSWER_OUTCOMES.has(attempt.outcome))
      ? "failed"
      : attempts.length === work.length ? "complete" : "partial",
    attempts,
  });

  const outPath = `${ATTEMPTS_DIR}${runId}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`\nwrote ${attempts.length} attempts → ${outPath}${artifact.status === "partial" ? " (PARTIAL — run aborted)" : ""}`);

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

  // Public and held-out are separate populations, never one average: a run
  // carrying both must show which number belongs to the test people take.
  const bySet = group(evaluationSetOf);
  // Printed whenever the run touched the reserved population at all, not only
  // when it mixed both: a held-out artifact must name its population out loud.
  if (bySet.size > 1 || bySet.has("held-out")) {
    console.log("\nby evaluation set (never pooled):");
    for (const set of EVALUATION_SETS) {
      const rows = bySet.get(set);
      if (rows) console.log(`  ${set.padEnd(12)} ${rate(rows)}`);
    }
  }

  console.log("\nby outcome (all non-correct outcomes remain incorrect):");
  for (const outcome of ATTEMPT_OUTCOMES) {
    console.log(`  ${outcome.padEnd(20)} ${attempts.filter((attempt) => outcomeOf(attempt) === outcome).length}`);
  }

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

// Only run when this file IS the command being executed. Importing it (the
// held-out selection tests do) must never start a paid model run.
const executedDirectly = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
