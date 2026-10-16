import { describe, expect, it } from "vitest";
import { scoreQuiz } from "./quiz-scoring";
import { leaderboardPoints } from "./leaderboard-types";
import type { QuizTokenPayload } from "./quiz-token";

describe("leaderboard points", () => {
  it("always awards more points to more correct answers", () => {
    expect(leaderboardPoints(28)).toBe(2800);
    expect(leaderboardPoints(30)).toBe(3000);
    expect(leaderboardPoints(30)).toBeGreaterThan(leaderboardPoints(28));
    expect(leaderboardPoints(0)).toBe(0);
  });

  it("preserves elapsed time without adding a speed bonus", () => {
    const quiz: QuizTokenPayload = {
      version: 1, issuedAt: 1000, expiresAt: 9000, answerDeadline: 2800,
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })),
    };
    for (const elapsedSeconds of [0, 1200, 1800, 1900]) {
      expect(scoreQuiz(quiz, Array<number>(30).fill(0), quiz.issuedAt + elapsedSeconds))
        .toMatchObject({ score: 30, points: 3000, elapsedSeconds });
    }
  });

  it("uses the version sealed at issue time and preserves raw accuracy", () => {
    const quiz: QuizTokenPayload = {
      version: 1, appVersion: "v0.1.1", issuedAt: 1000, expiresAt: 9000, answerDeadline: 2800,
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })),
    };
    const result = scoreQuiz(quiz, Array.from({ length: 30 }, (_, i) => i < 28 ? 0 : 1), 2200);
    expect(result).toMatchObject({ score: 28, total: 30, points: 2800, elapsedSeconds: 1200, appVersion: "v0.1.1", late: false });
    delete quiz.appVersion;
    expect(scoreQuiz(quiz, new Array(30).fill(0), 2200).appVersion).toBeNull();
  });
});
