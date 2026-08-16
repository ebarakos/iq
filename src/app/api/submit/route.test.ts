import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_GENERATOR_VERSION, generateQuiz } from "@/items/generate";
import { createQuizDelivery } from "@/lib/quiz-token";
import { POST } from "./route";

const SECRET = "test-only-submit-route-secret-with-at-least-32-characters";

function request(body: unknown): Request {
  return new Request("http://localhost/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/submit", () => {
  beforeEach(() => vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("scores on the server and returns review data without the hidden rules", async () => {
    const quiz = generateQuiz("submit-route-test", CURRENT_GENERATOR_VERSION, "standard");
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
    const quiz = generateQuiz("submit-route-validation", CURRENT_GENERATOR_VERSION, "easy");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });

    expect((await POST(request({ answers: [] }))).status).toBe(400);
    expect((await POST(request({ quizToken, answers: [null] }))).status).toBe(400);
    expect((await POST(request({
      quizToken,
      answers: quiz.map((_, index) => index === 2 ? 99 : null),
    }))).status).toBe(400);
  });

  it("reports separate family and band subtotals when the profile supplies them", async () => {
    const quiz = generateQuiz("submit-route-breakdown", CURRENT_GENERATOR_VERSION, "standard")
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
    const quiz = generateQuiz("submit-route-tamper", CURRENT_GENERATOR_VERSION, "hard");
    const { quizToken } = createQuizDelivery(quiz, { secret: SECRET });
    const replacement = quizToken.endsWith("A") ? "B" : "A";
    const tampered = `${quizToken.slice(0, -1)}${replacement}`;

    const response = await POST(request({ quizToken: tampered, answers: quiz.map(() => null) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "This quiz token is invalid. Start a new test.",
    });
  });
});
