import { submissionTiming, type QuizTokenPayload } from "./quiz-token";
import { scoreAnswers } from "./scoring";

/** Accuracy earns the base points; remaining time adds at most 25%. */
export function leaderboardPoints(correct: number, elapsedSeconds: number, budgetSeconds: number): number {
  const remaining = Math.max(0, Math.min(1, 1 - elapsedSeconds / budgetSeconds));
  return Math.round(100 * correct * (1 + 0.25 * remaining));
}

/** Pure scoring; callers validate answers and persist the first result before revealing it. */
export function scoreQuiz(quiz: QuizTokenPayload, answers: readonly (number | null)[], nowSeconds: number) {
  const scored = scoreAnswers(quiz.items, answers, submissionTiming(quiz, nowSeconds));
  const elapsedSeconds = Math.max(0, nowSeconds - quiz.issuedAt);
  return {
    ...scored,
    elapsedSeconds,
    points: leaderboardPoints(scored.score, elapsedSeconds, quiz.answerDeadline - quiz.issuedAt),
    appVersion: quiz.appVersion ?? null,
  };
}
