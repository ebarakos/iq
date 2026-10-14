import { describe, expect, it } from "vitest";
import type { Scene, ScenePlacement, SceneToken } from "./schema";
import {
  boardKey,
  isReadingCheckedFamily,
  machineWorkedRowReadings,
  machineWorkedRowsAgreeOnQuery,
  secondReadings,
} from "./worked-row-readings";

const placed = (row: number, column: number, shape: SceneToken["shape"], fill: SceneToken["fill"]): ScenePlacement => ({
  row, column, object: { kind: "token", shape, fill, size: "l", rotation: 0 },
});
const scene = (objects: ScenePlacement[]): Scene => ({ kind: "scene", rows: 3, columns: 3, objects, tiles: [] });
const right = (board: Scene, selected: (placement: ScenePlacement) => boolean): Scene => scene(board.objects.map((placement) =>
  selected(placement) ? { ...placement, column: placement.column + 1 } : placement));
const solid = ({ object }: ScenePlacement) => object.kind === "token" && object.fill === "solid";
const gate = scene([placed(0, 0, "hexagon", "outline")]);
const stem = (input: Scene, output: Scene, query: Scene): unknown[] => [input, gate, output, query, gate, null];
const contrasting = scene([
  placed(0, 0, "circle", "solid"), placed(1, 1, "square", "solid"),
  placed(2, 2, "circle", "outline"), placed(2, 0, "diamond", "half"),
]);

describe("conditional composed worked-row readings", () => {
  it("routes ambiguous conditional items through the verifier's family guard", () => {
    const input = scene([placed(0, 0, "circle", "solid"), placed(1, 1, "square", "solid")]);
    const query = scene([...input.objects, placed(2, 0, "diamond", "outline")]);
    const puzzle = {
      stem: stem(input, right(input, solid), query),
      options: [right(query, solid), right(query, () => true)],
      answerIndex: 0,
    };
    // The verifier skips this check altogether for families outside its guard.
    const familyId: string = "composed-transform-v3";
    const found = isReadingCheckedFamily(familyId) ? secondReadings(familyId, puzzle) : [];
    expect(found).toEqual([expect.objectContaining({ option: 1 })]);
  });

  it("limits the new movement vocabulary to composed v3", () => {
    const output = right(contrasting, solid);
    expect(machineWorkedRowReadings("composed-transform-v3", contrasting, output)
      .some(({ name }) => name === "every black shape sliding one square right")).toBe(true);
    expect(machineWorkedRowReadings("composed-transform-v2", contrasting, output)
      .some(({ name }) => name.includes("black shape sliding"))).toBe(false);
  });

  it("rejects a global rule that the example allows, even without a wrong option offering it", () => {
    const input = scene([placed(0, 0, "circle", "solid"), placed(1, 1, "square", "solid")]);
    const output = right(input, solid);
    const query = scene([...input.objects, placed(2, 0, "diamond", "outline")]);
    const answer = right(query, solid);
    const rows = stem(input, output, query);
    expect(secondReadings("composed-transform-v3", { stem: rows, options: [answer], answerIndex: 0 })).toEqual([]);
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", rows, answer)).toBe(false);
    const global = right(query, () => true);
    expect(secondReadings("composed-transform-v3", { stem: rows, options: [answer, global], answerIndex: 0 }))
      .toEqual([expect.objectContaining({ option: 1 })]);
  });

  it("catches shape-specific movement and coloured movement in undercontrasted rows", () => {
    const input = scene([placed(0, 0, "circle", "solid"), placed(1, 1, "circle", "solid"), placed(2, 2, "square", "outline")]);
    const readings = machineWorkedRowReadings("composed-transform-v3", input, right(input, solid));
    const query = scene([placed(0, 0, "circle", "outline"), placed(1, 1, "square", "solid"), placed(2, 0, "diamond", "half")]);
    const intended = boardKey(right(query, solid));
    for (const name of ["every circle sliding one square right", "every coloured shape sliding one square right"]) {
      const reading = readings.find((candidate) => candidate.name === name)!;
      expect(reading, name).toBeDefined();
      expect(boardKey(reading.apply(query)!)).not.toBe(intended);
    }
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem(input, right(input, solid), query), right(query, solid))).toBe(false);
  });

  it("catches fixed pairs of squares even with two shapes and all three fills shown", () => {
    const output = right(contrasting, solid);
    const query = scene([placed(0, 1, "circle", "solid"), placed(1, 0, "square", "solid"), placed(2, 2, "circle", "outline")]);
    const positional = machineWorkedRowReadings("composed-transform-v3", contrasting, output)
      .find(({ name }) => name === "the shapes on square 0,0 and square 1,1 sliding one square right")!;
    expect(positional).toBeDefined();
    expect(boardKey(positional.apply(query)!)).toBe(boardKey(query));
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem(contrasting, output, query), right(query, solid))).toBe(false);
  });

  it("allows indistinguishable position and wrap rules when they agree on the actual query", () => {
    const output = right(contrasting, solid);
    const query = scene(contrasting.objects.slice(0, 3));
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem(contrasting, output, query), right(query, solid))).toBe(true);
    const names = machineWorkedRowReadings("composed-transform-v3", contrasting, output).map(({ name }) => name);
    expect(names).toContain("every black shape sliding one square right, wrapping round the edge");
    expect(names).not.toContain("every coloured shape sliding one square right");
    expect(names).not.toContain("every circle sliding one square right");
    expect(names).not.toContain("every shape sliding one square right");
  });

  it("fails closed when a fitting nonwrapping rule cannot run at the query edge", () => {
    const output = right(contrasting, solid);
    const query = scene([placed(0, 2, "circle", "solid"), placed(1, 1, "square", "solid"), placed(2, 2, "circle", "outline")]);
    const wrapped = scene([placed(0, 0, "circle", "solid"), placed(1, 2, "square", "solid"), placed(2, 2, "circle", "outline")]);
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem(contrasting, output, query), wrapped)).toBe(false);
  });

  it("reads movement against the fill state produced by the preceding gate", () => {
    const paintInput = scene([placed(0, 0, "circle", "outline"), placed(1, 0, "circle", "outline"), placed(2, 2, "square", "half")]);
    const paintOutput = scene([placed(0, 0, "circle", "solid"), ...paintInput.objects.slice(1)]);
    const paintGate = scene([placed(0, 0, "star", "outline")]);
    const query = scene([placed(0, 0, "circle", "outline"), ...contrasting.objects.slice(1, 3)]);
    const strip = scene([paintGate.objects[0], { ...gate.objects[0], column: 1 }]);
    const rows = [paintInput, paintGate, paintOutput, contrasting, gate, right(contrasting, solid), query, strip, null];
    const answer = right(scene(contrasting.objects.slice(0, 3)), solid);
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", rows, answer)).toBe(true);
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", rows, right(query, solid))).toBe(false);
  });

  it("fails closed on a query collision rather than selecting an unshown collision convention", () => {
    const query = scene([placed(0, 0, "circle", "solid"), placed(0, 1, "square", "outline")]);
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem(contrasting, right(contrasting, solid), query), query)).toBe(false);
  });

  it("rejects malformed chains and a worked row with no fitting reading", () => {
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", [], contrasting)).toBe(false);
    expect(machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem(contrasting, scene([]), contrasting), contrasting)).toBe(false);
  });
});
