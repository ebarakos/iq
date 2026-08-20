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
