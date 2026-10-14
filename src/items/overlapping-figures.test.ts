import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import { drawOverlappingFigures, overlappingFigureClues, solveOverlappingFigures } from "./overlapping-figures";
import { PuzzleSchema, type Puzzle, type Scene } from "./schema";

const rays = (value: Scene) => value.figure!.strokes;
function figure(strokes: number[]): Scene {
  return { kind: "scene", rows: 3, columns: 3, objects: [], tiles: [], figure: { kind: "radial", strokes } };
}
function puzzle(boards: Scene[], options: Scene[]): Puzzle {
  return {
    id: "overlapping-test", type: "matrix", instruction: "Choose the missing figure.", difficulty: 3,
    layout: "grid3x3", gridFlow: "rowsAndColumns", stem: [...boards.slice(0, 8), { blank: true }],
    options, answerIndex: 0, explanation: "The strokes combine.",
  };
}

// A second oracle uses coordinate permutations and sets, rather than the
// generator's bit operations, transform table or sampled-rule information.
const coordinates = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
function oriented(input: number[], orientation: number): number[] {
  return input.map((ray) => {
    let [x, y] = coordinates[ray];
    if (orientation >= 4) x = -x;
    for (let quarter = 0; quarter < orientation % 4; quarter++) [x, y] = [-y, x];
    return coordinates.findIndex(([otherX, otherY]) => x === otherX && y === otherY);
  });
}
function combined(first: number[], second: number[], operation: string): number[] {
  return Array.from({ length: 8 }, (_, ray) => ray).filter((ray) => {
    const a = first.includes(ray), b = second.includes(ray);
    return operation === "xor" ? a !== b : operation === "union" ? a || b : operation === "intersection" ? a && b : operation === "subtract" ? a && !b : b && !a;
  });
}
const equal = (a: number[], b: number[]) => a.length === b.length && a.every((ray) => b.includes(ray));
function independentReadings(boards: Scene[]) {
  const outputs = new Set<string>();
  const fittingDepths: number[] = [];
  let rowCount = 0, columnCount = 0;
  for (const operation of ["xor", "union", "intersection", "subtract", "reverse-subtract"]) {
    for (let first = 0; first < 8; first++) for (let second = 0; second < 8; second++) {
      const apply = (a: number, b: number) => combined(oriented(rays(boards[a]), first), oriented(rays(boards[b]), second), operation);
      // All set operations commute with a shared coordinate permutation, so
      // equal turns can be applied once to the combined figure.
      const steps = first === 0 && second === 0 ? 1 : first === 0 || second === 0 || first === second ? 2 : 3;
      if (equal(apply(0, 1), rays(boards[2])) && equal(apply(3, 4), rays(boards[5]))) {
        rowCount++; outputs.add(apply(6, 7).join(",")); fittingDepths.push(steps);
      }
      if (equal(apply(0, 3), rays(boards[6])) && equal(apply(1, 4), rays(boards[7]))) {
        columnCount++; outputs.add(apply(2, 5).join(",")); fittingDepths.push(steps);
      }
    }
  }
  return { outputs, fittingDepths, rowCount, columnCount };
}

describe("overlapping figures", () => {
  it("solves an original two-axis cancellation example and witnesses every wrong stroke", () => {
    const boards = [[0, 2, 5], [1, 2, 6], [0, 1, 5, 6], [0, 3, 4], [1, 3, 7], [0, 1, 4, 7],
      [2, 3, 4, 5], [2, 3, 6, 7]].map(figure);
    const answer = figure([4, 5, 6, 7]);
    const options = [answer, figure([0, 4, 5, 6, 7]), figure([4, 5, 6]), figure([3, 4, 5, 6, 7]),
      figure([4, 5, 7]), figure([1, 4, 5, 6, 7])];
    const report = solveOverlappingFigures(puzzle(boards, options));
    expect(report.solutionCount).toBe(1);
    expect(report.derivedAnswer).toEqual(answer);
    expect(report.distractorWitnesses.map(({ optionIndex }) => optionIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(report.distractorWitnesses.every(({ witness }) => /stroke should be (present|absent)/.test(witness))).toBe(true);
  });

  it("distinguishes subtracting the first figure from the second on both axes", () => {
    const boards = [[2, 7], [0, 5], [0, 5], [0, 1, 3, 5], [0, 1, 4, 6, 7],
      [4, 6, 7], [0, 1, 3, 5], [1, 4, 6, 7]].map(figure);
    const answer = figure([4, 6, 7]);
    const reversedOrder = figure([0, 3, 5]);
    const report = solveOverlappingFigures(puzzle(boards, [answer, reversedOrder]));
    expect(independentReadings(boards).outputs).toEqual(new Set(["4,6,7"]));
    expect(report.solutionCount).toBe(1);
    expect(report.derivedAnswer).toEqual(answer);
    expect(report.distractorWitnesses).toHaveLength(1);
    expect(report.distractorWitnesses[0].optionIndex).toBe(1);
  });

  it("rejects a matrix whose fitting full-grammar readings disagree", () => {
    const boards = [128, 99, 227, 72, 156, 212, 200, 255].map((mask) =>
      figure(Array.from({ length: 8 }, (_, ray) => ray).filter((ray) => mask & (1 << ray))));
    expect(independentReadings(boards).outputs.size).toBe(2);
    expect(solveOverlappingFigures(puzzle(boards, [])).solutionCount).toBe(2);
    expect(solveOverlappingFigures(puzzle(boards, [])).derivedAnswer).toBeNull();
  });

  it("uses all eight visible figures and ignores the private answer and difficulty hints", () => {
    const draw = drawOverlappingFigures(seededRng("visible-data"), 5);
    const original = puzzle(draw.boards, [draw.answer, ...draw.pool.slice(0, 5)]);
    const falsified = { ...original, answerIndex: 5, difficulty: 1, familyId: "unrelated", explanation: "Wrong clue." };
    expect(solveOverlappingFigures(falsified).derivedAnswer).toEqual(draw.answer);
    for (let index = 0; index < 8; index++) {
      const mutated = structuredClone(original);
      mutated.stem[index] = figure([0]);
      const report = solveOverlappingFigures(mutated);
      expect(report.solutionCount === 1 && equal(rays(report.derivedAnswer!), rays(draw.answer))).toBe(false);
    }
  });

  it.each([3, 4, 5] as const)("proves complete bounded uniqueness and necessary steps at d%i", (difficulty) => {
    for (let seed = 0; seed < 32; seed++) {
      const draw = drawOverlappingFigures(seededRng(`independent:${seed}`), difficulty);
      const result = independentReadings(draw.boards);
      expect(result.rowCount).toBeGreaterThan(0);
      expect(result.columnCount).toBeGreaterThan(0);
      expect([...result.outputs]).toEqual([rays(draw.answer).join(",")]);
      expect(Math.min(...result.fittingDepths)).toBe(difficulty - 2);
      const [operation, firstPart, secondPart] = draw.ruleKey.split(":");
      const first = Number(firstPart.split("=")[1]), second = Number(secondPart.split("=")[1]);
      const apply = (a: number, b: number, left: number, right: number) =>
        combined(oriented(rays(draw.boards[a]), left), oriented(rays(draw.boards[b]), right), operation);
      for (const [left, right] of [[0, second], [first, 0]]) {
        if (left === first && right === second) continue;
        expect(equal(apply(6, 7, left, right), rays(draw.answer))).toBe(false);
        expect(equal(apply(2, 5, left, right), rays(draw.answer))).toBe(false);
      }
      const candidate = { ...puzzle(draw.boards, [draw.answer, ...draw.pool.slice(0, 5)]), difficulty };
      expect(PuzzleSchema.safeParse(candidate).success).toBe(true);
      expect(solveOverlappingFigures(candidate).derivedAnswer).toEqual(draw.answer);
    }
  });

  it("keeps all ray omission witnesses, broad stroke counts, and all five operations", () => {
    for (const difficulty of [3, 4, 5] as const) {
      const operations = new Set<string>();
      let mirrored = false;
      for (let seed = 0; seed < 200; seed++) {
        const draw = drawOverlappingFigures(seededRng(seed), difficulty);
        operations.add(draw.ruleKey.split(":")[0]);
        mirrored ||= /(?:first|second)=[4-7]/.test(draw.ruleKey);
        const clues = overlappingFigureClues(draw.answer);
        expect(clues).toHaveLength(8);
        for (const clue of clues) {
          expect(draw.pool.some((option) => clues.every((other) =>
            (other.read(option) === other.read(draw.answer)) === (other.id !== clue.id)))).toBe(true);
        }
        expect(new Set(draw.pool.map((option) => rays(option).length)).size).toBeGreaterThanOrEqual(4);
        expect(draw.pool.every((option) => rays(option).length > 0)).toBe(true);
        expect(draw.pool.length).toBeLessThanOrEqual(72);
      }
      expect([...operations].sort()).toEqual(["intersection", "reverse-subtract", "subtract", "union", "xor"]);
      expect(mirrored).toBe(difficulty > 3);
    }
  });
});
