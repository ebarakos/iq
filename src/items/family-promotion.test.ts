import { describe, expect, it } from "vitest";
import {
  BAND_TIME_BUDGET_SECONDS,
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  evaluatePilotAggregate,
  promoteFamilyBand,
  recordPilotAggregate,
  selectEnabledFamilyBands,
  type ExpandedProfileBand,
  type FamilyBandPromotion,
  type FamilyPromotionRegistry,
  type PilotAggregate,
} from "./family-promotion";

function passingMetrics(
  band: ExpandedProfileBand,
  overrides: Partial<PilotAggregate> = {},
): PilotAggregate {
  return {
    difficultyBuckets: [`${band}-d1`],
    representativeItemCount: 3,
    attempts: 24,
    minimumAttemptsPerItem: 8,
    correctAttempts: 20,
    intendedRelationshipDescriptions: 18,
    notationMisunderstandingReports: 4,
    medianSolveTimeSeconds: BAND_TIME_BUDGET_SECONDS[band],
    allItemsPassCorrectnessContract: true,
    hasRepeatedDefensibleAlternativeAnswer: false,
    spatialLayoutChangesAcrossViewports: false,
    desktopAttempts: 24,
    mobileAttempts: 0,
    ...overrides,
  };
}

function pilotPromotion(
  band: ExpandedProfileBand,
  overrides: Partial<FamilyBandPromotion> = {},
): FamilyBandPromotion {
  return {
    band,
    state: "pilot",
    validatedDifficultyBuckets: [`${band}-d1`],
    perItemTimeBudgetSeconds: BAND_TIME_BUDGET_SECONDS[band],
    fallbackAvailable: true,
    pilotMetrics: passingMetrics(band),
    ...overrides,
  };
}

function registryWith(...bands: FamilyBandPromotion[]): FamilyPromotionRegistry {
  return [
    {
      familyId: "candidate-family-v1",
      primaryReasoningFamily: "test-reasoning",
      bands,
    },
  ];
}

describe("family promotion registry", () => {
  it("starts every current family outside the enabled state", () => {
    const promotions = CURRENT_FAMILY_PROMOTION_REGISTRY.flatMap((family) => family.bands);

    expect(promotions.length).toBeGreaterThan(0);
    expect(promotions.every((promotion) => promotion.state !== "enabled")).toBe(true);
    expect(
      CURRENT_FAMILY_PROMOTION_REGISTRY.find((family) => family.familyId === "operator-induction-v1")?.bands,
    ).toEqual([]);
    expect(
      CURRENT_FAMILY_PROMOTION_REGISTRY.find((family) => family.familyId === "transformation-machine-v2")?.bands[0],
    ).toMatchObject({ state: "code-valid", band: "induction-transfer" });
    expect(selectEnabledFamilyBands(CURRENT_FAMILY_PROMOTION_REGISTRY, "warmup", "warmup-d1")).toEqual([]);
  });

  it("advances only through prototype, code-valid, pilot, and enabled", () => {
    const initial = registryWith({
      ...pilotPromotion("composition"),
      state: "prototype",
      pilotMetrics: undefined,
    });

    const codeValid = promoteFamilyBand(initial, "candidate-family-v1", "composition");
    expect(codeValid.promoted).toBe(true);
    expect(codeValid.registry[0].bands[0].state).toBe("code-valid");

    const pilot = promoteFamilyBand(codeValid.registry, "candidate-family-v1", "composition");
    expect(pilot.promoted).toBe(true);
    expect(pilot.registry[0].bands[0].state).toBe("pilot");

    const withoutMetrics = promoteFamilyBand(pilot.registry, "candidate-family-v1", "composition");
    expect(withoutMetrics.promoted).toBe(false);
    expect(withoutMetrics.reasons).toContain("pilot metrics are missing");

    const withMetrics = recordPilotAggregate(
      pilot.registry,
      "candidate-family-v1",
      "composition",
      passingMetrics("composition"),
    );
    const enabled = promoteFamilyBand(withMetrics, "candidate-family-v1", "composition");
    expect(enabled.promoted).toBe(true);
    expect(enabled.registry[0].bands[0].state).toBe("enabled");

    const alreadyEnabled = promoteFamilyBand(enabled.registry, "candidate-family-v1", "composition");
    expect(alreadyEnabled).toMatchObject({ promoted: false, reasons: ["family/band pair is already enabled"] });
  });
});

describe("human-solvability gate", () => {
  it("accepts the documented threshold boundaries for every band", () => {
    for (const band of ["warmup", "composition", "constraint-spatial", "induction-transfer"] as const) {
      const promotion = pilotPromotion(band, {
        pilotMetrics: passingMetrics(band, {
          attempts: 40,
          correctAttempts: 30,
          intendedRelationshipDescriptions: 30,
          notationMisunderstandingReports: 8,
          desktopAttempts: 40,
        }),
      });
      expect(evaluatePilotAggregate(promotion)).toEqual({ eligible: true, reasons: [] });
    }
  });

  it.each([
    ["three representative items", { representativeItemCount: 2 }],
    ["eight attempts per item", { minimumAttemptsPerItem: 7 }],
    ["the correctness contract", { allItemsPassCorrectnessContract: false }],
    ["75% intended-rule understanding", { intendedRelationshipDescriptions: 17 }],
    ["the 20% misunderstanding ceiling", { notationMisunderstandingReports: 5 }],
    ["no defensible repeated alternative", { hasRepeatedDefensibleAlternativeAnswer: true }],
    ["the band time budget", { medianSolveTimeSeconds: 91 }],
  ] as const)("rejects a pilot that misses %s", (_label, overrides) => {
    const promotion = pilotPromotion("composition", {
      pilotMetrics: passingMetrics("composition", overrides),
    });

    expect(evaluatePilotAggregate(promotion).eligible).toBe(false);
  });

  it("requires both desktop and mobile evidence when the spatial layout changes", () => {
    const missingMobile = pilotPromotion("constraint-spatial", {
      pilotMetrics: passingMetrics("constraint-spatial", {
        spatialLayoutChangesAcrossViewports: true,
        desktopAttempts: 24,
        mobileAttempts: 0,
      }),
    });
    const bothViewports = pilotPromotion("constraint-spatial", {
      pilotMetrics: passingMetrics("constraint-spatial", {
        spatialLayoutChangesAcrossViewports: true,
        desktopAttempts: 12,
        mobileAttempts: 12,
      }),
    });

    expect(evaluatePilotAggregate(missingMobile).eligible).toBe(false);
    expect(evaluatePilotAggregate(bothViewports).eligible).toBe(true);
  });

  it("requires pilot and validated difficulty buckets to match", () => {
    const promotion = pilotPromotion("warmup", {
      pilotMetrics: passingMetrics("warmup", { difficultyBuckets: ["another-bucket"] }),
    });

    expect(evaluatePilotAggregate(promotion).reasons).toContain(
      "pilot difficulty buckets must match the validated difficulty buckets",
    );
  });

  it("requires an enabled warmup to be easier and faster than an enabled later band", () => {
    const warmup = {
      ...pilotPromotion("warmup"),
      state: "enabled" as const,
      pilotMetrics: passingMetrics("warmup", {
        correctAttempts: 18,
        medianSolveTimeSeconds: 50,
      }),
    };
    const later = pilotPromotion("composition", {
      pilotMetrics: passingMetrics("composition", {
        correctAttempts: 20,
        medianSolveTimeSeconds: 45,
      }),
    });

    const result = promoteFamilyBand(registryWith(warmup, later), "candidate-family-v1", "composition");
    expect(result.promoted).toBe(false);
    expect(result.reasons).toEqual([
      "warmup must have a higher solve rate than composition",
      "warmup must have a lower median solve time than composition",
    ]);
  });
});

describe("expanded-profile family selection", () => {
  it("returns only enabled pairs whose requested bucket and pilot evidence remain valid", () => {
    const valid = {
      ...pilotPromotion("composition"),
      state: "enabled" as const,
    };
    const wrongBand = {
      ...pilotPromotion("warmup"),
      state: "enabled" as const,
    };
    const badEvidence = {
      ...pilotPromotion("composition"),
      state: "enabled" as const,
      validatedDifficultyBuckets: ["composition-d2"],
      pilotMetrics: passingMetrics("composition", {
        difficultyBuckets: ["composition-d2"],
        intendedRelationshipDescriptions: 10,
      }),
    };
    const registry: FamilyPromotionRegistry = [
      registryWith(valid)[0],
      { ...registryWith(wrongBand)[0], familyId: "wrong-band-v1" },
      { ...registryWith(badEvidence)[0], familyId: "bad-evidence-v1" },
    ];

    expect(selectEnabledFamilyBands(registry, "composition", "composition-d1")).toEqual([
      {
        familyId: "candidate-family-v1",
        primaryReasoningFamily: "test-reasoning",
        band: "composition",
        difficultyBucket: "composition-d1",
        fallbackAvailable: true,
      },
    ]);
    expect(selectEnabledFamilyBands(registry, "composition", "unknown-bucket")).toEqual([]);
  });
});
