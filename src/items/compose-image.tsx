import { createRequire } from "node:module";
import React, { type ReactElement } from "react";
import type { Panel, Puzzle, PublicPuzzle, Visual } from "./schema";
import { isBlank } from "./schema";
import {
  CELL_CANVAS_PADDING,
  CELL_VIEWBOX,
  UNSEPARATED_GATE_GLYPH_COUNT,
  VisualGraphic,
  gateGlyphs,
  type Drawable,
} from "./render";

/**
 * Pure-SVG composition of a whole puzzle into ONE self-contained `<svg>` for the
 * agent image channel.
 *
 * Unlike `StemView` (which lays out with Tailwind-classed `<div>`s that mean
 * nothing outside the app's CSS), this renders the stem + lettered options into
 * a single standalone SVG using inline attributes only — no CSS classes carry
 * any styling. `VisualGraphic` is shared by both paths and draws with explicit
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
const SEP = 36; // width reserved for ":" / "::" separators in analogy
const LABEL_H = 22; // height reserved under each option for its letter
const SECTION_GAP = 56; // vertical gap between stem and options row
const STROKE = "#111827"; // gray-900 — matches render.tsx
const BORDER = "#9ca3af"; // gray-400 — cell borders / "?" glyph
const WIDTH = 800;
const CELL_FRAME_STROKE = 2;
const GATE_PAD = 10; // dashed gate frame's padding around the cells it holds
/** Widest a stem line may be before it wraps. An image cannot scroll. */
const CONTENT_WIDTH = WIDTH - PAD * 2;

/** A bordered box that draws one cell (or a "?" for a blank) at (x, y). */
function CellBox({ x, y, cell, size = CELL }: { x: number; y: number; cell: Drawable | null; size?: number }) {
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
        // Nested SVG: VisualGraphic owns the shared 100x100 geometry used by the browser.
        <svg
          x={x + innerOffset}
          y={y + innerOffset}
          width={innerSize}
          height={innerSize}
          viewBox={`0 0 ${CELL_VIEWBOX} ${CELL_VIEWBOX}`}
        >
          <VisualGraphic visual={cell} />
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

/** A separator glyph (":" or "::") centered in a SEP-wide column at (x, y). */
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
  | { kind: "cell"; cell: Drawable | null }
  | { kind: "gate"; glyphs: Drawable[] }
  | { kind: "sep"; text: string };

/**
 * Width of a dashed gate frame holding `count` glyph cells side by side.
 *
 * At five glyphs the "→" columns between them are dropped, exactly as the
 * browser strip drops them (see `UNSEPARATED_GATE_GLYPH_COUNT` in render.tsx):
 * five full-size cells plus four arrow columns would be 842px inside a canvas
 * that gives a stem line 720px, and no piece can be split across lines. Without
 * them the frame is 634px, the glyph cell keeps its full size, and the two
 * render paths still show the same thing.
 */
function gateWidth(count: number): number {
  // Cell to cell: one GAP, plus an arrow column and its second GAP while the
  // strip still draws arrows.
  const between = count >= UNSEPARATED_GATE_GLYPH_COUNT ? GAP : SEP + GAP * 2;
  return count * CELL + Math.max(0, count - 1) * between + GATE_PAD * 2;
}

function pieceWidth(piece: Piece): number {
  if (piece.kind === "sep") return SEP;
  if (piece.kind === "gate") return gateWidth(piece.glyphs.length);
  return CELL;
}

function lineWidth(pieces: Piece[]): number {
  return pieces.reduce((total, piece, index) => total + (index > 0 ? GAP : 0) + pieceWidth(piece), 0);
}

/**
 * Split a stem row into lines that fit `maxWidth`.
 *
 * An image cannot scroll, so a row wider than the canvas has to wrap or it is
 * simply cut off (an eight-panel sequence used to run 270px past the edge). A
 * row of equal cells is then re-split evenly, so eight panels read as two lines
 * of four rather than a lopsided five and three.
 */
function wrapPieces(pieces: Piece[], maxWidth: number): Piece[][] {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  for (const piece of pieces) {
    if (line.length > 0 && lineWidth([...line, piece]) > maxWidth) {
      lines.push(line);
      line = [];
    }
    line.push(piece);
  }
  if (line.length > 0) lines.push(line);

  // A separator belongs to what follows it: an arrow left stranded at the end of
  // a line points at nothing, while "→ ?" opens the next line as a continuation.
  for (let index = 0; index < lines.length - 1; index++) {
    while (lines[index].length > 1 && lines[index][lines[index].length - 1].kind === "sep") {
      lines[index + 1].unshift(lines[index].pop()!);
    }
  }

  if (lines.length < 2 || !pieces.every((piece) => piece.kind === "cell")) return lines;
  const perLine = Math.ceil(pieces.length / lines.length);
  const even: Piece[][] = [];
  for (let start = 0; start < pieces.length; start += perLine) {
    even.push(pieces.slice(start, start + perLine));
  }
  return even;
}

/** The gate cell of a machine row: the dashed frame plus one cell per glyph. */
function GateFrame({ x, y, glyphs, keyPrefix }: { x: number; y: number; glyphs: Drawable[]; keyPrefix: string }) {
  const inner: ReactElement[] = [];
  const separated = glyphs.length < UNSEPARATED_GATE_GLYPH_COUNT;
  let cursorX = x + GATE_PAD;
  glyphs.forEach((glyph, index) => {
    if (index > 0 && separated) {
      inner.push(<Separator key={`${keyPrefix}-order-${index}`} x={cursorX} y={y} text="→" height={CELL} />);
      cursorX += SEP + GAP;
    }
    inner.push(<CellBox key={`${keyPrefix}-glyph-${index}`} x={cursorX} y={y} cell={glyph} />);
    cursorX += CELL + GAP;
  });
  return (
    <g>
      <rect
        x={x}
        y={y - GATE_PAD}
        width={gateWidth(glyphs.length)}
        height={CELL + GATE_PAD * 2}
        rx={18}
        fill="#ffffff"
        stroke={STROKE}
        strokeWidth={3}
        strokeDasharray="8 5"
      />
      {inner}
    </g>
  );
}

/**
 * Draw one stem row, wrapping it across as many lines as it needs, and return
 * the y cursor left below it (one GAP under the last line).
 */
function drawStemRow(pieces: Piece[], startY: number, keyPrefix: string, elems: ReactElement[]): number {
  let cursorY = startY;
  wrapPieces(pieces, CONTENT_WIDTH).forEach((line, lineIndex) => {
    // A gate frame stands GATE_PAD proud of its cells on both sides; without the
    // extra room the dashed frames of neighbouring machine rows would touch.
    const pad = line.some((piece) => piece.kind === "gate") ? GATE_PAD : 0;
    let x = (WIDTH - lineWidth(line)) / 2;
    line.forEach((piece, pieceIndex) => {
      const key = `${keyPrefix}-${lineIndex}-${pieceIndex}`;
      if (piece.kind === "sep") {
        elems.push(<Separator key={key} x={x} y={cursorY + pad} text={piece.text} height={CELL} />);
      } else if (piece.kind === "gate") {
        elems.push(<GateFrame key={key} x={x} y={cursorY + pad} glyphs={piece.glyphs} keyPrefix={key} />);
      } else {
        elems.push(<CellBox key={key} x={x} y={cursorY + pad} cell={piece.cell} />);
      }
      x += pieceWidth(piece) + GAP;
    });
    cursorY += CELL + pad * 2 + GAP;
  });
  return cursorY;
}

function cellPiece(panel: Panel<Visual> | undefined): Piece {
  return { kind: "cell", cell: panel && !isBlank(panel) ? panel : null };
}

/**
 * Build the horizontal stem strip for non-grid layouts (sequence / analogy /
 * oddOneOut).
 */
function stemRow(puzzle: Puzzle<Visual> | PublicPuzzle<Visual>): Piece[] {
  if (puzzle.layout === "analogy") {
    // A : B :: C : ?
    const [a, b, cc] = puzzle.stem;
    return [
      cellPiece(a),
      { kind: "sep", text: ":" },
      cellPiece(b),
      { kind: "sep", text: "::" },
      cellPiece(cc),
      { kind: "sep", text: ":" },
      { kind: "cell", cell: null }, // the "?" to solve
    ];
  }
  // row (sequence) — N drawn cells then the trailing blank as "?".
  // oddOneOut has an empty stem → no row pieces (options only).
  return puzzle.stem.map((panel) => cellPiece(panel));
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
  puzzle: Puzzle<Visual> | PublicPuzzle<Visual>;
  optionsOnly?: boolean;
}): ReactElement {
  const elems: ReactElement[] = [];
  let cursorY = PAD;

  // ── Stem ──
  if (optionsOnly) {
    cursorY -= SECTION_GAP;
  } else if (puzzle.layout === "conceptGroups") {
    const rowWidth = SEP + GAP + CELL * 3 + GAP * 2;
    const startX = (WIDTH - rowWidth) / 2;
    const groups = [puzzle.stem.slice(0, 3), puzzle.stem.slice(3, 6)];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      let x = startX;
      elems.push(
        <Separator
          key={`concept-label-${groupIndex}`}
          x={x}
          y={cursorY}
          text={groupIndex === 0 ? "✓" : "×"}
          height={CELL}
        />,
      );
      x += SEP + GAP;
      groups[groupIndex].forEach((panel, panelIndex) => {
        elems.push(
          <CellBox
            key={`concept-${groupIndex}-${panelIndex}`}
            x={x}
            y={cursorY}
            cell={panel && !isBlank(panel) ? panel : null}
          />,
        );
        x += CELL + GAP;
      });
      cursorY += CELL + GAP;
    }
    cursorY -= GAP;
  } else if (puzzle.layout === "operatorTable") {
    const mini = 54;
    if (puzzle.operatorLegend) {
      const legendWidth = puzzle.operatorLegend.shapeCycle.length * mini +
        (puzzle.operatorLegend.shapeCycle.length - 1) * SEP;
      let legendX = (WIDTH - legendWidth) / 2;
      for (let i = 0; i < puzzle.operatorLegend.shapeCycle.length; i++) {
        if (i > 0) {
          elems.push(<Separator key={`legend-arrow-${i}`} x={legendX} y={cursorY} text="→" height={mini} />);
          legendX += SEP;
        }
        const shape = puzzle.operatorLegend.shapeCycle[i];
        elems.push(
          <CellBox
            key={`legend-${shape}`}
            x={legendX}
            y={cursorY}
            size={mini}
            cell={{ shape, count: 1, rotation: 0, fill: "outline", size: "l" }}
          />,
        );
        legendX += mini;
      }
      cursorY += mini + GAP;
    }

    const rowWidth = CELL * 3 + SEP * 2 + GAP * 4;
    const startX = (WIDTH - rowWidth) / 2;
    const rows = puzzle.stem.length / 3;
    for (let row = 0; row < rows; row++) {
      const [left, right, output] = puzzle.stem.slice(row * 3, row * 3 + 3);
      let x = startX;
      elems.push(<CellBox key={`op-${row}-left`} x={x} y={cursorY} cell={left && !isBlank(left) ? left : null} />);
      x += CELL + GAP;
      elems.push(<Separator key={`op-${row}-combine`} x={x} y={cursorY} text="◆" height={CELL} />);
      x += SEP + GAP;
      elems.push(<CellBox key={`op-${row}-right`} x={x} y={cursorY} cell={right && !isBlank(right) ? right : null} />);
      x += CELL + GAP;
      elems.push(<Separator key={`op-${row}-arrow`} x={x} y={cursorY} text="→" height={CELL} />);
      x += SEP + GAP;
      elems.push(<CellBox key={`op-${row}-output`} x={x} y={cursorY} cell={output && !isBlank(output) ? output : null} />);
      cursorY += CELL + GAP;
    }
    cursorY -= GAP;
  } else if (puzzle.layout === "machineTable") {
    const rows = puzzle.stem.length / 3;
    for (let row = 0; row < rows; row++) {
      const [input, gate, output] = puzzle.stem.slice(row * 3, row * 3 + 3);
      // A query gate holds two to five glyphs. Each one gets the cell a worked
      // row gives its single gate, so the row is wider than the canvas and
      // wraps, leaving the whole strip on one line of its own.
      const glyphs = gate ? gateGlyphs(gate) : [];
      cursorY = drawStemRow(
        [
          cellPiece(input),
          { kind: "sep", text: "→" },
          glyphs.length > 0 ? { kind: "gate", glyphs } : cellPiece(gate),
          { kind: "sep", text: "→" },
          cellPiece(output),
        ],
        cursorY,
        `machine-${row}`,
        elems,
      );
    }
    cursorY -= GAP;
  } else if (puzzle.layout === "combineTable") {
    // (left, gate, right, output). The gate sits BETWEEN the two operands
    // because it combines them; a machine row's gate sits before one board
    // because it transforms it.
    const rows = puzzle.stem.length / 4;
    for (let row = 0; row < rows; row++) {
      const [left, gate, right, output] = puzzle.stem.slice(row * 4, row * 4 + 4);
      const glyphs = gate ? gateGlyphs(gate) : [];
      cursorY = drawStemRow(
        [
          cellPiece(left),
          glyphs.length > 0 ? { kind: "gate", glyphs } : cellPiece(gate),
          cellPiece(right),
          { kind: "sep", text: "→" },
          cellPiece(output),
        ],
        cursorY,
        `combine-${row}`,
        elems,
      );
    }
    cursorY -= GAP;
  } else if (puzzle.layout === "grid3x3") {
    const gridW = CELL * 3 + GAP * 2;
    const startX = (WIDTH - gridW) / 2;
    for (let i = 0; i < 9; i++) {
      const panel = puzzle.stem[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = startX + col * (CELL + GAP);
      const y = cursorY + row * (CELL + GAP);
      elems.push(<CellBox key={`stem-${i}`} x={x} y={y} cell={panel && !isBlank(panel) ? panel : null} />);
    }
    cursorY += CELL * 3 + GAP * 2;
  } else {
    const pieces = stemRow(puzzle);
    if (pieces.length > 0) {
      cursorY = drawStemRow(pieces, cursorY, "stem", elems) - GAP;
    }
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
  puzzle: Puzzle<Visual> | PublicPuzzle<Visual>,
  options: { optionsOnly?: boolean } = {},
): string {
  // Synchronous, server-only resolution via createRequire so this module never
  // pulls react-dom/server into a client/edge bundle merely by being imported.
  const require = createRequire(import.meta.url);
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  return renderToStaticMarkup(<PuzzleImage puzzle={puzzle} optionsOnly={options.optionsOnly} />);
}
