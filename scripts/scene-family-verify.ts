import { performance } from "node:perf_hooks";
import { seededRng } from "../src/lib/rng";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
} from "../src/items/scene-families";

const PROGRAM_VARIETY_PROBE_SEEDS = 200;
const MIN_DISTINCT_PROGRAM_FINGERPRINTS = 8;

/**
 * Families deliberately converted to an enumerable rule grammar (mechanism
 * variety plan, Lever 2). Keep this explicit: a `-v2` suffix alone does not
 * mean a family has this diversity contract. Add a family only with its
 * grammar conversion, never for an unrelated version bump or an unconverted
 * family. A newly introduced grammar family may qualify as `-v1`.
 */
const CONVERTED_FAMILY_IDS = new Set<string>([
  "relational-sequence-v2",
  "relational-outlier-v2",
  "attribute-pairing-v1",
  "interleaved-sequence-v2",
  "second-order-sequence-v2",
  "compositional-analogy-v2",
  "containment-analogy-v2",
  "inverse-analogy-v2",
  "relational-matrix-v2",
  "visual-set-algebra-v2",
  "constraint-mosaic-v2",
  "fold-punch-v2",
  "inverse-fold-punch-v2",
  "spatial-transform-v2",
  "minimal-repair-v3",
  "transformation-machine-v3",
  "rule-switching-v2",
  "concept-induction-v2",
  "composed-transform-v1",
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

let failures = 0;
const families = SCENE_FAMILY_IDS.map((familyId) => {
  const latencies: number[] = [];
  const replayKeys = new Set<string>();
  const programFingerprints = new Set<string>();
  const programFingerprintsInDiversityProbe = new Set<string>();
  let missingProgramFingerprints = 0;
  let rejected = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const started = performance.now();
    const first = generateSceneFamilyCandidate(familyId, seededRng("scene-family-verify-v1", `${familyId}:${seed}`));
    const replay = generateSceneFamilyCandidate(familyId, seededRng("scene-family-verify-v1", `${familyId}:${seed}`));
    const replayKey = first.definition.replayKey?.(first.puzzle);
    const programFingerprint = first.definition.programFingerprint?.(first.puzzle);
    const replayMatches = replayKey !== undefined && replayKey === replay.definition.replayKey?.(replay.puzzle) &&
      JSON.stringify(first.puzzle) === JSON.stringify(replay.puzzle);
    const acceptance = validateSceneFamilyCandidate(first, replayKey);
    if (!acceptance.accepted || !replayMatches) rejected++;
    if (replayKey) replayKeys.add(replayKey);
    if (programFingerprint) {
      programFingerprints.add(programFingerprint);
      // Always use the same first 200 seeds, so --seeds=500 cannot conceal a
      // regression in the required 200-seed probe.
      if (seed < PROGRAM_VARIETY_PROBE_SEEDS) programFingerprintsInDiversityProbe.add(programFingerprint);
    } else {
      missingProgramFingerprints++;
    }
    latencies.push(performance.now() - started);
  }
  const converted = CONVERTED_FAMILY_IDS.has(familyId);
  const diversityGateEnforced = converted && seeds >= PROGRAM_VARIETY_PROBE_SEEDS;
  const diversityPassed = !diversityGateEnforced ||
    programFingerprintsInDiversityProbe.size >= MIN_DISTINCT_PROGRAM_FINGERPRINTS;
  if (!diversityPassed) failures++;
  failures += rejected;
  return {
    familyId,
    seeds,
    rejected,
    rejectionRate: rejected / seeds,
    distinctReplayKeys: replayKeys.size,
    distinctProgramFingerprints: programFingerprints.size,
    missingProgramFingerprints,
    programVariety: {
      converted,
      enforced: diversityGateEnforced,
      probeSeeds: Math.min(seeds, PROGRAM_VARIETY_PROBE_SEEDS),
      requiredProbeSeeds: PROGRAM_VARIETY_PROBE_SEEDS,
      requiredDistinctProgramFingerprints: MIN_DISTINCT_PROGRAM_FINGERPRINTS,
      distinctProgramFingerprintsInProbe: programFingerprintsInDiversityProbe.size,
      passed: diversityPassed,
    },
    medianMs: Number(percentile(latencies, 0.5).toFixed(3)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...latencies).toFixed(3)),
  };
});

process.stdout.write(`${JSON.stringify({
  version: "scene-family-verify-v2",
  programVariety: {
    convertedFamilyIds: [...CONVERTED_FAMILY_IDS],
    probeSeeds: PROGRAM_VARIETY_PROBE_SEEDS,
    minimumDistinctProgramFingerprints: MIN_DISTINCT_PROGRAM_FINGERPRINTS,
  },
  families,
}, null, 2)}\n`);
if (failures > 0) {
  const diversityFailures = families.filter((family) => !family.programVariety.passed)
    .map((family) => `${family.familyId} (${family.programVariety.distinctProgramFingerprintsInProbe}/${MIN_DISTINCT_PROGRAM_FINGERPRINTS})`);
  const parts = [];
  const rejected = families.reduce((count, family) => count + family.rejected, 0);
  if (rejected > 0) parts.push(`${rejected} scene-family candidates failed acceptance or replay`);
  if (diversityFailures.length > 0) {
    parts.push(`program-fingerprint diversity failed for ${diversityFailures.join(", ")} across ${PROGRAM_VARIETY_PROBE_SEEDS} seeds`);
  }
  throw new Error(parts.join("; "));
}
