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
  enumerateSceneUnaryOperations,
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

  it("supports exact aligned set operations and rejects conflicting unions", () => {
    const left = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 1, column: 1, object: token("square") },
    ]);
    const right = scene([
      { row: 1, column: 1, object: token("square") },
      { row: 2, column: 2, object: token("triangle") },
    ]);

    expect(applySceneBinary(left, right, "union")?.objects).toHaveLength(3);
    expect(applySceneBinary(left, right, "intersection")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "subtract")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "xor")?.objects).toHaveLength(2);

    const conflict = scene([{ row: 0, column: 0, object: token("star") }]);
    expect(applySceneBinary(left, conflict, "union")).toBeNull();
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
