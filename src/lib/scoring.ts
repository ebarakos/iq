import type { QuizTokenPayload, SubmissionTiming } from "./quiz-token";

/** What scoring needs to know about one question: its answer and its review. */
export type AnswerKeyItem = Pick<
  QuizTokenPayload["items"][number],
  "id" | "answerIndex" | "optionCount" | "explanation" | "familyId" | "band"
>;

/** One question's outcome, as the review screen shows it. */
export interface ScoredQuestion {
  id: string;
  chosen: number | null;
  answerIndex: number;
  correct: boolean;
  explanation: string;
  familyId?: string;
  band?: string;
}

export interface ScoreGroup {
  key: string;
  correct: number;
  attempted: number;
}

export interface ScoredTest {
  score: number;
  total: number;
  results: ScoredQuestion[];
  late: boolean;
  secondsLate: number;
  breakdown: { bands: ScoreGroup[]; families: ScoreGroup[] };
}

/** A submission that cannot be scored. The message is safe to show the taker. */
export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
  }
}

/**
 * Score a whole test on the server: the one scorer behind both the in-page
 * app (`POST /api/submit`) and the link test (`/t/<token>/result`).
 *
 * `answers` holds one entry per question, null for a skip. `timing` is the
 * server's own judgment of the deadline; a late test is still scored and
 * explained, and only the marker changes.
 */
export function scoreAnswers(
  items: readonly AnswerKeyItem[],
  answers: readonly (number | null)[],
  timing: SubmissionTiming,
): ScoredTest {
  if (answers.length !== items.length) {
    throw new ScoringError("Submit one answer for every question.");
  }
  const invalidChoice = answers.some(
    (answer, index) => answer !== null && (answer < 0 || answer >= items[index].optionCount),
  );
  if (invalidChoice) {
    throw new ScoringError("An answer is outside the available options.");
  }

  const results = items.map((item, index): ScoredQuestion => {
    const chosen = answers[index];
    return {
      id: item.id,
      chosen,
      answerIndex: item.answerIndex,
      correct: chosen === item.answerIndex,
      explanation: item.explanation,
      familyId: item.familyId,
      band: item.band,
    };
  });
  const summarize = (field: "familyId" | "band"): ScoreGroup[] => {
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
    score: results.filter((result) => result.correct).length,
    total: results.length,
    results,
    late: timing.late,
    secondsLate: timing.secondsLate,
    breakdown: { bands: summarize("band"), families: summarize("familyId") },
  };
}
