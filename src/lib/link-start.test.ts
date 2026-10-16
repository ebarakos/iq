import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPANDED_GENERATOR_VERSION } from "@/items/expanded-quiz";
import { SECONDS_PER_QUESTION } from "./quiz-token";
import { clearBuiltLinkTests, loadLinkTest } from "./link-test";
import { openStartedTest, startLinkTest } from "./link-start";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("./redis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redis")>()),
  redisCommand: vi.fn(async (command: (string | number)[]) => {
    const key = String(command[1]);
    switch (command[0]) {
      case "GET": return store.get(key) ?? null;
      case "GETDEL": { const value = store.get(key) ?? null; store.delete(key); return value; }
      case "EVAL": {
        const stateKey = String(command[3]);
        if (store.get(stateKey) === command[4]) store.set(stateKey, String(command[5]));
        return store.get(stateKey) ?? null;
      }
      case "SET":
        if (command.includes("XX") && !store.has(key)) return null;
        store.set(key, String(command[2]));
        return "OK";
      case "INCR": return 1;
      case "EXPIRE": return 1;
      default: throw new Error(`Unexpected Redis command ${command[0]}`);
    }
  }),
}));

const request = (path: string) => new Request(new URL(path, "http://localhost"));

/** The start link on a page, and the page's text. */
function read(html: string): { link?: string; text: string } {
  return {
    link: html.match(/<a href="(\/t\/start\/[^"]+)"/)?.[1],
    text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
  };
}

/** Follow a start link once, as a fetcher does, building one question per request. */
async function follow(link: string): Promise<Response> {
  return openStartedTest(request(link), link.split("/")[3], { budgetMs: -1 });
}

describe("a link test built over several requests", { timeout: 30_000 }, () => {
  beforeEach(() => {
    store.clear();
    clearBuiltLinkTests();
    vi.stubEnv("QUIZ_TOKEN_SECRET", "test-only-link-start-secret-with-at-least-32-characters");
    vi.stubEnv("WITHDRAWN_FAMILY_IDS", "");
    vi.stubEnv("KV_REST_API_URL", "https://redis.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "test-only-token");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("builds in short requests, then recovers the same test when its redirect is retried", async () => {
    const start = await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 });
    expect(start.status).toBe(200);
    expect(start.headers.get("content-type")).toContain("text/html");
    let page = read(await start.text());
    expect(page.text).toContain("Your 5-question test is being built: 1 of 5 questions so far.");
    expect(page.text).toContain("Your time starts only when the first question opens.");
    let link = page.link!;
    expect(link).toMatch(/^\/t\/start\/[A-Za-z0-9_-]{22}\/1$/);
    const id = link.split("/")[3];
    // What is kept between requests never leaves the server: no seed in the link.
    const [kept] = [...store.values()];
    expect(link).not.toContain(JSON.parse(kept).seed);

    for (const built of [2, 3, 4]) {
      const response = await follow(link);
      expect(response.status).toBe(200);
      page = read(await response.text());
      expect(page.text).toContain(`${built} of 5 questions so far`);
      // A new address at every step, so a fetch tool's cache never serves an old page.
      expect(page.link).toBe(`/t/start/${id}/${built}`);
      link = page.link!;
    }

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const opened = await follow(link);
    expect(opened.status).toBe(303);
    const question = new URL(opened.headers.get("location")!);
    expect(question.pathname).toMatch(/^\/t\/[A-Za-z0-9_.-]+\/1$/);
    const { test, puzzles } = loadLinkTest(question.pathname.split("/")[2]);
    expect(puzzles).toHaveLength(5);
    expect(test.issuedAt).toBe(Date.parse("2030-01-01T00:00:00Z") / 1000);
    expect(test.answerDeadline - test.issuedAt).toBe(5 * SECONDS_PER_QUESTION);

    // Losing the redirect must not lose the test or restart its clock.
    vi.setSystemTime(new Date("2030-01-01T00:01:00Z"));
    clearBuiltLinkTests();
    const again = await follow(link);
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(opened.headers.get("location"));
    const fromEarlierStep = await follow(`/t/start/${id}/1`);
    expect(fromEarlierStep.headers.get("location")).toBe(opened.headers.get("location"));
    vi.setSystemTime(new Date("2030-01-01T02:00:00Z"));
    expect(read(await (await follow(link)).text()).text).toContain("This start link has expired");
  });

  it("opens one test with one deadline when two final requests overlap", async () => {
    let link = read(await (await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 })).text()).link!;
    for (let built = 2; built < 5; built++) link = read(await (await follow(link)).text()).link!;
    const responses = await Promise.all([follow(link), follow(link)]);
    expect(responses.map((response) => response.status)).toEqual([303, 303]);
    expect(responses[0].headers.get("location")).toBe(responses[1].headers.get("location"));
  });

  it.each(["progress", "completion"])("returns the current %s when an older progress write arrives late", async (winner) => {
    const link = read(await (await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 })).text()).link!;
    const { redisCommand } = await import("./redis");
    const execute = vi.mocked(redisCommand).getMockImplementation()!;
    let release!: () => void;
    let reached!: () => void;
    const waitForWrite = new Promise<void>((resolve) => { reached = resolve; });
    const delayedWrite = new Promise<void>((resolve) => { release = resolve; });
    let pause = true;
    vi.mocked(redisCommand).mockImplementation(async (command) => {
      if (pause && (command[0] === "SET" || command[0] === "EVAL")) {
        pause = false;
        reached();
        await delayedWrite;
      }
      return execute(command);
    });
    try {
      const older = follow(link);
      await waitForWrite;
      let current = await openStartedTest(request(link), link.split("/")[3], { budgetMs: winner === "completion" ? Infinity : -1 });
      if (winner === "progress") current = await follow(read(await current.text()).link!);
      release();
      const delayed = await older;
      if (winner === "completion") {
        expect(current.status).toBe(303);
        expect(delayed.status).toBe(303);
        expect(delayed.headers.get("location")).toBe(current.headers.get("location"));
        expect((await follow(link)).headers.get("location")).toBe(current.headers.get("location"));
      } else {
        expect(delayed.status).toBe(200);
        expect(read(await delayed.text()).text).toContain("3 of 5 questions so far");
        expect(JSON.parse([...store.values()][0]).attempts).toHaveLength(3);
      }
    } finally {
      release();
      vi.mocked(redisCommand).mockImplementation(execute);
    }
  });

  it("offers fresh retry links after temporary failures and keeps the same test", async () => {
    let link = read(await (await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 })).text()).link!;
    const { redisCommand } = await import("./redis");
    const kept = [...store.values()][0];
    for (let failure = 0; failure < 2; failure++) {
      vi.mocked(redisCommand).mockRejectedValueOnce(new Error("Temporary Redis failure"));
      const failed = await follow(link);
      expect(failed.status).toBe(200);
      const retry = read(await failed.text()).link!;
      expect(retry).toBeDefined();
      expect(retry).not.toBe(link);
      expect([...store.values()][0]).toBe(kept);
      link = retry;
    }
    const continued = read(await (await follow(link)).text());
    expect(continued.text).toContain("2 of 5 questions so far");
    expect(JSON.parse([...store.values()][0]).seed).toBe(JSON.parse(kept).seed);
  });

  it("recovers an issued token when Redis saved it but its acknowledgement was lost", async () => {
    const link = read(await (await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 })).text()).link!;
    const { redisCommand } = await import("./redis");
    const execute = vi.mocked(redisCommand).getMockImplementation()!;
    vi.mocked(redisCommand)
      .mockImplementationOnce(execute)
      .mockImplementationOnce(async (command) => {
        await execute(command);
        throw new Error("Redis response was lost");
      });
    const failed = await openStartedTest(request(link), link.split("/")[3], { budgetMs: Infinity });
    expect(failed.status).toBe(200);
    const kept = [...store.values()][0];
    const retry = read(await failed.text()).link!;
    const recovered = await follow(retry);
    expect(recovered.status).toBe(303);
    expect(new URL(recovered.headers.get("location")!).pathname.split("/")[2]).toBe(JSON.parse(kept).token);
    expect([...store.values()][0]).toBe(kept);
  });

  it("does not offer a dead continuation when the saved start expires during a build", async () => {
    const link = read(await (await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 })).text()).link!;
    const { redisCommand } = await import("./redis");
    const execute = vi.mocked(redisCommand).getMockImplementation()!;
    vi.mocked(redisCommand)
      .mockImplementationOnce(execute)
      .mockImplementationOnce(async () => { store.clear(); return null; });
    const page = read(await (await follow(link)).text());
    expect(page.text).toContain("This start link has expired");
    expect(page.link).toBeUndefined();
  });

  it("redirects straight to the first question when the whole test builds in one request", async () => {
    const start = await startLinkTest(request("/sample"), "short-5", { budgetMs: 60_000 });
    expect(start.status).toBe(303);
    expect(new URL(start.headers.get("location")!).pathname).toMatch(/^\/t\/[A-Za-z0-9_.-]+\/1$/);
    expect(store.size).toBe(0);
  });

  it("refuses start links it never handed out, or made before the site changed", async () => {
    for (const unknown of ["A".repeat(22), "not-a-start-id", "../../etc"]) {
      const page = await follow(`/t/start/${unknown}`);
      expect(page.status).toBe(200);
      expect(read(await page.text()).text).toContain("This start link has expired");
    }
    const start = read(await (await startLinkTest(request("/test"), "long-30", { budgetMs: -1 })).text());
    expect(start.text).toContain("Your 30-question test is being built: 1 of 30 questions so far.");
    const [[key, kept]] = [...store];
    store.set(key, JSON.stringify({ ...JSON.parse(kept), generatorVersion: `${EXPANDED_GENERATOR_VERSION}-old` }));
    expect(read(await (await follow(start.link!)).text()).text).toContain("This start link has expired");
  });

  it("finishes the test at once and redirects when Redis cannot keep it", async () => {
    const { redisCommand } = await import("./redis");
    vi.mocked(redisCommand)
      .mockImplementationOnce(async () => 1) // the start limit's INCR
      .mockImplementationOnce(async () => 1) // and its EXPIRE
      .mockRejectedValueOnce(new Error("Redis is unavailable"));
    const start = await startLinkTest(request("/sample"), "short-5", { budgetMs: -1 });
    expect(start.status).toBe(303);
    expect(new URL(start.headers.get("location")!).pathname).toMatch(/^\/t\/[A-Za-z0-9_.-]+\/1$/);
  });
});
