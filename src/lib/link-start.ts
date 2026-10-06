import type { ExpandedProfile } from "@/items/expanded-quiz";
import { createLinkTest, LinkTestError, questionPath } from "./link-test";

/** Headers every link-test response carries: never cached, never indexed, still crawlable. */
export const LINK_TEST_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
} as const;

/**
 * `GET /sample` and `GET /test`: make a fresh link test and send the taker to
 * its first question. A plain redirect, so a fetcher that follows links and
 * runs no JavaScript can start a test (docs/plans/link-only-test.md).
 */
export function startLinkTest(req: Request, profile: ExpandedProfile): Response {
  try {
    const { token } = createLinkTest(profile);
    return new Response(null, {
      status: 303,
      headers: { ...LINK_TEST_HEADERS, location: new URL(questionPath(token, 1, []), req.url).toString() },
    });
  } catch (error) {
    if (error instanceof LinkTestError && error.code === "configuration") {
      console.error("link-test: token configuration error —", error.message);
    } else {
      console.error("link-test: could not create a test —", error);
    }
    return new Response("Could not create a test. Please try again.", {
      status: 500,
      headers: { ...LINK_TEST_HEADERS, "content-type": "text/plain; charset=utf-8" },
    });
  }
}
