import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CELL_CANVAS_PADDING, CELL_VIEWBOX, CellGraphic } from "./render";
import { generatePuzzle } from "./generate";
import { loadBank } from "./bank";
import {
  isBlank,
  type Cell,
  type Puzzle,
  type PublicPuzzle,
  type PuzzleType,
  SHAPES,
  FILLS,
  SIZES,
  ROTATIONS,
} from "./schema";
import { mulberry32 } from "../lib/rng";

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

function renderCell(cell: Cell): string {
  return renderToStaticMarkup(createElement(CellGraphic, { cell }));
}

function firstOfType(type: PuzzleType): Puzzle {
  const bankHit = loadBank().find((item) => item.puzzle.type === type);
  return bankHit?.puzzle ?? generatePuzzle(type, 4, mulberry32(42));
}

async function puzzleToSvg(puzzle: Puzzle | PublicPuzzle) {
  const { puzzleToSvg } = await import("./compose-image");
  return puzzleToSvg(puzzle);
}

type ShapeNode = {
  tag: "circle" | "rect" | "polygon";
  attrs: Record<string, string>;
};

function parseAttributes(raw: string) {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([a-zA-Z_:][^\s=]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function shapeNodesFromSvg(svg: string): ShapeNode[] {
  return Array.from(svg.matchAll(/<(circle|rect|polygon)\b([^>]*)\s*\/?\s*>/g)).map((match) => ({
    tag: match[1] as ShapeNode["tag"],
    attrs: parseAttributes(match[2]),
  }));
}

function parsePoints(raw: string) {
  if (!raw) return [];
  return raw.split(/\s+/).map((token) => {
    const [x, y] = token.split(",").map(Number);
    return { x, y };
  });
}

function shapeCenter(node: ShapeNode) {
  if (node.tag === "circle") {
    return { x: Number(node.attrs.cx), y: Number(node.attrs.cy) };
  }
  if (node.tag === "rect") {
    return {
      x: Number(node.attrs.x) + Number(node.attrs.width) / 2,
      y: Number(node.attrs.y) + Number(node.attrs.height) / 2,
    };
  }

  const points = parsePoints(node.attrs.points ?? "");
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function renderRadius(node: ShapeNode): number {
  if (node.tag === "circle") return Number(node.attrs.r);
  if (node.tag === "rect") {
    return Math.hypot(Number(node.attrs.width) / 2, Number(node.attrs.height) / 2);
  }

  const center = shapeCenter(node);
  return Math.max(
    ...parsePoints(node.attrs.points ?? "").map((point) => Math.hypot(point.x - center.x, point.y - center.y)),
  );
}

function parseRotation(raw: string | undefined) {
  const match = raw?.match(/^rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)$/);
  if (!match) return null;
  return { angle: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

function styleFor(fill: Cell["fill"]) {
  if (fill === "solid") {
    return { fill: "#111827", stroke: "#111827", strokeWidth: 2 };
  }
  if (fill === "half") {
    return { fill: "#9ca3af", stroke: "#111827", strokeWidth: 3 };
  }
  return { fill: "none", stroke: "#111827", strokeWidth: 4 };
}

function circleRadius(count: number, size: (typeof SIZES)[number]): number {
  const nodes = shapeNodesFromSvg(renderCell({ shape: "circle", count, rotation: 0, fill: "solid", size }));
  const node = nodes[0];
  if (!node) throw new Error(`no circle nodes for count=${count} size=${size}`);
  return Number(node.attrs.r);
}

describe("puzzleToSvg", () => {
  it("returns a single self-contained <svg> for every puzzle type", async () => {
    for (const type of ["matrix", "sequence", "analogy", "oddOneOut", "operatorInduction"] as const) {
      const svg = await puzzleToSvg(firstOfType(type));
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg.indexOf("<svg")).toBe(0);
    }
  });

  it("draws one lettered label box per option (A…F)", async () => {
    for (const type of ["matrix", "sequence", "analogy", "oddOneOut", "operatorInduction"] as const) {
      const puzzle = firstOfType(type);
      const svg = await puzzleToSvg(puzzle);
      for (const label of LETTERS.slice(0, puzzle.options.length)) {
        expect(svg).toContain(`>${label}</text>`);
      }
      for (const label of LETTERS.slice(puzzle.options.length)) {
        expect(svg).not.toContain(`>${label}</text>`);
      }
    }
  });

  it("renders '?' for the query position on every non-oddOneOut puzzle", async () => {
    for (const type of ["matrix", "sequence", "analogy", "operatorInduction"] as const) {
      const svg = await puzzleToSvg(firstOfType(type));
      expect(svg).toContain(">?</text>");
    }
  });

  it("emits explicit fill attributes and avoids layout classes", async () => {
    const svg = await puzzleToSvg(firstOfType("matrix"));
    expect(svg).toMatch(/fill="(#[0-9a-fA-F]{3,6}|none)"/);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("flex");
    expect(svg).not.toContain("grid-cols");
  });

  it("renders operator induction rows, query separators, and worked separators", async () => {
    const puzzle = firstOfType("operatorInduction");
    const svg = await puzzleToSvg(puzzle);
    const rowCount = puzzle.stem.length / 3;
    expect((svg.match(/>◆<\/text>/g) ?? []).length).toBe(rowCount);
    expect((svg.match(/>→<\/text>/g) ?? []).length).toBeGreaterThanOrEqual(rowCount);
    expect(svg).toContain(">?</text>");
    expect(puzzle.operatorLegend?.shapeCycle.length).toBeGreaterThanOrEqual(3);
  });
});

describe("CellGraphic geometry lock", () => {
  it("keeps shape/count/fill/size/rotation variants stable", () => {
    const referenceRadius: Record<string, number> = {};
    for (const count of [1, 2, 3, 4] as const) {
      for (const size of SIZES) {
        referenceRadius[`${count}-${size}`] = circleRadius(count, size);
      }
    }

    for (const shape of SHAPES) {
      const rotations = shape === "triangle" ? ROTATIONS : [0];
      for (const count of [1, 2, 3, 4] as const) {
        for (const fill of FILLS) {
          for (const size of SIZES) {
            for (const rotation of rotations) {
              const cell: Cell = { shape, count, fill, rotation, size };
              const svg = renderCell(cell);
              const nodes = shapeNodesFromSvg(svg);
              const expectedTag = shape === "circle" ? "circle" : shape === "square" ? "rect" : "polygon";

              expect(nodes).toHaveLength(count);
              const expected = styleFor(fill);

              for (const node of nodes) {
                expect(node.tag).toBe(expectedTag);
                expect(node.attrs.fill).toBe(expected.fill);
                expect(node.attrs.stroke).toBe(expected.stroke);
                expect(Number(node.attrs["stroke-width"])).toBe(expected.strokeWidth);

                if (shape === "circle") {
                  expect(node.attrs.transform).toBeUndefined();
                } else {
                  const center = shapeCenter(node);
                  const transform = parseRotation(node.attrs.transform);
                  expect(transform?.angle).toBe(rotation);
                  expect(transform?.x).toBeCloseTo(center.x, 1);
                  expect(transform?.y).toBeCloseTo(center.y, 1);
                }

                if (shape === "square") {
                  const side = Number(node.attrs.width);
                  const height = Number(node.attrs.height);
                  expect(side).toBeCloseTo(referenceRadius[`${count}-${size}`] * Math.SQRT2, 6);
                  expect(height).toBeCloseTo(referenceRadius[`${count}-${size}`] * Math.SQRT2, 6);
                }

                expect(renderRadius(node)).toBeCloseTo(referenceRadius[`${count}-${size}`], 1);
              }
            }
          }
        }
      }
    }
  });
});

describe("compose-image layout invariants", () => {
  it("renders every embedded CellGraphic with the shared inner inset", async () => {
    const puzzle = firstOfType("operatorInduction");
    const svg = await puzzleToSvg(puzzle);
    const re = /<rect\b([^>]*?)\/>\s*<svg\b([^>]*?)>/g;

    let hasCell = false;
    let match: RegExpExecArray | null;
    while ((match = re.exec(svg)) !== null) {
      const rectAttrs = parseAttributes(match[1]);
      const nestedAttrs = parseAttributes(match[2]);

      if (rectAttrs.fill !== "#ffffff" || rectAttrs.stroke !== "#9ca3af") continue;
      if (nestedAttrs.viewBox !== `0 0 ${CELL_VIEWBOX} ${CELL_VIEWBOX}`) continue;

      hasCell = true;
      const rectX = Number(rectAttrs.x);
      const rectY = Number(rectAttrs.y);
      const rectW = Number(rectAttrs.width);
      const rectH = Number(rectAttrs.height);
      const nestedX = Number(nestedAttrs.x);
      const nestedY = Number(nestedAttrs.y);
      const nestedW = Number(nestedAttrs.width);
      const nestedH = Number(nestedAttrs.height);

      expect(nestedX).toBeCloseTo(rectX + CELL_CANVAS_PADDING, 6);
      expect(nestedY).toBeCloseTo(rectY + CELL_CANVAS_PADDING, 6);
      expect(nestedW).toBeCloseTo(rectW - CELL_CANVAS_PADDING * 2, 6);
      expect(nestedH).toBeCloseTo(rectH - CELL_CANVAS_PADDING * 2, 6);
      expect(nestedW).toBeCloseTo(nestedH, 6);
      expect(nestedW).toBeGreaterThan(0);
      expect(rectW).toBeCloseTo(rectH, 6);
    }

    expect(hasCell).toBe(true);
  });

  it("keeps operator triads in stem rows equally sized and equally spaced", async () => {
    const puzzle = firstOfType("operatorInduction");
    const rowCount = puzzle.stem.length / 3;
    const svg = await puzzleToSvg(puzzle);

    const framedCells = Array.from(svg.matchAll(/<rect\b([^>]*?)\/>/g))
      .map((match) => parseAttributes(match[1]))
      .filter((rect) => rect.fill === "#ffffff" && rect.stroke === "#9ca3af")
      .map((rect) => ({
        x: Number(rect.x),
        y: Number(rect.y),
        w: Number(rect.width),
        h: Number(rect.height),
      }))
      .filter((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.w > 0 && rect.h > 0)
      .sort((a, b) => a.y - b.y || a.x - b.x);

    expect(framedCells.length).toBeGreaterThan(0);

    const rowWidth = Math.max(...framedCells.map((cell) => cell.w));
    const stemCells = framedCells.filter(
      (cell) => Math.abs(cell.w - rowWidth) < 0.001 && Math.abs(cell.h - rowWidth) < 0.001,
    );
    expect(stemCells.length).toBeGreaterThan(0);

    const rows: Array<Array<(typeof stemCells)[number]>> = [];
    for (const cell of stemCells) {
      const row = rows[rows.length - 1];
      if (!row || Math.abs(cell.y - row[0].y) > 0.5) {
        rows.push([cell]);
      } else {
        row.push(cell);
      }
    }

    expect(rows.length).toBeGreaterThanOrEqual(rowCount);
    const stemRows = rows.slice(0, rowCount);

    let step = 0;
    for (const row of stemRows) {
      expect(row).toHaveLength(3);
      const xs = row.map((cell) => cell.x).sort((a, b) => a - b);
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);

      const s1 = xs[1] - xs[0];
      const s2 = xs[2] - xs[1];
      expect(s1).toBeCloseTo(s2, 6);
      if (step === 0) step = s1;
      else expect(s1).toBeCloseTo(step, 6);
    }
  });
});

describe("compose-image composition contract", () => {
  it("draws every stem and option cell by calling render.CellGraphic", async () => {
    const calls: Cell[] = [];

    vi.resetModules();
    vi.doMock<typeof import("./render")>("./render", async () => {
      const actual = await vi.importActual<typeof import("./render")>("./render");
      return {
        ...actual,
        CellGraphic: vi.fn((props: { cell: Cell; className?: string }) => {
          calls.push({ ...props.cell });
          return actual.CellGraphic(props);
        }),
      };
    });

    const base = firstOfType("matrix");
    const puzzle = {
      ...base,
      id: "render-cell-graphic-guard",
      explanation: "guard test",
      instruction: "guard",
    } as Puzzle;

    const { puzzleToSvg } = await import("./compose-image");
    const svg = puzzleToSvg(puzzle);
    expect(svg).toContain("<svg");

    const expectedCalls = puzzle.options.length + puzzle.stem.filter((panel) => !isBlank(panel)).length;
    expect(calls).toHaveLength(expectedCalls);
  });
});
