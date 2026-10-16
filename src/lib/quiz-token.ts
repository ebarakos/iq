import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PuzzleSet } from "@/items/schema";
import { GenerationMetadataSchema, REASONING_BANDS } from "@/items/schema";

/**
 * Token sealing shared by the test token (`src/lib/link-test.ts`), and the
 * answer key a test is scored against. Until 2026-10-14 the in-page test
 * carried that key inside its own encrypted token; both flows now rebuild it
 * from the seed token on the server (docs/plans/leaderboard-integrity.md).
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** How long a test token opens at all: two hours, well past any test's deadline. */
export const QUIZ_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

/** The flat time budget: one countdown of 60 seconds per question. */
export const SECONDS_PER_QUESTION = 60;

/**
 * How late a submission may be and still count as ordinary.
 *
 * This absorbs small delays in the diagnostic late marker. Answer recording
 * still closes at answerDeadline; this window never accepts later answers.
 */
export const GRACE_WINDOW_SECONDS = 10;

const TokenItemSchema = z.object({
  id: z.string().min(1),
  answerIndex: z.number().int().min(0),
  optionCount: z.number().int().min(1),
  explanation: z.string().min(3).max(800),
  familyId: z.string().min(1).optional(),
  band: z.enum(REASONING_BANDS).optional(),
  /** Kept server-side for future human calibration by generator bucket. */
  generation: GenerationMetadataSchema.optional(),
}).refine((item) => item.answerIndex < item.optionCount, {
  message: "answerIndex out of range",
  path: ["answerIndex"],
});

/** Lengths an answer key may hold: 5 and 30, the two current public test lengths. */
export const ACCEPTED_ITEM_COUNTS = [5, 30] as const;

/** The answer key and times one test is scored against, rebuilt on the server for each submission. */
export const QuizTokenPayloadSchema = z.object({
  version: z.literal(1),
  /** Sealed at issue time; older tokens cannot acquire a newer version or ranking eligibility. */
  appVersion: z.string().min(1).max(80).optional(),
  leaderboardAllowed: z.boolean().optional(),
  /** Deployment scope for opening and scoring, independent of the selected leaderboard. */
  leaderboardScope: z.string().optional(),
  issuedAt: z.number().int().nonnegative(),
  /** When the answer key stops opening at all. Never the same thing as the deadline. */
  expiresAt: z.number().int().positive(),
  /** When the test is over. */
  answerDeadline: z.number().int().positive(),
  items: z.array(TokenItemSchema).refine(
    (items) => (ACCEPTED_ITEM_COUNTS as readonly number[]).includes(items.length),
    { message: "quiz token must contain 5 or 30 items" },
  ),
}).refine((payload) => payload.expiresAt > payload.issuedAt, {
  message: "expiresAt must be after issuedAt",
  path: ["expiresAt"],
}).refine((payload) =>
  payload.answerDeadline > payload.issuedAt && payload.answerDeadline <= payload.expiresAt, {
  message: "answerDeadline must fall between issuedAt and expiresAt",
  path: ["answerDeadline"],
});
export type QuizTokenPayload = z.infer<typeof QuizTokenPayloadSchema>;

/** How a submission stands against the deadline the server issued. */
export interface SubmissionTiming {
  late: boolean;
  secondsLate: number;
}

/**
 * Judge a submission's timing on the server clock.
 *
 * Inside the grace window a submission is ordinary. Past it, it is still scored
 * — throwing away a finished test over a slow network would be worse — but it
 * carries a marker, and a marked result never enters calibration data.
 */
export function submissionTiming(
  payload: Pick<QuizTokenPayload, "answerDeadline">,
  nowSeconds = Math.floor(Date.now() / 1000),
): SubmissionTiming {
  const past = nowSeconds - payload.answerDeadline;
  if (past <= GRACE_WINDOW_SECONDS) return { late: false, secondsLate: 0 };
  return { late: true, secondsLate: past };
}

export class QuizTokenError extends Error {
  constructor(
    public readonly code: "invalid" | "expired" | "configuration",
    message: string,
  ) {
    super(message);
    this.name = "QuizTokenError";
  }
}

let warnedAboutDevelopmentSecret = false;
const FALLBACK_DEVELOPMENT_SECRET =
  "aiq-development-quiz-token-secret-do-not-use-in-production";

/**
 * Resolve the server-only token secret.
 *
 * Production fails closed if QUIZ_TOKEN_SECRET is absent or weak.
 * Development uses a stable fallback key so restarting the test does not
 * invalidate local tokens.
 */
export function resolveQuizTokenSecret(
  env: { QUIZ_TOKEN_SECRET?: string; NODE_ENV?: string } = process.env,
): string {
  const configured = env.QUIZ_TOKEN_SECRET;
  if (configured) {
    if (configured.length < MIN_SECRET_LENGTH) {
      throw new QuizTokenError(
        "configuration",
        `QUIZ_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    return configured;
  }

  if (env.NODE_ENV === "production") {
    throw new QuizTokenError("configuration", "QUIZ_TOKEN_SECRET is required in production");
  }

  if (!warnedAboutDevelopmentSecret) {
    console.warn(
      "QUIZ_TOKEN_SECRET is not set; using a stable development fallback key. " +
        "Set QUIZ_TOKEN_SECRET in .env for production-like behavior.",
    );
    warnedAboutDevelopmentSecret = true;
  }
  return FALLBACK_DEVELOPMENT_SECRET;
}

function encryptionKey(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new QuizTokenError(
      "configuration",
      `quiz token secret must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const decoded = Buffer.from(value, "base64url");
  // Reject alternate spellings that decode to the same bytes through unused
  // base64 bits. Tokens have one canonical representation.
  if (encode(decoded) !== value) throw new Error("non-canonical base64url");
  return decoded;
}

/**
 * Encrypt and authenticate any JSON value as `<version>.<iv>.<ciphertext>.<tag>`.
 *
 * The version names the envelope and the AAD binds the ciphertext to one kind
 * of token, so a token of one kind never opens as another. Used by the test
 * token (`src/lib/link-test.ts`).
 */
export function sealTokenJson(
  value: unknown,
  envelope: { version: string; aad: string },
  secret = resolveQuizTokenSecret(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(envelope.aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [envelope.version, encode(iv), encode(ciphertext), encode(tag)].join(".");
}

/**
 * Authenticate and decrypt a token sealed by `sealTokenJson`. Throws a plain
 * error for any malformed or tampered token; the caller validates the value.
 */
export function openTokenJson(
  token: string,
  envelope: { version: string; aad: string },
  secret = resolveQuizTokenSecret(),
): unknown {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== envelope.version) {
    throw new Error("invalid token envelope");
  }
  const iv = decode(parts[1]);
  const ciphertext = decode(parts[2]);
  const tag = decode(parts[3]);
  if (iv.length !== IV_BYTES || ciphertext.length === 0 || tag.length !== TAG_BYTES) {
    throw new Error("invalid token envelope");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
  decipher.setAAD(Buffer.from(envelope.aad, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

/** What scoring keeps about each question: the answer, its review, and where it came from. */
export function answerKeyItems(puzzles: PuzzleSet): QuizTokenPayload["items"] {
  return puzzles.map((puzzle) => ({
    id: puzzle.id,
    answerIndex: puzzle.answerIndex,
    optionCount: puzzle.options.length,
    explanation: puzzle.explanation,
    familyId: puzzle.familyId,
    band: puzzle.band,
    generation: puzzle.generation,
  }));
}
