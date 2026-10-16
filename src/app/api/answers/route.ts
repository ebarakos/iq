import { NextResponse } from "next/server";
import { z } from "zod";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import { recordQuizAnswers } from "@/lib/leaderboard";
import { LinkTestError, linkTestLength, openLinkToken } from "@/lib/link-test";
import { ScoringError } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AnswersSchema = z.object({
  quizToken: z.string().min(1),
  answers: z.array(z.number().int().min(0).max(OPTIONS_PER_ITEM - 1).nullable()).max(30),
});

/** Save progress on the server clock; no score or answer key leaves this route. */
export async function POST(req: Request) {
  const parsed = AnswersSchema.safeParse(await req.json().catch(() => null));
  // Timestamp the complete body, so starting a slow upload cannot reserve extra time.
  const receivedAtMs = Date.now();
  if (!parsed.success) return NextResponse.json({ message: "Invalid answers." }, { status: 400 });
  try {
    const test = openLinkToken(parsed.data.quizToken, { nowSeconds: Math.floor(receivedAtMs / 1000) });
    if (parsed.data.answers.length !== linkTestLength(test)) {
      throw new ScoringError("Submit one valid answer or skip for every question.");
    }
    await recordQuizAnswers(parsed.data.quizToken, test, parsed.data.answers, receivedAtMs);
    return NextResponse.json({ closed: receivedAtMs >= test.answerDeadline * 1000 });
  } catch (error) {
    if (error instanceof ScoringError || (error instanceof LinkTestError && error.code !== "configuration")) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: "Your answers could not be saved. Retrying may help." }, { status: 503 });
  }
}
