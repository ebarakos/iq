import { describe, expect, it } from "vitest";
import {
  drawExpandedSlot,
  EXPANDED_SLOT_RETRY_BUDGET,
  planExpandedSchedule,
  type EligibleFamily,
} from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "@/items/family-promotion";
import type { Puzzle } from "@/items/schema";
import {
  coverageComplete,
  formatMissingCoverage,
  probeCoverage,
  probeKey,
  selectCoverageItems,
  standardProbeRequirements,
  STANDARD_PROBE_MINIMUM,
} from "./agent-probe";

/**
 * One real, accepted item for a scheduled slot's key, drawn through the
 * assembler's own per-item path and shared by every slot with that key.
 *
 * Coverage counts items by family and by complexity stratum, both of which are
 * properties of the key, so thirty long tests' worth of schedules plus one item
 * per key selects exactly what thirty assembled tests would, without paying for
 * nine hundred items.
 */
function itemsForSchedules(schedules: readonly EligibleFamily[][]): Puzzle[] {
  const byKey = new Map<string, Puzzle>();
  return schedules.flat().map((slot) => {
    const key = `${slot.familyId}:${slot.band}:${slot.difficultyBucket}`;
    let item = byKey.get(key);
    for (let attempt = 0; !item && attempt < EXPANDED_SLOT_RETRY_BUDGET; attempt++) {
      const draw = drawExpandedSlot(`coverage-test:${key}`, "long-30", 0, attempt, slot);
      if (draw.accepted) item = draw.puzzle;
    }
    if (!item) throw new Error(`no accepted item for ${key}`);
    byKey.set(key, item);
    return item;
  });
}

describe("standard generated probe coverage", () => {
  it("selects the fixed minimum for every eligible family, complexity bucket and family:band:bucket key", () => {
    // An empty withdrawal list, not the developer's WITHDRAWN_FAMILY_IDS: the
    // test is about the probe's selection rule over the registry, and it must
    // give the same verdict on every machine.
    const withdrawn = new Set<string>();
    const requirements = standardProbeRequirements(CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn);
    const pool = itemsForSchedules(Array.from({ length: 30 }, (_, index) =>
      planExpandedSchedule(`coverage-test:${index}`, "long-30", CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn)));

    const selected = selectCoverageItems(pool, requirements);
    const report = probeCoverage(selected, requirements);

    const eligible = CURRENT_FAMILY_PROMOTION_REGISTRY.filter((family) => family.bands.some((band) => band.state !== "prototype" && band.validatedDifficultyBuckets.length > 0));
    const servedKeys = CURRENT_FAMILY_PROMOTION_REGISTRY.flatMap((family) => family.bands
      .filter((band) => band.state !== "prototype")
      .flatMap((band) => band.validatedDifficultyBuckets.map((bucket) => `${family.familyId}:${band.band}:${bucket}`)));
    expect(requirements.families).toHaveLength(eligible.length);
    expect(requirements.keys).toEqual([...servedKeys].sort());
    expect(requirements.minimum).toBe(STANDARD_PROBE_MINIMUM);
    expect(coverageComplete(report)).toBe(true);
    for (const key of requirements.keys) {
      expect(selected.filter((item) => probeKey(item) === key).length, key).toBeGreaterThanOrEqual(requirements.minimum);
    }
  });

  it("counts a family's second band or bucket as its own key", () => {
    const requirements = {
      families: ["family-a"],
      programComplexities: [],
      keys: ["family-a:composition:family-a-d4", "family-a:induction-transfer:family-a-d5"],
      minimum: 1,
    };
    const item = (band: "composition" | "induction-transfer", bucket: string) => ({
      familyId: "family-a",
      band,
      generation: { familyId: "family-a", featureBucket: bucket, features: { ruleComplexity: 4, programDepth: 2 } },
    }) as unknown as Puzzle;
    const pool = [item("composition", "family-a-d4"), item("composition", "family-a-d4"), item("induction-transfer", "family-a-d5")];

    const selected = selectCoverageItems(pool, requirements);
    expect(selected.map(probeKey)).toEqual(requirements.keys);
    expect(probeCoverage(pool.slice(0, 2), requirements).missingKeys)
      .toEqual([{ key: "family-a:induction-transfer:family-a-d5", have: 0, need: 1 }]);
  });

  it("prints each missing family and program-complexity bucket with its count", () => {
    const requirements = {
      families: ["family-a", "family-b"],
      programComplexities: ["complexity-2-depth-1"],
      keys: ["family-a:warmup:family-a-d2"],
      minimum: 2,
    };
    const message = formatMissingCoverage(probeCoverage([], requirements));

    expect(message).toContain("family-a: 0/2");
    expect(message).toContain("family-b: 0/2");
    expect(message).toContain("complexity-2-depth-1: 0/2");
    expect(message).toContain("family-a:warmup:family-a-d2: 0/2");
  });
});
