// @relay-template: relay-fetch@8

/**
 * Custom fetch for the OpenAI-compatible / Vercel AI SDK client that talks to llm-relay.
 *
 * What it does:
 *   1. Injects the provider name into every JSON request body so the relay routes correctly
 *   2. Asserts the widget-selected model with X-Relay-Expected-Model — the relay rejects a
 *      request whose body model differs (409 widget_model_mismatch), so a stale SDK default
 *      can never silently replace the user's visible choice
 *   3. Adds the BYO key / free-tier / thinking / custom-URL / no-fallback headers
 *   4. Reports per-request attribution to `onAttribution` (provider that actually answered,
 *      and whether the relay fell back to another provider or healed a retired model id)
 *   5. Throws a typed error on a relay-originated 429 so rate limits are distinguishable
 *
 * Attribution is delivered per request through the optional `onAttribution` sink —
 * NOT module-global state — so concurrent requests never misattribute each other.
 *
 * ADAPT: Import and use this in your LLM client file where you call createOpenAI().
 * Build the relay client once PER REQUEST and close over a request-local variable
 * in `onAttribution` if you need attribution under concurrency.
 *
 * Usage:
 *   import { createRelayFetch, type RelayAttribution } from "./relay-fetch";
 *
 *   let attribution: RelayAttribution | null = null;
 *   const client = createOpenAI({
 *     apiKey: "none",
 *     baseURL: process.env.RELAY_BASE_URL,
 *     fetch: createRelayFetch({
 *       provider: "openrouter",
 *       expectedModel: modelId,           // the same id you pass to client.chat(modelId)
 *       onAttribution: (info) => { attribution = info; },
 *     }),
 *   });
 *   // …after the LLM call, `attribution?.providerUsed` is this request's provider.
 */
/** Fallback info captured from a relay response. */
export interface RelayFallbackInfo {
  provider: string;
  model: string;
  reason: "fallback" | "model-heal";
}

/** Per-request relay attribution. */
export interface RelayAttribution {
  providerUsed: string | null;
  fallback: RelayFallbackInfo | null;
}

export interface RelayFetchOptions {
  provider: string;
  /** Exact widget-selected model. The relay rejects a mismatching request body. */
  expectedModel: string;
  apiKey?: string;
  userKeyTier?: "free";
  thinkingBudget?: number;
  customUrl?: string;
  noFallback?: boolean;
  onAttribution?: (info: RelayAttribution) => void;
}

/**
 * Build the AI SDK fetch adapter for llm-relay.
 *
 * Provider and model are asserted in both the request and headers so a stale
 * SDK/default value can never silently replace the widget's visible choice.
 */
export function createRelayFetch(opts: RelayFetchOptions): typeof fetch {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    let options = init;

    if (typeof options?.body === "string") {
      try {
        const parsed = JSON.parse(options.body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          (parsed as Record<string, unknown>).provider = opts.provider;
          options = { ...options, body: JSON.stringify(parsed) };
        }
      } catch {
        // Non-JSON requests are forwarded unchanged; exact headers still apply.
      }
    }

    const extraHeaders: Record<string, string> = {
      "X-Provider": opts.provider,
      "X-Relay-Expected-Model": opts.expectedModel,
    };
    if (opts.apiKey) extraHeaders["X-User-Api-Key"] = opts.apiKey;
    if (opts.apiKey && opts.userKeyTier === "free") {
      extraHeaders["X-User-Key-Tier"] = "free";
    }
    if (opts.thinkingBudget) extraHeaders["X-Thinking-Budget"] = String(opts.thinkingBudget);
    if (opts.customUrl) extraHeaders["X-Custom-Url"] = opts.customUrl;
    if (opts.noFallback) extraHeaders["X-No-Fallback"] = "true";
    const headers = new Headers(options?.headers);
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    options = { ...options, headers };

    const res = await fetch(url, options);

    if (opts.onAttribution) {
      const fallbackProvider = res.headers.get("X-Relay-Fallback-Provider");
      const fallbackModel = res.headers.get("X-Relay-Fallback-Model");
      const providerUsed = res.headers.get("X-Relay-Provider-Used");
      const modelUsed = res.headers.get("X-Relay-Model-Used");
      const healed = res.headers.get("X-Relay-Model-Healed");
      const automaticSwitch = fallbackProvider && fallbackModel
        ? { provider: fallbackProvider, model: fallbackModel, reason: "fallback" as const }
        : healed && providerUsed && modelUsed
          ? { provider: providerUsed, model: modelUsed, reason: "model-heal" as const }
          : null;
      opts.onAttribution({
        providerUsed,
        fallback: automaticSwitch,
      });
    }

    if (res.status === 429) {
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(text); } catch { /* provider returned plain text */ }
      const error = body?.error && typeof body.error === "object"
        ? body.error as Record<string, unknown>
        : body;
      if (error?.source === "relay") {
        const err = new Error(
          typeof error.message === "string" ? error.message : "Rate limited by relay",
        ) as Error & { statusCode: number; data: Record<string, unknown> };
        err.statusCode = 429;
        err.data = error;
        throw err;
      }
      return new Response(text, { status: res.status, headers: res.headers });
    }

    return res;
  };
}
