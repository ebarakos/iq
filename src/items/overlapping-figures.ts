import { pick, shuffled, type Rng } from "../lib/rng";
import type { IntendedClue } from "./blind-options";
import type { ValidationReport } from "./family";
import { isBlank, type Puzzle, type Scene } from "./schema";

/** Rays run clockwise from north. Quarter turns and the four visible mirror axes. */
const ORIENTATIONS = [
  { offset: 0, mirror: false, name: "unchanged" },
  { offset: 2, mirror: false, name: "a quarter turn clockwise" },
  { offset: 4, mirror: false, name: "two quarter turns" },
  { offset: 6, mirror: false, name: "a quarter turn anticlockwise" },
  { offset: 0, mirror: true, name: "a reflection across the vertical centre line" },
  { offset: 2, mirror: true, name: "a reflection across the northeast–southwest centre line" },
  { offset: 4, mirror: true, name: "a reflection across the horizontal centre line" },
  { offset: 6, mirror: true, name: "a reflection across the northwest–southeast centre line" },
] as const;
const OPERATIONS = ["xor", "union", "intersection", "subtract", "reverse-subtract"] as const;
type Operation = typeof OPERATIONS[number];
interface Rule { operation: Operation; first: number; second: number }
const ALL_RULES: readonly Rule[] = OPERATIONS.flatMap((operation) =>
  ORIENTATIONS.flatMap((_, first) => ORIENTATIONS.map((_, second) => ({ operation, first, second }))));
const ORIENTED = ORIENTATIONS.map(({ offset, mirror }) => Array.from({ length: 256 }, (_, mask) => {
  let result = 0;
  for (let ray = 0; ray < 8; ray++) if (mask & (1 << ray)) {
    result |= 1 << ((offset + (mirror ? -ray : ray) + 8) % 8);
  }
  return result;
}));
const CUE_IDS = ["worked-row-strokes", "worked-column-strokes", "fixed-centre-and-directions"] as const;
const DIRECTIONS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

function combine(operation: Operation, first: number, second: number): number {
  if (operation === "xor") return first ^ second;
  if (operation === "union") return first | second;
  if (operation === "intersection") return first & second;
  return operation === "subtract" ? first & ~second & 255 : second & ~first & 255;
}
function apply(rule: Rule, first: number, second: number): number {
  return combine(rule.operation, ORIENTED[rule.first][first], ORIENTED[rule.second][second]);
}
function scene(mask: number): Scene {
  return {
    kind: "scene", rows: 3, columns: 3, objects: [], tiles: [],
    figure: { kind: "radial", strokes: Array.from({ length: 8 }, (_, ray) => ray).filter((ray) => mask & (1 << ray)) },
  };
}
function read(value: Scene): number | null {
  if (value.rows !== 3 || value.columns !== 3 || value.objects.length || value.tiles.length ||
      value.assembly || (value.guides?.length ?? 0) || value.figure?.kind !== "radial") return null;
  const rays = value.figure.strokes;
  if (!rays.length || rays.some((ray, index) => !Number.isInteger(ray) || ray < 0 || ray > 7 ||
      (index > 0 && rays[index - 1] >= ray))) return null;
  return rays.reduce((mask, ray) => mask | (1 << ray), 0);
}

interface Readings { rows: readonly Rule[]; columns: readonly Rule[]; predictions: readonly number[] }
/** Both axes are checked against the entire vocabulary, regardless of the declared difficulty. */
function readings(boards: readonly number[]): Readings {
  const rows = ALL_RULES.filter((rule) => apply(rule, boards[0], boards[1]) === boards[2] &&
    apply(rule, boards[3], boards[4]) === boards[5]);
  const columns = ALL_RULES.filter((rule) => apply(rule, boards[0], boards[3]) === boards[6] &&
    apply(rule, boards[1], boards[4]) === boards[7]);
  // Do not intersect predictions: a fitting row and a fitting column that
  // disagree are competing readings, even when another pair happens to agree.
  const predictions = rows.length && columns.length ? [...new Set([
    ...rows.map((rule) => apply(rule, boards[6], boards[7])),
    ...columns.map((rule) => apply(rule, boards[2], boards[5])),
  ])] : [];
  return { rows, columns, predictions };
}

/** Each ray has a visible binary outcome, including rays absent from the answer. */
export function overlappingFigureClues(answer: Scene): IntendedClue[] {
  if (read(answer) === null) return [];
  return DIRECTIONS.map((direction, ray) => ({
    id: `ray:${direction}`,
    read: (option: Scene) => {
      const mask = read(option);
      return mask === null ? "invalid" : mask & (1 << ray) ? "present" : "absent";
    },
  }));
}

/** Pure visible-data oracle; the answer key, metadata and sampled rule are never read. */
export function solveOverlappingFigures(puzzle: Puzzle): ValidationReport {
  const empty: ValidationReport = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
  if (puzzle.layout !== "grid3x3" || puzzle.stem.length !== 9 || !isBlank(puzzle.stem[8]) ||
      puzzle.stem.slice(0, 8).some(isBlank)) return empty;
  const masks = puzzle.stem.slice(0, 8).map((panel) => read(panel as Scene));
  if (masks.some((mask) => mask === null)) return empty;
  const result = readings(masks as number[]);
  if (result.predictions.length !== 1 || result.predictions[0] === 0) {
    return { ...empty, solutionCount: result.predictions.length, usedCueIds: CUE_IDS };
  }
  const answerMask = result.predictions[0];
  return {
    derivedAnswer: scene(answerMask), solutionCount: 1, usedCueIds: CUE_IDS,
    distractorWitnesses: puzzle.options.flatMap((option, optionIndex) => {
      const actual = read(option);
      if (actual === answerMask) return [];
      if (actual === null) return [{ optionIndex, witness: "The option does not preserve the centred stroke figure." }];
      const ray = DIRECTIONS.findIndex((_, index) => ((actual ^ answerMask) & (1 << index)) !== 0);
      return [{ optionIndex, witness: `The ${DIRECTIONS[ray]} stroke should be ${answerMask & (1 << ray) ? "present" : "absent"}, as required by the completed rows and columns.` }];
    }),
  };
}

// A common turn/reflection commutes with every combining operation: combine
// first, then transform once. Only distinct nonidentity orientations add steps.
const depth = (rule: Rule) => 1 + new Set([rule.first, rule.second].filter((orientation) => orientation !== 0)).size;
const count = (mask: number) => Array.from({ length: 8 }, (_, ray) => Number(Boolean(mask & (1 << ray)))).reduce((sum, bit) => sum + bit, 0);
function turnsMatter(rule: Rule, boards: readonly number[]): boolean {
  for (const input of ["first", "second"] as const) if (rule[input] !== 0) {
    const omitted = { ...rule, [input]: 0 };
    if (apply(omitted, boards[6], boards[7]) === boards[8] ||
        apply(omitted, boards[2], boards[5]) === boards[8]) return false;
  }
  return true;
}
function explanation(rule: Rule): string {
  const changes = [rule.first ? `Give the first figure ${ORIENTATIONS[rule.first].name}.` : "",
    rule.second ? `Give the second figure ${ORIENTATIONS[rule.second].name}.` : ""].filter(Boolean).join(" ");
  const action: Record<Operation, string> = {
    xor: "Keep strokes that appear in exactly one of the two figures; shared strokes disappear.",
    union: "Keep every stroke that appears in either figure; shared strokes appear once.",
    intersection: "Keep only strokes that appear in both figures.",
    subtract: "Keep strokes from the first figure only where the second figure has no stroke.",
    "reverse-subtract": "Keep strokes from the second figure only where the first figure has no stroke.",
  };
  return `The same rule holds across each row and down each column. ${changes ? `${changes} ` : ""}${action[rule.operation]} Combine the bottom row's first two figures, then the right column's first two figures. Both give the same missing figure.`;
}

export function drawOverlappingFigures(rng: Rng, difficulty: 3 | 4 | 5): {
  boards: Scene[]; answer: Scene; pool: Scene[]; ruleKey: string; explanation: string; cueIds: string[];
} {
  const level = difficulty - 2;
  const rules = ALL_RULES.filter((rule) => depth(rule) === level && (difficulty !== 4 || rule.first === 0));
  for (let attempt = 0; attempt < 12000; attempt++) {
    const rule = pick(rng, rules);
    const first = 1 + Math.floor(rng() * 254);
    const second = 1 + Math.floor(rng() * 254);
    const fourth = 1 + Math.floor(rng() * 254);
    const fifth = 1 + Math.floor(rng() * 254);
    const boards = [first, second, apply(rule, first, second), fourth, fifth, apply(rule, fourth, fifth),
      apply(rule, first, fourth), apply(rule, second, fifth)];
    boards.push(apply(rule, boards[6], boards[7]));
    if (boards[8] !== apply(rule, boards[2], boards[5]) ||
        boards.some((mask) => count(mask) < 2 || count(mask) > 6) || !turnsMatter(rule, boards)) continue;
    const result = readings(boards);
    if (result.predictions.length !== 1 || result.predictions[0] !== boards[8] ||
        [...result.rows, ...result.columns].some((reading) => depth(reading) < level)) continue;
    const answerMask = boards[8];
    const candidates = new Set<number>();
    const add = (mask: number) => { if (mask && mask !== answerMask) candidates.add(mask); };
    // Wrong operation or orientation, and omitting one transformation.
    for (const other of ALL_RULES) {
      if (other.operation === rule.operation || (other.first === rule.first && other.second === rule.second)) {
        add(apply(other, boards[6], boards[7]));
        add(apply(other, boards[2], boards[5]));
      }
    }
    // Single and paired stroke mistakes provide omission witnesses for each ray.
    const partial: number[] = [];
    for (let mask = 1; mask < 256; mask++) {
      const difference = count(mask ^ answerMask);
      if (difference <= 2) add(mask);
      else if (difference === 3) partial.push(mask);
    }
    shuffled(rng, partial).slice(0, 12).forEach(add);
    // Keep the pool bounded without throwing away the per-ray mistakes.
    const essential = [...candidates].filter((mask) => count(mask ^ answerMask) <= 2);
    const additional = shuffled(rng, [...candidates].filter((mask) => count(mask ^ answerMask) > 2));
    const pool = shuffled(rng, [...essential, ...additional.slice(0, Math.max(0, 72 - essential.length))]).map(scene);
    return {
      boards: boards.map(scene), answer: scene(answerMask), pool,
      ruleKey: `${rule.operation}:first=${rule.first}:second=${rule.second}`,
      explanation: explanation(rule), cueIds: [...CUE_IDS],
    };
  }
  throw new Error(`Could not draw an unambiguous overlapping-figures-d${difficulty} item`);
}
