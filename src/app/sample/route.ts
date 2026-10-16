import { linkTestEntry } from "@/lib/link-start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /sample — image access first; the guide's fresh link starts five questions. */
export function GET(req: Request) {
  return linkTestEntry(req, "short-5");
}
