import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ANALOGY_ARROW_WIDTH,
  ANALOGY_PANEL_WIDTH,
  ANALOGY_ROW_GAP,
  ANALOGY_ROW_PADDING,
  CELL_CANVAS_PADDING,
  CELL_VIEWBOX,
  GATE_PIECE_WIDTH,
  GATE_STACK_WIDTH,
  JIGSAW_PIECE_HEIGHT,
  JIGSAW_PIECE_STEP,
  JIGSAW_PIECE_WIDTH,
  NARROW_VIEWPORT_STEM_WIDTH,
  SEQUENCE_ARROW_GAP,
  SEQUENCE_ARROW_WIDTH,
  SEQUENCE_GAP,
  SEQUENCE_PANEL_WIDTH,
  SEQUENCE_PHONE_MAX_PER_LINE,
  SEQUENCE_WIDE_MAX_PER_LINE,
  SCENE_BOARD_INSET,
  SCENE_CONNECTION_STROKE,
  SceneGraphic,
  StemView,
  analogyRowWidth,
  gateGlyphs,
  gatePieces,
  gateStripWidth,
  jigsawStripSize,
  machineRowWidth,
  sequenceLineWidth,
  sequencePerLine,
} from "./render";
import { loadBank } from "./bank";
import {
  isBlank,
  type Puzzle,
  type PublicPuzzle,
  PUZZLE_TYPES,
  type PuzzleType,
  type Scene,
  type SceneToken,
  SCENE_SHAPES,
  FILLS,
  ROTATIONS,
} from "./schema";

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

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

const scenePuzzle: Puzzle = {
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
  if (!bankHit) throw new Error(`no bank item for puzzle type ${type}`);
  return bankHit.puzzle;
}

async function puzzleToSvg(puzzle: Puzzle | PublicPuzzle, options?: { optionsOnly?: boolean }) {
  const { puzzleToSvg } = await import("./compose-image");
  return puzzleToSvg(puzzle, options);
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

/** How far a drawn shape reaches from `center`, the middle of its board square. */
function radiusAbout(node: ShapeNode, center: number): number {
  if (node.tag === "circle") return Number(node.attrs.r);
  if (node.tag === "rect") return Math.hypot(Number(node.attrs.width) / 2, Number(node.attrs.height) / 2);
  return Math.max(...parsePoints(node.attrs.points ?? "").map((point) => Math.hypot(point.x - center, point.y - center)));
}

function parseRotation(raw: string | undefined) {
  const match = raw?.match(/^rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)$/);
  if (!match) return null;
  return { angle: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

function styleFor(fill: SceneToken["fill"]) {
  if (fill === "solid") {
    return { fill: "#111827", stroke: "#111827", strokeWidth: 2 };
  }
  if (fill === "half") {
    return { fill: "#9ca3af", stroke: "#111827", strokeWidth: 3 };
  }
  return { fill: "none", stroke: "#111827", strokeWidth: 4 };
}

/** One token in the middle square of a 3×3 board, as the shapes the board draws for it. */
function tokenNodes(token: SceneToken): ShapeNode[] {
  const scene: Scene = { kind: "scene", rows: 3, columns: 3, objects: [{ row: 1, column: 1, object: token }], tiles: [] };
  const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene }));
  const group = /<g\b[^>]*data-scene-kind="token"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
  return shapeNodesFromSvg(group?.[1] ?? "");
}

function tokenRadius(size: SceneToken["size"]): number {
  const [node] = tokenNodes({ kind: "token", shape: "circle", rotation: 0, fill: "solid", size });
  if (!node) throw new Error(`no circle node for size=${size}`);
  return Number(node.attrs.r);
}

describe("puzzleToSvg", () => {
  it("returns a single self-contained <svg> for every puzzle type", async () => {
    for (const type of PUZZLE_TYPES) {
      const svg = await puzzleToSvg(firstOfType(type));
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg.indexOf("<svg")).toBe(0);
    }
  });

  it("draws one lettered label box per option (A…F)", async () => {
    for (const type of PUZZLE_TYPES) {
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

  it("draws only the lettered options for the options-only probe arm", async () => {
    for (const type of PUZZLE_TYPES) {
      const puzzle = firstOfType(type);
      const full = await puzzleToSvg(puzzle);
      const optionsOnly = await puzzleToSvg(puzzle, { optionsOnly: true });
      for (const label of LETTERS.slice(0, puzzle.options.length)) {
        expect(optionsOnly).toContain(`>${label}</text>`);
      }
      // No stem: no query mark, and exactly the options' cells are drawn.
      expect(optionsOnly).not.toContain(">?</text>");
      // One positioned cell per drawn panel (a scene nests its own graphic inside).
      const cells = (svg: string) => (svg.match(/<svg x="/g) ?? []).length;
      expect(cells(optionsOnly), type).toBe(puzzle.options.length);
      expect(cells(full), type).toBeGreaterThan(puzzle.options.length);
      expect(optionsOnly.length).toBeLessThan(full.length);
    }
  });

  it("renders '?' for the query position on every puzzle type", async () => {
    for (const type of PUZZLE_TYPES) {
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
});

describe("token geometry lock", () => {
  it("keeps every shape, fill, size and quarter turn drawn the same way", () => {
    const center = CELL_VIEWBOX / 2; // the middle square of a 3×3 board
    for (const shape of SCENE_SHAPES) {
      const rotations = shape === "triangle" || shape === "arrow" ? ROTATIONS : [0];
      for (const fill of FILLS) {
        for (const size of ["m", "l"] as const) {
          const reference = tokenRadius(size);
          for (const rotation of rotations) {
            const label = `${shape} ${fill} ${size} ${rotation}`;
            const nodes = tokenNodes({ kind: "token", shape, rotation, fill, size });
            expect(nodes, label).toHaveLength(1);
            const [node] = nodes;
            expect(node.tag, label).toBe(shape === "circle" ? "circle" : shape === "square" ? "rect" : "polygon");
            const expected = styleFor(fill);
            expect(node.attrs.fill, label).toBe(expected.fill);
            expect(node.attrs.stroke, label).toBe(expected.stroke);
            expect(Number(node.attrs["stroke-width"]), label).toBe(expected.strokeWidth);

            if (shape === "circle") {
              expect(node.attrs.transform, label).toBeUndefined();
            } else {
              const transform = parseRotation(node.attrs.transform);
              expect(transform?.angle, label).toBe(rotation);
              expect(transform?.x, label).toBeCloseTo(center, 6);
              expect(transform?.y, label).toBeCloseTo(center, 6);
            }

            if (shape === "square") {
              expect(Number(node.attrs.width), label).toBeCloseTo(reference * Math.SQRT2, 6);
              expect(Number(node.attrs.height), label).toBeCloseTo(reference * Math.SQRT2, 6);
            }

            expect(radiusAbout(node, center), label).toBeCloseTo(reference, 1);
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
  it("renders every embedded board with the shared inner inset", async () => {
    const puzzle = firstOfType("matrix");
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
});

describe("compose-image composition contract", () => {
  it("draws every stem and option through render.SceneGraphic", async () => {
    const calls: Scene[] = [];

    vi.resetModules();
    vi.doMock("./render", async () => {
      const actual = await vi.importActual<typeof import("./render")>("./render");
      return {
        ...actual,
        SceneGraphic: vi.fn((props: { scene: Scene; className?: string }) => {
          calls.push(props.scene);
          return actual.SceneGraphic(props);
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

    // Every option and every drawn stem panel goes through the shared renderer,
    // except a machine gate, which draws as its jigsaw pieces. The bank decides
    // which matrix item this is, so a machine row (input, gate, output) is
    // counted in case it is a machine table.
    const gatePanels = puzzle.layout === "machineTable"
      ? puzzle.stem.filter((_, index) => index % 3 === 1)
      : [];
    const pieceGates = gatePanels.filter((panel) => gatePieces(panel) !== null).length;
    const expectedCalls =
      puzzle.options.length + puzzle.stem.filter((panel) => !isBlank(panel)).length - pieceGates;
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

  const arrowPuzzle: Puzzle = {
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

  const machinePuzzle: Puzzle = {
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

  const longRowPuzzle: Puzzle = {
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
    expect(gateGlyphs(queryGate).map((glyph) => (glyph as SceneToken).shape)).toEqual([
      "triangle",
      "square",
      "diamond",
    ]);
    expect(gateGlyphs(queryGate).map((glyph) => (glyph as SceneToken).fill)).toEqual([
      "outline",
      "solid",
      "half",
    ]);
    expect(gateGlyphs(gateA)).toHaveLength(1);
    expect(gateGlyphs({ blank: true })).toHaveLength(0);
    // A board that is not a bare row of tokens is left whole for the scene renderer.
    expect(gateGlyphs(representativeScene)).toEqual([representativeScene]);
  });

  it("draws every gate as its jigsaw piece in both paths, in application order", async () => {
    expect(gatePieces(gateA)).toEqual(["dark"]);
    expect(gatePieces(gateB)).toEqual(["dotted"]);
    expect(gatePieces(gateC)).toEqual(["striped"]);
    expect(gatePieces(queryGate)).toEqual(["dark", "dotted", "striped"]);

    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: machinePuzzle }));
    const composed = await puzzleToSvg(machinePuzzle);
    // No dashed box and no board shapes standing in for a gate any more.
    expect(browser).not.toContain("border-dashed");
    expect(composed).not.toContain("stroke-dasharray");
    // The page draws each gate twice (a phone strip and a wide one), the
    // image once; both list the query's pieces in the order they run.
    const pieces = (markup: string) => [...markup.matchAll(/data-gate-piece="([a-z-]+)"/g)].map((match) => match[1]);
    expect(pieces(composed)).toEqual(["dark", "dotted", "striped", "dark", "dotted", "striped"]);
    expect(pieces(browser)).toEqual(["dark", "dark", "dotted", "dotted", "striped", "striped",
      "dark", "dotted", "striped", "dark", "dotted", "striped"]);
    // A gate's label says what it is and how many pieces, never their textures.
    expect(browser).toContain('aria-label="machine: jigsaw piece"');
    expect(browser).toContain('aria-label="machine: 3 jigsaw pieces snapped together"');
    for (const label of [...`${browser}${composed}`.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1])) {
      expect(label).not.toMatch(/dark|dotted|striped|solid|outline|circle|square|triangle/);
    }
    // The pieces carry the order: no arrows between them, only the row's own
    // two around the gate.
    expect((browser.match(/data-flow-arrow="right"/g) ?? []).length).toBe(8);
    expect(browser).not.toContain('data-flow-arrow="down"');
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

  it("numbers every sequence picture and folds a phone row into balanced lines", () => {
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: longRowPuzzle }));
    // Every picture carries its position, the "?" included, so a fold can never
    // be read as a matrix or out of order.
    for (let step = 1; step <= longRowPuzzle.stem.length; step++) {
      expect(browser).toContain(`data-sequence-step="${step}"`);
    }
    // An arrow in front of every picture after the first; the first one's
    // arrow column is reserved but invisible, so folded lines stay aligned.
    expect((browser.match(/data-flow-arrow="right"/g) ?? []).length).toBe(longRowPuzzle.stem.length);
    expect((browser.match(/invisible/g) ?? []).length).toBe(1);
    // Eight pictures fold 3 + 3 + 2 on a phone and 4 + 4 from `md:` up; nothing
    // scrolls, so no term is ever out of view.
    expect(browser).toContain("grid-cols-3");
    expect(browser).toContain("md:grid-cols-4");
    expect(browser).not.toContain("overflow-x-auto");
  });

  it("balances sequence lines and fits a phone line in the stem budget", () => {
    // Four fold 2 + 2 and six fold 3 + 3: never three plus a lone "?", which
    // read as a matrix on a phone before 2026-10-03.
    expect(sequencePerLine(4, SEQUENCE_PHONE_MAX_PER_LINE)).toBe(2);
    expect(sequencePerLine(6, SEQUENCE_PHONE_MAX_PER_LINE)).toBe(3);
    expect(sequencePerLine(8, SEQUENCE_PHONE_MAX_PER_LINE)).toBe(3);
    expect(sequencePerLine(4, SEQUENCE_WIDE_MAX_PER_LINE)).toBe(4);
    expect(sequencePerLine(6, SEQUENCE_WIDE_MAX_PER_LINE)).toBe(6);
    expect(sequencePerLine(8, SEQUENCE_WIDE_MAX_PER_LINE)).toBe(4);
    // The widest phone line: three 80px pictures, each with a 14px arrow
    // column 2px in front of it, 4px apart.
    expect([SEQUENCE_PANEL_WIDTH, SEQUENCE_ARROW_WIDTH, SEQUENCE_ARROW_GAP, SEQUENCE_GAP]).toEqual([80, 14, 2, 4]);
    expect(sequenceLineWidth(SEQUENCE_PHONE_MAX_PER_LINE)).toBe(296);
    expect(sequenceLineWidth(SEQUENCE_PHONE_MAX_PER_LINE)).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    // The markup carries exactly those widths.
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: longRowPuzzle }));
    expect(browser).toContain("grid-cols-[0.875rem_5rem] items-center gap-x-0.5");
    expect(browser).toContain("grid w-max gap-x-1");
  });

  it("stacks an analogy as 'A → B' over 'C → ?' at every width", () => {
    const analogyPuzzle: Puzzle = {
      ...longRowPuzzle,
      id: "long-analogy-renderer",
      type: "analogy",
      layout: "analogy",
      stem: [sceneAt(0, 0), sceneAt(0, 1), sceneAt(1, 0)],
    };
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: analogyPuzzle }));
    // Two rows, each a board, an arrow and a board, never folding; the old
    // ":" / "::" notation is gone.
    expect((browser.match(/flex flex-nowrap items-center gap-1 rounded-lg/g) ?? []).length).toBe(2);
    expect((browser.match(/data-flow-arrow="right"/g) ?? []).length).toBe(2);
    expect(browser).not.toContain("::");
    expect(browser).not.toContain("flex-wrap");
    // The bottom row ends in the "?".
    expect(browser.lastIndexOf('aria-label="blank: the cell to solve"'))
      .toBeGreaterThan(browser.lastIndexOf("data-flow-arrow"));
    // One row is two 80px boards, a 32px arrow, two 4px gaps and 8px padding
    // each side, and fits a phone with room to spare.
    expect([ANALOGY_PANEL_WIDTH, ANALOGY_ARROW_WIDTH, ANALOGY_ROW_GAP, ANALOGY_ROW_PADDING]).toEqual([80, 32, 4, 8]);
    expect(analogyRowWidth()).toBe(216);
    expect(analogyRowWidth()).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
  });

  it("draws the agent's analogy as two aligned rows and its sequence numbered", async () => {
    const analogyPuzzle: Puzzle = {
      ...longRowPuzzle,
      id: "agent-analogy",
      type: "analogy",
      layout: "analogy",
      stem: [sceneAt(0, 0), sceneAt(0, 1), sceneAt(1, 0)],
    };
    const analogy = await puzzleToSvg(analogyPuzzle);
    expect(analogy).not.toContain(">::</text>");
    expect(analogy).not.toContain(">:</text>");
    const stemBoxes = framedBoxes(analogy).filter((box) => box.y < 400).slice(0, 4);
    // Two boxes per row, the second row directly under the first.
    const columns = [...new Set(stemBoxes.map((box) => box.x))];
    const rows = [...new Set(stemBoxes.map((box) => box.y))];
    expect(columns).toHaveLength(2);
    expect(rows).toHaveLength(2);

    const sequence = await puzzleToSvg(longRowPuzzle);
    for (let step = 1; step <= longRowPuzzle.stem.length; step++) {
      expect(sequence).toContain(`>${step}</text>`);
    }
    // An arrow before every picture after the first, the fold included.
    expect((sequence.match(/data-flow-arrow="right"/g) ?? []).length).toBeGreaterThanOrEqual(longRowPuzzle.stem.length - 1);
  });
});

describe("jigsaw gates", () => {
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

  const GLYPHS = [
    ["triangle", "outline"],
    ["square", "solid"],
    ["diamond", "half"],
  ] as const;

  /** A question's gate: all three glyphs, one per column of the middle row. */
  const queryGate: Scene = {
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: GLYPHS.map(([shape, fill], column) => ({ row: 1, column, object: gateGlyph(shape, fill) })),
    tiles: [],
  };

  /** The widest machine a served item draws: three worked gates, then all three snapped together. */
  const threeGatePuzzle: Puzzle = {
    id: "three-gate-machine",
    type: "matrix",
    instruction: "Apply the three gates left to right.",
    difficulty: 5,
    layout: "machineTable",
    stem: [
      ...GLYPHS.flatMap(([shape, fill], index) => [sceneAt(index % 2, 0), workedGate(shape, fill), sceneAt(index % 2, 1)]),
      sceneAt(0, 0, "diamond"), queryGate, { blank: true },
    ],
    options: [sceneAt(0, 1, "diamond"), sceneAt(1, 1, "diamond"), sceneAt(1, 0, "diamond")],
    answerIndex: 0,
    explanation: "Each worked row shows one gate.",
  };

  it("gives every gate glyph a texture of its own, and nothing else one", () => {
    expect(gatePieces(queryGate)).toEqual(["dark", "dotted", "striped"]);
    // A token that is not a gate glyph, or a real board, is not a gate.
    expect(gatePieces(workedGate("circle", "solid"))).toBeNull();
    expect(gatePieces(workedGate("star", "outline"))).toBeNull();
    expect(gatePieces(sceneAt(0, 0))).toBeNull();
    expect(gatePieces({ blank: true })).toBeNull();
  });

  it("snaps neighbouring pieces tab into notch", () => {
    // A body 38 wide plus a tab of 6 on the right; the next piece starts where
    // this one's body ends, so its notch (cut 6 deep) takes the tab exactly.
    expect([JIGSAW_PIECE_WIDTH, JIGSAW_PIECE_HEIGHT, JIGSAW_PIECE_STEP]).toEqual([46, 32, 38]);
    expect(jigsawStripSize(1, "right")).toEqual({ width: 46, height: 32 });
    expect(jigsawStripSize(3, "right")).toEqual({ width: 122, height: 32 });
    expect(jigsawStripSize(3, "down")).toEqual({ width: 32, height: 122 });
  });

  it("prices a gate's phone width from the classes the markup really carries", () => {
    // One piece lies on its side; several stack top to bottom, tabs down, in a
    // narrower column, so a row (input, gate, output) never folds on a phone.
    expect([GATE_PIECE_WIDTH, GATE_STACK_WIDTH]).toEqual([56, 40]);
    expect(gateStripWidth(1)).toBe(56);
    for (let pieces = 2; pieces <= 3; pieces++) expect(gateStripWidth(pieces)).toBe(40);
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle: threeGatePuzzle }));
    expect(browser).toContain('class="h-auto sm:hidden w-14" aria-hidden="true" data-gate-strip="right"');
    expect(browser).toContain('class="h-auto sm:hidden w-10" aria-hidden="true" data-gate-strip="down"');
    expect(browser).toContain("sm:w-[195px]");
    for (let pieces = 1; pieces <= 3; pieces++) {
      expect(machineRowWidth(pieces), `${pieces} pieces`).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
    }
    expect(machineRowWidth(3)).toBe(248);
  });

  it("keeps the textures readable at phone size", () => {
    // The smallest a piece is drawn: stacked in the 40px column, 1.25px per
    // piece unit. Dots and stripes must stay marks, not specks.
    const scale = GATE_STACK_WIDTH / JIGSAW_PIECE_HEIGHT;
    expect(Math.min(scale, GATE_PIECE_WIDTH / JIGSAW_PIECE_WIDTH)).toBeGreaterThan(1.2);
    const markup = renderToStaticMarkup(createElement(StemView, { puzzle: threeGatePuzzle }));
    const radii = [...markup.matchAll(/<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)" fill="#374151"/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) expect(radius * 2 * 1.2).toBeGreaterThanOrEqual(4.5);
    const widths = [...markup.matchAll(/stroke="#374151" stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width * 1.2).toBeGreaterThanOrEqual(1.9);
  });

  /** Every piece strip in a composed image: where it starts, how many pieces, at what scale. */
  function pieceStrips(svg: string) {
    return [...svg.matchAll(/<g data-gate-pieces="(\d+)" transform="translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)">/g)]
      .map((match) => ({ count: Number(match[1]), x: Number(match[2]), y: Number(match[3]), scale: Number(match[4]) }));
  }

  it("keeps every piece inside the agent canvas", async () => {
    const svg = await puzzleToSvg(threeGatePuzzle);
    const canvasWidth = Number(parseAttributes(/<svg\b([^>]*)>/.exec(svg)?.[1] ?? "").width);
    expect(canvasWidth).toBe(800);
    const strips = pieceStrips(svg);
    expect(strips.length).toBe(4);
    for (const strip of strips) {
      expect(strip.x).toBeGreaterThanOrEqual(0);
      expect(strip.x + jigsawStripSize(strip.count, "right").width * strip.scale).toBeLessThanOrEqual(canvasWidth);
    }
  });
});

describe("reading cues: grid arrows and phone budgets", () => {
  const grid = (gridFlow?: Puzzle["gridFlow"]): Puzzle => ({
    id: `grid-${gridFlow ?? "plain"}`,
    type: "matrix",
    instruction: "Which board completes the grid?",
    difficulty: 4,
    layout: "grid3x3",
    ...(gridFlow ? { gridFlow } : {}),
    stem: [
      sceneAt(0, 0), sceneAt(0, 1), sceneAt(1, 0),
      sceneAt(1, 1), sceneAt(0, 0, "square"), sceneAt(0, 1, "square"),
      sceneAt(1, 0, "square"), sceneAt(1, 1, "square"), { blank: true },
    ],
    options: [sceneAt(0, 0, "star"), sceneAt(0, 1, "star"), sceneAt(1, 0, "star")],
    answerIndex: 0,
    explanation: "Rows combine.",
  });

  it("draws a grid's arrows only when its rule runs one way", async () => {
    const count = (markup: string, direction: "right" | "down") =>
      (markup.match(new RegExp(`data-flow-arrow="${direction}"`, "g")) ?? []).length;
    const rows = renderToStaticMarkup(createElement(StemView, { puzzle: grid("rows") }));
    const both = renderToStaticMarkup(createElement(StemView, { puzzle: grid("rowsAndColumns") }));
    const plain = renderToStaticMarkup(createElement(StemView, { puzzle: grid() }));
    expect([count(rows, "right"), count(rows, "down")]).toEqual([3, 0]);
    // A grid that reads both ways needs no hint of where to look.
    expect([count(both, "right"), count(both, "down")]).toEqual([0, 0]);
    expect([count(plain, "right"), count(plain, "down")]).toEqual([0, 0]);

    // The agent image draws the same arrows.
    const rowsSvg = await puzzleToSvg(grid("rows"));
    const bothSvg = await puzzleToSvg(grid("rowsAndColumns"));
    expect([count(rowsSvg, "right"), count(rowsSvg, "down")]).toEqual([3, 0]);
    expect([count(bothSvg, "right"), count(bothSvg, "down")]).toEqual([0, 0]);
  });

  it("fits a flowed grid in the phone stem budget", () => {
    const markup = renderToStaticMarkup(createElement(StemView, { puzzle: grid("rows") }));
    expect(markup).toContain("max-w-[300px]");
    expect(300).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);
  });

  it("prices the phone budget from the padding the page really uses", () => {
    // 375 − 2×16 page padding − 2×1 card border − 2×12 card padding − 2×8
    // diagram padding. A padding class edited in quiz.tsx without the budget
    // fails here instead of silently overflowing every layout priced above.
    expect(NARROW_VIEWPORT_STEM_WIDTH).toBe(375 - 32 - 2 - 24 - 16);
    const page = readFileSync(new URL("../app/quiz.tsx", import.meta.url), "utf8");
    expect(page).toContain('className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8"');
    expect(page).toContain("rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6");
    expect(page).toContain('className="mb-6 rounded-xl bg-gray-50 p-2 sm:p-4"');
  });
});

describe("grey that reads inside small shapes", () => {
  /**
   * The grey a grey ("half") token shows once its outline is drawn, in square
   * pixels on a board drawn `displayedSize` px wide: the points inside its
   * polygon at least half the stroke width from every edge, sampled on a fine
   * grid.
   */
  function greyPixels(shape: SceneToken["shape"], size: SceneToken["size"], displayedSize: number): number {
    const scene: Scene = {
      kind: "scene",
      rows: 3,
      columns: 3,
      tiles: [],
      objects: [{ row: 1, column: 1, object: { kind: "token", shape, rotation: 0, fill: "half", size } }],
    };
    const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene }));
    const node = shapeNodesFromSvg(svg).find((candidate) => candidate.tag === "polygon" && candidate.attrs.fill === "#9ca3af")!;
    const points = parsePoints(node.attrs.points ?? "");
    const halfStroke = Number(node.attrs["stroke-width"]) / 2;
    const inside = (x: number, y: number) => {
      let crossings = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [a, b] = [points[i], points[j]];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) crossings = !crossings;
      }
      return crossings;
    };
    const edgeDistance = (x: number, y: number) => Math.min(...points.map((a, i) => {
      const b = points[(i + 1) % points.length];
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const step = 0.1;
    let grey = 0;
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
        if (inside(x, y) && edgeDistance(x, y) >= halfStroke) grey += step * step;
      }
    }
    const scale = displayedSize / CELL_VIEWBOX;
    return grey * scale * scale;
  }

  it("shows more grey inside a star than inside a triangle of the same size", () => {
    // Opus 5.5 lost an easy question on 2026-10-04 because a star's change from
    // white to grey was too thin to see; with arms at 0.42 of the radius a grey
    // star showed about two thirds of a grey triangle's grey
    // (docs/plans/one-reading-per-worked-row.md).
    for (const size of ["l", "m"] as const) {
      for (const displayedSize of [80, 64]) {
        expect(greyPixels("star", size, displayedSize), `${size} at ${displayedSize}px`)
          .toBeGreaterThan(greyPixels("triangle", size, displayedSize));
      }
    }
    // A large star on a 64px review board: about 47 square pixels, 26 before.
    expect(greyPixels("star", "l", 64)).toBeGreaterThan(40);
  });
});
