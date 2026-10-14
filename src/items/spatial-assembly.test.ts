import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import { checkIntendedClues } from "./blind-options";
import { puzzleToSvg } from "./compose-image";
import { selectDistractors } from "./scene-families";
import { PuzzleSchema, toPublicPuzzle, type Puzzle } from "./schema";
import { assemblyFragmentKey, drawSpatialAssembly, solveSpatialAssembly, spatialAssemblyClues, spatialAssemblyWrongReason } from "./spatial-assembly";

function item(seed: number): Puzzle {
  const rng = seededRng("assembly-tests", String(seed));
  const draw = drawSpatialAssembly(rng);
  const wrong = selectDistractors(draw.distractors, rng, "assembly", {
    answer: draw.answer, required: draw.required, intendedClueBases: [spatialAssemblyClues(draw.answer)],
  });
  return PuzzleSchema.parse({ id: `assembly-${seed}`, type: "matrix", layout: "assembly", difficulty: 4,
    instruction: "Choose the completed arrangement.", stem: draw.stem, options: [draw.answer, ...wrong], answerIndex: 0, explanation: draw.explanation });
}

describe("3x3 spatial assembly", () => {
  it("proves unique packing from the pieces and anchor before options exist", () => {
    const programs = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const draw = drawSpatialAssembly(seededRng("assembly-oracle", String(seed)));
      const outputs = solveSpatialAssembly(draw.stem);
      expect(outputs).toEqual([draw.answer]);
      expect(spatialAssemblyWrongReason(draw.stem, draw.answer)).toBeNull();
      for (const wrong of draw.distractors) expect(spatialAssemblyWrongReason(draw.stem, wrong)).not.toBeNull();
      programs.add(draw.program);
    }
    expect(programs.size).toBeGreaterThanOrEqual(24);
  });

  it("preserves contents and footprint while keeping all three clues necessary", () => {
    for (let seed = 0; seed < 12; seed++) {
      const puzzle = item(seed);
      const answer = puzzle.options[puzzle.answerIndex];
      const clues = spatialAssemblyClues(answer);
      expect(checkIntendedClues(puzzle.options, puzzle.answerIndex, clues)).toEqual({ dispensableClueIds: [], indistinguishableWrongOptionIndexes: [] });
      const content = (scene: typeof answer) => scene.objects.map(({ object }) => JSON.stringify(object)).sort();
      for (const option of puzzle.options) {
        expect(content(option)).toEqual(content(answer));
        expect(new Set(option.objects.map(({ row, column }) => `${row},${column}`)).size).toBe(9);
      }
      for (const clue of clues) for (const value of ["preserved", "changed"]) expect(puzzle.options.filter((option) => clue.read(option) === value).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("accepts turns but distinguishes a chiral piece from its reflection", () => {
    expect(assemblyFragmentKey([0, 3, 6, 7])).toBe(assemblyFragmentKey([0, 1, 2, 3]));
    expect(assemblyFragmentKey([0, 3, 6, 7])).not.toBe(assemblyFragmentKey([1, 4, 6, 7]));
  });

  it("rejects missing pieces, malformed source fragments, and changed marks", () => {
    const { stem, answer } = drawSpatialAssembly(seededRng("assembly-tamper"));
    expect(solveSpatialAssembly(stem.slice(0, 3))).toEqual([]);
    const broken = structuredClone(stem);
    broken[1].objects.pop();
    expect(solveSpatialAssembly(broken)).toEqual([]);
    const changed = structuredClone(answer);
    const mark = changed.objects[0].object;
    if (mark.kind === "token") mark.fill = "outline";
    expect(spatialAssemblyWrongReason(stem, changed)).toBe("The frame or piece contents changed.");
  });

  it("renders neutral labels and the same piece boundaries in the public image", () => {
    const puzzle = item(8);
    const publicPuzzle = toPublicPuzzle(puzzle);
    expect(publicPuzzle).not.toHaveProperty("answerIndex");
    const svg = puzzleToSvg(publicPuzzle);
    expect(svg).toContain('data-assembly-legend="true"');
    expect(svg.match(/data-assembly-kind="fragment"/g)).toHaveLength(3);
    expect(svg.match(/data-assembly-kind="frame"/g)).toHaveLength(7);
    expect(svg).not.toContain("preserved");
    expect(svg).not.toContain("reflected");
    expect(puzzleToSvg(publicPuzzle, { optionsOnly: true })).not.toContain("data-assembly-legend");
  });
});
