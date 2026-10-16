import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as linkTests from "./link-test";
import { readQuizSubmission, SubmissionConflictError } from "./leaderboard";
import { scoreLinkResult } from "./link-result";
import { scoreQuiz } from "./quiz-scoring";
import { redisCommand } from "./redis";
import { ScoringError } from "./scoring";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("./redis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redis")>()),
  redisCommand: vi.fn(),
}));

async function execute(command: readonly (string | number)[]) {
  const key = String(command[1]);
  if (command[0] === "GET") return store.get(key) ?? null;
  if (command[0] === "SET") {
    if (command.includes("NX") && store.has(key)) return null;
    store.set(key, String(command[2]));
    return "OK";
  }
  if (command[0] === "EVAL") {
    const stateKey = String(command[3]);
    const current = store.get(stateKey);
    if ((current === undefined && command[4] === "") || current === command[4]) {
      store.set(stateKey, String(command[5]));
    }
    return store.get(stateKey) ?? null;
  }
  throw new Error(`Unexpected Redis command ${command[0]}`);
}

const SECRET = "test-only-result-secret-with-at-least-32-characters";
const ISSUED_AT = 1_893_456_000;
const ARRIVED_AT = ISSUED_AT + 900;
const context = { secret: SECRET, nowSeconds: ISSUED_AT, withdrawnFamilyIds: new Set<string>() };
type Fixture = ReturnType<typeof linkTests.createLinkTest>;
let long: Fixture;
let short: Fixture;
let fallback: Fixture;
const answersFor = (fixture: Fixture) => fixture.puzzles.map((puzzle, index) =>
  index % 5 === 0 ? null : index % 5 === 1 ? (puzzle.answerIndex + 1) % puzzle.options.length : puzzle.answerIndex);

function environment() {
  vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
  vi.stubEnv("WITHDRAWN_FAMILY_IDS", "");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("LEADERBOARD_ENABLED", "true");
}

describe("a link result calculated over short requests", { timeout: 30_000 }, () => {
  beforeAll(() => {
    environment();
    long = linkTests.createLinkTest("long-30", { ...context, seed: "link-result-long" });
    // Both test lengths are still open at ARRIVED_AT; these tests exercise result
    // rebuilding and recovery, while deadline-specific tests cover saved progress.
    short = linkTests.createLinkTest("short-5", { ...context, nowSeconds: ISSUED_AT + 700, seed: "link-result-short" });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fallback = linkTests.createLinkTest("short-5", {
        ...context, nowSeconds: ISSUED_AT + 700, seed: "link-result-fallback", assemble: () => { throw new Error("generation unavailable"); },
      });
    } finally {
      quiet.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  beforeEach(() => {
    environment();
    store.clear();
    linkTests.clearBuiltLinkTests();
    vi.mocked(redisCommand).mockReset().mockImplementation(execute);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ARRIVED_AT * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("limits each cold request to one question and matches the whole-test score", async () => {
    const answers = answersFor(long);
    const question = vi.spyOn(linkTests, "linkTestQuestion");
    for (let built = 1; built <= 30; built++) {
      // Each continuation may run on a server with no previous puzzle cache.
      linkTests.clearBuiltLinkTests();
      question.mockClear();
      const step = await scoreLinkResult(long.token, long.test, answers, ARRIVED_AT, { budgetMs: -1 });
      expect(question).toHaveBeenCalledTimes(1);
      if (built < 30) expect(step).toEqual({ built });
      else expect(step).toEqual({ scored: {
        ...scoreQuiz(linkTests.scoringPayload(long.test, long.puzzles), answers, ARRIVED_AT),
        leaderboardEligible: true,
      } });
    }
  });

  it("recovers a receipt without rebuilding any question or the whole test", async () => {
    const answers = answersFor(short);
    const original = await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT, { budgetMs: Infinity });
    linkTests.clearBuiltLinkTests();
    const question = vi.spyOn(linkTests, "linkTestQuestion").mockImplementation(() => { throw new Error("must not rebuild"); });
    const whole = vi.spyOn(linkTests, "loadLinkTest").mockImplementation(() => { throw new Error("must not rebuild"); });
    expect(await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 60)).toEqual(original);
    expect(question).not.toHaveBeenCalled();
    expect(whole).not.toHaveBeenCalled();
  });

  it("keeps the first arrival for timing and points while storage expires on the real clock", async () => {
    const answers = answersFor(long);
    const receivedAt = long.test.answerDeadline - 5;
    vi.setSystemTime(receivedAt * 1000);
    expect(await scoreLinkResult(long.token, long.test, answers, receivedAt, { budgetMs: -1 })).toEqual({ built: 1 });
    const finishedAt = long.test.answerDeadline + 65;
    vi.setSystemTime(finishedAt * 1000);
    const result = await scoreLinkResult(long.token, long.test, answers, finishedAt, { budgetMs: Infinity });
    expect(result).toEqual({ scored: {
      ...scoreQuiz(linkTests.scoringPayload(long.test, long.puzzles), answers, receivedAt),
      leaderboardEligible: true,
    } });
    const saved = vi.mocked(redisCommand).mock.calls.map(([command]) => command)
      .find((command) => command[0] === "SET" && String(command[1]).includes(":submission:"))!;
    expect(JSON.parse(String(saved[2])).submittedAt).toBe(receivedAt);
    expect(saved[saved.indexOf("EX") + 1]).toBe(long.test.expiresAt - finishedAt);
  });

  it("rejects changed answers while pending and after scoring, and malformed answers before storage", async () => {
    const answers = answersFor(short);
    await expect(scoreLinkResult(short.token, short.test, [], ARRIVED_AT)).rejects.toBeInstanceOf(ScoringError);
    await expect(scoreLinkResult(short.token, short.test, [6, ...answers.slice(1)], ARRIVED_AT)).rejects.toBeInstanceOf(ScoringError);
    expect(redisCommand).not.toHaveBeenCalled();
    await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT, { budgetMs: -1 });
    const changed = [0, ...answers.slice(1)];
    await expect(scoreLinkResult(short.token, short.test, changed, ARRIVED_AT + 1)).rejects.toBeInstanceOf(SubmissionConflictError);
    await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 2, { budgetMs: Infinity });
    await expect(scoreLinkResult(short.token, short.test, changed, ARRIVED_AT + 3)).rejects.toBeInstanceOf(SubmissionConflictError);
  });

  it.each(["progress", "completion"])("recovers current %s when an older write arrives late", async (winner) => {
    const answers = answersFor(short);
    await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT, { budgetMs: -1 });
    let release!: () => void;
    let reached!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    let pause = true;
    vi.mocked(redisCommand).mockImplementation(async (command) => {
      if (pause && command[0] === "EVAL" && command[4] !== "") {
        pause = false;
        reached();
        await delayed;
      }
      return execute(command);
    });
    try {
      const older = scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 1, { budgetMs: -1 });
      await waiting;
      let current = await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 2, { budgetMs: winner === "completion" ? Infinity : -1 });
      if (winner === "progress") current = await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 3, { budgetMs: -1 });
      release();
      expect(await older).toEqual(current);
      if (winner === "progress") expect(current).toEqual({ built: 3 });
      else expect(current).toHaveProperty("scored");
    } finally {
      release();
    }
  });

  it("gives simultaneous final requests the same immutable receipt", async () => {
    const answers = answersFor(short);
    const [first, second] = await Promise.all([
      scoreLinkResult(short.token, short.test, answers, ARRIVED_AT, { budgetMs: Infinity }),
      scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 20, { budgetMs: Infinity }),
    ]);
    expect(first).toEqual(second);
    expect(first).toHaveProperty("scored");
    expect([...store.keys()].filter((key) => key.includes(":submission:"))).toHaveLength(1);
  });

  it("does not rebuild before the first answers and time are durable", async () => {
    const answers = answersFor(short);
    const question = vi.spyOn(linkTests, "linkTestQuestion");
    vi.mocked(redisCommand).mockImplementation(async (command) => {
      if (command[0] === "EVAL") throw new Error("claim unavailable");
      return execute(command);
    });
    await expect(scoreLinkResult(short.token, short.test, answers, ARRIVED_AT)).rejects.toThrow("claim unavailable");
    expect(question).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it.each(["write", "acknowledgement"])("recovers the original arrival after receipt %s failure", async (failure) => {
    const answers = answersFor(short);
    vi.mocked(redisCommand).mockImplementation(async (command) => {
      if (command[0] === "SET" && String(command[1]).includes(":submission:")) {
        if (failure === "acknowledgement") await execute(command);
        throw new Error("storage unavailable");
      }
      return execute(command);
    });
    await expect(scoreLinkResult(short.token, short.test, answers, ARRIVED_AT, { budgetMs: Infinity })).rejects.toThrow("storage unavailable");
    if (failure === "write") expect(await readQuizSubmission(short.token, answers)).toBeNull();
    vi.mocked(redisCommand).mockImplementation(execute);
    vi.setSystemTime((ARRIVED_AT + 60) * 1000);
    const recovered = await scoreLinkResult(short.token, short.test, answers, ARRIVED_AT + 60);
    expect(recovered).toEqual({ scored: {
      ...scoreQuiz(linkTests.scoringPayload(short.test, short.puzzles), answers, ARRIVED_AT),
      leaderboardEligible: false,
    } });
  });

  it.each(["legacy", "fallback"])("scores a cold %s token with the same questions and answers", async (kind) => {
    const fixture = kind === "legacy" ? short : fallback;
    const test = kind === "legacy" ? { ...fixture.test, attempts: undefined } : fixture.test;
    const token = linkTests.sealLinkToken(test, SECRET);
    const answers = answersFor(fixture);
    if (kind === "legacy") {
      vi.spyOn(linkTests, "linkTestQuestion").mockImplementation(() => { throw new Error("legacy must resume its assembler"); });
    }
    for (let built = 1; built <= 5; built++) {
      linkTests.clearBuiltLinkTests();
      const step = await scoreLinkResult(token, test, answers, ARRIVED_AT, { budgetMs: -1 });
      if (built < 5) expect(step).toEqual({ built });
      else expect(step).toEqual({ scored: {
        ...scoreQuiz(linkTests.scoringPayload(test, fixture.puzzles), answers, ARRIVED_AT),
        leaderboardEligible: false,
      } });
    }
  });
});
