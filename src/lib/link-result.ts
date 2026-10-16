import { createHash } from "node:crypto";
import { z } from "zod";
import { fillExpandedSlots } from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds } from "@/items/family-promotion";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import { quizNamespace } from "./leaderboard-config";
import { readQuizSubmission, SubmissionConflictError, submitQuizOnce, type ScoredResponse } from "./leaderboard";
import { linkTestLength, linkTestQuestion, scoringPayloadFromItems, type LinkTest } from "./link-test";
import { answerKeyItems, QuizTokenPayloadSchema } from "./quiz-token";
import { redisCommand } from "./redis";
import { ScoringError } from "./scoring";

// Leave room for Redis and a cold server within a chat fetcher's timeout.
const BUILD_BUDGET_MS = 600;
const ProgressSchema = z.object({
  answers: z.array(z.number().int().min(0).max(OPTIONS_PER_ITEM - 1).nullable()).max(30),
  submittedAt: z.number().int().nonnegative(),
  items: z.array(QuizTokenPayloadSchema.shape.items.element).max(30),
  // Legacy generated tokens do not carry kept attempts. Resume their original
  // assembler instead of rebuilding the whole test on the first question.
  attempts: z.array(z.number().int().min(0).max(9)).max(30),
  questions: z.array(z.string()).max(30),
});

// Claim the first answers/time before doing work, then save only over the
// state read. Every caller receives the winner; no stale page moves backward.
const SAVE_RESULT_PROGRESS = `
local current = redis.call('GET', KEYS[1])
if (not current and ARGV[1] == '') or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return ARGV[2]
end
return current
`;

type ResultStep = { scored: ScoredResponse } | { built: number };

/**
 * Rebuild a cold result in short requests. The answer key stays in Redis;
 * only a durable submission receipt may release the score and review.
 * The caller opens the token and captures receivedAt before awaiting work.
 */
export async function scoreLinkResult(
  token: string,
  test: LinkTest,
  answers: readonly (number | null)[],
  receivedAt: number,
  options: { budgetMs?: number } = {},
): Promise<ResultStep> {
  const total = linkTestLength(test);
  if (answers.length !== total || answers.some((answer) =>
    answer !== null && (!Number.isInteger(answer) || answer < 0 || answer >= OPTIONS_PER_ITEM))) {
    throw new ScoringError("Submit one valid answer or skip for every question.");
  }
  const existing = await readQuizSubmission(token, answers);
  if (existing) return { scored: existing };

  const key = `${quizNamespace()}:result:${createHash("sha256").update(token).digest("hex")}`;
  const save = (previous: string, next: z.infer<typeof ProgressSchema>) => redisCommand<string | null>([
    "EVAL", SAVE_RESULT_PROGRESS, 1, key, previous, JSON.stringify(next),
    Math.max(1, test.expiresAt - Math.floor(Date.now() / 1000)),
  ]);
  const parse = (raw: string | null) => {
    if (raw === null) throw new Error("The result calculation could not be recovered.");
    const progress = ProgressSchema.parse(JSON.parse(raw));
    if (JSON.stringify(progress.answers) !== JSON.stringify(answers)) {
      throw new SubmissionConflictError("This quiz was already submitted with different answers. Start a new test.");
    }
    if (progress.items.length > total) throw new Error("Invalid result calculation.");
    return progress;
  };

  const stored = await save("", { answers: [...answers], submittedAt: receivedAt, items: [], attempts: [], questions: [] });
  let progress = parse(stored);
  if (progress.items.length < total) {
    const next = { ...progress, items: [...progress.items], attempts: [...progress.attempts], questions: [...progress.questions] };
    const legacy = test.source === "generated" && !test.attempts
      ? fillExpandedSlots(test.seed, test.profile, CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds(), progress)
      : undefined;
    const started = Date.now();
    let previous = started;
    let slowest = 0;
    while (next.items.length < total) {
      const filled = legacy?.next().value;
      const puzzle = filled ? filled.puzzle : linkTestQuestion(test, next.items.length + 1);
      if (!puzzle) throw new Error("A result question could not be rebuilt.");
      next.items.push(answerKeyItems([puzzle])[0]);
      if (filled) {
        next.attempts.push(filled.attempt);
        next.questions.push(filled.question);
      }
      const now = Date.now();
      slowest = Math.max(slowest, now - previous);
      previous = now;
      if (now - started + slowest >= (options.budgetMs ?? BUILD_BUDGET_MS)) break;
    }
    progress = parse(await save(stored!, next));
  }
  if (progress.items.length < total) return { built: progress.items.length };

  const scored = await submitQuizOnce(
    token, scoringPayloadFromItems(test, progress.items), answers, Math.floor(Date.now() / 1000),
    { submittedAt: progress.submittedAt },
  );
  return { scored };
}
