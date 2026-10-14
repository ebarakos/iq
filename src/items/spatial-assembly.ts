import { pick, shuffled, type Rng } from "../lib/rng";
import type { IntendedClue } from "./blind-options";
import { isBlank, type Panel, type Scene, type SceneToken } from "./schema";

type Cells = readonly number[];
type Partition = readonly [Cells, Cells, Cells];
const ALL = Array.from({ length: 9 }, (_, cell) => cell);
const SHAPES = ["circle", "square", "diamond", "hexagon", "star"] as const;

function combinations(values: readonly number[], count: number): number[][] {
  if (count === 0) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), count - 1).map((rest) => [value, ...rest]));
}
function connected(cells: Cells): boolean {
  if (!cells.length) return false;
  const seen = new Set([cells[0]]);
  for (let pass = 0; pass < cells.length; pass++) for (const cell of cells) {
    if ([...seen].some((other) => Math.abs(Math.floor(cell / 3) - Math.floor(other / 3)) + Math.abs(cell % 3 - other % 3) === 1)) seen.add(cell);
  }
  return seen.size === cells.length;
}
function normalized(points: readonly (readonly [number, number])[]): number[] {
  const row = Math.min(...points.map(([r]) => r));
  const column = Math.min(...points.map(([, c]) => c));
  return points.map(([r, c]) => (r - row) * 3 + c - column).sort((a, b) => a - b);
}
function turn(cells: Cells): number[] {
  return normalized(cells.map((cell) => [cell % 3, -Math.floor(cell / 3)]));
}
function orientations(cells: Cells): number[][] {
  let current = normalized(cells.map((cell) => [Math.floor(cell / 3), cell % 3]));
  const distinct = new Map<string, number[]>();
  for (let quarter = 0; quarter < 4; quarter++) {
    distinct.set(current.join(","), current);
    current = turn(current);
  }
  return [...distinct.values()];
}
/** Translation and quarter-turn invariant. Reflections deliberately remain distinct. */
export function assemblyFragmentKey(cells: Cells): string {
  return cells.length ? orientations(cells).map((value) => value.join(",")).sort()[0] : "empty";
}
const exactKey = (cells: Cells) => [...cells].sort((a, b) => a - b).join(",");
const mirrorKey = (cells: Cells) => assemblyFragmentKey(normalized(cells.map((cell) => [Math.floor(cell / 3), -(cell % 3)])));

// There are only 420 labelled partitions with a connected two-square anchor.
// Broken loose fragments are useful wrong arrangements, never source pieces.
const PARTITIONS: readonly Partition[] = combinations(ALL, 2).filter(connected).flatMap((anchor) =>
  combinations(ALL.filter((cell) => !anchor.includes(cell)), 3).map((second): Partition =>
    [anchor, second, ALL.filter((cell) => !anchor.includes(cell) && !second.includes(cell))]));
const geometries = PARTITIONS.map((parts) => ({ parts, anchor: exactKey(parts[0]), keys: parts.map(assemblyFragmentKey) }));
const UNIQUE = geometries.filter((entry) => entry.parts.every(connected) && geometries.filter((other) =>
  other.anchor === entry.anchor && other.keys[1] === entry.keys[1] && other.keys[2] === entry.keys[2]).length === 1);

function scene(parts: readonly Cells[], marks: readonly SceneToken[], assembly: Scene["assembly"]): Scene {
  return {
    kind: "scene", rows: 3, columns: 3, tiles: [], assembly,
    objects: parts.flatMap((cells, index) => cells.map((cell) => ({ row: Math.floor(cell / 3), column: cell % 3, object: marks[index] })))
      .sort((left, right) => left.row - right.row || left.column - right.column),
  };
}
function cellsOf(value: Scene, shape: string): number[] {
  return value.objects.filter(({ object }) => object.kind === "token" && object.shape === shape).map(({ row, column }) => row * 3 + column);
}
function marksOf(value: Scene): SceneToken[] {
  const marks = new Map<string, SceneToken>();
  for (const { object } of value.objects) if (object.kind === "token") marks.set(object.shape, object);
  return [...marks.values()].sort((a, b) => cellsOf(value, a.shape).length - cellsOf(value, b.shape).length);
}

/** Independent constraints: the placed piece stays put; each loose piece stays whole. */
export function spatialAssemblyClues(answer: Scene): IntendedClue[] {
  return marksOf(answer).map((mark, index) => {
    const expected = index === 0 ? exactKey(cellsOf(answer, mark.shape)) : assemblyFragmentKey(cellsOf(answer, mark.shape));
    return {
      id: index === 0 ? "anchor" : `fragment:${mark.shape}`,
      read: (option: Scene) => (index === 0 ? exactKey(cellsOf(option, mark.shape)) : assemblyFragmentKey(cellsOf(option, mark.shape))) === expected ? "preserved" : "changed",
    };
  });
}

/** Exhaustive independent oracle: every translation of every permitted quarter turn. */
export function solveSpatialAssembly(stem: readonly Panel[]): Scene[] {
  if (stem.length !== 4 || stem.some(isBlank)) return [];
  const panels = stem as readonly Scene[];
  if (panels.some((panel) => panel.rows !== 3 || panel.columns !== 3 || panel.tiles.length !== 0) ||
      panels.slice(0, 3).some((panel) => panel.assembly !== "fragment") || panels[3].assembly !== "frame") return [];
  const marks = panels.slice(0, 3).map((panel) => marksOf(panel));
  if (marks.some((group) => group.length !== 1) || new Set(marks.map(([mark]) => mark.shape)).size !== 3) return [];
  const tokens = marks.map(([mark]) => mark);
  const source = panels.slice(0, 3).map((panel, index) => cellsOf(panel, tokens[index].shape));
  if (source.some((cells, index) => cells.length !== index + 2 || !connected(cells)) || panels[3].objects.length !== 2) return [];
  const anchor = cellsOf(panels[3], tokens[0].shape);
  if (assemblyFragmentKey(anchor) !== assemblyFragmentKey(source[0])) return [];
  // Reject mark tampering too: the categorical marks are part of the physical pieces.
  if (panels.some((panel) => panel.objects.some(({ object }) => object.kind !== "token" || !tokens.some((token) => JSON.stringify(token) === JSON.stringify(object))))) return [];
  const placements = (cells: Cells) => orientations(cells).flatMap((form) => {
    const height = Math.max(...form.map((cell) => Math.floor(cell / 3))) + 1;
    const width = Math.max(...form.map((cell) => cell % 3)) + 1;
    return Array.from({ length: 4 - height }, (_, row) => Array.from({ length: 4 - width }, (_, column) =>
      form.map((cell) => cell + row * 3 + column))).flat();
  });
  const outputs = new Map<string, Scene>();
  for (const second of placements(source[1])) for (const third of placements(source[2])) {
    const union = [...anchor, ...second, ...third];
    if (new Set(union).size !== 9) continue;
    const output = scene([anchor, second, third], tokens, "frame");
    outputs.set(JSON.stringify(output.objects), output);
  }
  return [...outputs.values()];
}

/** A witness from the visible source pieces, independent of which option was keyed. */
export function spatialAssemblyWrongReason(stem: readonly Panel[], option: Scene): string | null {
  if (stem.length !== 4 || stem.some(isBlank)) return "The source pieces are missing.";
  const panels = stem as readonly Scene[];
  const tokens = panels.slice(0, 3).flatMap(marksOf);
  if (tokens.length !== 3 || option.rows !== 3 || option.columns !== 3 || option.objects.length !== 9 || option.tiles.length) return "The frame or piece contents changed.";
  if (new Set(option.objects.map(({ row, column }) => row * 3 + column)).size !== 9 || option.objects.some(({ object }) => object.kind !== "token" || !tokens.some((token) => JSON.stringify(token) === JSON.stringify(object)))) return "The frame or piece contents changed.";
  for (let index = 0; index < 3; index++) {
    const shape = tokens[index].shape;
    const actual = cellsOf(option, shape);
    const expected = cellsOf(panels[index], shape);
    if (actual.length !== expected.length) return `The ${shape} piece has a different number of squares.`;
    if (index === 0 && exactKey(actual) !== exactKey(cellsOf(panels[3], shape))) return `The placed ${shape} piece moved.`;
    if (assemblyFragmentKey(actual) !== assemblyFragmentKey(expected)) return mirrorKey(actual) === assemblyFragmentKey(expected)
      ? `The ${shape} piece was reflected instead of turned.` : `The squares of the ${shape} piece no longer form its original shape.`;
  }
  return null;
}

export function drawSpatialAssembly(rng: Rng): {
  stem: Scene[]; answer: Scene; distractors: Scene[]; required: Scene[]; program: string; explanation: string;
} {
  const geometry = pick(rng, UNIQUE);
  const marks: SceneToken[] = shuffled(rng, SHAPES).slice(0, 3).map((shape) => ({ kind: "token", shape, rotation: 0, fill: "solid", size: "m" }));
  const answer = scene(geometry.parts, marks, "frame");
  const stem = geometry.parts.map((cells, index) => scene([pick(rng, orientations(cells))], [marks[index]], "fragment"));
  stem.push(scene([geometry.parts[0]], [marks[0]], "frame"));
  const distractors = geometries.filter((other) => other !== geometry).map((other) => scene(other.parts, marks, "frame"));
  const clues = spatialAssemblyClues(answer);
  const required = clues.map((_, index) => pick(rng, distractors.filter((option) => clues.every((clue, other) =>
    (clue.read(option) === clue.read(answer)) === (other !== index)))));
  return {
    // Two additional wrong boards break each constraint. Thus both values of
    // every clue recur, and the intact anchor-only mistake defeats connectivity.
    stem, answer, distractors: distractors.filter((option) => clues.every((clue) => clue.read(option) === "changed")), required,
    program: `anchor:${geometry.anchor};pieces:${geometry.keys.join("/")}`,
    explanation: `Keep the ${marks[0].shape} piece on the two squares already shown. Turn the ${marks[1].shape} and ${marks[2].shape} pieces to fill the remaining squares. Each piece must keep its shape, with no gaps, overlaps, or reflections.`,
  };
}
