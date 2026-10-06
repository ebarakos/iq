import { describe, expect, it } from "vitest";
import { leaderboardPoints, scoreQuiz } from "./quiz-scoring";
import type { QuizTokenPayload } from "./quiz-token";

describe("leaderboard points", () => {
  it("ranks 28/30 in 20 minutes above 30/30 in 30 minutes", () => {
    expect(leaderboardPoints(28, 1200, 1800)).toBe(3033);
    expect(leaderboardPoints(30, 1800, 1800)).toBe(3000);
    expect(leaderboardPoints(30, 1200, 1800)).toBe(3250);
  });

  it("bounds the bonus and never rewards zero correct or late time", () => {
    expect(leaderboardPoints(30, 0, 1800)).toBe(3750);
    expect(leaderboardPoints(30, -100, 1800)).toBe(3750);
    expect(leaderboardPoints(30, 1900, 1800)).toBe(3000);
    expect(leaderboardPoints(0, 0, 1800)).toBe(0);
  });

  it("uses the version sealed at issue time and preserves raw accuracy", () => {
    const quiz: QuizTokenPayload = {
      version: 1, appVersion: "v0.1.1", issuedAt: 1000, expiresAt: 9000, answerDeadline: 2800,
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })),
    };
    const result = scoreQuiz(quiz, Array.from({ length: 30 }, (_, i) => i < 28 ? 0 : 1), 2200);
    expect(result).toMatchObject({ score: 28, total: 30, points: 3033, elapsedSeconds: 1200, appVersion: "v0.1.1", late: false });
    delete quiz.appVersion;
    expect(scoreQuiz(quiz, new Array(30).fill(0), 2200).appVersion).toBeNull();
  });
});
