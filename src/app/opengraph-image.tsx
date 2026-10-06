import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The link preview: a 3×3 board drawn like the app's puzzles (each row one shape,
 * each column one fill: solid, shaded, outline) with its last cell asked, beside
 * the site name. Rendered at build. The fonts are Latin subsets of Noto Sans
 * (`./fonts`), because `next/og` bundles only a regular weight.
 */
export const alt = "IQ visual reasoning gym: visual puzzles for humans and AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#111827"; // gray-900, the renderer's STROKE
const SHADE = "#9ca3af"; // gray-400, the renderer's HALF_FILL
const GRID = "#d1d5db"; // gray-300
const FILLS = [INK, SHADE, "#ffffff"];
/** The board's side in px; its viewBox is 300, one cell per 100. */
const BOARD = 398;

const centre = (index: number) => index * 100 + 50;
const triangle = (cx: number, cy: number) =>
  `${cx},${cy - 32} ${cx + 27.71},${cy + 16} ${cx - 27.71},${cy + 16}`;

function Board() {
  return (
    <svg width={BOARD} height={BOARD} viewBox="0 0 300 300">
      <rect x="1" y="1" width="298" height="298" fill="#ffffff" stroke={GRID} strokeWidth="2" />
      <path d="M100 1V299M200 1V299M1 100H299M1 200H299" stroke={GRID} strokeWidth="2" />
      {FILLS.map((fill, column) => (
        <circle key={`circle-${column}`} cx={centre(column)} cy="50" r="26" fill={fill} stroke={INK} strokeWidth="4" />
      ))}
      {FILLS.map((fill, column) => (
        <rect
          key={`square-${column}`}
          x={centre(column) - 26}
          y="124"
          width="52"
          height="52"
          fill={fill}
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      ))}
      {FILLS.slice(0, 2).map((fill, column) => (
        <polygon
          key={`triangle-${column}`}
          points={triangle(centre(column), 250)}
          fill={fill}
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export default async function OpengraphImage() {
  const [regular, extraBold] = await Promise.all([
    readFile(join(process.cwd(), "src/app/fonts/NotoSans-Regular-latin.ttf")),
    readFile(join(process.cwd(), "src/app/fonts/NotoSans-ExtraBold-latin.ttf")),
  ]);
  const cell = BOARD / 3;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 72,
          width: "100%",
          height: "100%",
          padding: 80,
          background: "#f9fafb",
          color: INK,
          fontFamily: "Noto Sans",
        }}
      >
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            width: 470,
            height: 470,
            background: "#ffffff",
            border: "2px solid #e5e7eb",
            borderRadius: 28,
          }}
        >
          <div style={{ display: "flex", position: "relative", width: BOARD, height: BOARD }}>
            <Board />
            <div
              style={{
                display: "flex",
                position: "absolute",
                left: 2 * cell,
                top: 2 * cell,
                width: cell,
                height: cell,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 64,
                color: SHADE,
              }}
            >
              ?
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>IQ</div>
            <div style={{ fontSize: 44, lineHeight: 1.15, color: "#6b7280" }}>visual reasoning gym</div>
          </div>
          {/* Narrow enough to break before "and", so no word sits alone on line two. */}
          <div style={{ maxWidth: 380, fontSize: 28, lineHeight: 1.4, color: "#4b5563" }}>
            Visual puzzles for humans and AI agents.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Noto Sans", data: regular, weight: 400, style: "normal" },
        { name: "Noto Sans", data: extraBold, weight: 800, style: "normal" },
      ],
    },
  );
}
