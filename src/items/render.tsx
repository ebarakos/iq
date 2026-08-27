import React, { useEffect, useRef, useState } from "react";
import type { SceneCellSpec } from "./domains";
import type { Cell, Panel, Puzzle, PublicPuzzle, Scene, SceneToken, Visual } from "./schema";
import { isBlank, isScene } from "./schema";

/**
 * Short factual description of a drawable for screen readers, e.g. "2 solid
 * medium triangles, rotated 90°". Takes the wider scene spec so scene tokens
 * (which may be arrows) describe through exactly the same sentence.
 */
export function describeCell(cell: SceneCellSpec): string {
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

/**
 * A single arrow (head + stem) inscribed in radius `r` around (cx, cy).
 *
 * ORIENTATION CONVENTION: an arrow at rotation 0 points UP, matching the
 * triangle (`polygon()` starts its first vertex at -90°, i.e. straight up).
 * The shared `rotate(...)` transform then reads clockwise, so 90 points right,
 * 180 down, 270 left — four unmistakable glyphs, which is the whole reason the
 * arrow exists.
 *
 * Proportions are deliberately chunky (head 1.4r wide, stem 0.6r wide) so the
 * glyph survives the outline fill's 4-unit stroke at answer-option size.
 */
function arrow(cx: number, cy: number, r: number): string {
  const points: [number, number][] = [
    [0, -1], // tip
    [0.7, -0.22], // right barb
    [0.3, -0.22], // right shoulder
    [0.3, 0.88], // right tail
    [-0.3, 0.88], // left tail
    [-0.3, -0.22], // left shoulder
    [-0.7, -0.22], // left barb
  ];
  return points
    .map(([x, y]) => `${(cx + x * r).toFixed(2)},${(cy + y * r).toFixed(2)}`)
    .join(" ");
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

function Shape({ cell, at, r }: { cell: SceneCellSpec; at: Pt; r: number }) {
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
    case "arrow":
      return <polygon points={arrow(at.x, at.y, r)} {...common} />;
    default:
      return null;
  }
}

function tokenAsCell(token: SceneToken): SceneCellSpec {
  return { shape: token.shape, count: 1, rotation: token.rotation, fill: token.fill, size: token.size };
}

/**
 * Anything the shared renderer can draw. `Visual` (a `Cell` or a `Scene`) is the
 * puzzle-data form; a scene token pulled out of its board is a `SceneCellSpec`,
 * which is the same drawable spec with the scene-only arrow shape allowed.
 */
export type Drawable = Scene | SceneCellSpec;

function isDrawableScene(drawable: Drawable): drawable is Scene {
  return "kind" in drawable && drawable.kind === "scene";
}

/**
 * The glyphs of a machine gate cell, in the order they are applied.
 *
 * A gate panel carries no board: `gateVisual` (src/items/scene-families.ts)
 * writes one token per gate id into ascending board columns, so a worked row
 * shows one glyph and a query row shows the two to four glyphs of a combined
 * gate. Drawing that panel as a board packs every glyph into a third of a third
 * of a cell — about 7px on a 375px phone, which is what made the combined gate
 * unreadable in the 2026-08-24 QA pass. Reading the tokens out lets both
 * renderers give each glyph a cell of its own and draw it at cell scale.
 *
 * Returns the glyphs left to right, or the panel itself when it is not a
 * board-free token scene (nothing else is expected in a gate cell, but a
 * renderer must never drop a panel it does not recognise).
 */
export function gateGlyphs(panel: Panel<Visual>): Drawable[] {
  if (isBlank(panel)) return [];
  if (!isScene(panel)) return [panel];
  const tokens = panel.objects.flatMap((placement) =>
    placement.object.kind === "token"
      ? [{ row: placement.row, column: placement.column, token: placement.object }]
      : []);
  if (panel.tiles.length > 0 || (panel.guides?.length ?? 0) > 0 || tokens.length !== panel.objects.length) {
    return [panel];
  }
  return tokens
    .sort((left, right) => left.column - right.column || left.row - right.row)
    .map((placement) => tokenAsCell(placement.token));
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
export function CellGraphic({ cell, className }: { cell: SceneCellSpec; className?: string }) {
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
export function VisualGraphic({ visual, className }: { visual: Drawable; className?: string }) {
  return isDrawableScene(visual)
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

function PanelBox({ panel }: { panel: Drawable | { blank: true } }) {
  return (
    <div
      className="flex aspect-square items-center justify-center rounded-md border border-gray-200 bg-white"
      style={{ padding: `${CELL_CANVAS_PADDING}px`, boxSizing: "border-box" }}
    >
      {"blank" in panel ? (
        <BlankGraphic className="h-full w-full" />
      ) : (
        <VisualGraphic visual={panel} className="h-full w-full" />
      )}
    </div>
  );
}

/**
 * Room a machine row has to lay itself out in on the narrowest phone the app
 * serves, in CSS pixels.
 *
 * 375px of viewport, less the page's 16px side padding (32), the question
 * card's 1px borders (2) and 24px padding (48), and the diagram panel's 16px
 * padding (32). Anything wider than this is cut off, and a cut-off gate strip
 * is exactly what the 2026-08-24 QA pass caught. `gateStripWidth` below is
 * measured against it by test rather than eyeballed in a browser.
 */
export const NARROW_VIEWPORT_STEM_WIDTH = 261;

/**
 * Gate strip geometry, in CSS pixels at the narrowest viewport. Each constant
 * is the Tailwind class the markup below actually uses, so the two cannot
 * drift apart without the strip-width test noticing.
 *
 * "Cannot drift" is now checked rather than asserted. Until 2026-08-26 the
 * markup gave a non-wide glyph `w-20` (80px) while this constant said 56px, so
 * a three-glyph strip really laid out at 308px and overflowed the 261px a
 * phone has by 47px, with nothing to catch it. The glyph cell is back to
 * `w-14 sm:w-20` — 56px on a phone, the size the four-gate strip's own comment
 * always claimed — and a test in compose-image.test.ts now rebuilds the width
 * from the classes the rendered markup carries.
 */
export const GATE_GLYPH_WIDTH = 56; // w-14
export const GATE_SEPARATOR_WIDTH = 20; // w-5
/** A four-gate strip trades glyph width for the fourth glyph; three still fit at full size. */
export const WIDE_GATE_GLYPH_COUNT = 4;
export const WIDE_GATE_GLYPH_WIDTH = 44; // w-11
export const WIDE_GATE_SEPARATOR_WIDTH = 14; // w-3.5
export const GATE_STRIP_GAP = 4; // gap-1
export const GATE_STRIP_FRAME = 6; // p-1 plus border-2, per side

/**
 * At five glyphs the strip drops the "→" columns between them and keeps the
 * glyph exactly the size a four-gate strip already uses.
 *
 * The arithmetic leaves no other choice. Five 44px glyphs are 220px on their
 * own; the 261px a 375px phone has leaves 41px for everything else, and the
 * dashed frame takes 12 of it. Four arrow columns and eight gaps cannot fit in
 * the remaining 29px at any size a person could read. The alternative — keeping
 * the arrows and shrinking the glyph — is barred: the drawn shape inside a 44px
 * glyph cell already sits within a third of a pixel of this project's measured
 * legibility floor (the solid square spans 24.27px against a 24px floor), so
 * one Tailwind step down would put the mark below it, and the doctrine forbids
 * buying depth with smaller marks. What the strip loses is a decorative
 * ordering cue that the instruction ("apply the five query gates from left to
 * right"), the group label, and the worked rows above all still carry.
 */
export const UNSEPARATED_GATE_GLYPH_COUNT = 5;

/** Laid-out width of a gate strip holding `glyphCount` glyphs. */
export function gateStripWidth(glyphCount: number): number {
  if (glyphCount === 0) return GATE_GLYPH_WIDTH;
  const wide = glyphCount >= WIDE_GATE_GLYPH_COUNT;
  const glyph = wide ? WIDE_GATE_GLYPH_WIDTH : GATE_GLYPH_WIDTH;
  const separator = wide ? WIDE_GATE_SEPARATOR_WIDTH : GATE_SEPARATOR_WIDTH;
  const separators = glyphCount >= UNSEPARATED_GATE_GLYPH_COUNT ? 0 : glyphCount - 1;
  // One gap between every pair of the strip's children: glyphs and separators.
  const gaps = Math.max(0, glyphCount + separators - 1);
  return glyphCount * glyph +
    separators * separator +
    gaps * GATE_STRIP_GAP +
    GATE_STRIP_FRAME * 2;
}

/**
 * A machine gate: the dashed frame plus one full-size cell per gate glyph, read
 * left to right. A combined query gate used to be squeezed into a single cell,
 * which left each glyph about 7px wide on a phone; giving every glyph the cell a
 * worked row gives its own gate keeps the query readable at the same size the
 * user has already learned to read.
 *
 * The strip never wraps. A wrapped strip stops reading as one ordered program,
 * so a four-gate strip takes narrower glyphs and a narrower arrow instead —
 * still far larger than the cell-share it would get on a board, and `254px`
 * against the `261px` a phone actually has. A five-gate strip keeps that same
 * glyph and drops the arrow columns instead: `248px`, and the mark never
 * shrinks (see `UNSEPARATED_GATE_GLYPH_COUNT`).
 */
function GateBox({ panel }: { panel: Panel<Visual> }) {
  const glyphs = gateGlyphs(panel);
  // A gate cell always holds at least one glyph. An empty one would be a data
  // error, and it draws as an ordinary panel rather than an empty dashed frame.
  if (glyphs.length === 0) {
    return <div className="w-14 shrink-0 sm:w-20"><PanelBox panel={panel} /></div>;
  }
  const wide = glyphs.length >= WIDE_GATE_GLYPH_COUNT;
  const separated = glyphs.length < UNSEPARATED_GATE_GLYPH_COUNT;
  return (
    <div
      className="flex shrink-0 flex-nowrap items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gray-500 bg-white p-1"
      // A bare div's aria-label is ignored by screen readers; the label only
      // reaches them once the element has a role of its own.
      role={glyphs.length > 1 ? "group" : undefined}
      aria-label={glyphs.length > 1 ? `${glyphs.length} gates, applied left to right` : undefined}
    >
      {glyphs.map((glyph, index) => (
        <React.Fragment key={index}>
          {index > 0 && separated && (
            <span
              className={`shrink-0 text-center text-gray-400 ${wide ? "w-3.5 text-sm" : "w-5 text-lg"}`}
              aria-hidden="true"
            >→</span>
          )}
          <div className={`shrink-0 ${wide ? "w-11 sm:w-16" : "w-14 sm:w-20"}`}>
            <PanelBox panel={glyph} />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * A horizontal strip of panels that scrolls when it is wider than the space it
 * has, with a fade and a chevron on whichever edge is currently cut off.
 *
 * The 2026-08-24 QA pass caught an eight-panel row showing its later panels as a
 * sliver with nothing to say the row continued. The markers are measured, not
 * assumed: the first paint carries none, and a strip that fits never grows one.
 */
/**
 * A horizontal strip of panels.
 *
 * `wrap` is for strips whose panels are a plain left-to-right list: they may
 * fold onto a second line so every panel stays on screen at once, which a
 * sequence needs — you cannot compare term 1 with term 5 while one of them is
 * scrolled away. Strips whose panels come in glued pairs (analogy `A : B`, a
 * machine's `in → out`) must NOT wrap, or a line break lands between a pair and
 * invents a grouping the puzzle does not have; those keep scrolling instead.
 */
function ScrollStrip({ children, label, wrap = false }: { children: React.ReactNode; label?: string; wrap?: boolean }) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const [cut, setCut] = useState({ start: false, end: false });

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const hidden = node.scrollWidth - node.clientWidth;
      setCut({ start: node.scrollLeft > 1, end: hidden - node.scrollLeft > 1 });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    if (content.current) observer?.observe(content.current);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div ref={viewport} className="overflow-x-auto" aria-label={label}>
        {/* w-max + auto margins centre a strip that fits and left-align one that
            does not: a centred overflowing strip hides its first panel where no
            scroll can reach it. */}
        <div
          ref={content}
          className={`mx-auto flex items-center gap-1 sm:gap-2 ${
            wrap ? "w-full flex-wrap justify-center gap-y-2" : "w-max flex-nowrap"
          }`}
        >
          {children}
        </div>
      </div>
      {cut.start && <StripEdge side="start" />}
      {cut.end && <StripEdge side="end" />}
    </div>
  );
}

/** The fade plus chevron that marks a cut-off edge of a scrolling strip. */
function StripEdge({ side }: { side: "start" | "end" }) {
  return (
    <div
      aria-hidden="true"
      data-strip-edge={side}
      className={`pointer-events-none absolute inset-y-0 flex w-10 items-center ${
        side === "end"
          ? "right-0 justify-end bg-gradient-to-l from-gray-50 via-gray-50 to-transparent"
          : "left-0 justify-start bg-gradient-to-r from-gray-50 via-gray-50 to-transparent"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <polyline points={side === "end" ? "9,5 16,12 9,19" : "15,5 8,12 15,19"} />
      </svg>
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
    // The rows wrap: a query row carrying a multi-glyph gate is wider than a
    // phone, and wrapping it puts the whole gate strip on a line of its own
    // instead of shrinking it back into an unreadable single cell.
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-3" aria-label="Worked transformation paths followed by one query path">
        {rows.map(([input, gate, output], index) => (
          <div key={index} className="flex w-full flex-wrap items-center justify-center gap-1 sm:gap-2">
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <div className="w-20 shrink-0">{input && <PanelBox panel={input} />}</div>
              <span className="text-xl text-gray-400" aria-hidden="true">→</span>
            </div>
            {gate && <GateBox panel={gate} />}
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <span className="text-xl text-gray-400" aria-hidden="true">→</span>
              <div className="w-20 shrink-0">{output && <PanelBox panel={output} />}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (puzzle.layout === "combineTable") {
    // (left, gate, right, output) per row. The gate glyph sits BETWEEN the two
    // boards it combines, which is the whole difference from a machine table:
    // there the gate transforms one board and stands before it.
    const rows = Array.from({ length: puzzle.stem.length / 4 }, (_, index) =>
      puzzle.stem.slice(index * 4, index * 4 + 4),
    );
    return (
      <div
        className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-3"
        aria-label="Worked combinations followed by one query combination"
      >
        {rows.map(([left, gate, right, output], index) => (
          <div key={index} className="flex w-full flex-wrap items-center justify-center gap-1 sm:gap-2">
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <div className="w-20 shrink-0">{left && <PanelBox panel={left} />}</div>
            </div>
            {gate && <GateBox panel={gate} />}
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <div className="w-20 shrink-0">{right && <PanelBox panel={right} />}</div>
              <span className="text-xl text-gray-400" aria-hidden="true">→</span>
              <div className="w-20 shrink-0">{output && <PanelBox panel={output} />}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (puzzle.layout === "analogy") {
    // [A, B, C] rendered as  A : B  ::  C : ?
    const [a, b, c] = puzzle.stem;
    return (
      <ScrollStrip label="Analogy: the first pair, then the pair to complete">
        <div className="w-20 shrink-0">{a && <PanelBox panel={a} />}</div>
        <span className="text-2xl font-semibold text-gray-400">:</span>
        <div className="w-20 shrink-0">{b && <PanelBox panel={b} />}</div>
        <span className="px-1 text-2xl font-semibold text-gray-400">::</span>
        <div className="w-20 shrink-0">{c && <PanelBox panel={c} />}</div>
        <span className="text-2xl font-semibold text-gray-400">:</span>
        <div className="w-20 shrink-0">
          <PanelBox panel={{ blank: true }} />
        </div>
      </ScrollStrip>
    );
  }

  // row (sequence) — also used as a generic horizontal strip
  return (
    <ScrollStrip label="Sequence, left to right" wrap>
      {puzzle.stem.map((panel, i) => (
        <div key={i} className="w-20 shrink-0">
          <PanelBox panel={panel} />
        </div>
      ))}
    </ScrollStrip>
  );
}
