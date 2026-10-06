import { startLinkTest } from "@/lib/link-start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /test — a fresh 30-question test, as links: redirects to its first question. */
export function GET(req: Request) {
  return startLinkTest(req, "long-30");
}
