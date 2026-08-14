import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CURRENT_GENERATOR_VERSION, generateQuiz, type QuizProfile } from "@/items/generate";
import { loadBank, sampleQuiz } from "@/items/bank";
import { createQuizDelivery, QuizTokenError } from "@/lib/quiz-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const hits = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

function profile(value: unknown): QuizProfile {
  return value === "easy" || value === "hard" ? value : "standard";
}

/** POST /api/generate — create a fresh, reproducible, answer-safe quiz. */
export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown";
  if (!allow(ip)) {
    return NextResponse.json(
      { message: "Too many requests — please wait a minute before starting another test." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as { difficulty?: unknown };
  const difficulty = profile(body.difficulty);

  try {
    const seed = randomBytes(16).toString("hex");
    const puzzles = generateQuiz(seed, CURRENT_GENERATOR_VERSION, difficulty);
    const delivery = createQuizDelivery(puzzles);
    return NextResponse.json({
      ...delivery,
      source: "procedural",
      generatorVersion: CURRENT_GENERATOR_VERSION,
    });
  } catch (error) {
    if (error instanceof QuizTokenError && error.code === "configuration") {
      console.error("generate: quiz token configuration error —", error.message);
      return NextResponse.json({ message: "Test scoring is temporarily unavailable." }, { status: 500 });
    }

    console.error("generate: procedural generation failed —", error);
    try {
      const { puzzles } = sampleQuiz(loadBank(), 5, difficulty);
      const delivery = createQuizDelivery(puzzles);
      return NextResponse.json({
        ...delivery,
        source: "fallback",
        notice: "Fresh generation failed, so this test comes from the verified reference set.",
      });
    } catch (fallbackError) {
      console.error("generate: reference fallback failed —", fallbackError);
      return NextResponse.json({ message: "Could not create a test. Please try again." }, { status: 500 });
    }
  }
}
