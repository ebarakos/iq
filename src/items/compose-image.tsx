import { createRequire } from "node:module";
import React, { type ReactElement } from "react";
import type { Panel, Puzzle, PublicPuzzle, Scene } from "./schema";
import { isBlank } from "./schema";
import type { GatePieceTexture } from "./gate-pieces";
import {
  CELL_CANVAS_PADDING,
  CELL_VIEWBOX,
  JigsawPieces,
  SceneGraphic,
  gatePieces,
  jigsawStripSize,
} from "./render";

/**
 * Pure-SVG composition of a whole puzzle into ONE self-contained `<svg>` for the
 * agent image channel.
 *
 * Unlike `StemView` (which lays out with Tailwind-classed `<div>`s that mean
 * nothing outside the app's CSS), this renders the stem + lettered options into
 * a single standalone SVG using inline attributes only — no CSS classes carry
 * any styling. `SceneGraphic` is shared by both paths and draws with explicit
 * geometry, fill, and stroke attributes, so nesting it in a positioned SVG
 * reproduces exactly what a human sees. Its `className` is left undefined; even
 * if set, class attributes are inert without a stylesheet.
 *
 * This module is used by scripts and tests only (it pulls in
 * `react-dom/server`), never by the Next client.
 */

// Local A–F option labels (page.tsx owns its own LETTERS list; we define ours).
const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

// Geometry (px). Everything derives from these so the viewBox auto-sizes.
const CELL = 110; // drawn cell side
const GAP = 16; // gap between cells
const PAD = 40; // outer padding
const SEP = 36; // width reserved for a "→" or "↓" separator
const LABEL_H = 22; // height reserved under each option for its letter
const SECTION_GAP = 56; // vertical gap between stem and options row
const STROKE = "#111827"; // gray-900 — matches render.tsx
const BORDER = "#9ca3af"; // gray-400 — cell borders / "?" glyph
const STEP_NUMBER_FILL = "#6b7280"; // gray-500 — a sequence cell's position number
const WIDTH = 800;
const CELL_FRAME_STROKE = 2;
/** Agent-image scale of a gate's jigsaw pieces: one piece is about as wide as a cell. */
const PIECE_SCALE = 2.3;
/** Widest a stem line may be; a longer sequence folds into balanced lines. An image cannot scroll. */
const CONTENT_WIDTH = WIDTH - PAD * 2;

/** A bordered box that draws one cell (or a "?" for a blank) at (x, y). */
function CellBox({ x, y, cell }: { x: number; y: number; cell: Scene | null }) {
  const size = CELL;
  const innerOffset = CELL_CANVAS_PADDING;
  const innerSize = Math.max(0, size - innerOffset * 2);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        rx={6}
        fill="#ffffff"
        stroke={BORDER}
        strokeWidth={CELL_FRAME_STROKE}
      />
      {cell ? (
        // Nested SVG: SceneGraphic owns the shared 100x100 geometry used by the browser.
        <svg
          x={x + innerOffset}
          y={y + innerOffset}
          width={innerSize}
          height={innerSize}
          viewBox={`0 0 ${CELL_VIEWBOX} ${CELL_VIEWBOX}`}
        >
          <SceneGraphic scene={cell} />
        </svg>
      ) : (
        <text
          x={x + size / 2}
          y={y + size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.5}
          fontFamily="sans-serif"
          fill={BORDER}
        >
          ?
        </text>
      )}
    </g>
  );
}

/** A separator glyph ("→") centred in a SEP-wide column at (x, y). */
function Separator({ x, y, text, height }: { x: number; y: number; text: string; height: number }) {
  return (
    <text
      x={x + SEP / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={36}
      fontFamily="sans-serif"
      fontWeight="600"
      fill={BORDER}
    >
      {text}
    </text>
  );
}

type Piece =
  | { kind: "cell"; cell: Scene | null }
  | { kind: "pieces"; textures: GatePieceTexture[] }
  | { kind: "sep"; text: string };

function pieceWidth(piece: Piece): number {
  if (piece.kind === "sep") return SEP;
  if (piece.kind === "pieces") return jigsawStripSize(piece.textures.length, "right").width * PIECE_SCALE;
  return CELL;
}

function lineWidth(pieces: Piece[]): number {
  return pieces.reduce((total, piece, index) => total + (index > 0 ? GAP : 0) + pieceWidth(piece), 0);
}

/** A gate's pieces, snapped left to right and centred on the row's cells. */
function GatePieces({ x, y, textures }: { x: number; y: number; textures: GatePieceTexture[] }) {
  const height = jigsawStripSize(textures.length, "right").height * PIECE_SCALE;
  return (
    <g data-gate-pieces={textures.length} transform={`translate(${x} ${y + (CELL - height) / 2}) scale(${PIECE_SCALE})`}>
      <JigsawPieces textures={textures} direction="right" />
    </g>
  );
}

/**
 * Draw one stem row, centred, and return the y cursor left one GAP below it.
 * The widest row a served item draws, a machine row whose question snaps three
 * pieces, fits the canvas with room to spare (a test holds it there).
 */
function drawStemRow(pieces: Piece[], startY: number, keyPrefix: string, elems: ReactElement[]): number {
  let x = (WIDTH - lineWidth(pieces)) / 2;
  pieces.forEach((piece, pieceIndex) => {
    const key = `${keyPrefix}-${pieceIndex}`;
    if (piece.kind === "sep") {
      elems.push(<Separator key={key} x={x} y={startY} text={piece.text} height={CELL} />);
    } else if (piece.kind === "pieces") {
      elems.push(<GatePieces key={key} x={x} y={startY} textures={piece.textures} />);
    } else {
      elems.push(<CellBox key={key} x={x} y={startY} cell={piece.cell} />);
    }
    x += pieceWidth(piece) + GAP;
  });
  return startY + CELL + GAP;
}

function cellPiece(panel: Panel | undefined): Piece {
  return { kind: "cell", cell: panel && !isBlank(panel) ? panel : null };
}

/** A gate panel as its jigsaw pieces; anything that is not a gate draws as a cell. */
function gatePiece(panel: Panel | undefined): Piece {
  const textures = panel ? gatePieces(panel) : null;
  return textures ? { kind: "pieces", textures } : cellPiece(panel);
}

/** Height reserved above a sequence cell for its position number. */
const STEP_NUMBER_H = 26;
/** Most sequence cells on one line: four units of arrow column plus cell fit 720px. */
const SEQUENCE_MAX_PER_LINE = Math.floor((CONTENT_WIDTH + GAP) / (SEP + GAP + CELL + GAP));

/**
 * Draw a sequence row as the browser does: every cell numbered above, every
 * cell after the first with a "→" in front, and every cell — the first too —
 * reserving that arrow column so folded lines align. Lines are balanced, so six
 * cells fold 3 + 3 and a folded line opens with "→". Returns the y cursor below
 * the last line.
 */
function drawSequence(stem: readonly Panel[], startY: number, elems: ReactElement[]): number {
  const lines = Math.ceil(stem.length / SEQUENCE_MAX_PER_LINE);
  const perLine = Math.ceil(stem.length / lines);
  const unit = SEP + GAP + CELL;
  let cursorY = startY;
  for (let start = 0; start < stem.length; start += perLine) {
    const line = stem.slice(start, start + perLine);
    let x = (WIDTH - (line.length * unit + (line.length - 1) * GAP)) / 2;
    line.forEach((panel, offset) => {
      const index = start + offset;
      if (index > 0) {
        elems.push(<Separator key={`step-arrow-${index}`} x={x} y={cursorY + STEP_NUMBER_H} text="→" height={CELL} />);
      }
      x += SEP + GAP;
      elems.push(
        <text
          key={`step-number-${index}`}
          x={x + CELL / 2}
          y={cursorY + STEP_NUMBER_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={18}
          fontFamily="sans-serif"
          fontWeight="700"
          fill={STEP_NUMBER_FILL}
        >
          {index + 1}
        </text>,
      );
      elems.push(<CellBox key={`step-${index}`} x={x} y={cursorY + STEP_NUMBER_H} cell={panel && !isBlank(panel) ? panel : null} />);
      x += CELL + GAP;
    });
    cursorY += STEP_NUMBER_H + CELL + GAP;
  }
  return cursorY;
}

/** Lay out `n` option boxes into rows of at most `perRow`, returning positions. */
function optionGrid(n: number, perRow: number): { cols: number; rows: number } {
  const cols = Math.min(n, perRow);
  const rows = Math.ceil(n / perRow);
  return { cols, rows };
}

/**
 * Compose a puzzle (stem + lettered options) into one self-contained `<svg>`.
 * Target ~800px wide, height auto-derived from content.
 *
 * `optionsOnly` draws the lettered option row and nothing else: the agent
 * probe's options-only arm (docs/plans/blind-answer-leak.md), which measures
 * how much of the answer a model can read off the options without the question.
 */
export function PuzzleImage({
  puzzle,
  optionsOnly = false,
}: {
  puzzle: Puzzle | PublicPuzzle;
  optionsOnly?: boolean;
}): ReactElement {
  const elems: ReactElement[] = [];
  let cursorY = PAD;

  // ── Stem ──
  if (optionsOnly) {
    cursorY -= SECTION_GAP;
  } else if (puzzle.layout === "machineTable") {
    const rows = puzzle.stem.length / 3;
    for (let row = 0; row < rows; row++) {
      const [input, gate, output] = puzzle.stem.slice(row * 3, row * 3 + 3);
      // A query gate snaps two or three pieces together.
      cursorY = drawStemRow(
        [
          cellPiece(input),
          { kind: "sep", text: "→" },
          gatePiece(gate),
          { kind: "sep", text: "→" },
          cellPiece(output),
        ],
        cursorY,
        `machine-${row}`,
        elems,
      );
    }
    cursorY -= GAP;
  } else if (puzzle.layout === "grid3x3") {
    // As in the browser: a "→" column before the third board of every row
    // only when the rule runs across the rows alone. A grid that reads both
    // ways draws no arrows.
    const oneWay = puzzle.gridFlow === "rows";
    const arrowColumn = oneWay ? SEP + GAP : 0;
    const gridW = CELL * 3 + GAP * 2 + arrowColumn;
    const startX = (WIDTH - gridW) / 2;
    const columnX = (col: number) => startX + col * (CELL + GAP) + (col === 2 ? arrowColumn : 0);
    const rowY = (row: number) => cursorY + row * (CELL + GAP);
    for (let i = 0; i < 9; i++) {
      const panel = puzzle.stem[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      elems.push(<CellBox key={`stem-${i}`} x={columnX(col)} y={rowY(row)} cell={panel && !isBlank(panel) ? panel : null} />);
    }
    if (oneWay) {
      for (let row = 0; row < 3; row++) {
        elems.push(<Separator key={`grid-arrow-${row}`} x={columnX(1) + CELL + GAP} y={rowY(row)} text="→" height={CELL} />);
      }
    }
    cursorY = rowY(2) + CELL;
  } else if (puzzle.layout === "analogy") {
    // Two aligned rows, as in the browser: "A → B" over "C → ?".
    const [a, b, c] = puzzle.stem;
    cursorY = drawStemRow([cellPiece(a), { kind: "sep", text: "→" }, cellPiece(b)], cursorY, "analogy-0", elems);
    cursorY = drawStemRow([cellPiece(c), { kind: "sep", text: "→" }, { kind: "cell", cell: null }], cursorY, "analogy-1", elems) - GAP;
  } else {
    // row (sequence): N drawn cells then the trailing blank as "?".
    cursorY = drawSequence(puzzle.stem, cursorY, elems) - GAP;
  }

  cursorY += SECTION_GAP;

  // ── Lettered options ──
  const n = puzzle.options.length;
  const perRow = Math.min(n, 6); // up to 6 options fit on one ~800px row
  const { cols, rows } = optionGrid(n, perRow);
  const optW = cols * CELL + (cols - 1) * GAP;
  const optStartX = (WIDTH - optW) / 2;

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    const col = i % perRow;
    const x = optStartX + col * (CELL + GAP);
    const y = cursorY + r * (CELL + LABEL_H + GAP);
    elems.push(<CellBox key={`opt-${i}`} x={x} y={y} cell={puzzle.options[i]} />);
    elems.push(
      <text
        key={`lbl-${i}`}
        x={x + CELL / 2}
        y={y + CELL + LABEL_H / 2 + 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={20}
        fontFamily="sans-serif"
        fontWeight="700"
        fill={STROKE}
      >
        {LETTERS[i]}
      </text>,
    );
  }

  const optionsHeight = rows * (CELL + LABEL_H) + (rows - 1) * GAP;
  const height = cursorY + optionsHeight + PAD;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={WIDTH}
      height={height}
      viewBox={`0 0 ${WIDTH} ${height}`}
    >
      <rect x={0} y={0} width={WIDTH} height={height} fill="#ffffff" />
      {elems}
    </svg>
  );
}

/**
 * Render a puzzle to a standalone SVG string. Imports `react-dom/server` lazily
 * (server-only) so this module is safe to import in non-server contexts that
 * never call it. The returned string carries an `xmlns` (added by PuzzleImage)
 * so it is a valid standalone document for resvg.
 */
export function puzzleToSvg(
  puzzle: Puzzle | PublicPuzzle,
  options: { optionsOnly?: boolean } = {},
): string {
  // Synchronous, server-only resolution via createRequire so this module never
  // pulls react-dom/server into a client/edge bundle merely by being imported.
  const require = createRequire(import.meta.url);
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  return renderToStaticMarkup(<PuzzleImage puzzle={puzzle} optionsOnly={options.optionsOnly} />);
}
