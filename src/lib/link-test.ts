import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import packageJson from "../../package.json";
import { leaderboardEnabled, quizNamespace } from "./leaderboard-config";
import { loadBank, sampleExpandedBankQuiz, type BankItem } from "@/items/bank";
import {
  assembleExpandedTest,
  buildExpandedQuestion,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  fillExpandedSlots,
  questionCount,
  type ExpandedProfile,
} from "@/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  normalizeWithdrawnFamilyIds,
  readWithdrawnFamilyIds,
} from "@/items/family-promotion";
import { OPTIONS_PER_ITEM, type Puzzle, type PuzzleSet } from "@/items/schema";
import {
  answerKeyItems,
  openTokenJson,
  QUIZ_TOKEN_TTL_SECONDS,
  QuizTokenError,
  resolveQuizTokenSecret,
  SECONDS_PER_QUESTION,
  sealTokenJson,
  type QuizTokenPayload,
} from "./quiz-token";

/**
 * The test token, for both flows: the link test an agent takes by fetching
 * pages and following links (docs/plans/link-only-test.md), and the in-page
 * test, which shows the same questions as pictures
 * (docs/plans/leaderboard-integrity.md).
 *
 * It seals a seed, not the test. Every page and picture rebuilds the same test
 * from the seed, so the token stays short enough to sit in a link, and the
 * answers never leave the server. One token per test means one scoring receipt.
 */

const LINK_TOKEN_ENVELOPE = { version: "l1", aad: "aiq.link-token.v1" } as const;

export type LinkTestSource = "generated" | "fallback";

/** What a link token seals. Short keys: every character rides in every link. */
const LinkTokenSchema = z.object({
  /** The release and environment sealed when the test starts. */
  v: z.string().min(1).max(80).optional(),
  c: z.string().optional(),
  /** Whether ranking was on when the test started; a token without it never ranks. */
  r: z.boolean().optional(),
  /** The seed. */
  s: z.string().min(1).max(64),
  /** The length. */
  p: z.enum(EXPANDED_PROFILES),
  /**
   * Generated fresh, or drawn from the reference bank after generation failed.
   * A generated test carries `a` instead, which says the same in fewer characters.
   */
  o: z.enum(["generated", "fallback"]).optional(),
  /** `EXPANDED_GENERATOR_VERSION` when the test was made. */
  g: z.string().min(1),
  /** `withdrawnFamilyHash` when the test was made. */
  w: z.string().min(1),
  /** `bankHash` when the test was made; a fallback test only. */
  b: z.string().min(1).optional(),
  /**
   * The attempt each question's slot kept, one digit per question with trailing
   * zeros dropped; a generated test only. Lets a server rebuild one question.
   */
  a: z.string().regex(/^\d{0,30}$/).optional(),
  /** issuedAt, answerDeadline, expiresAt: epoch seconds, as in the quiz token. */
  i: z.number().int().nonnegative(),
  d: z.number().int().positive(),
  e: z.number().int().positive(),
}).refine((token) => token.i < token.d && token.d <= token.e, {
  message: "the deadline must fall between issue and expiry",
}).refine((token) => (token.o === undefined) !== (token.a === undefined), {
  message: "a token names its source or its kept attempts, not both",
});
type LinkTokenWire = z.infer<typeof LinkTokenSchema>;

/** A link test as the pages use it. */
export interface LinkTest {
  appVersion?: string;
  leaderboardScope?: string;
  rankAllowed?: boolean;
  seed: string;
  profile: ExpandedProfile;
  source: LinkTestSource;
  generatorVersion: string;
  withdrawnHash: string;
  bankHash?: string;
  /**
   * The attempt each question's slot kept (`assembleExpandedTest`), so one
   * question can be rebuilt without the rest. Absent on a fallback test and on
   * tokens made before it existed: those rebuild the whole test.
   */
  attempts?: number[];
  issuedAt: number;
  answerDeadline: number;
  expiresAt: number;
}

export class LinkTestError extends Error {
  constructor(
    /**
     * `changed`: the site now builds a different test from this seed (a new
     * generator version, a family withdrawn or restored, a new reference bank).
     */
    public readonly code: "invalid" | "expired" | "changed" | "configuration",
    message: string,
    /** The test's length, when the token opened far enough to say. */
    public readonly profile?: ExpandedProfile,
  ) {
    super(message);
    this.name = "LinkTestError";
  }
}

function shortHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url").slice(0, 12);
}

/** A short, order-independent hash of a withdrawal list: it changes what a seed builds. */
export function withdrawnFamilyHash(withdrawnFamilyIds: Iterable<string>): string {
  return shortHash(normalizeWithdrawnFamilyIds(withdrawnFamilyIds).join(","));
}

const bankHashes = new WeakMap<readonly BankItem[], string>();

/** A short hash of the reference bank, in its order: a fallback test is drawn from it. */
export function bankHash(items: readonly BankItem[]): string {
  let hash = bankHashes.get(items);
  if (!hash) {
    hash = shortHash(items.map((item) => item.fingerprint).join(","));
    bankHashes.set(items, hash);
  }
  return hash;
}

/** What the site builds tests from right now. Tests inject their own. */
export interface LinkTestContext {
  secret?: string;
  nowSeconds?: number;
  withdrawnFamilyIds?: ReadonlySet<string>;
  bank?: readonly BankItem[];
}

function resolveSecret(secret: string | undefined): string {
  try {
    return secret ?? resolveQuizTokenSecret();
  } catch (error) {
    if (error instanceof QuizTokenError) throw new LinkTestError("configuration", error.message);
    throw error;
  }
}

export function sealLinkToken(test: LinkTest, secret?: string): string {
  if (test.attempts?.some((attempt) => !Number.isInteger(attempt) || attempt < 0 || attempt > 9)) {
    throw new Error("a kept attempt must be one digit");
  }
  const wire: LinkTokenWire = LinkTokenSchema.parse({
    v: test.appVersion,
    c: test.leaderboardScope,
    ...(test.rankAllowed !== undefined ? { r: test.rankAllowed } : {}),
    s: test.seed,
    p: test.profile,
    ...(test.source === "generated" && test.attempts
      ? { a: test.attempts.join("").replace(/0+$/, "") }
      : { o: test.source }),
    g: test.generatorVersion,
    w: test.withdrawnHash,
    ...(test.bankHash ? { b: test.bankHash } : {}),
    i: test.issuedAt,
    d: test.answerDeadline,
    e: test.expiresAt,
  });
  return sealTokenJson(wire, LINK_TOKEN_ENVELOPE, resolveSecret(secret));
}

/**
 * Open a link token and check that the site still builds the same test from it.
 *
 * Throws `expired` past the token's own expiry, and `changed` when the
 * generator version, the withdrawal list or (for a fallback test) the
 * reference bank differs from the one the test was made with: the seed would
 * now build other questions, and the answers in the links would be scored
 * against them.
 */
export function openLinkToken(token: string, context: LinkTestContext = {}): LinkTest {
  const secret = resolveSecret(context.secret);
  let wire: LinkTokenWire;
  try {
    wire = LinkTokenSchema.parse(openTokenJson(token, LINK_TOKEN_ENVELOPE, secret));
  } catch {
    throw new LinkTestError("invalid", "This test link is not valid.");
  }
  const test: LinkTest = {
    appVersion: wire.v,
    leaderboardScope: wire.c,
    rankAllowed: wire.r,
    seed: wire.s,
    profile: wire.p,
    source: wire.o ?? "generated",
    generatorVersion: wire.g,
    withdrawnHash: wire.w,
    bankHash: wire.b,
    ...(wire.a !== undefined
      ? { attempts: Array.from({ length: questionCount(wire.p) }, (_, index) => Number(wire.a![index] ?? 0)) }
      : {}),
    issuedAt: wire.i,
    answerDeadline: wire.d,
    expiresAt: wire.e,
  };
  if (test.leaderboardScope !== undefined && test.leaderboardScope !== quizNamespace()) {
    throw new LinkTestError("invalid", "This test belongs to another environment.", test.profile);
  }
  const now = context.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (test.expiresAt <= now) {
    throw new LinkTestError("expired", "This test has expired.", test.profile);
  }
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  const changed =
    test.generatorVersion !== EXPANDED_GENERATOR_VERSION ||
    test.withdrawnHash !== withdrawnFamilyHash(withdrawn) ||
    (test.source === "fallback" && test.bankHash !== bankHash(context.bank ?? loadBank()));
  if (changed) {
    throw new LinkTestError("changed", "The site has changed since this test started.", test.profile);
  }
  return test;
}

/** Build a test's questions from its seed. Pure: the same inputs give the same test. */
function buildPuzzles(
  seed: string,
  profile: ExpandedProfile,
  source: LinkTestSource,
  withdrawn: ReadonlySet<string>,
  bank: () => readonly BankItem[],
): PuzzleSet {
  if (source === "generated") {
    return assembleExpandedTest(seed, profile, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn).puzzles;
  }
  const usable = bank().filter((item) =>
    !(item.puzzle.familyId && withdrawn.has(item.puzzle.familyId)));
  return sampleExpandedBankQuiz(usable, profile, seed, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn).puzzles;
}

/**
 * Recently built tests, by everything that decides their questions: the whole
 * test, or the questions built so far one at a time. Building a 30-question
 * test takes seconds, so a server that did not start the test builds only the
 * question a page or picture asks for (`linkTestQuestion`).
 */
interface BuiltTest {
  complete: boolean;
  puzzles: (Puzzle | undefined)[];
}
const BUILT_TESTS = new Map<string, BuiltTest>();
const BUILT_TESTS_LIMIT = 64;

function buildKey(test: Pick<LinkTest, "seed" | "profile" | "source" | "generatorVersion" | "withdrawnHash" | "bankHash">): string {
  return [test.seed, test.profile, test.source, test.generatorVersion, test.withdrawnHash, test.bankHash ?? ""].join("|");
}

function remember(key: string, built: BuiltTest): void {
  BUILT_TESTS.delete(key);
  BUILT_TESTS.set(key, built);
  while (BUILT_TESTS.size > BUILT_TESTS_LIMIT) {
    BUILT_TESTS.delete(BUILT_TESTS.keys().next().value as string);
  }
}

/** A new test before its clock starts: everything its token seals but the times. */
export type LinkTestDraft = Omit<LinkTest, "issuedAt" | "answerDeadline" | "expiresAt">;

function newDraft(
  seed: string,
  profile: ExpandedProfile,
  withdrawn: ReadonlySet<string>,
  built: { source: "generated"; attempts: number[] } | { source: "fallback"; bank: readonly BankItem[] },
): LinkTestDraft {
  return {
    appVersion: `v${packageJson.version}`,
    leaderboardScope: quizNamespace(),
    rankAllowed: leaderboardEnabled(),
    seed,
    profile,
    source: built.source,
    generatorVersion: EXPANDED_GENERATOR_VERSION,
    withdrawnHash: withdrawnFamilyHash(withdrawn),
    ...(built.source === "fallback" ? { bankHash: bankHash(built.bank) } : { attempts: built.attempts }),
  };
}

/**
 * Make a fresh link test. Generation runs first, here, so a seed that cannot
 * build is never handed out; if it fails, the test comes from the reference
 * bank, as `POST /api/generate` does.
 */
export function createLinkTest(
  profile: ExpandedProfile,
  context: LinkTestContext & { seed?: string; assemble?: typeof assembleExpandedTest } = {},
): { token: string; test: LinkTest; puzzles: PuzzleSet } {
  const secret = resolveSecret(context.secret);
  const seed = context.seed ?? randomBytes(16).toString("base64url");
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  const bank = () => context.bank ?? loadBank();
  const assemble = context.assemble ?? assembleExpandedTest;

  let draft: LinkTestDraft;
  let puzzles: PuzzleSet;
  try {
    const assembled = assemble(seed, profile, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn);
    puzzles = assembled.puzzles;
    draft = newDraft(seed, profile, withdrawn, { source: "generated", attempts: assembled.attempts });
  } catch (error) {
    console.error(`link-test: ${profile} assembly failed —`, error);
    puzzles = buildPuzzles(seed, profile, "fallback", withdrawn, bank);
    draft = newDraft(seed, profile, withdrawn, { source: "fallback", bank: bank() });
  }
  remember(buildKey(draft), { complete: true, puzzles });
  return { ...issueLinkTest(draft, { ...context, secret }), puzzles };
}

/**
 * A test being built over several requests (`src/lib/link-start.ts`): its seed
 * and the slots filled so far. It never leaves the server.
 */
export const LinkTestProgressSchema = z.object({
  seed: z.string().min(1).max(64),
  profile: z.enum(EXPANDED_PROFILES),
  generatorVersion: z.string().min(1),
  withdrawnHash: z.string().min(1),
  attempts: z.array(z.number().int().min(0).max(9)),
  questions: z.array(z.string()),
}).refine((progress) => progress.attempts.length === progress.questions.length, {
  message: "every filled slot has an attempt and a question",
});
export type LinkTestProgress = z.infer<typeof LinkTestProgressSchema>;

/** A test with nothing built yet. */
export function beginLinkTest(
  profile: ExpandedProfile,
  context: Pick<LinkTestContext, "withdrawnFamilyIds"> & { seed?: string } = {},
): LinkTestProgress {
  return {
    seed: context.seed ?? randomBytes(16).toString("base64url"),
    profile,
    generatorVersion: EXPANDED_GENERATOR_VERSION,
    withdrawnHash: withdrawnFamilyHash(context.withdrawnFamilyIds ?? readWithdrawnFamilyIds()),
    attempts: [],
    questions: [],
  };
}

/**
 * Build more of a test: at least one question, then more until `budgetMs` has
 * passed. Returns the finished draft once every question is built, otherwise
 * how far it got. The questions are the ones `createLinkTest` builds from the
 * same seed, and generation that fails falls back to the reference bank the
 * same way. Throws `changed` when the site now builds other questions from it.
 */
export function continueLinkTest(
  progress: LinkTestProgress,
  budgetMs: number,
  context: LinkTestContext = {},
): { draft: LinkTestDraft } | { progress: LinkTestProgress } {
  const { seed, profile } = progress;
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  if (progress.generatorVersion !== EXPANDED_GENERATOR_VERSION || progress.withdrawnHash !== withdrawnFamilyHash(withdrawn)) {
    throw new LinkTestError("changed", "The site has changed since this test started.", profile);
  }
  const deadline = Date.now() + budgetMs;
  const attempts = [...progress.attempts];
  const questions = [...progress.questions];
  try {
    for (const filled of fillExpandedSlots(seed, profile, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn, progress)) {
      attempts.push(filled.attempt);
      questions.push(filled.question);
      if (attempts.length < questionCount(profile) && Date.now() >= deadline) {
        return { progress: { ...progress, attempts, questions } };
      }
    }
  } catch (error) {
    console.error(`link-test: ${profile} assembly failed —`, error);
    const bank = () => context.bank ?? loadBank();
    const draft = newDraft(seed, profile, withdrawn, { source: "fallback", bank: bank() });
    remember(buildKey(draft), { complete: true, puzzles: buildPuzzles(seed, profile, "fallback", withdrawn, bank) });
    return { draft };
  }
  return { draft: newDraft(seed, profile, withdrawn, { source: "generated", attempts }) };
}

/** Start a drafted test's clock and seal its token. */
export function issueLinkTest(draft: LinkTestDraft, context: LinkTestContext = {}): { token: string; test: LinkTest } {
  // The clock is read after the questions exist: building them never comes
  // out of the taker's time.
  const issuedAt = context.nowSeconds ?? Math.floor(Date.now() / 1000);
  const test: LinkTest = {
    ...draft,
    issuedAt,
    answerDeadline: issuedAt + SECONDS_PER_QUESTION * questionCount(draft.profile),
    expiresAt: issuedAt + QUIZ_TOKEN_TTL_SECONDS,
  };
  return { token: sealLinkToken(test, context.secret), test };
}

function wholeTest(test: LinkTest, context: LinkTestContext): PuzzleSet {
  const key = buildKey(test);
  const cached = BUILT_TESTS.get(key);
  if (cached?.complete) {
    remember(key, cached);
    return cached.puzzles as PuzzleSet;
  }
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  const puzzles = buildPuzzles(test.seed, test.profile, test.source, withdrawn, () => context.bank ?? loadBank());
  remember(key, { complete: true, puzzles });
  return puzzles;
}

/** Open a link token and rebuild its test, exactly as it was first built. */
export function loadLinkTest(
  token: string,
  context: LinkTestContext = {},
): { test: LinkTest; puzzles: PuzzleSet } {
  const test = openLinkToken(token, context);
  return { test, puzzles: wholeTest(test, context) };
}

/** How many questions an opened test has. */
export function linkTestLength(test: Pick<LinkTest, "profile">): number {
  return questionCount(test.profile);
}

/**
 * Question `number` (1-based) of an opened test, or undefined past its end.
 * Builds only that question when the test records its kept attempts, so a page
 * or picture never waits for the other questions; otherwise builds them all.
 */
export function linkTestQuestion(
  test: LinkTest,
  number: number,
  context: LinkTestContext = {},
): Puzzle | undefined {
  if (!Number.isInteger(number) || number < 1 || number > linkTestLength(test)) return undefined;
  const key = buildKey(test);
  const cached = BUILT_TESTS.get(key);
  const known = cached?.puzzles[number - 1];
  if (cached && known) {
    remember(key, cached);
    return known;
  }
  if (test.source !== "generated" || !test.attempts) return wholeTest(test, context)[number - 1];
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  const puzzle = buildExpandedQuestion(
    test.seed, test.profile, number - 1, test.attempts[number - 1], CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn,
  );
  const built = cached ?? { complete: false, puzzles: [] };
  built.puzzles[number - 1] = puzzle;
  remember(key, built);
  return puzzle;
}

/**
 * What scoring needs, from a test and its rebuilt questions: the answers, the
 * times and what was sealed at the start. Both flows score through this.
 */
export function scoringPayload(test: LinkTest, puzzles: PuzzleSet): QuizTokenPayload {
  return {
    version: 1,
    issuedAt: test.issuedAt,
    expiresAt: test.expiresAt,
    answerDeadline: test.answerDeadline,
    appVersion: test.appVersion,
    leaderboardAllowed: test.rankAllowed === true,
    leaderboardScope: test.leaderboardScope,
    items: answerKeyItems(puzzles),
  };
}

/** Forget every built test. For tests that need a cold rebuild. */
export function clearBuiltLinkTests(): void {
  BUILT_TESTS.clear();
}

/** The option letters, one per option: A, B, C, … — as many as `OPTIONS_PER_ITEM`. */
export const OPTION_LETTERS: readonly string[] = Array.from(
  { length: OPTIONS_PER_ITEM },
  (_, index) => String.fromCharCode(65 + index),
);

/** How a skipped question is written in the answers parameter. */
export const SKIP_MARK = "-";

/**
 * Read the `a` parameter: one character per answered question, an option
 * letter or `-` for a skip. Null when it is not that.
 */
export function parseLinkAnswers(value: string | string[] | undefined): (number | null)[] | null {
  if (Array.isArray(value)) return null;
  const text = value ?? "";
  const answers: (number | null)[] = [];
  for (const mark of text) {
    if (mark === SKIP_MARK) {
      answers.push(null);
      continue;
    }
    const index = OPTION_LETTERS.indexOf(mark.toUpperCase());
    if (index < 0) return null;
    answers.push(index);
  }
  return answers;
}

/** Write answers as the `a` parameter. */
export function formatLinkAnswers(answers: readonly (number | null)[]): string {
  return answers.map((answer) => answer === null ? SKIP_MARK : OPTION_LETTERS[answer]).join("");
}

/** The path of question `n` (1-based) with the answers given so far. */
export function questionPath(token: string, n: number, answers: readonly (number | null)[]): string {
  const query = answers.length > 0 ? `?a=${formatLinkAnswers(answers)}` : "";
  return `/t/${token}/${n}${query}`;
}

/** The path of the result page for a full set of answers. */
export function resultPath(token: string, answers: readonly (number | null)[]): string {
  return `/t/${token}/result?a=${formatLinkAnswers(answers)}`;
}

/** The path of question `n`'s puzzle image. */
export function puzzleImagePath(token: string, n: number): string {
  return `/t/${token}/${n}/puzzle.png`;
}

/**
 * The path of one picture of question `n`: a stem panel (`s<i>`), an option
 * (`o<k>`), or a gate's jigsaw strip (`g<i>-right`, `g<i>-down`).
 */
export function pictureImagePath(token: string, n: number, part: string): string {
  return `/t/${token}/${n}/board/${part}.png`;
}

/** The path that publishes a link test's saved result under one agent name. */
export function publishPath(token: string, agent: string): string {
  return `/t/${token}/publish/${agent}`;
}

/** Where a new test of this length starts. */
export function startPath(profile: ExpandedProfile | undefined): string {
  return profile === "long-30" ? "/test" : "/sample";
}
