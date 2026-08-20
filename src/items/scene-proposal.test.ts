import { describe, expect, it } from "vitest";
import { OPTIONS_PER_ITEM } from "./schema";
import { materializeSceneRuleProposal, parseSceneRuleProposal } from "./scene-proposal";

const proposal = {
  version: "scene-rule-proposal-v1" as const,
  familyId: "visual-set-algebra-v1" as const,
  variationSeed: "proposal_seed_123",
  program: { kind: "set-algebra" as const, operation: "xor" as const },
};

describe("scene rule proposals", () => {
  it("parses only the strict bounded envelope", () => {
    expect(parseSceneRuleProposal(JSON.stringify(proposal))).toEqual(proposal);
    expect(parseSceneRuleProposal(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``)).toEqual(proposal);
    expect(parseSceneRuleProposal(JSON.stringify({ ...proposal, answerIndex: 0 }))).toBeNull();
    expect(parseSceneRuleProposal("Here is the answer: " + JSON.stringify(proposal))).toBeNull();
  });

  it("materializes visuals, answer, and distractors only through validated code", () => {
    const first = materializeSceneRuleProposal(proposal);
    const replay = materializeSceneRuleProposal(proposal);
    expect(first.acceptance.accepted).toBe(true);
    expect(first.candidate.puzzle).toEqual(replay.candidate.puzzle);
    expect(first.candidate.puzzle).not.toHaveProperty("generation");
    expect(first.candidate.puzzle.options).toHaveLength(OPTIONS_PER_ITEM);
  });
});
