import { describe, expect, it } from "vitest";
import { countUnansweredAnswers, needsBlankSubmissionConfirmation } from "./quiz-progress";

describe("public test navigation", () => {
  it("counts questions that a taker can leave to revisit", () => {
    expect(countUnansweredAnswers([null, 2, null, 0])).toBe(2);
  });

  it("confirms only manual submissions that leave blanks", () => {
    expect(needsBlankSubmissionConfirmation([0, null], false)).toBe(true);
    expect(needsBlankSubmissionConfirmation([0, 1], false)).toBe(false);
    expect(needsBlankSubmissionConfirmation([0, null], true)).toBe(false);
  });
});
