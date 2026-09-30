import { describe, expect, it } from "vitest";
import { sceneSignature, type Scene, type SceneToken } from "./schema";
import {
  applySceneBinary,
  applySceneCompositionPrimitive,
  applySceneExpression,
  applySceneOrderedComposition,
  applySceneUnary,
  enumerateSceneConcepts,
  enumerateSceneOrderedCompositions,
  enumerateSceneOrderedThreeStepCompositions,
  enumerateSceneUnaryOperations,
  isSceneComposedProgram,
  sceneComposedPrimitives,
  sceneComposedProgramFromSteps,
  sceneComposedProgramSteps,
  sceneProgramFits,
  sceneSatisfiesConcept,
  sceneSatisfiesRelation,
  type SceneExpression,
} from "./scene-grammar";

const token = (shape: SceneToken["shape"], fill: SceneToken["fill"] = "outline"): SceneToken => ({
  kind: "token",
  shape,
  rotation: 0,
  fill,
  size: "l",
});

function scene(objects: Scene["objects"], rows = 3, columns = 3): Scene {
  return { kind: "scene", rows, columns, objects, tiles: [] };
}

describe("scene grammar", () => {
  it("enumerates every bounded unary operation deterministically", () => {
    const operations = enumerateSceneUnaryOperations(2, 2);
    expect(operations).toEqual(enumerateSceneUnaryOperations(2, 2));
    expect(operations).toContainEqual({ kind: "reflect", axis: "horizontal" });
    expect(operations).toContainEqual({ kind: "turn", quarterTurns: 1 });
    expect(operations).toContainEqual({ kind: "turn", quarterTurns: 2 });
    expect(operations).toContainEqual({ kind: "turn", quarterTurns: 3 });
    expect(operations).toContainEqual({ kind: "duplicate", from: { row: 0, column: 0 }, to: { row: 1, column: 1 } });
    expect(operations).toContainEqual({ kind: "contain", at: { row: 0, column: 0 }, containerShape: "square" });
    expect(new Set(operations.map((operation) => JSON.stringify(operation))).size).toBe(operations.length);
  });

  it("contains and uncontains one visible token without changing its identity", () => {
    const input = scene([{ row: 0, column: 0, object: token("star") }]);
    const contained = applySceneUnary(input, {
      kind: "contain",
      at: { row: 0, column: 0 },
      containerShape: "square",
    });
    expect(contained?.objects[0].object).toMatchObject({ kind: "container", shape: "square" });
    expect(applySceneUnary(contained!, { kind: "uncontain", at: { row: 0, column: 0 } }))
      .toEqual(input);
  });
  it("applies visible position transforms without hidden identities", () => {
    const input = scene([{ row: 0, column: 0, object: token("circle") }]);
    const moved = applySceneUnary(input, {
      kind: "translate",
      rowDelta: 1,
      columnDelta: 2,
      wrap: false,
    });
    expect(moved?.objects[0]).toMatchObject({ row: 1, column: 2 });
    expect(applySceneUnary(input, {
      kind: "translate",
      rowDelta: -1,
      columnDelta: 0,
      wrap: false,
    })).toBeNull();

    const reflected = applySceneUnary(input, { kind: "reflect", axis: "horizontal" });
    expect(reflected?.objects[0]).toMatchObject({ row: 0, column: 2 });
  });

  it("gives every one of the eight set operations a defined result on a clash", () => {
    const left = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 1, column: 1, object: token("square") },
    ]);
    const right = scene([
      { row: 1, column: 1, object: token("square") },
      { row: 2, column: 2, object: token("triangle") },
    ]);

    // The two boards agree wherever they overlap, so identity makes no
    // difference here and the counts are the plain set-algebra ones.
    expect(applySceneBinary(left, right, "union-left")?.objects).toHaveLength(3);
    expect(applySceneBinary(left, right, "union-right")?.objects).toHaveLength(3);
    expect(applySceneBinary(left, right, "intersection")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "overlap-left")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "subtract")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "mask-out")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "exclusive")?.objects).toHaveLength(2);

    // A clash — both boards occupy (0,0) with different tokens — is where the
    // eight operations separate. Until 2026-08-27 union simply refused this
    // draw, which is why the family could only ever use inputs that agreed and
    // the owner called the results toys. Every operation now answers.
    const conflict = scene([
      { row: 0, column: 0, object: token("star") },
      { row: 1, column: 1, object: token("square") },
    ]);
    const shapesAt = (operation: Parameters<typeof applySceneBinary>[2], row: number, column: number) =>
      applySceneBinary(left, conflict, operation)?.objects
        .filter((placement) => placement.row === row && placement.column === column)
        .map((placement) => (placement.object as { shape?: string }).shape ?? "?") ?? [];

    // Clash resolution: the same position, two different answers.
    expect(shapesAt("union-left", 0, 0)).toEqual(["circle"]);
    expect(shapesAt("union-right", 0, 0)).toEqual(["star"]);
    expect(shapesAt("overlap-left", 0, 0)).toEqual(["circle"]);
    expect(shapesAt("overlap-right", 0, 0)).toEqual(["star"]);
    // Identity: `intersection` and `subtract` compare whole tokens, so the
    // clashing position is not shared and not removed; `overlap-*` and
    // `mask-out` care only that something is there.
    expect(shapesAt("intersection", 0, 0)).toEqual([]);
    expect(shapesAt("intersection", 1, 1)).toEqual(["square"]);
    expect(shapesAt("subtract", 0, 0)).toEqual(["circle"]);
    expect(shapesAt("subtract", 1, 1)).toEqual([]);
    expect(shapesAt("mask-out", 0, 0)).toEqual([]);
    expect(shapesAt("exclusive", 0, 0)).toEqual([]);
  });

  it("composes bounded expressions and checks worked examples", () => {
    const input = scene([{ row: 0, column: 0, object: token("circle") }]);
    const expression: SceneExpression = {
      op: "unary",
      operation: { kind: "setFill", fill: "solid" },
      input: {
        op: "unary",
        operation: { kind: "translate", rowDelta: 1, columnDelta: 1, wrap: false },
        input: { op: "input", index: 0 },
      },
    };
    const output = applySceneExpression(expression, [input]);
    expect(output?.objects[0]).toMatchObject({
      row: 1,
      column: 1,
      object: { fill: "solid" },
    });
    expect(sceneProgramFits(expression, [{ inputs: [input], output: output! }])).toBe(true);
  });

  it("enumerates and applies visible ordered compositions", () => {
    const programs = enumerateSceneOrderedCompositions();
    expect(programs).toHaveLength(16);
    expect(new Set(programs.map((program) => JSON.stringify(program))).size).toBe(16);
    const input = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 2, column: 0, object: token("square") },
    ]);
    const program = programs[0];
    const answer = applySceneOrderedComposition(input, program);
    const reversed = applySceneOrderedComposition(input, { first: program.second, second: program.first });
    expect(answer).not.toBeNull();
    expect(reversed).not.toBeNull();
    expect(sceneSignature(answer!)).not.toBe(sceneSignature(reversed!));
    expect(applySceneCompositionPrimitive(input, {
      kind: "setFillAt",
      at: { row: 0, column: 0 },
      fill: "half",
    })?.objects[0].object).toMatchObject({ fill: "half" });
  });

  it("enumerates and evaluates the complete bounded relation grammar", () => {
    const adjacentMatching = scene([
      { row: 1, column: 0, object: token("circle") },
      { row: 1, column: 1, object: token("circle") },
    ]);
    expect(sceneSatisfiesRelation(adjacentMatching, { kind: "adjacent" })).toBe(true);
    expect(sceneSatisfiesRelation(adjacentMatching, { kind: "same", attribute: "shape" })).toBe(true);
    expect(sceneSatisfiesConcept(adjacentMatching, {
      all: [{ kind: "adjacent" }, { kind: "same", attribute: "shape" }],
    })).toBe(true);
    expect(enumerateSceneConcepts()).toHaveLength(78);
  });

  it("uses canonical scene ordering for semantic comparisons", () => {
    const first = scene([
      { row: 2, column: 2, object: token("star") },
      { row: 0, column: 0, object: token("circle") },
    ]);
    const second = scene([...first.objects].reverse());
    const normalized = applySceneUnary(first, { kind: "setFill", fill: "outline" });
    expect(sceneSignature(normalized!)).toBe(sceneSignature(applySceneUnary(second, { kind: "setFill", fill: "outline" })!));
  });
});

describe("token turn", () => {
  const spinner = (
    shape: SceneToken["shape"],
    rotation = 0,
  ): SceneToken => ({ kind: "token", shape, rotation, fill: "outline", size: "l" });

  it("turns every orientable token in place and leaves the board alone", () => {
    const input: Scene = {
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: [
        { row: 0, column: 2, object: spinner("arrow", 90) },
        { row: 2, column: 0, object: spinner("triangle") },
      ],
      tiles: [{ row: 1, column: 1, edges: ["north", "west"] }],
    };

    const turned = applySceneUnary(input, { kind: "turn", quarterTurns: 1 });
    expect(turned?.objects).toEqual([
      { row: 0, column: 2, object: spinner("arrow", 180) },
      { row: 2, column: 0, object: spinner("triangle", 90) },
    ]);
    expect(turned?.tiles).toEqual(input.tiles);
  });

  it("wraps past a full circle", () => {
    const input = scene([{ row: 0, column: 0, object: spinner("arrow", 270) }]);
    expect(applySceneUnary(input, { kind: "turn", quarterTurns: 1 })?.objects[0].object)
      .toMatchObject({ rotation: 0 });
    expect(applySceneUnary(input, { kind: "turn", quarterTurns: 3 })?.objects[0].object)
      .toMatchObject({ rotation: 180 });
  });

  it("composes: two single turns equal one double turn", () => {
    const input = scene([
      { row: 0, column: 0, object: spinner("arrow", 90) },
      { row: 1, column: 1, object: spinner("triangle", 180) },
    ]);
    const once = applySceneUnary(input, { kind: "turn", quarterTurns: 1 })!;
    const twice = applySceneUnary(once, { kind: "turn", quarterTurns: 1 })!;
    const doubled = applySceneUnary(input, { kind: "turn", quarterTurns: 2 })!;
    expect(sceneSignature(twice)).toBe(sceneSignature(doubled));
    expect(sceneSignature(once)).not.toBe(sceneSignature(doubled));
  });

  it("leaves shapes with no readable orientation exactly as they were", () => {
    const input = scene([
      { row: 0, column: 0, object: spinner("arrow") },
      { row: 1, column: 1, object: spinner("circle") },
      { row: 2, column: 2, object: spinner("star") },
    ]);
    const turned = applySceneUnary(input, { kind: "turn", quarterTurns: 2 });
    expect(turned?.objects[0].object).toMatchObject({ shape: "arrow", rotation: 180 });
    expect(turned?.objects[1].object).toEqual(spinner("circle"));
    expect(turned?.objects[2].object).toEqual(spinner("star"));
  });

  it("turns orientable tokens inside containers too", () => {
    const input = scene([{
      row: 1,
      column: 1,
      object: { kind: "container", shape: "circle", contents: [spinner("arrow"), spinner("square")] },
    }]);
    expect(applySceneUnary(input, { kind: "turn", quarterTurns: 3 })?.objects[0].object).toEqual({
      kind: "container",
      shape: "circle",
      contents: [spinner("arrow", 270), spinner("square")],
    });
  });

  it("rejects a scene with nothing to turn instead of returning it unchanged", () => {
    expect(applySceneUnary(
      scene([{ row: 0, column: 0, object: spinner("circle") }]),
      { kind: "turn", quarterTurns: 1 },
    )).toBeNull();
    expect(applySceneUnary(
      scene([{
        row: 0,
        column: 0,
        object: { kind: "container", shape: "square", contents: [spinner("hexagon")] },
      }]),
      { kind: "turn", quarterTurns: 2 },
    )).toBeNull();
    expect(applySceneUnary(
      { kind: "scene", rows: 2, columns: 2, objects: [], tiles: [{ row: 0, column: 0, edges: ["north"] }] },
      { kind: "turn", quarterTurns: 1 },
    )).toBeNull();
  });
});

describe("composed program lengths", () => {
  it("holds every three-gate program to the grammar's three rules", () => {
    const programs = enumerateSceneOrderedThreeStepCompositions();
    // 8x7x6 = 336 ordered triples of distinct primitives, less 4x3x2 = 24 that
    // are all board moves, less the 6 x 3! = 36 that hold both turns.
    expect(programs).toHaveLength(276);
    for (const program of programs) {
      const steps = sceneComposedProgramSteps(program);
      expect(steps).toHaveLength(3);
      // Distinct primitives.
      expect(new Set(steps.map((step) => JSON.stringify(step))).size).toBe(3);
      // Not all board moves, and at most one turn.
      expect(steps.some((step) => step.kind !== "spatial")).toBe(true);
      expect(steps.filter((step) => step.kind === "turn").length).toBeLessThanOrEqual(1);
      expect(isSceneComposedProgram(steps)).toBe(true);
    }
  });

  it("round-trips two and three gates and refuses a fourth", () => {
    // The owner's three-gate ceiling of 2026-08-27, held in the grammar itself
    // since the four- and five-gate programs were deleted on 2026-09-28.
    const pool = sceneComposedPrimitives();
    const steps = [pool[0], pool[4], pool[6]];
    const program = sceneComposedProgramFromSteps(steps);
    expect(sceneComposedProgramSteps(program)).toEqual(steps);
    expect(Object.keys(program)).toEqual(["first", "second", "third"]);
    expect(sceneComposedProgramSteps(sceneComposedProgramFromSteps(steps.slice(0, 2)))).toHaveLength(2);
    expect(() => sceneComposedProgramFromSteps([...steps, pool[5]])).toThrow(/two or three gates/);
    expect(isSceneComposedProgram([...steps, pool[5]])).toBe(false);
    const pair = enumerateSceneOrderedCompositions()[0];
    expect(isSceneComposedProgram([pair.first, pair.second])).toBe(true);
    expect(isSceneComposedProgram([pool[0], pool[1]])).toBe(false);
  });
});
