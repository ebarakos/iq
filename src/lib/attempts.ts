import { z } from "zod";
import { GenerationMetadataSchema } from "@/items/schema";

/**
 * Agent attempt artifacts — one JSON file per solver run in `data/attempts/`.
 *
 * File-based by design (no DB yet): the artifacts ARE the calibration corpus
 * and are committed. The shape mirrors a future DB `attempts` table 1:1
 * (plus a `subject: human|agent` column when human persistence arrives), so
 * calibrate.ts gains a data source later, not a rewrite.
 */

export const ChannelSchema = z.enum(["image", "symbolic"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const AttemptOutcomeSchema = z.enum([
  "correct",
  "wrong",
  "unparseable",
  "timeout",
  "rate-limit",
  "transport-failure",
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

export const ATTEMPT_OUTCOMES: readonly AttemptOutcome[] = AttemptOutcomeSchema.options;

export const AttemptSchema = z.object({
  itemId: z.string().min(1),
  /** Canonical option index the model chose; null = reply was unparseable (counted incorrect). */
  chosen: z.number().int().min(0).nullable(),
  correct: z.boolean(),
  /** Exact reasoning/parser/harness result. Absent only on legacy artifacts. */
  outcome: AttemptOutcomeSchema.optional(),
  latencyMs: z.number().min(0),
  /** Generator bucket/provenance when the source item carries it. */
  generation: GenerationMetadataSchema.optional(),
  /** Maximum model answer attempts allowed for this item. */
  attemptBudget: z.number().int().positive().optional(),
  /** Actual provider/model cost when supplied by a trustworthy source. */
  costUsd: z.number().finite().nonnegative().optional(),
  /**
   * Truncated raw model reply, for debugging odd answers.
   *
   * Raised from 200 to 2000 characters on 2026-08-23. At 200 an unparseable
   * reply could not be checked after the fact — the stored text was the model
   * clearing its throat, and whether it reached the right answer further down
   * was unknowable. 2000 holds a normal reasoning reply whole without turning
   * the corpus into a transcript archive.
   */
  raw: z.string().max(2000).optional(),
  ts: z.string(), // ISO 8601
}).superRefine((attempt, ctx) => {
  if (attempt.outcome === undefined) return;
  const expected = attempt.correct ? "correct" : attempt.chosen === null ? undefined : "wrong";
  if (attempt.outcome === "correct" && (!attempt.correct || attempt.chosen === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "correct outcome needs a chosen correct answer" });
  } else if (attempt.outcome === "wrong" && (attempt.correct || attempt.chosen === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "wrong outcome needs a chosen incorrect answer" });
  } else if (
    attempt.outcome !== "correct" && attempt.outcome !== "wrong" &&
    (attempt.correct || attempt.chosen !== null)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "parser and harness failures cannot have a chosen answer" });
  } else if (expected === "correct" && attempt.outcome !== "correct") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "correct attempts must use the correct outcome" });
  }
});
export type Attempt = z.infer<typeof AttemptSchema>;

/** Derive the outcome for legacy records that predate the explicit field. */
export function outcomeOf(attempt: Attempt): AttemptOutcome {
  if (attempt.outcome) return attempt.outcome;
  if (attempt.correct) return "correct";
  return attempt.chosen === null ? "unparseable" : "wrong";
}

export const AttemptSourceSchema = z.enum(["generated", "bank"]);
export type AttemptSource = z.infer<typeof AttemptSourceSchema>;

/**
 * `failed` = every attempt was recorded but none reached the model (all
 * transport, timeout, or rate-limit outcomes). Such a run is not evidence of
 * anything about the items, and must never enter a capability claim: reported
 * naively it looks like 0% accuracy on every family.
 */
export const AttemptRunStatusSchema = z.enum(["complete", "partial", "failed"]);
export type AttemptRunStatus = z.infer<typeof AttemptRunStatusSchema>;

export const AttemptFileSchema = z.object({
  runId: z.string().min(1), // <ISO-ts>-<model-slug>-<channel>
  startedAt: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  channel: ChannelSchema,
  /** Solver prompt version — reports group by this so prompt drift never pollutes comparisons. */
  promptVersion: z.string().min(1),
  /** Run metadata is optional only so committed legacy artifacts remain readable. */
  source: AttemptSourceSchema.optional(),
  profile: z.string().min(1).nullable().optional(),
  runSeed: z.string().min(1).optional(),
  generatorVersion: z.string().min(1).optional(),
  /**
   * Normalized withdrawal list the generated items were assembled under.
   * Together with source, profile, runSeed, and generatorVersion this is what
   * makes a generated run replayable: the withdrawal list is an assembler
   * input, so a run recorded without it cannot be reproduced after an operator
   * withdraws a family.
   */
  withdrawnFamilyIds: z.array(z.string()).optional(),
  plannedAttempts: z.number().int().nonnegative().optional(),
  completedAttempts: z.number().int().nonnegative().optional(),
  status: AttemptRunStatusSchema.optional(),
  attempts: z.array(AttemptSchema),
}).superRefine((file, ctx) => {
  if (file.completedAttempts !== undefined && file.completedAttempts !== file.attempts.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completedAttempts"],
      message: "must equal attempts.length",
    });
  }
  if (
    file.status === "complete" &&
    file.plannedAttempts !== undefined &&
    file.completedAttempts !== file.plannedAttempts
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "complete runs must finish every planned attempt",
    });
  }
  if (
    file.status === "partial" &&
    file.plannedAttempts !== undefined &&
    file.completedAttempts !== undefined &&
    file.completedAttempts >= file.plannedAttempts
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "partial runs must have fewer completed than planned attempts",
    });
  }
});
export type AttemptFile = z.infer<typeof AttemptFileSchema>;

/** Run-level version, with a deterministic label for legacy artifacts. */
/** Outcomes where the model actually answered — the only ones that carry signal. */
const MODEL_ANSWER_OUTCOMES: ReadonlySet<AttemptOutcome> = new Set<AttemptOutcome>([
  "correct",
  "wrong",
  "unparseable",
]);

/**
 * Did any attempt in this run reach the model?
 *
 * Derived from the attempts themselves rather than the stored status, so a run
 * recorded as `complete` before the `failed` status existed is still excluded.
 */
export function hasModelEvidence(file: AttemptFile): boolean {
  return file.attempts.some((attempt) =>
    attempt.outcome === undefined || MODEL_ANSWER_OUTCOMES.has(attempt.outcome));
}

export function generatorVersionOf(file: AttemptFile): string {
  if (file.generatorVersion) return file.generatorVersion;
  const versions = [...new Set(file.attempts.flatMap((attempt) =>
    attempt.generation?.generatorVersion ? [attempt.generation.generatorVersion] : []))].sort();
  if (versions.length === 1) return versions[0];
  if (versions.length > 1) return `legacy-mixed:${versions.join("+")}`;
  return file.source === "generated" ? "legacy-generated" : "legacy-bank";
}
