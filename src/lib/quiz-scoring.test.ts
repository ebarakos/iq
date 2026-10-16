import { describe, expect, it } from "vitest";
import { scoreQuiz } from "./quiz-scoring";
import type { QuizTokenPayload } from "./quiz-token";

describe("quiz scoring", () => {
  it("scores accuracy only, with no points or speed bonus", () => {
    const quiz: QuizTokenPayload = {
      version: 1, issuedAt: 1000, expiresAt: 9000, answerDeadline: 2800,
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })),
    };
    for (const elapsedSeconds of [0, 1200, 1799]) {
      const result = scoreQuiz(quiz, Array<number>(30).fill(0), quiz.issuedAt + elapsedSeconds);
      expect(result).toMatchObject({ score: 30, elapsedSeconds, timedOut: false });
      expect(result).not.toHaveProperty("points");
    }
  });

  it("caps a late result's elapsed time at the time limit", () => {
    const quiz: QuizTokenPayload = {
      version: 1, issuedAt: 1000, expiresAt: 9000, answerDeadline: 2800,
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })),
    };
    for (const nowSeconds of [2800, 2805, 4000]) {
      expect(scoreQuiz(quiz, Array<number>(30).fill(0), nowSeconds)).toMatchObject({ elapsedSeconds: 1800, timedOut: true });
    }
    // The late marker still says how late the submission arrived.
    expect(scoreQuiz(quiz, Array<number>(30).fill(0), 4000)).toMatchObject({ late: true, secondsLate: 1200 });
  });

  it("uses the version sealed at issue time and preserves raw accuracy", () => {
    const quiz: QuizTokenPayload = {
      version: 1, appVersion: "v0.1.1", issuedAt: 1000, expiresAt: 9000, answerDeadline: 2800,
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })),
    };
    const result = scoreQuiz(quiz, Array.from({ length: 30 }, (_, i) => i < 28 ? 0 : 1), 2200);
    expect(result).toMatchObject({ score: 28, total: 30, elapsedSeconds: 1200, appVersion: "v0.1.1", late: false });
    delete quiz.appVersion;
    expect(scoreQuiz(quiz, new Array(30).fill(0), 2200).appVersion).toBeNull();
  });
});
