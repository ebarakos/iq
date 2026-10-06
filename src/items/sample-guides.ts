import type { Layout } from "./schema";

/**
 * How to read each kind of question, shown above the diagram on the
 * 5-question sample only, in the page and the link test alike. Chosen by
 * layout, which the picture already shows, so a note names what to compare and
 * never what the change is. The sample is
 * practice; the 30-question test stays without instructions while solving
 * (docs/plans/unambiguous-reading.md).
 */
export const SAMPLE_GUIDES: Partial<Record<Layout, string>> = {
  row:
    "Read the pictures in number order. Follow each shape on its own from one picture to the " +
    "next: where it sits and what fill it has. The missing picture is the next step of the same pattern.",
  analogy:
    "The top row shows a change: the left board becomes the right board. Compare the two square by " +
    "square, looking at positions, fills, shapes and which way arrows point. Then make exactly the same " +
    "change to the board in the bottom row.",
  grid3x3:
    "The first two boards of a line make the third. When arrows are shown, only the rows work that " +
    "way; with no arrows, look across the rows and down the columns. Compare the boards square by " +
    "square: which squares hold a shape, and which shape.",
  machineTable:
    "Each jigsaw piece is a machine that changes a board. The rows above show each piece on its own. " +
    "The last row snaps several pieces together; the board goes through them one after another, the " +
    "way their tabs point. Watch positions, fills, shapes and which way arrows point.",
};
