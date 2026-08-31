import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { seededRng } from "../src/lib/rng";
import {
  SCENE_FAMILY_BUCKETS,
  SCENE_FAMILY_IDS,
  checkAnsweredStrand,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
  MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND,
  type SceneFamilyId,
} from "../src/items/scene-families";
import {
  compareCloseness,
  sceneEditDistance,
  type SceneDistance,
} from "../src/items/scene-distance";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, EXPANDED_PROFILE_BANDS } from "../src/items/family-promotion";
import { eligibleFamiliesForBand } from "../src/items/expanded-quiz";

const PROGRAM_VARIETY_PROBE_SEEDS = 200;
const MIN_DISTINCT_PROGRAM_FINGERPRINTS = 8;

/**
 * The frozen answer-to-distractor distances from before closeness-ranked
 * selection (escalate-the-quiz plan, Phase 1). Every comparable key must stay
 * at least as close as it was, and the whole battery must get strictly closer.
 *
 * The fixture was re-measured on 2026-08-26, after `sceneEditDistance` was
 * corrected to the plan's coordinate-based contract: a baseline recorded with a
 * different metric proves nothing about the numbers this script prints. It is
 * not a re-run of today's code — it is the pre-batch commit's own uniform
 * selector, extracted read-only with `git archive`, measured with today's
 * metric. The fixture's `howThisWasRegenerated` field carries the exact steps,
 * seed stream, and percentile rule; its `keysNotCarried` field says which keys
 * deliberately have no baseline and why; and its `withdrawnKeys` field holds the
 * recorded numbers of keys that had a baseline and are no longer served.
 */
const DISTANCE_BASELINE_PATH = "data/fixtures/scene-distance-v10.json";

/**
 * Families deliberately converted to an enumerable rule grammar (mechanism
 * variety plan, Lever 2). Keep this explicit: a `-v2` suffix alone does not
 * mean a family has this diversity contract. Add a family only with its
 * grammar conversion, never for an unrelated version bump or an unconverted
 * family. A newly introduced grammar family may qualify as `-v1`.
 */
const CONVERTED_FAMILY_IDS = new Set<string>([
  "relational-sequence-v2",
  "attribute-pairing-v1",
  "second-order-sequence-v2",
  "compositional-analogy-v2",
  "inverse-analogy-v2",
  "relational-matrix-v2",
  "visual-set-algebra-v2",
  "spatial-transform-v2",
  "transformation-machine-v3",
  "rule-switching-v2",
  "composed-transform-v2",
  "parallel-evolution-v1",
  "combining-machine-v1",
]);

const seedsArg = process.argv.find((argument) => argument.startsWith("--seeds="));
const seeds = Number(seedsArg?.split("=")[1] ?? PROGRAM_VARIETY_PROBE_SEEDS);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 1_000) {
  throw new Error("--seeds must be an integer from 1 to 1000");
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

/** Nearest rank over lexicographically sorted `(positions, atoms)` tuples. */
function distancePercentile(values: readonly SceneDistance[], fraction: number): SceneDistance | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort(compareCloseness);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function distanceLabel(distance: SceneDistance | null): string {
  if (distance === null) return "n/a";
  return distance === "incomparable" ? "incomparable" : `(${distance.positions}, ${distance.atoms})`;
}

interface BaselineEntry {
  seeds: number;
  servedDistances: number;
  p50: SceneDistance;
  p90: SceneDistance;
}

interface WithdrawnBaselineEntry extends BaselineEntry {
  withdrawnOn: string;
  withdrawnReason: string;
}

const baselineFile = JSON.parse(readFileSync(DISTANCE_BASELINE_PATH, "utf8")) as {
  keys: Record<string, BaselineEntry>;
  withdrawnKeys?: Record<string, WithdrawnBaselineEntry>;
};
const baseline: Record<string, BaselineEntry> = baselineFile.keys;

/**
 * Keys that had a v10 baseline and are no longer served.
 *
 * A withdrawal is a normal event, and the fixture has to survive one without
 * either failing forever or being quietly edited down until it agrees with
 * whatever the code does today. So a withdrawn key keeps its recorded numbers
 * and moves to its own object: the gate stops expecting the key to be measured,
 * the aggregate comparison keeps running over the keys that ARE comparable, and
 * the evidence of what the key used to measure stays in the file.
 *
 * It is checked in both directions. A key in both objects is a contradiction,
 * and a key recorded as withdrawn that a run measures anyway means a family came
 * back without its baseline row coming back with it — both fail.
 */
const withdrawnBaseline: Record<string, WithdrawnBaselineEntry> = baselineFile.withdrawnKeys ?? {};

/**
 * Every family/band/bucket a public test can serve today, one row per bucket.
 *
 * A family with several validated buckets in one band contributes one key per
 * bucket, which is the shape the v10 fixture already uses
 * (`family:band:bucket`). Withdrawals are deliberately ignored: this is a build
 * gate on the code, not on one deployment's environment, and the baseline was
 * captured over the same complete set.
 */
const enabledKeys = EXPANDED_PROFILE_BANDS.flatMap((band) =>
  eligibleFamiliesForBand(CURRENT_FAMILY_PROMOTION_REGISTRY, band).flatMap((family) =>
    family.bandBuckets.map((bucket) => ({
      familyId: family.familyId,
      band: family.band,
      difficultyBucket: bucket.bucket,
      difficulty: bucket.difficulty,
      key: `${family.familyId}:${family.band}:${bucket.bucket}`,
    }))));

/**
 * Registry and generator must agree, bucket for bucket.
 *
 * The registry decides what may be SERVED; `SCENE_FAMILY_BUCKETS` decides what
 * can be GENERATED. Nothing else connects them, so a bucket enabled in one and
 * missing from the other would only surface as a failed draw inside a real
 * test. This check fails the build instead.
 */
const parityProblems: string[] = [];
for (const entry of enabledKeys) {
  const declared = SCENE_FAMILY_BUCKETS[entry.familyId as SceneFamilyId]
    ?.find((bucket) => bucket.bucket === entry.difficultyBucket);
  if (!declared) {
    parityProblems.push(
      `${entry.key}: the registry enables this bucket but ${entry.familyId} does not declare it`,
    );
  } else if (declared.difficulty !== entry.difficulty) {
    parityProblems.push(
      `${entry.key}: the registry bucket name means difficulty ${entry.difficulty} but the family declares ${declared.difficulty}`,
    );
  }
}
const declaredBucketOwners = new Map<string, SceneFamilyId>();
for (const familyId of SCENE_FAMILY_IDS) {
  for (const bucket of SCENE_FAMILY_BUCKETS[familyId]) {
    const owner = declaredBucketOwners.get(bucket.bucket);
    if (owner !== undefined) {
      parityProblems.push(`bucket ${bucket.bucket} is declared by both ${owner} and ${familyId}`);
    } else {
      declaredBucketOwners.set(bucket.bucket, familyId);
    }
  }
}
let failures = parityProblems.length;

/** Answer-to-served-distractor distances, collected from the shuffled options. */
const servedDistancesByKey = new Map<string, SceneDistance[]>(
  enabledKeys.map((entry) => [entry.key, []]),
);
/** Which served keys one generated (family, bucket) draw contributes distances to. */
const enabledKeysByFamilyBucket = new Map<string, typeof enabledKeys>();
for (const entry of enabledKeys) {
  const lookup = `${entry.familyId}:${entry.difficultyBucket}`;
  const known = enabledKeysByFamilyBucket.get(lookup);
  if (known) known.push(entry);
  else enabledKeysByFamilyBucket.set(lookup, [entry]);
}

const families = SCENE_FAMILY_IDS.map((familyId) => {
  // Diversity is a property of the family's full rule grammar, so it is judged
  // across every declared bucket rather than on only its narrowest bucket.
  const fingerprintsInProbe = new Set<string>();
  // Every declared bucket is swept, not just the one a band happens to enter
  // at: a bucket nothing can generate must fail the build, not a later test.
  const buckets = SCENE_FAMILY_BUCKETS[familyId].map((declared) => {
    const latencies: number[] = [];
    const replayKeys = new Set<string>();
    let extrapolationFailures = 0;
    let extrapolationFailureExample: string | undefined;
    let minObservedTerms: number | undefined;
    const programFingerprints = new Set<string>();
    const programFingerprintsInDiversityProbe = new Set<string>();
    let missingProgramFingerprints = 0;
    let rejected = 0;
    let difficultyMismatches = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const started = performance.now();
      // The seed stream is the bucket-free one this script has always used, so
      // a family's entry bucket reports exactly the numbers it reported before
      // buckets were named and the frozen distance fixture stays comparable.
      const stream = `${familyId}:${seed}`;
      const first = generateSceneFamilyCandidate(
        familyId,
        seededRng("scene-family-verify-v1", stream),
        declared.bucket,
      );
      const replay = generateSceneFamilyCandidate(
        familyId,
        seededRng("scene-family-verify-v1", stream),
        declared.bucket,
      );
      const replayKey = first.definition.replayKey?.(first.puzzle);
      const programFingerprint = first.definition.programFingerprint?.(first.puzzle);
      const replayMatches = replayKey !== undefined && replayKey === replay.definition.replayKey?.(replay.puzzle) &&
        JSON.stringify(first.puzzle) === JSON.stringify(replay.puzzle);
      const acceptance = validateSceneFamilyCandidate(first, replayKey);
      if (!acceptance.accepted || !replayMatches) rejected++;
      // A bucket that generates a different difficulty than it declares would
      // be rejected by the assembler on every draw, thinning a band silently.
      if (first.puzzle.difficulty !== declared.difficulty) difficultyMismatches++;
      // The strand declaration is re-read from the puzzle itself, never trusted:
      // a family that names the wrong panels fails the build.
      const strand = checkAnsweredStrand(first);
      if (strand.problem !== null) {
        extrapolationFailures++;
        extrapolationFailureExample ??= strand.problem;
      }
      if (strand.observedTerms !== null) {
        minObservedTerms = Math.min(minObservedTerms ?? Number.POSITIVE_INFINITY, strand.observedTerms);
      }
      // Distance is measured from the final shuffled options, so it reflects what
      // a taker is actually offered rather than what the family intended.
      const servedKeys = enabledKeysByFamilyBucket.get(`${familyId}:${declared.bucket}`);
      if (servedKeys && seed < PROGRAM_VARIETY_PROBE_SEEDS) {
        const answer = first.puzzle.options[first.puzzle.answerIndex];
        const distances = first.puzzle.options
          .filter((_, index) => index !== first.puzzle.answerIndex)
          .map((option) => sceneEditDistance(option, answer));
        for (const served of servedKeys) servedDistancesByKey.get(served.key)!.push(...distances);
      }
      if (replayKey) replayKeys.add(replayKey);
      if (programFingerprint) {
        programFingerprints.add(programFingerprint);
        // Always use the same first 200 seeds, so --seeds=500 cannot conceal a
        // regression in the required 200-seed probe.
        if (seed < PROGRAM_VARIETY_PROBE_SEEDS) {
          programFingerprintsInDiversityProbe.add(programFingerprint);
          fingerprintsInProbe.add(programFingerprint);
        }
      } else {
        missingProgramFingerprints++;
      }
      latencies.push(performance.now() - started);
    }
    return {
      difficultyBucket: declared.bucket,
      difficulty: declared.difficulty,
      programDepth: declared.programDepth,
      seeds,
      rejected,
      rejectionRate: rejected / seeds,
      difficultyMismatches,
      distinctReplayKeys: replayKeys.size,
      distinctProgramFingerprints: programFingerprints.size,
      distinctProgramFingerprintsInProbe: programFingerprintsInDiversityProbe.size,
      missingProgramFingerprints,
      extrapolation: {
        minObservedTermsInAnsweredStrand: minObservedTerms ?? null,
        failures: extrapolationFailures,
        failureExample: extrapolationFailureExample ?? null,
        passed: extrapolationFailures === 0,
      },
      medianMs: Number(percentile(latencies, 0.5).toFixed(3)),
      p95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
      maxMs: Number(Math.max(...latencies).toFixed(3)),
    };
  });

  const converted = CONVERTED_FAMILY_IDS.has(familyId);
  const diversityGateEnforced = converted && seeds >= PROGRAM_VARIETY_PROBE_SEEDS;
  const diversityPassed = !diversityGateEnforced ||
    fingerprintsInProbe.size >= MIN_DISTINCT_PROGRAM_FINGERPRINTS;
  if (!diversityPassed) failures++;
  const rejected = buckets.reduce((total, bucket) => total + bucket.rejected, 0);
  const difficultyMismatches = buckets.reduce((total, bucket) => total + bucket.difficultyMismatches, 0);
  const extrapolationFailures = buckets.reduce((total, bucket) => total + bucket.extrapolation.failures, 0);
  failures += rejected;
  failures += difficultyMismatches;
  failures += extrapolationFailures;
  const observedTerms = buckets
    .map((bucket) => bucket.extrapolation.minObservedTermsInAnsweredStrand)
    .filter((value): value is number => value !== null);
  return {
    familyId,
    seeds,
    rejected,
    rejectionRate: rejected / (seeds * buckets.length),
    difficultyMismatches,
    distinctReplayKeys: buckets.reduce((total, bucket) => total + bucket.distinctReplayKeys, 0),
    distinctProgramFingerprints: fingerprintsInProbe.size,
    missingProgramFingerprints: buckets.reduce((total, bucket) => total + bucket.missingProgramFingerprints, 0),
    programVariety: {
      converted,
      enforced: diversityGateEnforced,
      probeSeeds: Math.min(seeds, PROGRAM_VARIETY_PROBE_SEEDS),
      requiredProbeSeeds: PROGRAM_VARIETY_PROBE_SEEDS,
      requiredDistinctProgramFingerprints: MIN_DISTINCT_PROGRAM_FINGERPRINTS,
      distinctProgramFingerprintsInProbe: fingerprintsInProbe.size,
      passed: diversityPassed,
    },
    extrapolation: {
      minimumObservedTermsInAnsweredStrand: MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND,
      minObservedTermsInAnsweredStrand: observedTerms.length > 0 ? Math.min(...observedTerms) : null,
      failures: extrapolationFailures,
      failureExample: buckets.map((bucket) => bucket.extrapolation.failureExample).find(Boolean) ?? null,
      passed: extrapolationFailures === 0,
    },
    medianMs: Math.max(...buckets.map((bucket) => bucket.medianMs)),
    p95Ms: Math.max(...buckets.map((bucket) => bucket.p95Ms)),
    maxMs: Math.max(...buckets.map((bucket) => bucket.maxMs)),
    buckets,
  };
});

/**
 * The distance gate only means anything over the fixture's own sample size, so
 * a shortened `--seeds=` run reports its numbers without failing on them — the
 * same rule the fingerprint-diversity gate already uses.
 */
const distanceGateEnforced = seeds >= PROGRAM_VARIETY_PROBE_SEEDS;

const distanceKeys = enabledKeys.map((entry) => {
  const distances = servedDistancesByKey.get(entry.key) ?? [];
  const p50 = distancePercentile(distances, 0.5);
  const p90 = distancePercentile(distances, 0.9);
  const fixture = baseline[entry.key] ?? null;
  const farther = (measured: SceneDistance | null, before: SceneDistance | undefined) =>
    measured !== null && before !== undefined && compareCloseness(measured, before) > 0;
  const regressed = distanceGateEnforced && (farther(p50, fixture?.p50) || farther(p90, fixture?.p90));
  if (regressed) failures++;
  return {
    ...entry,
    seeds: Math.min(seeds, PROGRAM_VARIETY_PROBE_SEEDS),
    servedDistances: distances.length,
    p50,
    p90,
    baseline: fixture === null ? null : { p50: fixture.p50, p90: fixture.p90 },
    /** No v10 baseline exists for a key added after the fixture was frozen. */
    comparable: fixture !== null,
    regressed,
  };
});

/**
 * The point of ranking is that the whole battery moves, not merely that nothing
 * got worse. `positions` is the coarse term of the distance and the one a
 * solver reads at a glance, so the summed median across every comparable key
 * must come down strictly.
 *
 * A key whose median is missing or `"incomparable"` has no position count to
 * add, and summing it as anything would fake an improvement, so its presence
 * fails the aggregate outright. That case is already a per-key regression:
 * `"incomparable"` sorts behind every finite distance.
 */
const comparableKeys = distanceKeys.filter((entry) => entry.comparable);
const positionsOf = (distance: SceneDistance | null | undefined): number | null =>
  distance === null || distance === undefined || distance === "incomparable" ? null : distance.positions;
const sumMedianPositions = (medianOf: (entry: typeof comparableKeys[number]) => SceneDistance | null | undefined) =>
  comparableKeys.reduce<number | null>((total, entry) => {
    const positions = positionsOf(medianOf(entry));
    return total === null || positions === null ? null : total + positions;
  }, 0);
const summedMedianPositions = sumMedianPositions((entry) => entry.p50);
const baselineSummedMedianPositions = sumMedianPositions((entry) => entry.baseline?.p50);
const measuredKey = (key: string) => distanceKeys.some((entry) => entry.key === key);
const missingBaselineKeys = Object.keys(baseline).filter((key) => !measuredKey(key));
/** A key cannot be both a live baseline and a withdrawn record. */
const contradictoryBaselineKeys = Object.keys(withdrawnBaseline).filter((key) => key in baseline);
/** A key recorded as withdrawn that this run served anyway. */
const revivedWithdrawnKeys = Object.keys(withdrawnBaseline).filter(measuredKey);
if (contradictoryBaselineKeys.length > 0) failures++;
if (revivedWithdrawnKeys.length > 0) failures++;
const aggregateImproved = comparableKeys.length > 0 &&
  missingBaselineKeys.length === 0 &&
  summedMedianPositions !== null &&
  baselineSummedMedianPositions !== null &&
  summedMedianPositions < baselineSummedMedianPositions;
if (distanceGateEnforced && !aggregateImproved) failures++;

process.stdout.write(`${JSON.stringify({
  version: "scene-family-verify-v5",
  bucketParity: {
    enabledRegistryKeys: enabledKeys.length,
    declaredBuckets: declaredBucketOwners.size,
    problems: parityProblems,
    passed: parityProblems.length === 0,
  },
  programVariety: {
    convertedFamilyIds: [...CONVERTED_FAMILY_IDS],
    probeSeeds: PROGRAM_VARIETY_PROBE_SEEDS,
    minimumDistinctProgramFingerprints: MIN_DISTINCT_PROGRAM_FINGERPRINTS,
  },
  distractorDistance: {
    baselinePath: DISTANCE_BASELINE_PATH,
    probeSeeds: PROGRAM_VARIETY_PROBE_SEEDS,
    enforced: distanceGateEnforced,
    summedMedianPositions,
    baselineSummedMedianPositions,
    aggregateImproved,
    missingBaselineKeys,
    withdrawnBaselineKeys: Object.entries(withdrawnBaseline).map(([key, entry]) => ({
      key,
      withdrawnOn: entry.withdrawnOn,
      p50: entry.p50,
      p90: entry.p90,
    })),
    contradictoryBaselineKeys,
    revivedWithdrawnKeys,
    keys: distanceKeys,
  },
  families,
}, null, 2)}\n`);

for (const problem of parityProblems) process.stderr.write(`bucket parity: ${problem}\n`);
for (const entry of distanceKeys) {
  process.stderr.write(
    `${entry.key}  p50 ${distanceLabel(entry.p50)} (was ${distanceLabel(entry.baseline?.p50 ?? null)})  ` +
      `p90 ${distanceLabel(entry.p90)} (was ${distanceLabel(entry.baseline?.p90 ?? null)})` +
      `${entry.regressed ? "  REGRESSED" : ""}\n`,
  );
}
process.stderr.write(
  `summed p50 positions ${summedMedianPositions} vs baseline ${baselineSummedMedianPositions} ` +
    `over ${comparableKeys.length} comparable keys\n`,
);

if (failures > 0) {
  const diversityFailures = families.filter((family) => !family.programVariety.passed)
    .map((family) => `${family.familyId} (${family.programVariety.distinctProgramFingerprintsInProbe}/${MIN_DISTINCT_PROGRAM_FINGERPRINTS})`);
  const parts = [];
  if (parityProblems.length > 0) {
    parts.push(`registry and declared difficulty buckets disagree: ${parityProblems.join("; ")}`);
  }
  const rejected = families.reduce((count, family) => count + family.rejected, 0);
  if (rejected > 0) parts.push(`${rejected} scene-family candidates failed acceptance or replay`);
  const mismatched = families.filter((family) => family.difficultyMismatches > 0).map((family) =>
    `${family.familyId} (${family.buckets.filter((bucket) => bucket.difficultyMismatches > 0)
      .map((bucket) => `${bucket.difficultyBucket} produced a different difficulty ${bucket.difficultyMismatches} times`)
      .join(", ")})`);
  if (mismatched.length > 0) {
    parts.push(`declared buckets did not generate their own difficulty: ${mismatched.join("; ")}`);
  }
  if (diversityFailures.length > 0) {
    parts.push(`program-fingerprint diversity failed for ${diversityFailures.join(", ")} across ${PROGRAM_VARIETY_PROBE_SEEDS} seeds`);
  }
  const extrapolationOffenders = families.filter((family) => !family.extrapolation.passed)
    .map((family) => `${family.familyId} (${family.extrapolation.failureExample})`);
  if (extrapolationOffenders.length > 0) {
    parts.push(
      `extrapolation gate failed for ${extrapolationOffenders.join(", ")}: a row strand containing the blank must show at least ${MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND} terms, declared as the panels that lead to it`,
    );
  }
  const distanceOffenders = distanceKeys.filter((entry) => entry.regressed).map((entry) =>
    `${entry.key} (p50 ${distanceLabel(entry.p50)} vs ${distanceLabel(entry.baseline?.p50 ?? null)}, ` +
      `p90 ${distanceLabel(entry.p90)} vs ${distanceLabel(entry.baseline?.p90 ?? null)})`);
  if (distanceOffenders.length > 0) {
    parts.push(`served distractors moved farther from the answer for ${distanceOffenders.join(", ")}`);
  }
  if (contradictoryBaselineKeys.length > 0) {
    parts.push(
      `${DISTANCE_BASELINE_PATH} lists the same key as both a baseline and a withdrawal: ` +
        `${contradictoryBaselineKeys.join(", ")}`,
    );
  }
  if (revivedWithdrawnKeys.length > 0) {
    parts.push(
      `${DISTANCE_BASELINE_PATH} records these keys as withdrawn but this run served them: ` +
        `${revivedWithdrawnKeys.join(", ")}. Move the row back into "keys" so the key is compared again.`,
    );
  }
  if (missingBaselineKeys.length > 0) {
    parts.push(
      `${DISTANCE_BASELINE_PATH} names keys this run never measured: ${missingBaselineKeys.join(", ")}. ` +
        `If the key was withdrawn, move its row into "withdrawnKeys" with the date and the reason ` +
        `rather than deleting it.`,
    );
  } else if (distanceGateEnforced && !aggregateImproved) {
    parts.push(
      `summed median distractor positions did not improve: ${summedMedianPositions} against a baseline of ${baselineSummedMedianPositions}`,
    );
  }
  throw new Error(parts.join("; "));
}
