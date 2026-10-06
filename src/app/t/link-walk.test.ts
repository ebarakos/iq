import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import { GRACE_WINDOW_SECONDS } from "@/lib/quiz-token";
import { loadLinkTest, OPTION_LETTERS } from "@/lib/link-test";
import { GET as startSample } from "../sample/route";
import { GET as startTest } from "../test/route";
import QuestionPage from "./[token]/[n]/page";
import { GET as puzzleImage } from "./[token]/[n]/puzzle.png/route";
import ResultPage from "./[token]/result/page";

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
  if (url.pathname === "/sample") return asResponse(startSample(new Request(url)));
  if (url.pathname === "/test") return asResponse(startTest(new Request(url)));
  if (segments[0] === "t" && segments.length === 4 && segments[3] === "puzzle.png") {
    return asResponse(await puzzleImage(new Request(url), {
      params: Promise.resolve({ token: segments[1], n: segments[2] }),
    }));
  }
  if (segments[0] === "t" && segments.length === 3 && segments[2] === "result") {
    const page = await ResultPage({ params: Promise.resolve({ token: segments[1] }), searchParams });
    return { status: 200, body: renderToStaticMarkup(page) };
  }
  if (segments[0] === "t" && segments.length === 3) {
    try {
      const page = await QuestionPage({ params: Promise.resolve({ token: segments[1], n: segments[2] }), searchParams });
      return { status: 200, body: renderToStaticMarkup(page) };
    } catch (error) {
      // next/navigation's redirect() throws; its digest carries the target.
      const digest = String((error as { digest?: unknown }).digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT;")) return { status: 307, location: digest.split(";")[2], body: "" };
      throw error;
    }
  }
  throw new Error(`no route for ${path}`);
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
}

/** Every link on a page, as [text, href]. */
function links(html: string): [string, string][] {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)]
    .map((match) => [match[2].replace(/<[^>]+>/g, "").trim(), decodeEntities(match[1])]);
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

describe("the link test, followed link by link", () => {
  beforeEach(() => {
    vi.stubEnv("QUIZ_TOKEN_SECRET", SECRET);
    vi.stubEnv("WITHDRAWN_FAMILY_IDS", "");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("walks /sample to a scored result", async () => {
    const start = await fetchPath("/sample");
    expect(start.status).toBe(303);
    const first = new URL(start.location!);
    expect(first.pathname).toMatch(/^\/t\/[A-Za-z0-9_.-]+\/1$/);
    const token = first.pathname.split("/")[2];

    // The walker answers from the key, so the expected score is known: the
    // first question right, the second skipped, the third wrong, the rest right.
    const { puzzles } = loadLinkTest(token);
    expect(puzzles).toHaveLength(5);
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
    expect(links(result.body).some(([label, href]) => label.startsWith("Take a new") && href === "/sample")).toBe(true);
  });

  it("starts a 30-question test at /test", async () => {
    const start = await fetchPath("/test");
    expect(start.status).toBe(303);
    const page = await fetchPath(new URL(start.location!).pathname);
    expect(text(page.body)).toContain("Question 1 of 30");
  });

  it("sends a link with the wrong number of answers to the question they lead to", async () => {
    const start = await fetchPath("/sample");
    const token = new URL(start.location!).pathname.split("/")[2];
    expect((await fetchPath(`/t/${token}/4?a=B`)).location).toBe(`/t/${token}/2?a=B`);
    expect((await fetchPath(`/t/${token}/2?a=BCDEA`)).location).toBe(`/t/${token}/result?a=BCDEA`);
    expect(text((await fetchPath(`/t/${token}/2?a=Z`)).body)).toContain("These answers cannot be read");
    expect(text((await fetchPath(`/t/${token}/result?a=BC`)).body)).toContain("This test is not finished");
    expect(text((await fetchPath("/t/not-a-token/1")).body)).toContain("This test link is not valid");
  });

  it("ends the test at the deadline and marks a late result", async () => {
    const start = await fetchPath("/sample");
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
    const start = await fetchPath("/sample");
    const token = new URL(start.location!).pathname.split("/")[2];
    vi.stubEnv("WITHDRAWN_FAMILY_IDS", "some-withdrawn-family");
    const page = await fetchPath(`/t/${token}/1`);
    expect(text(page.body)).toContain("The site has changed since this test started");
    expect(links(page.body).some(([, href]) => href === "/sample")).toBe(true);
  });
});
