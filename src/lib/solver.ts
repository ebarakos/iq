import { generateText } from "ai";
import type { Puzzle, PublicPuzzle } from "@/items/schema";
import type { Channel } from "./attempts";
import { relayModel, relayTimeoutMs } from "./model";
import { puzzleToPng } from "@/items/puzzle-png";

/**
 * Agent solver — sends one puzzle through the relay to a vision (or text) model
 * and records which lettered option it picks.
 *
 * Three channels:
 *   - image:        the same composed SVG a human sees, rendered to PNG and sent
 *                   as a multimodal image part. The only human-comparable channel.
 *   - symbolic:     the raw cell spec as JSON (answerIndex / explanation / rule
 *                   STRIPPED) for text-only models. Diagnostic, secondary.
 *   - options-only: the lettered option row alone, as an image, told that the
 *                   question is hidden. Measures the shortcut the options give
 *                   away; chance is 1 in 6 (docs/plans/blind-answer-leak.md).
 *
 * The prompt is fixed, neutral, and versioned so reports never silently mix
 * prompt revisions (see AttemptFile.promptVersion). The options-only prompt
 * differs by one clause, and its channel keeps it a population of its own.
 */

/**
 * Version of the whole question-to-answer path, not just the prompt text.
 * Reports group by it so runs measured under different rules are never pooled.
 * `v6` (2026-10-04) keeps `v5`'s prompt and reply reading; the image draws stars
 * with fatter arms (`STAR_INNER_RATIO`, src/items/render.tsx), so grey reads
 * inside them. `v5` (2026-10-04) keeps `v4`'s prompt and reply reading but changes the
 * image again: machine gates are jigsaw pieces snapped together instead of
 * board shapes in a dashed box (src/items/gate-pieces.ts). `v4` (2026-10-03) keeps `v3`'s prompt and reply reading but changes the image:
 * numbered sequences, "A → B" over "C → ?" analogies and flow arrows in 3 × 3
 * grids, the same cues a person now sees. `v3` keeps
 * `v2`'s prompt but scans the entire reply and prefers the last letter; `v2`
 * read only the first 200 characters and took the first letter.
 */
export const SOLVER_PROMPT_VERSION = "solver-v6";

/** Fixed neutral instruction — identical across channels and models. */
const SOLVER_PROMPT =
  "This is a visual puzzle. Exactly one lettered option is correct. Reply with ONLY the letter.";

/** The same instruction for the options-only arm, saying what is missing. */
const OPTIONS_ONLY_PROMPT =
  "These are the lettered answer options of a visual puzzle; the question itself is not shown. " +
  "Exactly one lettered option is correct. Reply with ONLY the letter.";

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
  /**
   * The model the reply says answered (its `model` field). With the Codex
   * bridge's `default` the request names no model, so this is the only record
   * of which one ran; the harness keeps one model per artifact by it.
   */
  modelUsed?: string;
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
function symbolicPayload(puzzle: Puzzle | PublicPuzzle): string {
  const body = {
    layout: puzzle.layout,
    stem: puzzle.stem,
    options: puzzle.options.map((cell, i) => ({ label: LETTERS[i], ...cell })),
  };
  return JSON.stringify(body, null, 2);
}

/**
 * Solve one puzzle on the given channel. Reuses model.ts's relayModel() factory
 * (provider injection + 429 interception + attribution) and the AI SDK's
 * multimodal `messages` content parts. maxRetries: 0 — the relay handles
 * provider reliability; we want one clean attempt per call.
 */
export async function solveItem(
  puzzle: Puzzle | PublicPuzzle,
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
  let modelUsed: string | undefined;

  if (channel === "image" || channel === "options-only") {
    const optionsOnly = channel === "options-only";
    const png = await puzzleToPng(puzzle, { optionsOnly });
    const { text, response } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: png, mediaType: "image/png" },
            { type: "text", text: optionsOnly ? OPTIONS_ONLY_PROMPT : SOLVER_PROMPT },
          ],
        },
      ],
      maxRetries: 0,
      abortSignal,
    });
    raw = text;
    modelUsed = response.modelId;
  } else {
    const { text, response } = await generateText({
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
    modelUsed = response.modelId;
  }

  return {
    chosen: parseAnswerLetter(raw, optionCount),
    raw,
    latencyMs: Date.now() - started,
    modelUsed,
  };
}

/**
 * Version of the follow-up questions `debriefItem` asks after a scored answer
 * (`agent-run --debrief`). Separate from `SOLVER_PROMPT_VERSION` because the
 * scored path is untouched: the answer is given and recorded before any of
 * this is asked, so the score of a debriefed run pools with one that was not.
 */
export const DEBRIEF_PROMPT_VERSION = "debrief-v1";

/** Asked before the intended answer is shown, so confidence and rule are the model's own. */
const DEBRIEF_BEFORE_PROMPT =
  "Your answer is recorded and will not change. Now report honestly on this puzzle, as a single " +
  "JSON object and nothing else, with these keys: " +
  '"confidence": a number from 0 to 100, how sure you are that your answer is the intended one; ' +
  '"rule": one sentence, the rule you think the puzzle uses; ' +
  '"difficulty": a whole number from 1 (very easy) to 5 (very hard), for you; ' +
  '"hard_to_see": anything in the picture that was hard to see or read, or "nothing".';

/** Asked after it, so the model can say whether another option is as defensible. */
function debriefAfterPrompt(intended: string): string {
  return `The intended answer is ${intended}. Report honestly, as a single JSON object and nothing else, ` +
    `with these keys: "only_defensible": true if ${intended} is clearly the only option a careful solver ` +
    `could defend, false if another option is about as defensible; "other_option": that other option's ` +
    `letter, or null; "other_rule": one sentence, the rule that would make the other option correct, or ` +
    `null; "what_misled": if your answer was not ${intended}, what led you to it, otherwise null; ` +
    `"unclear": anything about how to read the puzzle that was unclear, or "nothing".`;
}

/** The outermost `{…}` of a reply parsed as a JSON object, or null. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const textField = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 500) : null;

const numberField = (value: unknown, low: number, high: number, whole: boolean): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < low || parsed > high) return null;
  return whole && !Number.isInteger(parsed) ? null : parsed;
};

/** The first follow-up reply, read field by field; a field it left out or mistyped is null. */
export function readDebriefBefore(raw: string): {
  confidence: number | null; rule: string | null; difficulty: number | null; hardToSee: string | null;
} | null {
  const reply = parseJsonObject(raw);
  if (!reply) return null;
  return {
    confidence: numberField(reply.confidence, 0, 100, false),
    rule: textField(reply.rule),
    difficulty: numberField(reply.difficulty, 1, 5, true),
    hardToSee: textField(reply.hard_to_see),
  };
}

/** The second follow-up reply; `otherOption` is a letter on the image the model saw. */
export function readDebriefAfter(raw: string, optionCount: number): {
  onlyDefensible: boolean | null; otherOption: string | null; otherRule: string | null;
  whatMisled: string | null; unclear: string | null;
} | null {
  const reply = parseJsonObject(raw);
  if (!reply) return null;
  const letter = typeof reply.other_option === "string" ? reply.other_option.trim().toUpperCase() : "";
  const index = LETTERS.indexOf(letter as (typeof LETTERS)[number]);
  return {
    onlyDefensible: typeof reply.only_defensible === "boolean" ? reply.only_defensible : null,
    otherOption: index >= 0 && index < optionCount ? letter : null,
    otherRule: textField(reply.other_rule),
    whatMisled: textField(reply.what_misled),
    unclear: textField(reply.unclear),
  };
}

/** The letter an option index carries on the image. */
export function optionLetter(index: number): string {
  return LETTERS[index];
}

/** One follow-up reply, and the model its response says wrote it. */
export interface DebriefTurn {
  raw: string;
  modelId?: string;
}

/**
 * What the follow-up turns produced. Each completed turn is kept on its own, so
 * a second turn that times out or is rate limited never costs the first one.
 * `error` says why the follow-up stopped early, if it did.
 */
export interface DebriefReplies {
  before?: DebriefTurn;
  after?: DebriefTurn;
  error?: string;
}

/**
 * Ask the model about an item it has just answered, in two more turns of the
 * same conversation: its confidence, rule, difficulty and anything hard to see;
 * then, with the intended answer shown, whether another option is as
 * defensible. Image channel only, the same picture and shuffle it answered.
 *
 * `answeredBy` is the model the scored reply says answered. The follow-up
 * client is built from the requested name, and a moving name such as Codex's
 * `default` can reach a different model between two calls. A reply from any
 * model other than `answeredBy` is not this model's own report: it is dropped,
 * nothing after it is asked, and `error` names both models. Returns the raw
 * replies; reading them is the caller's.
 */
export async function debriefItem(
  puzzle: Puzzle | PublicPuzzle,
  answerRaw: string,
  intendedIndex: number,
  answeredBy: string | undefined,
  opts?: SolverOpts,
): Promise<DebriefReplies> {
  const { model, provider } = relayModel({
    provider: opts?.provider,
    model: opts?.model,
    apiKey: opts?.apiKey,
    thinkingBudget: opts?.thinkingBudget,
    effort: opts?.effort,
  });
  const timeout = () => AbortSignal.timeout(opts?.timeoutMs ?? relayTimeoutMs(provider, DEFAULT_TIMEOUT_MS));
  const png = await puzzleToPng(puzzle);
  const question = {
    role: "user" as const,
    content: [
      { type: "image" as const, image: png, mediaType: "image/png" },
      { type: "text" as const, text: SOLVER_PROMPT },
    ],
  };
  const answer = { role: "assistant" as const, content: answerRaw.trim() || "(no answer)" };
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const otherModel = (turn: string, modelId: string | undefined) =>
    answeredBy && modelId && modelId !== answeredBy
      ? `the ${turn} follow-up was answered by ${modelId}, not ${answeredBy}, so it is not that model's own report`
      : undefined;

  let before: DebriefTurn;
  try {
    const reply = await generateText({
      model,
      messages: [question, answer, { role: "user", content: DEBRIEF_BEFORE_PROMPT }],
      maxRetries: 0,
      abortSignal: timeout(),
    });
    before = { raw: reply.text, modelId: reply.response.modelId };
  } catch (err) {
    return { error: `the first follow-up failed: ${message(err)}` };
  }
  const movedBefore = otherModel("first", before.modelId);
  if (movedBefore) return { error: movedBefore };

  let after: DebriefTurn;
  try {
    const reply = await generateText({
      model,
      messages: [
        question,
        answer,
        { role: "user", content: DEBRIEF_BEFORE_PROMPT },
        { role: "assistant", content: before.raw },
        { role: "user", content: debriefAfterPrompt(LETTERS[intendedIndex]) },
      ],
      maxRetries: 0,
      abortSignal: timeout(),
    });
    after = { raw: reply.text, modelId: reply.response.modelId };
  } catch (err) {
    return { before, error: `the second follow-up failed: ${message(err)}` };
  }
  const movedAfter = otherModel("second", after.modelId);
  return movedAfter ? { before, error: movedAfter } : { before, after };
}
