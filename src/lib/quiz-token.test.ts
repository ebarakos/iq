import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_GENERATOR_VERSION, generateQuiz } from "@/items/generate";
import { createQuizDelivery, openQuizToken, QuizTokenError, resolveQuizTokenSecret } from "./quiz-token";

const SECRET = "test-only-quiz-token-secret-with-at-least-32-characters";

function quiz() {
  return generateQuiz("quiz-token-test-seed", CURRENT_GENERATOR_VERSION, "standard");
}

describe("quiz token delivery", () => {
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
