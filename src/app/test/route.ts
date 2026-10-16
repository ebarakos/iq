import { linkTestEntry } from "@/lib/link-start";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /test — image access first; the guide's fresh link starts thirty questions. */
export function GET(req: Request) {
  return linkTestEntry(req, "long-30");
}
