import { createHash } from "node:crypto";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import { leaderboardEnabled, leaderboardNamespace, quizNamespace } from "./leaderboard-config";
import { linkTestLength, type LinkTest } from "./link-test";
import type { LeaderboardEntry, TakerKind } from "./leaderboard-types";
import type { QuizTokenPayload } from "./quiz-token";
import { scoreQuiz } from "./quiz-scoring";
import { redisCommand } from "./redis";
import { ScoringError } from "./scoring";

export class SubmissionConflictError extends Error {}

/**
 * The fastest a 30-question test may finish and still rank: four seconds a
 * question. No person reads 30 puzzles faster, and no agent observed so far
 * comes close; a script that reads answers does (docs/plans/leaderboard-integrity.md).
 */
export const MIN_RANKED_SECONDS = 120;
export class LeaderboardEligibilityError extends Error {}

export type ScoredResponse = ReturnType<typeof scoreQuiz> & { leaderboardEligible: boolean };
/**
 * A row as stored. The owner's removal keeps it as a tombstone, so its test cannot publish again.
 * Rows published before 2026-10-16 also carry points, which are no longer shown.
 */
type StoredEntry = LeaderboardEntry & { removed?: true; points?: number };

const REMOVED_MESSAGE = "This result was removed from the leaderboard.";

function publicEntry(stored: StoredEntry): LeaderboardEntry {
  if (stored.removed) throw new LeaderboardEligibilityError(REMOVED_MESSAGE);
  const { id, nickname, kind, correct, total, elapsedSeconds, appVersion, submittedAt } = stored;
  return { id, nickname, ...(kind && { kind }), correct, total, elapsedSeconds, appVersion, submittedAt };
}

function readEntry(raw: string): LeaderboardEntry {
  return publicEntry(JSON.parse(raw) as StoredEntry);
}
interface SubmissionReceipt {
  answersHash: string;
  submittedAt: number;
  response: ScoredResponse;
  /** Selected at the first submission; older receipts used the deployment's board. */
  leaderboardNamespace?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function submissionKey(token: string, namespace: string): string {
  return `${namespace}:submission:${hash(token)}`;
}

function answersKey(token: string): string {
  return `${quizNamespace()}:answers:${hash(token)}`;
}

interface AnswerProgress {
  answers: readonly (number | null)[];
  receivedAtMs: number;
}

// The server supplies the time. Older requests cannot overwrite newer answers,
// and neither the deadline nor a submitted result can be reopened by a client.
const SAVE_ANSWERS = `
local current = redis.call('GET', KEYS[1])
if tonumber(ARGV[2]) >= tonumber(ARGV[3]) or redis.call('EXISTS', KEYS[2]) == 1 then return current end
if current and cjson.decode(current).receivedAtMs > tonumber(ARGV[2]) then return current end
local next = cjson.decode(ARGV[1])
local previous = current and cjson.decode(current) or nil
for i = #next.answers + 1, tonumber(ARGV[5]) do
  next.answers[i] = previous and previous.answers[i] or cjson.null
end
local saved = cjson.encode(next)
redis.call('SET', KEYS[1], saved, 'EX', ARGV[4])
return saved
`;

/** Record answers without scoring; a link prefix leaves later saved choices intact. */
export async function recordQuizAnswers(
  token: string,
  test: Pick<LinkTest, "profile" | "answerDeadline" | "expiresAt">,
  answers: readonly (number | null)[],
  receivedAtMs: number,
): Promise<void> {
  if (answers.length > linkTestLength(test) || answers.some((answer) =>
    answer !== null && (!Number.isInteger(answer) || answer < 0 || answer >= OPTIONS_PER_ITEM))) {
    throw new ScoringError("Submit one valid answer or skip for every question.");
  }
  await redisCommand<string | null>([
    "EVAL", SAVE_ANSWERS, 2, answersKey(token), submissionKey(token, quizNamespace()),
    JSON.stringify({ answers, receivedAtMs } satisfies AnswerProgress), receivedAtMs,
    test.answerDeadline * 1000, Math.max(1, test.expiresAt - Math.floor(Date.now() / 1000)), linkTestLength(test),
  ]);
}

function boardKey(namespace: string): string {
  return `${namespace}:leaderboard`;
}

function entryKey(id: string, namespace: string): string {
  return `${boardKey(namespace)}:entry:${id}`;
}

function readReceipt(raw: string, answersHash: string): ScoredResponse {
  const receipt = JSON.parse(raw) as SubmissionReceipt;
  if (receipt.answersHash !== answersHash) {
    throw new SubmissionConflictError("This quiz was already submitted with different answers. Start a new test.");
  }
  // Receipts saved before 2026-10-16 also carry points; drop them without rewriting the receipt.
  const response: ScoredResponse & { points?: number } = { ...receipt.response };
  delete response.points;
  return response;
}

/** Recover the saved result without rebuilding its answer key. Callers validate the token first. */
export async function readQuizSubmission(token: string, answers: readonly (number | null)[]): Promise<ScoredResponse | null> {
  const raw = await redisCommand<string | null>(["GET", submissionKey(token, quizNamespace())]);
  return raw === null ? null : readReceipt(raw, hash(JSON.stringify(answers)));
}

/**
 * Save before returning any answers. Identical retries recover the immutable original result.
 * Malformed answers throw `ScoringError` before any storage call, so they never cost a write
 * or read as a conflict with a stored result.
 * `submittedAt` preserves an arrival recorded before incremental rebuilding;
 * `nowSeconds` remains the current time for the receipt's expiry.
 */
export async function submitQuizOnce(
  token: string,
  quiz: QuizTokenPayload,
  answers: readonly (number | null)[],
  nowSeconds: number,
  options: { submittedAt?: number } = {},
): Promise<ScoredResponse> {
  const submittedAt = options.submittedAt ?? nowSeconds;
  // Validate the submitted shape before any storage access, including for a late test.
  let scored = scoreQuiz(quiz, answers, submittedAt);
  const scope = quizNamespace();
  const namespace = leaderboardNamespace();
  const key = submissionKey(token, scope);
  const answersHash = hash(JSON.stringify(answers));
  const existing = await redisCommand<string | null>(["GET", key]);
  if (existing !== null) return readReceipt(existing, answersHash);

  if (scored.timedOut) {
    const raw = await redisCommand<string | null>(["GET", answersKey(token)]);
    const progress = raw === null ? null : JSON.parse(raw) as AnswerProgress;
    if (progress && (!Number.isFinite(progress.receivedAtMs) || progress.receivedAtMs >= quiz.answerDeadline * 1000)) {
      throw new Error("Invalid saved answer timing.");
    }
    // A late final request cannot supply new answers or change an earlier choice.
    scored = scoreQuiz(quiz, progress?.answers ?? Array<null>(quiz.items.length).fill(null), submittedAt);
  }
  const response: ScoredResponse = {
    ...scored,
    leaderboardEligible: leaderboardEnabled() && quiz.leaderboardAllowed === true &&
      quiz.leaderboardScope === scope &&
      scored.total === 30 && scored.appVersion !== null &&
      scored.elapsedSeconds >= MIN_RANKED_SECONDS,
  };
  const receipt: SubmissionReceipt = {
    answersHash, submittedAt, response,
    leaderboardNamespace: namespace,
  };
  const stored = await redisCommand<string | null>([
    "SET", key, JSON.stringify(receipt), "EX", Math.max(1, quiz.expiresAt - nowSeconds), "NX",
  ]);
  if (stored === "OK") return response;

  // Another request won the atomic SET; it owns both the answers and the time.
  const winner = await redisCommand<string | null>(["GET", key]);
  if (winner === null) throw new Error("The first submission could not be recovered.");
  return readReceipt(winner, answersHash);
}

/** Elapsed seconds the ranking can tell apart; longer times tie at the slowest. */
const RANK_TIME_SPAN = 100_000;

/**
 * The ranking's score: more correct answers first, then less elapsed time.
 * Elapsed time is clamped so it never outweighs one correct answer.
 */
function rankScore({ correct, elapsedSeconds }: Pick<LeaderboardEntry, "correct" | "elapsedSeconds">): number {
  return correct * RANK_TIME_SPAN + (RANK_TIME_SPAN - 1 - Math.min(Math.max(0, elapsedSeconds), RANK_TIME_SPAN - 1));
}

// The receipt, entry and ranking are checked/written together. A retry can never
// create another row or rename an existing entry, including simultaneous requests.
const PUBLISH_ENTRY = `
local existing = redis.call('GET', KEYS[2])
if existing then return existing end
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
redis.call('SET', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[2], ARGV[3])
return ARGV[1]
`;

/** Publish only the server's first scored result, never values supplied by the browser. */
export async function publishLeaderboardEntry(
  token: string,
  nickname: string,
  kind: TakerKind,
): Promise<LeaderboardEntry> {
  if (!leaderboardEnabled()) throw new LeaderboardEligibilityError("The leaderboard is disabled.");
  const id = hash(token);
  const scope = quizNamespace();
  const namespace = leaderboardNamespace();
  const key = submissionKey(token, scope);
  const previous = await redisCommand<string | null>(["GET", entryKey(id, namespace)]);
  if (previous !== null) return readEntry(previous);

  const raw = await redisCommand<string | null>(["GET", key]);
  if (raw === null) throw new LeaderboardEligibilityError("This result has expired or has not been submitted. Take a new test.");
  const receipt = JSON.parse(raw) as SubmissionReceipt;
  if ((receipt.leaderboardNamespace ?? scope) !== namespace) {
    throw new LeaderboardEligibilityError("This result belongs to another leaderboard.");
  }
  const result = receipt.response;
  if (!result.leaderboardEligible || result.total !== 30 || !result.appVersion) {
    throw new LeaderboardEligibilityError(
      "Only 30-question tests that took at least 2 minutes can join the leaderboard.",
    );
  }
  const entry: LeaderboardEntry = {
    id,
    nickname,
    kind,
    correct: result.score,
    total: 30,
    elapsedSeconds: result.elapsedSeconds,
    appVersion: result.appVersion,
    submittedAt: receipt.submittedAt,
  };
  const saved = await redisCommand<string | null>([
    "EVAL", PUBLISH_ENTRY, 3, key, entryKey(id, namespace), boardKey(namespace),
    JSON.stringify(entry), rankScore(entry), id,
  ]);
  if (saved === null) throw new LeaderboardEligibilityError("This result has expired. Take a new test.");
  return readEntry(saved);
}

/** Ranked rows, best first; a tombstone never reaches a reader, even mid-removal. */
async function rankedEntries(namespace: string, last: number): Promise<LeaderboardEntry[]> {
  const ids = await redisCommand<string[]>(["ZREVRANGE", boardKey(namespace), 0, last]);
  if (ids.length === 0) return [];
  const rows = await redisCommand<(string | null)[]>(["MGET", ...ids.map((id) => entryKey(id, namespace))]);
  return rows.filter((row): row is string => row !== null)
    .map((row) => JSON.parse(row) as StoredEntry)
    .filter((entry) => !entry.removed)
    .map(publicEntry);
}

export async function listLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!leaderboardEnabled()) return [];
  // A few spare rows, so a missing or removed row cannot shorten the top 20.
  return (await rankedEntries(leaderboardNamespace(), 39)).slice(0, 20);
}

/** Every ranked row on one board, best first. For the owner's removal script. */
export async function listBoardEntries(namespace: string): Promise<LeaderboardEntry[]> {
  return rankedEntries(namespace, -1);
}

/**
 * Re-score every ranked row from its saved entry, for rows ranked under an
 * older rule (before 2026-10-16, points with a speed bonus). Safe to repeat.
 * Returns the number of rows re-scored.
 */
export async function reindexBoard(namespace: string): Promise<number> {
  const entries = await listBoardEntries(namespace);
  if (entries.length === 0) return 0;
  // XX only updates rows still ranked, so a row removed meanwhile stays off the board.
  await redisCommand(["ZADD", boardKey(namespace), "XX", ...entries.flatMap((entry) => [rankScore(entry), entry.id])]);
  return entries.length;
}

// The tombstone and the ranking change together, so no reader sees one without the other.
const REMOVE_ENTRY = `
redis.call('SET', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[2])
return 1
`;

/** Take a row off one board, leaving a tombstone so its test cannot be published again. */
export async function removeLeaderboardEntry(namespace: string, entry: LeaderboardEntry): Promise<void> {
  const tombstone: StoredEntry = { ...entry, removed: true };
  await redisCommand([
    "EVAL", REMOVE_ENTRY, 2, entryKey(entry.id, namespace), boardKey(namespace), JSON.stringify(tombstone), entry.id,
  ]);
}
