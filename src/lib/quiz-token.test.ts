import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_ITEM_COUNTS,
  GRACE_WINDOW_SECONDS,
  QuizTokenPayloadSchema,
  resolveQuizTokenSecret,
  submissionTiming,
} from "./quiz-token";

const SECRET = "test-only-quiz-token-secret-with-at-least-32-characters";

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

describe("answer key", () => {
  it("treats the grace window as ordinary and marks anything later", () => {
    const deadline = payloadWith(5).answerDeadline;

    expect(submissionTiming({ answerDeadline: deadline }, deadline - 1)).toEqual({ late: false, secondsLate: 0 });
    expect(submissionTiming({ answerDeadline: deadline }, deadline)).toEqual({ late: false, secondsLate: 0 });
    expect(submissionTiming({ answerDeadline: deadline }, deadline + GRACE_WINDOW_SECONDS))
      .toEqual({ late: false, secondsLate: 0 });
    expect(submissionTiming({ answerDeadline: deadline }, deadline + GRACE_WINDOW_SECONDS + 1))
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
