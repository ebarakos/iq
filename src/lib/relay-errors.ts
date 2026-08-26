// @relay-template: relay-errors@6

/**
 * Typed rate-limit error handling for llm-relay consumers.
 *
 * Distinguishes relay rate limits (daily/minute caps set in the relay)
 * from provider rate limits (propagated from upstream like Cerebras/OpenRouter).
 *
 * Handles the AI SDK's error structure quirks:
 *   - `err.responseBody` (raw string) preserves ALL upstream fields
 *   - `err.data` (Zod-parsed) may strip unknown fields like `source`
 *   - Errors may be nested via `err.cause` chain
 *
 * ADAPT: This file is framework-agnostic. Import where needed.
 */

/** Structured rate-limit info — use this as the 429 response shape to clients. */
export interface RateLimitInfo {
  source: "relay" | "provider";
  limitType: "minute" | "daily" | null;
  message: string;
  retryAfter: string | null;
}

/** Check whether an error represents a 429 rate-limit response. */
export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.statusCode === 429 || e.status === 429) return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("429")) return true;
  // Check the response body — the relay's { error: { type: "rate_limited" } }
  // envelope is the most reliable signal when status codes get transformed
  // through error wrappers. extractResponseBody() already unwraps the `error`
  // envelope (see unwrapError), so the type lives at the top level here.
  const body = extractResponseBody(err);
  if (body?.type === "rate_limited") return true;
  return false;
}

/**
 * Parse a rate-limit error into structured info, distinguishing relay vs provider limits.
 *
 * The relay returns 429 with `{ source: "relay", limitType, limit, message, reset }`.
 * The AI SDK stores the parsed response body in `err.data` or raw string in `err.responseBody`.
 */
export function parseRateLimitError(err: unknown): RateLimitInfo {
  const body = extractResponseBody(err);

  if (body?.source === "relay") {
    const lt = body.limitType;
    return {
      source: "relay",
      limitType: lt === "minute" || lt === "daily" ? lt : null,
      message: typeof body.message === "string" ? body.message : "Rate limit reached.",
      retryAfter: findRetryAfter(err),
    };
  }

  return {
    source: "provider",
    limitType: null,
    message: typeof body?.message === "string" ? body.message : "Rate-limited — wait a bit or try another provider",
    retryAfter: findRetryAfter(err),
  };
}

// ── Internals ──

/** Pull the parsed response body out of an AI SDK error. */
export function extractResponseBody(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  // Prefer raw responseBody — it preserves ALL fields from the upstream response.
  // AI SDK `data` is Zod-schema-parsed and strips unknown keys (e.g. `source`).
  if (typeof e.responseBody === "string") {
    try {
      const parsed = JSON.parse(e.responseBody);
      if (parsed && typeof parsed === "object") return unwrapError(parsed as Record<string, unknown>);
    } catch { /* not JSON */ }
  }

  // Fall back to data (set by custom fetch throw or by SDK when schema matches)
  if (e.data && typeof e.data === "object") {
    return unwrapError(e.data as Record<string, unknown>);
  }

  // Walk cause chain (SDK or retry wrappers may nest the original error)
  if (e.cause) return extractResponseBody(e.cause);

  return null;
}

/** Unwrap OpenAI-style { error: { message, ... } } envelope if present. */
function unwrapError(body: Record<string, unknown>): Record<string, unknown> {
  if (body.error && typeof body.error === "object" && !Array.isArray(body.error)) {
    return body.error as Record<string, unknown>;
  }
  return body;
}

/** Extract a human-readable "retry after" string from the error, if available. */
function findRetryAfter(err: unknown): string | null {
  const reset = findResetField(err);
  if (reset) return formatResetTimestamp(reset);
  return null;
}

function findResetField(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  if (typeof e.reset === "string") return e.reset;

  const body = extractResponseBody(err);
  if (body && typeof body.reset === "string") return body.reset;

  // Standard headers
  const headers = e.responseHeaders as Record<string, string> | undefined;
  if (headers) {
    const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
    if (retryAfter) {
      const s = parseInt(retryAfter, 10);
      if (!isNaN(s)) return new Date(Date.now() + s * 1000).toISOString();
    }
    const reset = headers["x-ratelimit-reset"] ?? headers["X-RateLimit-Reset"];
    if (reset) {
      const ts = parseInt(reset, 10);
      if (!isNaN(ts)) return new Date(ts * 1000).toISOString();
    }
  }

  // Walk cause chain
  if (e.cause) return findResetField(e.cause);

  return null;
}

export function formatResetTimestamp(iso: string): string {
  const reset = new Date(iso);
  const now = new Date();
  const s = Math.round((reset.getTime() - now.getTime()) / 1000);
  if (s <= 0) return "soon";
  if (s < 60) return `in ${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(s / 3600);
  if (h < 24) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(s / 86400);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}
