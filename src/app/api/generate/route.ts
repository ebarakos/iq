import { NextRequest, NextResponse } from "next/server";
import { generatePuzzles } from "@/lib/model";
import { isRateLimitError, parseRateLimitError } from "@/lib/relay-errors";
import { readWidgetOverrides } from "@/lib/relay-api-helpers";
import { loadBank, sampleQuiz, agentStatsFor, type DifficultyLevel } from "@/items/bank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow up to 60s so the 45s generation timeout fits within the platform limit.
export const maxDuration = 60;

// Basic per-IP sliding-window rate limit. The map is PER INSTANCE — on serverless
// each cold instance keeps its own window, so this is a coarse abuse guard, not a
// global quota (the relay enforces the real limits). 10 requests / 5 minutes.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const hits = new Map<string, number[]>();

/** Returns true if `ip` is within budget (and records the hit); false if over. */
function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

/**
 * POST /api/generate — serve a 5-puzzle visual IQ test.
 *
 * Default path (no body / `fresh` omitted or false): samples instantly from the
 * calibrated item bank (`data/bank/items.json`). Returns `source: "bank"` with
 * per-item `agentStats` when calibration data is available.
 *
 * `fresh: true` path: generates new puzzles via llm-relay (variety / opt-in).
 * Returns `source: "relay"` with `providerUsed` and `modelId`. On ANY failure
 * (relay down, rate-limited, invalid output after retries) falls back to a bank
 * sample with `source: "fallback"` and a `notice` explaining what happened.
 *
 * The rate limiter applies to ALL paths — even instant bank serving can be abused.
 */
export async function POST(req: NextRequest) {
  // First IP in x-forwarded-for is the client; fall back to "unknown".
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown";
  if (!allow(ip)) {
    // Shape matches RateLimitInfo so the client's apiFetch parses it like a relay 429.
    return NextResponse.json(
      {
        source: "relay",
        limitType: "minute",
        message: "Too many requests — please wait a minute before generating another test.",
        retryAfter: null,
      },
      { status: 429 },
    );
  }

  // Parse body defensively — the client may send {} or nothing; `fresh` and
  // `difficulty` are opt-in (difficulty defaults to the standard ramp).
  const body = await req.json().catch(() => ({})) as { fresh?: boolean; difficulty?: unknown };
  const fresh = body.fresh === true;
  const difficulty: DifficultyLevel =
    body.difficulty === "easy" || body.difficulty === "hard" ? body.difficulty : "standard";

  if (!fresh) {
    // Default: instant bank sample with agent calibration stats.
    const { puzzles, items } = sampleQuiz(loadBank(), 5, difficulty);
    const agentStats = items.map(agentStatsFor);
    return NextResponse.json({ puzzles, source: "bank", agentStats });
  }

  // fresh: true — relay generation with bank fallback on any failure.
  const overrides = readWidgetOverrides(req);
  try {
    const { puzzles, providerUsed, modelId } = await generatePuzzles(overrides, 3, difficulty);
    return NextResponse.json({ puzzles, source: "relay", providerUsed, modelId });
  } catch (err) {
    // Raw provider/relay errors are jargon (keys, regions, model ids) — log them
    // server-side and keep the user-facing notice plain.
    if (isRateLimitError(err)) {
      console.error("generate: fresh generation rate-limited —", parseRateLimitError(err));
    } else {
      console.error("generate: fresh generation failed —", err);
    }
    const notice = isRateLimitError(err)
      ? "The AI generator is busy right now, so here's a test from the calibrated item bank instead."
      : "Fresh AI generation didn't work this time, so here's a test from the calibrated item bank instead.";
    const { puzzles, items } = sampleQuiz(loadBank(), 5, difficulty);
    const agentStats = items.map(agentStatsFor);
    return NextResponse.json({ puzzles, source: "fallback", notice, agentStats });
  }
}
