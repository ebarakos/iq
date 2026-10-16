import { quizNamespace } from "./leaderboard-config";
import { LinkTestError } from "./link-test";
import { redisCommand, redisConfigured } from "./redis";

/** The existing build record becomes the short public session when its token is issued. */
export function linkSessionKey(id: string): string {
  return `${quizNamespace()}:start:${id}`;
}

/**
 * Public links carry a random id, not the encrypted token. Keep the token as
 * the one identity scoring and publication use. Older token URLs still work.
 * Each caller validates the resolved token with openLinkToken as before.
 */
export async function resolveLinkToken(reference: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(reference)) return reference;
  if (!redisConfigured()) throw new LinkTestError("expired", "This test session has expired.");
  const raw = await redisCommand<string | null>(["GET", linkSessionKey(reference)]);
  const stored: unknown = raw === null ? null : JSON.parse(raw);
  if (typeof stored !== "object" || stored === null || !("token" in stored) || typeof stored.token !== "string") {
    throw new LinkTestError("expired", "This test session has expired.");
  }
  return stored.token;
}
