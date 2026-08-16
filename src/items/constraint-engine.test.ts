import { describe, expect, it } from "vitest";
import type { Scene, SceneObject, SceneToken } from "./schema";
import {
  sceneConstraintFailures,
  solveSceneCompletion,
  type SceneConstraint,
} from "./constraint-engine";

const token = (shape: SceneToken["shape"], fill: SceneToken["fill"] = "outline"): SceneToken => ({
  kind: "token",
  shape,
  rotation: 0,
  fill,
  size: "l",
});

describe("constraint engine", () => {
  it("finds a unique completion and gives each distractor a failure witness", () => {
    const template: Scene = {
      kind: "scene",
      rows: 2,
      columns: 2,
      tiles: [],
      objects: [
        { row: 0, column: 0, object: token("circle") },
        { row: 0, column: 1, object: token("square") },
        { row: 1, column: 0, object: token("square") },
      ],
    };
    const constraints: SceneConstraint[] = [
      { kind: "allDifferent", axis: "row", index: 0, projection: "shape" },
      { kind: "allDifferent", axis: "row", index: 1, projection: "shape" },
      { kind: "allDifferent", axis: "column", index: 0, projection: "shape" },
      { kind: "allDifferent", axis: "column", index: 1, projection: "shape" },
      { kind: "exactCount", projection: "shape", value: "circle", count: 2 },
      { kind: "balancedRows" },
    ];
    const options: SceneObject[] = [token("circle"), token("square"), token("triangle"), token("star")];
    const result = solveSceneCompletion(template, { row: 1, column: 1 }, options, constraints);
    expect(result.unique).toBe(true);
    expect(result.answerIndex).toBe(0);
    for (const candidate of result.candidates.filter((candidate) => candidate.optionIndex !== 0)) {
      expect(candidate.failures.length).toBeGreaterThan(0);
    }
  });

  it("reports exact-count and paired-position failures", () => {
    const board: Scene = {
      kind: "scene",
      rows: 2,
      columns: 2,
      tiles: [],
      objects: [
        { row: 0, column: 0, object: token("circle", "solid") },
        { row: 1, column: 1, object: token("circle", "outline") },
      ],
    };
    const failures = sceneConstraintFailures(board, [
      { kind: "exactCount", projection: "fill", value: "solid", count: 2 },
      {
        kind: "paired",
        first: { row: 0, column: 0 },
        second: { row: 1, column: 1 },
        relation: "sameFill",
      },
    ]);
    expect(failures.map((failure) => failure.constraintIndex)).toEqual([0, 1]);
  });
});
