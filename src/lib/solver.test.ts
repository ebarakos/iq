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
    expect(SOLVER_PROMPT_VERSION).toBe("solver-v3");
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

    // A run that asked for a moving default is recorded under the model that
    // answered, with the name it asked for kept beside it.
    const defaultRun = { ...artifact, provider: "codex", model: "gpt-6-astra", requestedModel: "default" };
    expect(AttemptFileSchema.parse(defaultRun).requestedModel).toBe("default");
    expect(AttemptFileSchema.parse(artifact).requestedModel).toBeUndefined();
    // Invalid channel is rejected; the options-only probe arm is a channel of its own.
    expect(AttemptFileSchema.safeParse({ ...artifact, channel: "audio" }).success).toBe(false);
    expect(AttemptFileSchema.safeParse({ ...artifact, channel: "options-only" }).success).toBe(true);
    // A whole reasoning reply fits; a transcript does not.
    const auditableRaw = { ...artifact, attempts: [{ ...artifact.attempts[0], raw: "x".repeat(2000) }] };
    expect(AttemptFileSchema.safeParse(auditableRaw).success).toBe(true);
    const longRaw = { ...artifact, attempts: [{ ...artifact.attempts[0], raw: "x".repeat(2001) }] };
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

describe("parseAnswerLetter on replies that reason before concluding", () => {
  // Regression for the 2026-08-23 probe: three of thirty-two replies were
  // recorded unparseable because the parser read only the first 200 characters.
  const analysis =
    "An analysis of the folding pattern reveals the following:\n\n" +
    "1. **Folding.** The sheet is folded along the vertical crease, so every punch " +
    "is mirrored to the opposite column when it opens. Option A keeps only one " +
    "punch, which cannot be right because opening a single fold always doubles " +
    "them. Option B doubles them but mirrors across the wrong axis, and option C " +
    "moves the punch instead of copying it.\n\n" +
    "2. **Conclusion.** Only one board keeps the original punch and adds its " +
    "mirror across the shown crease.\n\nAnswer: E";

  it("reads the conclusion instead of the first option it discusses", () => {
    expect(analysis.slice(0, 200)).not.toMatch(/\banswer\b/i);
    expect(parseAnswerLetter(analysis, 6)).toBe(4);
  });

  it("falls back to the last standalone letter when there is no 'Answer:' line", () => {
    expect(parseAnswerLetter("Option A is tempting, but the correct board is D", 6)).toBe(3);
  });

  it("still prefers a bare letter and still rejects out-of-range ones", () => {
    expect(parseAnswerLetter("  c  ", 6)).toBe(2);
    expect(parseAnswerLetter(analysis, 4)).toBeNull();
    expect(parseAnswerLetter("no letter here at all", 6)).toBeNull();
  });
});
