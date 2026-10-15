import type { GridFlow, Layout, Puzzle } from "./schema";
import { isBlank } from "./schema";
import { gatePieces } from "./render";

/**
 * A question as the in-page test serves it before scoring: its layout and the
 * paths of its pictures, and nothing else — no scenes, no instruction, no id
 * (docs/plans/leaderboard-integrity.md). A program has to look at the pictures
 * to solve it, as people and vision agents do. Scene data arrives only with
 * the review, after the first result is saved.
 */
export type PicturePanel =
  | { blank: true }
  | { board: string }
  /** A machine gate: its piece count, its strip lying right, and stacked down for a phone. */
  | { gate: { pieces: number; right: string; down?: string } };

export interface PicturePuzzle {
  layout: Layout;
  gridFlow?: GridFlow;
  stem: PicturePanel[];
  options: string[];
}

/** The picture names `toPicturePuzzle` hands out, which the picture route draws. */
export type PicturePart =
  | { kind: "stem"; index: number }
  | { kind: "option"; index: number }
  | { kind: "gate"; index: number; direction: "right" | "down" };

export function parsePicturePart(name: string): PicturePart | null {
  const match = /^(?:([so])(\d{1,2})|g(\d{1,2})-(right|down))\.png$/.exec(name);
  if (!match) return null;
  if (match[1]) return { kind: match[1] === "s" ? "stem" : "option", index: Number(match[2]) };
  return { kind: "gate", index: Number(match[3]), direction: match[4] as "right" | "down" };
}

/** Whether stem panel `index` of a puzzle is drawn as a machine gate. */
export function isGatePanel(puzzle: Puzzle, index: number): boolean {
  const panel = puzzle.stem[index];
  return puzzle.layout === "machineTable" && index % 3 === 1 && !!panel && gatePieces(panel) !== null;
}

/** `path(part)` names one picture of this question, e.g. `s3` or `g1-down`. */
export function toPicturePuzzle(puzzle: Puzzle, path: (part: string) => string): PicturePuzzle {
  const stem = puzzle.stem.map((panel, index): PicturePanel => {
    if (isBlank(panel)) return { blank: true };
    if (isGatePanel(puzzle, index)) {
      const pieces = gatePieces(panel)!.length;
      return {
        gate: {
          pieces,
          right: path(`g${index}-right`),
          ...(pieces > 1 ? { down: path(`g${index}-down`) } : {}),
        },
      };
    }
    return { board: path(`s${index}`) };
  });
  return {
    layout: puzzle.layout,
    ...(puzzle.gridFlow ? { gridFlow: puzzle.gridFlow } : {}),
    stem,
    options: puzzle.options.map((_, index) => path(`o${index}`)),
  };
}

/** Every picture path of a question, for fetching the next question ahead of time. */
export function picturePaths(puzzle: PicturePuzzle): string[] {
  const stem = puzzle.stem.flatMap((panel) =>
    "board" in panel ? [panel.board] : "gate" in panel ? [panel.gate.right, ...(panel.gate.down ? [panel.gate.down] : [])] : []);
  return [...stem, ...puzzle.options];
}

/**
 * The same question with every picture path marked as retry `attempt`, so a
 * browser asks again for pictures that failed. The route ignores the mark.
 */
export function withPictureAttempt(puzzle: PicturePuzzle, attempt: number): PicturePuzzle {
  if (attempt === 0) return puzzle;
  const mark = (path: string) => `${path}?attempt=${attempt}`;
  return {
    ...puzzle,
    stem: puzzle.stem.map((panel): PicturePanel =>
      "board" in panel ? { board: mark(panel.board) }
        : "gate" in panel ? { gate: { ...panel.gate, right: mark(panel.gate.right), ...(panel.gate.down ? { down: mark(panel.gate.down) } : {}) } }
          : panel),
    options: puzzle.options.map(mark),
  };
}
