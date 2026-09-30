import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ANALOGY_DOUBLE_COLON_WIDTH,
  ANALOGY_STRIP_GAP,
  CELL_CANVAS_PADDING,
  CELL_VIEWBOX,
  GATE_GLYPH_WIDTH,
  GATE_SEPARATOR_WIDTH,
  GATE_STRIP_FRAME,
  GATE_STRIP_GAP,
  NARROW_VIEWPORT_STEM_WIDTH,
  UNSEPARATED_GATE_GLYPH_COUNT,
  WIDE_GATE_GLYPH_WIDTH,
  WIDE_GATE_SEPARATOR_WIDTH,
  SCENE_BOARD_INSET,
  SCENE_CONNECTION_STROKE,
  SceneGraphic,
  CellGraphic,
  StemView,
  analogyPairWidth,
  describeCell,
  gateGlyphs,
  gateStripWidth,
} from "./render";
import { loadBank } from "./bank";
import {
  GATE_STRIP_COLUMNS,
  GATE_STRIP_ROWS,
  MAXIMUM_GATE_STRIP_COLUMNS,
  isBlank,
  type Cell,
  type Puzzle,
  type PublicPuzzle,
  type PuzzleType,
  type Scene,
  type SceneToken,
  type Visual,
  SHAPES,
  FILLS,
  SIZES,
  ROTATIONS,
} from "./schema";

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** Cell literal builder shared by the two hand-authored fixtures below. */
function fx(shape: Cell["shape"], count: Cell["count"], fill: Cell["fill"]): Cell {
  return { shape, count, rotation: 0, fill, size: "m" };
}

/**
 * The live scene-family assembler (scene-families-v19) never produces
 * "oddOneOut" or "operatorInduction" puzzles, and the bank holds no items of
 * either type — both were retired legacy-generator-only families. These two
 * literal fixtures exist only so the tests below can still exercise the
 * `row`/`operatorTable` renderer paths in render.tsx / compose-image.tsx,
 * which are kept on purpose (see CLAUDE.md).
 */
const ODD_ONE_OUT_FIXTURE: Puzzle = {
  id: "fixture-odd-one-out",
  type: "oddOneOut",
  instruction: "Which one does not belong?",
  difficulty: 3,
  layout: "row",
  stem: [],
  options: [fx("square", 1, "solid"), fx("square", 2, "solid"), fx("circle", 2, "solid"), fx("square", 3, "solid")],
  answerIndex: 2,
  explanation: "Three options are squares; one is a circle.",
};

const OPERATOR_INDUCTION_FIXTURE: Puzzle = {
  id: "fixture-operator-induction",
  type: "operatorInduction",
  instruction: "Infer the visual operation. Which output completes the last row?",
  difficulty: 4,
  layout: "operatorTable",
  operatorLegend: { shapeCycle: ["circle", "square", "triangle"] },
  stem: [
    fx("circle", 1, "solid"), fx("square", 2, "solid"), fx("triangle", 1, "solid"),
    fx("square", 1, "outline"), fx("circle", 2, "outline"), fx("triangle", 2, "outline"),
    fx("triangle", 1, "half"), fx("square", 3, "half"), fx("circle", 3, "half"),
    fx("circle", 1, "outline"), fx("square", 1, "outline"), { blank: true },
  ],
  options: [fx("circle", 1, "solid"), fx("square", 1, "solid"), fx("triangle", 1, "solid"), fx("circle", 2, "outline")],
  answerIndex: 0,
  explanation: "Fixture only — the live app never generates this puzzle type.",
};

const LEGACY_TYPE_FIXTURES: Partial<Record<PuzzleType, Puzzle>> = {
  oddOneOut: ODD_ONE_OUT_FIXTURE,
  operatorInduction: OPERATOR_INDUCTION_FIXTURE,
};

function renderCell(cell: Cell): string {
  return renderToStaticMarkup(createElement(CellGraphic, { cell }));
}

function sceneToken(shape: SceneToken["shape"] = "circle", fill: SceneToken["fill"] = "solid"): SceneToken {
  return { kind: "token", shape, rotation: 0, fill, size: "l" };
}

const representativeScene: Scene = {
  kind: "scene",
  rows: 2,
  columns: 2,
  objects: [
    { row: 0, column: 1, object: sceneToken("triangle", "half") },
    {
      row: 1,
      column: 0,
      object: { kind: "container", shape: "circle", contents: [{ ...sceneToken("star"), size: "m" }] },
    },
  ],
  tiles: [{ row: 1, column: 1, edges: ["north", "west"] }],
};

function sceneAt(row: number, column: number, shape: SceneToken["shape"] = "circle"): Scene {
  return {
    kind: "scene",
    rows: 2,
    columns: 2,
    objects: [{ row, column, object: sceneToken(shape) }],
    tiles: [],
  };
}

const scenePuzzle: Puzzle<Visual> = {
  id: "scene-renderer",
  type: "sequence",
  instruction: "What comes next?",
  difficulty: 3,
  layout: "row",
  stem: [sceneAt(0, 0), representativeScene, sceneAt(1, 0, "square"), { blank: true }],
  options: [sceneAt(0, 1), sceneAt(1, 1), sceneAt(0, 0, "diamond"), representativeScene],
  answerIndex: 0,
  explanation: "The token moves to the next board position.",
};

function firstOfType(type: PuzzleType): Puzzle {
  const bankHit = loadBank().find((item) => item.puzzle.type === type);
  if (bankHit) return bankHit.puzzle;
  const fixture = LEGACY_TYPE_FIXTURES[type];
  if (!fixture) throw new Error(`no bank item or fixture for puzzle type ${type}`);
  return fixture;
}

async function puzzleToSvg(puzzle: Puzzle<Visual> | PublicPuzzle<Visual>) {
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

describe("SceneGraphic geometry and composition", () => {
  it("uses the exact same scene markup in the browser and standalone-image paths", async () => {
    const direct = renderToStaticMarkup(createElement(SceneGraphic, { scene: representativeScene }));
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: scenePuzzle }));
    const composed = await puzzleToSvg(scenePuzzle);

    expect(composed).toContain(direct);
    expect(browser).toContain('data-scene-kind="token"');
    expect(browser).toContain('data-scene-kind="container"');
    expect(browser).toContain('data-scene-kind="connection"');
    expect(direct).toContain('data-scene-kind="token"');
    expect(direct).toContain('data-scene-kind="container"');
    expect(direct).toContain('data-scene-kind="connection"');
  });

  it("maps positions and connection edges to explicit board geometry", () => {
    const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene: representativeScene }));
    const boardSize = CELL_VIEWBOX - SCENE_BOARD_INSET * 2;
    const slot = boardSize / 2;
    const tileCenter = {
      x: SCENE_BOARD_INSET + 1.5 * slot,
      y: SCENE_BOARD_INSET + 1.5 * slot,
    };

    const north = /<line data-connection-edge="north"([^>]*)(?:\/>|><\/line>)/.exec(svg);
    const west = /<line data-connection-edge="west"([^>]*)(?:\/>|><\/line>)/.exec(svg);
    expect(north).not.toBeNull();
    expect(west).not.toBeNull();
    const northAttrs = parseAttributes(north?.[1] ?? "");
    const westAttrs = parseAttributes(west?.[1] ?? "");

    expect(Number(northAttrs.x1)).toBeCloseTo(tileCenter.x, 6);
    expect(Number(northAttrs.y1)).toBeCloseTo(tileCenter.y, 6);
    expect(Number(northAttrs.x2)).toBeCloseTo(tileCenter.x, 6);
    expect(Number(northAttrs.y2)).toBeCloseTo(SCENE_BOARD_INSET + slot, 6);
    expect(Number(westAttrs.x2)).toBeCloseTo(SCENE_BOARD_INSET + slot, 6);
    expect(Number(westAttrs.y2)).toBeCloseTo(tileCenter.y, 6);
  });

  it("keeps medium board tokens and path strokes legible at the 80px solve and 64px review sizes", () => {
    const smallestSlot = (CELL_VIEWBOX - SCENE_BOARD_INSET * 2) / 3;
    for (const displayedSize of [80, 64]) {
      const optionScale = displayedSize / CELL_VIEWBOX;
      const mediumTokenDiameter = smallestSlot * 0.3 * 2 * optionScale;
      const pathStroke = SCENE_CONNECTION_STROKE * optionScale;
      expect(mediumTokenDiameter).toBeGreaterThan(10);
      expect(pathStroke).toBeGreaterThan(3.5);
    }
  });
});

describe("compose-image layout invariants", () => {
  it("renders every embedded CellGraphic with the shared inner inset", async () => {
    const puzzle = firstOfType("operatorInduction");
    const svg = await puzzleToSvg(puzzle);
    const groups = Array.from(svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g));

    let hasCell = false;
    for (const [, inner] of groups) {
      const rectMatch = /<rect\b([^>]*?)(?:\/>|>[\s\S]*?<\/rect>)/.exec(inner);
      if (!rectMatch) continue;
      const rectAttrs = parseAttributes(rectMatch[1]);
      if (rectAttrs.fill !== "#ffffff" || rectAttrs.stroke !== "#9ca3af") continue;

      const tail = inner.slice((rectMatch.index ?? 0) + rectMatch[0].length);
      const nestedMatch = /<svg\b([^>]*?)>/.exec(tail);
      if (!nestedMatch) continue;
      const nestedAttrs = parseAttributes(nestedMatch[1]);
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

    const framedCells = Array.from(svg.matchAll(/<rect\b([^>]*?)(?:\/>|>[\s\S]*?<\/rect>)/g))
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
  it("draws every stem and option through render.VisualGraphic", async () => {
    const calls: Visual[] = [];

    vi.resetModules();
    vi.doMock("./render", async () => {
      const actual = await vi.importActual<typeof import("./render")>("./render");
      return {
        ...actual,
        VisualGraphic: vi.fn((props: { visual: Visual; className?: string }) => {
          calls.push(props.visual);
          return actual.VisualGraphic(props);
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

    // Every option and every drawn stem panel goes through the shared renderer.
    // A machine gate is the one panel that draws as more than one graphic: each
    // of its glyphs gets a cell of its own, and each of those is one call.
    const gatePanels = puzzle.layout === "machineTable"
      ? puzzle.stem.filter((_, index) => index % 3 === 1)
      : [];
    const extraGateGlyphs = gatePanels.reduce((total, panel) => total + gateGlyphs(panel).length - 1, 0);
    const expectedCalls =
      puzzle.options.length + puzzle.stem.filter((panel) => !isBlank(panel)).length + extraGateGlyphs;
    expect(calls).toHaveLength(expectedCalls);
  });
});

describe("scene-only arrow rendering", () => {
  const arrowToken = (rotation: number, size: SceneToken["size"] = "l", fill: SceneToken["fill"] = "solid"): SceneToken =>
    ({ kind: "token", shape: "arrow", rotation, fill, size });

  /** One arrow on the tightest board the renderer serves (3 columns). */
  const arrowBoard = (rotation: number, size: SceneToken["size"] = "l", fill: SceneToken["fill"] = "solid"): Scene => ({
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: [{ row: 1, column: 1, object: arrowToken(rotation, size, fill) }],
    tiles: [],
  });

  const arrowPuzzle: Puzzle<Visual> = {
    id: "arrow-renderer",
    type: "sequence",
    instruction: "What comes next?",
    difficulty: 3,
    layout: "row",
    stem: [arrowBoard(0), arrowBoard(90), arrowBoard(180), { blank: true }],
    options: [arrowBoard(270), arrowBoard(0), arrowBoard(90), arrowBoard(180)],
    answerIndex: 0,
    explanation: "The arrow turns a quarter clockwise each step.",
  };

  /** The arrow is the only 7-point polygon the renderer draws. */
  function arrowNodes(svg: string) {
    return shapeNodesFromSvg(svg)
      .filter((node) => node.tag === "polygon" && parsePoints(node.attrs.points ?? "").length === 7);
  }

  it("draws an arrow polygon in the browser path and the agent-image path alike", async () => {
    const direct = renderToStaticMarkup(createElement(SceneGraphic, { scene: arrowBoard(0) }));
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: arrowPuzzle }));
    const composed = await puzzleToSvg(arrowPuzzle);

    expect(arrowNodes(direct)).toHaveLength(1);
    expect(arrowNodes(browser)).toHaveLength(3);
    expect(arrowNodes(composed)).toHaveLength(7); // 3 stem panels + 4 options
    expect(composed).toContain(direct);
  });

  it("points up at rotation 0 and carries every quarter turn on the shared transform", () => {
    for (const rotation of ROTATIONS) {
      const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene: arrowBoard(rotation) }));
      const [node] = arrowNodes(svg);
      expect(node).toBeDefined();

      // The arrow turns about its board slot's centre, not its vertex centroid
      // (the glyph is deliberately top-heavy), so derive the centre from the board.
      const slot = (CELL_VIEWBOX - SCENE_BOARD_INSET * 2) / 3;
      const center = { x: SCENE_BOARD_INSET + 1.5 * slot, y: SCENE_BOARD_INSET + 1.5 * slot };
      const points = parsePoints(node.attrs.points ?? "");
      const tip = points.reduce((best, point) => (point.y < best.y ? point : best));

      // Orientation convention: 0 draws the arrow pointing UP (smallest y is the
      // tip, straight above the centre); the rotate transform turns it clockwise.
      expect(tip.x).toBeCloseTo(center.x, 1);
      expect(tip.y).toBeLessThan(center.y);

      const transform = parseRotation(node.attrs.transform);
      expect(transform?.angle).toBe(rotation);
      expect(transform?.x).toBeCloseTo(center.x, 6);
      expect(transform?.y).toBeCloseTo(center.y, 6);
    }
  });

  it("supports every fill on the arrow", () => {
    for (const fill of FILLS) {
      const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene: arrowBoard(90, "l", fill) }));
      const [node] = arrowNodes(svg);
      const expected = styleFor(fill);
      expect(node.attrs.fill).toBe(expected.fill);
      expect(node.attrs.stroke).toBe(expected.stroke);
      expect(Number(node.attrs["stroke-width"])).toBe(expected.strokeWidth);
    }
  });

  it("keeps the head, stem, and length legible at the 80px solve and 64px review sizes", () => {
    // Worst case the renderer can serve: the smallest token on the tightest board.
    const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene: arrowBoard(0, "m") }));
    const [node] = arrowNodes(svg);
    const points = parsePoints(node.attrs.points ?? "");
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const length = Math.max(...ys) - Math.min(...ys);
    const headWidth = Math.max(...xs) - Math.min(...xs);
    const tail = [...points].sort((a, b) => b.y - a.y).slice(0, 2);
    const stemWidth = Math.abs(tail[0].x - tail[1].x);

    expect(stemWidth).toBeLessThan(headWidth); // it reads as an arrow, not a bar

    for (const displayedSize of [80, 64]) {
      const optionScale = displayedSize / CELL_VIEWBOX;
      expect(length * optionScale).toBeGreaterThan(10);
      expect(headWidth * optionScale).toBeGreaterThan(7);
      expect(stemWidth * optionScale).toBeGreaterThan(3);
    }
  });
});

describe("machine gates and wide stem rows", () => {
  const gateScene = (...tokens: Array<[SceneToken["shape"], SceneToken["fill"]]>): Scene => ({
    kind: "scene",
    rows: 3,
    columns: 3,
    tiles: [],
    // Deliberately out of column order: the renderer, not the data, decides the
    // reading order of a combined gate.
    objects: [...tokens].reverse().map(([shape, fill], reversedIndex) => ({
      row: 1,
      column: tokens.length - 1 - reversedIndex,
      object: sceneToken(shape, fill),
    })),
  });

  const gateA = gateScene(["triangle", "outline"]);
  const gateB = gateScene(["square", "solid"]);
  const gateC = gateScene(["diamond", "half"]);
  const queryGate = gateScene(["triangle", "outline"], ["square", "solid"], ["diamond", "half"]);

  const machinePuzzle: Puzzle<Visual> = {
    id: "machine-renderer",
    type: "matrix",
    instruction: "Apply the gates left to right.",
    difficulty: 4,
    layout: "machineTable",
    stem: [
      sceneAt(0, 0), gateA, sceneAt(0, 1),
      sceneAt(1, 0), gateB, sceneAt(1, 1),
      sceneAt(0, 0, "square"), gateC, sceneAt(0, 1, "square"),
      sceneAt(1, 0, "star"), queryGate, { blank: true },
    ],
    options: [sceneAt(0, 1, "star"), sceneAt(1, 1, "star"), sceneAt(0, 0, "diamond")],
    answerIndex: 0,
    explanation: "Each worked row shows one gate.",
  };

  const longRowPuzzle: Puzzle<Visual> = {
    id: "long-row-renderer",
    type: "sequence",
    instruction: "What comes next?",
    difficulty: 4,
    layout: "row",
    stem: [
      sceneAt(0, 0), sceneAt(0, 1), sceneAt(1, 0), sceneAt(1, 1),
      sceneAt(0, 0, "square"), sceneAt(0, 1, "square"), sceneAt(1, 0, "square"), { blank: true },
    ],
    options: [sceneAt(1, 1, "square"), sceneAt(0, 0, "star"), sceneAt(0, 1, "star")],
    answerIndex: 0,
    explanation: "The token walks the board.",
  };

  /**
   * The frames a composed image draws around its cells: the plain grey cell
   * boxes and the dashed gate frames. Board rectangles inside a scene are drawn
   * in their own nested coordinate space and are excluded by their stroke.
   */
  function framedBoxes(svg: string) {
    return Array.from(svg.matchAll(/<rect\b([^>]*?)(?:\/>|>[\s\S]*?<\/rect>)/g))
      .map((match) => parseAttributes(match[1]))
      .filter((rect) => rect.fill === "#ffffff" && (rect.stroke === "#9ca3af" || Boolean(rect["stroke-dasharray"])))
      .map((rect) => ({
        x: Number(rect.x),
        y: Number(rect.y),
        w: Number(rect.width),
        h: Number(rect.height),
        dashed: Boolean(rect["stroke-dasharray"]),
      }));
  }

  it("reads a combined gate as one drawable per glyph, in application order", () => {
    expect(gateGlyphs(queryGate).map((glyph) => (glyph as Cell).shape)).toEqual([
      "triangle",
      "square",
      "diamond",
    ]);
    expect(gateGlyphs(queryGate).map((glyph) => (glyph as Cell).fill)).toEqual([
      "outline",
      "solid",
      "half",
    ]);
    expect(gateGlyphs(gateA)).toHaveLength(1);
    expect(gateGlyphs({ blank: true })).toHaveLength(0);
    // A board that is not a bare row of tokens is left whole for the scene renderer.
    expect(gateGlyphs(representativeScene)).toEqual([representativeScene]);
  });

  it("draws every gate glyph at cell scale in both paths", async () => {
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: machinePuzzle }));
    const composed = await puzzleToSvg(machinePuzzle);

    // One full-size drawing per glyph, worked and combined alike — a glyph drawn
    // as a token on a board would carry the board's aria-label instead.
    for (const glyph of gateGlyphs(queryGate)) {
      const label = describeCell(glyph as Cell);
      expect(browser).toContain(`aria-label="${label}"`);
      expect((composed.match(new RegExp(`aria-label="${label}"`, "g")) ?? []).length).toBe(2);
    }

    const boxes = framedBoxes(composed);
    const glyphCells = boxes.filter((box) => !box.dashed && Math.abs(box.w - 110) < 0.001);
    const frames = boxes.filter((box) => box.dashed);
    expect(frames).toHaveLength(4); // three worked gates plus the combined query gate
    // The combined frame is the wide one; every glyph inside it is a whole cell.
    const combined = frames.reduce((widest, frame) => (frame.w > widest.w ? frame : widest));
    const inside = glyphCells.filter((cell) =>
      cell.x > combined.x && cell.x + cell.w < combined.x + combined.w &&
      cell.y > combined.y && cell.y + cell.h < combined.y + combined.h);
    expect(inside).toHaveLength(3);
    const order = inside.map((cell) => cell.x).sort((a, b) => a - b);
    expect(order[1] - order[0]).toBeCloseTo(order[2] - order[1], 6);
  });

  it("keeps every composed stem row inside the canvas and wraps what does not fit", async () => {
    for (const puzzle of [machinePuzzle, longRowPuzzle]) {
      const svg = await puzzleToSvg(puzzle);
      const canvasWidth = Number(parseAttributes(/<svg\b([^>]*)>/.exec(svg)?.[1] ?? "").width);
      for (const box of framedBoxes(svg)) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(canvasWidth);
      }
    }

    // Eight panels do not fit one 800px line, so they wrap into two even lines.
    const rows = new Map<number, number>();
    for (const box of framedBoxes(await puzzleToSvg(longRowPuzzle))) {
      rows.set(box.y, (rows.get(box.y) ?? 0) + 1);
    }
    const stemLines = [...rows.entries()].sort((a, b) => a[0] - b[0]).slice(0, 2);
    expect(stemLines.map(([, count]) => count)).toEqual([4, 4]);
  });

  it("wraps a long sequence row so every term stays on screen at once", () => {
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: longRowPuzzle }));
    // A sequence is compared term against term, so scrolling term 1 out of view
    // to read term 8 defeats the puzzle. Its panels fold onto another line
    // instead — there are no glued pairs here for a line break to split.
    expect(browser).toContain("flex-wrap");
    expect(browser).not.toContain("w-max");
    // Wrapped content never overflows, so no edge marker is ever claimed.
    expect(browser).not.toContain("data-strip-edge");
  });

  it("wraps a clipped analogy strip at '::' instead of scrolling it", () => {
    // An analogy's `A : B :: C : ?` panels are glued in pairs. A 375px phone
    // cannot fit the whole line (`analogyPairWidth()` prices one pair against
    // the same NARROW_VIEWPORT_STEM_WIDTH budget the gate strip uses above),
    // so the two pairs wrap onto their own line at "::" instead of scrolling
    // — scrolling the first pair out of view would defeat the comparison the
    // puzzle asks for. Neither pair itself ever splits.
    expect(analogyPairWidth()).toBe(192);
    expect(analogyPairWidth()).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    const secondGroupWidth = ANALOGY_DOUBLE_COLON_WIDTH + ANALOGY_STRIP_GAP + analogyPairWidth();
    const unwrappedLineWidth = analogyPairWidth() + ANALOGY_STRIP_GAP + secondGroupWidth;
    expect(unwrappedLineWidth).toBeGreaterThan(NARROW_VIEWPORT_STEM_WIDTH);

    const analogyPuzzle: Puzzle<Visual> = {
      ...longRowPuzzle,
      id: "long-analogy-renderer",
      type: "analogy",
      layout: "analogy",
      stem: [sceneAt(0, 0), sceneAt(0, 1), sceneAt(1, 0), { blank: true }],
    };
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: analogyPuzzle }));
    // The outer strip wraps below `sm:` and stops wrapping from `sm:` up; each
    // pair is its own non-wrapping flex item, so a wrap can only ever land
    // between the two pairs, never inside one.
    expect(browser).toContain("flex-wrap");
    expect(browser).toContain("sm:flex-nowrap");
    // Exactly the two pair groups carry an unprefixed flex-nowrap; the outer
    // container's own nowrap is prefixed (sm:flex-nowrap) and must not count.
    expect((browser.match(/(?<!sm:)flex-nowrap/g) ?? []).length).toBe(2);
    expect(browser).not.toContain("overflow-x-auto");
    expect(browser).not.toContain("data-strip-edge");
  });
});

describe("the four-gate machine table", () => {
  const gateGlyph = (shape: SceneToken["shape"], fill: SceneToken["fill"]): SceneToken =>
    ({ kind: "token", shape, rotation: 0, fill, size: "l" });

  /** One worked gate: the ordinary board, glyph in the middle row's first slot. */
  const workedGate = (shape: SceneToken["shape"], fill: SceneToken["fill"]): Scene => ({
    kind: "scene",
    rows: 3,
    columns: 3,
    tiles: [],
    objects: [{ row: 1, column: 0, object: gateGlyph(shape, fill) }],
  });

  /** The four-gate query strip: the one wide board the schema allows. */
  const queryStrip: Scene = {
    kind: "scene",
    rows: GATE_STRIP_ROWS,
    columns: GATE_STRIP_COLUMNS,
    tiles: [],
    objects: ([
      ["triangle", "outline"],
      ["square", "solid"],
      ["diamond", "half"],
      ["star", "outline"],
    ] as const).map(([shape, fill], column) => ({ row: 0, column, object: gateGlyph(shape, fill) })),
  };

  /** Fifteen panels: four worked (input, gate, output) rows plus the query row. */
  const fourGatePuzzle: Puzzle<Visual> = {
    id: "four-gate-machine",
    type: "matrix",
    instruction: "Apply the four gates left to right.",
    difficulty: 5,
    layout: "machineTable",
    stem: [
      sceneAt(0, 0), workedGate("triangle", "outline"), sceneAt(0, 1),
      sceneAt(1, 0), workedGate("square", "solid"), sceneAt(1, 1),
      sceneAt(0, 0, "square"), workedGate("diamond", "half"), sceneAt(0, 1, "square"),
      sceneAt(1, 0, "star"), workedGate("star", "outline"), sceneAt(1, 1, "star"),
      sceneAt(0, 0, "diamond"), queryStrip, { blank: true },
    ],
    options: [sceneAt(0, 1, "diamond"), sceneAt(1, 1, "diamond"), sceneAt(1, 0, "diamond")],
    answerIndex: 0,
    explanation: "Each worked row shows one gate.",
  };

  function framedBoxes(svg: string) {
    return Array.from(svg.matchAll(/<rect\b([^>]*?)(?:\/>|>[\s\S]*?<\/rect>)/g))
      .map((match) => parseAttributes(match[1]))
      .filter((rect) => rect.fill === "#ffffff" && (rect.stroke === "#9ca3af" || Boolean(rect["stroke-dasharray"])))
      .map((rect) => ({
        x: Number(rect.x),
        y: Number(rect.y),
        w: Number(rect.width),
        h: Number(rect.height),
        dashed: Boolean(rect["stroke-dasharray"]),
      }));
  }

  it("reads the wide strip as four glyphs in application order", () => {
    expect(gateGlyphs(queryStrip).map((glyph) => (glyph as Cell).shape))
      .toEqual(["triangle", "square", "diamond", "star"]);
    expect(gateGlyphs(queryStrip).map((glyph) => (glyph as Cell).fill))
      .toEqual(["outline", "solid", "half", "outline"]);
    // Four glyphs, no two alike: the strip is only readable if each gate's
    // label is unmistakable at the size the strip draws it.
    expect(new Set(gateGlyphs(queryStrip).map((glyph) => describeCell(glyph as Cell))).size).toBe(4);
  });

  it("fits one row of four glyphs in the width a 375px phone actually has", () => {
    // 4 glyph cells at 44px, 3 arrow columns at 14px, 6 gaps at 4px, and the
    // dashed frame's 6px each side: 254px inside the 261px a machine row gets.
    expect(gateStripWidth(4)).toBe(254);
    expect(gateStripWidth(4)).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    // Three glyphs keep the full 56px cell and still fit, so widening the strip
    // did not cost the shapes the battery already serves anything.
    expect(gateStripWidth(3)).toBe(236);
    expect(gateStripWidth(3)).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    expect(gateStripWidth(1)).toBe(68);

    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: fourGatePuzzle }));
    // The strip never wraps: a wrapped strip stops reading as one ordered
    // program. The classes below are the widths measured above.
    expect(browser).toContain("flex-nowrap");
    expect(browser).not.toContain("flex-wrap items-center justify-center gap-1 rounded-2xl");
    expect(browser).toContain("w-11 sm:w-16");
    expect(browser).toContain("w-3.5 text-sm");
    expect(browser).toContain('aria-label="4 gates, applied left to right"');
    // The machine row itself wraps, so a strip too wide to sit beside its input
    // takes a line of its own rather than pushing the row off the screen.
    expect(browser).toContain("flex w-full flex-wrap items-center justify-center");
    // Every glyph is drawn at cell scale, as its own graphic.
    for (const glyph of gateGlyphs(queryStrip)) {
      expect(browser).toContain(`aria-label="${describeCell(glyph as Cell)}"`);
    }

    // The QA finding this replaces packed two or three glyphs into one 50–55px
    // gate cell, leaving each about 18px on a phone. Even the narrowest strip
    // gives every glyph a 44px cell of its own, and the shape inside spans most
    // of it, so the drawn glyph is still far larger than the one the mobile
    // taker could not read.
    for (const glyph of gateGlyphs(queryStrip)) {
      const nodes = shapeNodesFromSvg(renderToStaticMarkup(
        createElement(CellGraphic, { cell: glyph as Cell }),
      ));
      const drawn = nodes.filter((node) => node.tag !== "rect" || node.attrs.points === undefined);
      const spans = drawn.map((node) => {
        if (node.tag === "circle") return Number(node.attrs.r) * 2;
        if (node.tag === "rect") return Number(node.attrs.width);
        const points = parsePoints(node.attrs.points ?? "");
        return Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
      });
      const widestViewBoxSpan = Math.max(...spans);
      expect(widestViewBoxSpan * (WIDE_GATE_GLYPH_WIDTH / CELL_VIEWBOX), describeCell(glyph as Cell))
        .toBeGreaterThan(24);
    }
  });

  it("keeps all fifteen panels inside the agent canvas, the strip on one line", async () => {
    const svg = await puzzleToSvg(fourGatePuzzle);
    const canvasWidth = Number(parseAttributes(/<svg\b([^>]*)>/.exec(svg)?.[1] ?? "").width);
    const boxes = framedBoxes(svg);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(canvasWidth);
    }

    // Five dashed frames: four worked gates and the query strip.
    const frames = boxes.filter((box) => box.dashed);
    expect(frames).toHaveLength(5);
    const strip = frames.reduce((widest, frame) => (frame.w > widest.w ? frame : widest));
    const glyphCells = boxes.filter((box) => !box.dashed && Math.abs(box.w - 110) < 0.001);
    const inside = glyphCells.filter((cell) =>
      cell.x > strip.x && cell.x + cell.w < strip.x + strip.w &&
      cell.y > strip.y && cell.y + cell.h < strip.y + strip.h);
    expect(inside).toHaveLength(4);
    // One line: every glyph shares a row, evenly spaced left to right.
    expect(new Set(inside.map((cell) => cell.y)).size).toBe(1);
    const columns = inside.map((cell) => cell.x).sort((left, right) => left - right);
    expect(columns[1] - columns[0]).toBeCloseTo(columns[2] - columns[1], 6);
    expect(columns[2] - columns[1]).toBeCloseTo(columns[3] - columns[2], 6);
    // No two panels overlap anywhere on the canvas.
    for (let left = 0; left < boxes.length; left++) {
      for (let right = left + 1; right < boxes.length; right++) {
        const a = boxes[left];
        const b = boxes[right];
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        // A dashed frame legitimately contains its own glyph cells.
        const nests = (outer: typeof a, inner: typeof b) =>
          outer.dashed && !inner.dashed &&
          inner.x >= outer.x && inner.x + inner.w <= outer.x + outer.w &&
          inner.y >= outer.y && inner.y + inner.h <= outer.y + outer.h;
        expect(!overlaps || nests(a, b) || nests(b, a), `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`)
          .toBe(true);
      }
    }
  });

  /** The three-gate form: the query gate still fits an ordinary 3x3 board. */
  const threeGateStrip: Scene = {
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: ([
      ["triangle", "outline"],
      ["square", "solid"],
      ["diamond", "half"],
    ] as const).map(([shape, fill], column) => ({ row: 1, column, object: gateGlyph(shape, fill) })),
    tiles: [],
  };

  const threeGatePuzzle: Puzzle<Visual> = {
    ...fourGatePuzzle,
    id: "three-gate-machine",
    instruction: "Apply the three gates left to right.",
    difficulty: 4,
    stem: [
      sceneAt(0, 0), workedGate("triangle", "outline"), sceneAt(0, 1),
      sceneAt(1, 0), workedGate("square", "solid"), sceneAt(1, 1),
      sceneAt(0, 0, "square"), workedGate("diamond", "half"), sceneAt(0, 1, "square"),
      sceneAt(0, 0, "diamond"), threeGateStrip, { blank: true },
    ],
  };

  /**
   * Every dashed gate frame in a rendered stem, as markup.
   *
   * Depth-counted rather than matched with a regular expression: a frame holds
   * nested divs, and a non-greedy pattern stops at the first inner close.
   */
  function gateFrameMarkup(markup: string): string[] {
    const opener = '<div class="flex shrink-0 flex-nowrap';
    const frames: string[] = [];
    let index = markup.indexOf(opener);
    while (index !== -1) {
      let depth = 0;
      let cursor = index;
      while (cursor < markup.length) {
        if (markup.startsWith("<div", cursor)) { depth += 1; cursor += 4; continue; }
        if (markup.startsWith("</div>", cursor)) {
          depth -= 1;
          cursor += 6;
          if (depth === 0) break;
          continue;
        }
        cursor += 1;
      }
      frames.push(markup.slice(index, cursor));
      index = markup.indexOf(opener, cursor);
    }
    return frames;
  }

  /** The five-gate query strip and its eighteen-panel machine table (`-d6`). */
  const wideStrip: Scene = {
    kind: "scene",
    rows: GATE_STRIP_ROWS,
    columns: MAXIMUM_GATE_STRIP_COLUMNS,
    objects: ([
      ["triangle", "outline"],
      ["square", "solid"],
      ["diamond", "half"],
      ["star", "outline"],
      ["hexagon", "solid"],
    ] as const).map(([shape, fill], column) => ({ row: 0, column, object: gateGlyph(shape, fill) })),
    tiles: [],
  };

  const fiveGatePuzzle: Puzzle<Visual> = {
    ...fourGatePuzzle,
    id: "five-gate-machine",
    instruction: "Apply the five gates left to right.",
    difficulty: 6,
    stem: [
      sceneAt(0, 0), workedGate("triangle", "outline"), sceneAt(0, 1),
      sceneAt(1, 0), workedGate("square", "solid"), sceneAt(1, 1),
      sceneAt(0, 0, "square"), workedGate("diamond", "half"), sceneAt(0, 1, "square"),
      sceneAt(1, 0, "star"), workedGate("star", "outline"), sceneAt(1, 1, "star"),
      sceneAt(0, 0, "circle"), workedGate("hexagon", "solid"), sceneAt(0, 1, "circle"),
      sceneAt(0, 0, "diamond"), wideStrip, { blank: true },
    ],
  };

  it("measures the strip's width from the classes the markup really carries", () => {
    // `gateStripWidth` is only worth anything if it describes the DOM. Every
    // Tailwind width class the strip can emit is priced here and the total is
    // rebuilt from the rendered markup, so a class edited without its constant
    // fails this test instead of silently overflowing a phone.
    const classWidths: Record<string, number> = {
      "w-14": GATE_GLYPH_WIDTH,
      "w-11": WIDE_GATE_GLYPH_WIDTH,
      "w-5": GATE_SEPARATOR_WIDTH,
      "w-3.5": WIDE_GATE_SEPARATOR_WIDTH,
    };
    expect(classWidths).toEqual({ "w-14": 56, "w-11": 44, "w-5": 20, "w-3.5": 14 });
    expect(GATE_STRIP_GAP).toBe(4); // gap-1
    expect(GATE_STRIP_FRAME).toBe(6); // p-1 (4) plus border-2 (2), per side

    const strips: { glyphs: number; puzzle: Puzzle<Visual> }[] = [
      { glyphs: 1, puzzle: fourGatePuzzle },
      { glyphs: 3, puzzle: threeGatePuzzle },
      { glyphs: 4, puzzle: fourGatePuzzle },
      { glyphs: 5, puzzle: fiveGatePuzzle },
    ];
    for (const { glyphs, puzzle } of strips) {
      const markup = renderToStaticMarkup(createElement(StemView, { puzzle }));
      // The strip whose glyph count we are pricing: its dashed frame, its glyph
      // cells, and the arrow columns between them, as one rendered fragment.
      const frame = gateFrameMarkup(markup).find((candidate) =>
        (candidate.match(/aspect-square/g) ?? []).length === glyphs);
      expect(frame, `${glyphs} glyphs`).toBeDefined();
      const cells = [...frame!.matchAll(/class="shrink-0 (w-[\d.]+)(?: sm:w-\d+)?"/g)].map((m) => m[1]);
      const arrows = [...frame!.matchAll(/class="shrink-0 text-center text-gray-400 (w-[\d.]+)/g)].map((m) => m[1]);
      expect(cells, `${glyphs} glyphs`).toHaveLength(glyphs);
      const measured = [...cells, ...arrows].reduce((total, cls) => {
        expect(classWidths[cls], `unpriced width class ${cls}`).toBeDefined();
        return total + classWidths[cls];
      }, 0) + (cells.length + arrows.length - 1) * GATE_STRIP_GAP + GATE_STRIP_FRAME * 2;
      expect(measured, `${glyphs} glyphs`).toBe(gateStripWidth(glyphs));
      expect(measured, `${glyphs} glyphs at 375px`).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    }
  });

  it("fits one row of five glyphs in the width a 375px phone actually has", () => {
    // 5 glyph cells at 44px, no arrow columns, 4 gaps at 4px, and the dashed
    // frame's 6px each side: 248px inside the 261px a machine row gets.
    expect(gateStripWidth(5)).toBe(248);
    expect(gateStripWidth(5)).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    // The glyph does not shrink. Five 44px cells plus four readable arrow
    // columns cannot fit 261px at any arrow size, and the drawn mark inside a
    // 44px cell is already within a third of a pixel of this project's measured
    // legibility floor, so the arrows go and the mark stays.
    expect(UNSEPARATED_GATE_GLYPH_COUNT).toBe(5);
    expect(gateStripWidth(5) - gateStripWidth(4)).toBe(-6);
    const withArrows = 5 * WIDE_GATE_GLYPH_WIDTH + 4 * WIDE_GATE_SEPARATOR_WIDTH +
      8 * GATE_STRIP_GAP + GATE_STRIP_FRAME * 2;
    expect(withArrows).toBe(320);
    expect(withArrows).toBeGreaterThan(NARROW_VIEWPORT_STEM_WIDTH);

    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: fiveGatePuzzle }));
    expect(browser).toContain("flex-nowrap");
    expect(browser).toContain("w-11 sm:w-16");
    expect(browser).toContain('aria-label="5 gates, applied left to right"');
    // The ordering cue the dropped arrows carried is still stated: the machine
    // row's own arrows around the strip, the group label above, and the
    // instruction. What is gone is only the decoration between glyphs.
    expect(browser).not.toMatch(/text-center text-gray-400 w-3\.5/);
    for (const glyph of gateGlyphs(wideStrip)) {
      expect(browser).toContain(`aria-label="${describeCell(glyph as Cell)}"`);
    }
    // Five glyphs, no two alike at the size the strip draws them.
    expect(new Set(gateGlyphs(wideStrip).map((glyph) => describeCell(glyph as Cell))).size).toBe(5);

    // Every glyph is drawn at exactly the size a four-gate strip draws one, so
    // the fifth gate costs the reader nothing in mark size.
    for (const glyph of gateGlyphs(wideStrip)) {
      const nodes = shapeNodesFromSvg(renderToStaticMarkup(
        createElement(CellGraphic, { cell: glyph as Cell }),
      ));
      const drawn = nodes.filter((node) => node.tag !== "rect" || node.attrs.points === undefined);
      const spans = drawn.map((node) => {
        if (node.tag === "circle") return Number(node.attrs.r) * 2;
        if (node.tag === "rect") return Number(node.attrs.width);
        const points = parsePoints(node.attrs.points ?? "");
        return Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
      });
      const widestViewBoxSpan = Math.max(...spans);
      expect(widestViewBoxSpan * (WIDE_GATE_GLYPH_WIDTH / CELL_VIEWBOX), describeCell(glyph as Cell))
        .toBeGreaterThan(24);
    }
  });

  it("keeps all eighteen panels inside the agent canvas, the five-glyph strip on one line", async () => {
    const svg = await puzzleToSvg(fiveGatePuzzle);
    const canvasWidth = Number(parseAttributes(/<svg\b([^>]*)>/.exec(svg)?.[1] ?? "").width);
    expect(canvasWidth).toBe(800);
    const boxes = framedBoxes(svg);
    for (const box of boxes) {
      expect(box.x, JSON.stringify(box)).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w, JSON.stringify(box)).toBeLessThanOrEqual(canvasWidth);
    }

    // Six dashed frames: five worked gates and the query strip.
    const frames = boxes.filter((box) => box.dashed);
    expect(frames).toHaveLength(6);
    const strip = frames.reduce((widest, frame) => (frame.w > widest.w ? frame : widest));
    const glyphCells = boxes.filter((box) => !box.dashed && Math.abs(box.w - 110) < 0.001);
    const inside = glyphCells.filter((cell) =>
      cell.x > strip.x && cell.x + cell.w < strip.x + strip.w &&
      cell.y > strip.y && cell.y + cell.h < strip.y + strip.h);
    expect(inside).toHaveLength(5);
    // One line: every glyph shares a row, evenly spaced left to right, and the
    // cell is the same 110px a worked row's single gate gets.
    expect(new Set(inside.map((cell) => cell.y)).size).toBe(1);
    const columns = inside.map((cell) => cell.x).sort((left, right) => left - right);
    for (let index = 2; index < columns.length; index++) {
      expect(columns[index] - columns[index - 1]).toBeCloseTo(columns[1] - columns[0], 6);
    }
    // No two panels overlap anywhere on the canvas.
    for (let left = 0; left < boxes.length; left++) {
      for (let right = left + 1; right < boxes.length; right++) {
        const a = boxes[left];
        const b = boxes[right];
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const nests = (outer: typeof a, inner: typeof b) =>
          outer.dashed && !inner.dashed &&
          inner.x >= outer.x && inner.x + inner.w <= outer.x + outer.w &&
          inner.y >= outer.y && inner.y + inner.h <= outer.y + outer.h;
        expect(!overlaps || nests(a, b) || nests(b, a), `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`)
          .toBe(true);
      }
    }
  });

  it("draws one graphic per panel and per gate glyph", async () => {
    const calls: Visual[] = [];
    vi.resetModules();
    vi.doMock("./render", async () => {
      const actual = await vi.importActual<typeof import("./render")>("./render");
      return {
        ...actual,
        VisualGraphic: vi.fn((props: { visual: Visual; className?: string }) => {
          calls.push(props.visual);
          return actual.VisualGraphic(props);
        }),
      };
    });
    const { puzzleToSvg: composed } = await import("./compose-image");
    composed(fourGatePuzzle);
    vi.doUnmock("./render");
    vi.resetModules();

    // 14 drawn stem panels (the fifteenth is the blank) plus 3 options, and the
    // query strip draws four graphics rather than one, so it adds three.
    const drawnPanels = fourGatePuzzle.stem.filter((panel) => !isBlank(panel)).length;
    const extraGateGlyphs = fourGatePuzzle.stem
      .filter((_, index) => index % 3 === 1)
      .reduce((total, panel) => total + gateGlyphs(panel).length - 1, 0);
    expect(extraGateGlyphs).toBe(3);
    expect(calls).toHaveLength(drawnPanels + fourGatePuzzle.options.length + extraGateGlyphs);
    expect(calls).toHaveLength(14 + 3 + 3);
  });
});
