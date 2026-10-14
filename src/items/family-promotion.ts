/**
 * Which family the expanded quiz profile may serve in which band, and the
 * withdrawal list that pulls one back out.
 *
 * The human-solvability gate that decides a withdrawal is described in
 * docs/plans/deterministic-novel-tests.md; pilot sittings run through
 * prototype-pilot.ts and `npm run pilot:report`.
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
 * These retention budgets stay below 60 seconds per question. Bands are metadata,
 * not question quotas: the fixed difficulty profiles need timed human attempts
 * before their total time or cross-family difficulty can be calibrated. See the
 * human-solvability gate in docs/plans/deterministic-novel-tests.md.
 */
export const BAND_TIME_BUDGET_SECONDS: Readonly<Record<ExpandedProfileBand, number>> = {
  warmup: 25,
  composition: 40,
  "constraint-spatial": 50,
  "induction-transfer": 55,
};

export interface FamilyBandPromotion {
  band: ExpandedProfileBand;
  state: PromotionState;
  /** Buckets that passed the shared code-correctness contract for this band. */
  validatedDifficultyBuckets: readonly string[];
}

export interface FamilyPromotionEntry {
  /** The version suffix is part of the family identity and promotion record. */
  familyId: string;
  primaryReasoningFamily: string;
  bands: readonly FamilyBandPromotion[];
}

export type FamilyPromotionRegistry = readonly FamilyPromotionEntry[];

function codeValidBand(
  band: ExpandedProfileBand,
  validatedDifficultyBuckets: readonly string[],
): FamilyBandPromotion {
  return { band, state: "code-valid", validatedDifficultyBuckets };
}

/**
 * Every family the expanded profile may serve, and the band and buckets each
 * serves in. No human pilot results are recorded here, so no pair is enabled;
 * code-valid is enough to be served (see `eligibleFamiliesForBand`). Four
 * prototype rows with no scene generator behind them were deleted on
 * 2026-09-28.
 */
export const CURRENT_FAMILY_PROMOTION_REGISTRY: FamilyPromotionRegistry = [
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
    // Local repaint and copying depend on the state earlier gates create.
    // v3 remains available to the evaluation harness as the frozen before arm.
    familyId: "transformation-machine-v4",
    primaryReasoningFamily: "operator-induction",
    bands: [codeValidBand("induction-transfer", ["transformation-machine-v4-d5"])],
  },
  {
    // Disabled on 2026-10-09 at the owner's request. Keep the generator
    // available for historical diagnostics, outside tests and pilot packets.
    familyId: "spatial-assembly-v1",
    primaryReasoningFamily: "spatial-assembly",
    bands: [],
  },
  {
    familyId: "overlapping-figures-v1",
    primaryReasoningFamily: "figure-combination",
    bands: [
      codeValidBand("composition", ["overlapping-figures-d3"]),
      codeValidBand("constraint-spatial", ["overlapping-figures-d4", "overlapping-figures-d5"]),
      codeValidBand("induction-transfer", ["overlapping-figures-d5"]),
    ],
  },
  {
    familyId: "attribute-matrix-v1",
    primaryReasoningFamily: "attribute-distribution",
    bands: [
      codeValidBand("warmup", ["attribute-matrix-d2"]),
      codeValidBand("composition", ["attribute-matrix-d3"]),
      codeValidBand("constraint-spatial", ["attribute-matrix-d4"]),
    ],
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
  // `parallel-evolution-v1` was retired in code on 2026-09-28 (owner's
  // decision): every wrong option was one token away from the answer, so a
  // cell-by-cell vote over the options rebuilt the answer in every item. See
  // docs/plans/blind-answer-leak.md.
  //
  // `rule-switching-v2` was retired in code on 2026-09-29 (owner's decision):
  // it demonstrated two gates and its query used only one, so every item showed
  // a transformation that played no part in the answer. The schema now rejects
  // any machine table whose worked gates and query gates differ.
  //
  // `combining-machine-v1` was retired in code on 2026-10-05 (owner's decision):
  // its chained pieces each meet the same right board again, no single-piece
  // example could show that, and it took an extra chained example row to read
  // one way (v28) after Codex named other chainings. See
  // docs/plans/one-reading-per-worked-row.md.
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
