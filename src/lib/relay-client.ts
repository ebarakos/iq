// @relay-template: relay-client@11
/**
 * Client-side fetch helper for browser apps using the llm-relay widget.
 *
 * Provides:
 *   - getWidgetHeaders() — reads widget state and returns headers for API requests
 *     (the app's own API route hop always uses headers; for the local harness providers
 *     the widget's effort pick travels as X-Relay-Effort and thinking as X-Thinking-Budget,
 *     and the server-side relay-fetch turns them into the body fields the bridge reads)
 *   - RateLimitError — typed error class for 429s with structured info
 *   - apiFetch() — fetch wrapper that injects widget headers and throws typed errors
 *   - formatApiError() — user-friendly error messages for UI display
 *
 * aiq carries four hardenings on top of the shared template (see the aiq
 * 2026-08-19 entry in ~/.claude/skills/connect-relay/UPSTREAM.md):
 *   1. parseResponseBody() reads the body as text first, then tries JSON.parse,
 *      falling back to the raw text — a 429/error does not always come from the
 *      relay, and a hosting layer can answer with HTML or an empty body.
 *   2. normalizeRateLimitPayload() validates `source` / `limitType` instead of
 *      trusting whatever the upstream sent, and prefers the relay's own
 *      `retryAfter` string when present before falling back to the template's
 *      reset-timestamp / Retry-After-header resolution.
 *   3. The widget rate-limit notice guards `prov` before calling
 *      `info.message.toLowerCase().includes(prov)`.
 *   4. Typed `RelayWidget` / `RelayWidgetState` interfaces and a
 *      `browserStorage()` accessor replace `(window as any)` / bare
 *      `localStorage` access, which can throw in private-mode Safari or when
 *      blocked by an extension. The typing extends to the template's newer
 *      `getRequestBodyFields()` call and to the per-provider `effort` map.
 */

import { formatResetTimestamp, parseRetryAfter, readHeader, type RateLimitInfo } from "./relay-errors";

/** Request body fields the widget hands out for the local harness providers
 *  (Claude Code / Codex). Empty for every hosted provider. */
interface RelayRequestBodyFields {
  reasoning_effort?: string;
  thinking_budget?: number;
}

interface RelayWidgetState {
  provider?: string;
  model?: string;
  apiKey?: string;
  apiKeys?: Record<string, string>;
  freeKeys?: Record<string, boolean>;
  thinking?: boolean;
  thinkingBudget?: number;
  /** Reasoning effort per provider; only the harness providers honour it. */
  effort?: Record<string, string>;
  customUrl?: string;
  noFallback?: boolean;
  slots?: Record<string, { provider?: string; model?: string }>;
}

interface RelayWidget {
  getState?: () => RelayWidgetState | undefined;
  setState?: (patch: Partial<RelayWidgetState>) => void;
  notify?: (message: string) => void;
  getRequestHeaders?: (opts?: { slot?: string; provider?: string }) => Record<string, string>;
  getRequestBodyFields?: (opts?: { provider?: string }) => RelayRequestBodyFields | undefined;
  getSlot?: (name: string) => { provider?: string; model?: string } | undefined;
  setSlot?: (name: string, patch: { provider?: string; model?: string }) => void;
  applyAutomaticSwitch?: (
    provider: string,
    model: string,
    message?: string,
    slotName?: string,
  ) => Promise<void>;
}

function relayWidget(): RelayWidget | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { llmRelay?: RelayWidget }).llmRelay;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Parse a fetch response body without assuming JSON; fall back to raw text.
 *  A 429 or error does not always come from the relay — a hosting platform or
 *  edge layer can answer with HTML or an empty body. Parsing that unguarded
 *  turns a readable upstream error into a parse crash. */
async function parseResponseBody(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Unwrap common `{ error: {...} }` envelopes and keep string responses parseable. */
function unwrapErrorEnvelope(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") return { message: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const wrapped = raw as Record<string, unknown>;
  if (wrapped.error && typeof wrapped.error === "object" && !Array.isArray(wrapped.error)) {
    return wrapped.error as Record<string, unknown>;
  }
  return wrapped;
}

/** Resolve a human-readable reset time from the relay's `reset` timestamp
 *  field, or the standard Retry-After header for 429s the relay did not
 *  produce (validated in relay-errors — seconds or an HTTP date, never a wait
 *  longer than a day). Only used when the payload carries no `retryAfter`
 *  string of its own — see normalizeRateLimitPayload(). */
function readRetryAfter(res: Response, body: Record<string, unknown>): string | null {
  if (typeof body.reset === "string") return formatResetTimestamp(body.reset);
  const at = parseRetryAfter(readHeader(res.headers, "Retry-After"));
  return at ? formatResetTimestamp(at) : null;
}

/** Normalize a relay/provider 429 payload into RateLimitInfo. Validates
 *  `source` and `limitType` against their known values instead of trusting
 *  whatever the upstream sent — a malformed or non-relay body must still
 *  produce a usable message rather than an undefined field. */
function normalizeRateLimitPayload(raw: unknown, res: Response): RateLimitInfo {
  const body = unwrapErrorEnvelope(raw);
  const message =
    typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? body.error
        : "Rate limit reached. Please wait and try again.";

  return {
    source: body.source === "relay" ? "relay" : "provider",
    limitType: body.limitType === "minute" || body.limitType === "daily" ? body.limitType : null,
    message,
    retryAfter: typeof body.retryAfter === "string" ? body.retryAfter : readRetryAfter(res, body),
  };
}

/** Extract a readable message from common error payloads. */
function parseErrorMessage(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const root = raw as Record<string, unknown>;
  if (typeof root.error === "string") return root.error;
  if (root.message && typeof root.message === "string") return root.message;
  const nested = root.error;
  if (
    nested &&
    typeof nested === "object" &&
    !Array.isArray(nested) &&
    typeof (nested as { message?: unknown }).message === "string"
  ) {
    return (nested as { message: string }).message;
  }

  return undefined;
}

/** Read widget state and build headers for API requests.
 *
 *  Header convention matches what the Worker actually reads:
 *    X-Provider, X-User-Api-Key, X-User-Key-Tier, X-Thinking-Budget,
 *    X-Custom-Url, X-No-Fallback, X-Relay-Expected-Model,
 *    X-Relay-Widget-Slot
 *
 *  (Previously this helper emitted `X-Relay-Provider` / `X-Relay-Model` —
 *  neither of which the Worker has ever read; everything routed via the
 *  active relay defaults instead, silently ignoring the widget's pick.)
 *
 *  Options:
 *    - `slot`     — resolve via the widget's slot state (multi-agent apps).
 *    - `provider` — explicit provider override (e.g. callers building
 *                   request-specific headers).
 *  Defaults to the active global provider.
 *
 *  Precedence when both `slot` and `provider` are supplied: explicit
 *  `provider` WINS — the slot's provider is ignored. This matches the
 *  live widget's `llmRelay.getRequestHeaders` rule, so apps see the same
 *  behavior whether the widget script has loaded yet or not.
 *
 *  Prefers the live widget API; falls back to localStorage so requests
 *  made before the widget script loads still use saved settings. */
export function getWidgetHeaders(opts?: { slot?: string; provider?: string }): Record<string, string> {
  try {
    const relay = relayWidget();
    // Prefer the live API — it does the slot resolution + tier flags + custom
    // URL handling identically to the widget's own fetch patch.
    if (relay?.getRequestHeaders) {
      const headers = relay.getRequestHeaders(opts || undefined);
      // Harness providers: the widget keeps effort/thinking out of its headers (they
      // are body fields on the relay hop), so carry them as headers on this hop.
      const fields = relay.getRequestBodyFields?.({ provider: headers["X-Provider"] }) ?? {};
      if (fields.reasoning_effort) headers["X-Relay-Effort"] = String(fields.reasoning_effort);
      if (fields.thinking_budget && !headers["X-Thinking-Budget"]) {
        headers["X-Thinking-Budget"] = String(fields.thinking_budget);
      }
      return headers;
    }

    // Widget not loaded: synthesize headers from raw storage so first-paint
    // requests still carry the user's saved provider/key.
    const raw = browserStorage()?.getItem("llmRelay");
    if (!raw) return {};
    const state = JSON.parse(raw) as RelayWidgetState;

    // Slot resolution: if asked for a slot AND localStorage has one, use its
    // provider; otherwise fall through to the global default. Mirrors the
    // widget's effectiveSlot() exactly — the two must agree about a slot.
    let provider = opts?.provider || "";
    let model = "";
    let resolvedFromSlot = false;
    if (!provider && opts?.slot) {
      const slot = state.slots?.[opts.slot];
      if (slot?.provider) {
        // Explicit provider, no model chosen: the slot is incomplete on
        // purpose. Never borrow the global model — it belongs to the global
        // provider's catalog.
        provider = slot.provider;
        model = slot.model || "";
      } else {
        // No explicit provider: follow the global pair. A stored model with no
        // provider is ignored, or it would trail the user across global
        // provider switches and assert a model from the wrong catalog.
        provider = state.provider || "";
        model = state.model || "";
      }
      resolvedFromSlot = true;
    }
    if (!provider) {
      provider = state.provider || "";
      model = state.model || "";
    } else if (!model && !resolvedFromSlot && provider === state.provider) {
      model = state.model || "";
    }

    const headers: Record<string, string> = {};
    if (provider) headers["X-Provider"] = provider;
    // Per-provider key wins. The legacy single-`apiKey` field (pre-migration
    // storage) is conceptually bound to `state.provider` — the widget's load-
    // time migration writes it into `apiKeys[state.provider]` and deletes the
    // legacy field. Until that migration runs (i.e. before the widget script
    // loads), we must NOT lend the legacy key to a different provider/slot,
    // or we'd inject a key from one upstream into a request bound for another.
    const perProviderKey = state.apiKeys?.[provider] || "";
    const legacyKey = typeof state.apiKey === "string" ? state.apiKey : "";
    const key = perProviderKey || (provider === state.provider ? legacyKey : "");
    if (key) headers["X-User-Api-Key"] = key;
    if (key && state.freeKeys?.[provider]) headers["X-User-Key-Tier"] = "free";
    if (state.thinking) headers["X-Thinking-Budget"] = String(state.thinkingBudget || 8000);
    if (state.effort?.[provider]) headers["X-Relay-Effort"] = state.effort[provider];
    if (provider === "custom" && state.customUrl) headers["X-Custom-Url"] = state.customUrl;
    if (state.noFallback) headers["X-No-Fallback"] = "true";
    if (typeof state.model === "string") headers["X-Relay-Expected-Model"] = model;
    if (opts?.slot && !opts.provider) headers["X-Relay-Widget-Slot"] = opts.slot;
    return headers;
  } catch { return {}; }
}

/** Resolve the exact model choice displayed by the live widget (or its saved
 * pre-load state). Returns null when an explicit provider/slot has no concrete
 * model selected, so callers can fail before a provider default is used. */
function getWidgetSelection(opts?: { slot?: string; provider?: string }): { provider: string; model: string } | null {
  try {
    const relay = relayWidget();
    if (opts?.slot && !opts.provider && relay?.getSlot) {
      const slot = relay.getSlot(opts.slot);
      return slot?.provider && slot?.model ? { provider: slot.provider, model: slot.model } : null;
    }
    if (relay?.getState) {
      const state = relay.getState();
      const provider = opts?.provider || state?.provider;
      return provider && provider === state?.provider && state?.model
        ? { provider, model: state.model }
        : null;
    }

    const raw = browserStorage()?.getItem("llmRelay");
    if (!raw) return null;
    const state = JSON.parse(raw) as RelayWidgetState;
    if (opts?.slot && !opts.provider) {
      const slot = state.slots?.[opts.slot];
      if (slot?.provider) return slot.model ? { provider: slot.provider, model: slot.model } : null;
      // No explicit provider → follow the global pair; a stored model without a
      // provider does not survive a global provider switch.
      const provider = state.provider || "";
      const model = state.model || "";
      return provider && model ? { provider, model } : null;
    }
    const provider = opts?.provider || state.provider || "";
    return provider && provider === state.provider && state.model
      ? { provider, model: state.model }
      : null;
  } catch {
    return null;
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
 * - 429 → throws RateLimitError with structured info, auto-notifies widget
 * - Other errors → throws plain Error with the server's message
 * - Fallback responses → updates widget provider/model and notifies
 */
export async function apiFetch<T = unknown>(
  url: string,
  body: unknown,
  opts?: { slot?: string; provider?: string },
): Promise<T & { modelId?: string }> {
  type FetchResponse = T & {
    fallback?: { provider: string; model: string };
    modelId?: string;
  };

  const selection = getWidgetSelection(opts);
  const relay = relayWidget();
  let hasWidgetState = false;
  try {
    const liveState = relay?.getState?.();
    if (typeof liveState?.model === "string") hasWidgetState = true;
    else {
      const saved = browserStorage()?.getItem("llmRelay");
      if (saved) hasWidgetState = typeof (JSON.parse(saved) as RelayWidgetState)?.model === "string";
    }
  } catch {}
  if (hasWidgetState && !selection) {
    relay?.notify?.("Please select a model in the relay widget before sending a request.");
    throw new Error("No model selected in the relay widget.");
  }

  const requestBody = selection && body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), provider: selection.provider, model: selection.model }
    : body;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getWidgetHeaders(opts) },
    body: JSON.stringify(requestBody),
  });

  if (res.status === 429) {
    const raw = await parseResponseBody(res);
    const info = normalizeRateLimitPayload(raw, res);
    // Notify the relay widget — prepend provider name if missing
    if (relay?.notify) {
      // Keep attribution bound to the request. The live widget may have moved
      // to another provider while this request was in flight.
      const prov = selection?.provider ?? relay.getState?.()?.provider;
      const cap = prov ? prov.charAt(0).toUpperCase() + prov.slice(1) : null;
      const msg = cap && prov && !info.message?.toLowerCase().includes(prov)
        ? `${cap} is rate-limited — wait a bit or try another provider`
        : info.message;
      relay.notify(msg);
    }
    throw new RateLimitError(info);
  }

  if (!res.ok) {
    const data = await parseResponseBody(res);
    const message = parseErrorMessage(data) ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  const data = (await parseResponseBody(res)) as FetchResponse;

  // When the relay fell back to a different provider, update the widget
  // so subsequent requests go directly to the working provider. Current
  // relay responses report this in headers; the JSON shape remains supported
  // for older app backends that copy the metadata into their response body.
  const headerFallbackProvider = res.headers.get("X-Relay-Retried") === "true"
    ? res.headers.get("X-Relay-Fallback-Provider")
    : null;
  const headerFallbackModel = headerFallbackProvider
    ? res.headers.get("X-Relay-Fallback-Model")
    : null;
  const bodyFallback = data && typeof data === "object" ? data.fallback : undefined;
  const fallback = headerFallbackProvider
    ? { provider: headerFallbackProvider, model: headerFallbackModel ?? undefined }
    : bodyFallback;
  const healed = res.headers.get("X-Relay-Model-Healed");
  const providerUsed = res.headers.get("X-Relay-Provider-Used");
  const modelUsed = res.headers.get("X-Relay-Model-Used");
  const automaticTarget = fallback?.provider
    ? { provider: fallback.provider, model: fallback.model }
    : healed
      ? { provider: providerUsed ?? selection?.provider, model: modelUsed ?? undefined }
      : null;

  if (!automaticTarget && selection && (
    (providerUsed && providerUsed !== selection.provider)
    || (modelUsed && modelUsed !== selection.model)
  )) {
    relay?.notify?.("The relay returned a model that was not selected in the widget. The response was blocked.");
    throw new Error("Relay model-selection contract failed.");
  }

  if (automaticTarget?.provider) {
    // Do not read the live widget here: a concurrent request may already have
    // applied its own fallback. This notification must describe *this* request.
    const curProv = selection?.provider ?? relay?.getState?.()?.provider ?? "Provider";
    const curCap = curProv.charAt(0).toUpperCase() + curProv.slice(1);
    const fbCap = automaticTarget.provider.charAt(0).toUpperCase() + automaticTarget.provider.slice(1);
    const message = healed
      ? `Selected model was unavailable — auto-switched to ${automaticTarget.model ?? "the provider default"}`
      : `${curCap} rate limit — auto-switched to ${fbCap}`;
    if (!automaticTarget.model) {
      relay?.notify?.("The relay switched models but did not report the exact model. The response was blocked.");
      throw new Error("Relay automatic-switch metadata is incomplete.");
    }
    if (relay?.applyAutomaticSwitch) {
      if (opts?.slot) {
        await relay.applyAutomaticSwitch(automaticTarget.provider, automaticTarget.model, message, opts.slot);
      } else {
        await relay.applyAutomaticSwitch(automaticTarget.provider, automaticTarget.model, message);
      }
    } else {
      if (opts?.slot && relay?.setSlot) {
        relay.setSlot(opts.slot, { provider: automaticTarget.provider, model: automaticTarget.model });
      } else if (relay?.setState) {
        relay.setState({ provider: automaticTarget.provider, model: automaticTarget.model });
      }
      relay?.notify?.(message);
    }
  }

  return data;
}

/**
 * Format a model attribution line for display — `"{provider} - {modelId}"`,
 * or bare modelId when no provider is known.
 *
 * `provider` should come from the relay's `X-Relay-Provider-Used` response
 * header (surface it through the API route into the JSON body as `providerUsed`).
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
