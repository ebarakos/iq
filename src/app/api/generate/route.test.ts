import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("POST /api/generate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a fresh answer-free deterministic quiz with an opaque scoring token", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

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

  it("returns the explicitly requested 12-question scene preview in development", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "generate-route-preview" },
      body: JSON.stringify({ mode: "expanded-preview" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("experimental");
    expect(body.generatorVersion).toBe("scene-preview-v2");
    expect(body.notice).toMatch(/still being tested/);
    expect(body.puzzles).toHaveLength(12);
    expect(new Set(body.puzzles.map((puzzle: { familyId?: string }) => puzzle.familyId)).size)
      .toBeGreaterThanOrEqual(6);
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("rule");
      expect(puzzle).not.toHaveProperty("explanation");
    }
  });

  it("does not expose the unpiloted preview in production without the explicit flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST } = await import("./route");

    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "generate-route-preview-prod" },
      body: JSON.stringify({ mode: "expanded-preview" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringMatching(/not enabled/) });
  });

  it("falls back to the bank when procedural generation fails", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    vi.doMock("@/items/generate", async () => ({
      CURRENT_GENERATOR_VERSION: "procedural-v2" as const,
      generateQuiz: vi.fn(() => {
        throw new Error("forced fail");
      }),
    }));
    const { POST } = await import("./route");

    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "generate-route-fallback" },
      body: JSON.stringify({ difficulty: "hard" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("fallback");
    expect(body.notice).toMatch(/verified reference set/);
    expect(body.puzzles).toHaveLength(5);
    expect(body.puzzles.some((puzzle: { type?: string }) => puzzle.type === "operatorInduction")).toBe(false);
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("rule");
      expect(puzzle).not.toHaveProperty("explanation");
    }
  });
});
