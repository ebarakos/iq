import { NextRequest, NextResponse } from "next/server";
import { generatePuzzles } from "@/lib/model";
import { isRateLimitError, parseRateLimitError } from "@/lib/relay-errors";
import { readWidgetOverrides } from "@/lib/relay-api-helpers";
import { FALLBACK_PUZZLES } from "@/items/fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/generate — produce a 5-puzzle visual IQ test via llm-relay.
 *
 * Primary path: relay generation. If the relay is unreachable, rate-limited, or
 * returns invalid data after retries, we fall back to the hand-authored sample
 * set so the app is always runnable — the response `source`/`notice` make it
 * explicit which path was taken (the UI surfaces this).
 */
export async function POST(req: NextRequest) {
  // Provider/model/key the user picked in the relay widget (undefined → env defaults).
  const overrides = readWidgetOverrides(req);
  try {
    const { puzzles, providerUsed, modelId } = await generatePuzzles(overrides);
    return NextResponse.json({ puzzles, source: "relay", providerUsed, modelId });
  } catch (err) {
    let notice: string;
    if (isRateLimitError(err)) {
      const info = parseRateLimitError(err);
      notice = `Relay ${info.source} rate limit reached${info.retryAfter ? ` (retry ${info.retryAfter})` : ""}. Showing sample puzzles instead.`;
    } else {
      const msg = err instanceof Error ? err.message : "unknown error";
      notice = `Could not generate puzzles via the relay (${msg}). Showing sample puzzles instead.`;
    }
    return NextResponse.json({ puzzles: FALLBACK_PUZZLES, source: "fallback", notice });
  }
}
