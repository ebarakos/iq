import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createRelayFetch } from "./relay-fetch";
import type { ModelOverrides } from "./relay-api-helpers";
import { PuzzleSetSchema, type PuzzleSet } from "@/items/schema";
import { SYSTEM_PROMPT, USER_PROMPT } from "@/items/prompt";

/**
 * llm-relay client + puzzle generation.
 *
 * All model traffic goes through the relay (no provider keys in this repo).
 * We use "manual" JSON mode: ask for a JSON array in the prompt, extract and
 * validate it ourselves against the Zod schema, and retry on malformed output.
 */

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

function relayModel(overrides?: ModelOverrides) {
  const baseURL = requireEnv("RELAY_BASE_URL");
  // Widget overrides (provider/model chosen in the browser) take priority over env defaults.
  const provider = overrides?.provider ?? requireEnv("RELAY_PROVIDER");
  const model = overrides?.model ?? requireEnv("RELAY_MODEL");

  // BYO key: prefer the key the user entered in the widget, else the env key for
  // the active provider (forwarded as X-User-Api-Key to skip the shared quota).
  const keyEnv = PROVIDER_API_KEY_ENV[provider];
  const byoKey = overrides?.apiKey ?? (keyEnv ? process.env[keyEnv] : undefined);

  // Capture which provider actually served the request in a REQUEST-LOCAL
  // variable (relayModel() runs once per generate call). relay-fetch.ts also
  // records this in a module-global, but that can misattribute across concurrent
  // requests — reading it here from the per-request response avoids the race.
  const relayFetch = createRelayFetch({
    provider,
    apiKey: byoKey,
    thinkingBudget: overrides?.thinkingBudget,
    customUrl: overrides?.customUrl,
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
  return { model: client.chat(model), modelId: model, getProviderUsed: () => providerUsed };
}

/** Extract a JSON array from a raw model response (handles markdown fences / preamble). */
function extractJsonArray(text: string): string {
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();
  if (body.startsWith("[")) return body;
  // Greedy: first '[' to last ']'
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start !== -1 && end > start) return body.slice(start, end + 1);
  return body;
}

export interface GenerateResult {
  puzzles: PuzzleSet;
  providerUsed: string | null;
  modelId: string;
}

/** Generate a validated 5-puzzle test via the relay. Throws if it cannot.
 *  `overrides` carry the provider/model/key the user picked in the relay widget. */
export async function generatePuzzles(overrides?: ModelOverrides, maxAttempts = 3): Promise<GenerateResult> {
  const { model, modelId, getProviderUsed } = relayModel(overrides);
  let lastError: unknown;
  let lastFeedback = ""; // specific issues from the previous attempt, fed back to the model

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { text } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: attempt === 1 ? USER_PROMPT : `${USER_PROMPT}\n\nYour previous answer was rejected:\n${lastFeedback}\nReturn ONLY a corrected JSON array of 5 objects.`,
        temperature: 0.3, // lower temp → tighter rule-following (fewer mismarked answers)
        maxRetries: 0, // relay handles provider reliability (retries + fallback)
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonArray(text));
      } catch {
        lastFeedback = "- The response was not valid JSON.";
        lastError = new Error("response was not valid JSON");
        continue;
      }

      const result = PuzzleSetSchema.safeParse(parsed);
      if (result.success) {
        return { puzzles: result.data, providerUsed: getProviderUsed(), modelId };
      }
      // Feed the exact failing paths back to the model so it can self-correct.
      lastFeedback = result.error.issues
        .slice(0, 12)
        .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
        .join("\n");
      lastError = new Error(`schema validation failed: ${lastFeedback.replace(/\n/g, " ")}`);
    } catch (err) {
      lastError = err;
      // Re-throw relay rate limits immediately — retrying won't help.
      if (typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 429) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error("Puzzle generation failed");
}
