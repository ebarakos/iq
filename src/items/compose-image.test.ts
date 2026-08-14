import { describe, expect, it } from "vitest";
import { loadBank } from "./bank";
import { puzzleToSvg } from "./compose-image";
import { generatePuzzle } from "./generate";
import { mulberry32 } from "../lib/rng";
import { PUZZLE_TYPES, type Puzzle, type PuzzleType } from "./schema";

/**
 * Structural assertions on the standalone SVG composition. We do not snapshot
 * the whole markup (geometry is incidental); we assert the load-bearing
 * properties: one <svg> root, the right number of A–F option labels, a "?"
 * placeholder, and explicit fill attributes (no CSS-class color dependence,
 * since this renders outside the app).
 */

const bank = loadBank();

function firstOfType(type: PuzzleType): Puzzle {
  const item = bank.find((i) => i.puzzle.type === type);
  return item?.puzzle ?? generatePuzzle(type, 4, mulberry32(42));
}

describe("puzzleToSvg", () => {
  it("returns a single self-contained <svg>…</svg> for every puzzle type", () => {
    for (const type of PUZZLE_TYPES) {
      const svg = puzzleToSvg(firstOfType(type));
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      // Exactly one root <svg>; nested per-cell <svg> are children, so the
      // root opener appears once at position 0.
      expect(svg.indexOf("<svg")).toBe(0);
    }
  });

  it("draws one lettered box per option (A…) for each type", () => {
    for (const type of PUZZLE_TYPES) {
      const puzzle = firstOfType(type);
      const svg = puzzleToSvg(puzzle);
      const labels = ["A", "B", "C", "D", "E", "F"].slice(0, puzzle.options.length);
      // Each option label appears as a standalone <text> glyph.
      for (const letter of labels) {
        expect(svg).toContain(`>${letter}</text>`);
      }
      // Labels beyond the option count must NOT appear.
      const absent = ["A", "B", "C", "D", "E", "F"].slice(puzzle.options.length);
      for (const letter of absent) {
        expect(svg).not.toContain(`>${letter}</text>`);
      }
    }
  });

  it("renders a '?' placeholder for the cell to solve (non-oddOneOut)", () => {
    for (const type of PUZZLE_TYPES) {
      if (type === "oddOneOut") continue; // empty stem — options only, no "?"
      const svg = puzzleToSvg(firstOfType(type));
      expect(svg).toContain(">?</text>");
    }
  });

  it("uses explicit fill attributes (no CSS-class color dependence)", () => {
    const svg = puzzleToSvg(firstOfType("matrix"));
    // Cells/shapes carry inline fill attributes that survive outside the app CSS.
    expect(svg).toMatch(/fill="(#[0-9a-fA-F]{3,6}|none)"/);
    // The white background rect is present.
    expect(svg).toContain('fill="#ffffff"');
    // No class attribute should carry styling: assert none of the standard
    // Tailwind layout classes leak into the standalone markup.
    expect(svg).not.toContain("flex");
    expect(svg).not.toContain("grid-cols");
  });

  it("renders operator worked rows, query, and public shape-order legend", () => {
    const puzzle = firstOfType("operatorInduction");
    const svg = puzzleToSvg(puzzle);
    expect(svg.match(/>◆<\/text>/g)).toHaveLength(puzzle.stem.length / 3);
    expect(svg.match(/>→<\/text>/g)?.length).toBeGreaterThanOrEqual(puzzle.stem.length / 3);
    expect(svg).toContain(">?</text>");
    expect(puzzle.operatorLegend?.shapeCycle.length).toBeGreaterThanOrEqual(3);
  });
});
