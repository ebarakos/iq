import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EXPANDED_GENERATOR_VERSION } from "@/items/expanded-quiz";
import { loadLinkTest } from "@/lib/link-test";

const SECRET = "test-only-secret-that-is-at-least-32-characters-long";

/** Every key a served picture question may hold: layout and picture paths, never scene data. */
const PICTURE_KEYS = new Set(["layout", "gridFlow", "stem", "options", "blank", "board", "gate", "pieces", "right", "down"]);

/** Every key and string value anywhere in a served question. */
function walk(value: unknown, keys: Set<string>, strings: string[]): void {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((item) => walk(item, keys, strings));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      walk(item, keys, strings);
    }
  }
}
import { SCENE_FAMILY_IDS } from "@/items/scene-families";

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
    expect(body.source).toBe("generated");
    expect(body.profile).toBe("long-30");
    expect(body.generatorVersion).toBe(EXPANDED_GENERATOR_VERSION);
    expect(body).not.toHaveProperty("notice");
    expect(body.puzzles).toHaveLength(30);
    expect(body.quizToken).toMatch(/^l1\./);
    for (const puzzle of body.puzzles) expect(puzzle.options.length).toBeGreaterThanOrEqual(4);
  });

  it("serves pictures only: layout and picture paths, with no scene data before scoring", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
    vi.resetModules();
    const { POST } = await import("./route");

    const body = await (await POST(generateRequest({}, "generate-route-pictures"))).json();
    const keys = new Set<string>();
    const strings: string[] = [];
    walk(body.puzzles, keys, strings);
    expect([...keys].filter((key) => !PICTURE_KEYS.has(key))).toEqual([]);
    const layouts = new Set(["grid3x3", "row", "analogy", "machineTable", "assembly", "rows", "rowsAndColumns"]);
    for (const value of strings.filter((text) => !layouts.has(text))) {
      expect(value).toMatch(new RegExp(`^/t/${body.quizToken.replaceAll(".", "\\.")}/\\d+/board/[a-z0-9-]+\\.png$`));
    }
    // The pictures the page shows are the questions the token rebuilds.
    const { puzzles } = loadLinkTest(body.quizToken, { secret: SECRET });
    expect(body.puzzles.map((puzzle: { options: string[] }) => puzzle.options.length))
      .toEqual(puzzles.map((puzzle) => puzzle.options.length));
  });

  it("refuses a flood of starts from one address", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    vi.resetModules();
    vi.doMock("@/lib/redis", () => ({ redisCommand: vi.fn(async () => 61) }));
    const { POST } = await import("./route");
    const response = await POST(generateRequest({ profile: "short-5" }, "generate-route-flood"));
    expect(response.status).toBe(429);
    vi.doUnmock("@/lib/redis");
  });

  it("returns the answer deadline beside the opaque token", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

    const before = Math.floor(Date.now() / 1000);
    const body = await (await POST(generateRequest({ profile: "short-5" }, "deadline-short"))).json();
    const after = Math.floor(Date.now() / 1000);

    expect(body.secondsPerQuestion).toBe(60);
    // Five questions at a minute each, measured from when the server issued it.
    expect(body.answerDeadline).toBeGreaterThanOrEqual(before + 300);
    expect(body.answerDeadline).toBeLessThanOrEqual(before + 305);
    // serverNow lets the browser correct its own clock rather than trusting it;
    // it must fall in the same request window and share answerDeadline's unit.
    expect(body.serverNow).toBeGreaterThanOrEqual(before);
    expect(body.serverNow).toBeLessThanOrEqual(after);
    expect(body.answerDeadline - body.serverNow).toBe(300);
  });

  it("serves the 5-question test when it is asked for", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    const { POST } = await import("./route");

    const response = await POST(generateRequest({ profile: "short-5" }, "generate-route-short"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toBe("short-5");
    expect(body.source).toBe("generated");
    expect(body.puzzles).toHaveLength(5);
    // The served puzzles carry no family, band, or difficulty before scoring, so
    // the five distinct families are read from the sealed token's own items.
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("familyId");
      expect(puzzle).not.toHaveProperty("band");
      expect(puzzle).not.toHaveProperty("difficulty");
    }
    const { puzzles } = loadLinkTest(body.quizToken, { secret: "test-only-secret-that-is-at-least-32-characters-long" });
    expect(new Set(puzzles.map((puzzle) => puzzle.familyId)).size).toBe(5);
    // Nowhere else either: not in an id, not in any nested field. The ids once
    // ended in the family name, which undid removing the field itself.
    const served = JSON.stringify(body.puzzles);
    for (const familyId of SCENE_FAMILY_IDS) expect(served).not.toContain(familyId);
  });

  it("serves both lengths without an experimental notice", async () => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST } = await import("./route");

    const short = await (await POST(generateRequest({ profile: "short-5" }, "notice-short"))).json();
    const long = await (await POST(generateRequest({ profile: "long-30" }, "notice-long"))).json();

    expect(short.source).toBe("generated");
    expect(long.source).toBe("generated");
    expect(short).not.toHaveProperty("notice");
    expect(long).not.toHaveProperty("notice");
  });

  it.each([
    ["short-5", 5],
    ["long-30", 30],
  ] as const)("falls back to the bank for %s when assembly fails", async (profile, expectedCount) => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.resetModules();
    vi.doMock("@/items/expanded-quiz", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/items/expanded-quiz")>()),
      assembleExpandedTest: vi.fn(() => {
        throw new Error("forced fail");
      }),
    }));
    const { POST } = await import("./route");

    const response = await POST(generateRequest({ profile }, `generate-route-fallback-${profile}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("fallback");
    expect(body.notice).toMatch(/verified reference set/);
    // The fallback path issues its own token, so serverNow must ride along
    // here too, not only on the happy path.
    expect(typeof body.serverNow).toBe("number");
    expect(body.answerDeadline - body.serverNow).toBeGreaterThan(0);
    expect(body.puzzles).toHaveLength(expectedCount);
    for (const puzzle of body.puzzles) {
      expect(puzzle).not.toHaveProperty("answerIndex");
      expect(puzzle).not.toHaveProperty("explanation");
    }
    vi.doUnmock("@/items/expanded-quiz");
  });

  it.each([
    ["generated", false],
    ["fallback", true],
  ] as const)("starts the %s test's clock after the questions exist, not before", async (source, failAssembly) => {
    // Slow assembly must not eat the taker's budget: the deadline and serverNow
    // are read after assembly, so the browser's countdown and the sealed
    // deadline agree even when building the test took fifteen seconds.
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-secret-that-is-at-least-32-characters-long");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const started = Math.floor(Date.now() / 1000);
    vi.resetModules();
    vi.doMock("@/items/expanded-quiz", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/items/expanded-quiz")>();
      return {
        ...original,
        assembleExpandedTest: vi.fn((...args: Parameters<typeof original.assembleExpandedTest>) => {
          vi.setSystemTime(Date.now() + 15_000);
          if (failAssembly) throw new Error("forced fail");
          return original.assembleExpandedTest(...args);
        }),
      };
    });
    const { POST } = await import("./route");

    const body = await (await POST(generateRequest({ profile: "short-5" }, `slow-${source}`))).json();

    expect(body.source).toBe(source);
    expect(body.serverNow).toBeGreaterThanOrEqual(started + 15);
    expect(body.answerDeadline - body.serverNow).toBe(300);
    vi.doUnmock("@/items/expanded-quiz");
    vi.useRealTimers();
  });
});
