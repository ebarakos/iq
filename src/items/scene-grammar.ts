import {
  SceneSchema,
  sceneSignature,
  type Scene,
  type SceneObject,
  type ScenePlacement,
  type SceneToken,
} from "./schema";

/**
 * Bounded operations shared by scene sequences, analogies, machines, spatial
 * transforms, and set algebra. Every operation acts on visible board slots;
 * there are no hidden object identities or free-form coordinates.
 */
export type SceneUnaryOperation =
  | { kind: "translate"; rowDelta: -2 | -1 | 0 | 1 | 2; columnDelta: -2 | -1 | 0 | 1 | 2; wrap: boolean }
  | { kind: "reflect"; axis: "horizontal" | "vertical" }
  | { kind: "rotate"; quarterTurns: 1 | 2 | 3 }
  | { kind: "swap"; first: ScenePosition; second: ScenePosition }
  | { kind: "setFill"; fill: SceneToken["fill"] }
  | { kind: "contain"; at: ScenePosition; containerShape: "circle" | "square" | "diamond" | "hexagon" }
  | { kind: "uncontain"; at: ScenePosition }
  | { kind: "duplicate"; from: ScenePosition; to: ScenePosition }
  | { kind: "remove"; at: ScenePosition };

export type SceneBinaryOperation = "union" | "intersection" | "subtract" | "xor";

export interface ScenePosition {
  row: number;
  column: number;
}

/** Complete finite unary grammar for one declared board size. */
export function enumerateSceneUnaryOperations(rows: number, columns: number): SceneUnaryOperation[] {
  const operations: SceneUnaryOperation[] = [];
  for (const rowDelta of [-2, -1, 0, 1, 2] as const) {
    for (const columnDelta of [-2, -1, 0, 1, 2] as const) {
      if (rowDelta === 0 && columnDelta === 0) continue;
      operations.push({ kind: "translate", rowDelta, columnDelta, wrap: false });
      operations.push({ kind: "translate", rowDelta, columnDelta, wrap: true });
    }
  }
  operations.push(
    { kind: "reflect", axis: "horizontal" },
    { kind: "reflect", axis: "vertical" },
    { kind: "rotate", quarterTurns: 1 },
    { kind: "rotate", quarterTurns: 2 },
    { kind: "rotate", quarterTurns: 3 },
    { kind: "setFill", fill: "outline" },
    { kind: "setFill", fill: "half" },
    { kind: "setFill", fill: "solid" },
  );

  const positions: ScenePosition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) positions.push({ row, column });
  }
  for (const first of positions) {
    operations.push({ kind: "remove", at: first });
    operations.push({ kind: "uncontain", at: first });
    for (const containerShape of ["circle", "square", "diamond", "hexagon"] as const) {
      operations.push({ kind: "contain", at: first, containerShape });
    }
    for (const second of positions) {
      if (positionKey(first) === positionKey(second)) continue;
      operations.push({ kind: "swap", first, second });
      operations.push({ kind: "duplicate", from: first, to: second });
    }
  }
  return operations;
}

export type SceneExpression =
  | { op: "input"; index: 0 | 1 }
  | { op: "unary"; operation: SceneUnaryOperation; input: SceneExpression }
  | {
      op: "binary";
      operation: SceneBinaryOperation;
      left: SceneExpression;
      right: SceneExpression;
    };

export type SceneRelation =
  | { kind: "contains" }
  | { kind: "adjacent" }
  | { kind: "same"; attribute: "shape" | "fill" | "size" }
  | { kind: "different"; attribute: "shape" | "fill" | "size" }
  | { kind: "count"; comparison: "equal" | "ascendingRows" }
  | { kind: "symmetry"; axis: "horizontal" | "vertical" };

export type SceneConcept = { all: [SceneRelation] | [SceneRelation, SceneRelation] };

function positionKey(position: ScenePosition): string {
  return `${position.row}:${position.column}`;
}

function objectKey(object: SceneObject): string {
  return JSON.stringify(object);
}

function placementKey(placement: ScenePlacement): string {
  return `${positionKey(placement)}:${objectKey(placement.object)}`;
}

function normalize(scene: Scene): Scene | null {
  const candidate = {
    ...scene,
    objects: [...scene.objects].sort((a, b) => a.row - b.row || a.column - b.column),
    tiles: [...scene.tiles].sort((a, b) => a.row - b.row || a.column - b.column),
  };
  const parsed = SceneSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function mapPosition(
  scene: Scene,
  position: ScenePosition,
  operation: Extract<SceneUnaryOperation, { kind: "translate" | "reflect" | "rotate" }>,
): ScenePosition | null {
  if (operation.kind === "translate") {
    let row = position.row + operation.rowDelta;
    let column = position.column + operation.columnDelta;
    if (operation.wrap) {
      row = ((row % scene.rows) + scene.rows) % scene.rows;
      column = ((column % scene.columns) + scene.columns) % scene.columns;
    }
    return row >= 0 && row < scene.rows && column >= 0 && column < scene.columns
      ? { row, column }
      : null;
  }
  if (operation.kind === "reflect") {
    return operation.axis === "horizontal"
      ? { row: position.row, column: scene.columns - 1 - position.column }
      : { row: scene.rows - 1 - position.row, column: position.column };
  }
  if (scene.rows !== scene.columns) return null;
  let next = { ...position };
  for (let turn = 0; turn < operation.quarterTurns; turn++) {
    next = { row: next.column, column: scene.rows - 1 - next.row };
  }
  return next;
}

function transformPositions(
  scene: Scene,
  operation: Extract<SceneUnaryOperation, { kind: "translate" | "reflect" | "rotate" }>,
): Scene | null {
  const objects: ScenePlacement[] = [];
  for (const placement of scene.objects) {
    const position = mapPosition(scene, placement, operation);
    if (!position) return null;
    objects.push({ ...position, object: placement.object });
  }
  const tiles: Scene["tiles"] = [];
  for (const tile of scene.tiles) {
    const position = mapPosition(scene, tile, operation);
    if (!position) return null;
    const edgeMap = operation.kind === "reflect"
      ? operation.axis === "horizontal"
        ? { north: "north", east: "west", south: "south", west: "east" } as const
        : { north: "south", east: "east", south: "north", west: "west" } as const
      : operation.kind === "rotate"
        ? null
        : { north: "north", east: "east", south: "south", west: "west" } as const;
    let edges = [...tile.edges];
    if (edgeMap) {
      edges = edges.map((edge) => edgeMap[edge]);
    } else if (operation.kind === "rotate") {
      const order = ["north", "east", "south", "west"] as const;
      edges = edges.map((edge) => order[(order.indexOf(edge) + operation.quarterTurns) % order.length]);
    }
    edges.sort((a, b) => ["north", "east", "south", "west"].indexOf(a) - ["north", "east", "south", "west"].indexOf(b));
    tiles.push({ ...position, edges });
  }
  return normalize({ ...scene, objects, tiles });
}

/** Apply one visible unary transformation. Null means the operation is inapplicable. */
export function applySceneUnary(scene: Scene, operation: SceneUnaryOperation): Scene | null {
  if (operation.kind === "translate" || operation.kind === "reflect" || operation.kind === "rotate") {
    return transformPositions(scene, operation);
  }

  if (operation.kind === "setFill") {
    const paint = (object: SceneObject): SceneObject => object.kind === "token"
      ? { ...object, fill: operation.fill }
      : { ...object, contents: object.contents.map((token) => ({ ...token, fill: operation.fill })) };
    return normalize({
      ...scene,
      objects: scene.objects.map((placement) => ({ ...placement, object: paint(placement.object) })),
    });
  }

  const firstIndex = scene.objects.findIndex((placement) => positionKey(placement) === positionKey(
    operation.kind === "swap" ? operation.first : operation.kind === "duplicate" ? operation.from : operation.at,
  ));
  if (firstIndex === -1) return null;

  if (operation.kind === "contain") {
    const source = scene.objects[firstIndex];
    if (source.object.kind !== "token") return null;
    const objects = [...scene.objects];
    objects[firstIndex] = {
      ...source,
      object: { kind: "container", shape: operation.containerShape, contents: [source.object] },
    };
    return normalize({ ...scene, objects });
  }

  if (operation.kind === "uncontain") {
    const source = scene.objects[firstIndex];
    if (source.object.kind !== "container" || source.object.contents.length !== 1) return null;
    const objects = [...scene.objects];
    objects[firstIndex] = { ...source, object: source.object.contents[0] };
    return normalize({ ...scene, objects });
  }

  if (operation.kind === "remove") {
    return normalize({ ...scene, objects: scene.objects.filter((_, index) => index !== firstIndex) });
  }

  const target = operation.kind === "swap" ? operation.second : operation.to;
  const targetIndex = scene.objects.findIndex((placement) => positionKey(placement) === positionKey(target));
  if (operation.kind === "duplicate") {
    if (targetIndex !== -1 || scene.tiles.some((tile) => positionKey(tile) === positionKey(target))) return null;
    return normalize({
      ...scene,
      objects: [...scene.objects, { ...target, object: scene.objects[firstIndex].object }],
    });
  }
  if (targetIndex === -1) return null;
  const objects = [...scene.objects];
  const first = objects[firstIndex];
  const second = objects[targetIndex];
  objects[firstIndex] = { ...operation.first, object: second.object };
  objects[targetIndex] = { ...operation.second, object: first.object };
  return normalize({ ...scene, objects });
}

/** Combine aligned scenes through exact visible atoms. */
export function applySceneBinary(
  left: Scene,
  right: Scene,
  operation: SceneBinaryOperation,
): Scene | null {
  if (left.rows !== right.rows || left.columns !== right.columns || left.tiles.length || right.tiles.length) {
    return null;
  }
  const leftByPosition = new Map(left.objects.map((placement) => [positionKey(placement), placement]));
  const rightByPosition = new Map(right.objects.map((placement) => [positionKey(placement), placement]));
  const positions = new Set([...leftByPosition.keys(), ...rightByPosition.keys()]);
  const objects: ScenePlacement[] = [];
  for (const position of positions) {
    const l = leftByPosition.get(position);
    const r = rightByPosition.get(position);
    const same = l && r && objectKey(l.object) === objectKey(r.object);
    if (l && r && !same && (operation === "union" || operation === "xor")) return null;
    if (operation === "union" && (l || r)) objects.push((l ?? r)!);
    if (operation === "intersection" && same) objects.push(l!);
    if (operation === "subtract" && l && !same) objects.push(l);
    if (operation === "xor" && !same && Boolean(l) !== Boolean(r)) objects.push((l ?? r)!);
  }
  if (objects.length === 0) return null;
  return normalize({ kind: "scene", rows: left.rows, columns: left.columns, objects, tiles: [] });
}

export function sceneExpressionDepth(expression: SceneExpression): number {
  if (expression.op === "input") return 0;
  if (expression.op === "unary") return 1 + sceneExpressionDepth(expression.input);
  return 1 + Math.max(sceneExpressionDepth(expression.left), sceneExpressionDepth(expression.right));
}

export function applySceneExpression(expression: SceneExpression, inputs: readonly Scene[]): Scene | null {
  if (sceneExpressionDepth(expression) > 3) return null;
  if (expression.op === "input") return inputs[expression.index] ?? null;
  if (expression.op === "unary") {
    const input = applySceneExpression(expression.input, inputs);
    return input ? applySceneUnary(input, expression.operation) : null;
  }
  const left = applySceneExpression(expression.left, inputs);
  const right = applySceneExpression(expression.right, inputs);
  return left && right ? applySceneBinary(left, right, expression.operation) : null;
}

function topLevelTokens(scene: Scene): ScenePlacement[] {
  return scene.objects.filter((placement) => placement.object.kind === "token");
}

/** Evaluate one bounded, human-nameable relation over a scene. */
export function sceneSatisfiesRelation(scene: Scene, relation: SceneRelation): boolean {
  if (relation.kind === "contains") {
    return scene.objects.some((placement) => placement.object.kind === "container");
  }
  if (relation.kind === "symmetry") {
    const reflected = applySceneUnary(scene, { kind: "reflect", axis: relation.axis });
    return reflected !== null && sceneSignature(reflected) === sceneSignature(scene);
  }
  const tokens = topLevelTokens(scene);
  if (relation.kind === "adjacent") {
    return tokens.some((first, index) => tokens.slice(index + 1).some((second) =>
      Math.abs(first.row - second.row) + Math.abs(first.column - second.column) === 1,
    ));
  }
  if (relation.kind === "count") {
    const counts = Array.from({ length: scene.rows }, (_, row) => tokens.filter((token) => token.row === row).length);
    return relation.comparison === "equal"
      ? counts.every((count) => count === counts[0])
      : counts.every((count, index) => index === 0 || count > counts[index - 1]);
  }
  if (tokens.length < 2) return false;
  const values = tokens.map((placement) => placement.object.kind === "token" && placement.object[relation.attribute]);
  return relation.kind === "same"
    ? values.every((value) => value === values[0])
    : new Set(values).size === values.length;
}

export function sceneSatisfiesConcept(scene: Scene, concept: SceneConcept): boolean {
  return concept.all.every((relation) => sceneSatisfiesRelation(scene, relation));
}

export const SCENE_RELATION_GRAMMAR: readonly SceneRelation[] = [
  { kind: "contains" },
  { kind: "adjacent" },
  { kind: "same", attribute: "shape" },
  { kind: "same", attribute: "fill" },
  { kind: "same", attribute: "size" },
  { kind: "different", attribute: "shape" },
  { kind: "different", attribute: "fill" },
  { kind: "different", attribute: "size" },
  { kind: "count", comparison: "equal" },
  { kind: "count", comparison: "ascendingRows" },
  { kind: "symmetry", axis: "horizontal" },
  { kind: "symmetry", axis: "vertical" },
] as const;

/** Complete bounded concept grammar: one relation or a conjunction of two. */
export function enumerateSceneConcepts(): SceneConcept[] {
  const concepts: SceneConcept[] = SCENE_RELATION_GRAMMAR.map((relation) => ({ all: [relation] }));
  for (let left = 0; left < SCENE_RELATION_GRAMMAR.length; left++) {
    for (let right = left + 1; right < SCENE_RELATION_GRAMMAR.length; right++) {
      concepts.push({ all: [SCENE_RELATION_GRAMMAR[left], SCENE_RELATION_GRAMMAR[right]] });
    }
  }
  return concepts;
}

/** Programs are equivalent on evidence only when every visible output matches. */
export function sceneProgramFits(
  expression: SceneExpression,
  examples: readonly { inputs: readonly Scene[]; output: Scene }[],
): boolean {
  return examples.every((example) => {
    const output = applySceneExpression(expression, example.inputs);
    return output !== null && sceneSignature(output) === sceneSignature(example.output);
  });
}

/** Stable key used for fingerprints, deduplication, and diagnostics. */
export function sceneExpressionKey(expression: SceneExpression): string {
  if (expression.op === "input") return `input:${expression.index}`;
  if (expression.op === "unary") {
    return `unary:${JSON.stringify(expression.operation)}(${sceneExpressionKey(expression.input)})`;
  }
  return `${expression.operation}(${sceneExpressionKey(expression.left)},${sceneExpressionKey(expression.right)})`;
}

export function scenePlacementSignature(placement: ScenePlacement): string {
  return placementKey(placement);
}
