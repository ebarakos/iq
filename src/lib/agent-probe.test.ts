import { describe, expect, it } from "vitest";
import { assembleExpandedQuiz } from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, readWithdrawnFamilyIds } from "@/items/family-promotion";
import {
  coverageComplete,
  formatMissingCoverage,
  probeCoverage,
  selectCoverageItems,
  standardProbeRequirements,
  STANDARD_PROBE_MINIMUM,
} from "./agent-probe";

describe("standard generated probe coverage", () => {
  it("selects the fixed minimum for every eligible family and complexity bucket", () => {
    const withdrawn = readWithdrawnFamilyIds();
    const requirements = standardProbeRequirements(CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn);
    const pool = Array.from({ length: 30 }, (_, index) =>
      assembleExpandedQuiz(`coverage-test:${index}`, "long-30", CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn),
    ).flat();

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
