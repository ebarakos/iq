import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import { attributeMatrixClues, drawAttributeMatrix, solveAttributeMatrix } from "./attribute-matrix";
import { checkIntendedClues } from "./blind-options";
import { PuzzleSchema, sceneSignature, type Puzzle, type Scene } from "./schema";
import { generateSceneFamilyCandidate, validateSceneFamilyCandidate } from "./scene-families";

function candidate(seed: number, difficulty: 2 | 3 | 4) {
  const draw = drawAttributeMatrix(seededRng(`attribute-${difficulty}`, String(seed)), difficulty);
  const clues = attributeMatrixClues(draw.answer, difficulty > 2);
  const required = clues.map((clue) => draw.pool.find((option) => clues.every((other) =>
    (other.read(option) === other.read(draw.answer)) === (other.id !== clue.id)))!);
  const extra = draw.pool.filter((option) => !required.includes(option)).slice(0, 5 - required.length);
  const puzzle: Puzzle = { id: `attribute-${difficulty}-${seed}`, type: "matrix", layout: "grid3x3",
    gridFlow: "rowsAndColumns", difficulty, instruction: "Choose the missing picture.",
    stem: [...draw.boards.slice(0, 8), { blank: true }], options: [draw.answer, ...required, ...extra],
    answerIndex: 0, explanation: draw.explanation };
  return { draw, clues, puzzle };
}

function withCount(source: Scene, count: number, pool: readonly Scene[]): Scene {
  const positions = pool.find((scene) => scene.objects.length === count)!.objects;
  return { ...source, objects: positions.map(({ row, column }) => ({ row, column, object: source.objects[0].object })) };
}

describe("independent shape, shading and count matrices", () => {
  it("accepts all three integrated buckets after schema normalization", () => {
    for (const difficulty of [2, 3, 4] as const) for (let seed = 0; seed < 4; seed++) {
      const generated = generateSceneFamilyCandidate("attribute-matrix-v1",
        seededRng("attribute-integration", `${difficulty}:${seed}`), `attribute-matrix-d${difficulty}`);
      const result = validateSceneFamilyCandidate(generated);
      expect(result.issues).toEqual([]);
      expect(result.accepted).toBe(true);
      expect(checkIntendedClues(generated.puzzle.options, generated.puzzle.answerIndex,
        attributeMatrixClues(generated.puzzle.options[generated.puzzle.answerIndex], difficulty > 2)).dispensableClueIds).toEqual([]);
    }
  });

  it("derives each answer from all eight visible pictures without reading the key", () => {
    const programs = new Set<string>();
    for (const difficulty of [2, 3, 4] as const) for (let seed = 0; seed < 80; seed++) {
      const { draw, puzzle } = candidate(seed, difficulty);
      expect(PuzzleSchema.safeParse(puzzle).success).toBe(true);
      const report = solveAttributeMatrix({ ...puzzle, answerIndex: 4, generation: undefined });
      expect(report.solutionCount).toBe(1);
      expect(report.derivedAnswer).toEqual(draw.answer);
      expect(report.usedCueIds).toEqual(draw.cueIds);
      expect(report.distractorWitnesses).toHaveLength(5);
      programs.add(draw.ruleKey);
      const pairs = draw.boards.map((scene) => {
        const object = scene.objects[0].object;
        return object.kind === "token" ? `${object.shape}:${object.fill}` : "invalid";
      });
      expect(new Set(pairs).size).toBe(9);
      if (difficulty > 2) for (const property of ["shape", "fill"] as const) {
        const countsByCategory = new Map<string, Set<number>>();
        for (const scene of draw.boards) {
          const object = scene.objects[0].object;
          if (object.kind !== "token") throw new Error("Expected a uniform collection");
          const category = object[property];
          const counts = countsByCategory.get(category) ?? new Set<number>();
          counts.add(scene.objects.length);
          countsByCategory.set(category, counts);
        }
        expect([...countsByCategory.values()].some((counts) => counts.size > 1)).toBe(true);
      }
    }
    // Count relationships define the mechanism; palettes, category phases and
    // placements must not inflate the whole-family diversity gate.
    expect(programs.size).toBeGreaterThanOrEqual(8);
    expect(programs.size).toBeLessThanOrEqual(22);
  });

  it("keeps one constant-count mechanism across varied category palettes and placements", () => {
    const mechanisms = new Set<string>();
    const pictures = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      const draw = drawAttributeMatrix(seededRng("attribute-surface", String(seed)), 2);
      mechanisms.add(draw.ruleKey);
      pictures.add(draw.boards.map(sceneSignature).join("|"));
    }
    expect(mechanisms.size).toBe(1);
    expect(pictures.size).toBe(32);
  });

  it("provides a separate omission trap for every intended clue", () => {
    for (const difficulty of [2, 3, 4] as const) {
      const { puzzle, clues, draw } = candidate(8, difficulty);
      expect(checkIntendedClues(puzzle.options, 0, clues)).toEqual({
        dispensableClueIds: [], indistinguishableWrongOptionIndexes: [],
      });
      for (const clue of clues) expect(puzzle.options.filter((option) => clue.read(option) === clue.read(draw.answer)).length)
        .toBeGreaterThanOrEqual(2);
      expect(new Set(draw.pool.map(sceneSignature)).size).toBe(draw.pool.length);
    }
  });

  it("rejects an alternative count reading even when the keyed answer fits addition", () => {
    const { draw, puzzle } = candidate(0, 3);
    const counts = [1, 1, 2, 1, 1, 2, 2, 2];
    const ambiguous: Puzzle = { ...puzzle, stem: [...draw.boards.slice(0, 8).map((board, index) =>
      withCount(board, counts[index], draw.pool)), { blank: true }] };
    const report = solveAttributeMatrix(ambiguous);
    // For both axes a+b+k=2. At the query (2,2), every joint pair
    // predicts one of 2..6, and each of those five completions survives.
    expect(report.solutionCount).toBe(5);
    expect(report.derivedAnswer).toBeNull();
  });

  it("rejects a corrupted visible picture instead of solving only the query line", () => {
    const { puzzle } = candidate(13, 4);
    const broken = structuredClone(puzzle);
    const first = broken.stem[0] as Scene;
    const second = broken.stem[1] as Scene;
    const otherShape = second.objects[0].object;
    if (otherShape.kind !== "token") throw new Error("Expected a uniform collection");
    for (const { object } of first.objects) if (object.kind === "token") object.shape = otherShape.shape;
    expect(solveAttributeMatrix(broken).solutionCount).toBe(0);
    const malformed = structuredClone(puzzle);
    (malformed.stem[0] as Scene).objects[0].column = 9;
    expect(solveAttributeMatrix(malformed).solutionCount).toBe(0);
  });

  it("ignores collection placement and rejects two options with the same answer attributes", () => {
    const { puzzle } = candidate(13, 4);
    const rearranged = structuredClone(puzzle);
    for (const scene of [...rearranged.stem.slice(0, 8), ...rearranged.options] as Scene[]) {
      for (const placed of scene.objects) {
        placed.row = 2 - placed.row;
        placed.column = 2 - placed.column;
      }
    }
    const report = solveAttributeMatrix(rearranged);
    expect(report.solutionCount).toBe(1);
    expect(report.derivedAnswer).toEqual(rearranged.options[0]);
    rearranged.options[1] = structuredClone(rearranged.options[0]);
    expect(solveAttributeMatrix(rearranged).solutionCount).toBe(0);
    expect(solveAttributeMatrix(rearranged).derivedAnswer).toBeNull();
    const duplicateWrong = structuredClone(puzzle);
    duplicateWrong.options[2] = structuredClone(duplicateWrong.options[1]);
    for (const placed of duplicateWrong.options[2].objects) placed.column = (placed.column + 1) % 3;
    expect(solveAttributeMatrix(duplicateWrong).solutionCount).toBe(0);
    const generated = generateSceneFamilyCandidate("attribute-matrix-v1", seededRng("semantic-duplicates"), "attribute-matrix-d4");
    const wrongIndexes = generated.puzzle.options.map((_, index) => index).filter((index) => index !== generated.puzzle.answerIndex);
    generated.puzzle.options[wrongIndexes[1]] = structuredClone(generated.puzzle.options[wrongIndexes[0]]);
    for (const placed of generated.puzzle.options[wrongIndexes[1]].objects) placed.column = (placed.column + 1) % 3;
    expect(validateSceneFamilyCandidate(generated).accepted).toBe(false);
  });

  it("makes either axis of the highest band require weighting without simpler count readings", () => {
    const simpleRules = [-1, 0, 1].flatMap((a) => [-1, 0, 1].flatMap((b) =>
      [-2, -1, 0, 1, 2].map((k) => (left: number, right: number) => a * left + b * right + k)));
    for (let seed = 0; seed < 40; seed++) {
      const { draw } = candidate(seed, 4);
      const counts = draw.boards.map((scene) => scene.objects.length);
      const rows = [counts.slice(0, 3), counts.slice(3, 6), counts.slice(6, 9)];
      const columns = [[counts[0], counts[3], counts[6]], [counts[1], counts[4], counts[7]],
        [counts[2], counts[5], counts[8]]];
      for (const lines of [rows, columns]) {
        const complete = lines.slice(0, 2), [a, b] = lines[2];
        const feasible = (count: number) => count >= 1 && count <= 9;
        expect(simpleRules.some((rule) => complete.every(([left, right, output]) => rule(left, right) === output) &&
          feasible(rule(a, b)))).toBe(false);
        expect(complete.every(([left, right, output]) => Math.abs(left - right) === output) && feasible(Math.abs(a - b))).toBe(false);
        const alphabet = new Set(counts.slice(0, 8));
        expect(alphabet.size === 3 && complete.every((line) => new Set(line).size === 3) && a !== b).toBe(false);
      }
    }
  });
});
