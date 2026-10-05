import React from "react";
import type { SceneTokenSpec } from "./domains";
import type { Panel, Puzzle, PublicPuzzle, Scene, SceneToken } from "./schema";
import { isBlank } from "./schema";
import { gatePieceTexture, type GatePieceTexture } from "./gate-pieces";

/** Short factual description of one token for screen readers, e.g. "1 solid large triangle, rotated 90°". */
export function describeToken(token: SceneTokenSpec): string {
  const rotPart = token.rotation !== 0 ? `, rotated ${token.rotation}°` : "";
  return `1 ${token.fill} ${token.size === "s" ? "small" : token.size === "l" ? "large" : "medium"} ${token.shape}${rotPart}`;
}

/** Factual screen-reader description using the same categorical scene data. */
export function describeScene(scene: Scene): string {
  const parts: string[] = [`${scene.rows} by ${scene.columns} board`];
  for (const placement of [...scene.objects].sort((a, b) => a.row - b.row || a.column - b.column)) {
    const position = `row ${placement.row + 1}, column ${placement.column + 1}`;
    if (placement.object.kind === "token") {
      parts.push(`${describeToken(placement.object)} at ${position}`);
    } else {
      const contents = placement.object.contents
        .map((token) => describeToken(token))
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

/**
 * Deterministic SVG renderer. Pure functions of the puzzle data — no LLM, no
 * randomness — so a given scene always draws identically. This is what guarantees
 * the displayed puzzle matches the generator's declared answer.
 */

const STROKE = "#111827"; // gray-900
const HALF_FILL = "#9ca3af"; // gray-400 — the "half" (shaded) state
/** gray-500: darker than a board's grid lines, lighter than any shape. */
export const FLOW_ARROW_STROKE = "#6b7280";
export const CELL_VIEWBOX = 100;
export const CELL_CANVAS_PADDING = 6;
export const SCENE_BOARD_INSET = 6;
export const SCENE_GRID_STROKE = 2;
export const SCENE_CONNECTION_STROKE = 6;

type Pt = { x: number; y: number };

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

/**
 * Inner radius of a star's notches, as a share of its outer radius.
 *
 * 0.42 until 2026-10-04, when a star's arms were too thin for grey to read:
 * after its 3-unit outline, a grey star showed about two thirds of the grey a
 * grey triangle of the same size shows, and Opus 5.5 lost an easy question
 * because it could not see a star turn from white to grey. At 0.55 a grey star
 * shows more grey than a grey triangle; a test in compose-image.test.ts keeps it
 * there at the 64px review and 80px solve board sizes.
 */
export const STAR_INNER_RATIO = 0.55;

/** 5-point star points around (cx, cy). */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * STAR_INNER_RATIO;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function fillProps(fill: SceneToken["fill"]): { fill: string; stroke: string; strokeWidth: number } {
  if (fill === "solid") return { fill: STROKE, stroke: STROKE, strokeWidth: 2 };
  if (fill === "half") return { fill: HALF_FILL, stroke: STROKE, strokeWidth: 3 };
  return { fill: "none", stroke: STROKE, strokeWidth: 4 }; // outline
}

function Shape({ token, at, r }: { token: SceneTokenSpec; at: Pt; r: number }) {
  const fp = fillProps(token.fill);
  const common = {
    ...fp,
    strokeLinejoin: "round" as const,
    transform: `rotate(${token.rotation} ${at.x} ${at.y})`,
  };

  switch (token.shape) {
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

/**
 * The glyphs of a machine gate cell, in the order they are applied.
 *
 * A gate panel carries no board: `gateVisual` (src/items/scene-families.ts)
 * writes one token per gate id into ascending board columns, so a worked row
 * shows one glyph and a query row shows the two or three glyphs of a combined
 * gate. Drawing that panel as a board packs every glyph into a third of a third
 * of a cell — about 7px on a 375px phone, which is what made the combined gate
 * unreadable in the 2026-08-24 QA pass. Reading the tokens out lets both
 * renderers give each glyph a cell of its own and draw it at cell scale.
 *
 * Returns the glyphs left to right, or the panel itself when it is not a
 * board-free token scene (nothing else is expected in a gate cell, but a
 * renderer must never drop a panel it does not recognise).
 */
export function gateGlyphs(panel: Panel): Array<Scene | SceneToken> {
  if (isBlank(panel)) return [];
  const tokens = panel.objects.flatMap((placement) =>
    placement.object.kind === "token"
      ? [{ row: placement.row, column: placement.column, token: placement.object }]
      : []);
  if (panel.tiles.length > 0 || (panel.guides?.length ?? 0) > 0 || tokens.length !== panel.objects.length) {
    return [panel];
  }
  return tokens
    .sort((left, right) => left.column - right.column || left.row - right.row)
    .map((placement) => placement.token);
}

/**
 * A gate panel as jigsaw textures, in application order, or null when any of
 * its glyphs is not a gate glyph (the panel is then drawn as it is).
 */
export function gatePieces(panel: Panel): GatePieceTexture[] | null {
  const glyphs = gateGlyphs(panel);
  if (glyphs.length === 0) return null;
  const textures = glyphs.map((glyph) =>
    glyph.kind === "token" ? gatePieceTexture(glyph.shape, glyph.fill) : null);
  return textures.every((texture): texture is GatePieceTexture => texture !== null) ? textures : null;
}

/**
 * One jigsaw piece in its own units, tab to the right: a 38 × 30 body, a tab
 * of radius 6 on the right edge and a notch of the same size cut into the left
 * one. Pieces `JIGSAW_PIECE_STEP` apart fit tab into notch.
 */
export const JIGSAW_PIECE_WIDTH = 46;
export const JIGSAW_PIECE_HEIGHT = 32;
export const JIGSAW_PIECE_STEP = 38;
const JIGSAW_PIECE_PATH = "M1 1 H39 V10 A6 6 0 0 1 39 22 V31 H1 V22 A6 6 0 0 0 1 10 Z";
const JIGSAW_INK = "#374151"; // gray-700: dark against white, lighter than the outline
/** Where a texture may draw: inside the body, clear of the notch and the tab. */
const JIGSAW_TEXTURE_AREA = { x0: 9, x1: 36, y0: 4, y1: 28 } as const;

/** Laid-out size, in piece units, of `count` pieces snapped together. */
export function jigsawStripSize(count: number, direction: "right" | "down"): { width: number; height: number } {
  const length = JIGSAW_PIECE_STEP * (Math.max(1, count) - 1) + JIGSAW_PIECE_WIDTH;
  return direction === "right"
    ? { width: length, height: JIGSAW_PIECE_HEIGHT }
    : { width: JIGSAW_PIECE_HEIGHT, height: length };
}

/** Parallel rising 45° lines ("/") across the texture area. */
function hatchLines(spacing: number): [number, number, number, number][] {
  const { x0, x1, y0, y1 } = JIGSAW_TEXTURE_AREA;
  const lines: [number, number, number, number][] = [];
  // x + y = c
  for (let c = x0 + y0 + spacing / 2; c < x1 + y1; c += spacing) {
    const from = Math.max(x0, c - y1);
    const to = Math.min(x1, c - y0);
    if (to - from > 1) lines.push([from, c - from, to, c - to]);
  }
  return lines;
}

function jigsawTexture(texture: GatePieceTexture): React.ReactNode {
  const line = ([x1, y1, x2, y2]: [number, number, number, number], width: number, key: string) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={JIGSAW_INK} strokeWidth={width} strokeLinecap="round" />
  );
  switch (texture) {
    case "dark":
      return null;
    case "dotted":
      return [13, 20, 27, 34].flatMap((x) => [9, 16, 23].map((y) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2} fill={JIGSAW_INK} />
      )));
    case "striped":
      return hatchLines(6).map((segment, index) => line(segment, 2.2, `s${index}`));
  }
}

/**
 * Gate pieces snapped together, tabs pointing the way the board travels:
 * right on a wide screen and in the agent image, down when a phone stacks
 * them. Shared by both renderers; it draws in piece units at the origin.
 */
export function JigsawPieces({ textures, direction }: { textures: GatePieceTexture[]; direction: "right" | "down" }) {
  return (
    <g>
      {textures.map((texture, index) => (
        <g
          key={index}
          data-gate-piece={texture}
          transform={direction === "right"
            ? `translate(${index * JIGSAW_PIECE_STEP} 0)`
            : `translate(${JIGSAW_PIECE_HEIGHT} ${index * JIGSAW_PIECE_STEP}) rotate(90)`}
        >
          <path
            d={JIGSAW_PIECE_PATH}
            fill={texture === "dark" ? JIGSAW_INK : "#ffffff"}
            stroke={STROKE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {jigsawTexture(texture)}
        </g>
      ))}
    </g>
  );
}

/** What a screen reader hears for a gate: the piece, or the pieces in order. */
export function describeGatePieces(textures: readonly GatePieceTexture[]): string {
  return textures.length === 1
    ? `machine: ${textures[0]} jigsaw piece`
    : `machine: ${textures.length} jigsaw pieces snapped together, used in tab order: ${textures.join(", ")}`;
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
              <Shape token={object} at={center} r={slotSize * SCENE_TOKEN_SCALE[object.size]} />
            </g>
          );
        }

        const containerRadius = slotSize * 0.42;
        const contentCount = object.contents.length;
        return (
          <g key={`object-${placement.row}-${placement.column}`} data-scene-position={`${placement.row}:${placement.column}`} data-scene-kind="container">
            <Shape
              token={{ shape: object.shape, rotation: 0, fill: "outline", size: "l" }}
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
                  token={token}
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

/** A blank panel — the cell to be solved. */
export function BlankGraphic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="blank: the cell to solve">
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="48" fill="#9ca3af">
        ?
      </text>
    </svg>
  );
}

/**
 * One stem picture in its frame. The frame's inner padding is 3px on a phone
 * and `CELL_CANVAS_PADDING` (6px) from `sm:` up: a phone row can need its
 * boards a little narrower than 80px, and the thinner padding hands most of
 * that back to the drawing.
 */
function PanelBox({ panel }: { panel: Panel }) {
  return (
    <div className="box-border flex aspect-square items-center justify-center rounded-md border border-gray-200 bg-white p-[3px] sm:p-1.5">
      {"blank" in panel ? (
        <BlankGraphic className="h-full w-full" />
      ) : (
        <SceneGraphic scene={panel} className="h-full w-full" />
      )}
    </div>
  );
}

/**
 * Room the stem has on the narrowest phone the app serves, in CSS pixels.
 *
 * 375px of viewport, less the page's 16px side padding (32), the question
 * card's 1px borders (2) and its 12px phone padding (24), and the diagram
 * panel's 8px phone padding (16). Until 2026-10-03 the card and panel kept
 * their desktop padding on a phone and the stem had 261px, which is why every
 * table row and sequence used to fold. Every phone layout below is priced
 * against this number by test, from the classes its markup really carries.
 */
export const NARROW_VIEWPORT_STEM_WIDTH = 301;

/**
 * Gate geometry, in CSS pixels on a phone. One gate is one piece lying on its
 * side, 56px wide. Several stack top to bottom in a 40px column, tabs down, so
 * a machine row (input, gate, output) stays on one line, which is what keeps a
 * table reading as a table.
 */
export const GATE_PIECE_WIDTH = 56; // w-14
export const GATE_STACK_WIDTH = 40; // w-10

/** Laid-out width on a phone of a gate holding `glyphCount` pieces. */
export function gateStripWidth(glyphCount: number): number {
  return glyphCount > 1 ? GATE_STACK_WIDTH : GATE_PIECE_WIDTH;
}

/**
 * From `sm:` up the pieces lie side by side, 1.6px per piece unit: 74px for
 * one, 195px for three. Literal class names: Tailwind only generates the
 * classes it can see written out.
 */
const WIDE_GATE_STRIP_WIDTHS: Record<number, string> = {
  1: "sm:w-[74px]", 2: "sm:w-[134px]", 3: "sm:w-[195px]",
};

function JigsawStrip({ textures, direction, className }: {
  textures: GatePieceTexture[];
  direction: "right" | "down";
  className: string;
}) {
  const { width, height } = jigsawStripSize(textures.length, direction);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" data-gate-strip={direction}>
      <JigsawPieces textures={textures} direction={direction} />
    </svg>
  );
}

/**
 * A machine gate: its jigsaw pieces, in application order (owner's choice,
 * 2026-10-04; the dashed box of board shapes it replaces is in
 * docs/plans/gate-order-and-labels.md). The pieces carry the order themselves,
 * tab into notch, so no arrows sit between them.
 */
function GateBox({ panel }: { panel: Panel }) {
  const textures = gatePieces(panel);
  // Every served gate glyph has a piece; anything else is a data error, and it
  // draws as an ordinary panel rather than disappearing.
  if (!textures) {
    return <div className="w-14 shrink-0 sm:w-20"><PanelBox panel={panel} /></div>;
  }
  const stacked = textures.length > 1;
  return (
    <div className="flex shrink-0 items-center justify-center" role="img" aria-label={describeGatePieces(textures)}>
      <JigsawStrip
        textures={textures}
        direction={stacked ? "down" : "right"}
        className={`h-auto sm:hidden ${stacked ? "w-10" : "w-14"}`}
      />
      <JigsawStrip
        textures={textures}
        direction="right"
        className={`hidden h-auto sm:block ${WIDE_GATE_STRIP_WIDTHS[textures.length] ?? WIDE_GATE_STRIP_WIDTHS[3]}`}
      />
    </div>
  );
}

/**
 * Table row geometry on a phone, priced like the gate strip: a machine row is
 * input → gate → output with 80px boards and 16px arrows, `gap-1` apart.
 */
export const TABLE_PANEL_WIDTH = 80; // w-20
export const TABLE_ARROW_WIDTH = 16; // w-4
export const TABLE_GAP = 4; // gap-1

/** Laid-out width of a machine row on a phone whose gate holds `glyphCount` glyphs. */
export function machineRowWidth(glyphCount: number): number {
  return TABLE_PANEL_WIDTH * 2 + TABLE_ARROW_WIDTH * 2 + TABLE_GAP * 4 + gateStripWidth(glyphCount);
}

/**
 * Sequence geometry. Every picture carries its number above it and an arrow
 * column in front of it — the first picture's arrow column is empty, which
 * keeps the pictures of a folded second line under those of the first, and
 * makes a folded line open with "→", which reads as "continued".
 */
export const SEQUENCE_PANEL_WIDTH = 80; // w-20 (5rem)
export const SEQUENCE_ARROW_WIDTH = 14; // 0.875rem
/** Between an arrow and its picture (`gap-x-0.5`), and between pictures (`gap-x-1`). */
export const SEQUENCE_ARROW_GAP = 2;
export const SEQUENCE_GAP = 4;
/** Most pictures on one line below `md:`, and from `md:` up. */
export const SEQUENCE_PHONE_MAX_PER_LINE = 3;
export const SEQUENCE_WIDE_MAX_PER_LINE = 6;

/**
 * Pictures per line when `count` pictures fold into lines of at most `max`: as
 * few lines as possible, then as even as possible. Four pictures fold 2 + 2 and
 * six fold 3 + 3 — never three plus a lone "?", which is what made a folded
 * sequence look like a matrix before 2026-10-03.
 */
export function sequencePerLine(count: number, max: number): number {
  if (count <= 0) return 1;
  return Math.ceil(count / Math.ceil(count / max));
}

/** Laid-out width of one sequence line holding `perLine` pictures. */
export function sequenceLineWidth(perLine: number): number {
  return perLine * (SEQUENCE_ARROW_WIDTH + SEQUENCE_ARROW_GAP + SEQUENCE_PANEL_WIDTH) +
    (perLine - 1) * SEQUENCE_GAP;
}

// Literal class names: Tailwind only generates the classes it can see written out.
const PHONE_SEQUENCE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3",
};
const WIDE_SEQUENCE_COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3",
  4: "md:grid-cols-4", 5: "md:grid-cols-5", 6: "md:grid-cols-6",
};

/**
 * Analogy row geometry: "A → B", then "C → ?" directly beneath it. One row is
 * two 80px boards, a 32px arrow, `gap-1` between them and `px-2` round them.
 */
export const ANALOGY_PANEL_WIDTH = 80; // w-20
export const ANALOGY_ARROW_WIDTH = 32; // w-8
export const ANALOGY_ROW_GAP = 4; // gap-1
export const ANALOGY_ROW_PADDING = 8; // px-2

/** Laid-out width of one analogy row. */
export function analogyRowWidth(): number {
  return ANALOGY_PANEL_WIDTH * 2 + ANALOGY_ARROW_WIDTH + ANALOGY_ROW_GAP * 2 + ANALOGY_ROW_PADDING * 2;
}

/**
 * The arrow between pictures, drawn rather than typed so it is equally bold in
 * every font a phone might fall back to. Decorative: the layout's label says
 * what it means.
 */
function FlowArrow({ direction = "right", className = "" }: { direction?: "right" | "down"; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      data-flow-arrow={direction}
      fill="none"
      stroke={FLOW_ARROW_STROKE}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform={direction === "down" ? "rotate(90 12 12)" : undefined}>
        <line x1="3" y1="12" x2="20" y2="12" />
        <polyline points="13,5 20,12 13,19" />
      </g>
    </svg>
  );
}

/** Render a puzzle's stem (the question) according to its layout. */
export function StemView({ puzzle }: { puzzle: Puzzle | PublicPuzzle }) {
  if (puzzle.layout === "grid3x3") {
    // Arrows only when the rule runs one way: an arrow column before the third
    // board of every row says "these two make this one, across". A grid whose
    // rule runs down the columns too reads both ways and draws no arrows
    // (owner's decision, 2026-10-03), like a grid built before `gridFlow`.
    if (puzzle.gridFlow !== "rows") {
      return (
        <div className="mx-auto grid w-full max-w-[280px] grid-cols-3 gap-2">
          {puzzle.stem.map((panel, i) => (
            <PanelBox key={i} panel={panel} />
          ))}
        </div>
      );
    }
    const cells: React.ReactNode[] = [];
    for (let row = 0; row < 3; row++) {
      const [first, second, third] = puzzle.stem.slice(row * 3, row * 3 + 3);
      cells.push(
        <PanelBox key={`${row}-0`} panel={first} />,
        <PanelBox key={`${row}-1`} panel={second} />,
        <FlowArrow key={`${row}-arrow`} className="h-3 w-3" />,
        <PanelBox key={`${row}-2`} panel={third} />,
      );
    }
    return (
      <div
        className="mx-auto grid w-full max-w-[300px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_0.75rem_minmax(0,1fr)] items-center gap-2"
        aria-label="3 by 3 grid: in every row, the first two boards make the third"
      >
        {cells}
      </div>
    );
  }

  if (puzzle.layout === "machineTable") {
    const rows = Array.from({ length: puzzle.stem.length / 3 }, (_, index) =>
      puzzle.stem.slice(index * 3, index * 3 + 3),
    );
    // Every row is one line at every width: input → gate → output. On a phone
    // a multi-gate strip stacks its pieces instead of widening the row
    // (`machineRowWidth` prices it). A row that folded put its output alone
    // on a second line, which read as the start of another row. `sm:flex-wrap`
    // is only a safety net for strips wider than any served bucket draws.
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-3" aria-label="Worked transformation paths followed by one query path">
        {rows.map(([input, gate, output], index) => (
          <div key={index} className="flex w-full flex-nowrap items-center justify-center gap-1 rounded-lg bg-gray-100/70 py-2 sm:flex-wrap sm:gap-2">
            <div className="w-20 shrink-0">{input && <PanelBox panel={input} />}</div>
            <FlowArrow className="h-4 w-4 shrink-0" />
            {gate && <GateBox panel={gate} />}
            <FlowArrow className="h-4 w-4 shrink-0" />
            <div className="w-20 shrink-0">{output && <PanelBox panel={output} />}</div>
          </div>
        ))}
      </div>
    );
  }

  if (puzzle.layout === "analogy") {
    // [A, B, C] rendered as two aligned rows: "A → B" over "C → ?". The old
    // "A : B :: C : ?" line folded at "::" on a phone, and its notation was
    // unfamiliar; stacked rows say "the same change, again" at every width.
    const [a, b, c] = puzzle.stem;
    const pairs: [Panel | undefined, Panel][] = [[a, b ?? { blank: true }], [c, { blank: true }]];
    return (
      <div
        className="mx-auto flex w-max flex-col gap-2"
        aria-label="Analogy: the top pair shows a change; the bottom pair makes the same change"
      >
        {pairs.map(([left, right], index) => (
          <div key={index} className="flex flex-nowrap items-center gap-1 rounded-lg bg-gray-100/70 px-2 py-2">
            <div className="w-20 shrink-0">{left && <PanelBox panel={left} />}</div>
            <FlowArrow className="h-7 w-8 shrink-0" />
            <div className="w-20 shrink-0"><PanelBox panel={right} /></div>
          </div>
        ))}
      </div>
    );
  }

  // row (sequence): numbered pictures with an arrow before each one after the
  // first, folding into balanced lines on a phone. Numbers make a fold
  // harmless — "→ 4" opening a line says "continued" — and keep a folded
  // sequence from looking like a matrix, which carries no numbers.
  const count = puzzle.stem.length;
  const phoneColumns = PHONE_SEQUENCE_COLUMNS[sequencePerLine(count, SEQUENCE_PHONE_MAX_PER_LINE)];
  const wideColumns = WIDE_SEQUENCE_COLUMNS[sequencePerLine(count, SEQUENCE_WIDE_MAX_PER_LINE)];
  return (
    <div
      className={`mx-auto grid w-max gap-x-1 gap-y-3 ${phoneColumns} ${wideColumns}`}
      aria-label="Sequence: pictures in numbered order, ending with the missing one"
    >
      {puzzle.stem.map((panel, i) => (
        <div key={i} className="grid grid-cols-[0.875rem_5rem] items-center gap-x-0.5 gap-y-0.5" data-sequence-step={i + 1}>
          <span className="col-start-2 text-center text-sm font-semibold text-gray-500" aria-hidden="true">{i + 1}</span>
          <FlowArrow className={`col-start-1 row-start-2 h-3.5 w-3.5 ${i === 0 ? "invisible" : ""}`} />
          <div className="col-start-2 row-start-2"><PanelBox panel={panel} /></div>
        </div>
      ))}
    </div>
  );
}
