import { NextResponse } from "next/server";
import { z } from "zod";
import { openQuizToken, QuizTokenError, submissionTiming } from "@/lib/quiz-token";
import { scoreAnswers, ScoringError } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SubmissionSchema = z.object({
  quizToken: z.string().min(1),
  answers: z.array(z.number().int().min(0).nullable()).max(100),
});

/** POST /api/submit — score an opaque quiz token without trusting the browser. */
export async function POST(req: Request) {
  const parsed = SubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid submission." }, { status: 400 });
  }

  let quiz;
  try {
    quiz = openQuizToken(parsed.data.quizToken);
  } catch (error) {
    if (error instanceof QuizTokenError && error.code === "configuration") {
      console.error("submit: quiz token configuration error —", error.message);
      return NextResponse.json({ message: "Scoring is temporarily unavailable." }, { status: 500 });
    }
    const message = error instanceof QuizTokenError && error.code === "expired"
      ? "This quiz has expired. Start a new test."
      : "This quiz token is invalid. Start a new test.";
    return NextResponse.json({ message }, { status: 400 });
  }

  // The server clock decides. A submission inside the grace window is ordinary;
  // a later one is still scored and shown, but marked and kept out of any
  // calibration set.
  try {
    return NextResponse.json(scoreAnswers(quiz.items, parsed.data.answers, submissionTiming(quiz)));
  } catch (error) {
    if (error instanceof ScoringError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }
}
