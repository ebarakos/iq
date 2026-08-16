import { describe, expect, it } from "vitest";
import {
  BAND_TIME_BUDGET_SECONDS,
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  type FamilyPromotionRegistry,
  type PilotAggregate,
} from "./family-promotion";
import {
  assembleExpandedPreviewQuiz,
  assembleExpandedQuiz,
  EXPANDED_QUIZ_SLOTS,
} from "./expanded-quiz";
import { VisualPuzzleSetSchema } from "./schema";

function passingRegistry(): FamilyPromotionRegistry {
  return CURRENT_FAMILY_PROMOTION_REGISTRY.map((family) => ({
    ...family,
    bands: family.bands.map((band) => {
      if (band.validatedDifficultyBuckets.length === 0) return band;
      const metrics: PilotAggregate = {
        difficultyBuckets: band.validatedDifficultyBuckets,
        representativeItemCount: 3,
        attempts: 24,
        minimumAttemptsPerItem: 8,
        correctAttempts: 18,
        intendedRelationshipDescriptions: 20,
        notationMisunderstandingReports: 2,
        medianSolveTimeSeconds: BAND_TIME_BUDGET_SECONDS[band.band] - 10,
        allItemsPassCorrectnessContract: true,
        hasRepeatedDefensibleAlternativeAnswer: false,
        spatialLayoutChangesAcrossViewports: false,
        desktopAttempts: 12,
        mobileAttempts: 12,
      };
      return { ...band, state: "enabled" as const, fallbackAvailable: true, pilotMetrics: metrics };
    }),
  }));
}

describe("assembleExpandedQuiz", () => {
  it("refuses to assemble from code-valid families without human pilot evidence", () => {
    expect(() => assembleExpandedQuiz("not-promoted", CURRENT_FAMILY_PROMOTION_REGISTRY))
      .toThrow(/no eligible/);
  });

  it("assembles the deterministic 2/4/4/2 profile from fully enabled families", () => {
    const registry = passingRegistry();
    const first = assembleExpandedQuiz("expanded-scenes", registry);
    const replay = assembleExpandedQuiz("expanded-scenes", registry);

    expect(replay).toEqual(first);
    expect(VisualPuzzleSetSchema.safeParse(first).success).toBe(true);
    expect(first).toHaveLength(12);
    expect(EXPANDED_QUIZ_SLOTS.map((slot) => slot.band)).toEqual([
      "warmup", "warmup",
      "composition", "composition", "composition", "composition",
      "constraint-spatial", "constraint-spatial", "constraint-spatial", "constraint-spatial",
      "induction-transfer", "induction-transfer",
    ]);

    const familyIds = first.map((puzzle) => puzzle.generation!.familyId);
    const counts = familyIds.reduce((map, familyId) =>
      map.set(familyId, (map.get(familyId) ?? 0) + 1), new Map<string, number>());
    expect(new Set(familyIds).size).toBeGreaterThanOrEqual(6);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    for (let index = 1; index < familyIds.length; index++) {
      expect(familyIds[index]).not.toBe(familyIds[index - 1]);
    }
  });

  it("requires a representative fallback for every selected family", () => {
    const registry = passingRegistry().map((family) => ({
      ...family,
      bands: family.bands.map((band) =>
        band.band === "induction-transfer" ? { ...band, fallbackAvailable: false } : band),
    }));
    expect(() => assembleExpandedQuiz("missing-fallback", registry)).toThrow(/verified fallback/);
  });

  it("keeps coverage and replay invariants across many expanded schedules", () => {
    const registry = passingRegistry();
    for (let seed = 0; seed < 30; seed++) {
      const first = assembleExpandedQuiz(`schedule-${seed}`, registry);
      const replay = assembleExpandedQuiz(`schedule-${seed}`, registry);
      expect(replay).toEqual(first);
      const familyIds = first.map((puzzle) => puzzle.generation!.familyId);
      const counts = familyIds.reduce((map, familyId) =>
        map.set(familyId, (map.get(familyId) ?? 0) + 1), new Map<string, number>());
      expect(new Set(familyIds).size).toBeGreaterThanOrEqual(6);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
      for (let index = 1; index < familyIds.length; index++) {
        expect(familyIds[index]).not.toBe(familyIds[index - 1]);
      }
    }
  });

  it("assembles an explicitly unpiloted preview without weakening the live gate", () => {
    const first = assembleExpandedPreviewQuiz("preview-scenes", CURRENT_FAMILY_PROMOTION_REGISTRY);
    const replay = assembleExpandedPreviewQuiz("preview-scenes", CURRENT_FAMILY_PROMOTION_REGISTRY);

    expect(replay).toEqual(first);
    expect(VisualPuzzleSetSchema.safeParse(first).success).toBe(true);
    expect(first).toHaveLength(12);
    expect(new Set(first.map((puzzle) => puzzle.familyId)).size).toBe(12);
    expect(first.map((puzzle) => puzzle.band)).toEqual(EXPANDED_QUIZ_SLOTS.map((slot) => slot.band));
    expect(first.map((puzzle) => puzzle.difficulty)).toEqual([2, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5]);
    expect(first[0].familyId).toBe("relational-sequence-v1");
    expect(first[1].familyId).toBe("spatial-transform-v1");
    expect(first[10].familyId).toBe("rule-switching-v1");
    expect(first[11]).toMatchObject({
      familyId: "transformation-machine-v2",
      layout: "machineTable",
      difficulty: 5,
    });
    expect(first[11].stem).toHaveLength(12);
    expect(() => assembleExpandedQuiz("preview-scenes", CURRENT_FAMILY_PROMOTION_REGISTRY))
      .toThrow(/no eligible/);

    for (let seed = 0; seed < 20; seed++) {
      const preview = assembleExpandedPreviewQuiz(`preview-variety-${seed}`, CURRENT_FAMILY_PROMOTION_REGISTRY);
      const familyIds = preview.map((puzzle) => puzzle.familyId);
      expect(preview).toHaveLength(12);
      expect(new Set(familyIds).size).toBe(12);
      expect(preview.every((puzzle) =>
        puzzle.stem.filter((panel) => !("blank" in panel)).length >= 2)).toBe(true);
      expect(preview.every((puzzle) => puzzle.layout !== "singleScene")).toBe(true);
      for (let index = 1; index < preview.length; index++) {
        expect(preview[index].difficulty).toBeGreaterThanOrEqual(preview[index - 1].difficulty);
      }
      expect(preview.some((puzzle) => puzzle.layout === "operatorTable")).toBe(false);
    }
  });
});
