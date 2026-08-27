import { generateText } from "ai";
import type { ModelOverrides } from "./relay-api-helpers";
import { relayModel, relayTimeoutMs } from "./model";
import {
  materializeSceneRuleProposal,
  parseSceneRuleProposal,
  type SceneRuleProposal,
} from "@/items/scene-proposal";
import { pick, seededRng } from "./rng";

export const LLM_RULE_PROPOSAL_FLAG = "ENABLE_LLM_RULE_PROPOSALS";

const SYSTEM_PROMPT = `You propose one bounded visual-reasoning rule as JSON.
You do not draw the puzzle and you do not choose its answer or distractors.
Pure code will materialize and exhaustively validate your proposal.`;

const USER_PROMPT = `Return exactly one JSON object with this shape:
{
  "version": "scene-rule-proposal-v1",
  "familyId": "visual-set-algebra-v1",
  "variationSeed": "8-64 ASCII letters, digits, underscore, or hyphen",
  "program": {
    "kind": "set-algebra",
    "operation": "union" | "intersection" | "subtract" | "xor"
  }
}

Choose an operation and a fresh variationSeed. Return JSON only.`;

export interface LlmRuleProposalResult {
  proposal: SceneRuleProposal;
  familyId: "visual-set-algebra-v1";
  replayKey: string;
  source: "llm" | "procedural-fallback";
  attempts: number;
  rejectionReasons: readonly string[];
  providerUsed: string | null;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RuleProposalExperimentOptions {
  maxAttempts?: number;
  fallbackSeed?: string;
  /** Test seam; production experiments omit it and call the configured relay. */
  requestText?: (attempt: number) => Promise<{ text: string; inputTokens?: number; outputTokens?: number }>;
}

function fallbackProposal(seed: string): SceneRuleProposal {
  const safeSeed = seed.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64).padEnd(8, "_");
  return {
    version: "scene-rule-proposal-v1",
    familyId: "visual-set-algebra-v1",
    variationSeed: safeSeed,
    program: {
      kind: "set-algebra",
      operation: pick(seededRng(safeSeed, "fallback-operation"), [
        "union-left",
        "union-right",
        "intersection",
        "overlap-left",
        "overlap-right",
        "subtract",
        "mask-out",
        "exclusive",
      ] as const),
    },
  };
}

/**
 * Development experiment only. The LLM proposes a strict program; pure code
 * constructs and accepts the actual item. The normal quiz route never calls it.
 */
export async function proposeValidatedSceneRule(
  overrides?: ModelOverrides,
  env: { ENABLE_LLM_RULE_PROPOSALS?: string } = {
    ENABLE_LLM_RULE_PROPOSALS: process.env.ENABLE_LLM_RULE_PROPOSALS,
  },
  options: RuleProposalExperimentOptions = {},
): Promise<LlmRuleProposalResult> {
  if (env.ENABLE_LLM_RULE_PROPOSALS !== "1") {
    throw new Error(`${LLM_RULE_PROPOSAL_FLAG}=1 is required for the LLM rule-proposal experiment`);
  }

  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("LLM rule proposals allow 1–3 attempts");
  }

  const started = performance.now();
  const rejectionReasons: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let modelId = overrides?.model ?? process.env.RELAY_MODEL ?? "unconfigured";
  let providerUsed: string | null = overrides?.provider ?? process.env.RELAY_PROVIDER ?? null;
  let relay: ReturnType<typeof relayModel> | null = null;

  if (!options.requestText) {
    try {
      relay = relayModel(overrides);
      modelId = relay.modelId;
    } catch (error) {
      rejectionReasons.push(error instanceof Error ? error.message : "relay configuration failed");
    }
  }

  for (let attempt = 1; attempt <= maxAttempts && (options.requestText || relay); attempt++) {
    attempts = attempt;
    try {
      const response = options.requestText
        ? await options.requestText(attempt)
        : await generateText({
            model: relay!.model,
            system: SYSTEM_PROMPT,
            prompt: USER_PROMPT,
            temperature: 0.7,
            maxRetries: 0,
            // 8s is the hosted fail-fast budget for this experiment; a Claude
            // Code / Codex turn takes minutes, so those get the harness budget.
            abortSignal: AbortSignal.timeout(relayTimeoutMs(relay!.provider, 8_000)),
          }).then((result) => ({
            text: result.text,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          }));
      inputTokens += response.inputTokens ?? 0;
      outputTokens += response.outputTokens ?? 0;
      const proposal = parseSceneRuleProposal(response.text);
      if (!proposal) {
        rejectionReasons.push(`attempt ${attempt}: response was not a valid bounded proposal`);
        continue;
      }
      const { candidate, acceptance } = materializeSceneRuleProposal(proposal);
      const replayKey = candidate.definition.replayKey?.(candidate.puzzle);
      if (!acceptance.accepted || !replayKey) {
        rejectionReasons.push(`attempt ${attempt}: proposal failed deterministic acceptance`);
        continue;
      }
      providerUsed = relay?.getProviderUsed() ?? providerUsed;
      return {
        proposal,
        familyId: proposal.familyId,
        replayKey,
        source: "llm",
        attempts,
        rejectionReasons,
        providerUsed,
        modelId,
        latencyMs: performance.now() - started,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      rejectionReasons.push(`attempt ${attempt}: ${error instanceof Error ? error.message : "proposal call failed"}`);
    }
  }

  const proposal = fallbackProposal(options.fallbackSeed ?? "procedural_fallback_v1");
  const { candidate } = materializeSceneRuleProposal(proposal);
  const replayKey = candidate.definition.replayKey?.(candidate.puzzle);
  if (!replayKey) throw new Error("procedural proposal fallback was not replayable");
  return {
    proposal,
    familyId: proposal.familyId,
    source: "procedural-fallback",
    attempts,
    rejectionReasons,
    replayKey,
    providerUsed,
    modelId,
    latencyMs: performance.now() - started,
    inputTokens,
    outputTokens,
  };
}
