import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createRelayFetch } from "./relay-fetch";
import type { ModelOverrides } from "./relay-api-helpers";
import { PuzzleSetSchema, shuffleOptions, type PuzzleSet } from "@/items/schema";
import { checkRule } from "@/items/rules";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/items/prompt";
import type { DifficultyLevel } from "@/items/bank";

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

export function relayModel(overrides?: ModelOverrides) {
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

/** Slice from the first '[' to the last ']' — a best-effort array boundary. */
function bracketSlice(s: string): string | null {
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  return start !== -1 && end > start ? s.slice(start, end + 1) : null;
}

/**
 * Parse a JSON array out of a raw model response.
 *
 * A naive first-`[`/last-`]` slice mis-extracts when prose contains stray
 * brackets, so we try an ordered list of candidates — fenced block content, that
 * content bracket-sliced, the whole body, the whole body bracket-sliced — and
 * return the first that `JSON.parse`s to an actual array. Returns `null` when no
 * candidate yields an array (the caller treats that as "not valid JSON").
 * Exported for unit testing.
 */
export function parseJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fenced = fence ? fence[1].trim() : null;

  const candidates = [
    fenced,
    fenced ? bracketSlice(fenced) : null,
    trimmed,
    bracketSlice(trimmed),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Validate a parsed (unknown) value against PuzzleSetSchema, then run the
 * semantic `checkRule` validator on every puzzle. Returns ok:true + the typed
 * PuzzleSet on success; ok:false + a human-readable feedback string (suitable
 * for feeding back to the model) on any failure.
 *
 * Pure — no env access, no side effects. Exported for the Phase B CLI.
 */
export function validatePuzzleSet(parsed: unknown): { ok: true; puzzles: PuzzleSet } | { ok: false; feedback: string } {
  // Step 1: Zod schema validation.
  const result = PuzzleSetSchema.safeParse(parsed);
  if (!result.success) {
    const feedback = result.error.issues
      .slice(0, 12)
      .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("\n");
    return { ok: false, feedback };
  }

  // Step 2: Semantic rule validation — re-derive the correct answer from each
  // puzzle's declared rule and confirm the marked answerIndex matches.
  const ruleFailures: string[] = [];
  for (const puzzle of result.data) {
    const check = checkRule(puzzle);
    if (!check.ok) {
      // Ensure at least one line per failing puzzle survives even if we cap later.
      const firstIssue = check.issues[0] ?? "rule check failed";
      ruleFailures.push(`- ${puzzle.id} (${puzzle.type}): ${firstIssue}`);
      // Append any additional issues for this puzzle (without repeating the header).
      for (let i = 1; i < check.issues.length; i++) {
        ruleFailures.push(`  ${check.issues[i]}`);
      }
    }
  }

  if (ruleFailures.length > 0) {
    // Cap at ~12 lines total, but guarantee at least one line per failing puzzle
    // by keeping leading lines (each puzzle's primary issue is listed first).
    const feedback = ruleFailures.slice(0, 12).join("\n");
    return { ok: false, feedback };
  }

  return { ok: true, puzzles: result.data };
}

export interface GenerateResult {
  puzzles: PuzzleSet;
  providerUsed: string | null;
  modelId: string;
}

/** Generate a validated 5-puzzle test via the relay. Throws if it cannot.
 *  `overrides` carry the provider/model/key the user picked in the relay widget. */
export async function generatePuzzles(
  overrides?: ModelOverrides,
  maxAttempts = 3,
  difficulty: DifficultyLevel = "standard",
): Promise<GenerateResult> {
  const { model, modelId, getProviderUsed } = relayModel(overrides);
  let lastError: unknown;
  let lastFeedback = ""; // specific issues from the previous attempt, fed back to the model
  // Build the (randomized) prompt once and reuse it across retries, so the Zod
  // feedback we append stays coherent with the spec the model was first given.
  const userPrompt = buildUserPrompt(difficulty);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { text } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: attempt === 1 ? userPrompt : `${userPrompt}\n\nYour previous answer was rejected:\n${lastFeedback}\nReturn ONLY a corrected JSON array of 5 objects.`,
        temperature: 0.3, // lower temp → tighter rule-following (fewer mismarked answers)
        maxRetries: 0, // relay handles provider reliability (retries + fallback)
        abortSignal: AbortSignal.timeout(45_000), // fail fast on a hung relay call
      });

      const parsed = parseJsonArray(text);
      if (parsed === null) {
        lastFeedback = "- The response was not valid JSON.";
        lastError = new Error("response was not valid JSON");
        continue;
      }

      const validation = validatePuzzleSet(parsed);
      if (validation.ok) {
        // Shuffle each puzzle's options (remapping answerIndex) to remove the
        // model's answer-position bias before the test is served. checkRule
        // remains valid post-shuffle since answerIndex is remapped correctly.
        const puzzles = validation.puzzles.map(shuffleOptions) as PuzzleSet;
        return { puzzles, providerUsed: getProviderUsed(), modelId };
      }
      // Feed schema + rule issues back to the model so it can self-correct.
      lastFeedback = validation.feedback;
      lastError = new Error(`validation failed: ${lastFeedback.replace(/\n/g, " ")}`);
    } catch (err) {
      lastError = err;
      // Re-throw relay rate limits immediately — retrying won't help.
      if (typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 429) {
        throw err;
      }
      // A timeout/abort means the relay hung — don't burn the remaining attempts;
      // throw so the route's fallback kicks in promptly.
      const name = typeof err === "object" && err !== null ? (err as { name?: string }).name : undefined;
      if (name === "AbortError" || name === "TimeoutError") {
        throw err;
      }
    }
  }

  throw lastError ?? new Error("Puzzle generation failed");
}
