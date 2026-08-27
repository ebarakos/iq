import { describe, expect, it } from "vitest";
import { LLM_RULE_PROPOSAL_FLAG, proposeValidatedSceneRule } from "./llm-rule-proposal";

describe("LLM rule proposal experiment", () => {
  it("is disabled unless the explicit development flag is set", async () => {
    await expect(proposeValidatedSceneRule(undefined, {})).rejects.toThrow(
      `${LLM_RULE_PROPOSAL_FLAG}=1`,
    );
  });

  it("retries bounded invalid responses and then uses deterministic pure-code fallback", async () => {
    const result = await proposeValidatedSceneRule(undefined, { ENABLE_LLM_RULE_PROPOSALS: "1" }, {
      maxAttempts: 2,
      fallbackSeed: "fixed_fallback_seed",
      requestText: async () => ({ text: "not json", inputTokens: 4, outputTokens: 2 }),
    });
    expect(result).toMatchObject({
      source: "procedural-fallback",
      attempts: 2,
      inputTokens: 8,
      outputTokens: 4,
      replayKey: expect.stringMatching(/^[a-f0-9]{24}$/),
    });
    expect(result.rejectionReasons).toHaveLength(2);
  });

  it("accepts only a strict proposal and records retry provenance", async () => {
    const result = await proposeValidatedSceneRule(undefined, { ENABLE_LLM_RULE_PROPOSALS: "1" }, {
      requestText: async (attempt) => ({
        text: attempt === 1 ? "{}" : JSON.stringify({
          version: "scene-rule-proposal-v1",
          familyId: "visual-set-algebra-v1",
          variationSeed: "model_seed_123",
          program: { kind: "set-algebra", operation: "exclusive" },
        }),
      }),
    });
    expect(result).toMatchObject({ source: "llm", attempts: 2, proposal: { program: { operation: "exclusive" } } });
    expect(result.rejectionReasons).toHaveLength(1);
  });
});
