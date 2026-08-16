import { SceneSchema, type Scene, type SceneObject, type ScenePlacement, type SceneToken } from "./schema";
import type { ScenePosition } from "./scene-grammar";

export type ConstraintProjection = "shape" | "fill" | "size";

export type SceneConstraint =
  | { kind: "allDifferent"; axis: "row" | "column"; index: number; projection: ConstraintProjection }
  | { kind: "exactCount"; projection: ConstraintProjection; value: string; count: number }
  | { kind: "balancedRows" }
  | {
      kind: "paired";
      first: ScenePosition;
      second: ScenePosition;
      relation: "sameShape" | "differentShape" | "sameFill";
    }
  | { kind: "rotationalSymmetry" };

export interface ConstraintFailure {
  constraintIndex: number;
  message: string;
}

function tokenAt(scene: Scene, position: ScenePosition): SceneToken | null {
  const object = scene.objects.find((placement) =>
    placement.row === position.row && placement.column === position.column,
  )?.object;
  return object?.kind === "token" ? object : null;
}

function projected(token: SceneToken, projection: ConstraintProjection): string {
  return token[projection];
}

/** Return concrete, stable witnesses for every violated board constraint. */
export function sceneConstraintFailures(
  scene: Scene,
  constraints: readonly SceneConstraint[],
): ConstraintFailure[] {
  const failures: ConstraintFailure[] = [];
  constraints.forEach((constraint, constraintIndex) => {
    if (constraint.kind === "allDifferent") {
      const tokens = scene.objects
        .filter((placement) => constraint.axis === "row"
          ? placement.row === constraint.index
          : placement.column === constraint.index)
        .map((placement) => placement.object)
        .filter((object): object is SceneToken => object.kind === "token");
      const values = tokens.map((token) => projected(token, constraint.projection));
      if (values.length < 2 || new Set(values).size !== values.length) {
        failures.push({
          constraintIndex,
          message: `${constraint.axis} ${constraint.index + 1} repeats ${constraint.projection}`,
        });
      }
      return;
    }

    if (constraint.kind === "exactCount") {
      const actual = scene.objects.filter((placement) =>
        placement.object.kind === "token" &&
        projected(placement.object, constraint.projection) === constraint.value,
      ).length;
      if (actual !== constraint.count) {
        failures.push({
          constraintIndex,
          message: `expected ${constraint.count} ${constraint.projection}=${constraint.value}, found ${actual}`,
        });
      }
      return;
    }

    if (constraint.kind === "balancedRows") {
      const counts = Array.from({ length: scene.rows }, (_, row) =>
        scene.objects.filter((placement) => placement.row === row).length,
      );
      if (!counts.every((count) => count === counts[0])) {
        failures.push({ constraintIndex, message: `row counts are ${counts.join(", ")}` });
      }
      return;
    }

    if (constraint.kind === "rotationalSymmetry") {
      const placements = new Map(scene.objects.map((placement) => [
        `${placement.row}:${placement.column}`,
        JSON.stringify(placement.object),
      ]));
      const symmetric = scene.objects.every((placement) =>
        placements.get(`${scene.rows - 1 - placement.row}:${scene.columns - 1 - placement.column}`) ===
          JSON.stringify(placement.object),
      );
      if (!symmetric) failures.push({ constraintIndex, message: "board is not rotationally symmetric" });
      return;
    }

    const first = tokenAt(scene, constraint.first);
    const second = tokenAt(scene, constraint.second);
    const satisfied = first !== null && second !== null && (
      constraint.relation === "sameShape" ? first.shape === second.shape :
      constraint.relation === "differentShape" ? first.shape !== second.shape :
      first.fill === second.fill
    );
    if (!satisfied) {
      failures.push({
        constraintIndex,
        message: `paired positions do not satisfy ${constraint.relation}`,
      });
    }
  });
  return failures;
}

export function sceneSatisfiesConstraints(scene: Scene, constraints: readonly SceneConstraint[]): boolean {
  return sceneConstraintFailures(scene, constraints).length === 0;
}

function insertObject(scene: Scene, at: ScenePosition, object: SceneObject): Scene | null {
  if (scene.objects.some((placement) => placement.row === at.row && placement.column === at.column)) return null;
  const placement: ScenePlacement = { ...at, object };
  const parsed = SceneSchema.safeParse({ ...scene, objects: [...scene.objects, placement] });
  return parsed.success ? parsed.data : null;
}

export interface ConstraintCandidateResult {
  optionIndex: number;
  scene: Scene;
  failures: ConstraintFailure[];
}

/** Exhaustively test the finite answer domain for one missing board position. */
export function solveSceneCompletion(
  template: Scene,
  missing: ScenePosition,
  candidates: readonly SceneObject[],
  constraints: readonly SceneConstraint[],
): {
  unique: boolean;
  answerIndex: number | null;
  candidates: ConstraintCandidateResult[];
} {
  const evaluated = candidates.flatMap((candidate, optionIndex) => {
    const scene = insertObject(template, missing, candidate);
    return scene ? [{ optionIndex, scene, failures: sceneConstraintFailures(scene, constraints) }] : [];
  });
  const valid = evaluated.filter((candidate) => candidate.failures.length === 0);
  return {
    unique: valid.length === 1,
    answerIndex: valid.length === 1 ? valid[0].optionIndex : null,
    candidates: evaluated,
  };
}
