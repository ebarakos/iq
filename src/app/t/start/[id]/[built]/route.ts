import { openStartedTest } from "@/lib/link-start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /t/start/<id>/<built> — a test started at /test or /sample: built further,
 * then its first question. `built` only makes each step's address new (`startedTestPath`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; built: string }> }) {
  return openStartedTest(req, (await params).id);
}
