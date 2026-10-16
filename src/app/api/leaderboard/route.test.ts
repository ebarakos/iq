import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listBoardEntries, listLeaderboard, reindexBoard, removeLeaderboardEntry } from "@/lib/leaderboard";
import type { LeaderboardEntry } from "@/lib/leaderboard-types";
import { createLinkTest, openLinkToken, sealLinkToken, type LinkTest } from "@/lib/link-test";
import { POST as submit } from "../submit/route";
import { POST as saveAnswers } from "../answers/route";
import { POST } from "./route";

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  ranks: new Map<string, { id: string; board: string; score: number }>(),
  counts: new Map<string, number>(),
}));
vi.mock("@/lib/redis", () => ({
  redisCommand: vi.fn(async (command: (string | number)[]) => {
    const key = String(command[1]);
    switch (command[0]) {
      case "GET": return store.values.get(key) ?? null;
      case "SET":
        if (command.includes("NX") && store.values.has(key)) return null;
        store.values.set(key, String(command[2]));
        return "OK";
      case "ZREM": return Number(store.ranks.delete(`${key}:${command[2]}`));
      case "ZADD": {
        // Only the XX form (update rows already ranked) is used outside the publish script.
        if (command[2] !== "XX") throw new Error("Unexpected ZADD");
        const pairs = command.slice(3);
        for (let index = 0; index < pairs.length; index += 2) {
          const id = String(pairs[index + 1]);
          if (store.ranks.has(`${key}:${id}`)) store.ranks.set(`${key}:${id}`, { id, board: key, score: Number(pairs[index]) });
        }
        return 0;
      }
      case "EVAL": {
        if (String(command[1]).includes("cjson.decode(current).receivedAtMs")) {
          const [answerKey, receiptKey] = [String(command[3]), String(command[4])];
          const previous = store.values.get(answerKey);
          if (Number(command[6]) < Number(command[7]) && !store.values.has(receiptKey) &&
            (!previous || JSON.parse(previous).receivedAtMs <= Number(command[6]))) {
            const next = JSON.parse(String(command[5]));
            const earlier = previous ? JSON.parse(previous).answers : [];
            next.answers = Array.from({ length: Number(command[9]) }, (_, index) =>
              index < next.answers.length ? next.answers[index] : earlier[index] ?? null);
            store.values.set(answerKey, JSON.stringify(next));
          }
          return store.values.get(answerKey) ?? null;
        }
        if (command[2] === 2) {
          // The removal script: tombstone the row and take it out of the ranking together.
          store.values.set(String(command[3]), String(command[5]));
          store.ranks.delete(`${command[4]}:${command[6]}`);
          return 1;
        }
        const receiptKey = String(command[3]);
        const entryKey = String(command[4]);
        if (store.values.has(entryKey)) return store.values.get(entryKey);
        if (!store.values.has(receiptKey)) return null;
        store.values.set(entryKey, String(command[6]));
        const board = String(command[5]);
        const id = String(command[8]);
        store.ranks.set(`${board}:${id}`, { id, board, score: Number(command[7]) });
        return String(command[6]);
      }
      case "ZREVRANGE": return [...store.ranks.values()].filter((rank) => rank.board === key)
        .sort((a, b) => b.score - a.score)
        .slice(Number(command[2]), Number(command[3]) === -1 ? undefined : Number(command[3]) + 1)
        .map(({ id }) => id);
      case "MGET": return command.slice(1).map((item) => store.values.get(String(item)) ?? null);
      case "INCR": {
        const count = (store.counts.get(key) ?? 0) + 1;
        store.counts.set(key, count);
        return count;
      }
      case "EXPIRE": return 1;
      default: throw new Error("Unexpected Redis command");
    }
  }),
}));

const SECRET = "leaderboard-tests-secret-with-at-least-32-characters";
const NOW = 10_000;

/** Real tests, built once from fixed seeds; each token below seals one with its own times. */
const LONG = createLinkTest("long-30", { secret: SECRET, seed: "leaderboard-route-long", withdrawnFamilyIds: new Set() });
const SHORT = createLinkTest("short-5", { secret: SECRET, seed: "leaderboard-route-short", withdrawnFamilyIds: new Set() });
const KEY = LONG.puzzles.map((puzzle) => puzzle.answerIndex);
/** The first `correct` answers right and the rest wrong. */
function answers(correct: number, key: readonly number[] = KEY): number[] {
  return key.map((answer, index) => index < correct ? answer : (answer + 1) % 6);
}
const ALL_RIGHT = answers(30);

function token(overrides: Partial<LinkTest> = {}): string {
  return sealLinkToken({
    ...LONG.test,
    appVersion: "v0.1.1",
    rankAllowed: true,
    leaderboardScope: "aiq:local",
    issuedAt: NOW - 1200,
    answerDeadline: NOW + 600,
    expiresAt: NOW + 7200,
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
  store.counts.clear();
  vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
  vi.stubEnv("LEADERBOARD_ENABLED", "true");
  vi.stubEnv("LEADERBOARD_ENV", undefined);
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
  it("publishes the server-scored accuracy, original elapsed time and the sealed app version", async () => {
    const quizToken = token();
    const submission = await submit(request({
      quizToken, answers: answers(28), score: 30, points: 999999, elapsedSeconds: 0,
      issuedAt: NOW, answerDeadline: NOW + 1800, leaderboardEligible: true,
    }));
    expect(submission.status).toBe(200);
    const scored = await submission.json();
    expect(scored).toMatchObject({ score: 28, elapsedSeconds: 1200 });
    expect(scored).not.toHaveProperty("points");
    vi.setSystemTime((NOW + 100) * 1000);
    const published = await POST(request({
      quizToken, kind: "person", nickname: "  Taker  ", score: 30, correct: 30, total: 30,
      points: 999999, appVersion: "v99.0.0", elapsedSeconds: 0, submittedAt: 0,
    }));
    expect(published.status).toBe(200);
    const { entry } = await published.json();
    expect(entry).toEqual({ id: expect.any(String), nickname: "Taker", kind: "person", correct: 28, total: 30, elapsedSeconds: 1200, appVersion: "v0.1.1", submittedAt: NOW });
    const entries = await listLeaderboard();
    expect(entries).toEqual([entry]);
    expect(JSON.stringify(entries)).not.toContain(quizToken);
    expect(JSON.stringify(entries)).not.toContain("answerIndex");
  });

  it("cannot replace a revealed zero score with correct answers or forged publication values", async () => {
    const quizToken = token();
    expect((await submit(request({ quizToken, answers: new Array(30).fill(null) }))).status).toBe(200);
    const replay = await submit(request({ quizToken, answers: ALL_RIGHT }));
    expect(replay.status).toBe(409);
    expect(await replay.json()).not.toHaveProperty("results");

    const forged = { quizToken, kind: "person", nickname: "Forged", points: 999999, correct: 30, elapsedSeconds: 0 };
    const response = await POST(request(forged));
    expect(response.status).toBe(200);
    const { entry } = await response.json();
    expect(entry).toMatchObject({ correct: 0, elapsedSeconds: 1200 });
    const retry = await POST(request({ ...forged, nickname: "Replacement", points: 3750 }));
    expect((await retry.json()).entry).toEqual(entry);
    expect(await listLeaderboard()).toEqual([entry]);
  });

  it("ranks accuracy before speed and uses elapsed time only for equal accuracy", async () => {
    for (const [correct, elapsedSeconds, nickname, kind] of [
      [28, 120, "Fast agent", "agent"],
      [30, 1799, "Accurate person", "person"],
      [30, 600, "Accurate agent", "agent"],
    ] as const) {
      const quizToken = token({ issuedAt: NOW - elapsedSeconds, answerDeadline: NOW - elapsedSeconds + 1800 });
      expect((await submit(request({ quizToken, answers: answers(correct) }))).status).toBe(200);
      expect((await POST(request({ quizToken, nickname, kind }))).status).toBe(200);
    }
    expect((await listLeaderboard()).map(({ nickname, correct, elapsedSeconds }) =>
      ({ nickname, correct, elapsedSeconds }))).toEqual([
      { nickname: "Accurate agent", correct: 30, elapsedSeconds: 600 },
      { nickname: "Accurate person", correct: 30, elapsedSeconds: 1799 },
      { nickname: "Fast agent", correct: 28, elapsedSeconds: 120 },
    ]);
  });

  it("re-ranks rows indexed under the old points rule, then reads only the top rows", async () => {
    const board = "aiq:local:leaderboard";
    type StoredRow = LeaderboardEntry & { removed?: true; points?: number };
    const add = (entry: StoredRow, score: number) => {
      store.values.set(`${board}:entry:${entry.id}`, JSON.stringify(entry));
      store.ranks.set(`${board}:${entry.id}`, { id: entry.id, board, score });
    };
    // Old index scores: points with the speed bonus × 10,000, plus seconds left.
    const base: StoredRow = {
      id: "legacy", nickname: "Legacy", kind: "agent", correct: 28, total: 30,
      points: 3453, elapsedSeconds: 120, appVersion: "v0.1.1", submittedAt: NOW,
    };
    for (let index = 0; index < 45; index++) {
      add({ ...base, id: `legacy-${index}` }, 34_530_000 + 1680);
    }
    add({ ...base, id: "late-perfect", correct: 30, points: 3000, elapsedSeconds: 1805 }, 30_000_000);
    add({ ...base, id: "earlier-perfect", correct: 30, points: 3000, elapsedSeconds: 1790 }, 30_000_010);
    add({ ...base, id: "removed", removed: true, correct: 30, elapsedSeconds: 0 }, 99_000_000);
    add({ ...base, id: "taken-down", removed: true, correct: 30, elapsedSeconds: 0 }, 0);
    store.ranks.delete(`${board}:taken-down`);
    store.ranks.set(`${board}:missing`, { id: "missing", board, score: 99_000_000 });

    const quizToken = token();
    await submit(request({ quizToken, answers: answers(29) }));
    const { entry } = await (await POST(request({ quizToken, nickname: "New person", kind: "person" }))).json();
    // Until re-ranked, the old scale keeps every perfect and new row below the legacy 28s.
    expect((await listLeaderboard()).some(({ correct }) => correct > 28)).toBe(false);

    for (let run = 0; run < 2; run++) {
      expect(await reindexBoard("aiq:local")).toBe(48);
      const entries = await listLeaderboard();
      expect(entries).toHaveLength(20);
      expect(entries.slice(0, 4).map(({ id }) => id)).toEqual(["earlier-perfect", "late-perfect", entry.id, expect.stringMatching(/^legacy-/)]);
      expect(entries.some((row) => "points" in row)).toBe(false);
      expect(entries.some(({ id }) => id === "removed" || id === "missing")).toBe(false);
    }
    const { redisCommand } = await import("@/lib/redis");
    const reads = vi.mocked(redisCommand).mock.calls.map(([command]) => command).filter((command) => command[0] === "ZREVRANGE");
    expect(reads.at(-1)!.slice(2)).toEqual([0, 39]);
    expect(await listBoardEntries("aiq:local")).toHaveLength(48);
    // A row taken down stays off the board, and saved rows are not rewritten.
    expect(store.ranks.has(`${board}:taken-down`)).toBe(false);
    expect(JSON.parse(store.values.get(`${board}:entry:legacy-0`)!).points).toBe(3453);
  });

  it("drops points from old receipts and entries without modifying either", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: answers(28) }));
    const receiptKey = [...store.values.keys()].find((key) => key.includes(":submission:"))!;
    const receipt = JSON.parse(store.values.get(receiptKey)!);
    receipt.response.points = 3033;
    const legacyReceipt = JSON.stringify(receipt);
    store.values.set(receiptKey, legacyReceipt);

    const recovered = await (await submit(request({ quizToken, answers: answers(28) }))).json();
    expect(recovered).toMatchObject({ score: 28, elapsedSeconds: 1200 });
    expect(recovered).not.toHaveProperty("points");
    const { entry } = await (await POST(request({ quizToken, nickname: "Existing", kind: "agent" }))).json();
    expect(entry).toMatchObject({ correct: 28 });
    expect(entry).not.toHaveProperty("points");
    const entryKey = `aiq:local:leaderboard:entry:${entry.id}`;
    const legacyEntry = JSON.stringify({ ...entry, points: 3033 });
    store.values.set(entryKey, legacyEntry);
    const retry = await POST(request({ quizToken, nickname: "Replacement", kind: "person" }));
    expect((await retry.json()).entry).toEqual(entry);
    expect(await listLeaderboard()).toEqual([entry]);
    expect(await listBoardEntries("aiq:local")).toEqual([entry]);
    expect(store.values.get(receiptKey)).toBe(legacyReceipt);
    expect(store.values.get(entryKey)).toBe(legacyEntry);
  });

  it("rejects tampered and attacker-signed tokens before reading or writing leaderboard storage", async () => {
    const quizToken = token();
    const parts = quizToken.split(".");
    const ciphertext = Buffer.from(parts[2], "base64url");
    ciphertext[0] ^= 1;
    parts[2] = ciphertext.toString("base64url");
    const attackerToken = sealLinkToken(openLinkToken(quizToken, { secret: SECRET }), `${SECRET}-attacker`);
    const { redisCommand } = await import("@/lib/redis");

    for (const invalidToken of [parts.join("."), attackerToken]) {
      const response = await POST(request({ kind: "person", quizToken: invalidToken, nickname: "Forged", points: 3750 }));
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty("entry");
    }
    expect(redisCommand).not.toHaveBeenCalled();
    expect(store.ranks.size).toBe(0);
  });

  it("rejects an expired token even when its scored receipt still exists", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: ALL_RIGHT }));
    const { redisCommand } = await import("@/lib/redis");
    vi.mocked(redisCommand).mockClear();
    vi.setSystemTime((NOW + 7200) * 1000);

    const response = await POST(request({ kind: "person", quizToken, nickname: "Expired" }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("entry");
    expect(redisCommand).not.toHaveBeenCalled();
    expect(store.ranks.size).toBe(0);
  });

  it("publishes once under concurrent retries and retains the original nickname", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: ALL_RIGHT }));
    const responses = await Promise.all([
      POST(request({ kind: "person", quizToken, nickname: "First" })),
      POST(request({ kind: "person", quizToken, nickname: "Second" })),
    ]);
    const entries = await Promise.all(responses.map(async (response) => (await response.json()).entry));
    expect(entries[0]).toEqual(entries[1]);
    expect(store.ranks.size).toBe(1);
    expect((await (await POST(request({ kind: "person", quizToken, nickname: "Third" }))).json()).entry).toEqual(entries[0]);
  });

  it("ranks an on-time 28/30 above a timed-out test with nothing saved", async () => {
    const fast = token();
    const slow = token({ issuedAt: NOW - 1800, answerDeadline: NOW });
    await submit(request({ quizToken: slow, answers: ALL_RIGHT }));
    await POST(request({ kind: "person", quizToken: slow, nickname: "Slow" }));
    await submit(request({ quizToken: fast, answers: answers(28) }));
    await POST(request({ kind: "person", quizToken: fast, nickname: "Fast" }));
    expect((await listLeaderboard()).map((entry) => entry.nickname)).toEqual(["Fast", "Slow"]);
  });

  it("rejects unscored results, malformed or abusive nicknames, and a missing tag", async () => {
    const quizToken = token();
    for (const nickname of ["", " ", "a".repeat(25), "name\nline", "visit evil.com", "fuck off"]) {
      expect((await POST(request({ kind: "person", quizToken, nickname }))).status).toBe(400);
    }
    expect((await POST(request({ quizToken, nickname: "No tag" }))).status).toBe(400);
    expect((await POST(request({ quizToken, nickname: "Bad tag", kind: "robot" }))).status).toBe(400);
    expect((await POST(request({
      quizToken, kind: "person", nickname: "Unscored", points: 3750, correct: 30, total: 30,
      elapsedSeconds: 0, leaderboardEligible: true,
      response: { score: 30, points: 3750, total: 30, late: false, leaderboardEligible: true },
    }))).status).toBe(400);
    expect(store.ranks.size).toBe(0);
  });

  it.each([
    ["legacy", { appVersion: undefined, rankAllowed: undefined }],
    ["disabled at issue", { rankAllowed: false }],
    ["too fast", { issuedAt: NOW - 119, answerDeadline: NOW + 1681 }],
    ["sample", { ...SHORT.test, issuedAt: NOW - 200, answerDeadline: NOW + 100 }],
  ] satisfies [string, Partial<LinkTest>][])("does not publish a %s test", async (_, overrides) => {
    const quizToken = token(overrides);
    const key = "seed" in overrides ? SHORT.puzzles.map((puzzle) => puzzle.answerIndex) : KEY;
    const scored = await (await submit(request({ quizToken, answers: key }))).json();
    expect(scored.leaderboardEligible).toBe(false);
    expect((await POST(request({ kind: "person", quizToken, nickname: "Ineligible" }))).status).toBe(400);
    expect(store.ranks.size).toBe(0);
  });

  it.each(["person", "agent"])("publishes only saved on-time answers for a late %s", async (kind) => {
    const quizToken = token();
    const partial = KEY.map((answer, index) => index < 26 ? answer : null);
    expect((await saveAnswers(request({ quizToken, answers: partial, receivedAtMs: 0 }))).status).toBe(200);
    const record = [...store.values.values()].map((raw) => JSON.parse(raw)).find((value) => value.receivedAtMs);
    expect(record.receivedAtMs).toBe(NOW * 1000);

    vi.setSystemTime((NOW + 759) * 1000); // 159 seconds past this test's deadline.
    const refusedUpdate = await saveAnswers(request({ quizToken, answers: ALL_RIGHT, receivedAtMs: 0 }));
    expect(await refusedUpdate.json()).toEqual({ closed: true });
    const result = await (await submit(request({ quizToken, answers: ALL_RIGHT }))).json();
    // Elapsed time stops at the time limit, however late the result was opened.
    expect(result).toMatchObject({ score: 26, elapsedSeconds: 1800, timedOut: true, late: true, leaderboardEligible: true });
    expect(result.results.slice(26).every((item: { chosen: number | null }) => item.chosen === null)).toBe(true);
    const published = await POST(request({ quizToken, kind, nickname: "Late finisher" }));
    expect(published.status).toBe(200);
    expect((await published.json()).entry).toMatchObject({ correct: 26, elapsedSeconds: 1800, kind });
    expect((await submit(request({ quizToken, answers: ALL_RIGHT }))).status).toBe(200);
    expect((await submit(request({ quizToken, answers: partial }))).status).toBe(409);
  });

  it("does not accept new answers at the deadline, even inside the timing grace window", async () => {
    const quizToken = token();
    const partial = KEY.map((answer, index) => index < 3 ? answer : null);
    await saveAnswers(request({ quizToken, answers: partial }));
    vi.setSystemTime((NOW + 600) * 1000);
    expect(await (await saveAnswers(request({ quizToken, answers: ALL_RIGHT }))).json()).toEqual({ closed: true });
    expect(await (await submit(request({ quizToken, answers: ALL_RIGHT }))).json())
      .toMatchObject({ score: 3, timedOut: true, late: false, leaderboardEligible: true });
  });

  it("updates choices on time and freezes them after submission", async () => {
    const quizToken = token();
    await saveAnswers(request({ quizToken, answers: ALL_RIGHT }));
    vi.setSystemTime((NOW + 1) * 1000);
    await saveAnswers(request({ quizToken, answers: answers(25) }));
    await submit(request({ quizToken, answers: answers(25) }));
    vi.setSystemTime((NOW + 2) * 1000);
    await saveAnswers(request({ quizToken, answers: ALL_RIGHT }));
    const record = [...store.values.values()].map((raw) => JSON.parse(raw)).find((value) => value.receivedAtMs);
    expect(record.answers).toEqual(answers(25));
    expect((await submit(request({ quizToken, answers: ALL_RIGHT }))).status).toBe(409);
  });

  it("rejects invalid progress and tokens without storing anything or exposing answers", async () => {
    const quizToken = token();
    for (const body of [
      { quizToken, answers: [] },
      { quizToken, answers: [...ALL_RIGHT.slice(1), 6] },
      { quizToken: "forged", answers: ALL_RIGHT },
    ]) {
      const result = await saveAnswers(request(body));
      expect(result.status).toBe(400);
      expect(await result.json()).not.toHaveProperty("results");
    }
    expect(store.values.size).toBe(0);
  });

  it("timestamps progress after receiving the full body", async () => {
    const quizToken = token();
    const delayed = request({ quizToken, answers: ALL_RIGHT });
    vi.spyOn(delayed, "json").mockImplementation(async () => {
      vi.setSystemTime((NOW + 601) * 1000);
      return { quizToken, answers: ALL_RIGHT };
    });
    expect(await (await saveAnswers(delayed)).json()).toEqual({ closed: true });
    expect(store.values.size).toBe(0);
  });

  it("keeps newer saved answers when an older request finishes later", async () => {
    const { redisCommand } = await import("@/lib/redis");
    const original = vi.mocked(redisCommand).getMockImplementation()!;
    let release!: () => void;
    let reached!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    const quizToken = token();
    vi.mocked(redisCommand).mockImplementationOnce(async (command) => {
      reached();
      await delayed;
      return original(command);
    });
    try {
      const older = saveAnswers(request({ quizToken, answers: ALL_RIGHT }));
      await waiting;
      vi.setSystemTime((NOW + 1) * 1000);
      await saveAnswers(request({ quizToken, answers: answers(24) }));
      release();
      expect((await older).status).toBe(200);
      vi.setSystemTime((NOW + 759) * 1000);
      expect(await (await submit(request({ quizToken, answers: ALL_RIGHT }))).json()).toMatchObject({ score: 24 });
    } finally {
      release();
    }
  });

  it("returns a retryable failure when progress storage is unavailable", async () => {
    const { redisCommand } = await import("@/lib/redis");
    const quizToken = token();
    vi.mocked(redisCommand).mockRejectedValueOnce(new Error("storage unavailable"));
    const failed = await saveAnswers(request({ quizToken, answers: ALL_RIGHT }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).not.toHaveProperty("results");
    expect(store.values.size).toBe(0);
    expect((await saveAnswers(request({ quizToken, answers: ALL_RIGHT }))).status).toBe(200);
  });

  it("hides the leaderboard on deployments by default, before touching Redis", async () => {
    vi.stubEnv("LEADERBOARD_ENABLED", undefined);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const { redisCommand } = await import("@/lib/redis");
    expect(await listLeaderboard()).toEqual([]);
    expect((await POST(request({ quizToken: "anything", nickname: "Ignored" }))).status).toBe(404);
    expect(redisCommand).not.toHaveBeenCalled();
  });

  it("rejects cross-environment answer harvesting even if quiz secrets are reused", async () => {
    const quizToken = token({ leaderboardScope: "aiq:production" });
    const response = await submit(request({ quizToken, answers: new Array(30).fill(null) }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("results");
    expect(store.values.size).toBe(0);
    expect((await POST(request({ kind: "person", quizToken, nickname: "Wrong environment" }))).status).toBe(400);
  });

  it("keeps existing local scores on the shared dev board across preview and staging", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: ALL_RIGHT }));
    const { entry } = await (await POST(request({ kind: "person", quizToken, nickname: "Dev" }))).json();
    for (const environment of ["preview", "staging"]) {
      vi.stubEnv("VERCEL_ENV", environment);
      expect(await listLeaderboard()).toEqual([entry]);
      const retry = await POST(request({ kind: "person", quizToken, nickname: "Renamed" }));
      expect(retry.status).toBe(200);
      expect((await retry.json()).entry).toEqual(entry);
    }
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await listLeaderboard()).toEqual([entry]);
    expect((await POST(request({ kind: "person", quizToken, nickname: "Renamed" }))).status).toBe(400);
    expect(store.ranks.size).toBe(1);
  });

  it("keeps production's first scored result across board switches without permitting answer replay or a second publication", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LEADERBOARD_ENV", "dev");
    const quizToken = token({ leaderboardScope: "aiq:production" });
    const answers = new Array(30).fill(null);
    const first = await submit(request({ quizToken, answers }));
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result).toMatchObject({ score: 0, leaderboardEligible: true });
    const published = await POST(request({ kind: "person", quizToken, nickname: "Original" }));
    expect(published.status).toBe(200);
    const { entry } = await published.json();

    vi.stubEnv("LEADERBOARD_ENV", "production");
    vi.setSystemTime((NOW + 60) * 1000);
    const retry = await submit(request({ quizToken, answers }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(result);
    expect((await submit(request({ quizToken, answers: ALL_RIGHT }))).status).toBe(409);
    expect((await POST(request({ kind: "person", quizToken, nickname: "Replay" }))).status).toBe(400);
    expect(await listLeaderboard()).toEqual([]);
    expect([...store.values.keys()].filter((key) => key.includes(":submission:"))).toHaveLength(1);
    expect(store.ranks.size).toBe(1);

    vi.stubEnv("LEADERBOARD_ENV", "dev");
    expect((await (await POST(request({ kind: "person", quizToken, nickname: "Renamed" }))).json()).entry).toEqual(entry);
    expect(await listLeaderboard()).toEqual([entry]);
  });

  it("retains deployed production receipts and their original board", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LEADERBOARD_ENV", "production");
    const quizToken = token({ leaderboardScope: "aiq:production" });
    const first = await submit(request({ quizToken, answers: ALL_RIGHT }));
    expect(first.status).toBe(200);
    const result = await first.json();
    const key = [...store.values.keys()].find((key) => key.startsWith("aiq:production:submission:"))!;
    const receipt = JSON.parse(store.values.get(key)!);
    delete receipt.leaderboardNamespace;
    store.values.set(key, JSON.stringify(receipt));

    vi.stubEnv("LEADERBOARD_ENV", undefined);
    const retry = await submit(request({ quizToken, answers: ALL_RIGHT }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(result);
    expect((await POST(request({ kind: "person", quizToken, nickname: "Wrong board" }))).status).toBe(400);
    vi.stubEnv("LEADERBOARD_ENV", "production");
    expect((await POST(request({ kind: "person", quizToken, nickname: "Existing" }))).status).toBe(200);
  });

  it.each([["dev", "production"], ["production", "dev"]])(
    "uses the board selected at first submission after a %s to %s switch", async (initial, selected) => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("LEADERBOARD_ENV", initial);
      const quizToken = token({ leaderboardScope: "aiq:production" });
      vi.stubEnv("LEADERBOARD_ENV", selected);
      const scored = await submit(request({ quizToken, answers: ALL_RIGHT }));
      expect(scored.status).toBe(200);
      expect((await scored.json()).leaderboardEligible).toBe(true);
      const published = await POST(request({ kind: "person", quizToken, nickname: "Selected board" }));
      expect(published.status).toBe(200);
      const { entry } = await published.json();
      expect(await listLeaderboard()).toEqual([entry]);
      vi.stubEnv("LEADERBOARD_ENV", initial);
      expect(await listLeaderboard()).toEqual([]);
      expect((await POST(request({ kind: "person", quizToken, nickname: "Replay" }))).status).toBe(400);
    },
  );

  it("isolates production scores and refuses dev answer harvesting or replay there", async () => {
    const devToken = token();
    await submit(request({ quizToken: devToken, answers: ALL_RIGHT }));
    const devEntry = (await (await POST(request({ kind: "person", quizToken: devToken, nickname: "Dev" }))).json()).entry;

    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LEADERBOARD_ENV", "production");
    expect(await listLeaderboard()).toEqual([]);
    const { redisCommand } = await import("@/lib/redis");
    vi.mocked(redisCommand).mockClear();
    const harvested = await submit(request({ quizToken: devToken, answers: new Array(30).fill(null) }));
    expect(harvested.status).toBe(400);
    expect(await harvested.json()).not.toHaveProperty("results");
    expect((await POST(request({ kind: "person", quizToken: devToken, nickname: "Replay" }))).status).toBe(400);
    expect(redisCommand).not.toHaveBeenCalled();

    const productionToken = token({ leaderboardScope: "aiq:production" });
    await submit(request({ quizToken: productionToken, answers: ALL_RIGHT }));
    const productionEntry = (await (await POST(request({ kind: "person", quizToken: productionToken, nickname: "Production" }))).json()).entry;
    expect(await listLeaderboard()).toEqual([productionEntry]);
    vi.stubEnv("LEADERBOARD_ENV", "dev");
    expect(await listLeaderboard()).toEqual([devEntry]);
    expect((await POST(request({ kind: "person", quizToken: productionToken, nickname: "Replay" }))).status).toBe(400);
    expect(store.ranks.size).toBe(2);
  });

  it("tags each row as its publisher declared it", async () => {
    const person = token();
    const agent = token();
    await submit(request({ quizToken: person, answers: ALL_RIGHT }));
    await submit(request({ quizToken: agent, answers: answers(29) }));
    await POST(request({ quizToken: person, kind: "person", nickname: "Ada" }));
    const nickname = "NeuralNinja | GPT-6 | Effort: unspecified";
    const published = await POST(request({ quizToken: agent, kind: "agent", nickname }));
    expect(published.status).toBe(200);
    expect((await listLeaderboard()).map(({ nickname, kind }) => [nickname, kind]))
      .toEqual([["Ada", "person"], [nickname, "agent"]]);
  });

  it("limits publications from one address to 20 an hour", async () => {
    const tokens = Array.from({ length: 21 }, () => token());
    for (const quizToken of tokens) await submit(request({ quizToken, answers: ALL_RIGHT }));
    const statuses = [];
    for (const quizToken of tokens) {
      statuses.push((await POST(request({ quizToken, kind: "person", nickname: "Busy" }))).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("lets the owner remove a row, and its test cannot be published again", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: ALL_RIGHT }));
    const { entry } = await (await POST(request({ quizToken, kind: "person", nickname: "Spammer" }))).json();
    expect(await listLeaderboard()).toEqual([entry]);
    await removeLeaderboardEntry("aiq:local", entry);
    expect(await listLeaderboard()).toEqual([]);
    const again = await POST(request({ quizToken, kind: "person", nickname: "Spammer again" }));
    expect(again.status).toBe(400);
    expect((await again.json()).message).toBe("This result was removed from the leaderboard.");
  });

  it("never shows a tombstone, even one still in the ranking", async () => {
    const kept = token();
    const removed = token();
    await submit(request({ quizToken: kept, answers: answers(29) }));
    await submit(request({ quizToken: removed, answers: ALL_RIGHT }));
    const keptEntry = (await (await POST(request({ quizToken: kept, kind: "person", nickname: "Kept" }))).json()).entry;
    const { entry } = await (await POST(request({ quizToken: removed, kind: "person", nickname: "Removed" }))).json();
    // A removal interrupted between its two writes, as the review reproduced before removal became one script.
    const entryKey = [...store.values.keys()].find((key) => key.endsWith(`:entry:${entry.id}`))!;
    store.values.set(entryKey, JSON.stringify({ ...entry, removed: true }));
    expect(store.ranks.size).toBe(2);
    expect(await listLeaderboard()).toEqual([keptEntry]);
  });

  it("lets users retry publication after a storage failure", async () => {
    const quizToken = token();
    await submit(request({ quizToken, answers: ALL_RIGHT }));
    const { redisCommand } = await import("@/lib/redis");
    vi.mocked(redisCommand).mockRejectedValueOnce(new Error("Connection failed"));
    expect((await POST(request({ kind: "person", quizToken, nickname: "Retry" }))).status).toBe(503);
    expect((await POST(request({ kind: "person", quizToken, nickname: "Retry" }))).status).toBe(200);
  });
});
