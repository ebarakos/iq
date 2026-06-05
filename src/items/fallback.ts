import type { Cell, Panel, Puzzle } from "./schema";
import { PuzzleSetSchema, type PuzzleSet } from "./schema";

/**
 * Hand-authored fallback test (same schema as generated items).
 *
 * The MVP's primary path is relay generation. This set exists only so the app
 * stays runnable when the relay is unreachable or returns invalid data — the UI
 * clearly flags when it is shown. It is validated against the schema at module
 * load, so it can never drift out of spec.
 */

const c = (
  shape: Cell["shape"],
  count: Cell["count"],
  rotation: number,
  fill: Cell["fill"],
  size: Cell["size"] = "m",
): Cell => ({ shape, count, rotation, fill, size });

const BLANK: Panel = { blank: true };

const p1: Puzzle = {
  id: "p1",
  type: "matrix",
  instruction: "Which option completes the grid?",
  difficulty: 2,
  layout: "grid3x3",
  stem: [
    c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), c("circle", 3, 0, "solid"),
    c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), c("circle", 3, 0, "solid"),
    c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), BLANK,
  ],
  options: [c("circle", 3, 0, "solid"), c("circle", 1, 0, "solid"), c("circle", 2, 0, "solid"), c("circle", 4, 0, "solid")],
  answerIndex: 0,
  explanation: "Each row increases the number of circles from 1 to 3.",
};

const p2: Puzzle = {
  id: "p2",
  type: "sequence",
  instruction: "Which option comes next?",
  difficulty: 2,
  layout: "row",
  stem: [
    c("triangle", 1, 0, "outline"),
    c("triangle", 1, 45, "outline"),
    c("triangle", 1, 90, "outline"),
    c("triangle", 1, 135, "outline"),
    BLANK,
  ],
  options: [c("triangle", 1, 180, "outline"), c("triangle", 1, 135, "outline"), c("triangle", 1, 90, "outline"), c("triangle", 1, 225, "outline")],
  answerIndex: 0,
  explanation: "The triangle rotates 45° clockwise each step (next is 180°).",
};

const p3: Puzzle = {
  id: "p3",
  type: "analogy",
  instruction: "C is to ? as A is to B.",
  difficulty: 3,
  layout: "analogy",
  stem: [c("square", 1, 0, "outline"), c("square", 1, 0, "solid"), c("star", 1, 0, "outline")],
  options: [c("star", 1, 0, "solid"), c("star", 1, 0, "outline"), c("star", 1, 0, "half"), c("circle", 1, 0, "solid")],
  answerIndex: 0,
  explanation: "A→B fills the outline shape; apply the same to C (outline star → solid star).",
};

const p4: Puzzle = {
  id: "p4",
  type: "oddOneOut",
  instruction: "Which one does not belong?",
  difficulty: 3,
  layout: "row",
  stem: [],
  options: [c("circle", 1, 0, "solid"), c("square", 1, 0, "solid"), c("triangle", 1, 0, "solid"), c("star", 1, 0, "outline")],
  answerIndex: 3,
  explanation: "Three shapes are solid; the star is the only outline one.",
};

const p5: Puzzle = {
  id: "p5",
  type: "matrix",
  instruction: "Which option completes the grid?",
  difficulty: 5,
  layout: "grid3x3",
  stem: [
    c("square", 1, 0, "outline"), c("square", 2, 0, "outline"), c("square", 3, 0, "outline"),
    c("square", 1, 0, "half"), c("square", 2, 0, "half"), c("square", 3, 0, "half"),
    c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), BLANK,
  ],
  options: [c("square", 3, 0, "solid"), c("square", 3, 0, "half"), c("square", 2, 0, "solid"), c("square", 3, 0, "outline")],
  answerIndex: 0,
  explanation: "Columns add one square (1→3); rows go outline→half→solid, so the blank is 3 solid squares.",
};

export const FALLBACK_PUZZLES: PuzzleSet = PuzzleSetSchema.parse([p1, p2, p3, p4, p5]);
