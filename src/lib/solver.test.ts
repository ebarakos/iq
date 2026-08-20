import { describe, expect, it } from "vitest";
import { parseAnswerLetter, SOLVER_PROMPT_VERSION } from "./solver";
import { AttemptFileSchema } from "./attempts";

describe("parseAnswerLetter", () => {
  it("parses an exact single uppercase letter", () => {
    expect(parseAnswerLetter("C", 4)).toBe(2);
    expect(parseAnswerLetter("A", 4)).toBe(0);
  });

  it("parses a lowercase letter", () => {
    expect(parseAnswerLetter("b", 4)).toBe(1);
  });

  it("ignores surrounding whitespace on an exact letter", () => {
    expect(parseAnswerLetter("  D \n", 4)).toBe(3);
  });

  it("parses an 'Answer: C' declaration", () => {
    expect(parseAnswerLetter("Answer: C", 4)).toBe(2);
    expect(parseAnswerLetter("The answer is B.", 4)).toBe(1);
  });

  it("parses a letter embedded in a sentence (first standalone token)", () => {
    expect(parseAnswerLetter("I think it's D because the count increases.", 4)).toBe(3);
  });

  it("parses 'A) because…' as A", () => {
    expect(parseAnswerLetter("A) because the others are squares", 4)).toBe(0);
  });

  it("accepts F when optionCount is 6", () => {
    expect(parseAnswerLetter("F", 6)).toBe(5);
  });

  it("returns null for an out-of-range letter", () => {
    expect(parseAnswerLetter("F", 4)).toBeNull(); // only A–D valid
    expect(parseAnswerLetter("E", 4)).toBeNull();
  });

  it("returns null for garbage with no A–F token", () => {
    expect(parseAnswerLetter("hmm not sure, maybe 2 or 3?", 4)).toBeNull();
    expect(parseAnswerLetter("", 4)).toBeNull();
    expect(parseAnswerLetter("the zigzag goes up", 4)).toBeNull();
  });

  it("exposes a stable prompt version", () => {
    expect(SOLVER_PROMPT_VERSION).toBe("solver-v2");
  });
});

describe("AttemptFileSchema round-trip", () => {
  it("parses a synthetic artifact and rejects an invalid one", () => {
    const artifact = {
      runId: "2026-06-10T00-00-00.000Z-gpt-4o-mini-image",
      startedAt: "2026-06-10T00:00:00.000Z",
      provider: "openai",
      model: "gpt-4o-mini",
      channel: "image" as const,
      promptVersion: SOLVER_PROMPT_VERSION,
      attempts: [
        { itemId: "mx-abc123", chosen: 2, correct: true, latencyMs: 812, raw: "C", ts: "2026-06-10T00:00:01.000Z" },
        { itemId: "sq-def456", chosen: null, correct: false, latencyMs: 0, raw: "I'm not sure", ts: "2026-06-10T00:00:02.000Z" },
      ],
    };

    const parsed = AttemptFileSchema.parse(artifact);
    expect(parsed.attempts).toHaveLength(2);
    expect(parsed.attempts[0].chosen).toBe(2);
    expect(parsed.attempts[1].chosen).toBeNull();
    // Legacy artifacts remain valid without generation/budget/cost fields.
    expect(parsed.attempts[0].generation).toBeUndefined();
    expect(parsed.attempts[0].attemptBudget).toBeUndefined();
    expect(parsed.attempts[0].costUsd).toBeUndefined();
    // Round-trips through JSON unchanged.
    expect(AttemptFileSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);

    // Invalid channel is rejected.
    expect(AttemptFileSchema.safeParse({ ...artifact, channel: "audio" }).success).toBe(false);
    // raw over 200 chars is rejected.
    const longRaw = { ...artifact, attempts: [{ ...artifact.attempts[0], raw: "x".repeat(201) }] };
    expect(AttemptFileSchema.safeParse(longRaw).success).toBe(false);
  });

  it("round-trips optional generator bucket, attempt budget, and actual cost", () => {
    const artifact = {
      runId: "2026-08-13T00-00-00.000Z-vision-model-image",
      startedAt: "2026-08-13T00:00:00.000Z",
      provider: "provider",
      model: "vision-model",
      channel: "image" as const,
      promptVersion: SOLVER_PROMPT_VERSION,
      source: "generated" as const,
      profile: "long-30",
      runSeed: "probe-a",
      generatorVersion: "scene-families-v5",
      plannedAttempts: 1,
      completedAttempts: 1,
      status: "complete" as const,
      attempts: [{
        itemId: "gen-sequence-12345678",
        chosen: 1,
        correct: true,
        outcome: "correct" as const,
        latencyMs: 500,
        attemptBudget: 1,
        costUsd: 0.0012,
        generation: {
          generatorVersion: "procedural-v1",
          familyId: "sequence-transform-v1",
          programFingerprint: "0123456789abcdef",
          featureBucket: "procedural-v1|sequence-transform-v1|d3|c2|p1|a-count|w1|near-miss",
          features: {
            difficulty: 3,
            ruleComplexity: 2,
            programDepth: 1,
            activeDimensions: ["count"],
            usesWrap: true,
            distractorStrategy: "near-miss",
          },
        },
        raw: "B",
        ts: "2026-08-13T00:00:01.000Z",
      }],
    };

    expect(AttemptFileSchema.parse(artifact)).toEqual(artifact);
    expect(AttemptFileSchema.safeParse({
      ...artifact,
      attempts: [{ ...artifact.attempts[0], costUsd: -1 }],
    }).success).toBe(false);
    expect(AttemptFileSchema.safeParse({
      ...artifact,
      completedAttempts: 0,
    }).success).toBe(false);
    expect(AttemptFileSchema.safeParse({
      ...artifact,
      attempts: [{ ...artifact.attempts[0], correct: false, outcome: "correct" }],
    }).success).toBe(false);
  });
});
