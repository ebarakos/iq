// @relay-template: relay-client@5

/**
 * Client-side fetch helper for browser apps using the llm-relay widget.
 *
 * Provides:
 *   - getWidgetHeaders() — reads widget state (provider, model, API key, thinking, custom URL)
 *     and returns headers for API requests. Falls back to localStorage when the widget
 *     script hasn't loaded yet.
 *   - RateLimitError — typed error class for 429s with structured info
 *   - apiFetch() — fetch wrapper that injects widget headers and throws typed errors
 *   - formatApiError() — user-friendly error messages for UI display
 *
 * ADAPT: Update the RateLimitInfo import path to match your project structure.
 *
 * Usage:
 *   import { apiFetch, formatApiError, RateLimitError } from "./relay-client";
 *
 *   try {
 *     const data = await apiFetch<MyResponse>("/api/generate", { prompt: "..." });
 *   } catch (err) {
 *     showError(formatApiError(err, "Generation failed"));
 *   }
 */

import type { RateLimitInfo } from "./relay-errors";

interface RelayWidget {
  getState?: () => RelayWidgetState | undefined;
  setState?: (patch: Partial<RelayWidgetState>) => void;
  notify?: (message: string) => void;
}
interface RelayWidgetState {
  provider?: string;
  model?: string;
  apiKey?: string;
  apiKeys?: Record<string, string>;
  thinking?: boolean;
  thinkingBudget?: number;
  customUrl?: string;
}
function relayWidget(): RelayWidget | undefined {
  return (window as unknown as { llmRelay?: RelayWidget }).llmRelay;
}

/** Read widget state and build headers for API requests.
 *  Prefers the live widget API, falls back to localStorage so that
 *  requests made before the widget script loads still use saved settings. */
export function getWidgetHeaders(): Record<string, string> {
  try {
    let state = relayWidget()?.getState?.();
    if (!state) {
      // Widget script not loaded yet — read directly from localStorage
      const raw = localStorage.getItem("llmRelay");
      if (!raw) return {};
      state = JSON.parse(raw) as RelayWidgetState;
      // Resolve active API key the same way the widget does:
      // per-provider key first, then legacy single key
      if (state.provider && state.apiKeys?.[state.provider]) {
        state.apiKey = state.apiKeys[state.provider];
      } else if (typeof state.apiKey !== "string") {
        state.apiKey = undefined;
      }
    }
    const headers: Record<string, string> = {};
    if (state.apiKey) headers["X-User-Api-Key"] = state.apiKey;
    if (state.provider) headers["X-Relay-Provider"] = state.provider;
    if (state.model) headers["X-Relay-Model"] = state.model;
    if (state.thinking) headers["X-Thinking-Budget"] = String(state.thinkingBudget || 8000);
    if (state.customUrl) headers["X-Custom-Url"] = state.customUrl;
    return headers;
  } catch {
    return {};
  }
}

/** Error thrown when the API returns a 429. Carries structured rate-limit info. */
export class RateLimitError extends Error {
  info: RateLimitInfo;
  constructor(info: RateLimitInfo) {
    super(info.message);
    this.name = "RateLimitError";
    this.info = info;
  }
}

/**
 * Fetch wrapper that injects widget headers and throws typed errors.
 *
 * - 429 → throws RateLimitError with structured info, auto-notifies widget for relay limits
 * - Other errors → throws plain Error with the server's message
 */
export async function apiFetch<T = unknown>(url: string, body: unknown): Promise<T & { modelId?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getWidgetHeaders() },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const raw = await res.json();
    // Relay wraps in { error: { message, source, ... } }; unwrap if needed
    const info: RateLimitInfo = raw?.error ?? raw;
    // Notify the relay widget — prepend provider name if missing
    const relay = relayWidget();
    if (relay?.notify) {
      const prov = relay.getState?.()?.provider;
      const cap = prov ? prov.charAt(0).toUpperCase() + prov.slice(1) : null;
      const msg =
        cap && prov && !info.message?.toLowerCase().includes(prov)
          ? `${cap} is rate-limited — wait a bit or try another provider`
          : info.message;
      relay.notify(msg);
    }
    throw new RateLimitError(info);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();

  // When the relay fell back to a different provider, update the widget
  // so subsequent requests go directly to the working provider.
  if (data.fallback?.provider) {
    const relay = relayWidget();
    const curProv = relay?.getState?.()?.provider ?? "Provider";
    if (relay?.setState) {
      relay.setState({ provider: data.fallback.provider, model: data.fallback.model });
    }
    const curCap = curProv.charAt(0).toUpperCase() + curProv.slice(1);
    const fbCap = data.fallback.provider.charAt(0).toUpperCase() + data.fallback.provider.slice(1);
    if (relay?.notify) {
      relay.notify(`${curCap} rate limit — auto-switched to ${fbCap}`);
    }
  }

  return data;
}

/**
 * Format a model attribution line for display — `"{provider} - {modelId}"`,
 * or bare modelId when no provider is known.
 */
export function formatModelId(modelId: string | null | undefined, provider?: string | null): string | undefined {
  if (!modelId) return undefined;
  if (!provider) return modelId;
  return `${provider} - ${modelId}`;
}

/**
 * Build a user-friendly error string from a caught error.
 * Returns a specific message for rate limits, generic for others.
 */
export function formatApiError(err: unknown, fallback: string): string {
  if (err instanceof RateLimitError) {
    const { info } = err;
    const suffix = info.retryAfter ? ` Resets ${info.retryAfter}.` : "";
    return `${info.message}${suffix}`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
