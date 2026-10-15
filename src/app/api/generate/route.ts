import { NextRequest, NextResponse } from "next/server";
import {
  assertProfilesRemainBuildable,
  EXPANDED_GENERATOR_VERSION,
  type ExpandedProfile,
} from "@/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  readWithdrawnFamilyIds,
  unknownWithdrawnFamilyIds,
} from "@/items/family-promotion";
import { toPicturePuzzle } from "@/items/picture-puzzle";
import { createLinkTest, LinkTestError, pictureImagePath } from "@/lib/link-test";
import { startAllowed } from "@/lib/rate-limit";
import { SECONDS_PER_QUESTION } from "@/lib/quiz-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

/** Both public lengths are built from the expanded family pool; long is the default. */
function requestedProfile(value: unknown): ExpandedProfile {
  return value === "short-5" || value === "short" ? "short-5" : "long-30";
}

/**
 * POST /api/generate — start a fresh in-page test. The questions go out as
 * pictures only: layout and image paths, no scenes (docs/plans/leaderboard-integrity.md).
 * The token is the same seed token the link test uses, so both flows share one receipt.
 */
export async function POST(req: NextRequest) {
  if (!(await startAllowed(req.headers))) {
    return NextResponse.json(
      { message: "Too many tests started from this address. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as { profile?: unknown };
  const profile = requestedProfile(body.profile);
  try {
    // The clock is read after the questions exist, so building them never comes
    // out of the taker's time, and serverNow matches the sealed issue time.
    const { token, test, puzzles } = createLinkTest(profile, { withdrawnFamilyIds: WITHDRAWN_FAMILY_IDS });
    return NextResponse.json({
      quizToken: token,
      puzzles: puzzles.map((puzzle, index) =>
        toPicturePuzzle(puzzle, (part) => pictureImagePath(token, index + 1, part))),
      profile,
      appVersion: test.appVersion,
      answerDeadline: test.answerDeadline,
      serverNow: test.issuedAt,
      secondsPerQuestion: SECONDS_PER_QUESTION,
      source: test.source,
      generatorVersion: EXPANDED_GENERATOR_VERSION,
      ...(test.source === "fallback"
        ? { notice: "Fresh generation failed, so this test comes from the verified reference set." }
        : {}),
    });
  } catch (error) {
    if (error instanceof LinkTestError && error.code === "configuration") {
      console.error("generate: token configuration error —", error.message);
      return NextResponse.json({ message: "Test scoring is temporarily unavailable." }, { status: 500 });
    }
    console.error(`generate: ${profile} test could not be created —`, error);
    return NextResponse.json({ message: "Could not create a test. Please try again." }, { status: 500 });
  }
}
