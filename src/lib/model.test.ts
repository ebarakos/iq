import { describe, expect, it } from "vitest";
import { parseJsonArray, validatePuzzleSet } from "./model";
import type { Cell, Puzzle } from "@/items/schema";

describe("parseJsonArray", () => {
  it("parses a bare JSON array", () => {
    expect(parseJsonArray('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("parses an array inside a ```json fence", () => {
    expect(parseJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it("parses an array inside a plain ``` fence", () => {
    expect(parseJsonArray('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it("parses an array preceded by prose", () => {
    expect(parseJsonArray('Here is the test you asked for:\n[{"id":"p1"}]')).toEqual([{ id: "p1" }]);
  });

  it("parses a fenced array surrounded by prose", () => {
    expect(parseJsonArray('Sure!\n```json\n[{"id":"p1"}]\n```\nLet me know.')).toEqual([{ id: "p1" }]);
  });

  it("handles brackets inside JSON strings", () => {
    expect(parseJsonArray('[{"s":"a]b[c"}]')).toEqual([{ s: "a]b[c" }]);
  });

  it("returns null instead of a garbage slice when prose brackets surround no valid array", () => {
    expect(parseJsonArray("The answer is a[1] or b[2], pick one.")).toBeNull();
  });

  it("extracts the inner array when the model wraps it in an object", () => {
    expect(parseJsonArray('{"puzzles": [{"id":"p1"}]}')).toEqual([{ id: "p1" }]);
  });

  it("returns null for empty or array-free input", () => {
    expect(parseJsonArray("")).toBeNull();
    expect(parseJsonArray("no json here")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixtures — built inline, no import from fallback.ts.
// Reuse the same cell helper + puzzle wrapper style as rules.test.ts.
// ---------------------------------------------------------------------------

const c = (
  shape: Cell["shape"],
  count: Cell["count"],
  rotation: number,
  fill: Cell["fill"],
  size: Cell["size"] = "m",
): Cell => ({ shape, count, rotation, fill, size });

const BLANK = { blank: true as const };

/** Minimal Puzzle wrapper so fixtures stay readable. */
function puzzle(p: Partial<Puzzle> & Pick<Puzzle, "type" | "layout" | "stem" | "options" | "answerIndex" | "rule">): Puzzle {
  return {
    id: "t",
    instruction: "Pick the option that fits.",
    difficulty: 2,
    explanation: "Test fixture.",
    ...p,
  };
}

// 1. count-step sequence — count goes 1, 2, 3, answer = 4
const p1 = puzzle({
  id: "p1",
  type: "sequence",
  layout: "row",
  stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
  options: [c("square", 4, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "half")],
  answerIndex: 0,
  rule: { kind: "sequence", transforms: { count: { op: "step", delta: 1, wrap: false } } },
});

// 2. fill-step analogy — outline→solid applied to triangle: outline→solid
const p2 = puzzle({
  id: "p2",
  type: "analogy",
  layout: "analogy",
  stem: [c("square", 1, 0, "outline"), c("square", 1, 0, "solid"), c("triangle", 1, 0, "outline", "l")],
  options: [c("triangle", 1, 0, "solid", "l"), c("triangle", 1, 0, "half", "l"), c("square", 1, 0, "solid"), c("triangle", 2, 0, "solid", "l")],
  answerIndex: 0,
  rule: { kind: "analogy", transforms: { fill: { op: "step", delta: 2, wrap: false } } },
});

// 3. shape-cycle sequence — circle → square → triangle → answer = circle
const p3 = puzzle({
  id: "p3",
  type: "sequence",
  layout: "row",
  stem: [c("circle", 1, 0, "solid"), c("square", 1, 0, "solid"), c("triangle", 1, 0, "solid"), BLANK],
  options: [c("circle", 1, 0, "solid"), c("square", 1, 0, "outline"), c("star", 1, 0, "solid"), c("hexagon", 1, 0, "solid")],
  answerIndex: 0,
  rule: { kind: "sequence", transforms: { shape: { op: "cycle", values: ["circle", "square", "triangle"] } } },
});

// 4. oddOneOut — all options are squares except option 2 (circle)
const p4 = puzzle({
  id: "p4",
  type: "oddOneOut",
  layout: "row",
  stem: [],
  options: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("circle", 2, 0, "solid"), c("square", 3, 0, "solid")],
  answerIndex: 2,
  rule: { kind: "oddOneOut", dimension: "shape", value: "square" },
});

// 5. count-step matrix — count steps +1 along rows; fill steps +1 along columns
//    row 1: count 1,2,3 / fill outline
//    row 2: count 1,2,3 / fill half
//    row 3: count 1,2,? / fill solid  → answer: count=3, fill=solid
const p5 = puzzle({
  id: "p5",
  type: "matrix",
  layout: "grid3x3",
  stem: [
    c("square", 1, 0, "outline"), c("square", 2, 0, "outline"), c("square", 3, 0, "outline"),
    c("square", 1, 0, "half"),    c("square", 2, 0, "half"),    c("square", 3, 0, "half"),
    c("square", 1, 0, "solid"),   c("square", 2, 0, "solid"),   BLANK,
  ],
  options: [c("square", 3, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "half")],
  answerIndex: 0,
  rule: { kind: "matrix", row: { count: { op: "step", delta: 1, wrap: false } }, col: { fill: { op: "step", delta: 1, wrap: false } } },
});

const VALID_SET = [p1, p2, p3, p4, p5];

// ---------------------------------------------------------------------------

describe("validatePuzzleSet", () => {
  it("returns ok:true for a valid 5-puzzle set with correct rules", () => {
    const result = validatePuzzleSet(VALID_SET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.puzzles).toHaveLength(5);
      expect(result.puzzles.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    }
  });

  it("returns ok:false with feedback mentioning the puzzle id and 'answerIndex' when answerIndex is wrong", () => {
    // p1 correct answer is at index 0 (count=4); mis-mark it as index 1
    const broken = VALID_SET.map((p) => (p.id === "p1" ? { ...p, answerIndex: 1 } : p));
    const result = validatePuzzleSet(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.feedback).toMatch(/p1/);
      expect(result.feedback).toMatch(/answerIndex/);
    }
  });

  it("returns ok:false with feedback mentioning 'rule' when a puzzle's rule is removed", () => {
    // Remove the rule from p3
    const broken = VALID_SET.map((p) =>
      p.id === "p3" ? { ...p, rule: undefined } : p,
    );
    const result = validatePuzzleSet(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.feedback).toMatch(/p3/);
      expect(result.feedback).toMatch(/rule/);
    }
  });

  it("returns ok:false with Zod-style feedback for a schema-invalid payload (4 items)", () => {
    // Only 4 puzzles — PuzzleSetSchema requires exactly 5
    const result = validatePuzzleSet(VALID_SET.slice(0, 4));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Zod reports this as a root-level or length issue
      expect(result.feedback.length).toBeGreaterThan(0);
    }
  });
});
