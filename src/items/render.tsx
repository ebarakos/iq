import React from "react";
import type { Cell, Panel, Puzzle } from "./schema";
import { isBlank } from "./schema";

/**
 * Deterministic SVG renderer. Pure functions of the puzzle data — no LLM, no
 * randomness — so a given Cell always draws identically. This is what guarantees
 * the displayed puzzle matches the generator's declared answer.
 */

const STROKE = "#111827"; // gray-900
const HALF_FILL = "#9ca3af"; // gray-400 — the "half" (shaded) state

type Pt = { x: number; y: number };

/** Where to place `count` shapes inside a 100×100 cell, with a base radius. */
function layoutFor(count: number): { pts: Pt[]; baseR: number } {
  switch (count) {
    case 1:
      return { pts: [{ x: 50, y: 50 }], baseR: 30 };
    case 2:
      return { pts: [{ x: 30, y: 50 }, { x: 70, y: 50 }], baseR: 18 };
    case 3:
      return { pts: [{ x: 50, y: 30 }, { x: 32, y: 68 }, { x: 68, y: 68 }], baseR: 16 };
    default:
      return {
        pts: [{ x: 32, y: 32 }, { x: 68, y: 32 }, { x: 32, y: 68 }, { x: 68, y: 68 }],
        baseR: 16,
      };
  }
}

const SIZE_SCALE: Record<Cell["size"], number> = { s: 0.7, m: 1, l: 1.25 };

/** Regular n-gon points (vertex pointing up) around (cx, cy) with radius r. */
function polygon(cx: number, cy: number, r: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** 5-point star points around (cx, cy). */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.42;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function fillProps(fill: Cell["fill"]): { fill: string; stroke: string; strokeWidth: number } {
  if (fill === "solid") return { fill: STROKE, stroke: STROKE, strokeWidth: 2 };
  if (fill === "half") return { fill: HALF_FILL, stroke: STROKE, strokeWidth: 3 };
  return { fill: "none", stroke: STROKE, strokeWidth: 4 }; // outline
}

function Shape({ cell, at, r }: { cell: Cell; at: Pt; r: number }) {
  const fp = fillProps(cell.fill);
  const common = {
    ...fp,
    strokeLinejoin: "round" as const,
    transform: `rotate(${cell.rotation} ${at.x} ${at.y})`,
  };

  switch (cell.shape) {
    case "circle":
      return <circle cx={at.x} cy={at.y} r={r} {...fp} />;
    case "square": {
      const s = r * 0.86;
      return <rect x={at.x - s} y={at.y - s} width={s * 2} height={s * 2} rx={2} {...common} />;
    }
    case "triangle":
      return <polygon points={polygon(at.x, at.y, r, 3)} {...common} />;
    case "diamond":
      return <polygon points={polygon(at.x, at.y, r, 4)} {...common} />;
    case "hexagon":
      return <polygon points={polygon(at.x, at.y, r, 6)} {...common} />;
    case "star":
      return <polygon points={star(at.x, at.y, r)} {...common} />;
    default:
      return null;
  }
}

/** Render a single cell's graphic into a 100×100 viewBox. */
export function CellGraphic({ cell, className }: { cell: Cell; className?: string }) {
  const { pts, baseR } = layoutFor(cell.count);
  const r = baseR * SIZE_SCALE[cell.size];
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-hidden="true">
      {pts.map((p, i) => (
        <Shape key={i} cell={cell} at={p} r={r} />
      ))}
    </svg>
  );
}

/** A blank panel — the cell to be solved. */
export function BlankGraphic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="missing cell">
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="48" fill="#9ca3af">
        ?
      </text>
    </svg>
  );
}

function PanelBox({ panel }: { panel: Panel }) {
  return (
    <div className="flex aspect-square items-center justify-center rounded-md border border-gray-200 bg-white p-1.5">
      {isBlank(panel) ? (
        <BlankGraphic className="h-full w-full" />
      ) : (
        <CellGraphic cell={panel} className="h-full w-full" />
      )}
    </div>
  );
}

/** Render a puzzle's stem (the question) according to its layout. */
export function StemView({ puzzle }: { puzzle: Puzzle }) {
  if (puzzle.layout === "grid3x3") {
    return (
      <div className="mx-auto grid w-full max-w-[280px] grid-cols-3 gap-2">
        {puzzle.stem.map((panel, i) => (
          <PanelBox key={i} panel={panel} />
        ))}
      </div>
    );
  }

  if (puzzle.layout === "analogy") {
    // [A, B, C] rendered as  A : B  ::  C : ?
    const [a, b, c] = puzzle.stem;
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="w-20">{a && <PanelBox panel={a} />}</div>
        <span className="text-2xl font-semibold text-gray-400">:</span>
        <div className="w-20">{b && <PanelBox panel={b} />}</div>
        <span className="px-1 text-2xl font-semibold text-gray-400">::</span>
        <div className="w-20">{c && <PanelBox panel={c} />}</div>
        <span className="text-2xl font-semibold text-gray-400">:</span>
        <div className="w-20">
          <PanelBox panel={{ blank: true }} />
        </div>
      </div>
    );
  }

  // row (sequence) — also used as a generic horizontal strip
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {puzzle.stem.map((panel, i) => (
        <div key={i} className="w-20">
          <PanelBox panel={panel} />
        </div>
      ))}
    </div>
  );
}
