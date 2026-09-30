import { describe, expect, it } from "vitest";
import {
  drawExpandedSlot,
  EXPANDED_SLOT_RETRY_BUDGET,
  planExpandedSchedule,
  type EligibleFamily,
} from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "@/items/family-promotion";
import type { Puzzle, Visual } from "@/items/schema";
import {
  coverageComplete,
  formatMissingCoverage,
  probeCoverage,
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
function itemsForSchedules(schedules: readonly EligibleFamily[][]): Puzzle<Visual>[] {
  const byKey = new Map<string, Puzzle<Visual>>();
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
  it("selects the fixed minimum for every eligible family and complexity bucket", () => {
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
    expect(requirements.families).toHaveLength(eligible.length);
    expect(requirements.minimum).toBe(STANDARD_PROBE_MINIMUM);
    expect(coverageComplete(report)).toBe(true);
    expect(selected.length).toBeGreaterThanOrEqual(requirements.families.length * requirements.minimum);
  });

  it("prints each missing family and program-complexity bucket with its count", () => {
    const requirements = {
      families: ["family-a", "family-b"],
      programComplexities: ["complexity-2-depth-1"],
      minimum: 2,
    };
    const message = formatMissingCoverage(probeCoverage([], requirements));

    expect(message).toContain("family-a: 0/2");
    expect(message).toContain("family-b: 0/2");
    expect(message).toContain("complexity-2-depth-1: 0/2");
  });
});
