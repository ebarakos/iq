import { pick, shuffled, type Rng } from "../lib/rng";
import type { IntendedClue } from "./blind-options";
import type { ValidationReport } from "./family";
import { isBlank, sceneSignature, type Puzzle, type Scene, type SceneToken } from "./schema";

const SHAPES = ["circle", "square", "triangle", "diamond", "hexagon", "star"] as const;
const FILLS = ["outline", "half", "solid"] as const;
const POSITIONS: readonly (readonly number[])[] = [
  [], [4], [3, 5], [3, 4, 5], [0, 2, 6, 8], [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8], [0, 1, 2, 4, 6, 7, 8], [0, 1, 2, 3, 5, 6, 7, 8],
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
];
type Attributes = { shape: SceneToken["shape"]; fill: SceneToken["fill"]; count: number };
type Linear = readonly [number, number, number];
type CountTemplate = { counts: number[]; rows: Linear; columns: Linear };
const LINEAR: readonly Linear[] = Array.from({ length: 5 }, (_, a) =>
  Array.from({ length: 5 }, (_, b) => Array.from({ length: 5 }, (_, k): Linear => [a - 2, b - 2, k - 2]))).flat(2);
const SIMPLE_LINEAR = LINEAR.filter(([a, b]) => Math.abs(a) <= 1 && Math.abs(b) <= 1);
const inRange = (value: number) => Number.isInteger(value) && value >= 1 && value <= 9;
const evaluate = ([a, b, k]: Linear, left: number, right: number) => a * left + b * right + k;

function collection({ shape, fill, count }: Attributes, positions: readonly number[] = POSITIONS[count]): Scene {
  return {
    kind: "scene", rows: 3, columns: 3, collection: true, tiles: [],
    objects: positions.map((cell) => ({ row: Math.floor(cell / 3), column: cell % 3,
      object: { kind: "token", shape, rotation: 0, fill, size: "l" } })),
  };
}

/** Read only the uniform collections actually visible in the picture. */
function attributes(scene: Scene): Attributes | null {
  const first = scene.objects[0]?.object;
  if (!scene.collection || scene.rows !== 3 || scene.columns !== 3 || scene.tiles.length ||
      scene.guides?.length || scene.assembly || scene.figure || !first || first.kind !== "token" || first.rotation !== 0 || first.size !== "l" ||
      !inRange(scene.objects.length) || scene.objects.some(({ object }) => object.kind !== "token" ||
        object.shape !== first.shape || object.fill !== first.fill || object.rotation !== 0 || object.size !== first.size)) return null;
  const positions = scene.objects.map(({ row, column }) => row * 3 + column).sort((a, b) => a - b);
  if (scene.objects.some(({ row, column }) => !Number.isInteger(row) || !Number.isInteger(column) ||
      row < 0 || row > 2 || column < 0 || column > 2) || new Set(positions).size !== positions.length) return null;
  return { shape: first.shape, fill: first.fill, count: scene.objects.length };
}

export function attributeMatrixClues(_answer: Scene, includeCount: boolean): IntendedClue[] {
  return (includeCount ? ["shape", "fill", "count"] as const : ["shape", "fill"] as const).map((id) => ({
    id, read: (scene) => String(attributes(scene)?.[id] ?? "invalid"),
  }));
}

function lines(values: readonly (number | string | null)[], axis: "rows" | "columns") {
  return [0, 1, 2].map((line) => [0, 1, 2].map((position) =>
    values[axis === "rows" ? line * 3 + position : position * 3 + line]));
}

/** A category occurs once per row and column. Every ordering is allowed. */
function categoryPredictions(values: readonly (string | null)[]): Set<string> {
  const alphabet = [...new Set(values.filter((value): value is string => value !== null))];
  if (alphabet.length !== 3) return new Set();
  const predicted = new Set(alphabet);
  for (const axis of ["rows", "columns"] as const) for (const line of lines(values, axis)) {
    const visible = line.filter((value): value is string => typeof value === "string");
    if (new Set(visible).size !== visible.length) return new Set();
    if (visible.length === 2) for (const value of predicted) if (visible.includes(value)) predicted.delete(value);
  }
  return predicted;
}

/**
 * Complete bounded second reading: all 125 affine functions per axis, absolute
 * difference, and a repeated three-value distribution. Neither difficulty nor
 * generation metadata narrows this search. A row and column reading must agree.
 */
function axisCountPredictions(values: readonly (number | null)[], axis: "rows" | "columns",
  affineRules: readonly Linear[] = LINEAR): Set<number> {
  const triples = lines(values, axis) as (number | null)[][];
  const complete = triples.filter((line) => line.every((value) => value !== null)) as number[][];
  const query = triples.find((line) => line.includes(null));
  if (!query || query[0] === null || query[1] === null || query[2] !== null) return new Set();
  const predicted = new Set<number>();
  for (const rule of affineRules) if (complete.every(([left, right, output]) => evaluate(rule, left, right) === output)) {
    const answer = evaluate(rule, query[0], query[1]);
    if (inRange(answer)) predicted.add(answer);
  }
  if (complete.every(([left, right, output]) => Math.abs(left - right) === output)) {
    const answer = Math.abs(query[0] - query[1]);
    if (inRange(answer)) predicted.add(answer);
  }
  const alphabet = [...new Set(values.filter((value): value is number => value !== null))];
  if (alphabet.length === 3 && complete.every((line) => new Set(line).size === 3) && query[0] !== query[1]) {
    for (const answer of alphabet) if (!query.includes(answer)) predicted.add(answer);
  }
  return predicted;
}

function countPredictions(values: readonly (number | null)[]): number[] {
  // This grid declares both directions together. Two axis readings predicting
  // different numbers cannot form a completed grid; they are an inconsistent
  // pair, not a second solution. An independent-axis oracle would instead
  // reject disagreement before applying the other direction's constraints.
  const row = axisCountPredictions(values, "rows");
  const column = axisCountPredictions(values, "columns");
  return [...row].filter((value) => column.has(value));
}

export function solveAttributeMatrix(puzzle: Puzzle): ValidationReport {
  const empty: ValidationReport = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
  if (puzzle.layout !== "grid3x3" || puzzle.stem.length !== 9 || !isBlank(puzzle.stem[8]) ||
      puzzle.stem.slice(0, 8).some(isBlank)) return empty;
  const visible = puzzle.stem.slice(0, 8).map((panel) => attributes(panel as Scene));
  if (visible.some((value) => value === null)) return empty;
  const read = visible as Attributes[];
  const shapes = [...categoryPredictions([...read.map((value) => value.shape), null])];
  const fills = [...categoryPredictions([...read.map((value) => value.fill), null])];
  const counts = countPredictions([...read.map((value) => value.count), null]);
  const solutionCount = shapes.length * fills.length * counts.length;
  const usedCueIds = ["shape", "fill", ...(new Set(read.map((value) => value.count)).size > 1 ? ["count"] : [])];
  if (solutionCount !== 1) return { ...empty, solutionCount, usedCueIds };
  const optionAttributes = puzzle.options.map(attributes);
  const optionKeys = optionAttributes.map((actual) => actual ? `${actual.shape}:${actual.fill}:${actual.count}` : "invalid");
  if (optionAttributes.some((actual) => !actual) || new Set(optionKeys).size !== puzzle.options.length) {
    return { ...empty, usedCueIds };
  }
  const expected: Attributes = { shape: shapes[0] as Attributes["shape"], fill: fills[0] as Attributes["fill"], count: counts[0] };
  // Placement carries no rule. Match the predicted attributes to a visible
  // option, so rearranging a collection cannot change the solution.
  const matches = puzzle.options.filter((_option, index) => {
    const actual = optionAttributes[index];
    return actual && actual.shape === expected.shape && actual.fill === expected.fill && actual.count === expected.count;
  });
  const derivedAnswer = matches[0] ?? collection(expected);
  const signature = sceneSignature(derivedAnswer);
  const distractorWitnesses = puzzle.options.flatMap((option, optionIndex) => {
    if (sceneSignature(option) === signature) return [];
    const actual = attributes(option);
    const changed = actual ? (["shape", "fill", "count"] as const).filter((key) => actual[key] !== expected[key]) : [];
    return [{ optionIndex, witness: actual ? `The ${changed.join(" and ")} does not complete both the rows and columns.` : "The picture is not a uniform collection of the shown shapes." }];
  });
  return { derivedAnswer, solutionCount, usedCueIds, distractorWitnesses };
}

const templateCache = new Map<number, CountTemplate[]>();
function countTemplates(difficulty: 3 | 4): CountTemplate[] {
  const cached = templateCache.get(difficulty);
  if (cached) return cached;
  const simple: Linear[] = [[1, 1, 0], [1, -1, 0], [-1, 1, 0]];
  const weighted: Linear[] = [[2, 1, 0], [1, 2, 0], [2, -1, 0], [-1, 2, 0]];
  const pairs: [Linear, Linear][] = difficulty === 3 ? simple.flatMap((row) => simple.map((column): [Linear, Linear] => [row, column]))
    : weighted.flatMap((row) => weighted.map((column): [Linear, Linear] => [row, column]));
  const templates: CountTemplate[] = [];
  for (const [rows, columns] of pairs) for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++)
    for (let c = 1; c <= 5; c++) for (let d = 1; d <= 5; d++) {
      const counts = [a, b, evaluate(rows, a, b), c, d, evaluate(rows, c, d),
        evaluate(columns, a, c), evaluate(columns, b, d), 0];
      counts[8] = evaluate(rows, counts[6], counts[7]);
      if (!counts.every(inRange) || evaluate(columns, counts[2], counts[5]) !== counts[8] ||
          (a === c && b === d) || (a === b && c === d)) continue;
      if (difficulty === 4) {
        // Either direction must require weighting. A simple reading that fits
        // the two completed lines and gives any feasible answer is a shortcut,
        // even if the other axis would later rule that answer out.
        const visible = [...counts.slice(0, 8), null];
        if ((["rows", "columns"] as const).some((axis) =>
          axisCountPredictions(visible, axis, SIMPLE_LINEAR).size > 0)) continue;
      }
      const predicted = countPredictions([...counts.slice(0, 8), null]);
      if (predicted.length === 1 && predicted[0] === counts[8]) templates.push({ counts, rows, columns });
    }
  if (!templates.length) throw new Error(`No unambiguous attribute count matrices for difficulty ${difficulty}`);
  templateCache.set(difficulty, templates);
  return templates;
}

function countExplanation(rule: Linear, axis: "row" | "column"): string {
  const [a, b] = rule;
  if (a === 1 && b === 1) return `In each ${axis}, add the first two counts to get the third.`;
  if (a === 1 && b === -1) return `In each ${axis}, subtract the second count from the first to get the third.`;
  if (a === -1 && b === 1) return `In each ${axis}, subtract the first count from the second to get the third.`;
  if (a === 2 && b === -1) return `In each ${axis}, double the first count, then subtract the second count to get the third.`;
  if (a === -1 && b === 2) return `In each ${axis}, double the second count, then subtract the first count to get the third.`;
  return `In each ${axis}, double the ${a === 2 ? "first" : "second"} count, then add the other count to get the third.`;
}

export function drawAttributeMatrix(rng: Rng, difficulty: 2 | 3 | 4): {
  boards: Scene[]; answer: Scene; pool: Scene[]; ruleKey: string; explanation: string; cueIds: string[];
} {
  const shapes = shuffled(rng, SHAPES).slice(0, 3);
  const fills = shuffled(rng, FILLS);
  const drawCollection = (attrs: Attributes) => collection(attrs,
    shuffled(rng, Array.from({ length: 9 }, (_, index) => index)).slice(0, attrs.count).sort((a, b) => a - b));
  const rowStep = pick(rng, [1, 2]);
  const columnStep = pick(rng, [1, 2]);
  // Opposite relative steps make the shape and shading independent: all nine
  // pairs occur, so no visible association lets one attribute supply the other.
  const shapeOffset = pick(rng, [0, 1, 2]);
  const fillOffset = pick(rng, [0, 1, 2]);
  let template: CountTemplate;
  if (difficulty === 2) template = { counts: Array(9).fill(pick(rng, [1, 2, 3, 4])), rows: [1, 0, 0], columns: [1, 0, 0] };
  else template = pick(rng, countTemplates(difficulty));
  const boards = template.counts.map((count, cell) => {
    const row = Math.floor(cell / 3), column = cell % 3;
    return drawCollection({ count, shape: shapes[(shapeOffset + row * rowStep + column * columnStep) % 3],
      fill: fills[(fillOffset + row * rowStep + column * (3 - columnStep)) % 3] });
  });
  const answer = boards[8];
  const expected = attributes(answer)!;
  const counts = difficulty === 2 ? [expected.count] : Array.from({ length: 9 }, (_, index) => index + 1);
  const pool = shapes.flatMap((shape) => fills.flatMap((fill) => counts.filter((count) =>
    shape !== expected.shape || fill !== expected.fill || count !== expected.count)
    .map((count) => drawCollection({ shape, fill, count }))));
  const cueIds = ["shape", "fill", ...(difficulty > 2 ? ["count"] : [])];
  const countWords = difficulty === 2 ? `Every picture contains ${expected.count} ${expected.count === 1 ? "shape" : "shapes"}.`
    : `${countExplanation(template.rows, "row")} ${countExplanation(template.columns, "column")}`;
  const fillWords = { outline: "outlined", half: "grey", solid: "black" };
  return {
    boards, answer, pool, cueIds,
    ruleKey: `shape:distribution;fill:distribution;counts:${template.rows.join(",")}/${template.columns.join(",")}`,
    explanation: `Each row and column contains each of the three shapes once and each of the three shadings once. ${countWords} The missing picture therefore contains ${expected.count} ${fillWords[expected.fill]} ${expected.shape}${expected.count === 1 ? "" : "s"}.`,
  };
}
