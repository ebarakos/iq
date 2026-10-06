import { puzzleToPng } from "@/items/puzzle-png";
import { LINK_TEST_HEADERS } from "@/lib/link-start";
import { LinkTestError, loadLinkTest } from "@/lib/link-test";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /t/<token>/<n>/puzzle.png — question n as a picture: the agent channel's
 * standalone SVG (stem plus options lettered A–F), rasterized here.
 *
 * A PNG, never SVG: SVG markup is text, and a reader would get every shape's
 * fill and position without looking, which breaks the visual-only rule.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; n: string }> },
) {
  const { token, n } = await params;
  const textHeaders = { ...LINK_TEST_HEADERS, "content-type": "text/plain; charset=utf-8" };
  let puzzles;
  try {
    ({ puzzles } = loadLinkTest(token));
  } catch (error) {
    if (error instanceof LinkTestError && error.code !== "configuration") {
      return new Response(error.message, { status: error.code === "invalid" ? 404 : 410, headers: textHeaders });
    }
    console.error("link-test: puzzle image failed —", error);
    return new Response("The puzzle image is temporarily unavailable.", { status: 500, headers: textHeaders });
  }
  const index = /^[1-9]\d*$/.test(n) ? Number(n) - 1 : -1;
  const puzzle = puzzles[index];
  if (!puzzle) return new Response("No such question.", { status: 404, headers: textHeaders });

  const png = await puzzleToPng(puzzle);
  return new Response(Buffer.from(png), {
    headers: {
      ...LINK_TEST_HEADERS,
      "content-type": "image/png",
      // The picture for a token and question never changes; only this browser keeps it.
      "cache-control": "private, max-age=7200, immutable",
    },
  });
}
