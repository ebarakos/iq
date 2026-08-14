import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("POST /api/generate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a fresh answer-free deterministic quiz with an opaque scoring token", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "generate-route-test" },
      body: JSON.stringify({ difficulty: "hard" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("procedural");
    expect(body.puzzles).toHaveLength(5);
    expect(body.quizToken).toMatch(/^v1\./);
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("rule");
      expect(puzzle).not.toHaveProperty("explanation");
      expect(puzzle.options.length).toBeGreaterThanOrEqual(4);
    }
  });
});
