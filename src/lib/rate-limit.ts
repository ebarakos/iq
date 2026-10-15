import { createHash } from "node:crypto";
import { quizNamespace } from "./leaderboard-config";
import { redisCommand, redisConfigured } from "./redis";

/**
 * Per-address limits in one-hour Redis windows (docs/plans/leaderboard-integrity.md).
 *
 * Generous on purpose: chat agents fetch from their provider's shared
 * addresses, so many people's agents can arrive from one IP. The limits stop
 * floods, not ordinary use.
 */
export const RATE_LIMITS = {
  /** New tests, in-page and link alike. */
  start: 60,
  /** Leaderboard publications. */
  publish: 20,
} as const;
export type RateLimitBucket = keyof typeof RATE_LIMITS;

const WINDOW_SECONDS = 60 * 60;

/** The caller's address as Vercel reports it, or "unknown" off Vercel. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Count one request against the address's window and say whether it is within
 * the limit. Addresses are stored hashed. Throws when Redis does; each caller
 * decides whether that fails open or closed.
 */
export async function withinRateLimit(
  bucket: RateLimitBucket,
  address: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const window = Math.floor(nowSeconds / WINDOW_SECONDS);
  const id = createHash("sha256").update(address).digest("hex").slice(0, 32);
  const key = `${quizNamespace()}:limit:${bucket}:${id}:${window}`;
  const count = await redisCommand<number>(["INCR", key]);
  if (count === 1) await redisCommand(["EXPIRE", key, WINDOW_SECONDS]);
  return count <= RATE_LIMITS[bucket];
}

/**
 * The start limit fails open: a Redis outage already stops scoring, and
 * refusing every new test on top of that would only hide the real problem.
 */
export async function startAllowed(headers: Headers): Promise<boolean> {
  // No Redis configured: a development server without scoring, nothing to count against.
  if (!redisConfigured()) return true;
  try {
    return await withinRateLimit("start", clientAddress(headers));
  } catch (error) {
    console.error("rate-limit: start check failed, allowing the test —", error instanceof Error ? error.message : error);
    return true;
  }
}
