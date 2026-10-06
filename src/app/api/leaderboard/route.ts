import { NextResponse } from "next/server";
import { z } from "zod";
import { leaderboardEnabled } from "@/lib/leaderboard-config";
import { LeaderboardEligibilityError, listLeaderboard, publishLeaderboardEntry } from "@/lib/leaderboard";
import { openQuizToken, QuizTokenError } from "@/lib/quiz-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EntrySchema = z.object({
  quizToken: z.string().min(1),
  nickname: z.string().trim().min(1).max(32).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
});

export async function GET() {
  if (!leaderboardEnabled()) return NextResponse.json({ message: "Not found." }, { status: 404 });
  try {
    return NextResponse.json({ entries: await listLeaderboard() });
  } catch {
    return NextResponse.json({ message: "The leaderboard is temporarily unavailable. Try again." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!leaderboardEnabled()) return NextResponse.json({ message: "Not found." }, { status: 404 });
  const parsed = EntrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Enter a nickname between 1 and 32 characters." }, { status: 400 });
  }
  try {
    // Authenticate and enforce token expiry even if a caller knows a receipt key.
    openQuizToken(parsed.data.quizToken);
    const entry = await publishLeaderboardEntry(parsed.data.quizToken, parsed.data.nickname);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof LeaderboardEligibilityError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof QuizTokenError && error.code !== "configuration") {
      return NextResponse.json({ message: "This quiz has expired or is invalid. Take a new test." }, { status: 400 });
    }
    return NextResponse.json({ message: "Could not add your result. Try again." }, { status: 503 });
  }
}
