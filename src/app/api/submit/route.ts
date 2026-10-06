import { NextResponse } from "next/server";
import { z } from "zod";
import { openQuizToken, QuizTokenError } from "@/lib/quiz-token";
import { SubmissionConflictError, submitQuizOnce } from "@/lib/leaderboard";

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

  const nowSeconds = Math.floor(Date.now() / 1000);
  let quiz;
  try {
    quiz = openQuizToken(parsed.data.quizToken, undefined, nowSeconds);
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

  if (parsed.data.answers.length !== quiz.items.length) {
    return NextResponse.json({ message: "Submit one answer for every question." }, { status: 400 });
  }
  const invalidChoice = parsed.data.answers.some(
    (answer, index) => answer !== null && answer >= quiz.items[index].optionCount,
  );
  if (invalidChoice) {
    return NextResponse.json({ message: "An answer is outside the available options." }, { status: 400 });
  }

  try {
    const result = await submitQuizOnce(parsed.data.quizToken, quiz, parsed.data.answers, nowSeconds);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SubmissionConflictError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    // Fail closed: no answer key leaves the server until the first result is durable.
    return NextResponse.json({ message: "Scoring is temporarily unavailable. Your answers are kept — try again." }, { status: 503 });
  }
}
