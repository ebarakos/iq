import { submissionTiming, type QuizTokenPayload } from "./quiz-token";

/** Accuracy earns the base points; remaining time adds at most 25%. */
export function leaderboardPoints(correct: number, elapsedSeconds: number, budgetSeconds: number): number {
  const remaining = Math.max(0, Math.min(1, 1 - elapsedSeconds / budgetSeconds));
  return Math.round(100 * correct * (1 + 0.25 * remaining));
}

/** Pure scoring; callers validate answers and persist the first result before revealing it. */
export function scoreQuiz(quiz: QuizTokenPayload, answers: readonly (number | null)[], nowSeconds: number) {
  const results = quiz.items.map((item, index) => ({
    id: item.id,
    chosen: answers[index],
    answerIndex: item.answerIndex,
    correct: answers[index] === item.answerIndex,
    explanation: item.explanation,
    familyId: item.familyId,
    band: item.band,
  }));
  const score = results.filter((result) => result.correct).length;
  const elapsedSeconds = Math.max(0, nowSeconds - quiz.issuedAt);
  const timing = submissionTiming(quiz, nowSeconds);
  const summarize = (field: "familyId" | "band") => {
    const groups = new Map<string, { correct: number; attempted: number }>();
    for (const result of results) {
      const key = result[field];
      if (!key) continue;
      const group = groups.get(key) ?? { correct: 0, attempted: 0 };
      group.attempted++;
      group.correct += Number(result.correct);
      groups.set(key, group);
    }
    return [...groups].map(([key, value]) => ({ key, ...value }));
  };
  return {
    score,
    total: results.length,
    results,
    ...timing,
    elapsedSeconds,
    points: leaderboardPoints(score, elapsedSeconds, quiz.answerDeadline - quiz.issuedAt),
    appVersion: quiz.appVersion ?? null,
    breakdown: { bands: summarize("band"), families: summarize("familyId") },
  };
}
