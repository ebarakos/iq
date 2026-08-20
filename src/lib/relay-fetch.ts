// @relay-template: relay-fetch@6

/**
 * Custom fetch wrapper for the AI SDK's createOpenAI() client.
 *
 * Handles two relay-specific concerns:
 *   1. Injects the provider name into every request body so the relay routes correctly
 *   2. Intercepts relay 429 responses immediately — prevents the AI SDK from retrying
 *      (which wastes rate-limit quota and delays the user-visible error by ~9 round-trips)
 *
 * ADAPT: Import and use this in your LLM client file where you call createOpenAI().
 *
 * Usage:
 *   import { createRelayFetch } from "./relay-fetch";
 *
 *   const client = createOpenAI({
 *     apiKey: "none",
 *     baseURL: process.env.RELAY_BASE_URL,
 *     fetch: createRelayFetch({ provider: "cerebras" }),
 *   });
 */

export interface RelayFetchOptions {
  /** Provider name injected into the request body (e.g. "cerebras", "openrouter", "groq") */
  provider: string;
  /** BYO API key — forwarded as X-User-Api-Key header to bypass relay rate limits */
  apiKey?: string;
  /** Thinking budget — forwarded as X-Thinking-Budget header for supported models */
  thinkingBudget?: number;
  /** Custom provider URL — forwarded as X-Custom-Url header for "custom" provider */
  customUrl?: string;
  /** Request-scoped attribution sink. Called once per relay response with the
   *  provider that served the request and any fallback. Replaces the old
   *  module-global `consumeLastProviderUsed()` / `consumeLastFallback()` so
   *  concurrent requests cannot read each other's values. */
  onAttribution?: (info: RelayAttribution) => void;
}

/** Fallback info captured from a relay response. */
export interface RelayFallbackInfo {
  provider: string;
  model: string;
}

/** Per-request attribution handed to `onAttribution` for each relay response. */
export interface RelayAttribution {
  /** Provider that actually served the request (always set by the relay via the
   *  `X-Relay-Provider-Used` response header). Pair with `formatModelId()` to
   *  render attribution like `"{provider} - {model}"`. */
  providerUsed: string | null;
  /** Set only when the relay fell back to a different provider/model. */
  fallback: RelayFallbackInfo | null;
}

/**
 * Returns a fetch function suitable for the AI SDK's `createOpenAI({ fetch })` option.
 *
 * The returned function:
 *   - Injects `body.provider` so the relay routes to the correct backend
 *   - Forwards BYO API key, thinking budget, and custom URL as relay headers
 *   - Intercepts relay 429s (where `source === "relay"`) and throws immediately,
 *     preventing any SDK retry loop from wasting quota
 *   - Passes through provider 429s as-is (SDK retry is disabled; relay handles retries)
 */
export function createRelayFetch(opts: RelayFetchOptions): typeof fetch {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    let options = init;

    // Inject provider into the request body, but ONLY when it is a JSON object we
    // can parse. Non-string bodies (Buffer, FormData, URLSearchParams, streams),
    // non-object JSON (arrays/primitives), and unparseable strings are forwarded
    // unchanged — provider injection is skipped, header injection below is kept.
    // An unguarded JSON.parse here would throw and crash the request before it
    // ever reached the relay.
    if (typeof options?.body === "string") {
      try {
        const parsed: unknown = JSON.parse(options.body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          (parsed as Record<string, unknown>).provider = opts.provider;
          options = { ...options, body: JSON.stringify(parsed) };
        }
      } catch {
        // Body is not JSON — forward the request unchanged (skip provider injection)
      }
    }

    // Forward relay-specific headers
    const extraHeaders: Record<string, string> = {};
    if (opts.apiKey) extraHeaders["X-User-Api-Key"] = opts.apiKey;
    if (opts.thinkingBudget) extraHeaders["X-Thinking-Budget"] = String(opts.thinkingBudget);
    if (opts.customUrl) extraHeaders["X-Custom-Url"] = opts.customUrl;
    if (Object.keys(extraHeaders).length) {
      options = {
        ...options,
        headers: { ...options?.headers, ...extraHeaders },
      };
    }

    const res = await fetch(url, options);

    // Request-scoped attribution: read THIS response's headers and hand them to
    // the caller's sink. No module-global state, so concurrent requests cannot
    // overwrite each other's provider/model — the agent harness runs several at
    // once by default.
    if (opts.onAttribution) {
      const fbProvider = res.headers.get("X-Relay-Fallback-Provider");
      const fbModel = res.headers.get("X-Relay-Fallback-Model");
      opts.onAttribution({
        providerUsed: res.headers.get("X-Relay-Provider-Used"),
        fallback: fbProvider && fbModel ? { provider: fbProvider, model: fbModel } : null,
      });
    }

    // Intercept relay rate-limit responses immediately.
    // The relay returns { source: "relay", limitType: "minute"|"daily", message, reset }.
    // Throwing here prevents the AI SDK from retrying (which wastes quota).
    if (res.status === 429) {
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      if (body?.source === "relay") {
        const err = new Error(typeof body.message === "string" ? body.message : "Rate limited by relay") as Error & {
          statusCode?: number;
          data?: unknown;
        };
        err.statusCode = 429;
        err.data = body;
        throw err;
      }
      // Provider 429 — return as-is (SDK retry is disabled; relay handles retries)
      return new Response(text, { status: res.status, headers: res.headers });
    }

    return res;
  };
}
