import { openStartedTest } from "@/lib/link-start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /t/start/<id> — a test started at /test or /sample: its first question, once it is built. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return openStartedTest(req, (await params).id);
}
