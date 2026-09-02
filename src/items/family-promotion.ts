/**
 * Human-solvability promotion for the expanded quiz profile.
 *
 * This module deliberately has no generator or storage dependencies. A future
 * persistence layer can load aggregate pilot results and pass them through the
 * same pure transition and selection functions.
 */

export const EXPANDED_PROFILE_BANDS = [
  "warmup",
  "composition",
  "constraint-spatial",
  "induction-transfer",
] as const;

export type ExpandedProfileBand = (typeof EXPANDED_PROFILE_BANDS)[number];

export const PROMOTION_STATES = ["prototype", "code-valid", "pilot", "enabled"] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

/**
 * Median solve time a family/band pair may take and still be kept.
 *
 * These fit inside the flat 60-second-per-question budget: no band exceeds 60
 * seconds on its own, and weighted by the 30-question schedule (5 / 10 / 10 / 5)
 * they come to 1300 of the 1800 available seconds, leaving headroom for the
 * slower half of takers. Changing a number here means re-checking both rules —
 * see the human-solvability gate in docs/plans/deterministic-novel-tests.md.
 */
export const BAND_TIME_BUDGET_SECONDS: Readonly<Record<ExpandedProfileBand, number>> = {
  warmup: 25,
  composition: 40,
  "constraint-spatial": 50,
  "induction-transfer": 55,
};

export const PILOT_THRESHOLDS = {
  minimumRepresentativeItems: 3,
  minimumAttemptsPerItem: 8,
  minimumIntendedRelationshipRate: 0.75,
  maximumNotationMisunderstandingRate: 0.2,
} as const;

/** Aggregate only: no participant answers, explanations, or other raw data. */
export interface PilotAggregate {
  /** Stable generator difficulty buckets represented by this band pilot. */
  difficultyBuckets: readonly string[];
  representativeItemCount: number;
  attempts: number;
  minimumAttemptsPerItem: number;
  correctAttempts: number;
  intendedRelationshipDescriptions: number;
  notationMisunderstandingReports: number;
  medianSolveTimeSeconds: number;
  allItemsPassCorrectnessContract: boolean;
  hasRepeatedDefensibleAlternativeAnswer: boolean;
  spatialLayoutChangesAcrossViewports: boolean;
  desktopAttempts: number;
  mobileAttempts: number;
}

export interface FamilyBandPromotion {
  band: ExpandedProfileBand;
  state: PromotionState;
  /** Buckets that passed the shared code-correctness contract for this band. */
  validatedDifficultyBuckets: readonly string[];
  perItemTimeBudgetSeconds: number;
  fallbackAvailable: boolean;
  pilotMetrics?: PilotAggregate;
}

export interface FamilyPromotionEntry {
  /** The version suffix is part of the family identity and promotion record. */
  familyId: string;
  primaryReasoningFamily: string;
  bands: readonly FamilyBandPromotion[];
}

export type FamilyPromotionRegistry = readonly FamilyPromotionEntry[];

export interface GateDecision {
  eligible: boolean;
  reasons: readonly string[];
}

export interface PromotionResult {
  registry: FamilyPromotionRegistry;
  promoted: boolean;
  reasons: readonly string[];
}

export interface EnabledFamilyBand {
  familyId: string;
  primaryReasoningFamily: string;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  fallbackAvailable: boolean;
}

function candidateBand(
  band: ExpandedProfileBand,
  validatedDifficultyBuckets: readonly string[] = [],
): FamilyBandPromotion {
  return {
    band,
    state: "prototype",
    validatedDifficultyBuckets,
    perItemTimeBudgetSeconds: BAND_TIME_BUDGET_SECONDS[band],
    fallbackAvailable: false,
  };
}

function codeValidBand(
  band: ExpandedProfileBand,
  validatedDifficultyBuckets: readonly string[],
): FamilyBandPromotion {
  return {
    band,
    state: "code-valid",
    validatedDifficultyBuckets,
    perItemTimeBudgetSeconds: BAND_TIME_BUDGET_SECONDS[band],
    fallbackAvailable: false,
  };
}

/**
 * Current generators are candidates only. No human pilot results exist, so no
 * family/band pair is enabled for the expanded profile. The old visual operator
 * has no eligible band because its hidden numeric encoding is being replaced.
 */
export const CURRENT_FAMILY_PROMOTION_REGISTRY: FamilyPromotionRegistry = [
  {
    familyId: "sequence-transform-v1",
    primaryReasoningFamily: "sequential-relation",
    bands: [candidateBand("warmup")],
  },
  {
    familyId: "odd-one-out-v1",
    primaryReasoningFamily: "classification-relation",
    bands: [candidateBand("warmup")],
  },
  {
    familyId: "analogy-transform-v1",
    primaryReasoningFamily: "analogical-transformation",
    bands: [candidateBand("composition")],
  },
  {
    familyId: "matrix-axis-transform-v1",
    primaryReasoningFamily: "matrix-reasoning",
    bands: [candidateBand("composition")],
  },
  {
    // New on 2026-08-27, and deliberately a PROTOTYPE rather than code-valid:
    // code-valid is served immediately, and no person has looked at this family
    // yet. It now meets the single-inference bar the rest of the battery was
    // held to the same day — 0 of 40 d4 items decided by one aspect, 4 of 40 at
    // d5, pinned by a test — so what is left before promotion is a human
    // reading one, not more generator work. Note that nothing currently SHOWS a
    // prototype family to a person: the pilot packet is built from enabled keys
    // and skips this state (`enabledPrototypePilotKeys`), so promoting it needs
    // a surface first. TODO.md carries that.
    familyId: "combining-machine-v1",
    primaryReasoningFamily: "operator-induction",
    bands: [candidateBand("constraint-spatial")],
  },
  {
    familyId: "relational-sequence-v2",
    primaryReasoningFamily: "sequential-relation",
    bands: [codeValidBand("warmup", ["relational-sequence-d2"])],
  },
  {
    familyId: "attribute-pairing-v1",
    primaryReasoningFamily: "analogical-relation",
    bands: [codeValidBand("warmup", ["attribute-pairing-d2"])],
  },
  {
    // Two buckets in the composition band since 2026-08-25 (escalate-the-quiz,
    // Phase 3). d3 shows a board move plus a fill cycle; d4 adds a third
    // demonstrated change, a token turn, so a band's second question from this
    // family asks for one more step than its first.
    familyId: "compositional-analogy-v2",
    primaryReasoningFamily: "analogical-transformation",
    bands: [codeValidBand("composition", ["compositional-analogy-d3", "compositional-analogy-d4"])],
  },
  {
    // d4 demonstrates and applies two gates. d5 demonstrates and applies all
    // three, with the query order varied so its extra depth is meaningful.
    familyId: "composed-transform-v2",
    primaryReasoningFamily: "ordered-composition",
    bands: [
      codeValidBand("composition", ["composed-transform-d4"]),
      codeValidBand("induction-transfer", ["composed-transform-d5"]),
    ],
  },
  {
    familyId: "relational-matrix-v2",
    primaryReasoningFamily: "matrix-reasoning",
    bands: [codeValidBand("constraint-spatial", ["relational-matrix-d4"])],
  },
  {
    // Two buckets in one band since 2026-08-25 (escalate-the-quiz, Phase 3).
    // d4 combines the two boards and moves the result; d5 then turns every
    // orientable token on it, so the rule is three visible steps.
    familyId: "visual-set-algebra-v2",
    primaryReasoningFamily: "set-combination",
    bands: [codeValidBand("constraint-spatial", ["visual-set-algebra-d4", "visual-set-algebra-d5"])],
  },
  {
    // A single demonstrated spatial operation is an easy opening mechanism.
    familyId: "spatial-transform-v2",
    primaryReasoningFamily: "spatial-transformation",
    bands: [codeValidBand("warmup", ["spatial-transform-d2"])],
  },
  {
    // Two buckets in one band since 2026-08-26 (raise-the-ceiling-v12). d5
    // demonstrates three gates and applies them along the query path; d6
    // demonstrates a fourth, a swap of two named slots, and applies that too.
    // `transformation-machine-d6` was withdrawn on 2026-08-27 under the same
    // three-gate rule that withdrew `composed-transform-d6`. The four-gate
    // generator and its ablation proof stay in the code for a later rework;
    // no band may draw the bucket.
    familyId: "transformation-machine-v3",
    primaryReasoningFamily: "operator-induction",
    bands: [codeValidBand("induction-transfer", ["transformation-machine-d5"])],
  },
  {
    // One selected operation is an opening-level mechanism, even though reading
    // which of two worked gates the query names still requires attention.
    familyId: "rule-switching-v2",
    primaryReasoningFamily: "operator-induction",
    bands: [codeValidBand("warmup", ["rule-switching-d2"])],
  },
  {
    familyId: "second-order-sequence-v2",
    primaryReasoningFamily: "sequential-relation",
    bands: [codeValidBand("composition", ["second-order-sequence-d4"])],
  },
  {
    familyId: "inverse-analogy-v2",
    primaryReasoningFamily: "analogical-transformation",
    bands: [codeValidBand("composition", ["inverse-analogy-d4"])],
  },
  {
    // Added 2026-08-25 (escalate-the-quiz, Phase 4). Three tokens on one board,
    // each following its own perimeter-step and fill-cycle rule, all three
    // strands fully visible in all five shown boards. d3 gives every token a
    // rule that changes exactly one aspect; d4 draws the whole grammar and
    // always includes at least one token that changes both, so a band's second
    // question from this family really is deeper than its first. It is the
    // sixth composition family, which is what the plan's dual-proof-fails
    // branch needs to keep that band's pool at six.
    familyId: "parallel-evolution-v1",
    primaryReasoningFamily: "sequential-relation",
    bands: [codeValidBand("composition", ["parallel-evolution-d3", "parallel-evolution-d4"])],
  },
];

/**
 * Families pulled out of every public test, named in `WITHDRAWN_FAMILY_IDS`.
 *
 * This is the only safety net now that code-valid families are served before
 * their human pilot: a family that confuses people is removed by editing one
 * environment variable, with no deploy and no code change. The value is a list
 * of family ids separated by commas or whitespace.
 */
export function readWithdrawnFamilyIds(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  return new Set(
    (env.WITHDRAWN_FAMILY_IDS ?? "")
      .split(/[,\s]+/)
      .map((familyId) => familyId.trim())
      .filter((familyId) => familyId.length > 0),
  );
}

/**
 * The canonical, order-independent form of a withdrawal list.
 *
 * Anything that replays generated content later must store this alongside the
 * seed. The withdrawal list is an input to `assembleExpandedQuiz`, so a record
 * that keeps seed, profile, and generator version but not this cannot be
 * replayed once an operator withdraws a family.
 */
export function normalizeWithdrawnFamilyIds(
  withdrawnFamilyIds: Iterable<string>,
): string[] {
  return [...new Set(withdrawnFamilyIds)].sort();
}

/** Withdrawn ids that no family in the registry answers to — almost always a typo. */
export function unknownWithdrawnFamilyIds(
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string>,
): string[] {
  const known = new Set(registry.map((family) => family.familyId));
  return [...withdrawnFamilyIds].filter((familyId) => !known.has(familyId)).sort();
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** Apply every documented per-band pilot threshold to aggregate metrics. */
export function evaluatePilotAggregate(
  promotion: FamilyBandPromotion,
  metrics: PilotAggregate | undefined = promotion.pilotMetrics,
): GateDecision {
  const reasons: string[] = [];

  if (!metrics) {
    return { eligible: false, reasons: ["pilot metrics are missing"] };
  }

  const countFields: Array<[string, number]> = [
    ["representative item count", metrics.representativeItemCount],
    ["attempt count", metrics.attempts],
    ["minimum attempts per item", metrics.minimumAttemptsPerItem],
    ["correct attempt count", metrics.correctAttempts],
    ["intended-relationship description count", metrics.intendedRelationshipDescriptions],
    ["notation-misunderstanding report count", metrics.notationMisunderstandingReports],
    ["desktop attempt count", metrics.desktopAttempts],
    ["mobile attempt count", metrics.mobileAttempts],
  ];
  for (const [label, value] of countFields) {
    if (!isNonNegativeInteger(value)) reasons.push(`${label} must be a non-negative integer`);
  }
  if (!Number.isFinite(metrics.medianSolveTimeSeconds) || metrics.medianSolveTimeSeconds < 0) {
    reasons.push("median solve time must be a non-negative finite number");
  }

  if (metrics.correctAttempts > metrics.attempts) {
    reasons.push("correct attempts cannot exceed total attempts");
  }
  if (metrics.intendedRelationshipDescriptions > metrics.attempts) {
    reasons.push("intended-relationship descriptions cannot exceed total attempts");
  }
  if (metrics.notationMisunderstandingReports > metrics.attempts) {
    reasons.push("notation-misunderstanding reports cannot exceed total attempts");
  }
  if (metrics.desktopAttempts + metrics.mobileAttempts !== metrics.attempts) {
    reasons.push("desktop and mobile attempt counts must add up to total attempts");
  }
  if (promotion.validatedDifficultyBuckets.length === 0) {
    reasons.push("at least one validated difficulty bucket is required");
  }
  if (!sameStringSet(metrics.difficultyBuckets, promotion.validatedDifficultyBuckets)) {
    reasons.push("pilot difficulty buckets must match the validated difficulty buckets");
  }
  if (metrics.representativeItemCount < PILOT_THRESHOLDS.minimumRepresentativeItems) {
    reasons.push(`pilot needs at least ${PILOT_THRESHOLDS.minimumRepresentativeItems} representative items`);
  }
  if (metrics.minimumAttemptsPerItem < PILOT_THRESHOLDS.minimumAttemptsPerItem) {
    reasons.push(`every pilot item needs at least ${PILOT_THRESHOLDS.minimumAttemptsPerItem} attempts`);
  }
  if (metrics.attempts < metrics.representativeItemCount * metrics.minimumAttemptsPerItem) {
    reasons.push("total attempts are inconsistent with the per-item minimum");
  }
  if (!metrics.allItemsPassCorrectnessContract) {
    reasons.push("every pilot item must pass the shared correctness contract");
  }
  if (
    rate(metrics.intendedRelationshipDescriptions, metrics.attempts) <
    PILOT_THRESHOLDS.minimumIntendedRelationshipRate
  ) {
    reasons.push("fewer than 75% of attempts described the intended relationship");
  }
  if (
    rate(metrics.notationMisunderstandingReports, metrics.attempts) >
    PILOT_THRESHOLDS.maximumNotationMisunderstandingRate
  ) {
    reasons.push("more than 20% of attempts reported a notation or visual misunderstanding");
  }
  if (metrics.hasRepeatedDefensibleAlternativeAnswer) {
    reasons.push("a repeated alternative interpretation produced a defensible answer");
  }
  const documentedTimeBudget = BAND_TIME_BUDGET_SECONDS[promotion.band];
  if (promotion.perItemTimeBudgetSeconds !== documentedTimeBudget) {
    reasons.push(`per-item time budget must be ${documentedTimeBudget} seconds for ${promotion.band}`);
  }
  if (metrics.medianSolveTimeSeconds > documentedTimeBudget) {
    reasons.push(`median solve time exceeds the ${documentedTimeBudget}-second band budget`);
  }
  if (
    metrics.spatialLayoutChangesAcrossViewports &&
    (metrics.desktopAttempts === 0 || metrics.mobileAttempts === 0)
  ) {
    reasons.push("a responsive spatial layout needs both desktop and mobile pilot attempts");
  }

  return { eligible: reasons.length === 0, reasons };
}

function findFamilyBand(
  registry: FamilyPromotionRegistry,
  familyId: string,
  band: ExpandedProfileBand,
): { family: FamilyPromotionEntry; promotion: FamilyBandPromotion } | undefined {
  const family = registry.find((entry) => entry.familyId === familyId);
  const promotion = family?.bands.find((entry) => entry.band === band);
  return family && promotion ? { family, promotion } : undefined;
}

function replaceFamilyBand(
  registry: FamilyPromotionRegistry,
  familyId: string,
  band: ExpandedProfileBand,
  replacement: FamilyBandPromotion,
): FamilyPromotionRegistry {
  return registry.map((family) =>
    family.familyId !== familyId
      ? family
      : {
          ...family,
          bands: family.bands.map((entry) => (entry.band === band ? replacement : entry)),
        },
  );
}

/** Record or replace aggregate metrics without mutating the registry. */
export function recordPilotAggregate(
  registry: FamilyPromotionRegistry,
  familyId: string,
  band: ExpandedProfileBand,
  metrics: PilotAggregate,
): FamilyPromotionRegistry {
  const found = findFamilyBand(registry, familyId, band);
  if (!found) return registry;
  if (found.promotion.state !== "pilot") return registry;
  return replaceFamilyBand(registry, familyId, band, { ...found.promotion, pilotMetrics: metrics });
}

function curveDecision(
  registry: FamilyPromotionRegistry,
  familyId: string,
  targetBand: ExpandedProfileBand,
): GateDecision {
  const family = registry.find((entry) => entry.familyId === familyId);
  if (!family) return { eligible: false, reasons: ["family is not registered"] };

  const promotedPairs = family.bands.filter(
    (entry) => entry.state === "enabled" || entry.band === targetBand,
  );
  const warmup = promotedPairs.find((entry) => entry.band === "warmup");
  const later = promotedPairs.filter((entry) => entry.band !== "warmup");
  if (!warmup || later.length === 0) return { eligible: true, reasons: [] };
  if (!warmup.pilotMetrics || later.some((entry) => !entry.pilotMetrics)) {
    return { eligible: false, reasons: ["difficulty-curve comparison needs pilot metrics for both bands"] };
  }

  const warmupAccuracy = rate(warmup.pilotMetrics.correctAttempts, warmup.pilotMetrics.attempts);
  const reasons: string[] = [];
  for (const laterBand of later) {
    const laterMetrics = laterBand.pilotMetrics as PilotAggregate;
    const laterAccuracy = rate(laterMetrics.correctAttempts, laterMetrics.attempts);
    if (warmupAccuracy <= laterAccuracy) {
      reasons.push(`warmup must have a higher solve rate than ${laterBand.band}`);
    }
    if (warmup.pilotMetrics.medianSolveTimeSeconds >= laterMetrics.medianSolveTimeSeconds) {
      reasons.push(`warmup must have a lower median solve time than ${laterBand.band}`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Advance exactly one state. The pilot-to-enabled step enforces every gate. */
export function promoteFamilyBand(
  registry: FamilyPromotionRegistry,
  familyId: string,
  band: ExpandedProfileBand,
): PromotionResult {
  const found = findFamilyBand(registry, familyId, band);
  if (!found) return { registry, promoted: false, reasons: ["family/band pair is not registered"] };

  const currentIndex = PROMOTION_STATES.indexOf(found.promotion.state);
  if (currentIndex === PROMOTION_STATES.length - 1) {
    return { registry, promoted: false, reasons: ["family/band pair is already enabled"] };
  }

  const nextState = PROMOTION_STATES[currentIndex + 1];
  if (nextState === "enabled") {
    const pilotDecision = evaluatePilotAggregate(found.promotion);
    const curve = curveDecision(registry, familyId, band);
    const reasons = [...pilotDecision.reasons, ...curve.reasons];
    if (reasons.length > 0) return { registry, promoted: false, reasons };
  }

  const updated = replaceFamilyBand(registry, familyId, band, {
    ...found.promotion,
    state: nextState,
  });
  return { registry: updated, promoted: true, reasons: [] };
}

/**
 * The only selection path for expanded-profile assembly. An `enabled` label is
 * insufficient by itself: metrics are rechecked so stale or hand-edited data
 * cannot make an invalid pair selectable.
 */
export function selectEnabledFamilyBands(
  registry: FamilyPromotionRegistry,
  band: ExpandedProfileBand,
  difficultyBucket: string,
): EnabledFamilyBand[] {
  const selections: EnabledFamilyBand[] = [];
  for (const family of registry) {
    const promotion = family.bands.find((entry) => entry.band === band);
    if (
      !promotion ||
      promotion.state !== "enabled" ||
      !promotion.validatedDifficultyBuckets.includes(difficultyBucket) ||
      !evaluatePilotAggregate(promotion).eligible ||
      !curveDecision(registry, family.familyId, band).eligible
    ) {
      continue;
    }
    selections.push({
      familyId: family.familyId,
      primaryReasoningFamily: family.primaryReasoningFamily,
      band,
      difficultyBucket,
      fallbackAvailable: promotion.fallbackAvailable,
    });
  }
  return selections;
}
