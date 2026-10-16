import { randomBytes } from "node:crypto";
import { z } from "zod";
import { questionCount, type ExpandedProfile } from "@/items/expanded-quiz";
import { quizNamespace } from "./leaderboard-config";
import {
  beginLinkTest,
  continueLinkTest,
  createLinkTest,
  issueLinkTest,
  LinkTestError,
  LinkTestProgressSchema,
  openLinkToken,
  questionPath,
  type LinkTestProgress,
} from "./link-test";
import { startAllowed } from "./rate-limit";
import { redisCommand, redisConfigured } from "./redis";

/**
 * Headers every link-test response sets itself: never cached. `next.config.ts`
 * adds `X-Robots-Tag` to every link-test URL, pages included.
 */
export const LINK_TEST_HEADERS = {
  "cache-control": "no-store",
} as const;

/*
 * Building a 30-question test takes 7–9 s on the production server, longer than
 * a chat agent's fetch tool waits for one page (ChatGPT's gave up, 2026-10-15).
 * So with Redis each request builds for a moment and, if the test is not done,
 * saves how far it got and answers with a link that builds the next part. The
 * request that finishes it starts the clock and opens the first question. No
 * work runs after a response, so no request waits behind another's build.
 */
/**
 * How long one request builds before it answers. With Redis and a cold start
 * on top, a production request takes about a second more (a 1.5 s budget
 * gave 3.3 s, 2026-10-16), and ChatGPT's tool gave up on some of those.
 */
const BUILD_BUDGET_MS = 1_200;
/** How long a test being built waits for its next request. */
const PROGRESS_SECONDS = 600;

const StartedTestSchema = z.union([
  LinkTestProgressSchema,
  z.object({ token: z.string().min(1) }),
]);

// Concurrent or retried requests may read the same progress. Save only if
// nothing newer was saved; return the winner, including its one issued token.
const SAVE_START = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return ARGV[2]
end
return current
`;

/** A seam for tests. A server uses the default. */
export interface StartOptions {
  budgetMs?: number;
}

function startKey(id: string): string {
  return `${quizNamespace()}:start:${id}`;
}

/**
 * Where a test started at /test or /sample is built further, then opened. The
 * number of questions built so far is in the path only so each page links to a
 * new address: a fetch tool that caches pages by address showed ChatGPT the
 * same "19 of 30" page again and again (2026-10-16). The server ignores it.
 */
export function startedTestPath(id: string, built: number): string {
  return `/t/start/${id}/${built}`;
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...LINK_TEST_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}

/** A plain page a fetcher reads as HTML. `refresh` moves a person on without JavaScript. */
function htmlPage(status: number, title: string, body: string, refresh?: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? `<meta http-equiv="refresh" content="1;url=${refresh}">\n` : ""}<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#111827;background:#fff}a{color:inherit}</style>
</head><body><h1>${title}</h1>
${body}
</body></html>`;
  return new Response(html, { status, headers: { ...LINK_TEST_HEADERS, "content-type": "text/html; charset=utf-8" } });
}

function buildingPage(progress: LinkTestProgress, id: string): Response {
  const path = startedTestPath(id, progress.attempts.length);
  const total = questionCount(progress.profile);
  return htmlPage(200, "Building your test", [
    `<p>Your ${total}-question test is being built: ${progress.attempts.length} of ${total} questions so far. ` +
      "Each visit to the link below builds more of it. Your time starts only when the first question opens.</p>",
    `<p><a href="${path}" rel="nofollow">Continue to the test</a></p>`,
  ].join("\n"), path);
}

function expiredPage(): Response {
  return htmlPage(200, "This start link has expired", [
    "<p>It waited more than 10 minutes while building, its test expired, or the site changed.</p>",
    `<p>Start a new test: <a href="/test" rel="nofollow">30 questions</a> or <a href="/sample" rel="nofollow">5 questions</a>.</p>`,
  ].join("\n"));
}

function failedPage(id: string): Response {
  // A fetcher must be able to read the retry link, even after a transient
  // failure. Give it a fresh address so a cached failure cannot repeat forever.
  const retry = `/t/start/${id}/retry-${randomBytes(8).toString("base64url")}`;
  return htmlPage(200, "Could not continue this test", [
    "<p>Something went wrong while building it. Try continuing this test again.</p>",
    `<p><a href="${retry}" rel="nofollow">Continue to the test</a></p>`,
  ].join("\n"));
}

function firstQuestion(req: Request, token: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...LINK_TEST_HEADERS, location: new URL(questionPath(token, 1, []), req.url).toString() },
  });
}

function savedStartResponse(req: Request, id: string, stored: string | null): Response {
  if (stored === null) return expiredPage();
  const parsed = StartedTestSchema.safeParse(JSON.parse(stored));
  if (!parsed.success) return expiredPage();
  if ("token" in parsed.data) {
    // Check expiry and site changes, without rebuilding any questions. A retry
    // reuses the exact token, so it cannot reset the clock or get a new score.
    openLinkToken(parsed.data.token);
    return firstQuestion(req, parsed.data.token);
  }
  return buildingPage(parsed.data, id);
}

function logStartError(error: unknown): void {
  if (error instanceof LinkTestError && error.code === "configuration") {
    console.error("link-test: token configuration error —", error.message);
  } else {
    console.error("link-test: could not create a test —", error);
  }
}

/**
 * `GET /sample` and `GET /test`: make a fresh link test for a fetcher that
 * follows links and runs no JavaScript (docs/plans/link-only-test.md), and
 * redirect to its first question, or to a page that builds the rest.
 */
export async function startLinkTest(req: Request, profile: ExpandedProfile, options: StartOptions = {}): Promise<Response> {
  if (!(await startAllowed(req.headers))) {
    return textResponse(429, "Too many tests started from this address. Please wait a few minutes and try again.");
  }
  try {
    // Without Redis there is nowhere to keep a half-built test: build it all here.
    if (!redisConfigured()) return firstQuestion(req, createLinkTest(profile).token);
    const step = continueLinkTest(beginLinkTest(profile), options.budgetMs ?? BUILD_BUDGET_MS);
    if ("draft" in step) return firstQuestion(req, issueLinkTest(step.draft).token);
    const id = randomBytes(16).toString("base64url");
    try {
      await redisCommand(["SET", startKey(id), JSON.stringify(step.progress), "EX", PROGRESS_SECONDS]);
    } catch (error) {
      console.error("link-test: could not keep a test being built, finishing it now —",
        error instanceof Error ? error.message : error);
      const rest = continueLinkTest(step.progress, Number.POSITIVE_INFINITY);
      if ("draft" in rest) return firstQuestion(req, issueLinkTest(rest.draft).token);
      throw new Error("an unlimited build left questions unbuilt");
    }
    return buildingPage(step.progress, id);
  } catch (error) {
    logStartError(error);
    return textResponse(500, "Could not create a test. Please try again.");
  }
}

/**
 * `GET /t/start/<id>/<built>`: build more of a started test. Once it is complete,
 * start its clock and redirect to its first question. Retries recover the
 * same token and deadline, including when the first redirect was lost.
 */
export async function openStartedTest(req: Request, id: string, options: StartOptions = {}): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !redisConfigured()) return expiredPage();
  const key = startKey(id);
  try {
    const stored = await redisCommand<string | null>(["GET", key]);
    if (stored === null) return expiredPage();
    const progress = StartedTestSchema.safeParse(JSON.parse(stored));
    if (!progress.success) return expiredPage();
    if ("token" in progress.data) return savedStartResponse(req, id, stored);
    const step = continueLinkTest(progress.data, options.budgetMs ?? BUILD_BUDGET_MS);
    let next: string;
    let ttl = PROGRESS_SECONDS;
    if ("draft" in step) {
      const issued = issueLinkTest(step.draft);
      next = JSON.stringify({ token: issued.token });
      ttl = Math.max(1, issued.test.expiresAt - Math.floor(Date.now() / 1000));
    } else {
      next = JSON.stringify(step.progress);
    }
    const saved = await redisCommand<string | null>(["EVAL", SAVE_START, 1, key, stored, next, ttl]);
    return savedStartResponse(req, id, saved);
  } catch (error) {
    if (error instanceof LinkTestError && error.code !== "configuration") return expiredPage();
    logStartError(error);
    return failedPage(id);
  }
}
