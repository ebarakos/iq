import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EXPANDED_GENERATOR_VERSION } from "@/items/expanded-quiz";

function generateRequest(body: Record<string, unknown>, from: string) {
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });
}

describe("POST /api/generate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves the 30-question test by default, answer-free and with an opaque token", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

    const response = await POST(generateRequest({}, "generate-route-default"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("experimental");
    expect(body.profile).toBe("long-30");
    expect(body.generatorVersion).toBe(EXPANDED_GENERATOR_VERSION);
    expect(body.notice).toMatch(/still being tested/);
    expect(body.puzzles).toHaveLength(30);
    expect(body.quizToken).toMatch(/^v1\./);
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("rule");
      expect(puzzle).not.toHaveProperty("explanation");
      expect(puzzle.options.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("returns the answer deadline beside the opaque token", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

    const before = Math.floor(Date.now() / 1000);
    const body = await (await POST(generateRequest({ profile: "short-5" }, "deadline-short"))).json();

    expect(body.secondsPerQuestion).toBe(60);
    // Five questions at a minute each, measured from when the server issued it.
    expect(body.answerDeadline).toBeGreaterThanOrEqual(before + 300);
    expect(body.answerDeadline).toBeLessThanOrEqual(before + 305);
  });

  it("serves the 5-question test when it is asked for", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

    const response = await POST(generateRequest({ profile: "short-5" }, "generate-route-short"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toBe("short-5");
    expect(body.source).toBe("experimental");
    expect(body.puzzles).toHaveLength(5);
    expect(new Set(body.puzzles.map((puzzle: { familyId?: string }) => puzzle.familyId)).size).toBe(5);
  });

  it("labels both lengths as experimental", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST } = await import("./route");

    const short = await (await POST(generateRequest({ profile: "short-5" }, "notice-short"))).json();
    const long = await (await POST(generateRequest({ profile: "long-30" }, "notice-long"))).json();

    expect(short.notice).toMatch(/still being tested/);
    expect(long.notice).toMatch(/still being tested/);
  });

  it.each([
    ["short-5", 5],
    ["long-30", 30],
  ] as const)("falls back to the bank for %s when assembly fails", async (profile, expectedCount) => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    vi.doMock("@/items/expanded-quiz", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/items/expanded-quiz")>()),
      assembleExpandedQuiz: vi.fn(() => {
        throw new Error("forced fail");
      }),
    }));
    const { POST } = await import("./route");

    const response = await POST(generateRequest({ profile }, `generate-route-fallback-${profile}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("fallback");
    expect(body.notice).toMatch(/verified reference set/);
    expect(body.puzzles).toHaveLength(expectedCount);
    expect(body.puzzles.some((puzzle: { type?: string }) => puzzle.type === "operatorInduction")).toBe(false);
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("rule");
      expect(puzzle).not.toHaveProperty("explanation");
    }
    vi.doUnmock("@/items/expanded-quiz");
  });
});
