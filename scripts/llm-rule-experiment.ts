import { performance } from "node:perf_hooks";
import { materializeSceneRuleProposal, type SceneRuleProposal } from "../src/items/scene-proposal";
import { proposeValidatedSceneRule, type LlmRuleProposalResult } from "../src/lib/llm-rule-proposal";

const samplesArg = process.argv.find((argument) => argument.startsWith("--samples="));
const samples = Number(samplesArg?.split("=")[1] ?? 12);
if (!Number.isInteger(samples) || samples < 1 || samples > 100) {
  throw new Error("--samples must be an integer from 1 to 100");
}
if (process.env.ENABLE_LLM_RULE_PROPOSALS !== "1") {
  throw new Error("ENABLE_LLM_RULE_PROPOSALS=1 is required");
}

const operations = ["union-left", "union-right", "intersection", "overlap-left", "overlap-right", "subtract", "mask-out", "exclusive"] as const;
const percentile = (values: readonly number[], fraction: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

const llmResults: LlmRuleProposalResult[] = [];
for (let index = 0; index < samples; index++) {
  llmResults.push(await proposeValidatedSceneRule(undefined, undefined, {
    maxAttempts: 2,
    fallbackSeed: `experiment_fallback_${index}`,
  }));
}

const proceduralLatencies: number[] = [];
const proceduralReplayKeys = new Set<string>();
for (let index = 0; index < samples; index++) {
  const proposal: SceneRuleProposal = {
    version: "scene-rule-proposal-v1",
    familyId: "visual-set-algebra-v1",
    variationSeed: `procedural_baseline_${index}`,
    program: { kind: "set-algebra", operation: operations[index % operations.length] },
  };
  const started = performance.now();
  const { candidate } = materializeSceneRuleProposal(proposal);
  proceduralLatencies.push(performance.now() - started);
  proceduralReplayKeys.add(candidate.definition.replayKey!(candidate.puzzle));
}

const llmAccepted = llmResults.filter((result) => result.source === "llm");
const llmLatencies = llmResults.map((result) => result.latencyMs);
const report = {
  experimentVersion: "scene-rule-proposal-v1",
  samples,
  llm: {
    acceptedProposalRate: llmAccepted.length / samples,
    fallbackRate: 1 - llmAccepted.length / samples,
    medianLatencyMs: percentile(llmLatencies, 0.5),
    p95LatencyMs: percentile(llmLatencies, 0.95),
    totalInputTokens: llmResults.reduce((total, result) => total + result.inputTokens, 0),
    totalOutputTokens: llmResults.reduce((total, result) => total + result.outputTokens, 0),
    costUsd: null,
    costNote: "The relay response does not provide normalized price data; use token totals with provider billing.",
    distinctVisualReplayKeys: new Set(llmResults.map((result) => result.replayKey)).size,
    distinctOperations: new Set(llmAccepted.map((result) => result.proposal.program.operation)).size,
    rejectionReasons: llmResults.flatMap((result) => result.rejectionReasons),
  },
  procedural: {
    acceptanceRate: 1,
    medianLatencyMs: percentile(proceduralLatencies, 0.5),
    p95LatencyMs: percentile(proceduralLatencies, 0.95),
    costUsd: 0,
    distinctVisualReplayKeys: proceduralReplayKeys.size,
    distinctOperations: Math.min(samples, operations.length),
  },
  novelty: {
    novelRuleStructures: 0,
    note: "The strict v1 grammar exposes the same four set operations to both paths; the model can vary selection and seed, not invent a new rule structure.",
  },
  pilotSolveQuality: null,
  pilotNote: "Join this report with separately collected human pilot aggregates; do not infer solve quality from code acceptance.",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
