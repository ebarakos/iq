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

export const AttemptSchema = z.object({
  itemId: z.string().min(1),
  /** Canonical option index the model chose; null = reply was unparseable (counted incorrect). */
  chosen: z.number().int().min(0).nullable(),
  correct: z.boolean(),
  latencyMs: z.number().min(0),
  /** Generator bucket/provenance when the source item carries it. */
  generation: GenerationMetadataSchema.optional(),
  /** Maximum model answer attempts allowed for this item. */
  attemptBudget: z.number().int().positive().optional(),
  /** Actual provider/model cost when supplied by a trustworthy source. */
  costUsd: z.number().finite().nonnegative().optional(),
  /** Truncated raw model reply, for debugging odd answers. */
  raw: z.string().max(200).optional(),
  ts: z.string(), // ISO 8601
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const AttemptFileSchema = z.object({
  runId: z.string().min(1), // <ISO-ts>-<model-slug>-<channel>
  startedAt: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  channel: ChannelSchema,
  /** Solver prompt version — reports group by this so prompt drift never pollutes comparisons. */
  promptVersion: z.string().min(1),
  attempts: z.array(AttemptSchema),
});
export type AttemptFile = z.infer<typeof AttemptFileSchema>;
