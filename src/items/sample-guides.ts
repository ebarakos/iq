import type { GridFlow, Layout } from "./schema";

/**
 * How to read each kind of question, shown above the diagram on the
 * 5-question sample only, in the page and the link test alike. Chosen by
 * what the picture already shows (its layout, and for a grid whether it draws
 * arrows), so a note names what to compare and never what the change is. The
 * sample is practice; the 30-question test stays without instructions while
 * solving (docs/plans/unambiguous-reading.md).
 */
const LAYOUT_GUIDES: Partial<Record<Layout, string>> = {
  assembly:
    "Fit the loose pieces into the square frame, keeping the piece already placed where it is. " +
    "You may turn a piece, but you may not reflect it. Keep each piece whole, with no gaps or overlaps.",
  row:
    "Read the pictures in number order. Follow each shape on its own from one picture to the " +
    "next: where it sits and what fill it has. The missing picture is the next step of the same pattern.",
  analogy:
    "The top row shows a change: the left board becomes the right board. Compare the two square by " +
    "square, looking at positions, fills, shapes and which way arrows point. Then make exactly the same " +
    "change to the board in the bottom row.",
  machineTable:
    "Each jigsaw piece is a machine that changes a board. The rows above show each piece on its own. " +
    "The last row snaps several pieces together; the board goes through them one after another, the " +
    "way their tabs point. Watch positions, fills, shapes and which way arrows point.",
};

/** A grid draws arrows only when its rule runs across the rows alone (render.tsx). */
const GRID_GUIDES: Record<GridFlow, string> = {
  rows:
    "In each row, the first two boards make the board after the arrow. Compare the boards square by " +
    "square: which squares hold a shape, and which shape. The bottom row is made the same way.",
  rowsAndColumns:
    "The missing picture must fit both its row and its column. Compare the pictures across each row " +
    "and down each column.",
};

/** A machine table with one worked row: its question row runs that one piece. */
const ONE_PIECE_MACHINE_GUIDE =
  "The jigsaw piece is a machine that changes a board. The top row shows what it does. The bottom " +
  "row puts a new board through the same piece. Watch positions, fills, shapes and which way arrows point.";

export function sampleGuide(puzzle: { layout: Layout; gridFlow?: GridFlow; stem: readonly unknown[] }): string | undefined {
  if (puzzle.layout === "grid3x3") return GRID_GUIDES[puzzle.gridFlow ?? "rowsAndColumns"];
  // One worked row plus the question row: six panels.
  if (puzzle.layout === "machineTable" && puzzle.stem.length === 6) return ONE_PIECE_MACHINE_GUIDE;
  return LAYOUT_GUIDES[puzzle.layout];
}
