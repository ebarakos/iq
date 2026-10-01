/** Count answers a test taker has left blank. */
export function countUnansweredAnswers(answers: readonly (number | null)[]): number {
  return answers.filter((answer) => answer === null).length;
}

/** Automatic deadline submission never opens a confirmation dialog. */
export function needsBlankSubmissionConfirmation(
  answers: readonly (number | null)[],
  automatic: boolean,
): boolean {
  return !automatic && countUnansweredAnswers(answers) > 0;
}

/**
 * Everything a reload hands back, as the page saves it to sessionStorage. Every
 * field is required when saving, so a new piece of state cannot be left out of
 * the snapshot without a type error; `parseStoredSession` still accepts the
 * older sessions that predate a field.
 */
/**
 * How far the server's clock runs ahead of the browser's, in seconds, from the
 * `serverNow` of the response that started the test.
 *
 * The server stamped `serverNow` at some moment between the request leaving the
 * browser and the response arriving, and which moment is unknown. Pairing it
 * with the arrival (as the page did until 2026-09-30) put the countdown behind
 * the server by the whole transit time: a 15-second response left 15 seconds
 * on the clock after the sealed deadline, past the 10-second scoring grace.
 * Pairing it with the moment the request left instead can only put the
 * countdown ahead, so it may end early by at most one round trip (the start
 * request times out at 20 seconds) but never lets an automatic submission
 * arrive late. Milliseconds, so no whole second is lost to rounding here.
 */
export function serverClockOffsetSeconds(serverNow: number, requestSentAtMs: number): number {
  return serverNow - requestSentAtMs / 1000;
}

export interface StoredSession<Puzzle, Review, Meta> {
  phase: "active" | "result";
  puzzles: Puzzle[];
  answers: (number | null)[];
  current: number;
  meta: Meta | null;
  quizToken: string;
  answerDeadline: number | null;
  /** Server-minus-client clock offset, seconds. */
  clockOffset: number;
  /** Whether the result came from the automatic submission at time-up. */
  wasAutomaticSubmit: boolean;
  review: Review | null;
}

/**
 * Read a saved session back, or null when it is missing or malformed. The
 * puzzles and the review are the server's own JSON and are checked only for
 * shape. Fields added after a session was saved come back as their defaults.
 */
export function parseStoredSession<Puzzle, Review, Meta>(
  raw: string | null,
): StoredSession<Puzzle, Review, Meta> | null {
  if (!raw) return null;
  let s: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    s = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (s.phase !== "active" && s.phase !== "result") return null;
  if (!Array.isArray(s.puzzles) || s.puzzles.length === 0) return null;
  if (!Array.isArray(s.answers) || s.answers.length !== s.puzzles.length) return null;
  if (!s.answers.every((answer) => answer === null || Number.isInteger(answer))) return null;
  if (typeof s.current !== "number" || s.current < 0 || s.current >= s.puzzles.length) return null;
  if (typeof s.quizToken !== "string" || s.quizToken.length === 0) return null;
  if (s.answerDeadline != null && typeof s.answerDeadline !== "number") return null;
  if (s.clockOffset !== undefined && typeof s.clockOffset !== "number") return null;
  if (s.wasAutomaticSubmit !== undefined && typeof s.wasAutomaticSubmit !== "boolean") return null;
  if (s.phase === "result" && (!s.review || typeof s.review !== "object")) return null;
  return {
    phase: s.phase,
    puzzles: s.puzzles as Puzzle[],
    answers: s.answers as (number | null)[],
    current: s.current,
    meta: s.meta && typeof s.meta === "object" ? (s.meta as Meta) : null,
    quizToken: s.quizToken,
    answerDeadline: typeof s.answerDeadline === "number" ? s.answerDeadline : null,
    clockOffset: typeof s.clockOffset === "number" ? s.clockOffset : 0,
    wasAutomaticSubmit: s.wasAutomaticSubmit === true,
    review: s.review && typeof s.review === "object" ? (s.review as Review) : null,
  };
}
