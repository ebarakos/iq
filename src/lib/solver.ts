import { generateText } from "ai";
import type { Puzzle, PublicPuzzle } from "@/items/schema";
import type { Channel } from "./attempts";
import { relayModel } from "./model";
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

export const SOLVER_PROMPT_VERSION = "solver-v1";

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
 *   2. an "Answer: C" style declaration;
 *   3. the first standalone A–F token (word boundary, case-insensitive) within
 *      the first 200 chars.
 * Returns the 0-based index, or null when nothing in range is found. Letters
 * beyond `optionCount` (e.g. "F" with 4 options) are treated as out of range.
 */
export function parseAnswerLetter(raw: string, optionCount: number): number | null {
  const inRange = (idx: number): number | null => (idx >= 0 && idx < optionCount ? idx : null);
  const letterIndex = (ch: string): number => LETTERS.indexOf(ch.toUpperCase() as (typeof LETTERS)[number]);

  const trimmed = raw.trim();

  // 1. Exact single letter.
  if (/^[a-fA-F]$/.test(trimmed)) return inRange(letterIndex(trimmed));

  const head = trimmed.slice(0, 200);

  // 2. "Answer: C" / "answer is c" style.
  const labelled = head.match(/\banswer\b[^a-z0-9]*([a-fA-F])\b/i);
  if (labelled) return inRange(letterIndex(labelled[1]));

  // 3. First standalone A–F token (word boundary).
  const standalone = head.match(/\b([a-fA-F])\b/);
  if (standalone) return inRange(letterIndex(standalone[1]));

  return null;
}

/**
 * Build the symbolic-channel payload: the puzzle's visible structure only.
 * answerIndex, explanation and rule are stripped so a text model cannot read
 * the answer off the JSON.
 */
function symbolicPayload(puzzle: Puzzle | PublicPuzzle): string {
  const body = {
    instruction: puzzle.instruction,
    layout: puzzle.layout,
    stem: puzzle.stem,
    options: puzzle.options.map((cell, i) => ({ label: LETTERS[i], ...cell })),
  };
  return JSON.stringify(body, null, 2);
}

/** Render a puzzle's composed SVG to PNG bytes via resvg (lazily imported). */
async function renderPng(puzzle: Puzzle | PublicPuzzle): Promise<Uint8Array> {
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
export async function solveItem(puzzle: Puzzle | PublicPuzzle, channel: Channel, opts?: SolverOpts): Promise<SolveOutcome> {
  const { model } = relayModel({ provider: opts?.provider, model: opts?.model, apiKey: opts?.apiKey });
  const abortSignal = AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
