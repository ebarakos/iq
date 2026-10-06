import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealQuizToken, type QuizTokenPayload } from "@/lib/quiz-token";
import { POST as submit } from "../submit/route";
import { GET, POST } from "./route";

const store = vi.hoisted(() => ({ values: new Map<string, string>(), ranks: new Map<string, number>() }));
vi.mock("@/lib/redis", () => ({
  redisCommand: vi.fn(async (command: (string | number)[]) => {
    const key = String(command[1]);
    switch (command[0]) {
      case "GET": return store.values.get(key) ?? null;
      case "SET":
        if (store.values.has(key)) return null;
        store.values.set(key, String(command[2]));
        return "OK";
      case "EVAL": {
        const receiptKey = String(command[3]);
        const entryKey = String(command[4]);
        if (store.values.has(entryKey)) return store.values.get(entryKey);
        if (!store.values.has(receiptKey)) return null;
        store.values.set(entryKey, String(command[6]));
        store.ranks.set(String(command[8]), Number(command[7]));
        return String(command[6]);
      }
      case "ZREVRANGE": return [...store.ranks].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
      case "MGET": return command.slice(1).map((item) => store.values.get(String(item)) ?? null);
      default: throw new Error("Unexpected Redis command");
    }
  }),
}));

const SECRET = "leaderboard-tests-secret-with-at-least-32-characters";
const NOW = 10_000;

function token(overrides: Partial<QuizTokenPayload> = {}): string {
  return sealQuizToken({
    version: 1,
    appVersion: "v0.1.1",
    leaderboardAllowed: true,
    leaderboardScope: "aiq:local",
    issuedAt: NOW - 1200,
    answerDeadline: NOW + 600,
    expiresAt: NOW + 7200,
    items: Array.from({ length: 30 }, (_, i) => ({
      id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture.",
    })),
    ...overrides,
  }, SECRET);
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/leaderboard", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.values.clear();
  store.ranks.clear();
  vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
  vi.stubEnv("LEADERBOARD_ENABLED", "true");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("leaderboard publication", () => {
  it("publishes server-scored points, original elapsed time and the sealed app version", async () => {
    const quizToken = token();
    const answers = Array.from({ length: 30 }, (_, i) => i < 28 ? 0 : 1);
    expect((await submit(request({ quizToken, answers }))).status).toBe(200);
    vi.setSystemTime((NOW + 100) * 1000);
    const published = await POST(request({ quizToken, nickname: "  Taker  ", points: 999999, appVersion: "v99.0.0", elapsedSeconds: 0 }));
    expect(published.status).toBe(200);
    const { entry } = await published.json();
    expect(entry).toMatchObject({ nickname: "Taker", correct: 28, total: 30, points: 3033, elapsedSeconds: 1200, appVersion: "v0.1.1", submittedAt: NOW });
    const body = await (await GET()).json();
    expect(body.entries).toEqual([entry]);
    expect(JSON.stringify(body)).not.toContain(quizToken);
    expect(JSON.stringify(body)).not.toContain("answerIndex");
  });

  it("publishes once under concurrent retries and retains the original nickname", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: new Array(30).fill(0) }));
    const responses = await Promise.all([
      POST(request({ quizToken, nickname: "First" })),
      POST(request({ quizToken, nickname: "Second" })),
    ]);
    const entries = await Promise.all(responses.map(async (response) => (await response.json()).entry));
    expect(entries[0]).toEqual(entries[1]);
    expect(store.ranks.size).toBe(1);
    expect((await (await POST(request({ quizToken, nickname: "Third" }))).json()).entry).toEqual(entries[0]);
  });

  it("sorts the faster 28/30 above the slower perfect result", async () => {
    const fast = token();
    const slow = token({ issuedAt: NOW - 1800, answerDeadline: NOW });
    await submit(request({ quizToken: slow, answers: new Array(30).fill(0) }));
    await POST(request({ quizToken: slow, nickname: "Slow" }));
    await submit(request({ quizToken: fast, answers: [...new Array(28).fill(0), 1, 1] }));
    await POST(request({ quizToken: fast, nickname: "Fast" }));
    expect((await (await GET()).json()).entries.map((entry: { nickname: string }) => entry.nickname)).toEqual(["Fast", "Slow"]);
  });

  it("rejects unscored results and malformed nicknames", async () => {
    const quizToken = token();
    for (const nickname of ["", " ", "a".repeat(33), "name\nline"]) {
      expect((await POST(request({ quizToken, nickname }))).status).toBe(400);
    }
    expect((await POST(request({ quizToken, nickname: "Unscored" }))).status).toBe(400);
    expect(store.ranks.size).toBe(0);
  });

  it.each([
    ["late", { issuedAt: NOW - 2000, answerDeadline: NOW - 200 }],
    ["legacy", { appVersion: undefined, leaderboardAllowed: undefined }],
    ["disabled at issue", { leaderboardAllowed: false }],
    ["sample", { items: Array.from({ length: 5 }, (_, i) => ({ id: String(i), answerIndex: 0, optionCount: 6, explanation: "Choose the matching picture." })) }],
  ] satisfies [string, Partial<QuizTokenPayload>][])("does not publish a %s test", async (_, overrides) => {
    const quizToken = token(overrides);
    const total = "items" in overrides ? overrides.items.length : 30;
    const scored = await (await submit(request({ quizToken, answers: new Array(total).fill(0) }))).json();
    expect(scored.leaderboardEligible).toBe(false);
    expect((await POST(request({ quizToken, nickname: "Ineligible" }))).status).toBe(400);
    expect(store.ranks.size).toBe(0);
  });

  it("hides both API methods on deployments by default, before touching Redis", async () => {
    vi.stubEnv("LEADERBOARD_ENABLED", undefined);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const { redisCommand } = await import("@/lib/redis");
    expect((await GET()).status).toBe(404);
    expect((await POST(request({ quizToken: "anything", nickname: "Ignored" }))).status).toBe(404);
    expect(redisCommand).not.toHaveBeenCalled();
  });

  it("rejects cross-environment answer harvesting even if quiz secrets are reused", async () => {
    const quizToken = token({ leaderboardScope: "aiq:production" });
    const response = await submit(request({ quizToken, answers: new Array(30).fill(null) }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("results");
    expect(store.values.size).toBe(0);
    expect((await POST(request({ quizToken, nickname: "Wrong environment" }))).status).toBe(400);
  });

  it("lets users retry publication after a storage failure", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: new Array(30).fill(0) }));
    const { redisCommand } = await import("@/lib/redis");
    vi.mocked(redisCommand).mockRejectedValueOnce(new Error("Connection failed"));
    expect((await POST(request({ quizToken, nickname: "Retry" }))).status).toBe(503);
    expect((await POST(request({ quizToken, nickname: "Retry" }))).status).toBe(200);
  });
});
