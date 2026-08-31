// @relay-template: relay-errors@7
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
    message: typeof body?.message === "string" ? body.message : "Rate-limited. Wait a bit or try another provider",
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
      // Non-object JSON (string, number, etc.) — fall through to other extractors
    } catch {
      // responseBody is not valid JSON — skip gracefully and fall through to e.data / e.cause
    }
  }

  // Fall back to data (set by custom fetch throw or by SDK when schema matches)
  if (e.data && typeof e.data === "object") {
    return unwrapError(e.data as Record<string, unknown>);
  }

  // Walk cause chain (SDK or retry wrappers may nest the original error)
  if (e.cause) return extractResponseBody(e.cause);

  // Direct object with relay fields (e.g. parsed 429 response body passed directly)
  if ("source" in e || "error" in e) return unwrapError(e);

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

/**
 * Turn a `Retry-After` header value into an ISO timestamp, or null.
 *
 * RFC 9110 allows two forms: a whole number of seconds ("120") or an HTTP date
 * ("Wed, 21 Oct 2015 07:28:00 GMT"). Both are validated rather than trusted —
 * an unparseable value, a negative delay, or a wait longer than a day is a
 * broken header, and showing "in 19790 days" is worse than showing nothing.
 */
export function parseRetryAfter(value: unknown): string | null {
  if (typeof value === "number") return fromDeltaSeconds(value);
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) return fromDeltaSeconds(Number(raw));

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const seconds = (at - Date.now()) / 1000;
  if (seconds < 0 || seconds > MAX_RETRY_AFTER_SECONDS) return null;
  return new Date(at).toISOString();
}

/** A wait longer than this is treated as a broken header rather than a real delay. */
const MAX_RETRY_AFTER_SECONDS = 86400;

function fromDeltaSeconds(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_RETRY_AFTER_SECONDS) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** Read one header from either a plain object or a real `Headers` instance. */
export function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === "function") {
    const v = (headers as Headers).get(name);
    return typeof v === "string" ? v : null;
  }
  const bag = headers as Record<string, unknown>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() === lower) {
      const v = bag[key];
      return typeof v === "string" ? v : null;
    }
  }
  return null;
}

function findResetField(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  if (typeof e.reset === "string") return e.reset;

  const body = extractResponseBody(err);
  if (body && typeof body.reset === "string") return body.reset;

  // Standard headers. `responseHeaders` may be a plain object or a real
  // `Headers`, whose values are only reachable through get().
  const headers = e.responseHeaders;
  if (headers) {
    const retryAfter = parseRetryAfter(readHeader(headers, "retry-after"));
    if (retryAfter) return retryAfter;
    const reset = readHeader(headers, "x-ratelimit-reset");
    if (reset && /^\d+$/.test(reset.trim())) {
      const ts = Number(reset.trim());
      const iso = new Date(ts * 1000).toISOString();
      const seconds = (ts * 1000 - Date.now()) / 1000;
      if (seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS) return iso;
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
