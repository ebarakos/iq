import { NextResponse } from "next/server";
import { z } from "zod";
import { toPublicPuzzleSet } from "@/items/schema";
import { SubmissionConflictError, submitQuizOnce } from "@/lib/leaderboard";
import { LinkTestError, loadLinkTest, scoringPayload } from "@/lib/link-test";
import { ScoringError } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SubmissionSchema = z.object({
  quizToken: z.string().min(1),
  answers: z.array(z.number().int().min(0).nullable()).max(100),
});

const TOKEN_MESSAGES: Record<Exclude<LinkTestError["code"], "configuration">, string> = {
  invalid: "This quiz token is invalid. Start a new test.",
  expired: "This quiz has expired. Start a new test.",
  changed: "This quiz has changed since it started. Start a new test.",
};

/**
 * POST /api/submit — score a test on the server without trusting the browser.
 * The test is rebuilt from its seed token; the first result is saved before any
 * answer leaves, and only then do the full puzzles go back for the review.
 */
export async function POST(req: Request) {
  const parsed = SubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid submission." }, { status: 400 });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  let loaded;
  try {
    loaded = loadLinkTest(parsed.data.quizToken, { nowSeconds });
  } catch (error) {
    if (error instanceof LinkTestError && error.code !== "configuration") {
      return NextResponse.json({ message: TOKEN_MESSAGES[error.code] }, { status: 400 });
    }
    console.error("submit: test could not be loaded —", error);
    return NextResponse.json({ message: "Scoring is temporarily unavailable." }, { status: 500 });
  }

  const { test, puzzles } = loaded;
  try {
    const result = await submitQuizOnce(
      parsed.data.quizToken, scoringPayload(test, puzzles), parsed.data.answers, nowSeconds,
    );
    return NextResponse.json({ ...result, puzzles: toPublicPuzzleSet(puzzles) });
  } catch (error) {
    // A wrong number of answers, or one outside a question's options.
    if (error instanceof ScoringError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof SubmissionConflictError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    // Fail closed: no answer key leaves the server until the first result is durable.
    return NextResponse.json({ message: "Scoring is temporarily unavailable. Your answers are kept — try again." }, { status: 503 });
  }
}
