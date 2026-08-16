import React from "react";
import type { Cell, Panel, Puzzle, PublicPuzzle, Scene, SceneToken, Visual } from "./schema";
import { isBlank, isScene } from "./schema";

/** Short factual description of a cell for screen readers, e.g. "2 solid medium triangles, rotated 45°". */
export function describeCell(cell: Cell): string {
  const countWord = cell.count === 1 ? "1" : String(cell.count);
  const shapeWord = cell.count === 1 ? cell.shape : `${cell.shape}s`;
  const rotPart = cell.rotation !== 0 ? `, rotated ${cell.rotation}°` : "";
  return `${countWord} ${cell.fill} ${cell.size === "s" ? "small" : cell.size === "l" ? "large" : "medium"} ${shapeWord}${rotPart}`;
}

/** Factual screen-reader description using the same categorical scene data. */
export function describeScene(scene: Scene): string {
  const parts: string[] = [`${scene.rows} by ${scene.columns} board`];
  for (const placement of [...scene.objects].sort((a, b) => a.row - b.row || a.column - b.column)) {
    const position = `row ${placement.row + 1}, column ${placement.column + 1}`;
    if (placement.object.kind === "token") {
      parts.push(`${describeCell({ ...placement.object, count: 1 })} at ${position}`);
    } else {
      const contents = placement.object.contents
        .map((token) => describeCell({ ...token, count: 1 }))
        .join(" and ");
      parts.push(`${contents} inside an outline ${placement.object.shape} at ${position}`);
    }
  }
  for (const tile of [...scene.tiles].sort((a, b) => a.row - b.row || a.column - b.column)) {
    parts.push(
      `${tile.edges.join("-")} connection at row ${tile.row + 1}, column ${tile.column + 1}`,
    );
  }
  for (const guide of scene.guides ?? []) {
    parts.push(`dashed ${guide.axis} fold crease through the board centre, folding ${guide.direction}`);
  }
  return parts.join("; ");
}

export function describeVisual(visual: Visual): string {
  return isScene(visual) ? describeScene(visual) : describeCell(visual);
}

/**
 * Deterministic SVG renderer. Pure functions of the puzzle data — no LLM, no
 * randomness — so a given Cell always draws identically. This is what guarantees
 * the displayed puzzle matches the generator's declared answer.
 */

const STROKE = "#111827"; // gray-900
const HALF_FILL = "#9ca3af"; // gray-400 — the "half" (shaded) state
export const CELL_VIEWBOX = 100;
export const CELL_CANVAS_PADDING = 6;
export const SCENE_BOARD_INSET = 6;
export const SCENE_GRID_STROKE = 2;
export const SCENE_CONNECTION_STROKE = 6;

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

// Legibility doctrine: small vs large must be unmistakable at a glance (the
// generator only uses "s" and "l"; "m" remains renderable for legacy data).
const SIZE_SCALE: Record<Cell["size"], number> = { s: 0.55, m: 1, l: 1.3 };

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
      // Match the circumradius used by every polygon so nominal sizes have the
      // same maximum extent. For a square, half-side = radius / sqrt(2).
      const s = r / Math.SQRT2;
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

function tokenAsCell(token: SceneToken): Cell {
  return { shape: token.shape, count: 1, rotation: token.rotation, fill: token.fill, size: token.size };
}

const SCENE_TOKEN_SCALE: Record<SceneToken["size"], number> = { m: 0.3, l: 0.39 };

function connectionEndpoint(
  edge: Scene["tiles"][number]["edges"][number],
  left: number,
  top: number,
  width: number,
  height: number,
): Pt {
  switch (edge) {
    case "north": return { x: left + width / 2, y: top };
    case "east": return { x: left + width, y: top + height / 2 };
    case "south": return { x: left + width / 2, y: top + height };
    case "west": return { x: left, y: top + height / 2 };
  }
}

/** Render a small board scene with explicit shared geometry in a 100x100 viewBox. */
export function SceneGraphic({ scene, className }: { scene: Scene; className?: string }) {
  const boardSize = CELL_VIEWBOX - SCENE_BOARD_INSET * 2;
  const columnWidth = boardSize / scene.columns;
  const rowHeight = boardSize / scene.rows;
  const slotSize = Math.min(columnWidth, rowHeight);

  return (
    <svg
      viewBox={`0 0 ${CELL_VIEWBOX} ${CELL_VIEWBOX}`}
      className={className}
      role="img"
      aria-label={describeScene(scene)}
    >
      <rect
        x={SCENE_BOARD_INSET}
        y={SCENE_BOARD_INSET}
        width={boardSize}
        height={boardSize}
        rx={2}
        fill="#ffffff"
        stroke={STROKE}
        strokeWidth={SCENE_GRID_STROKE}
      />
      {(scene.guides ?? []).map((guide) => {
        const arrow = guide.direction === "leftToRight" ? "→" : guide.direction === "rightToLeft" ? "←" :
          guide.direction === "topToBottom" ? "↓" : "↑";
        return (
          <g key={`guide-${guide.axis}-${guide.direction}`} data-scene-kind="crease">
            <line
              x1={guide.axis === "vertical" ? CELL_VIEWBOX / 2 : SCENE_BOARD_INSET}
              y1={guide.axis === "horizontal" ? CELL_VIEWBOX / 2 : SCENE_BOARD_INSET}
              x2={guide.axis === "vertical" ? CELL_VIEWBOX / 2 : CELL_VIEWBOX - SCENE_BOARD_INSET}
              y2={guide.axis === "horizontal" ? CELL_VIEWBOX / 2 : CELL_VIEWBOX - SCENE_BOARD_INSET}
              stroke={STROKE}
              strokeWidth={SCENE_GRID_STROKE + 1}
              strokeDasharray="7 5"
            />
            <text
              x={guide.axis === "vertical" ? CELL_VIEWBOX / 2 : CELL_VIEWBOX - 17}
              y={guide.axis === "vertical" ? 20 : CELL_VIEWBOX / 2 + 6}
              textAnchor="middle"
              fontSize="18"
              fontWeight="700"
              fill={STROKE}
            >{arrow}</text>
          </g>
        );
      })}
      {Array.from({ length: scene.columns - 1 }, (_, index) => {
        const x = SCENE_BOARD_INSET + (index + 1) * columnWidth;
        return <line key={`column-${index}`} x1={x} y1={SCENE_BOARD_INSET} x2={x} y2={CELL_VIEWBOX - SCENE_BOARD_INSET} stroke={HALF_FILL} strokeWidth={SCENE_GRID_STROKE} />;
      })}
      {Array.from({ length: scene.rows - 1 }, (_, index) => {
        const y = SCENE_BOARD_INSET + (index + 1) * rowHeight;
        return <line key={`row-${index}`} x1={SCENE_BOARD_INSET} y1={y} x2={CELL_VIEWBOX - SCENE_BOARD_INSET} y2={y} stroke={HALF_FILL} strokeWidth={SCENE_GRID_STROKE} />;
      })}
      {scene.tiles.map((tile) => {
        const left = SCENE_BOARD_INSET + tile.column * columnWidth;
        const top = SCENE_BOARD_INSET + tile.row * rowHeight;
        const center = { x: left + columnWidth / 2, y: top + rowHeight / 2 };
        return (
          <g key={`tile-${tile.row}-${tile.column}`} data-scene-position={`${tile.row}:${tile.column}`} data-scene-kind="connection">
            {tile.edges.map((edge) => {
              const endpoint = connectionEndpoint(edge, left, top, columnWidth, rowHeight);
              return (
                <line
                  key={edge}
                  data-connection-edge={edge}
                  x1={center.x}
                  y1={center.y}
                  x2={endpoint.x}
                  y2={endpoint.y}
                  stroke={STROKE}
                  strokeWidth={SCENE_CONNECTION_STROKE}
                  strokeLinecap="round"
                />
              );
            })}
            <circle cx={center.x} cy={center.y} r={SCENE_CONNECTION_STROKE / 2} fill={STROKE} />
          </g>
        );
      })}
      {scene.objects.map((placement) => {
        const center = {
          x: SCENE_BOARD_INSET + (placement.column + 0.5) * columnWidth,
          y: SCENE_BOARD_INSET + (placement.row + 0.5) * rowHeight,
        };
        const object = placement.object;
        if (object.kind === "token") {
          return (
            <g key={`object-${placement.row}-${placement.column}`} data-scene-position={`${placement.row}:${placement.column}`} data-scene-kind="token">
              <Shape cell={tokenAsCell(object)} at={center} r={slotSize * SCENE_TOKEN_SCALE[object.size]} />
            </g>
          );
        }

        const containerRadius = slotSize * 0.42;
        const contentCount = object.contents.length;
        return (
          <g key={`object-${placement.row}-${placement.column}`} data-scene-position={`${placement.row}:${placement.column}`} data-scene-kind="container">
            <Shape
              cell={{ shape: object.shape, count: 1, rotation: 0, fill: "outline", size: "l" }}
              at={center}
              r={containerRadius}
            />
            {object.contents.map((token, index) => {
              const offset = contentCount === 1 ? 0 : (index === 0 ? -1 : 1) * containerRadius * 0.34;
              const radiusScale = contentCount === 1
                ? (token.size === "l" ? 0.48 : 0.37)
                : (token.size === "l" ? 0.29 : 0.23);
              return (
                <Shape
                  key={index}
                  cell={tokenAsCell(token)}
                  at={{ x: center.x + offset, y: center.y }}
                  r={containerRadius * radiusScale}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Render a single cell's graphic into a 100×100 viewBox. */
export function CellGraphic({ cell, className }: { cell: Cell; className?: string }) {
  const { pts, baseR } = layoutFor(cell.count);
  const r = baseR * SIZE_SCALE[cell.size];
  return (
    <svg viewBox={`0 0 ${CELL_VIEWBOX} ${CELL_VIEWBOX}`} className={className} role="img" aria-label={describeCell(cell)}>
      {pts.map((p, i) => (
        <Shape key={i} cell={cell} at={p} r={r} />
      ))}
    </svg>
  );
}

/** Shared entry point used by the browser and standalone-image renderers. */
export function VisualGraphic({ visual, className }: { visual: Visual; className?: string }) {
  return isScene(visual)
    ? <SceneGraphic scene={visual} className={className} />
    : <CellGraphic cell={visual} className={className} />;
}

/** A blank panel — the cell to be solved. */
export function BlankGraphic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="blank — the cell to solve">
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="48" fill="#9ca3af">
        ?
      </text>
    </svg>
  );
}

function PanelBox({ panel }: { panel: Panel<Visual> }) {
  return (
    <div
      className="flex aspect-square items-center justify-center rounded-md border border-gray-200 bg-white"
      style={{ padding: `${CELL_CANVAS_PADDING}px`, boxSizing: "border-box" }}
    >
      {isBlank(panel) ? (
        <BlankGraphic className="h-full w-full" />
      ) : (
        <VisualGraphic visual={panel} className="h-full w-full" />
      )}
    </div>
  );
}

function GateBox({ panel }: { panel: Panel<Visual> }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-500 bg-white p-1">
      <PanelBox panel={panel} />
    </div>
  );
}

/** Render a puzzle's stem (the question) according to its layout. */
export function StemView({ puzzle }: { puzzle: Puzzle<Visual> | PublicPuzzle<Visual> }) {
  if (puzzle.layout === "conceptGroups") {
    const positive = puzzle.stem.slice(0, 3);
    const negative = puzzle.stem.slice(3, 6);
    const group = (label: string, panels: typeof positive) => (
      <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,3.5rem))] items-center justify-center gap-1 sm:grid-cols-[1.5rem_repeat(3,minmax(0,5rem))] sm:gap-2">
        <span className="text-center text-xl font-semibold text-gray-500" aria-hidden="true">{label}</span>
        {panels.map((panel, index) => (
          <div key={index} className="w-full"><PanelBox panel={panel} /></div>
        ))}
      </div>
    );
    return (
      <div className="mx-auto flex flex-col gap-3" aria-label="Examples that belong, then examples that do not belong">
        {group("✓", positive)}
        {group("×", negative)}
      </div>
    );
  }

  if (puzzle.layout === "grid3x3") {
    return (
      <div className="mx-auto grid w-full max-w-[280px] grid-cols-3 gap-2">
        {puzzle.stem.map((panel, i) => (
          <PanelBox key={i} panel={panel} />
        ))}
      </div>
    );
  }

  if (puzzle.layout === "operatorTable") {
    const rows = Array.from({ length: puzzle.stem.length / 3 }, (_, index) =>
      puzzle.stem.slice(index * 3, index * 3 + 3),
    );
    return (
      <div className="mx-auto flex w-full max-w-[390px] flex-col items-center gap-3">
        {puzzle.operatorLegend && (
          <div className="flex items-center justify-center gap-1" aria-label="Shape order">
            {puzzle.operatorLegend.shapeCycle.map((shape, index) => (
              <React.Fragment key={shape}>
                {index > 0 && <span className="text-gray-400">→</span>}
                <div className="w-8">
                  <CellGraphic
                    cell={{ shape, count: 1, rotation: 0, fill: "outline", size: "l" }}
                    className="h-full w-full"
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
        {rows.map(([left, right, output], index) => (
          <div key={index} className="flex w-full items-center justify-center gap-2">
            <div className="w-16">{left && <PanelBox panel={left} />}</div>
            <span className="text-xl font-semibold text-gray-400" aria-label="combined with">◆</span>
            <div className="w-16">{right && <PanelBox panel={right} />}</div>
            <span className="text-xl font-semibold text-gray-400">→</span>
            <div className="w-16">{output && <PanelBox panel={output} />}</div>
          </div>
        ))}
      </div>
    );
  }


  if (puzzle.layout === "machineTable") {
    const rows = Array.from({ length: puzzle.stem.length / 3 }, (_, index) =>
      puzzle.stem.slice(index * 3, index * 3 + 3),
    );
    return (
      <div className="mx-auto flex w-full max-w-[390px] flex-col items-center gap-3" aria-label="Worked transformation paths followed by one query path">
        {rows.map(([input, gate, output], index) => (
          <div key={index} className="flex w-full items-center justify-center gap-1 sm:gap-2">
            <div className="w-14 shrink-0 sm:w-20">{input && <PanelBox panel={input} />}</div>
            <span className="text-xl text-gray-400" aria-hidden="true">→</span>
            <div className="w-14 shrink-0 sm:w-20">{gate && <GateBox panel={gate} />}</div>
            <span className="text-xl text-gray-400" aria-hidden="true">→</span>
            <div className="w-14 shrink-0 sm:w-20">{output && <PanelBox panel={output} />}</div>
          </div>
        ))}
      </div>
    );
  }

  if (puzzle.layout === "analogy") {
    // [A, B, C] rendered as  A : B  ::  C : ?
    const [a, b, c] = puzzle.stem;
    return (
      <div className="flex flex-nowrap items-center justify-start gap-1 overflow-x-auto sm:justify-center sm:gap-2">
        <div className="w-14 shrink-0 sm:w-20">{a && <PanelBox panel={a} />}</div>
        <span className="text-2xl font-semibold text-gray-400">:</span>
        <div className="w-14 shrink-0 sm:w-20">{b && <PanelBox panel={b} />}</div>
        <span className="px-1 text-2xl font-semibold text-gray-400">::</span>
        <div className="w-14 shrink-0 sm:w-20">{c && <PanelBox panel={c} />}</div>
        <span className="text-2xl font-semibold text-gray-400">:</span>
        <div className="w-14 shrink-0 sm:w-20">
          <PanelBox panel={{ blank: true }} />
        </div>
      </div>
    );
  }

  // row (sequence) — also used as a generic horizontal strip
  return (
    <div className="flex flex-nowrap items-center justify-start gap-1 overflow-x-auto sm:justify-center sm:gap-2">
      {puzzle.stem.map((panel, i) => (
        <div key={i} className="w-14 shrink-0 sm:w-20">
          <PanelBox panel={panel} />
        </div>
      ))}
    </div>
  );
}
