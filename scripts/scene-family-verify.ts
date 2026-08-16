import { performance } from "node:perf_hooks";
import { seededRng } from "../src/lib/rng";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
} from "../src/items/scene-families";

const seedsArg = process.argv.find((argument) => argument.startsWith("--seeds="));
const seeds = Number(seedsArg?.split("=")[1] ?? 100);
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
  let rejected = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const started = performance.now();
    const first = generateSceneFamilyCandidate(familyId, seededRng("scene-family-verify-v1", `${familyId}:${seed}`));
    const replay = generateSceneFamilyCandidate(familyId, seededRng("scene-family-verify-v1", `${familyId}:${seed}`));
    const replayKey = first.definition.replayKey?.(first.puzzle);
    const replayMatches = replayKey !== undefined && replayKey === replay.definition.replayKey?.(replay.puzzle) &&
      JSON.stringify(first.puzzle) === JSON.stringify(replay.puzzle);
    const acceptance = validateSceneFamilyCandidate(first, replayKey);
    if (!acceptance.accepted || !replayMatches) rejected++;
    if (replayKey) replayKeys.add(replayKey);
    latencies.push(performance.now() - started);
  }
  failures += rejected;
  return {
    familyId,
    seeds,
    rejected,
    rejectionRate: rejected / seeds,
    distinctReplayKeys: replayKeys.size,
    medianMs: Number(percentile(latencies, 0.5).toFixed(3)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...latencies).toFixed(3)),
  };
});

process.stdout.write(`${JSON.stringify({ version: "scene-family-verify-v1", families }, null, 2)}\n`);
if (failures > 0) throw new Error(`${failures} scene-family candidates failed acceptance or replay`);
