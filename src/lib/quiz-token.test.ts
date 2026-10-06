import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleExpandedQuiz } from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "@/items/family-promotion";
import packageJson from "../../package.json";
import {
  ACCEPTED_ITEM_COUNTS,
  createQuizDelivery,
  GRACE_WINDOW_SECONDS,
  openQuizToken,
  QuizTokenError,
  QuizTokenPayloadSchema,
  resolveQuizTokenSecret,
  SECONDS_PER_QUESTION,
  submissionTiming,
} from "./quiz-token";

const SECRET = "test-only-quiz-token-secret-with-at-least-32-characters";

function quiz() {
  return assembleExpandedQuiz("quiz-token-test-seed", "short-5", CURRENT_FAMILY_PROMOTION_REGISTRY);
}

function payloadWith(itemCount: number) {
  return {
    version: 1 as const,
    issuedAt: 1_000,
    expiresAt: 2_000,
    answerDeadline: 1_500,
    items: new Array(itemCount).fill(null).map((_, index) => ({
      id: `item-${index}`,
      answerIndex: 0,
      optionCount: 4,
      explanation: "a placeholder explanation",
    })),
  };
}

describe("quiz token delivery", () => {
  it("carries a full 30-question test", () => {
    const long = assembleExpandedQuiz("token-long-30", "long-30", CURRENT_FAMILY_PROMOTION_REGISTRY);
    const delivery = createQuizDelivery(long, { secret: SECRET, nowSeconds: 1_000 });

    expect(delivery.puzzles).toHaveLength(30);
    expect(openQuizToken(delivery.quizToken, SECRET, 1_001).items).toHaveLength(30);
  });

  it("sets the answer deadline at 60 seconds a question, apart from the token's own expiry", () => {
    const long = assembleExpandedQuiz("token-deadline", "long-30", CURRENT_FAMILY_PROMOTION_REGISTRY);
    const delivery = createQuizDelivery(long, { secret: SECRET, nowSeconds: 1_000 });

    expect(SECONDS_PER_QUESTION).toBe(60);
    expect(delivery.answerDeadline).toBe(1_000 + 30 * 60);

    const payload = openQuizToken(delivery.quizToken, SECRET, 1_001);
    expect(payload.appVersion).toBe(`v${packageJson.version}`);
    expect(delivery.appVersion).toBe(payload.appVersion);
    expect(payload.answerDeadline).toBe(delivery.answerDeadline);
    // The two values answer different questions and must not be the same one.
    expect(payload.expiresAt).toBeGreaterThan(payload.answerDeadline!);
  });

  it("refuses to issue a deadline that outlives the token", () => {
    expect(() => createQuizDelivery(quiz(), { secret: SECRET, nowSeconds: 1_000, ttlSeconds: 60 }))
      .toThrow(/answer deadline must fall inside the token lifetime/);
  });

  it("treats the grace window as ordinary and marks anything later", () => {
    const delivery = createQuizDelivery(quiz(), { secret: SECRET, nowSeconds: 1_000 });
    const payload = openQuizToken(delivery.quizToken, SECRET, 1_001);
    const deadline = payload.answerDeadline!;

    expect(submissionTiming(payload, deadline - 1)).toEqual({ late: false, secondsLate: 0 });
    expect(submissionTiming(payload, deadline)).toEqual({ late: false, secondsLate: 0 });
    expect(submissionTiming(payload, deadline + GRACE_WINDOW_SECONDS))
      .toEqual({ late: false, secondsLate: 0 });
    expect(submissionTiming(payload, deadline + GRACE_WINDOW_SECONDS + 1))
      .toEqual({ late: true, secondsLate: GRACE_WINDOW_SECONDS + 1 });
  });

  it("accepts the two current lengths, and nothing else", () => {
    expect([...ACCEPTED_ITEM_COUNTS]).toEqual([5, 30]);
    for (const count of ACCEPTED_ITEM_COUNTS) {
      expect(QuizTokenPayloadSchema.safeParse(payloadWith(count)).success).toBe(true);
    }
    for (const count of [0, 4, 6, 12, 13, 29, 31]) {
      expect(QuizTokenPayloadSchema.safeParse(payloadWith(count)).success).toBe(false);
    }
  });

  it("serves an answer-free DTO and recovers its answer key only from the token", () => {
    const canonical = quiz();
    const delivery = createQuizDelivery(canonical, {
      secret: SECRET,
      nowSeconds: 1_000,
      ttlSeconds: 600,
    });

    expect(delivery.puzzles).toHaveLength(5);
    for (const puzzle of delivery.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("rule");
      expect(puzzle).not.toHaveProperty("explanation");
      expect(puzzle).not.toHaveProperty("generation");
    }
    // Neither field names nor answer explanations are visible in an opaque token.
    expect(delivery.quizToken).not.toContain("answerIndex");
    expect(delivery.quizToken).not.toContain(canonical[0].explanation);

    const payload = openQuizToken(delivery.quizToken, SECRET, 1_001);
    expect(payload.items.map((item) => item.answerIndex)).toEqual(
      canonical.map((puzzle) => puzzle.answerIndex),
    );
  });

  it("uses a fresh nonce so the same quiz does not produce the same token", () => {
    const canonical = quiz();
    const first = createQuizDelivery(canonical, { secret: SECRET, nowSeconds: 1_000 });
    const second = createQuizDelivery(canonical, { secret: SECRET, nowSeconds: 1_000 });
    expect(first.quizToken).not.toBe(second.quizToken);
  });

  it("rejects tampering and the wrong secret", () => {
    const { quizToken } = createQuizDelivery(quiz(), { secret: SECRET, nowSeconds: 1_000 });
    const replacement = quizToken.endsWith("A") ? "B" : "A";
    const tampered = `${quizToken.slice(0, -1)}${replacement}`;

    expect(() => openQuizToken(tampered, SECRET, 1_001)).toThrowError(QuizTokenError);
    expect(() => openQuizToken(quizToken, `${SECRET}-wrong`, 1_001)).toThrowError(QuizTokenError);
  });

  it("rejects expired tokens", () => {
    const { quizToken } = createQuizDelivery(quiz(), {
      secret: SECRET,
      nowSeconds: 1_000,
      ttlSeconds: 10,
      secondsPerQuestion: 1,
    });

    try {
      openQuizToken(quizToken, SECRET, 1_010);
      throw new Error("expected token to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(QuizTokenError);
      expect((error as QuizTokenError).code).toBe("expired");
    }
  });
});

describe("quiz token configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires a strong configured secret in production", () => {
    expect(() => resolveQuizTokenSecret({ NODE_ENV: "production" })).toThrow(
      "QUIZ_TOKEN_SECRET is required in production",
    );
    expect(() => resolveQuizTokenSecret({
      NODE_ENV: "production",
      QUIZ_TOKEN_SECRET: "too-short",
    })).toThrow("at least 32 characters");
  });

  it("accepts a strong configured secret", () => {
    expect(resolveQuizTokenSecret({
      NODE_ENV: "production",
      QUIZ_TOKEN_SECRET: SECRET,
    })).toBe(SECRET);
  });
});
