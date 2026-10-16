import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import { GRACE_WINDOW_SECONDS } from "@/lib/quiz-token";
import { parsePicturePart, picturePaths, toPicturePuzzle } from "@/items/picture-puzzle";
import { pictureToPng } from "@/items/puzzle-png";
import { listLeaderboard } from "@/lib/leaderboard";
import { clearBuiltLinkTests, loadLinkTest, OPTION_LETTERS, pictureImagePath } from "@/lib/link-test";
import * as linkTests from "@/lib/link-test";
import { resolveLinkToken } from "@/lib/link-session";
import { GET as startSample } from "../sample/route";
import { GET as startTest } from "../test/route";
import { GET as openStarted } from "./start/[id]/[built]/route";
import { GET as openLegacyStart } from "./start/[id]/route";
import QuestionPage from "./[token]/[n]/page";
import { GET as puzzleImage } from "./[token]/[n]/puzzle.png/route";
import { GET as pictureImage } from "./[token]/[n]/board/[part]/route";
import PublishPage from "./[token]/publish/[agent]/page";
import ResultPage from "./[token]/result/page";
import ResultStepPage from "./[token]/result/[built]/page";
import { metadata } from "./layout";
import HomePage from "../page";
import { POST as publishFromForm } from "../api/leaderboard/route";

const storage = vi.hoisted(() => ({ values: new Map<string, string>(), ranks: new Map<string, number>() }));
vi.mock("@/lib/redis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/redis")>()),
  redisCommand: vi.fn(async (command: (string | number)[]) => {
    const key = String(command[1]);
    switch (command[0]) {
      case "GET": return storage.values.get(key) ?? null;
      case "GETDEL": {
        const value = storage.values.get(key) ?? null;
        storage.values.delete(key);
        return value;
      }
      case "SET":
        if (command.includes("NX") && storage.values.has(key)) return null;
        if (command.includes("XX") && !storage.values.has(key)) return null;
        storage.values.set(key, String(command[2]));
        return "OK";
      case "EVAL": {
        // Startup uses compare-and-set; leaderboard publication uses its own script.
        if (String(command[1]).includes("local current = redis.call('GET', KEYS[1])")) {
          const stateKey = String(command[3]);
          if (storage.values.get(stateKey) === command[4] || (command[4] === "" && !storage.values.has(stateKey))) {
            storage.values.set(stateKey, String(command[5]));
          }
          return storage.values.get(stateKey) ?? null;
        }
        const [receiptKey, entryKey] = [String(command[3]), String(command[4])];
        if (storage.values.has(entryKey)) return storage.values.get(entryKey);
        if (!storage.values.has(receiptKey)) return null;
        storage.values.set(entryKey, String(command[6]));
        storage.ranks.set(`${command[5]}|${command[8]}`, Number(command[7]));
        return String(command[6]);
      }
      case "ZREVRANGE": return [...storage.ranks].filter(([id]) => id.startsWith(`${key}|`))
        .sort((a, b) => b[1] - a[1]).map(([id]) => id.split("|")[1]);
      case "MGET": return command.slice(1).map((item) => storage.values.get(String(item)) ?? null);
      case "INCR": return 1;
      case "EXPIRE": return 1;
      default: throw new Error("Unexpected Redis command");
    }
  }),
}));
// The publish page reads the caller's address; outside a request there is none.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "iq.example.test" }) }));

/**
 * The link test as a fetcher meets it: start at /sample, read each page as
 * HTML, follow links, and nothing else — no JavaScript, no forms. Each path is
 * dispatched to the route or page Next would serve it with.
 */

const SECRET = "test-only-link-walk-secret-with-at-least-32-characters";
const ORIGIN = "http://localhost";

type Fetched = { status: number; location?: string; contentType?: string; body: string; bytes?: Uint8Array };

async function fetchPath(path: string): Promise<Fetched> {
  const url = new URL(path, ORIGIN);
  const segments = url.pathname.split("/").filter(Boolean);
  const searchParams = Promise.resolve(Object.fromEntries(url.searchParams));
  const asResponse = async (response: Response): Promise<Fetched> => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      location: response.headers.get("location") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
      body: new TextDecoder().decode(bytes),
      bytes,
    };
  };
  if (url.pathname === "/sample") return asResponse(await startSample(new Request(url)));
  if (url.pathname === "/test") return asResponse(await startTest(new Request(url)));
  if (segments[0] === "t" && segments[1] === "start" && segments.length === 3) {
    return asResponse(await openLegacyStart(new Request(url), { params: Promise.resolve({ id: segments[2] }) }));
  }
  if (segments[0] === "t" && segments[1] === "start" && segments.length === 4) {
    return asResponse(await openStarted(new Request(url), {
      params: Promise.resolve({ id: segments[2], built: segments[3] }),
    }));
  }
  if (segments[0] === "t" && segments.length === 5 && segments[3] === "board") {
    return asResponse(await pictureImage(new Request(url), {
      params: Promise.resolve({ token: segments[1], n: segments[2], part: segments[4] }),
    }));
  }
  if (segments[0] === "t" && segments.length === 4 && segments[2] === "publish") {
    return renderPage(() => PublishPage({ params: Promise.resolve({ token: segments[1], agent: segments[3] }) }));
  }
  if (segments[0] === "t" && segments.length === 4 && segments[3] === "puzzle.png") {
    return asResponse(await puzzleImage(new Request(url), {
      params: Promise.resolve({ token: segments[1], n: segments[2] }),
    }));
  }
  if (segments[0] === "t" && segments.length === 3 && segments[2] === "result") {
    return renderPage(() => ResultPage({ params: Promise.resolve({ token: segments[1] }), searchParams }));
  }
  if (segments[0] === "t" && segments.length === 4 && segments[2] === "result") {
    return renderPage(() => ResultStepPage({ params: Promise.resolve({ token: segments[1] }), searchParams }));
  }
  if (segments[0] === "t" && segments.length === 3) {
    return renderPage(() => QuestionPage({ params: Promise.resolve({ token: segments[1], n: segments[2] }), searchParams }));
  }
  throw new Error(`no route for ${path}`);
}

/** Render a page as Next serves it: redirect() throws, and its digest carries the target. */
async function renderPage(page: () => Promise<React.ReactElement>): Promise<Fetched> {
  try {
    return { status: 200, body: renderToStaticMarkup(await page()) };
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT;")) return { status: 307, location: digest.split(";")[2], body: "" };
    throw error;
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
}

/** Every link on a page, as [text, href]. */
function links(html: string): [string, string][] {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)]
    .map((match) => [match[2].replace(/<[^>]+>/g, "").trim(), decodeEntities(match[1])]);
}

/** The links a crawler may follow: those without `rel="nofollow"`. */
function followable(html: string): string[] {
  return [...html.matchAll(/<a [^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => !/\brel="nofollow"/.test(tag))
    .map((tag) => decodeEntities(tag.match(/href="([^"]+)"/)?.[1] ?? ""));
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

// Each walk renders real pictures or builds a 30-question test, which can pass
// 5 s when the whole suite shares the machine.
describe("the link test, followed link by link", { timeout: 30_000 }, () => {
  beforeEach(() => {
    storage.values.clear();
    storage.ranks.clear();
    vi.clearAllMocks();
    vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
    vi.stubEnv("WITHDRAWN_FAMILY_IDS", "");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("keeps canonical start links untimed until the agent chooses a fresh start", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://redis.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "test-only-token");
    const { redisCommand } = await import("@/lib/redis");
    for (const path of ["/test", "/sample"]) {
      const response = await fetchPath(path);
      expect(response.status).toBe(303);
      expect(response.location).toBe("http://localhost/agents");
    }
    expect(redisCommand).not.toHaveBeenCalled();
  });

  it("walks /sample to a scored result", async () => {
    const start = await fetchPath("/sample?new=walk");
    expect(start.status).toBe(303);
    const first = new URL(start.location!);
    expect(first.pathname).toMatch(/^\/t\/[A-Za-z0-9_.-]+\/1$/);
    const token = first.pathname.split("/")[2];

    // The walker answers from the key, so the expected score is known: the
    // first question right, the second skipped, the third wrong, the rest right.
    const { puzzles } = loadLinkTest(token);
    expect(puzzles).toHaveLength(5);
    // As on a server that did not start the test: each page builds its own question.
    clearBuiltLinkTests();
    const plan = puzzles.map((puzzle, index) =>
      index === 1 ? null : index === 2 ? (puzzle.answerIndex + 1) % puzzle.options.length : puzzle.answerIndex);

    let path = first.pathname + first.search;
    for (const [index, choice] of plan.entries()) {
      const page = await fetchPath(path);
      expect(page.status).toBe(200);
      const pageText = text(page.body);
      expect(pageText).toContain(`Question ${index + 1} of 5`);
      expect(pageText).toMatch(/Answer every question by \d\d:\d\d:\d\d UTC ?\. \d+ seconds are left/);
      // The puzzle is a picture, never markup a reader could parse.
      expect(page.body).not.toContain("<svg");
      expect(page.body).toContain(`alt="Question ${index + 1} puzzle"`);
      // A crawler may leave for the home page, never walk deeper into the test.
      expect(followable(page.body)).toEqual(["/"]);
      const image = await fetchPath(`/t/${token}/${index + 1}/puzzle.png`);
      expect(image.status).toBe(200);
      expect(image.contentType).toBe("image/png");
      expect([...image.bytes!.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

      const answerLinks = links(page.body).filter(([label]) => label.startsWith("Option ") || label === "Skip");
      expect(answerLinks.map(([label]) => label)).toEqual([
        ...OPTION_LETTERS.slice(0, OPTIONS_PER_ITEM).map((letter) => `Option ${letter}`),
        "Skip",
      ]);
      const [, href] = choice === null
        ? answerLinks[answerLinks.length - 1]
        : answerLinks[choice];
      path = href;
    }

    expect(path).toMatch(new RegExp(`^/t/${token}/result\\?a=[A-F]-[A-F]{3}$`));
    const result = await fetchPath(path);
    const resultText = text(result.body);
    expect(resultText).toContain("3 of 5 correct");
    expect(resultText).not.toContain("Marked late");
    expect(resultText).toContain("Skipped");
    expect(resultText).toContain(`the answer is ${OPTION_LETTERS[puzzles[2].answerIndex]}`);
    for (const puzzle of puzzles) expect(resultText).toContain(puzzle.explanation);
    expect(links(result.body).some(([label, href]) => label.startsWith("Take a new") && href.startsWith("/sample?new="))).toBe(true);
    expect(followable(result.body)).toEqual(["/"]);
  });

  it("takes a 30-question test through a URL-caching fetcher, including an older start link", async () => {
    // A 30-question build outlasted ChatGPT's fetch tool (2026-10-15). With
    // Redis, each request builds for a moment and links to the next part.
    vi.stubEnv("KV_REST_API_URL", "https://redis.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "test-only-token");
    const cache = new Map<string, Fetched>();
    const cachedFetch = async (path: string) => {
      expect(new URL(path, "https://iq.ebarakos.com").href.length).toBeLessThanOrEqual(250);
      if (!cache.has(path)) cache.set(path, await fetchPath(path));
      const response = cache.get(path)!;
      if (!response.contentType?.startsWith("image/")) {
        for (const href of [...links(response.body).map(([, href]) => href),
          ...[...response.body.matchAll(/src="([^"]+)"/g)].map((match) => match[1])]) {
          expect(new URL(href, "https://iq.ebarakos.com").href.length).toBeLessThanOrEqual(250);
        }
        expect(response.body).not.toContain("l1.");
      }
      return response;
    };
    let response = await cachedFetch("/test?new=walk");
    expect(response.status).toBe(200);
    const [[label, firstHref], ...others] = links(response.body);
    expect(others).toEqual([]);
    expect(label).toBe("Continue to the test");
    expect(firstHref).toMatch(/^\/t\/start\/[A-Za-z0-9_-]{22}\/\d+$/);
    expect(followable(response.body)).toEqual([]);
    const id = firstHref.split("/")[3];

    const built: number[] = [];
    let lastHref = "";
    while (response.status === 200) {
      const count = Number(text(response.body).match(/(\d+) of 30 questions so far/)![1]);
      built.push(count);
      // Each page links to a new address: a fetch tool that caches by address
      // showed ChatGPT the same page again and again (2026-10-16).
      const [[, href]] = links(response.body);
      expect(href).toBe(`/t/start/${id}/${count}`);
      expect(cache.has(href)).toBe(false);
      // Sessions issued before the last fix used this shorter path, including
      // the reported /t/start/LTeIwVLO3ONw0CIMMqWo2g?utm_source=chatgpt.com.
      lastHref = built.length === 1 ? `/t/start/${id}?utm_source=chatgpt.com` : href;
      response = await cachedFetch(lastHref);
      expect(built.length).toBeLessThan(30);
    }
    expect(built.length).toBeGreaterThan(1);
    expect(new Set(built).size).toBe(built.length);
    expect(built).toEqual([...built].sort((a, b) => a - b));
    expect(response.status).toBe(303);
    // A timeout after opening the test can safely retry either start address.
    expect((await fetchPath(lastHref)).location).toBe(response.location);
    expect((await fetchPath(`/t/start/${id}`)).location).toBe(response.location);
    const first = new URL(response.location!);
    expect(first.pathname.split("/")[2]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    let path = first.pathname + first.search;
    for (let question = 1; question <= 30; question++) {
      const page = await cachedFetch(path);
      expect(page.status).toBe(200);
      expect(text(page.body)).toContain(`Question ${question} of 30`);
      if ([1, 19, 30].includes(question)) {
        const image = page.body.match(/src="([^"]+puzzle\.png)"/)![1];
        const picture = await cachedFetch(image);
        expect(picture.contentType).toBe("image/png");
        expect([...picture.bytes!.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        const board = await cachedFetch(image.replace("puzzle.png", "board/o0.png"));
        expect(board.contentType).toBe("image/png");
      }
      path = links(page.body).find(([label]) => label === "Skip")![1];
    }
    // A result may land on a different server from every question and image.
    clearBuiltLinkTests();
    let result = await cachedFetch(path);
    const calculationPaths = new Set<string>([path]);
    while (text(result.body).includes("Calculating your result")) {
      expect(result.body).not.toContain("incorrect; the answer is");
      const next = links(result.body).find(([label]) => label === "Continue to your result")![1];
      expect(calculationPaths.has(next)).toBe(false);
      calculationPaths.add(next);
      expect(calculationPaths.size).toBeLessThanOrEqual(30);
      clearBuiltLinkTests();
      result = await cachedFetch(next);
    }
    expect(calculationPaths.size).toBeGreaterThan(1);
    expect(result.status).toBe(200);
    expect(text(result.body)).toContain("0 of 30 correct");
  });

  it("keeps the first result on retries and rejects changed answers after revealing the review", async () => {
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    const { test } = loadLinkTest(token);
    const path = `/t/${token}/result?a=-----`;
    const original = text((await fetchPath(path)).body);
    expect(original).toContain("0 of 5 correct");
    vi.useFakeTimers();
    vi.setSystemTime((test.answerDeadline + GRACE_WINDOW_SECONDS + 5) * 1000);
    expect(text((await fetchPath(path)).body)).toBe(original);
    const changed = text((await fetchPath(`/t/${token}/result?a=AAAAA`)).body);
    expect(changed).toContain("already submitted with different answers");
    expect(changed).not.toContain("Review");
    expect(changed).not.toContain("the answer is");
  });

  it("recovers a saved result on a cold server without rebuilding the test", async () => {
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    const path = `/t/${token}/result?a=-----`;
    const original = text((await fetchPath(path)).body);
    expect(original).toContain("0 of 5 correct");
    clearBuiltLinkTests();
    const rebuild = vi.spyOn(linkTests, "loadLinkTest").mockImplementation(() => {
      throw new Error("A saved result must not rebuild the test");
    });
    const question = vi.spyOn(linkTests, "linkTestQuestion");
    try {
      expect(text((await fetchPath(path)).body)).toBe(original);
      expect(rebuild).not.toHaveBeenCalled();
      expect(question).not.toHaveBeenCalled();
    } finally {
      rebuild.mockRestore();
      question.mockRestore();
    }
  });

  it("reveals no review when Redis fails and recovers when retried", async () => {
    const { redisCommand } = await import("@/lib/redis");
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    const path = `/t/${token}/result?a=-----`;
    vi.mocked(redisCommand).mockRejectedValueOnce(new Error("Redis is unavailable"));
    const failed = text((await fetchPath(path)).body);
    expect(failed).toContain("Scoring is temporarily unavailable");
    expect(failed).toContain("Retry submission");
    expect(failed).not.toContain("Review");
    expect(text((await fetchPath(path)).body)).toContain("0 of 5 correct");
  });

  it.each(["true", "false"])("shows link-result points, ranking them only while the board is on (LEADERBOARD_ENABLED=%s)", async (flag) => {
    vi.stubEnv("LEADERBOARD_ENABLED", flag);
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuedAt = Math.floor(Date.now() / 1000);
    const start = await fetchPath("/test?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    const { puzzles } = loadLinkTest(token);
    const answers = puzzles.map((puzzle) => OPTION_LETTERS[puzzle.answerIndex]).join("");
    vi.setSystemTime((issuedAt + 1200) * 1000);
    const result = text((await fetchPath(`/t/${token}/result?a=${answers}`)).body);
    expect(result).toContain("30 of 30 correct");
    expect(result).toContain("3,250 points");
    expect(result).toContain("A time bonus of up to 25% is added to your correct-answer points.");
    const receipt = [...storage.values.values()].map((raw) => JSON.parse(raw)).find((value) => value.response);
    expect(receipt.response.leaderboardEligible).toBe(flag === "true");
  });

  it("publishes a 30-question link result as an agent by following its name's link, once", async () => {
    vi.stubEnv("LEADERBOARD_ENABLED", "true");
    vi.stubEnv("KV_REST_API_URL", "https://redis.example.test");
    vi.stubEnv("KV_REST_API_TOKEN", "test-only-token");
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuedAt = Math.floor(Date.now() / 1000);
    const reference = new URL((await fetchPath("/test?new=walk")).location!).pathname.split("/")[2];
    const token = await resolveLinkToken(reference);
    expect(reference).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const { puzzles } = loadLinkTest(token);
    const answers = puzzles.map((puzzle, index) => OPTION_LETTERS[index < 27 ? puzzle.answerIndex : (puzzle.answerIndex + 1) % 6]).join("");
    vi.setSystemTime((issuedAt + 900) * 1000);
    const result = await fetchPath(`/t/${reference}/result?a=${answers}`);
    expect(text(result.body)).toContain("27 of 30 correct");
    const publishLinks = links(result.body).filter(([label]) => label.startsWith("Publish as "));
    for (const [, href] of publishLinks) {
      expect(href).toContain(`/t/${reference}/publish/`);
      expect(new URL(href, "https://iq.ebarakos.com").href.length).toBeLessThanOrEqual(250);
    }
    expect(publishLinks.map(([label]) => label)).toContain("Publish as Claude");
    expect(followable(result.body)).toEqual(["/"]);

    const [, claude] = publishLinks.find(([label]) => label === "Publish as Claude")!;
    const published = text((await fetchPath(claude)).body);
    expect(published).toContain("Published as Claude");
    expect(published).toContain("27 of 30 correct");
    const [, chatgpt] = publishLinks.find(([label]) => label === "Publish as ChatGPT")!;
    expect(text((await fetchPath(chatgpt)).body)).toContain("already published");
    expect((await listLeaderboard()).map(({ nickname, kind, correct }) => ({ nickname, kind, correct })))
      .toEqual([{ nickname: "Claude", kind: "agent", correct: 27 }]);
    // The original token and the short reference share one receipt and publication.
    expect(text((await fetchPath(`/t/${token}/publish/claude`)).body)).toContain("Published as Claude");
    expect(text((await fetchPath(`/t/${token}/result?a=${"A".repeat(30)}`)).body)).toContain("already submitted with different answers");
    expect(text((await fetchPath(`/t/${token}/publish/someone-else`)).body)).toContain("cannot be published here");
  });

  it("reports the saved row's own tag when the form published the result first", async () => {
    vi.stubEnv("LEADERBOARD_ENABLED", "true");
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = new URL((await fetchPath("/test?new=walk")).location!).pathname.split("/")[2];
    const { puzzles } = loadLinkTest(token);
    vi.setSystemTime((issuedAt + 900) * 1000);
    await fetchPath(`/t/${token}/result?a=${puzzles.map((puzzle) => OPTION_LETTERS[puzzle.answerIndex]).join("")}`);
    const form = await publishFromForm(new Request("http://localhost/api/leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quizToken: token, nickname: "Claude", kind: "person" }),
    }));
    expect(form.status).toBe(200);
    const page = text((await fetchPath(`/t/${token}/publish/claude`)).body);
    expect(page).toContain("already published");
    expect(page).toContain("as Claude, tagged Person");
    expect(page).not.toContain("tagged AI agent");
  });

  it("offers no publication for a 30-question test finished in under two minutes", async () => {
    vi.stubEnv("LEADERBOARD_ENABLED", "true");
    const token = new URL((await fetchPath("/test?new=walk")).location!).pathname.split("/")[2];
    const { puzzles } = loadLinkTest(token);
    const answers = puzzles.map((puzzle) => OPTION_LETTERS[puzzle.answerIndex]).join("");
    const result = await fetchPath(`/t/${token}/result?a=${answers}`);
    expect(text(result.body)).toContain("took at least 2 minutes");
    expect(links(result.body).some(([label]) => label.startsWith("Publish as "))).toBe(false);
  });

  it("draws every picture the in-page test names, and nothing it does not", async () => {
    const token = new URL((await fetchPath("/test?new=walk")).location!).pathname.split("/")[2];
    const { puzzles } = loadLinkTest(token);
    // As on a server that did not start the test: each question is built alone
    // when its pictures are asked for, and must draw exactly what the test holds.
    clearBuiltLinkTests();
    const layouts = new Set<string>();
    for (const [index, puzzle] of puzzles.entries()) {
      layouts.add(puzzle.layout);
      const picture = toPicturePuzzle(puzzle, (part) => pictureImagePath(token, index + 1, part));
      for (const path of picturePaths(picture)) {
        const image = await fetchPath(path);
        expect(image.status, path).toBe(200);
        expect(image.contentType).toBe("image/png");
        const expected = await pictureToPng(puzzle, parsePicturePart(path.split("/").pop()!)!);
        expect(Buffer.from(image.bytes!).equals(Buffer.from(expected!)), path).toBe(true);
      }
    }
    expect(layouts.size).toBeGreaterThan(2);
    for (const part of ["s99.png", "o6.png", "x1.png", "s1.svg"]) {
      expect((await fetchPath(`/t/${token}/1/board/${part}`)).status).toBe(404);
    }
  }, 120_000);

  it("keeps the agent entry discoverable without the long instructions on the home page", async () => {
    const home = renderToStaticMarkup(await HomePage());
    const note = text(home);
    expect(links(home)).toContainEqual(["Agent access", "/agents"]);
    expect(note).not.toContain("can take the test without JavaScript");
    expect(note).not.toContain("While a test is being built");
    // Like every link into a test, the note's links are not for crawlers.
    expect(followable(home)).not.toContain("/test");
    expect(followable(home)).not.toContain("/sample");
  });

  it("starts a 30-question test at /test", async () => {
    const start = await fetchPath("/test?new=walk");
    expect(start.status).toBe(303);
    const page = await fetchPath(new URL(start.location!).pathname);
    expect(text(page.body)).toContain("Question 1 of 30");
  });

  it("sends a link with the wrong number of answers to the question they lead to", async () => {
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    expect((await fetchPath(`/t/${token}/4?a=B`)).location).toBe(`/t/${token}/2?a=B`);
    expect((await fetchPath(`/t/${token}/2?a=BCDEA`)).location).toBe(`/t/${token}/result?a=BCDEA`);
    expect(text((await fetchPath(`/t/${token}/2?a=Z`)).body)).toContain("These answers cannot be read");
    expect(text((await fetchPath(`/t/${token}/result?a=BC`)).body)).toContain("This test is not finished");
  });

  it("tells a reader why a link cannot be used, and offers only a new test to follow", async () => {
    for (const path of ["/t/not-a-token/1", "/t/not-a-token/result?a=AAAAA"]) {
      const page = await fetchPath(path);
      expect(text(page.body)).toContain("This test link is not valid");
      expect(links(page.body).some(([, href]) => href.startsWith("/sample?new="))).toBe(true);
      expect(followable(page.body)).toEqual(["/"]);
    }
  });

  it("says when a test has expired", async () => {
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    const { test } = loadLinkTest(token);
    vi.useFakeTimers();
    vi.setSystemTime(test.expiresAt * 1000);
    expect(text((await fetchPath(`/t/${token}/1`)).body)).toContain("This test has expired");
    expect(text((await fetchPath(`/t/${token}/result?a=-----`)).body)).toContain("This test has expired");
  });

  it("keeps the pages out of search results and crawlers' link walks", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("ends the test at the deadline and marks a late result", async () => {
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    const { test } = loadLinkTest(token);

    vi.useFakeTimers();
    vi.setSystemTime((test.answerDeadline + GRACE_WINDOW_SECONDS + 5) * 1000);
    const page = await fetchPath(`/t/${token}/3?a=AB`);
    expect(text(page.body)).toContain("Time is up");
    const [, resultHref] = links(page.body).find(([label]) => label === "See your result")!;
    expect(resultHref).toBe(`/t/${token}/result?a=AB---`);
    const result = text((await fetchPath(resultHref)).body);
    expect(result).toContain(`Marked late: these answers arrived ${GRACE_WINDOW_SECONDS + 5} seconds after the deadline`);
  });

  it("tells a taker when the site has changed under their test", async () => {
    const start = await fetchPath("/sample?new=walk");
    const token = new URL(start.location!).pathname.split("/")[2];
    vi.stubEnv("WITHDRAWN_FAMILY_IDS", "some-withdrawn-family");
    const page = await fetchPath(`/t/${token}/1`);
    expect(text(page.body)).toContain("The site has changed since this test started");
    expect(links(page.body).some(([, href]) => href.startsWith("/sample?new="))).toBe(true);
  });
});
