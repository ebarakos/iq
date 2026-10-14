import { createHash } from "node:crypto";
import { leaderboardEnabled, leaderboardNamespace, quizNamespace } from "./leaderboard-config";
import type { LeaderboardEntry } from "./leaderboard-types";
import type { QuizTokenPayload } from "./quiz-token";
import { scoreQuiz } from "./quiz-scoring";
import { redisCommand } from "./redis";

export class SubmissionConflictError extends Error {}
export class LeaderboardEligibilityError extends Error {}

type ScoredResponse = ReturnType<typeof scoreQuiz> & { leaderboardEligible: boolean };
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

/**
 * Save before returning any answers. Identical retries recover the immutable original result.
 * Malformed answers throw `ScoringError` before any storage call, so they never cost a write
 * or read as a conflict with a stored result.
 */
export async function submitQuizOnce(
  token: string,
  quiz: QuizTokenPayload,
  answers: readonly (number | null)[],
  nowSeconds: number,
): Promise<ScoredResponse> {
  const scored = scoreQuiz(quiz, answers, nowSeconds);
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
      scored.total === 30 && !scored.late && scored.appVersion !== null,
  };
  const receipt: SubmissionReceipt = {
    answersHash, submittedAt: nowSeconds, response,
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
export async function publishLeaderboardEntry(token: string, nickname: string): Promise<LeaderboardEntry> {
  if (!leaderboardEnabled()) throw new LeaderboardEligibilityError("The leaderboard is disabled.");
  const id = hash(token);
  const scope = quizNamespace();
  const namespace = leaderboardNamespace();
  const key = submissionKey(token, scope);
  const previous = await redisCommand<string | null>(["GET", entryKey(id, namespace)]);
  if (previous !== null) return JSON.parse(previous) as LeaderboardEntry;

  const raw = await redisCommand<string | null>(["GET", key]);
  if (raw === null) throw new LeaderboardEligibilityError("This result has expired or has not been submitted. Take a new test.");
  const receipt = JSON.parse(raw) as SubmissionReceipt;
  if ((receipt.leaderboardNamespace ?? scope) !== namespace) {
    throw new LeaderboardEligibilityError("This result belongs to another leaderboard.");
  }
  const result = receipt.response;
  if (!result.leaderboardEligible || result.total !== 30 || result.late || !result.appVersion) {
    throw new LeaderboardEligibilityError("Only eligible, on-time 30-question tests can join the leaderboard.");
  }
  const entry: LeaderboardEntry = {
    id,
    nickname,
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
  return JSON.parse(saved) as LeaderboardEntry;
}

export async function listLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!leaderboardEnabled()) return [];
  const namespace = leaderboardNamespace();
  const ids = await redisCommand<string[]>(["ZREVRANGE", boardKey(namespace), 0, 19]);
  if (ids.length === 0) return [];
  const rows = await redisCommand<(string | null)[]>(["MGET", ...ids.map((id) => entryKey(id, namespace))]);
  return rows.filter((row): row is string => row !== null).map((row) => JSON.parse(row) as LeaderboardEntry);
}
