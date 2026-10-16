import { submissionTiming, type QuizTokenPayload } from "./quiz-token";
import { scoreAnswers } from "./scoring";
import { leaderboardPoints } from "./leaderboard-types";

/** Pure scoring that throws `ScoringError` on malformed answers; callers persist the first result before revealing it. */
export function scoreQuiz(quiz: QuizTokenPayload, answers: readonly (number | null)[], nowSeconds: number) {
  const scored = scoreAnswers(quiz.items, answers, submissionTiming(quiz, nowSeconds));
  const elapsedSeconds = Math.max(0, nowSeconds - quiz.issuedAt);
  return {
    ...scored,
    timedOut: nowSeconds >= quiz.answerDeadline,
    elapsedSeconds,
    points: leaderboardPoints(scored.score),
    appVersion: quiz.appVersion ?? null,
  };
}
