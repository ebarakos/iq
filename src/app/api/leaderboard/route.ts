import { NextResponse } from "next/server";
import { z } from "zod";
import { leaderboardEnabled } from "@/lib/leaderboard-config";
import { LeaderboardEligibilityError, publishLeaderboardEntry } from "@/lib/leaderboard";
import { TAKER_KINDS } from "@/lib/leaderboard-types";
import { LinkTestError, openLinkToken } from "@/lib/link-test";
import { checkNickname } from "@/lib/nickname";
import { clientAddress, withinRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EntrySchema = z.object({
  quizToken: z.string().min(1),
  nickname: z.string(),
  kind: z.enum(TAKER_KINDS),
});

/**
 * POST /api/leaderboard — publish a scored result under a nickname, tagged
 * Person or AI agent. `/leaderboard` reads the ranking itself.
 */
export async function POST(req: Request) {
  if (!leaderboardEnabled()) return NextResponse.json({ message: "Not found." }, { status: 404 });
  const parsed = EntrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Enter a nickname and say whether you are a person or an AI agent." }, { status: 400 });
  }
  // Authenticate and enforce token expiry before any storage call, even if a
  // caller knows a receipt key. A site change since the test does not matter
  // here: publication reads only the saved result.
  try {
    openLinkToken(parsed.data.quizToken);
  } catch (error) {
    if (!(error instanceof LinkTestError) || error.code === "configuration") {
      return NextResponse.json({ message: "Could not add your result. Try again." }, { status: 503 });
    }
    if (error.code !== "changed") {
      return NextResponse.json({ message: "This quiz has expired or is invalid. Take a new test." }, { status: 400 });
    }
  }
  const nickname = checkNickname(parsed.data.nickname);
  if (!nickname.ok) return NextResponse.json({ message: nickname.message }, { status: 400 });
  try {
    if (!(await withinRateLimit("publish", clientAddress(req.headers)))) {
      return NextResponse.json({ message: "Too many scores published from this address. Try again later." }, { status: 429 });
    }
    const entry = await publishLeaderboardEntry(parsed.data.quizToken, nickname.nickname, parsed.data.kind);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof LeaderboardEligibilityError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: "Could not add your result. Try again." }, { status: 503 });
  }
}
