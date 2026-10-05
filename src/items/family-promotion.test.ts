import { describe, expect, it } from "vitest";
import {
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  readWithdrawnFamilyIds,
  unknownWithdrawnFamilyIds,
} from "./family-promotion";

describe("family promotion registry", () => {
  it("starts every current family outside the enabled state", () => {
    const promotions = CURRENT_FAMILY_PROMOTION_REGISTRY.flatMap((family) => family.bands);

    expect(promotions.length).toBeGreaterThan(0);
    expect(promotions.every((promotion) => promotion.state !== "enabled")).toBe(true);
    // `operator-induction-v1` used to stand here as the family with no eligible
    // band. It and the nine other never-served families were deleted on
    // 2026-08-27; every family left is either code-valid or a prototype, so the
    // property to check is that none of them is ENABLED, which is the line
    // above.
    expect(
      CURRENT_FAMILY_PROMOTION_REGISTRY.find((family) => family.familyId === "transformation-machine-v3")?.bands[0],
    ).toMatchObject({ state: "code-valid", band: "induction-transfer" });
  });
});

describe("family withdrawal", () => {
  it("reads a comma or space separated list and ignores empty entries", () => {
    expect([...readWithdrawnFamilyIds({ WITHDRAWN_FAMILY_IDS: " topology-path-v1, ,minimal-repair-v1 " })])
      .toEqual(["topology-path-v1", "minimal-repair-v1"]);
    expect([...readWithdrawnFamilyIds({ WITHDRAWN_FAMILY_IDS: "fold-punch-v1 rule-switching-v1" })])
      .toEqual(["fold-punch-v1", "rule-switching-v1"]);
    expect(readWithdrawnFamilyIds({}).size).toBe(0);
    expect(readWithdrawnFamilyIds({ WITHDRAWN_FAMILY_IDS: "  " }).size).toBe(0);
  });

  it("names withdrawn ids that match no registered family", () => {
    // One id that IS registered and one that is not. `topology-path-v1` played
    // the registered half until it was deleted on 2026-08-27; a live family
    // takes over the role.
    const withdrawn = new Set(["spatial-transform-v2", "typo-family-v9"]);
    expect(unknownWithdrawnFamilyIds(CURRENT_FAMILY_PROMOTION_REGISTRY, withdrawn))
      .toEqual(["typo-family-v9"]);
  });
});
