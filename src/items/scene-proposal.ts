import { z } from "zod";
import { seededRng } from "../lib/rng";
import { generateProposedSetAlgebraCandidate, validateSceneFamilyCandidate } from "./scene-families";

/**
 * Strict development-only proposal envelope. The model chooses one bounded
 * program; it never supplies visuals, answers, distractors, or explanations.
 */
export const SceneRuleProposalSchema = z.object({
  version: z.literal("scene-rule-proposal-v1"),
  familyId: z.literal("visual-set-algebra-v1"),
  variationSeed: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  program: z.object({
    kind: z.literal("set-algebra"),
    operation: z.enum([
      "union-left",
      "union-right",
      "intersection",
      "overlap-left",
      "overlap-right",
      "subtract",
      "mask-out",
      "exclusive",
    ]),
  }).strict(),
}).strict();
export type SceneRuleProposal = z.infer<typeof SceneRuleProposalSchema>;

/** Parse a single JSON object, tolerating one fenced block but no prose fields. */
export function parseSceneRuleProposal(text: string): SceneRuleProposal | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)?.[1].trim();
  for (const candidate of [fenced, trimmed]) {
    if (!candidate) continue;
    try {
      const parsed = SceneRuleProposalSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next exact candidate. We deliberately do not scrape arbitrary prose.
    }
  }
  return null;
}

/**
 * Pure-code materialization and acceptance. A valid model response is only a
 * suggestion until this returns an accepted, mechanically solved candidate.
 */
export function materializeSceneRuleProposal(proposal: SceneRuleProposal) {
  const checked = SceneRuleProposalSchema.parse(proposal);
  const candidate = generateProposedSetAlgebraCandidate(
    checked.program.operation,
    seededRng(checked.variationSeed, checked.version),
  );
  const acceptance = validateSceneFamilyCandidate(candidate);
  if (!acceptance.accepted) {
    throw new Error(`proposed rule failed deterministic acceptance: ${acceptance.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { candidate, acceptance };
}
