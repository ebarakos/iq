import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleExpandedQuiz } from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "@/items/family-promotion";
import { createQuizDelivery, GRACE_WINDOW_SECONDS } from "@/lib/quiz-token";
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

function freshQuiz(seed: string) {
  return assembleExpandedQuiz(seed, "short-5", CURRENT_FAMILY_PROMOTION_REGISTRY);
}

const SECRET = "test-only-submit-route-secret-with-at-least-32-characters";

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

  it("marks a submission late only after the grace window, and still scores it", async () => {
    const quiz = freshQuiz("submit-route-late");
    const issuedAt = Math.floor(Date.now() / 1000);
    const { quizToken, answerDeadline } = createQuizDelivery(quiz, { secret: SECRET, nowSeconds: issuedAt });
    const answers = quiz.map((puzzle) => puzzle.answerIndex);

    const onTime = await (await POST(request({ quizToken, answers }))).json();
    expect(onTime.late).toBe(false);
    expect(onTime.secondsLate).toBe(0);
    expect(onTime.score).toBe(quiz.length);

    // Move the clock past the deadline and its grace window.
    vi.useFakeTimers();
    vi.setSystemTime((answerDeadline + GRACE_WINDOW_SECONDS + 30) * 1000);
    // A fresh token is needed: an identical retry retains its first timing.
    const lateToken = createQuizDelivery(quiz, { secret: SECRET, nowSeconds: issuedAt }).quizToken;
    const late = await (await POST(request({ quizToken: lateToken, answers }))).json();
    vi.useRealTimers();

    expect(late.late).toBe(true);
    expect(late.secondsLate).toBe(GRACE_WINDOW_SECONDS + 30);
    // A late test is still scored and still explained; only the marker changes.
    expect(late.score).toBe(quiz.length);
    expect(late.results).toHaveLength(quiz.length);
  });

  it("scores on the server and returns review data without the hidden rules", async () => {
    const quiz = freshQuiz("submit-route-test");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const answers = quiz.map((puzzle, index) => index === 0 ? null : puzzle.answerIndex);

    const response = await POST(request({ quizToken, answers }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.score).toBe(quiz.length - 1);
    expect(body.total).toBe(5);
    expect(body.results).toHaveLength(5);
    expect(body.results[0]).toMatchObject({
      id: quiz[0].id,
      chosen: null,
      answerIndex: quiz[0].answerIndex,
      correct: false,
      explanation: quiz[0].explanation,
    });
    expect(JSON.stringify(body)).not.toContain('"rule"');
  });

  it("rejects malformed, incomplete, and out-of-range submissions", async () => {
    const quiz = freshQuiz("submit-route-validation");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });

    expect((await POST(request({ answers: [] }))).status).toBe(400);
    expect((await POST(request({ quizToken, answers: [null] }))).status).toBe(400);
    expect((await POST(request({
      quizToken,
      answers: quiz.map((_, index) => index === 2 ? 99 : null),
    }))).status).toBe(400);
  });

  it("reports separate family and band subtotals when the profile supplies them", async () => {
    const quiz = freshQuiz("submit-route-breakdown")
      .map((puzzle, index) => ({
        ...puzzle,
        familyId: index < 2 ? "family-a-v1" : "family-b-v1",
        band: index < 2 ? "warmup" as const : "composition" as const,
      }));
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const response = await POST(request({ quizToken, answers: quiz.map((puzzle) => puzzle.answerIndex) }));
    const body = await response.json();
    expect(body.breakdown).toEqual({
      bands: [
        { key: "warmup", correct: 2, attempted: 2 },
        { key: "composition", correct: 3, attempted: 3 },
      ],
      families: [
        { key: "family-a-v1", correct: 2, attempted: 2 },
        { key: "family-b-v1", correct: 3, attempted: 3 },
      ],
    });
  });

  it("rejects a tampered token", async () => {
    const quiz = freshQuiz("submit-route-tamper");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const replacement = quizToken.endsWith("A") ? "B" : "A";
    const tampered = `${quizToken.slice(0, -1)}${replacement}`;

    const response = await POST(request({ quizToken: tampered, answers: quiz.map(() => null) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "This quiz token is invalid. Start a new test.",
    });
  });

  it("keeps the first result and timing on an identical retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const quiz = freshQuiz("submit-retry");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const answers = quiz.map((puzzle) => puzzle.answerIndex);
    vi.setSystemTime(Date.now() + 60_000);
    const first = await (await POST(request({ quizToken, answers }))).json();
    vi.setSystemTime(Date.now() + 600_000);
    const retry = await (await POST(request({ quizToken, answers }))).json();
    expect(retry).toEqual(first);
    expect(retry.elapsedSeconds).toBe(60);
  });

  it("rejects answer-key replay and simultaneous conflicting submissions", async () => {
    const quiz = freshQuiz("submit-replay");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const blanks = quiz.map(() => null);
    const correct = quiz.map((puzzle) => puzzle.answerIndex);
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
    const quiz = freshQuiz("submit-storage-failure");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const response = await POST(request({ quizToken, answers: quiz.map(() => null) }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("results");
    // The failed attempt did not consume the token.
    expect((await POST(request({ quizToken, answers: quiz.map(() => null) }))).status).toBe(200);
  });
});
