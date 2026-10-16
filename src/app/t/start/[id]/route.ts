import { openStartedTest } from "@/lib/link-start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Keep links issued before progress was added to the path usable. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return openStartedTest(req, (await params).id);
}
