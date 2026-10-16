import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toPublicPuzzleSet } from "@/items/schema";
import { createLinkTest, sealLinkToken } from "@/lib/link-test";
import { GRACE_WINDOW_SECONDS } from "@/lib/quiz-token";
import { POST } from "./route";

const storage = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("@/lib/redis", () => ({
  redisCommand: vi.fn(async (command: (string | number)[]) => {
    const key = String(command[1]);
    if (command[0] === "GET") return storage.values.get(key) ?? null;
    if (command[0] === "SET") {
      if (storage.values.has(key)) return null;
      storage.values.set(key, String(command[2]));
      return "OK";
    }
    throw new Error("Unexpected Redis command");
  }),
}));

const SECRET = "test-only-submit-route-secret-with-at-least-32-characters";

/** A real test, as `/api/generate` would start it, sealed under the test secret. */
function freshTest(seed: string, options: { profile?: "short-5" | "long-30"; nowSeconds?: number } = {}) {
  return createLinkTest(options.profile ?? "short-5", {
    secret: SECRET, seed, nowSeconds: options.nowSeconds, withdrawnFamilyIds: new Set(),
  });
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/submit", () => {
  beforeEach(() => {
    storage.values.clear();
    vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("marks a submission late after the grace window and skips answers with no on-time record", async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const { token: quizToken, test, puzzles } = freshTest("submit-route-late", { nowSeconds: issuedAt });
    const answers = puzzles.map((puzzle) => puzzle.answerIndex);

    const onTime = await (await POST(request({ quizToken, answers }))).json();
    expect(onTime.late).toBe(false);
    expect(onTime.secondsLate).toBe(0);
    expect(onTime.score).toBe(puzzles.length);

    // Move the clock past the deadline and its grace window.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((test.answerDeadline + GRACE_WINDOW_SECONDS + 30) * 1000);
    // A fresh token is needed: an identical retry retains its first timing.
    const lateToken = sealLinkToken(test, SECRET);
    const late = await (await POST(request({ quizToken: lateToken, answers }))).json();
    vi.useRealTimers();

    expect(late.late).toBe(true);
    expect(late.secondsLate).toBe(GRACE_WINDOW_SECONDS + 30);
    expect(late.timedOut).toBe(true);
    expect(late.score).toBe(0);
    expect(late.results.every((result: { chosen: number | null }) => result.chosen === null)).toBe(true);
    expect(late.results).toHaveLength(puzzles.length);
  });

  it("scores on the server and returns review data without the hidden rules", async () => {
    const { token: quizToken, puzzles } = freshTest("submit-route-test");
    const answers = puzzles.map((puzzle, index) => index === 0 ? null : puzzle.answerIndex);

    const response = await POST(request({ quizToken, answers }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.score).toBe(puzzles.length - 1);
    expect(body.total).toBe(5);
    expect(body.results).toHaveLength(5);
    expect(body.results[0]).toMatchObject({
      id: puzzles[0].id,
      chosen: null,
      answerIndex: puzzles[0].answerIndex,
      correct: false,
      explanation: puzzles[0].explanation,
    });
    expect(JSON.stringify(body)).not.toContain('"rule"');
  });

  it("sends the full puzzles for the review only with a saved result, never into the receipt", async () => {
    const { token: quizToken, puzzles } = freshTest("submit-route-review");
    const body = await (await POST(request({ quizToken, answers: puzzles.map(() => null) }))).json();
    expect(body.puzzles).toEqual(toPublicPuzzleSet(puzzles));
    const [receipt] = [...storage.values.values()];
    expect(receipt).not.toContain('"stem"');

    const conflict = await (await POST(request({ quizToken, answers: puzzles.map(() => 0) }))).json();
    expect(conflict).not.toHaveProperty("puzzles");
  });

  it("scores a 30-question test without points when the leaderboard is disabled", async () => {
    vi.stubEnv("LEADERBOARD_ENABLED", "false");
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuedAt = Math.floor(Date.now() / 1000);
    const { token: quizToken, puzzles } = freshTest("submit-points-without-leaderboard", {
      profile: "long-30", nowSeconds: issuedAt,
    });
    const answers = puzzles.map((puzzle, index) => index < 29 ? puzzle.answerIndex : null);
    vi.setSystemTime((issuedAt + 1200) * 1000);

    const response = await POST(request({ quizToken, answers }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ score: 29, total: 30, elapsedSeconds: 1200, leaderboardEligible: false });
    expect(result).not.toHaveProperty("points");
  });

  it("rejects malformed, incomplete, and out-of-range submissions", async () => {
    const { token: quizToken, puzzles } = freshTest("submit-route-validation");

    expect((await POST(request({ answers: [] }))).status).toBe(400);
    expect((await POST(request({ quizToken, answers: [null] }))).status).toBe(400);
    const outOfRange = await POST(request({
      quizToken,
      answers: puzzles.map((_, index) => index === 2 ? 99 : null),
    }));
    expect(outOfRange.status).toBe(400);
    await expect(outOfRange.json()).resolves.toEqual({ message: "An answer is outside the available options." });
  });

  it("checks answers before storage, so a malformed retry is a 400, not a conflict or outage", async () => {
    const { redisCommand } = await import("@/lib/redis");
    vi.mocked(redisCommand).mockClear();
    const { token: quizToken, puzzles } = freshTest("submit-route-validation-order");

    expect((await POST(request({ quizToken, answers: [null] }))).status).toBe(400);
    expect(redisCommand).not.toHaveBeenCalled();
    expect((await POST(request({ quizToken, answers: puzzles.map(() => null) }))).status).toBe(200);
    expect((await POST(request({ quizToken, answers: [null] }))).status).toBe(400);
  });

  it("reports separate family and band subtotals", async () => {
    const { token: quizToken, puzzles } = freshTest("submit-route-breakdown");
    const body = await (await POST(request({ quizToken, answers: puzzles.map((puzzle) => puzzle.answerIndex) }))).json();
    const counts = (field: "familyId" | "band") => {
      const groups = new Map<string, number>();
      for (const puzzle of puzzles) groups.set(puzzle[field]!, (groups.get(puzzle[field]!) ?? 0) + 1);
      return [...groups].map(([key, count]) => ({ key, correct: count, attempted: count }));
    };
    expect(body.breakdown).toEqual({ bands: counts("band"), families: counts("familyId") });
  });

  it("rejects a tampered token", async () => {
    const { token: quizToken, puzzles } = freshTest("submit-route-tamper");
    const replacement = quizToken.endsWith("A") ? "B" : "A";
    const tampered = `${quizToken.slice(0, -1)}${replacement}`;

    const response = await POST(request({ quizToken: tampered, answers: puzzles.map(() => null) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "This quiz token is invalid. Start a new test.",
    });
  });

  it("refuses a test the site can no longer rebuild", async () => {
    const { token: quizToken, test, puzzles } = freshTest("submit-route-changed");
    const older = sealLinkToken({ ...test, generatorVersion: "scene-families-v1" }, SECRET);
    const response = await POST(request({ quizToken: older, answers: puzzles.map(() => null) }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/^This quiz has changed/);
    expect(quizToken).not.toBe(older);
  });

  it("keeps the first result and timing on an identical retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { token: quizToken, puzzles } = freshTest("submit-retry");
    const answers = puzzles.map((puzzle) => puzzle.answerIndex);
    vi.setSystemTime(Date.now() + 60_000);
    const first = await (await POST(request({ quizToken, answers }))).json();
    vi.setSystemTime(Date.now() + 600_000);
    const retry = await (await POST(request({ quizToken, answers }))).json();
    expect(retry).toEqual(first);
    expect(retry.elapsedSeconds).toBe(60);
  });

  it("rejects answer-key replay and simultaneous conflicting submissions", async () => {
    const { token: quizToken, puzzles } = freshTest("submit-replay");
    const blanks = puzzles.map(() => null);
    const correct = puzzles.map((puzzle) => puzzle.answerIndex);
    const responses = await Promise.all([
      POST(request({ quizToken, answers: blanks })),
      POST(request({ quizToken, answers: correct })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 409]);
    expect((await responses[0].json()).score).toBe(0);
    const replay = await POST(request({ quizToken, answers: correct }));
    expect(replay.status).toBe(409);
    expect(await replay.json()).not.toHaveProperty("results");
  });

  it("reveals no answers if storing the first submission fails", async () => {
    const { redisCommand } = await import("@/lib/redis");
    vi.mocked(redisCommand).mockRejectedValueOnce(new Error("Redis unavailable"));
    const { token: quizToken, puzzles } = freshTest("submit-storage-failure");
    const response = await POST(request({ quizToken, answers: puzzles.map(() => null) }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("results");
    // The failed attempt did not consume the token.
    expect((await POST(request({ quizToken, answers: puzzles.map(() => null) }))).status).toBe(200);
  });
});
