import { generateText } from "ai";
import type { Puzzle, PublicPuzzle, Visual } from "@/items/schema";
import type { Channel } from "./attempts";
import { relayModel, relayTimeoutMs } from "./model";
import { puzzleToSvg } from "@/items/compose-image";

/**
 * Agent solver — sends one puzzle through the relay to a vision (or text) model
 * and records which lettered option it picks.
 *
 * Two channels:
 *   - image:    the same composed SVG a human sees, rendered to PNG and sent as
 *               a multimodal image part. The only human-comparable channel.
 *   - symbolic: the raw cell spec as JSON (answerIndex / explanation / rule
 *               STRIPPED) for text-only models. Diagnostic, secondary.
 *
 * The prompt is fixed, neutral, and versioned so reports never silently mix
 * prompt revisions (see AttemptFile.promptVersion).
 */

/**
 * Version of the whole reply-to-answer path, not just the prompt text. Reports
 * group by it so runs measured under different rules are never pooled. `v3`
 * keeps `v2`'s prompt but scans the entire reply and prefers the last letter;
 * `v2` read only the first 200 characters and took the first letter.
 */
export const SOLVER_PROMPT_VERSION = "solver-v3";

/** Fixed neutral instruction — identical across channels and models. */
const SOLVER_PROMPT =
  "This is a visual puzzle. Exactly one lettered option is correct. Reply with ONLY the letter.";

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
const DEFAULT_TIMEOUT_MS = 60_000;

export type SolverOpts = {
  provider?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  /**
   * Provider thinking budget, forwarded as the relay's X-Thinking-Budget
   * header. Some endpoints (google/gemini-3.5-flash since 2026-08) refuse
   * requests with reasoning disabled, which is the relay's default — every
   * attempt then records transport-failure. Pass a budget to enable reasoning.
   */
  thinkingBudget?: number;
  /**
   * Reasoning effort for the harness providers (`claude-code`, `codex`), which
   * take it as a request BODY field rather than a header — see
   * `createRelayFetch`. Hosted providers ignore it. Without it a codex run
   * reasons at whatever the bridge defaults to, which is not what a recorded
   * probe should leave unstated, so `agent-run` writes the value it used into
   * the run artifact beside the thinking budget.
   */
  effort?: string;
};

export interface SolveOutcome {
  /** 0-based option index the model picked, or null if its reply was unparseable. */
  chosen: number | null;
  /** Raw model reply (untruncated; the harness truncates before recording). */
  raw: string;
  latencyMs: number;
}

/**
 * Parse a single option letter (A–F) out of a model reply. Tolerant, in order:
 *   1. the whole trimmed reply is exactly one A–F letter;
 *   2. the LAST "Answer: C" style declaration anywhere in the reply;
 *   3. the LAST standalone A–F token (word boundary, case-insensitive).
 * Returns the 0-based index, or null when nothing in range is found. Letters
 * beyond `optionCount` (e.g. "F" with 4 options) are treated as out of range.
 *
 * Why the last match and not the first: a model asked for one letter usually
 * gives one, and rule 1 catches that. When it reasons instead, the early letters
 * are options being weighed and discarded — "Option A keeps the fill but…" — and
 * the conclusion is at the end. Taking the first letter would confidently record
 * a rejected candidate as the model's answer, which is worse than recording
 * nothing. The whole reply is scanned rather than a 200-character window: on
 * 2026-08-23 that window silently dropped three of thirty-two answers, all on
 * hard families, because the model wrote an analysis before concluding.
 */
export function parseAnswerLetter(raw: string, optionCount: number): number | null {
  const inRange = (idx: number): number | null => (idx >= 0 && idx < optionCount ? idx : null);
  const letterIndex = (ch: string): number => LETTERS.indexOf(ch.toUpperCase() as (typeof LETTERS)[number]);
  const lastMatch = (text: string, pattern: RegExp): string | null => {
    const matches = [...text.matchAll(pattern)];
    return matches.length > 0 ? matches[matches.length - 1][1] : null;
  };

  const trimmed = raw.trim();

  // 1. Exact single letter — the compliant reply, and the only unambiguous one.
  if (/^[a-fA-F]$/.test(trimmed)) return inRange(letterIndex(trimmed));

  // 2. "Answer: C" / "answer is c" style, last one wins.
  const labelled = lastMatch(trimmed, /\banswer\b[^a-z0-9]*([a-fA-F])\b/gi);
  if (labelled) return inRange(letterIndex(labelled));

  // 3. Last standalone A–F token (word boundary).
  const standalone = lastMatch(trimmed, /\b([a-fA-F])\b/g);
  if (standalone) return inRange(letterIndex(standalone));

  return null;
}

/**
 * Build the symbolic-channel payload: the puzzle's visible structure only.
 * answerIndex, explanation and rule are stripped so a text model cannot read
 * the answer off the JSON.
 */
function symbolicPayload(puzzle: Puzzle<Visual> | PublicPuzzle<Visual>): string {
  const body = {
    layout: puzzle.layout,
    stem: puzzle.stem,
    options: puzzle.options.map((cell, i) => ({ label: LETTERS[i], ...cell })),
  };
  return JSON.stringify(body, null, 2);
}

/** Render a puzzle's composed SVG to PNG bytes via resvg (lazily imported). */
async function renderPng(puzzle: Puzzle<Visual> | PublicPuzzle<Visual>): Promise<Uint8Array> {
  // Dynamic import keeps the native @resvg/resvg-js module out of the dependency
  // graph when solver.ts is imported in vitest (symbolic-only / parser tests).
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = puzzleToSvg(puzzle);
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
  return resvg.render().asPng();
}

/**
 * Solve one puzzle on the given channel. Reuses model.ts's relayModel() factory
 * (provider injection + 429 interception + attribution) and the AI SDK's
 * multimodal `messages` content parts. maxRetries: 0 — the relay handles
 * provider reliability; we want one clean attempt per call.
 */
export async function solveItem(
  puzzle: Puzzle<Visual> | PublicPuzzle<Visual>,
  channel: Channel,
  opts?: SolverOpts,
): Promise<SolveOutcome> {
  const { model, provider } = relayModel({
    provider: opts?.provider,
    model: opts?.model,
    apiKey: opts?.apiKey,
    thinkingBudget: opts?.thinkingBudget,
    effort: opts?.effort,
  });
  // An explicit timeoutMs stays authoritative; otherwise a Claude Code / Codex
  // turn gets the long harness budget and everything else the 60s default.
  // `provider` is the resolved one, so a RELAY_PROVIDER of claude-code counts.
  const abortSignal = AbortSignal.timeout(
    opts?.timeoutMs ?? relayTimeoutMs(provider, DEFAULT_TIMEOUT_MS),
  );
  const optionCount = puzzle.options.length;

  const started = Date.now();
  let raw = "";

  if (channel === "image") {
    const png = await renderPng(puzzle);
    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: png, mediaType: "image/png" },
            { type: "text", text: SOLVER_PROMPT },
          ],
        },
      ],
      maxRetries: 0,
      abortSignal,
    });
    raw = text;
  } else {
    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `${SOLVER_PROMPT}\n\n${symbolicPayload(puzzle)}` }],
        },
      ],
      maxRetries: 0,
      abortSignal,
    });
    raw = text;
  }

  return {
    chosen: parseAnswerLetter(raw, optionCount),
    raw,
    latencyMs: Date.now() - started,
  };
}
