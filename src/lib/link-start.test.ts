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
  return openStartedTest(request(link), link.split("/")[3], { budgetMs: 0 });
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

  it("answers each request quickly, saying how far it got, then opens the test once", async () => {
    const start = await startLinkTest(request("/sample"), "short-5", { budgetMs: 0 });
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

    // One start link, one test.
    const again = read(await (await follow(link)).text());
    expect(again.text).toContain("This start link has expired");
    expect(again.link).toBeUndefined();
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
    const start = read(await (await startLinkTest(request("/test"), "long-30", { budgetMs: 0 })).text());
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
    const start = await startLinkTest(request("/sample"), "short-5", { budgetMs: 0 });
    expect(start.status).toBe(303);
    expect(new URL(start.headers.get("location")!).pathname).toMatch(/^\/t\/[A-Za-z0-9_.-]+\/1$/);
  });
});
