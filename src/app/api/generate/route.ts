import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CURRENT_GENERATOR_VERSION, generateQuiz, type QuizProfile } from "@/items/generate";
import { loadBank, sampleQuiz } from "@/items/bank";
import { assembleExpandedPreviewQuiz } from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "@/items/family-promotion";
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
  return value === "easy" || value === "standard" || value === "hard" ? value : "hard";
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

  const body = await req.json().catch(() => ({})) as { difficulty?: unknown; mode?: unknown };
  const difficulty = profile(body.difficulty);
  const wantsPreview = body.mode === "expanded-preview";

  if (
    wantsPreview &&
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_SCENE_PROTOTYPES !== "1"
  ) {
    return NextResponse.json({ message: "The expanded preview is not enabled on this deployment." }, { status: 404 });
  }

  if (wantsPreview) {
    try {
      const seed = randomBytes(16).toString("hex");
      const puzzles = assembleExpandedPreviewQuiz(seed, CURRENT_FAMILY_PROMOTION_REGISTRY);
      const delivery = createQuizDelivery(puzzles);
      return NextResponse.json({
        ...delivery,
        source: "experimental",
        generatorVersion: "scene-preview-v2",
        notice: "Experimental preview: these families pass code checks but are still being tested for human clarity and difficulty.",
      });
    } catch (error) {
      if (error instanceof QuizTokenError && error.code === "configuration") {
        console.error("generate: quiz token configuration error —", error.message);
        return NextResponse.json({ message: "Test scoring is temporarily unavailable." }, { status: 500 });
      }
      console.error("generate: expanded preview failed —", error);
      return NextResponse.json({ message: "Could not create the expanded preview. Please try again." }, { status: 500 });
    }
  }

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
      const compactFallback = loadBank().filter((item) => item.puzzle.type !== "operatorInduction");
      const { puzzles } = sampleQuiz(compactFallback, 5, difficulty);
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
