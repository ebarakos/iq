// @relay-template: relay-fetch@5

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
}

/** Fallback info captured from the last relay response. */
export interface RelayFallbackInfo {
  provider: string;
  model: string;
}

let _lastFallback: RelayFallbackInfo | null = null;
let _lastProviderUsed: string | null = null;

/** Read and clear the last fallback info. Call after each LLM request. */
export function consumeLastFallback(): RelayFallbackInfo | null {
  const f = _lastFallback;
  _lastFallback = null;
  return f;
}

/** Read and clear the provider that actually served the last request.
 *  Always set by the relay (even without fallback) via the
 *  `X-Relay-Provider-Used` response header. Pair with `formatModelId()` to
 *  render attribution like `"{provider} - {model}"`. */
export function consumeLastProviderUsed(): string | null {
  const p = _lastProviderUsed;
  _lastProviderUsed = null;
  return p;
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

    // Inject provider into request body
    if (options?.body) {
      try {
        const body = JSON.parse(options.body as string);
        body.provider = opts.provider;
        options = { ...options, body: JSON.stringify(body) };
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

    // Capture fallback info from relay response headers
    const fbProvider = res.headers.get("X-Relay-Fallback-Provider");
    const fbModel = res.headers.get("X-Relay-Fallback-Model");
    _lastFallback = fbProvider && fbModel ? { provider: fbProvider, model: fbModel } : null;

    // Capture which provider actually served the request (always set by the relay).
    // Used by formatModelId() to render attribution as "{provider} - {model}".
    _lastProviderUsed = res.headers.get("X-Relay-Provider-Used");

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
