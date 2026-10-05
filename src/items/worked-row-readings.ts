/**
 * The readings a person might give a worked row, and the check that none of
 * them leads a question to a wrong option (docs/plans/one-reading-per-worked-row.md).
 *
 * The owner's rule is that no hidden convention may decide an answer. A worked
 * row breaks it when a second natural reading reproduces the row as well as the
 * rule and then leads the question to a wrong option. Two agent tests on
 * 2026-10-04 found four such readings, each costing answers. This module tries
 * the readings a person reaches for on every worked row of the machine families
 * and set algebra:
 *
 *  - the eight flips and turns of the board, moving squares only, and as a
 *    picture, where a mirror turns arrows and triangles round too;
 *  - a flip or turn before or after the change the row shows;
 *  - token turns, of every arrow and triangle or of one kind only;
 *  - fill changes: on one square, on one square unless it holds an arrow, on
 *    every shape, on every shape but the arrows, and on every shape of one
 *    kind, wherever it stands;
 *  - copies of every shape one square the same way;
 *  - for set algebra, either board first, and every shape sliding one square,
 *    wrapping round the edge.
 *
 * The combining machine was read here too, its pieces and its chains, until it
 * was retired on 2026-10-05.
 *
 * `families:verify` fails a bucket when any of its items has a reading that
 * every worked row allows and that lands on a wrong option.
 *
 * Not tried, on purpose: "the fill piece colours the shape that started in its
 * square, wherever it has moved". For one piece it is the rule itself; in a
 * chain it gives the board the pieces give in the wrong order, which composed
 * transform offers on purpose as its sharpest near miss.
 */
import { isSceneShapeOrientable, SCENE_SHAPES } from "./domains";
import {
  applySceneBinary,
  applySceneCompositionPrimitive,
  applySceneUnary,
  enumerateSceneUnaryOperations,
  SCENE_BINARY_OPERATIONS,
  sceneComposedPrimitives,
} from "./scene-grammar";
import type { Scene, SceneObject, ScenePlacement, SceneToken } from "./schema";

/** One way to read a worked row: a name in the taker's words, and what it does. */
export interface WorkedRowReading {
  name: string;
  apply: (board: Scene) => Scene | null;
}

/** A reading every worked row allows that lands the question on a wrong option. */
export interface SecondReading {
  /** The reading, gate by gate in the order the question runs them, or the whole rule. */
  reading: string;
  /** The wrong option it lands on: an index into the puzzle's options. */
  option: number;
}

/** The families whose worked rows this check reads. */
export const READING_CHECKED_FAMILIES = [
  "composed-transform-v2",
  "transformation-machine-v3",
  "visual-set-algebra-v2",
] as const;
export type ReadingCheckedFamily = (typeof READING_CHECKED_FAMILIES)[number];

export function isReadingCheckedFamily(familyId: string): familyId is ReadingCheckedFamily {
  return (READING_CHECKED_FAMILIES as readonly string[]).includes(familyId);
}

/** The parts of a puzzle the check reads. */
export interface ReadablePuzzle {
  stem: readonly unknown[];
  options: readonly unknown[];
  answerIndex: number;
}

/** A JSON string with sorted keys, so two equal objects always print alike. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Equal for two boards that draw alike, whatever order their objects are listed in. */
export function boardKey(board: Scene): string {
  const objects = board.objects.map((placement) => `${placement.row},${placement.column}:${stable(placement.object)}`).sort();
  const tiles = board.tiles.map((tile) => stable(tile)).sort();
  return `${board.rows}x${board.columns}|${objects.join(" ")}|${tiles.join(" ")}`;
}

/**
 * A flip or turn of the 3 x 3 board as a matrix on offsets from the centre
 * square: (x, y) becomes (a x + b y, c x + d y), x to the right, y down.
 */
interface BoardSymmetry {
  name: string;
  matrix: readonly [number, number, number, number];
}

const BOARD_SYMMETRIES: readonly BoardSymmetry[] = [
  { name: "a quarter turn clockwise", matrix: [0, -1, 1, 0] },
  { name: "a half turn", matrix: [-1, 0, 0, -1] },
  { name: "a quarter turn anticlockwise", matrix: [0, 1, -1, 0] },
  { name: "a top-bottom flip", matrix: [1, 0, 0, -1] },
  { name: "a left-right mirror", matrix: [-1, 0, 0, 1] },
  { name: "a flip across the top-left diagonal", matrix: [0, 1, 1, 0] },
  { name: "a flip across the top-right diagonal", matrix: [0, -1, -1, 0] },
];

/** Where each quarter-turn rotation points, as an offset: 0 is up, clockwise from there. */
const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, -1],
  [90, 1, 0],
  [180, 0, 1],
  [270, -1, 0],
];

const ORIENTABLE_KINDS = {
  "every arrow and triangle": (token: SceneToken) => isSceneShapeOrientable(token.shape),
  "the arrows": (token: SceneToken) => token.shape === "arrow",
  "the triangles": (token: SceneToken) => token.shape === "triangle",
} as const;

function isSquareBoard(board: Scene): boolean {
  return board.rows === 3 && board.columns === 3 && board.tiles.length === 0;
}

function mapTokens(object: SceneObject, change: (token: SceneToken) => SceneToken): SceneObject {
  return object.kind === "token" ? change(object) : { ...object, contents: object.contents.map(change) };
}

function pointed(token: SceneToken, matrix: BoardSymmetry["matrix"]): SceneToken {
  if (!isSceneShapeOrientable(token.shape)) return token;
  const [, x, y] = DIRECTIONS.find(([rotation]) => rotation === token.rotation) ?? DIRECTIONS[0];
  const nx = matrix[0] * x + matrix[1] * y;
  const ny = matrix[2] * x + matrix[3] * y;
  const rotation = DIRECTIONS.find(([, dx, dy]) => dx === nx && dy === ny)![0];
  return { ...token, rotation };
}

/** Move every shape by the symmetry; `asPicture` also turns arrows and triangles with the board. */
function moveBoard(board: Scene, symmetry: BoardSymmetry, asPicture: boolean): Scene | null {
  if (!isSquareBoard(board)) return null;
  const [a, b, c, d] = symmetry.matrix;
  return {
    ...board,
    objects: board.objects.map((placement): ScenePlacement => {
      const x = placement.column - 1;
      const y = placement.row - 1;
      return {
        row: c * x + d * y + 1,
        column: a * x + b * y + 1,
        object: asPicture ? mapTokens(placement.object, (token) => pointed(token, symmetry.matrix)) : placement.object,
      };
    }),
  };
}

function turnTokens(board: Scene, quarterTurns: number, which: (token: SceneToken) => boolean): Scene {
  return {
    ...board,
    objects: board.objects.map((placement) => ({
      ...placement,
      object: mapTokens(placement.object, (token) => (which(token)
        ? { ...token, rotation: (token.rotation + quarterTurns * 90) % 360 }
        : token)),
    })),
  };
}

function fillTokens(board: Scene, fill: SceneToken["fill"], where: (placement: ScenePlacement, token: SceneToken) => boolean): Scene {
  return {
    ...board,
    objects: board.objects.map((placement) => ({
      ...placement,
      object: mapTokens(placement.object, (token) => (where(placement, token) ? { ...token, fill } : token)),
    })),
  };
}

/** Copy every shape one square the same way; copies off the board or onto a shape are left out. */
function copyEvery(board: Scene, rowStep: number, columnStep: number): Scene | null {
  if (!isSquareBoard(board)) return null;
  const taken = new Set(board.objects.map((placement) => `${placement.row},${placement.column}`));
  const copies: ScenePlacement[] = [];
  for (const placement of board.objects) {
    const row = placement.row + rowStep;
    const column = placement.column + columnStep;
    if (row < 0 || row > 2 || column < 0 || column > 2 || taken.has(`${row},${column}`)) continue;
    taken.add(`${row},${column}`);
    copies.push({ row, column, object: placement.object });
  }
  return copies.length === 0 ? null : { ...board, objects: [...board.objects, ...copies] };
}

const SQUARES = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
const FILL_WORDS: Readonly<Record<SceneToken["fill"], string>> = { outline: "white", half: "grey", solid: "black" };
const STEP_WORDS: ReadonlyArray<readonly [number, number, string]> = [
  [-1, 0, "up"], [1, 0, "down"], [0, -1, "left"], [0, 1, "right"],
  [-1, -1, "up and left"], [-1, 1, "up and right"], [1, -1, "down and left"], [1, 1, "down and right"],
];

/** The flips and turns of the board: moving squares only, then as a whole picture. */
const MOVE_READINGS: readonly WorkedRowReading[] = [
  ...BOARD_SYMMETRIES.map((symmetry) => ({
    name: `${symmetry.name} of the squares`,
    apply: (board: Scene) => moveBoard(board, symmetry, false),
  })),
  ...BOARD_SYMMETRIES.map((symmetry) => ({
    name: `${symmetry.name} of the whole picture, arrows and triangles turning with it`,
    apply: (board: Scene) => moveBoard(board, symmetry, true),
  })),
];

/** Every arrow and triangle, or one kind of them, turning in its own square. */
const TURN_READINGS: readonly WorkedRowReading[] = [1, 2, 3].flatMap((quarterTurns) =>
  Object.entries(ORIENTABLE_KINDS).map(([kind, which]) => ({
    name: `${kind} turning ${quarterTurns} quarter${quarterTurns > 1 ? "s" : ""} clockwise`,
    apply: (board: Scene) => turnTokens(board, quarterTurns, which),
  })));

/** Every shape sliding one square the same way, wrapping round the edge. */
function slideEvery(board: Scene, rowStep: number, columnStep: number): Scene | null {
  if (!isSquareBoard(board)) return null;
  return {
    ...board,
    objects: board.objects.map((placement) => ({
      ...placement,
      row: (placement.row + rowStep + 3) % 3,
      column: (placement.column + columnStep + 3) % 3,
    })),
  };
}

/**
 * The one-square slides spatial transform shows, wrapping round the edge. Set
 * algebra reads them: Codex's review of 2026-10-05 found a d5 item whose rows
 * both fit "keep the right board's shapes where the left board is empty, slide
 * them one square left, turn them a quarter", and which offered that board.
 */
const SLIDE_READINGS: readonly WorkedRowReading[] = STEP_WORDS.slice(0, 4).map(([rowStep, columnStep, words]) => ({
  name: `every shape sliding one square ${words}, wrapping round the edge`,
  apply: (board: Scene) => slideEvery(board, rowStep, columnStep),
}));

/** The readings that do not depend on a family's own vocabulary. */
const GENERAL_READINGS: readonly WorkedRowReading[] = [
  ...MOVE_READINGS,
  ...TURN_READINGS,
  ...(["outline", "half", "solid"] as const).flatMap((fill) => [
    { name: `every shape turning ${FILL_WORDS[fill]}`, apply: (board: Scene) => fillTokens(board, fill, () => true) },
    {
      name: `every shape but the arrows turning ${FILL_WORDS[fill]}`,
      apply: (board: Scene) => fillTokens(board, fill, (_, token) => token.shape !== "arrow"),
    },
    // Both models' one miss in the v23 re-run: the fill example coloured a star,
    // the question started with a star in that square, and "colour the star"
    // fitted as well as "colour the top-left square".
    ...SCENE_SHAPES.map((shape) => ({
      name: `every ${shape} turning ${FILL_WORDS[fill]}, wherever it stands`,
      apply: (board: Scene) => fillTokens(board, fill, (_, token) => token.shape === shape),
    })),
    ...SQUARES.flatMap((square) => [
      {
        name: `the shape on square ${square.row},${square.column} turning ${FILL_WORDS[fill]}`,
        apply: (board: Scene) => fillTokens(board, fill, (placement) =>
          placement.row === square.row && placement.column === square.column),
      },
      {
        name: `the shape on square ${square.row},${square.column} turning ${FILL_WORDS[fill]}, never an arrow`,
        apply: (board: Scene) => fillTokens(board, fill, (placement, token) =>
          placement.row === square.row && placement.column === square.column && token.shape !== "arrow"),
      },
    ]),
  ]),
  ...STEP_WORDS.map(([rowStep, columnStep, words]) => ({
    name: `every shape copied one square ${words}`,
    apply: (board: Scene) => copyEvery(board, rowStep, columnStep),
  })),
];

function fits(reading: WorkedRowReading, input: Scene, output: Scene): boolean {
  const result = reading.apply(input);
  return result !== null && boardKey(result) === boardKey(output);
}

/**
 * Every reading of one worked row: the family's own operations and the general
 * ones that reproduce it, then each flip or turn of the board before or after a
 * fitting operation of the family.
 */
export function readingsOfWorkedRow(
  input: Scene,
  output: Scene,
  vocabulary: readonly WorkedRowReading[],
): WorkedRowReading[] {
  const own = vocabulary.filter((reading) => fits(reading, input, output));
  const general = GENERAL_READINGS.filter((reading) => fits(reading, input, output));
  const around = own.flatMap((reading) => BOARD_SYMMETRIES.flatMap((symmetry) => [
    {
      name: `${symmetry.name} of the squares, then ${reading.name}`,
      apply: (board: Scene) => {
        const moved = moveBoard(board, symmetry, false);
        return moved && reading.apply(moved);
      },
    },
    {
      name: `${reading.name}, then ${symmetry.name} of the squares`,
      apply: (board: Scene) => {
        const changed = reading.apply(board);
        return changed && moveBoard(changed, symmetry, false);
      },
    },
  ])).filter((reading) => fits(reading, input, output));
  return [...own, ...general, ...around];
}

const COMPOSED_VOCABULARY: readonly WorkedRowReading[] = sceneComposedPrimitives().map((primitive) => ({
  name: `the shown step ${stable(primitive)}`,
  apply: (board: Scene) => applySceneCompositionPrimitive(board, primitive),
}));

const MACHINE_VOCABULARY: readonly WorkedRowReading[] = enumerateSceneUnaryOperations(3, 3).map((operation) => ({
  name: `the shown step ${stable(operation)}`,
  apply: (board: Scene) => applySceneUnary(board, operation),
}));

/**
 * Every reading of one worked row of a machine family: its own gates, the
 * general readings, and flips or turns around a fitting gate. A sound worked
 * row has exactly one.
 */
export function machineWorkedRowReadings(
  familyId: "composed-transform-v2" | "transformation-machine-v3",
  input: Scene,
  output: Scene,
): WorkedRowReading[] {
  return readingsOfWorkedRow(input, output, familyId === "composed-transform-v2" ? COMPOSED_VOCABULARY : MACHINE_VOCABULARY);
}

/** Readings of a whole chain are tried up to this many; a real item has far fewer. */
const MAX_CHAIN_READINGS = 20_000;

function scenesOf(values: readonly unknown[]): Scene[] | null {
  return values.every((value) => value !== null && typeof value === "object" && (value as Scene).kind === "scene")
    ? (values as Scene[])
    : null;
}

/** Machine tables: worked rows of input, gate, output, then the query, its gate strip and the blank. */
function machineSecondReadings(puzzle: ReadablePuzzle, vocabulary: readonly WorkedRowReading[]): SecondReading[] {
  const stem = puzzle.stem;
  if (stem.length < 6 || stem.length % 3 !== 0) return [];
  const rows: { gateKey: string; readings: WorkedRowReading[] }[] = [];
  for (let row = 0; row < stem.length / 3 - 1; row++) {
    const scenes = scenesOf(stem.slice(row * 3, row * 3 + 3));
    if (!scenes) return [];
    const [input, gate, output] = scenes;
    if (gate.objects.length !== 1) return [];
    rows.push({ gateKey: stable(gate.objects[0].object), readings: readingsOfWorkedRow(input, output, vocabulary) });
  }
  const query = scenesOf([stem[stem.length - 3], stem[stem.length - 2]]);
  const options = scenesOf(puzzle.options);
  if (!query || !options) return [];
  const [queryBoard, strip] = query;
  const chain = [...strip.objects]
    .sort((left, right) => left.column - right.column)
    .map((placement) => rows.find((row) => row.gateKey === stable(placement.object)));
  if (chain.some((row) => row === undefined)) return [];
  const optionKeys = options.map(boardKey);
  const found = new Map<number, string>();
  let tried = 0;
  const walk = (board: Scene, index: number, names: string[]) => {
    if (tried >= MAX_CHAIN_READINGS) return;
    if (index === chain.length) {
      tried += 1;
      const option = optionKeys.indexOf(boardKey(board));
      if (option >= 0 && option !== puzzle.answerIndex && !found.has(option)) {
        found.set(option, names.map((name, gate) => `piece ${gate + 1}: ${name}`).join("; "));
      }
      return;
    }
    for (const reading of chain[index]!.readings) {
      const next = reading.apply(board);
      if (next) walk(next, index + 1, [...names, reading.name]);
    }
  };
  walk(queryBoard, 0, []);
  return [...found].map(([option, reading]) => ({ option, reading }));
}

/** One set-algebra row: two boards and what they make. */
export interface SetAlgebraExample {
  left: Scene;
  right: Scene;
  output: Scene;
}

/** What one set-algebra reading predicts for the question. */
export interface SetAlgebraPrediction {
  reading: string;
  board: Scene;
}

/**
 * What every set-algebra reading that reproduces all the worked rows predicts
 * for the question pair: any of the eight ways to combine two boards, with
 * either board first, then any flip or turn of the board (of the squares, or of
 * the whole picture), a one-square slide wrapping round the edge, or none, then
 * a turn of every arrow and triangle, or of one kind, or none. A sound draw
 * predicts one board only.
 */
export function setAlgebraPredictions(
  examples: readonly SetAlgebraExample[],
  queryLeft: Scene,
  queryRight: Scene,
): SetAlgebraPrediction[] {
  const moves: WorkedRowReading[] = [{ name: "no move", apply: (board) => board }, ...MOVE_READINGS, ...SLIDE_READINGS];
  const turns: WorkedRowReading[] = [{ name: "no turn", apply: (board) => board }, ...TURN_READINGS];
  const targets = examples.map((example) => boardKey(example.output));
  const predictions: SetAlgebraPrediction[] = [];
  for (const operation of SCENE_BINARY_OPERATIONS) {
    for (const rightFirst of [false, true]) {
      const combine = (left: Scene, right: Scene) =>
        (rightFirst ? applySceneBinary(right, left, operation) : applySceneBinary(left, right, operation));
      const combined = examples.map((example) => combine(example.left, example.right));
      const combinedQuery = combine(queryLeft, queryRight);
      if (combined.some((board) => board === null) || !combinedQuery) continue;
      const combineName = `combine by ${operation}${rightFirst ? " with the right board first" : ""}`;
      for (const move of moves) {
        for (const turn of turns) {
          const reproduces = combined.every((board, index) => {
            const moved = move.apply(board!);
            const result = moved && turn.apply(moved);
            return result !== null && boardKey(result) === targets[index];
          });
          if (!reproduces) continue;
          const moved = move.apply(combinedQuery);
          const board = moved && turn.apply(moved);
          if (board) predictions.push({ reading: `${combineName}, then ${move.name}, then ${turn.name}`, board });
        }
      }
    }
  }
  return predictions;
}

/** Set algebra: rows of left, right, result; the third row's result is the blank. */
function setAlgebraSecondReadings(puzzle: ReadablePuzzle): SecondReading[] {
  const stem = scenesOf(puzzle.stem.slice(0, 8));
  const options = scenesOf(puzzle.options);
  if (!stem || !options) return [];
  const [leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight] = stem;
  const optionKeys = options.map(boardKey);
  const found = new Map<number, string>();
  const examples = [{ left: leftA, right: rightA, output: outputA }, { left: leftB, right: rightB, output: outputB }];
  for (const { reading, board } of setAlgebraPredictions(examples, queryLeft, queryRight)) {
    const option = optionKeys.indexOf(boardKey(board));
    if (option >= 0 && option !== puzzle.answerIndex && !found.has(option)) found.set(option, reading);
  }
  return [...found].map(([option, reading]) => ({ option, reading }));
}

/**
 * Every wrong option some reading reaches, when every worked row allows that
 * reading. Empty for a sound item, and for a family this check does not read.
 */
export function secondReadings(familyId: string, puzzle: ReadablePuzzle): SecondReading[] {
  if (familyId === "composed-transform-v2") return machineSecondReadings(puzzle, COMPOSED_VOCABULARY);
  if (familyId === "transformation-machine-v3") return machineSecondReadings(puzzle, MACHINE_VOCABULARY);
  if (familyId === "visual-set-algebra-v2") return setAlgebraSecondReadings(puzzle);
  return [];
}
