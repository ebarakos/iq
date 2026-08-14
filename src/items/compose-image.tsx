import { createRequire } from "node:module";
import React, { type ReactElement } from "react";
import type { Cell, Puzzle, PublicPuzzle } from "./schema";
import { isBlank } from "./schema";
import { CellGraphic } from "./render";

/**
 * Pure-SVG composition of a whole puzzle into ONE self-contained `<svg>` for the
 * agent image channel.
 *
 * Unlike `StemView` (which lays out with Tailwind-classed `<div>`s that mean
 * nothing outside the app's CSS), this renders the stem + lettered options into
 * a single standalone SVG using inline attributes only — no CSS classes carry
 * any styling. `CellGraphic` is reusable here because it draws with explicit
 * `fill`/`stroke` attributes (see render.tsx `fillProps`), not color classes, so
 * nesting it inside a positioned `<svg x y width height viewBox="0 0 100 100">`
 * reproduces exactly the cell a human sees. The `className` it accepts is left
 * undefined; even if set, class attributes on SVG elements are inert in a
 * standalone document where no stylesheet targets them.
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

/** A bordered box that draws one cell (or a "?" for a blank) at (x, y). */
function CellBox({ x, y, cell, size = CELL }: { x: number; y: number; cell: Cell | null; size?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={6} fill="#ffffff" stroke={BORDER} strokeWidth={2} />
      {cell ? (
        // Nested SVG: CellGraphic owns viewBox 0 0 100 100; position + scale it here.
        <svg x={x + 6} y={y + 6} width={size - 12} height={size - 12} viewBox="0 0 100 100">
          <CellGraphic cell={cell} />
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
  | { kind: "cell"; cell: Cell | null }
  | { kind: "sep"; text: string };

/**
 * Build the horizontal stem strip for non-grid layouts (sequence / analogy /
 * oddOneOut). Returns the row's pieces plus its total width.
 */
function stemRow(puzzle: Puzzle | PublicPuzzle): { pieces: Piece[]; rowWidth: number } {
  const pieces: Piece[] = [];

  if (puzzle.layout === "analogy") {
    // A : B :: C : ?
    const [a, b, cc] = puzzle.stem;
    pieces.push({ kind: "cell", cell: a && !isBlank(a) ? a : null });
    pieces.push({ kind: "sep", text: ":" });
    pieces.push({ kind: "cell", cell: b && !isBlank(b) ? b : null });
    pieces.push({ kind: "sep", text: "::" });
    pieces.push({ kind: "cell", cell: cc && !isBlank(cc) ? cc : null });
    pieces.push({ kind: "sep", text: ":" });
    pieces.push({ kind: "cell", cell: null }); // the "?" to solve
  } else {
    // row (sequence) — N drawn cells then the trailing blank as "?".
    // oddOneOut has an empty stem → no row pieces (options only).
    for (const panel of puzzle.stem) {
      pieces.push({ kind: "cell", cell: isBlank(panel) ? null : panel });
    }
  }

  let rowWidth = 0;
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) rowWidth += GAP;
    rowWidth += pieces[i].kind === "sep" ? SEP : CELL;
  }
  return { pieces, rowWidth };
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
 */
export function PuzzleImage({ puzzle }: { puzzle: Puzzle | PublicPuzzle }): ReactElement {
  const elems: ReactElement[] = [];
  let cursorY = PAD;

  // ── Stem ──
  if (puzzle.layout === "operatorTable") {
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
    const { pieces, rowWidth } = stemRow(puzzle);
    if (pieces.length > 0) {
      let x = (WIDTH - rowWidth) / 2;
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        if (piece.kind === "sep") {
          elems.push(<Separator key={`stem-${i}`} x={x} y={cursorY} text={piece.text} height={CELL} />);
          x += SEP + GAP;
        } else {
          elems.push(<CellBox key={`stem-${i}`} x={x} y={cursorY} cell={piece.cell} />);
          x += CELL + GAP;
        }
      }
      cursorY += CELL;
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
export function puzzleToSvg(puzzle: Puzzle | PublicPuzzle): string {
  // Synchronous, server-only resolution via createRequire so this module never
  // pulls react-dom/server into a client/edge bundle merely by being imported.
  const require = createRequire(import.meta.url);
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  return renderToStaticMarkup(<PuzzleImage puzzle={puzzle} />);
}
