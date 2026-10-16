import { parsePicturePart } from "@/items/picture-puzzle";
import { pictureToPng } from "@/items/puzzle-png";
import { LINK_TEST_HEADERS } from "@/lib/link-start";
import { resolveLinkToken } from "@/lib/link-session";
import { LinkTestError, linkTestQuestion, openLinkToken } from "@/lib/link-test";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /t/<token>/<n>/board/<part>.png — one picture of question n for the
 * in-page test: a stem board (`s<i>`), an option (`o<k>`) or a gate's jigsaw
 * strip (`g<i>-right`, `g<i>-down`). PNG, never SVG: SVG markup is text a
 * program could read instead of looking (docs/plans/leaderboard-integrity.md).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; n: string; part: string }> },
) {
  const { token, n, part } = await params;
  const textHeaders = { ...LINK_TEST_HEADERS, "content-type": "text/plain; charset=utf-8" };
  let puzzle;
  try {
    puzzle = /^[1-9]\d*$/.test(n) ? linkTestQuestion(openLinkToken(await resolveLinkToken(token)), Number(n)) : undefined;
  } catch (error) {
    if (error instanceof LinkTestError && error.code !== "configuration") {
      return new Response(error.message, { status: error.code === "invalid" ? 404 : 410, headers: textHeaders });
    }
    console.error("picture: test could not be loaded —", error);
    return new Response("The picture is temporarily unavailable.", { status: 500, headers: textHeaders });
  }
  const picture = parsePicturePart(part);
  const png = puzzle && picture ? await pictureToPng(puzzle, picture) : null;
  if (!png) return new Response("No such picture.", { status: 404, headers: textHeaders });
  return new Response(Buffer.from(png), {
    headers: {
      ...LINK_TEST_HEADERS,
      "content-type": "image/png",
      // A picture for a token never changes; only this browser keeps it.
      "cache-control": "private, max-age=7200, immutable",
    },
  });
}
