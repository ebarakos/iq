// @relay-template: relay-api-helpers@4

/**
 * Server-side helpers for Next.js API routes consuming llm-relay.
 *
 *   - readWidgetOverrides() — extracts relay widget headers into typed overrides
 *   - errorResponse() — builds NextResponse with proper 429 / upstream-message handling
 *
 * (The optional createStructuredRoute/createTextRoute factories from the template
 * are omitted — this project wires the route by hand.)
 */

import { NextRequest, NextResponse } from "next/server";
import { isRateLimitError, parseRateLimitError } from "./relay-errors";

/** Overrides that can be passed to getModel()/generatePuzzles(). */
export type ModelOverrides = {
  apiKey?: string;
  provider?: string;
  model?: string;
  thinkingBudget?: number;
  customUrl?: string;
};

/** Read per-request overrides injected by the llm-relay widget. */
export function readWidgetOverrides(req: NextRequest): ModelOverrides | undefined {
  const apiKey = req.headers.get("x-user-api-key") ?? undefined;
  const provider = req.headers.get("x-relay-provider") ?? undefined;
  const model = req.headers.get("x-relay-model") ?? undefined;
  const budget = req.headers.get("x-thinking-budget");
  const thinkingBudget = budget ? parseInt(budget, 10) || undefined : undefined;
  const customUrl = req.headers.get("x-custom-url") ?? undefined;
  if (!apiKey && !provider && !model && !thinkingBudget && !customUrl) return undefined;
  return { apiKey, provider, model, thinkingBudget, customUrl };
}

/**
 * Build a NextResponse for a caught API error.
 *
 * - 429 → structured RateLimitInfo so the client can distinguish relay vs provider limits
 * - Other → forwards the real error message with the original status code
 */
export function errorResponse(err: unknown, label: string): NextResponse {
  const e = err as { statusCode?: number; status?: number };
  const status = e?.statusCode ?? e?.status;
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`[${label}]`, errMsg, status ? `(HTTP ${status})` : "");

  if (isRateLimitError(err)) {
    return NextResponse.json(parseRateLimitError(err), { status: 429 });
  }

  // Extract a meaningful message from the upstream response body when the
  // AI SDK's wrapper message is generic (e.g. just "Unauthorized").
  const detail = extractUpstreamMessage(err);

  return NextResponse.json(
    { error: detail || errMsg || `${label} failed` },
    { status: status && status >= 400 ? status : 500 },
  );
}

/**
 * Pull the most useful error message from an AI SDK error's response body.
 * Handles Cerebras ({ message }), OpenAI-like ({ error: { message } }), and generic shapes.
 */
function extractUpstreamMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  let body: Record<string, unknown> | null = null;
  if (typeof e.responseBody === "string") {
    try {
      body = JSON.parse(e.responseBody);
    } catch {
      /* not JSON */
    }
  }
  if (!body && e.data && typeof e.data === "object") {
    body = e.data as Record<string, unknown>;
  }
  if (!body) return null;

  const nested = body.error;
  if (nested && typeof nested === "object" && typeof (nested as { message?: unknown }).message === "string") {
    return (nested as { message: string }).message;
  }
  if (typeof body.message === "string") return body.message;
  if (typeof nested === "string") return nested;

  return null;
}
