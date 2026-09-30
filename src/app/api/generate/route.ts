import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadBank, sampleExpandedBankQuiz } from "@/items/bank";
import {
  assembleExpandedQuiz,
  assertProfilesRemainBuildable,
  EXPANDED_GENERATOR_VERSION,
  type ExpandedProfile,
} from "@/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  readWithdrawnFamilyIds,
  unknownWithdrawnFamilyIds,
} from "@/items/family-promotion";
import { createQuizDelivery, QuizTokenError, SECONDS_PER_QUESTION } from "@/lib/quiz-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const hits = new Map<string, number[]>();

/**
 * Check the withdrawal list once, at server start.
 *
 * A list that empties a band throws here, so the deployment fails on boot
 * instead of serving a thinner test to whoever presses start first.
 */
const WITHDRAWN_FAMILY_IDS = readWithdrawnFamilyIds();
assertProfilesRemainBuildable(CURRENT_FAMILY_PROMOTION_REGISTRY, WITHDRAWN_FAMILY_IDS);
const UNKNOWN_WITHDRAWALS = unknownWithdrawnFamilyIds(
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  WITHDRAWN_FAMILY_IDS,
);
if (UNKNOWN_WITHDRAWALS.length > 0) {
  console.warn(
    `generate: WITHDRAWN_FAMILY_IDS names families that do not exist — ${UNKNOWN_WITHDRAWALS.join(", ")}. ` +
      "Check for a typo; these entries withdraw nothing.",
  );
}

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

/** Both public lengths are built from the expanded family pool; long is the default. */
function requestedProfile(value: unknown): ExpandedProfile {
  return value === "short-5" || value === "short" ? "short-5" : "long-30";
}

/** POST /api/generate — create a fresh, reproducible, answer-safe quiz. */
export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown";
  if (!allow(ip)) {
    return NextResponse.json(
      { message: "Too many requests. Please wait a minute before starting another test." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as { profile?: unknown };
  const profile = requestedProfile(body.profile);
  const seed = randomBytes(16).toString("hex");
  // Read once per delivery, AFTER the questions exist, and threaded into
  // createQuizDelivery's own clock read: the deadline the token seals and the
  // serverNow the browser corrects its countdown against agree to the second,
  // and time spent assembling never comes out of the taker's budget.
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  try {
    const puzzles = assembleExpandedQuiz(
      seed,
      profile,
      CURRENT_FAMILY_PROMOTION_REGISTRY,
      WITHDRAWN_FAMILY_IDS,
    );
    const serverNow = nowSeconds();
    const delivery = createQuizDelivery(puzzles, { nowSeconds: serverNow });
    return NextResponse.json({
      ...delivery,
      profile,
      secondsPerQuestion: SECONDS_PER_QUESTION,
      source: "generated",
      generatorVersion: EXPANDED_GENERATOR_VERSION,
      serverNow,
    });
  } catch (error) {
    if (error instanceof QuizTokenError && error.code === "configuration") {
      console.error("generate: quiz token configuration error —", error.message);
      return NextResponse.json({ message: "Test scoring is temporarily unavailable." }, { status: 500 });
    }

    console.error(`generate: ${profile} assembly failed —`, error);
    try {
      const fallback = loadBank().filter((item) =>
        item.puzzle.type !== "operatorInduction" &&
        !(item.puzzle.familyId && WITHDRAWN_FAMILY_IDS.has(item.puzzle.familyId)));
      const { puzzles } = sampleExpandedBankQuiz(
        fallback,
        profile,
        seed,
        CURRENT_FAMILY_PROMOTION_REGISTRY,
        WITHDRAWN_FAMILY_IDS,
      );
      const serverNow = nowSeconds();
      const delivery = createQuizDelivery(puzzles, { nowSeconds: serverNow });
      return NextResponse.json({
        ...delivery,
        profile,
        secondsPerQuestion: SECONDS_PER_QUESTION,
        source: "fallback",
        notice: "Fresh generation failed, so this test comes from the verified reference set.",
        serverNow,
      });
    } catch (fallbackError) {
      console.error("generate: reference fallback failed —", fallbackError);
      return NextResponse.json({ message: "Could not create a test. Please try again." }, { status: 500 });
    }
  }
}
