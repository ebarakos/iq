import { submissionTiming, type QuizTokenPayload } from "./quiz-token";
import { scoreAnswers } from "./scoring";

/** Pure scoring that throws `ScoringError` on malformed answers; callers persist the first result before revealing it. */
export function scoreQuiz(quiz: QuizTokenPayload, answers: readonly (number | null)[], nowSeconds: number) {
  const scored = scoreAnswers(quiz.items, answers, submissionTiming(quiz, nowSeconds));
  // Answers stop counting at the deadline, so a late result used the whole time limit,
  // however long after it the taker opened the result.
  const elapsedSeconds = Math.min(Math.max(0, nowSeconds - quiz.issuedAt), quiz.answerDeadline - quiz.issuedAt);
  return {
    ...scored,
    timedOut: nowSeconds >= quiz.answerDeadline,
    elapsedSeconds,
    appVersion: quiz.appVersion ?? null,
  };
}
