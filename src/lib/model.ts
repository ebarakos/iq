import { createOpenAI } from "@ai-sdk/openai";
import { createRelayFetch } from "./relay-fetch";

/**
 * llm-relay client.
 *
 * All model traffic goes through the relay (no provider keys in this repo).
 * `relayModel()` builds an AI SDK client routed through it; callers are the
 * agent solver (`src/lib/solver.ts`) and the LLM rule-proposal experiment
 * (`src/lib/llm-rule-proposal.ts`). The LLM item writer that used to live here
 * (`generatePuzzles` + its JSON parsing/validation) was retired on 2026-09-28
 * together with the legacy procedural generator — quiz tokens expire after 2
 * hours and no procedural or model-written data exists anywhere, so nothing
 * replayed it.
 */

/** Overrides that can be passed to relayModel(). */
export type ModelOverrides = {
  apiKey?: string;
  /** Marks the BYO key as a free-tier key; forwarded as X-User-Key-Tier. */
  userKeyTier?: "free";
  provider?: string;
  model?: string;
  thinkingBudget?: number;
  /** Reasoning effort (`--effort` or RELAY_EFFORT in the agent harness); harness providers only. */
  effort?: string;
  customUrl?: string;
  /** X-No-Fallback: fail instead of letting the relay substitute another provider/model. */
  noFallback?: boolean;
};

/** Provider name → BYO key env var (forwarded as X-User-Api-Key to skip the shared quota). */
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  cerebras: "CEREBRAS_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

/**
 * Providers the relay serves from the developer's own Claude Code / Codex CLI
 * sign-ins through its local harness bridge (localhost only). Keep in sync with
 * HARNESS_PROVIDERS in relay-fetch.ts, which routes their effort/thinking picks
 * into the request body instead of the X-Thinking-Budget header.
 */
const HARNESS_PROVIDERS = new Set(["claude-code", "codex"]);

/** True for a provider backed by the local harness bridge. */
export function isHarnessProvider(provider: string | undefined): boolean {
  return provider !== undefined && HARNESS_PROVIDERS.has(provider);
}

/**
 * Longest a harness turn may take. A hosted provider answers in seconds; a
 * Claude Code or Codex turn runs a whole CLI session and can take minutes, so
 * the hosted fail-fast budget would abort every single one of them.
 */
export const HARNESS_TIMEOUT_MS = 300_000;

/** Request budget for one relay call: the long one for harness providers, the
 *  caller's hosted budget for everything else. */
export function relayTimeoutMs(provider: string | undefined, hostedMs: number): number {
  return isHarnessProvider(provider) ? HARNESS_TIMEOUT_MS : hostedMs;
}

export function relayModel(overrides?: ModelOverrides) {
  const baseURL = requireEnv("RELAY_BASE_URL");
  // The caller's overrides (the agent harness's --provider/--model flags) take priority over env defaults.
  const provider = overrides?.provider ?? requireEnv("RELAY_PROVIDER");
  const model = overrides?.model ?? requireEnv("RELAY_MODEL");

  // BYO key: prefer the caller's key, else the env key for the active provider
  // (forwarded as X-User-Api-Key to skip the shared quota).
  const keyEnv = PROVIDER_API_KEY_ENV[provider];
  const byoKey = overrides?.apiKey ?? (keyEnv ? process.env[keyEnv] : undefined);

  // Capture which provider actually served the request in a REQUEST-LOCAL
  // variable (relayModel() runs once per generate call). relay-fetch.ts itself
  // carries no module-global state — attribution is delivered per request via
  // the optional onAttribution sink — but relayModel() already has a
  // request-scoped closure, so this wrapper reads the response header directly
  // instead of wiring that sink.
  const relayFetch = createRelayFetch({
    provider,
    expectedModel: model,
    apiKey: byoKey,
    // Forwarded, not dropped: createRelayFetch turns userKeyTier and noFallback
    // into the free-tier and X-No-Fallback headers.
    userKeyTier: overrides?.userKeyTier,
    noFallback: overrides?.noFallback,
    thinkingBudget: overrides?.thinkingBudget,
    // For the harness providers createRelayFetch writes the reasoning effort and
    // the thinking budget into the request body — the relay never forwards those
    // as headers.
    effort: overrides?.effort,
    customUrl: overrides?.customUrl,
    // Server-side calls carry no browser Origin, so the relay serves the harness
    // providers (our RELAY_PROVIDER=codex default) only when the request presents
    // its LOCAL_API_KEY as X-Harness-Caller-Token. Harmless for hosted providers.
    callerToken: process.env.RELAY_HARNESS_CALLER_TOKEN,
  });
  let providerUsed = provider;
  const fetchWithAttribution: typeof fetch = async (url, init) => {
    const res = await relayFetch(url, init);
    providerUsed = res.headers.get("X-Relay-Provider-Used") ?? providerUsed;
    return res;
  };

  const client = createOpenAI({
    apiKey: byoKey ?? "none",
    baseURL,
    fetch: fetchWithAttribution,
  });

  // Use .chat() to force the OpenAI-compatible Chat Completions API. The default
  // client(model) targets the newer Responses API (/v1/responses), which the
  // relay does not implement (it is /v1/chat/completions only → 404).
  // `provider` is the RESOLVED request provider (caller override, else env), so
  // callers can size their own abort budget with relayTimeoutMs() before the
  // response reveals which provider actually answered.
  return { model: client.chat(model), modelId: model, provider, getProviderUsed: () => providerUsed };
}
