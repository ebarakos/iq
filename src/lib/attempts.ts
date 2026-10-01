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

/**
 * `options-only` is the probe arm that shows the model the six options and not
 * the question (docs/plans/blind-answer-leak.md). Chance is 1 in 6; anything
 * above it is a shortcut the options give away. It is its own population: the
 * calibration rollups read only `image` and `symbolic`, so it is never pooled.
 */
export const ChannelSchema = z.enum(["image", "symbolic", "options-only"]);
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

/**
 * Which population an item belongs to.
 *
 *   public   — an item the live assembler could serve to a person.
 *   held-out — a reserved item no public test can ever contain (the reserved
 *              three-step combinations behind
 *              `generateHeldOutComposedTransformCandidate`).
 *
 * The two are never pooled. Public accuracy is what people actually face;
 * held-out accuracy measures whether a model transfers beyond the combinations
 * the public pool practises. Averaging them together would answer neither
 * question.
 */
export const EvaluationSetSchema = z.enum(["public", "held-out"]);
export type EvaluationSet = z.infer<typeof EvaluationSetSchema>;

export const EVALUATION_SETS: readonly EvaluationSet[] = EvaluationSetSchema.options;

export const AttemptSchema = z.object({
  itemId: z.string().min(1),
  /** Canonical option index the model chose; null = reply was unparseable (counted incorrect). */
  chosen: z.number().int().min(0).nullable(),
  correct: z.boolean(),
  /** Exact reasoning/parser/harness result. Absent only on legacy artifacts. */
  outcome: AttemptOutcomeSchema.optional(),
  /**
   * Population this attempt belongs to. Optional so every artifact recorded
   * before the held-out arm existed still parses; read it through
   * `evaluationSetOf`, which supplies the "public" default those runs imply.
   */
  evaluationSet: EvaluationSetSchema.optional(),
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

/**
 * Population for one attempt, with the default every artifact recorded before
 * the held-out arm implies: those runs only ever probed publicly servable
 * items, so an absent label means "public".
 */
export function evaluationSetOf(attempt: Attempt): EvaluationSet {
  return attempt.evaluationSet ?? "public";
}

/** Derive the outcome for legacy records that predate the explicit field. */
export function outcomeOf(attempt: Attempt): AttemptOutcome {
  if (attempt.outcome) return attempt.outcome;
  if (attempt.correct) return "correct";
  return attempt.chosen === null ? "unparseable" : "wrong";
}

/**
 * Where a run's items came from.
 *
 *   generated — the live assembler, i.e. the test people actually take.
 *   bank      — the fixed reference corpus, which makes two runs months apart
 *               comparable.
 *   held-out  — the reserved composed programs no public test can ever contain.
 *               A whole run is one population or the other; the harness has no
 *               way to write a mixed artifact, which is what keeps public and
 *               held-out accuracy from ever being pooled by accident.
 */
export const AttemptSourceSchema = z.enum(["generated", "bank", "held-out"]);
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
  /** The model that answered, as the replies named it (the requested name when they named none). */
  model: z.string().min(1),
  /**
   * The name the run asked for, kept only when the answering model differs:
   * a Codex `default` run is recorded under the model Codex chose, never under
   * "default", whose meaning moves when Codex changes its default.
   */
  requestedModel: z.string().min(1).optional(),
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
  /**
   * Reasoning budget the run was executed under, as `--thinking-budget N`
   * forwarded to the relay's X-Thinking-Budget header.
   *
   * Three states, all meaningful:
   *   a number  — the run asked for that many reasoning tokens;
   *   null      — the run asked for none, the relay default;
   *   absent    — the run predates this field, so its setting is unknown.
   *
   * It is recorded because it changes the answers: the endpoint the strong
   * model runs on refuses reasoning-off outright, and the plan's agent gate
   * says a probe carrying a different budget is not comparable. Reports treat
   * the three states as three separate populations for that reason, and
   * "absent" is never read as "off".
   */
  thinkingBudget: z.number().int().positive().nullable().optional(),
  /**
   * Reasoning effort the run asked the harness providers for, on the same
   * three-state contract as the thinking budget above: a value, an explicit
   * null for "asked for no particular effort", absent for an artifact written
   * before the field existed. Added 2026-08-27 with the `codex` default, whose
   * answers change as much between low and high effort as they would between
   * two different models — so two harness runs at different efforts are two
   * populations, not one.
   */
  effort: z.enum(["low", "medium", "high"]).nullable().optional(),
  /**
   * Attempts requested per item (`--repeat`) and how many ran at once
   * (`--concurrency`). With source, profile, runSeed, channel, provider,
   * model, and the thinking budget, these complete the command that produced
   * the artifact. Concurrency does not change what is asked, but it does
   * change how hard the run leans on the provider's rate limit, which is the
   * first question a run full of rate-limit outcomes raises.
   */
  repeat: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
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

// ---------------------------------------------------------------------------
// Populations
// ---------------------------------------------------------------------------

/**
 * The population one artifact belongs to.
 *
 * The plan's agent gate (docs/plans/escalate-the-quiz.md, section "Agent
 * signal") says public, held-out, bank, prompt, channel, model and generator
 * populations stay separate in reports. Four of those are decided per file and
 * are what a report has to group by before it computes a single number:
 *
 *   promptVersion    — a reworded prompt is a different measurement.
 *   generatorVersion — different items; the bank carries its own version, so
 *                      this separates bank runs from generated ones too.
 *   evaluationSet    — public is the test people sit, held-out is a transfer
 *                      probe over reserved programs. Averaging them answers
 *                      neither question.
 *   thinkingBudget   — a run with reasoning off is not comparable to one at
 *                      1024, and an unrecorded setting is not evidence of
 *                      either.
 *
 * Channel and model are not in the key because no rollup pools them already:
 * image and symbolic have separate tables throughout, and every per-item and
 * per-bucket rollup carries its own per-model breakdown.
 */
export interface AttemptPopulation {
  /** Stable grouping key; also the sort order. Not for display — use `label`. */
  key: string;
  /** Human-readable identity, e.g. "prompt solver-v3 · generator scene-families-v11 · set public · thinking-budget 1024". */
  label: string;
  promptVersion: string;
  generatorVersion: string;
  evaluationSet: EvaluationSet;
  /** Display form of the budget: a number, "off", or "unrecorded". */
  thinkingBudgetLabel: string;
  files: AttemptFile[];
}

/** Budget label for a run that explicitly asked for no reasoning. */
export const THINKING_BUDGET_OFF = "off";
/** Budget label for a run recorded before the field existed. */
export const THINKING_BUDGET_UNRECORDED = "unrecorded";

/**
 * How a report names this run's reasoning setting.
 *
 * "unrecorded" is deliberately not "off": the artifacts written before the
 * field existed cannot show which setting produced them, and quietly calling
 * them "off" would pool them with runs that are known to differ.
 */
export function thinkingBudgetLabelOf(file: AttemptFile): string {
  if (file.thinkingBudget === undefined) return THINKING_BUDGET_UNRECORDED;
  return file.thinkingBudget === null ? THINKING_BUDGET_OFF : String(file.thinkingBudget);
}

/**
 * The one population a whole artifact belongs to.
 *
 * The harness writes a run that is entirely public or entirely held-out, so a
 * file holding both is corrupt rather than merely awkward: nothing downstream
 * could say which of its numbers belonged to which population. This throws
 * instead of picking one, and the caller reports the file by name.
 */
export function evaluationSetOfFile(file: AttemptFile): EvaluationSet {
  const sets = [...new Set(file.attempts.map(evaluationSetOf))].sort();
  if (sets.length > 1) {
    throw new Error(
      `attempt artifact ${file.runId} mixes ${sets.join(" and ")} attempts in one file; ` +
        "public and held-out results answer different questions and are never pooled",
    );
  }
  // No attempts means nothing to separate; "public" is the same default a
  // single unlabelled attempt carries.
  return sets[0] ?? "public";
}

/** Display identity of a population, used in the report banner and in --write errors. */
export function populationLabel(population: {
  promptVersion: string;
  generatorVersion: string;
  evaluationSet: EvaluationSet;
  thinkingBudgetLabel: string;
}): string {
  return `prompt ${population.promptVersion} · generator ${population.generatorVersion}` +
    ` · set ${population.evaluationSet} · thinking-budget ${population.thinkingBudgetLabel}`;
}

/**
 * Split artifacts into the populations that may not be pooled.
 *
 * Every number a report prints has to be computed inside one of these groups.
 * Throws if any single artifact mixes evaluation sets.
 */
export function groupAttemptFilesByPopulation(
  files: readonly AttemptFile[],
): AttemptPopulation[] {
  const byKey = new Map<string, AttemptPopulation>();
  for (const file of files) {
    const promptVersion = file.promptVersion;
    const generatorVersion = generatorVersionOf(file);
    const evaluationSet = evaluationSetOfFile(file);
    const thinkingBudgetLabel = thinkingBudgetLabelOf(file);
    // NUL-joined so no version string containing a display separator can
    // collide with a genuinely different population.
    const key = [promptVersion, generatorVersion, evaluationSet, thinkingBudgetLabel].join("\u0000");
    let population = byKey.get(key);
    if (!population) {
      population = {
        key,
        label: populationLabel({ promptVersion, generatorVersion, evaluationSet, thinkingBudgetLabel }),
        promptVersion,
        generatorVersion,
        evaluationSet,
        thinkingBudgetLabel,
        files: [],
      };
      byKey.set(key, population);
    }
    population.files.push(file);
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}
