import { NextResponse } from "next/server";
import { z } from "zod";
import { openQuizToken, QuizTokenError } from "@/lib/quiz-token";

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

  if (parsed.data.answers.length !== quiz.items.length) {
    return NextResponse.json({ message: "Submit one answer for every question." }, { status: 400 });
  }
  const invalidChoice = parsed.data.answers.some(
    (answer, index) => answer !== null && answer >= quiz.items[index].optionCount,
  );
  if (invalidChoice) {
    return NextResponse.json({ message: "An answer is outside the available options." }, { status: 400 });
  }

  const results = quiz.items.map((item, index) => {
    const chosen = parsed.data.answers[index];
    return {
      id: item.id,
      chosen,
      answerIndex: item.answerIndex,
      correct: chosen === item.answerIndex,
      explanation: item.explanation,
    };
  });
  const score = results.filter((result) => result.correct).length;
  return NextResponse.json({ score, total: results.length, results });
}
