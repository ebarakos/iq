import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import packageJson from "../../package.json";
import { leaderboardEnabled, leaderboardNamespace } from "./leaderboard-config";
import { loadBank, sampleExpandedBankQuiz, type BankItem } from "@/items/bank";
import {
  assembleExpandedQuiz,
  EXPANDED_GENERATOR_VERSION,
  EXPANDED_PROFILES,
  type ExpandedProfile,
} from "@/items/expanded-quiz";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  normalizeWithdrawnFamilyIds,
  readWithdrawnFamilyIds,
} from "@/items/family-promotion";
import { OPTIONS_PER_ITEM, type PuzzleSet } from "@/items/schema";
import {
  openTokenJson,
  QUIZ_TOKEN_TTL_SECONDS,
  QuizTokenError,
  resolveQuizTokenSecret,
  SECONDS_PER_QUESTION,
  sealTokenJson,
} from "./quiz-token";

/**
 * The link test: a test an agent takes by fetching pages and following links,
 * with no JavaScript and no forms (docs/plans/link-only-test.md).
 *
 * Its token seals a seed, not the test. Every page rebuilds the same test from
 * the seed, so the token stays short enough to sit in a link, and the answers
 * never leave the server.
 */

const LINK_TOKEN_ENVELOPE = { version: "l1", aad: "aiq.link-token.v1" } as const;

export type LinkTestSource = "generated" | "fallback";

/** What a link token seals. Short keys: every character rides in every link. */
const LinkTokenSchema = z.object({
  /** Release and leaderboard settings sealed when the test starts. */
  v: z.string().min(1).max(80).optional(),
  l: z.boolean().optional(),
  c: z.string().optional(),
  /** The seed. */
  s: z.string().min(1).max(64),
  /** The length. */
  p: z.enum(EXPANDED_PROFILES),
  /** Generated fresh, or drawn from the reference bank after generation failed. */
  o: z.enum(["generated", "fallback"]),
  /** `EXPANDED_GENERATOR_VERSION` when the test was made. */
  g: z.string().min(1),
  /** `withdrawnFamilyHash` when the test was made. */
  w: z.string().min(1),
  /** `bankHash` when the test was made; a fallback test only. */
  b: z.string().min(1).optional(),
  /** issuedAt, answerDeadline, expiresAt: epoch seconds, as in the quiz token. */
  i: z.number().int().nonnegative(),
  d: z.number().int().positive(),
  e: z.number().int().positive(),
}).refine((token) => token.i < token.d && token.d <= token.e, {
  message: "the deadline must fall between issue and expiry",
});
type LinkTokenWire = z.infer<typeof LinkTokenSchema>;

/** A link test as the pages use it. */
export interface LinkTest {
  appVersion?: string;
  leaderboardAllowed?: boolean;
  leaderboardScope?: string;
  seed: string;
  profile: ExpandedProfile;
  source: LinkTestSource;
  generatorVersion: string;
  withdrawnHash: string;
  bankHash?: string;
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
  const wire: LinkTokenWire = LinkTokenSchema.parse({
    v: test.appVersion,
    l: test.leaderboardAllowed,
    c: test.leaderboardScope,
    s: test.seed,
    p: test.profile,
    o: test.source,
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
    leaderboardAllowed: wire.l,
    leaderboardScope: wire.c,
    seed: wire.s,
    profile: wire.p,
    source: wire.o,
    generatorVersion: wire.g,
    withdrawnHash: wire.w,
    bankHash: wire.b,
    issuedAt: wire.i,
    answerDeadline: wire.d,
    expiresAt: wire.e,
  };
  if (test.leaderboardScope !== undefined && test.leaderboardScope !== leaderboardNamespace()) {
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
    return assembleExpandedQuiz(seed, profile, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn);
  }
  const usable = bank().filter((item) =>
    !(item.puzzle.familyId && withdrawn.has(item.puzzle.familyId)));
  return sampleExpandedBankQuiz(usable, profile, seed, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn).puzzles;
}

/**
 * Recently built tests, by everything that decides their questions. A taker
 * fetches each question page and its image in turn, and rebuilding a 30-question
 * test takes a few hundred milliseconds, so a small cache spares most of that.
 */
const BUILT_TESTS = new Map<string, PuzzleSet>();
const BUILT_TESTS_LIMIT = 64;

function buildKey(test: Pick<LinkTest, "seed" | "profile" | "source" | "generatorVersion" | "withdrawnHash" | "bankHash">): string {
  return [test.seed, test.profile, test.source, test.generatorVersion, test.withdrawnHash, test.bankHash ?? ""].join("|");
}

function remember(key: string, puzzles: PuzzleSet): void {
  BUILT_TESTS.delete(key);
  BUILT_TESTS.set(key, puzzles);
  while (BUILT_TESTS.size > BUILT_TESTS_LIMIT) {
    BUILT_TESTS.delete(BUILT_TESTS.keys().next().value as string);
  }
}

/**
 * Make a fresh link test. Generation runs first, here, so a seed that cannot
 * build is never handed out; if it fails, the test comes from the reference
 * bank, as `POST /api/generate` does.
 */
export function createLinkTest(
  profile: ExpandedProfile,
  context: LinkTestContext & { seed?: string; assemble?: typeof assembleExpandedQuiz } = {},
): { token: string; test: LinkTest; puzzles: PuzzleSet } {
  const secret = resolveSecret(context.secret);
  const seed = context.seed ?? randomBytes(16).toString("base64url");
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  const bank = () => context.bank ?? loadBank();
  const assemble = context.assemble ?? assembleExpandedQuiz;

  let source: LinkTestSource = "generated";
  let puzzles: PuzzleSet;
  try {
    puzzles = assemble(seed, profile, CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn);
  } catch (error) {
    console.error(`link-test: ${profile} assembly failed —`, error);
    source = "fallback";
    puzzles = buildPuzzles(seed, profile, source, withdrawn, bank);
  }

  // The clock is read after the questions exist: building them never comes
  // out of the taker's time.
  const issuedAt = context.nowSeconds ?? Math.floor(Date.now() / 1000);
  const test: LinkTest = {
    appVersion: `v${packageJson.version}`,
    leaderboardAllowed: leaderboardEnabled(),
    leaderboardScope: leaderboardNamespace(),
    seed,
    profile,
    source,
    generatorVersion: EXPANDED_GENERATOR_VERSION,
    withdrawnHash: withdrawnFamilyHash(withdrawn),
    ...(source === "fallback" ? { bankHash: bankHash(bank()) } : {}),
    issuedAt,
    answerDeadline: issuedAt + SECONDS_PER_QUESTION * puzzles.length,
    expiresAt: issuedAt + QUIZ_TOKEN_TTL_SECONDS,
  };
  remember(buildKey(test), puzzles);
  return { token: sealLinkToken(test, secret), test, puzzles };
}

/** Open a link token and rebuild its test, exactly as it was first built. */
export function loadLinkTest(
  token: string,
  context: LinkTestContext = {},
): { test: LinkTest; puzzles: PuzzleSet } {
  const test = openLinkToken(token, context);
  const key = buildKey(test);
  const cached = BUILT_TESTS.get(key);
  if (cached) {
    remember(key, cached);
    return { test, puzzles: cached };
  }
  const withdrawn = context.withdrawnFamilyIds ?? readWithdrawnFamilyIds();
  const puzzles = buildPuzzles(test.seed, test.profile, test.source, withdrawn, () => context.bank ?? loadBank());
  remember(key, puzzles);
  return { test, puzzles };
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

/** Where a new test of this length starts. */
export function startPath(profile: ExpandedProfile | undefined): string {
  return profile === "long-30" ? "/test" : "/sample";
}
