import { isSceneShapeOrientable, ROTATIONS } from "./domains";
import {
  areScenesCategoricallyDistinct,
  CONNECTION_EDGES,
  sceneSignature,
  SceneSchema,
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
  /**
   * Turn every orientable token on the spot, without moving it. `rotate` turns
   * the BOARD (positions and edges move); `turn` turns each token's own
   * orientation and leaves the layout alone — so a family can show the two as
   * different visible steps.
   */
  | { kind: "turn"; quarterTurns: 1 | 2 | 3 }
  | { kind: "swap"; first: ScenePosition; second: ScenePosition }
  | { kind: "setFill"; fill: SceneToken["fill"] }
  | { kind: "contain"; at: ScenePosition; containerShape: "circle" | "square" | "diamond" | "hexagon" }
  | { kind: "uncontain"; at: ScenePosition }
  | { kind: "duplicate"; from: ScenePosition; to: ScenePosition }
  | { kind: "remove"; at: ScenePosition };

/**
 * How two boards combine at each aligned position.
 *
 * Expanded from four operations to eight on 2026-08-27, on the owner's report
 * that the four made "too easy/toy" items. Two things were wrong with the
 * original set, and both came from the same cause — it could not say what to do
 * when the two boards held DIFFERENT tokens at one position:
 *
 * 1. `union` and `xor` simply refused such a draw (returned null), so the
 *    generator could only ever use input pairs that agreed wherever they
 *    overlapped. That is what made the boards look like toys: the interesting
 *    inputs were all being thrown away.
 * 2. `intersection` and `subtract` silently demanded identical tokens, so the
 *    solver was never asked whether identity mattered — it always did.
 *
 * Both are now dimensions the solver has to work out, which is difficulty from
 * the rule rather than from clutter:
 *
 * - **which token wins a clash** — `-left` takes the first board's, `-right`
 *   the second's. Only ever visible where the boards genuinely differ, so it is
 *   read off two clearly distinct shapes, never off a subtle margin.
 * - **whether identity counts** — `intersection` and `subtract` compare whole
 *   tokens; `overlap-*` and `mask-out` care only about occupancy.
 *
 * Every combination is total: no pair of boards is rejected any more, and the
 * only failure left is an output with nothing on it.
 */
export type SceneBinaryOperation =
  /** Every occupied position from either board; a clash takes the first board's token. */
  | "union-left"
  /** Every occupied position from either board; a clash takes the second board's token. */
  | "union-right"
  /** Positions where both boards hold the SAME token. Identity counts. */
  | "intersection"
  /** Positions where both boards hold any token; the first board's token survives. */
  | "overlap-left"
  /** Positions where both boards hold any token; the second board's token survives. */
  | "overlap-right"
  /** The first board's tokens, minus those the second board repeats exactly. */
  | "subtract"
  /** The first board's tokens, minus every position the second board occupies at all. */
  | "mask-out"
  /** Positions exactly one board occupies. */
  | "exclusive";

/**
 * The eight ways two boards combine. See `SceneBinaryOperation` for why this
 * doubled on 2026-08-27; the short version is that the old four could not say
 * what happens when the boards hold different tokens at one position, so the
 * generator threw away every input pair that disagreed and the survivors looked
 * like toys. The order is part of every seeded draw that picks from it.
 */
export const SCENE_BINARY_OPERATIONS = [
  "union-left",
  "union-right",
  "intersection",
  "overlap-left",
  "overlap-right",
  "subtract",
  "mask-out",
  "exclusive",
] as const satisfies readonly SceneBinaryOperation[];

export type SceneCompositionPrimitive =
  | {
      kind: "spatial";
      operation: Extract<SceneUnaryOperation, { kind: "rotate" | "reflect" }>;
    }
  | {
      kind: "setFillAt";
      at: ScenePosition;
      fill: "half" | "solid";
    }
  /**
   * Move every currently solid token one square in the declared direction,
   * simultaneously and without wrapping. Vacated squares are available to
   * other moving tokens; stationary collisions and off-board moves fail.
   * With no solid tokens the valid board is unchanged. Tiles and containers
   * are unsupported. This prototype gate is absent from the legacy pools.
   */
  | {
      kind: "moveSolid";
      direction: "up" | "right" | "down" | "left";
    }
  /**
   * Turn every orientable token a quarter clockwise (1) or anticlockwise (3),
   * without moving anything. This is the token-local twin of the `spatial`
   * step: `spatial` moves board slots and leaves each token's own orientation
   * alone, `turn` does exactly the opposite. A composed program that uses both
   * therefore asks the solver to track two independent visible changes rather
   * than one.
   *
   * A board with nothing orientable on it has no visible turn, and
   * `applySceneUnary` returns null for it — such a draw is rejected, never
   * served as a step that does nothing.
   */
  | {
      kind: "turn";
      quarterTurns: 1 | 3;
    };

/** A one-gate program: the gentlest machine table, one worked row (owner, 2026-10-15). */
export interface SceneSingleStepComposition {
  first: SceneCompositionPrimitive;
}

export interface SceneOrderedComposition {
  first: SceneCompositionPrimitive;
  second: SceneCompositionPrimitive;
}

export interface SceneOrderedThreeStepComposition {
  first: SceneCompositionPrimitive;
  second: SceneCompositionPrimitive;
  third: SceneCompositionPrimitive;
}

/** Any composed program a machine table displays: one, two or three gates. */
export type SceneComposedProgram =
  | SceneSingleStepComposition
  | SceneOrderedComposition
  | SceneOrderedThreeStepComposition;

/**
 * How many gates a composed program displays. Also its honest program depth.
 *
 * Never more than three: the owner's rule of 2026-08-27 is that a fourth gate
 * adds procedure, not reasoning. The four- and five-gate programs behind the
 * withdrawn d6 buckets were deleted on 2026-09-28.
 */
export type SceneComposedProgramLength = 1 | 2 | 3;

/** The gates of a composed program, in the order the query strip shows them. */
export function sceneComposedProgramSteps(program: SceneComposedProgram): SceneCompositionPrimitive[] {
  if ("third" in program) return [program.first, program.second, program.third];
  if ("second" in program) return [program.first, program.second];
  return [program.first];
}

/** Rebuild a composed program from its ordered gates. One, two or three. */
export function sceneComposedProgramFromSteps(
  steps: readonly SceneCompositionPrimitive[],
): SceneComposedProgram {
  if (steps.length === 1) return { first: steps[0] };
  if (steps.length === 2) return { first: steps[0], second: steps[1] };
  if (steps.length === 3) return { first: steps[0], second: steps[1], third: steps[2] };
  throw new Error(`a composed program shows one, two or three gates, not ${steps.length}`);
}

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
    { kind: "turn", quarterTurns: 1 },
    { kind: "turn", quarterTurns: 2 },
    { kind: "turn", quarterTurns: 3 },
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

function positionKey(position: ScenePosition): string {
  return `${position.row}:${position.column}`;
}

function objectKey(object: SceneObject): string {
  return JSON.stringify(object);
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

/** A wrong execution and the concrete mistake that produced its board. */
export interface SceneExecution {
  output: Scene | null;
  reason: string;
}

/**
 * Apply a supplied wrong execution to only part of the correct outcome.
 * These are partial executions, not claims that a whole grammar program
 * produced the mixed board. Shape groups include every copy, or its absence;
 * whole-group property copies require equal group sizes. Repeated symbols
 * can make individual mistakes, matching unchanged coordinates first. Two
 * shapes or two copies may follow different wrong executions independently;
 * no larger Cartesian products are built and no extra copies are invented.
 * Square copies include objects and tiles. Guides stay those of the correct board.
 *
 * Inputs are never changed, and outputs are unique, valid, visibly different
 * boards in deterministic execution/shape/property order.
 */
export function partialSceneExecutions(
  answer: Scene,
  executions: readonly SceneExecution[],
  model: "features" | "squares",
): { output: Scene; reason: string }[] {
  const canonicalToken = (value: SceneToken): SceneToken => ({
    ...value,
    // The schema uses zero for shapes without a readable orientation. Keep
    // malformed non-quarter turns malformed so validation still rejects them.
    rotation: !isSceneShapeOrientable(value.shape) && (ROTATIONS as readonly number[]).includes(value.rotation)
      ? 0 : value.rotation,
  });
  const canonical = (value: Scene): Scene | null => normalize({
    ...value,
    objects: value.objects.map((placement) => ({
      ...placement,
      object: placement.object.kind === "token"
        ? canonicalToken(placement.object)
        : { ...placement.object, contents: placement.object.contents.map(canonicalToken) },
    })),
    tiles: value.tiles.map((tile) => ({
      ...tile,
      edges: [...tile.edges].sort((left, right) => CONNECTION_EDGES.indexOf(left) - CONNECTION_EDGES.indexOf(right)),
    })),
  });
  const correct = canonical(answer);
  if (!correct) return [];
  const answerKey = sceneSignature(correct);
  const seen = new Set<string>([answerKey]);
  const results: { output: Scene; reason: string }[] = [];
  const collect = (candidate: Scene, reason: string) => {
    // Mixed boards inherit canonical primitives from the validated executions.
    // Reject occupied squares cheaply, then retain the full schema check.
    const occupied = new Set<string>();
    for (const entry of [...candidate.objects, ...candidate.tiles]) {
      const key = `${entry.row}:${entry.column}`;
      if (occupied.has(key)) return;
      occupied.add(key);
    }
    // A board already accepted (or the answer) needs no second schema parse.
    if (seen.has(sceneSignature(candidate))) return;
    const output = normalize(candidate);
    if (!output || !areScenesCategoricallyDistinct(correct, output)) return;
    const key = sceneSignature(output);
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ output, reason });
  };
  const group = (value: Scene, shape: SceneToken["shape"]) =>
    value.objects.filter((placement): placement is ScenePlacement & { object: SceneToken } =>
      placement.object.kind === "token" && placement.object.shape === shape);
  const alternatives = new Map<SceneToken["shape"], Map<string, { placements: ScenePlacement[]; reason: string }>>();
  const collectGroup = (shape: SceneToken["shape"], placements: ScenePlacement[], reason: string) => {
    const originalGroup = { ...correct, objects: group(correct, shape), tiles: [], guides: undefined };
    const local = { ...originalGroup, objects: placements };
    if (!areScenesCategoricallyDistinct(originalGroup, local)) return;
    const key = sceneSignature(local);
    let choices = alternatives.get(shape);
    if (!choices) {
      choices = new Map();
      alternatives.set(shape, choices);
    }
    if (choices.has(key)) return;
    choices.set(key, { placements, reason });
    const others = correct.objects.filter((placement) =>
      placement.object.kind !== "token" || placement.object.shape !== shape);
    collect({ ...correct, objects: [...others, ...placements] }, reason);
  };

  const symbols = new Map<string, {
    shape: SceneToken["shape"];
    index: number;
    choices: Map<string, { placement: ScenePlacement | null; reason: string }>;
  }>();
  const collectSymbol = (shape: SceneToken["shape"], index: number, placement: ScenePlacement | null, reason: string) => {
    const original = group(correct, shape);
    const before = { ...correct, objects: [original[index]], tiles: [], guides: undefined };
    const after = { ...before, objects: placement ? [placement] : [] };
    if (!areScenesCategoricallyDistinct(before, after)) return;
    const id = `${shape}:${index}`;
    let symbol = symbols.get(id);
    if (!symbol) {
      symbol = { shape, index, choices: new Map() };
      symbols.set(id, symbol);
    }
    const key = sceneSignature(after);
    if (symbol.choices.has(key)) return;
    symbol.choices.set(key, { placement, reason });
    collectGroup(shape, original.flatMap((entry, at) => at === index ? (placement ? [placement] : []) : [entry]), reason);
  };

  const seenExecutions = new Set<string>();
  for (const execution of executions) {
    if (!execution.output || execution.reason.trim().length === 0) continue;
    const wrong = canonical(execution.output);
    if (!wrong || wrong.rows !== correct.rows || wrong.columns !== correct.columns) continue;
    // Identical boards produce identical partial mistakes. Keep the first
    // real execution's reason, without repeating every property and copy.
    const wrongKey = sceneSignature(wrong);
    if (seenExecutions.has(wrongKey)) continue;
    seenExecutions.add(wrongKey);
    if (model === "squares") {
      for (let row = 0; row < correct.rows; row++) {
        for (let column = 0; column < correct.columns; column++) {
          const at = (entry: ScenePosition) => entry.row === row && entry.column === column;
          collect({
            ...correct,
            objects: [...correct.objects.filter((entry) => !at(entry)), ...wrong.objects.filter(at)],
            tiles: [...correct.tiles.filter((entry) => !at(entry)), ...wrong.tiles.filter(at)],
          }, `${execution.reason}; applies that mistake only at square (${row + 1}, ${column + 1})`);
        }
      }
      continue;
    }

    const shapes = [...new Set([...correct.objects, ...wrong.objects].flatMap((placement) =>
      placement.object.kind === "token" ? [placement.object.shape] : []))].sort();
    for (const shape of shapes) {
      const rightGroup = group(correct, shape);
      const wrongGroup = group(wrong, shape);
      collectGroup(shape, wrongGroup,
        `${execution.reason}; applies that mistake only to the ${shape} group`);
      if (rightGroup.length > 1) {
        // Match unchanged cells first: the centre copy remains the centre
        // copy even when an outer token's wrong move changes reading order.
        const used = new Set<number>();
        const sources = rightGroup.map((placement) => {
          const at = wrongGroup.findIndex((source, index) => !used.has(index) &&
            source.row === placement.row && source.column === placement.column);
          if (at < 0) return null;
          used.add(at);
          return wrongGroup[at];
        });
        const unmatched = wrongGroup.filter((_, index) => !used.has(index));
        for (let index = 0; index < rightGroup.length; index++) {
          if (!sources[index]) sources[index] = unmatched.shift() ?? null;
          const source = sources[index];
          const original = rightGroup[index];
          const where = `${shape} at square (${original.row + 1}, ${original.column + 1})`;
          if (!source) {
            collectSymbol(shape, index, null, `${execution.reason}; omits only the ${where}`);
            continue;
          }
          collectSymbol(shape, index, source, `${execution.reason}; applies that mistake only to the ${where}`);
          collectSymbol(shape, index, { ...original, row: source.row, column: source.column },
            `${execution.reason}; applies only its position mistake to the ${where}`);
          collectSymbol(shape, index, { ...original, object: { ...original.object, fill: source.object.fill } },
            `${execution.reason}; applies only its fill mistake to the ${where}`);
          collectSymbol(shape, index, { ...original, object: { ...original.object, rotation: source.object.rotation } },
            `${execution.reason}; applies only its direction mistake to the ${where}`);
        }
      }
      if (rightGroup.length !== wrongGroup.length) continue;
      for (const property of ["positions", "fills", "directions"] as const) {
        const replacements = rightGroup.map((placement, index) => {
          const source = wrongGroup[index];
          return property === "positions"
            ? { ...placement, row: source.row, column: source.column }
            : {
                ...placement,
                object: {
                  ...placement.object,
                  ...(property === "fills" ? { fill: source.object.fill } : { rotation: source.object.rotation }),
                },
              };
        });
        collectGroup(shape, replacements,
          `${execution.reason}; applies only its ${shape} ${property}`);
      }
    }
  }
  // A globally wrong move/fill changes every shape together. Combining two
  // local outcomes from different executions breaks that correlation while
  // preserving a concrete explanation for each mistake. Store even a local
  // outcome that collided alone: changing the other shape may free its square.
  const shapes = [...alternatives.keys()].sort();
  for (let first = 0; first < shapes.length; first++) {
    for (let second = first + 1; second < shapes.length; second++) {
      const leftShape = shapes[first];
      const rightShape = shapes[second];
      const others = correct.objects.filter((placement) => placement.object.kind !== "token" ||
        (placement.object.shape !== leftShape && placement.object.shape !== rightShape));
      for (const left of alternatives.get(leftShape)!.values()) {
        for (const right of alternatives.get(rightShape)!.values()) {
          collect({ ...correct, objects: [...others, ...left.placements, ...right.placements] },
            `${left.reason}; also ${right.reason}`);
        }
      }
    }
  }
  // Two copies of the same shape can make independent mistakes too. Pair
  // their deduplicated local outcomes, without a larger copy-wise product.
  const copies = [...symbols.values()];
  for (let first = 0; first < copies.length; first++) {
    for (let second = first + 1; second < copies.length; second++) {
      const left = copies[first];
      const right = copies[second];
      if (left.shape !== right.shape) continue;
      const original = group(correct, left.shape);
      const others = correct.objects.filter((placement) => placement.object.kind !== "token" || placement.object.shape !== left.shape);
      for (const leftChoice of left.choices.values()) {
        for (const rightChoice of right.choices.values()) {
          const placements = original.flatMap((placement, index) => {
            const chosen = index === left.index ? leftChoice.placement
              : index === right.index ? rightChoice.placement : placement;
            return chosen ? [chosen] : [];
          });
          collect({ ...correct, objects: [...others, ...placements] },
            `${leftChoice.reason}; also ${rightChoice.reason}`);
        }
      }
    }
  }
  return results;
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

  if (operation.kind === "turn") {
    const degrees = operation.quarterTurns * 90;
    let turned = false;
    const spin = (token: SceneToken): SceneToken => {
      if (!isSceneShapeOrientable(token.shape)) return token;
      turned = true;
      return { ...token, rotation: (token.rotation + degrees) % 360 };
    };
    const objects = scene.objects.map((placement) => ({
      ...placement,
      object: placement.object.kind === "token"
        ? spin(placement.object)
        : { ...placement.object, contents: placement.object.contents.map(spin) },
    }));
    // A scene with nothing to turn makes the step invisible. An inapplicable
    // operation must be a rejectable draw, never a silent no-op.
    return turned ? normalize({ ...scene, objects }) : null;
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

/** Apply one primitive whose effect can be demonstrated in a visible worked row. */
export function applySceneCompositionPrimitive(
  input: Scene,
  primitive: SceneCompositionPrimitive,
): Scene | null {
  if (primitive.kind === "spatial") return applySceneUnary(input, primitive.operation);
  if (primitive.kind === "turn") {
    return applySceneUnary(input, { kind: "turn", quarterTurns: primitive.quarterTurns });
  }
  if (primitive.kind === "moveSolid") {
    if (input.tiles.length || input.objects.some(({ object }) => object.kind !== "token")) return null;
    const source = normalize(input);
    if (!source) return null;
    const rowDelta = primitive.direction === "up" ? -1 : primitive.direction === "down" ? 1 : 0;
    const columnDelta = primitive.direction === "left" ? -1 : primitive.direction === "right" ? 1 : 0;
    const objects = source.objects.map((placement) =>
      placement.object.kind === "token" && placement.object.fill === "solid"
        ? { ...placement, row: placement.row + rowDelta, column: placement.column + columnDelta }
        : placement);
    return normalize({ ...source, objects });
  }
  const sourceIndex = input.objects.findIndex((placement) =>
    placement.row === primitive.at.row && placement.column === primitive.at.column);
  const source = input.objects[sourceIndex];
  if (!source || source.object.kind !== "token" || source.object.fill === primitive.fill) return null;
  const objects = [...input.objects];
  objects[sourceIndex] = {
    ...source,
    object: { ...source.object, fill: primitive.fill },
  };
  return normalize({ ...input, objects });
}

/**
 * The shared primitive pool every composed scene family draws from.
 *
 * `spatial` moves board slots. `attribute` and `turn` are token-local: they
 * change what a token looks like and leave the layout alone. The two turn
 * primitives joined the pool on 2026-08-25 (escalate-the-quiz, Phase 3), which
 * is what lets a composed program show two independent visible changes — a
 * board that moved and tokens that rotated on the spot — instead of one.
 */
export function sceneCompositionPrimitivePool(): {
  spatial: SceneCompositionPrimitive[];
  attribute: SceneCompositionPrimitive[];
  turn: SceneCompositionPrimitive[];
} {
  return {
    spatial: [
      { kind: "spatial", operation: { kind: "rotate", quarterTurns: 1 } },
      { kind: "spatial", operation: { kind: "rotate", quarterTurns: 3 } },
      { kind: "spatial", operation: { kind: "reflect", axis: "horizontal" } },
      { kind: "spatial", operation: { kind: "reflect", axis: "vertical" } },
    ],
    attribute: [
      { kind: "setFillAt", at: { row: 0, column: 0 }, fill: "half" },
      { kind: "setFillAt", at: { row: 0, column: 0 }, fill: "solid" },
    ],
    turn: [
      { kind: "turn", quarterTurns: 1 },
      { kind: "turn", quarterTurns: 3 },
    ],
  };
}

/** Every primitive a composed program may use, in one flat list. */
export function sceneComposedPrimitives(): SceneCompositionPrimitive[] {
  const { spatial, attribute, turn } = sceneCompositionPrimitivePool();
  return [...spatial, ...attribute, ...turn];
}

/**
 * Is this ordered list of gates a program the composed grammar contains?
 *
 * The two-gate grammar is deliberately narrower: one board move and one fill
 * change, in either order. Those are the 16 pairs for which reversing the two
 * worked transformations visibly changes the canonical query. Pairs of two
 * board moves collapse into one spatial operation, while turns commute with
 * both board moves and fills on this board.
 *
 * Longer programs follow three rules, each removing programs whose displayed
 * gates cannot all matter:
 *
 *  - the gates are distinct, so no two worked rows demonstrate the same thing;
 *  - they are not all board moves — rotations and reflections compose to one
 *    spatial move, so an all-spatial program can collapse into a single gate
 *    and never changes anything token-local; and
 *  - at most one of them is a turn. The two turns are a quarter clockwise and a
 *    quarter anticlockwise, so a program holding both leaves every orientation
 *    exactly as it found it. Single-gate ablation cannot see that, because with
 *    one turn removed the other one does change the answer.
 *
 * Everything else is left to a family's own servability and ablation filters.
 * Nothing longer than three gates is a program at all (see
 * `SceneComposedProgramLength`).
 */
export function isSceneComposedProgram(steps: readonly SceneCompositionPrimitive[]): boolean {
  // One gate is any primitive: its single worked row is the whole rule.
  if (steps.length === 1) return true;
  if (steps.length !== 2 && steps.length !== 3) return false;
  const keys = steps.map((primitive) => JSON.stringify(primitive));
  if (new Set(keys).size !== keys.length) return false;
  if (steps.length === 2) {
    return steps.filter((primitive) => primitive.kind === "spatial").length === 1 &&
      steps.filter((primitive) => primitive.kind === "setFillAt").length === 1;
  }
  if (steps.every((primitive) => primitive.kind === "spatial")) return false;
  return steps.filter((primitive) => primitive.kind === "turn").length <= 1;
}

/** Every ordered program of `steps` gates the composed grammar contains. */
function enumerateComposedPrograms(steps: SceneComposedProgramLength): SceneCompositionPrimitive[][] {
  const pool = sceneComposedPrimitives();
  const programs: SceneCompositionPrimitive[][] = [];
  const walk = (chosen: SceneCompositionPrimitive[]) => {
    if (chosen.length === steps) {
      if (isSceneComposedProgram(chosen)) programs.push([...chosen]);
      return;
    }
    for (const primitive of pool) {
      chosen.push(primitive);
      walk(chosen);
      chosen.pop();
    }
  };
  walk([]);
  return programs;
}

/** Complete small grammar used by composed scene families. */
export function enumerateSceneOrderedCompositions(): SceneOrderedComposition[] {
  const { spatial, attribute } = sceneCompositionPrimitivePool();
  return spatial.flatMap((spatialPrimitive) => attribute.flatMap((attributePrimitive) => [
    { first: spatialPrimitive, second: attributePrimitive },
    { first: attributePrimitive, second: spatialPrimitive },
  ]));
}

/** Every one-gate program: each primitive on its own. */
export function enumerateSceneSingleStepCompositions(): SceneSingleStepComposition[] {
  return enumerateComposedPrograms(1).map((steps) => ({ first: steps[0] }));
}

/** Every ordered triple of distinct primitives that is not three board moves. */
export function enumerateSceneOrderedThreeStepCompositions(): SceneOrderedThreeStepComposition[] {
  return enumerateComposedPrograms(3)
    .map((steps) => ({ first: steps[0], second: steps[1], third: steps[2] }));
}

/** Run a composed program of either length, left to right. */
export function applySceneComposedProgram(input: Scene, program: SceneComposedProgram): Scene | null {
  let value: Scene | null = input;
  for (const step of sceneComposedProgramSteps(program)) {
    value = value && applySceneCompositionPrimitive(value, step);
  }
  return value;
}

/** Stable key for a composed program of either length. */
export function sceneComposedProgramKey(program: SceneComposedProgram): string {
  return JSON.stringify(program);
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
    const same = Boolean(l && r && objectKey(l.object) === objectKey(r.object));
    switch (operation) {
      case "union-left": if (l || r) objects.push((l ?? r)!); break;
      case "union-right": if (l || r) objects.push((r ?? l)!); break;
      case "intersection": if (same) objects.push(l!); break;
      case "overlap-left": if (l && r) objects.push(l); break;
      case "overlap-right": if (l && r) objects.push(r); break;
      case "subtract": if (l && !same) objects.push(l); break;
      case "mask-out": if (l && !r) objects.push(l); break;
      case "exclusive": if (Boolean(l) !== Boolean(r)) objects.push((l ?? r)!); break;
    }
  }
  if (objects.length === 0) return null;
  return normalize({ kind: "scene", rows: left.rows, columns: left.columns, objects, tiles: [] });
}
