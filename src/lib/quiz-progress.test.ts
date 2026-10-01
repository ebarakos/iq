import { describe, expect, it } from "vitest";
import {
  countUnansweredAnswers,
  needsBlankSubmissionConfirmation,
  parseStoredSession,
  serverClockOffsetSeconds,
  type StoredSession,
} from "./quiz-progress";

describe("the countdown's server clock", () => {
  it("never runs behind the server however slowly the start response travels", () => {
    // Codex's review of 2026-09-30: `serverNow` is stamped before the response
    // travels, so pairing it with the arrival left a 15-second response 15
    // seconds behind the server — past the 10-second scoring grace.
    const serverAheadBy = 50; // the device clock is 50 s slow
    const sentAtMs = 1_000_000_000_000;
    for (const { uploadMs, assemblyMs, downloadMs } of [
      { uploadMs: 100, assemblyMs: 600, downloadMs: 15_000 },
      { uploadMs: 15_000, assemblyMs: 600, downloadMs: 100 },
      { uploadMs: 80, assemblyMs: 400, downloadMs: 120 },
    ]) {
      const stampedAtMs = sentAtMs + uploadMs + assemblyMs;
      const serverNow = Math.floor(stampedAtMs / 1000) + serverAheadBy;
      const arrivedAtMs = stampedAtMs + downloadMs;
      const offset = serverClockOffsetSeconds(serverNow, sentAtMs);
      const estimatedServerAtArrival = arrivedAtMs / 1000 + offset;
      const trueServerAtArrival = arrivedAtMs / 1000 + serverAheadBy;
      const roundTrip = (arrivedAtMs - sentAtMs) / 1000;
      // Never behind by more than the server's own whole-second stamp, never
      // ahead by more than the round trip.
      expect(estimatedServerAtArrival).toBeGreaterThan(trueServerAtArrival - 1);
      expect(estimatedServerAtArrival).toBeLessThanOrEqual(trueServerAtArrival + roundTrip);
    }
  });
});

const saved: StoredSession<{ id: string }, { score: number }, { profile: string }> = {
  phase: "result",
  puzzles: [{ id: "a" }, { id: "b" }],
  answers: [0, null],
  current: 1,
  meta: { profile: "short-5" },
  quizToken: "v1.token",
  answerDeadline: 1_900_000_000,
  clockOffset: -3,
  wasAutomaticSubmit: true,
  review: { score: 1 },
};

describe("saved test sessions", () => {
  it("hands back every field after a reload, the time-up flag included", () => {
    // Regression: the result screen said "Time ran out" before a reload and
    // not after it, because the flag was never saved.
    expect(parseStoredSession(JSON.stringify(saved))).toEqual(saved);
  });

  it("reads sessions saved before a field existed as that field's default", () => {
    const old: Record<string, unknown> = { ...saved };
    delete old.wasAutomaticSubmit;
    delete old.clockOffset;
    const restored = parseStoredSession(JSON.stringify(old));
    expect(restored?.wasAutomaticSubmit).toBe(false);
    expect(restored?.clockOffset).toBe(0);
  });

  it("refuses malformed sessions instead of restoring half of one", () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession("{not json")).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...saved, wasAutomaticSubmit: "yes" }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...saved, answers: [0] }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...saved, current: 2 }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...saved, review: null }))).toBeNull();
  });
});

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
