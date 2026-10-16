import { createHash } from "node:crypto";
import { leaderboardEnabled, leaderboardNamespace, quizNamespace } from "./leaderboard-config";
import type { LeaderboardEntry, TakerKind } from "./leaderboard-types";
import type { QuizTokenPayload } from "./quiz-token";
import { scoreQuiz } from "./quiz-scoring";
import { redisCommand } from "./redis";

export class SubmissionConflictError extends Error {}

/**
 * The fastest a 30-question test may finish and still rank: four seconds a
 * question. No person reads 30 puzzles faster, and no agent observed so far
 * comes close; a script that reads answers does (docs/plans/leaderboard-integrity.md).
 */
export const MIN_RANKED_SECONDS = 120;
export class LeaderboardEligibilityError extends Error {}

export type ScoredResponse = ReturnType<typeof scoreQuiz> & { leaderboardEligible: boolean };
/** A row as stored. The owner's removal keeps it as a tombstone, so its test cannot publish again. */
type StoredEntry = LeaderboardEntry & { removed?: true };

const REMOVED_MESSAGE = "This result was removed from the leaderboard.";

function readEntry(raw: string): LeaderboardEntry {
  const { removed, ...entry } = JSON.parse(raw) as StoredEntry;
  if (removed) throw new LeaderboardEligibilityError(REMOVED_MESSAGE);
  return entry;
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
  return receipt.response;
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
  const scored = scoreQuiz(quiz, answers, submittedAt);
  const scope = quizNamespace();
  const namespace = leaderboardNamespace();
  const key = submissionKey(token, scope);
  const answersHash = hash(JSON.stringify(answers));
  const existing = await redisCommand<string | null>(["GET", key]);
  if (existing !== null) return readReceipt(existing, answersHash);

  const response: ScoredResponse = {
    ...scored,
    leaderboardEligible: leaderboardEnabled() && quiz.leaderboardAllowed === true &&
      quiz.leaderboardScope === scope &&
      scored.total === 30 && !scored.late && scored.appVersion !== null &&
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
  if (!result.leaderboardEligible || result.total !== 30 || result.late || !result.appVersion) {
    throw new LeaderboardEligibilityError(
      "Only on-time 30-question tests that took at least 2 minutes can join the leaderboard.",
    );
  }
  const entry: LeaderboardEntry = {
    id,
    nickname,
    kind,
    points: result.points,
    correct: result.score,
    total: 30,
    elapsedSeconds: result.elapsedSeconds,
    appVersion: result.appVersion,
    submittedAt: receipt.submittedAt,
  };
  // Points determine rank; when rounded points tie, the faster attempt ranks first.
  const rankScore = entry.points * 10_000 + Math.max(0, 1800 - entry.elapsedSeconds);
  const saved = await redisCommand<string | null>([
    "EVAL", PUBLISH_ENTRY, 3, key, entryKey(id, namespace), boardKey(namespace),
    JSON.stringify(entry), rankScore, id,
  ]);
  if (saved === null) throw new LeaderboardEligibilityError("This result has expired. Take a new test.");
  return readEntry(saved);
}

/** Ranked rows as stored, best first; a tombstone never reaches a reader, even mid-removal. */
async function rankedEntries(namespace: string, last: number): Promise<LeaderboardEntry[]> {
  const ids = await redisCommand<string[]>(["ZREVRANGE", boardKey(namespace), 0, last]);
  if (ids.length === 0) return [];
  const rows = await redisCommand<(string | null)[]>(["MGET", ...ids.map((id) => entryKey(id, namespace))]);
  return rows.filter((row): row is string => row !== null)
    .map((row) => JSON.parse(row) as StoredEntry)
    .filter((entry) => !entry.removed);
}

export async function listLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!leaderboardEnabled()) return [];
  // A few spare rows, so a tombstone still in the ranking cannot shorten the top 20.
  return (await rankedEntries(leaderboardNamespace(), 39)).slice(0, 20);
}

/** Every ranked row on one board, best first. For the owner's removal script. */
export async function listBoardEntries(namespace: string): Promise<LeaderboardEntry[]> {
  return rankedEntries(namespace, -1);
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
