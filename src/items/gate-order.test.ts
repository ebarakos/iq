import { describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { everyAdjacentSwapMatters, gateOrderOutcome } from "./gate-order";
import {
  canonicalTransformationMachineQuery,
  generateSceneFamilyCandidate,
  servableTransformationMachineDraws,
  transformationMachineGates,
} from "./scene-families";
import { applySceneUnary } from "./scene-grammar";
import type { Scene } from "./schema";

/** A board whose only state is a number: one token per set bit, so different numbers draw differently. */
function board(value: number): Scene {
  const bits = value + 1000;
  const objects = Array.from({ length: 16 }, (_, column) => column)
    .filter((column) => ((bits >> column) & 1) === 1)
    .map((column) => ({ row: 0, column, object: { kind: "token", shape: "circle", fill: "outline", size: "m", rotation: 0 } }));
  return { kind: "scene", rows: 1, columns: 16, objects, tiles: [] } as unknown as Scene;
}

/** Gates as functions of a number; null when the gate cannot apply. */
function runner(gates: ((value: number) => number | null)[]) {
  return (order: readonly number[]): Scene | null => {
    let value: number | null = 1;
    for (const index of order) value = value === null ? null : gates[index](value);
    return value === null ? null : board(value);
  };
}

describe("gate order outcomes", () => {
  it("finds one board when the gates commute, and calls every swap the same", () => {
    const outcome = gateOrderOutcome([0, 1, 2], runner([(v) => v + 1, (v) => v + 2, (v) => v + 4]));
    expect(outcome).toMatchObject({ gateCount: 3, validOrders: 6, distinctValidOutputs: 1, adjacentSwaps: ["same", "same"] });
    expect(outcome.ablations).toEqual(["different", "different", "different"]);
    expect(everyAdjacentSwapMatters(outcome)).toBe(false);
  });

  it("finds a different board for both adjacent swaps when every gate reads the state before it", () => {
    const outcome = gateOrderOutcome([0, 1, 2], runner([(v) => v + 1, (v) => v * 2, (v) => v * v]));
    expect(outcome.distinctValidOutputs).toBe(6);
    expect(outcome.adjacentSwaps).toEqual(["different", "different"]);
    expect(everyAdjacentSwapMatters(outcome)).toBe(true);
  });

  it("tells a run that cannot apply apart from an applicable wrong board", () => {
    // Gate 2 applies only after gate 0; gate 1 changes nothing.
    const outcome = gateOrderOutcome([0, 1, 2], runner([(v) => v + 10, (v) => v, (v) => (v > 5 ? v * 2 : null)]));
    expect(outcome.adjacentSwaps).toEqual(["same", "same"]);
    expect(outcome.ablations).toEqual(["undefined", "same", "different"]);
    expect(outcome.validOrders).toBe(3);
  });

  it("measures swaps relative to the shown order, not the displayed one", () => {
    const gates = [(v: number) => v + 1, (v: number) => v * 3, (v: number) => v * 3];
    expect(gateOrderOutcome([0, 1, 2], runner(gates)).adjacentSwaps).toEqual(["different", "same"]);
    expect(gateOrderOutcome([1, 2, 0], runner(gates)).adjacentSwaps).toEqual(["same", "different"]);
  });

  it("refuses a shown order that does not run", () => {
    expect(() => gateOrderOutcome([0], runner([() => null]))).toThrow("must run end to end");
  });

  it("reproduces the plan's count over every servable transformation-machine draw", () => {
    // docs/plans/harden-reasoning.md, "Why transformations feel easier".
    const histogram = new Map<number, number>();
    let allOrdersAgree = 0;
    const draws = servableTransformationMachineDraws();
    for (const draw of draws) {
      const query = canonicalTransformationMachineQuery(draw);
      const gates = transformationMachineGates(draw.program);
      const outcome = gateOrderOutcome([0, 1, 2], (order) => {
        let value: Scene | null = query;
        for (const index of order) value = value && applySceneUnary(value, gates[index]);
        return value;
      });
      histogram.set(outcome.distinctValidOutputs, (histogram.get(outcome.distinctValidOutputs) ?? 0) + 1);
      if (outcome.validOrders === 6 && outcome.distinctValidOutputs === 1) allOrdersAgree++;
    }
    expect(draws).toHaveLength(880);
    expect(Object.fromEntries(histogram)).toEqual({ 1: 768, 2: 112 });
    expect(allOrdersAgree).toBe(96);
  });

  it("is exposed by both gate families' candidates, and every shown gate is needed", () => {
    for (const [familyId, bucket] of [
      ["transformation-machine-v3", "transformation-machine-d5"],
      ["composed-transform-v2", "composed-transform-d4"],
      ["composed-transform-v2", "composed-transform-d5"],
    ] as const) {
      const candidate = generateSceneFamilyCandidate(familyId, seededRng("gate-order-test", bucket), bucket);
      expect(candidate.queryGates, bucket).toBeDefined();
      const outcome = gateOrderOutcome(candidate.queryGates!.order, candidate.queryGates!.run);
      const answer = candidate.puzzle.options[candidate.puzzle.answerIndex];
      expect(candidate.queryGates!.run(candidate.queryGates!.order), bucket).toEqual(answer);
      expect(outcome.ablations, bucket).not.toContain("same");
    }
  });
});
