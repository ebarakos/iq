import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PuzzleSet, PublicPuzzleSet, Visual } from "@/items/schema";
import { GenerationMetadataSchema, REASONING_BANDS, toPublicPuzzleSet } from "@/items/schema";

const TOKEN_VERSION = "v1";
const TOKEN_AAD = Buffer.from("aiq.quiz-token.v1", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_TTL_SECONDS = 2 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

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

export const QuizTokenPayloadSchema = z.object({
  version: z.literal(1),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  // Five-item v1/v2 replays remain valid while current tests contain twelve.
  items: z.array(TokenItemSchema).refine((items) => items.length === 5 || items.length === 12, {
    message: "quiz token must contain 5 legacy items or 12 current items",
  }),
}).refine((payload) => payload.expiresAt > payload.issuedAt, {
  message: "expiresAt must be after issuedAt",
  path: ["expiresAt"],
});
export type QuizTokenPayload = z.infer<typeof QuizTokenPayloadSchema>;

export type QuizDelivery = {
  puzzles: PublicPuzzleSet<Visual>;
  quizToken: string;
};

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

/** Encrypt and authenticate a token payload. The result reveals no answer data. */
export function sealQuizToken(payload: QuizTokenPayload, secret = resolveQuizTokenSecret()): string {
  const checked = QuizTokenPayloadSchema.parse(payload);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(checked), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [TOKEN_VERSION, encode(iv), encode(ciphertext), encode(tag)].join(".");
}

/** Authenticate, decrypt, validate, and expiry-check an opaque quiz token. */
export function openQuizToken(
  token: string,
  secret = resolveQuizTokenSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
): QuizTokenPayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
      throw new Error("invalid token envelope");
    }
    const iv = decode(parts[1]);
    const ciphertext = decode(parts[2]);
    const tag = decode(parts[3]);
    if (iv.length !== IV_BYTES || ciphertext.length === 0 || tag.length !== TAG_BYTES) {
      throw new Error("invalid token envelope");
    }

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = QuizTokenPayloadSchema.parse(JSON.parse(plaintext.toString("utf8")));
    if (payload.expiresAt <= nowSeconds) {
      throw new QuizTokenError("expired", "quiz token has expired");
    }
    return payload;
  } catch (error) {
    if (error instanceof QuizTokenError) throw error;
    throw new QuizTokenError("invalid", "quiz token is invalid");
  }
}

/** Build the public response and opaque answer key for a generated quiz. */
export function createQuizDelivery(
  puzzles: PuzzleSet<Visual>,
  options: { secret?: string; nowSeconds?: number; ttlSeconds?: number } = {},
): QuizDelivery {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error("ttlSeconds must be a positive integer");
  }
  const payload: QuizTokenPayload = {
    version: 1,
    issuedAt: now,
    expiresAt: now + ttl,
    items: puzzles.map((puzzle) => ({
      id: puzzle.id,
      answerIndex: puzzle.answerIndex,
      optionCount: puzzle.options.length,
      explanation: puzzle.explanation,
      familyId: puzzle.familyId,
      band: puzzle.band,
      generation: puzzle.generation,
    })),
  };
  return {
    puzzles: toPublicPuzzleSet(puzzles),
    quizToken: sealQuizToken(payload, options.secret),
  };
}
