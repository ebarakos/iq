import { describe, expect, it } from "vitest";
import { applyTransform, checkRule, deriveAnswer, RuleSchema, type DimTransform, type Rule } from "./rules";
import { PuzzleSchema, type Cell, type Panel, type Puzzle } from "./schema";

const c = (
  shape: Cell["shape"],
  count: Cell["count"],
  rotation: number,
  fill: Cell["fill"],
  size: Cell["size"] = "m",
): Cell => ({ shape, count, rotation, fill, size });

const BLANK: Panel = { blank: true };

const step = (delta: number, wrap = false) => ({ op: "step", delta, wrap }) as const;

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

describe("applyTransform", () => {
  it("steps within ordered domains and null at the edge without wrap", () => {
    expect(applyTransform("count", step(1), 3)).toBe(4);
    expect(applyTransform("count", step(1), 4)).toBeNull();
    expect(applyTransform("count", step(1, true), 4)).toBe(1);
    expect(applyTransform("fill", step(2), "outline")).toBe("solid");
    expect(applyTransform("size", step(-1), "s")).toBeNull();
  });

  it("always wraps rotation regardless of the wrap flag (quarter-turn domain)", () => {
    expect(applyTransform("rotation", step(1), 270)).toBe(0);
    expect(applyTransform("rotation", step(-1), 0)).toBe(270);
  });

  it("applies inverse steps (negative step count)", () => {
    expect(applyTransform("count", step(1), 3, -1)).toBe(2);
    expect(applyTransform("count", step(1), 3, -3)).toBeNull();
  });

  it("cycles to the successor and null when the value is outside the cycle", () => {
    const t: DimTransform = { op: "cycle", values: ["circle", "square", "triangle"] };
    expect(applyTransform("shape", t, "triangle")).toBe("circle");
    expect(applyTransform("shape", t, "square", -1)).toBe("circle");
    expect(applyTransform("shape", t, "star")).toBeNull();
  });
});

describe("RuleSchema", () => {
  it("rejects a step on shape (nominal)", () => {
    expect(RuleSchema.safeParse({ kind: "sequence", transforms: { shape: step(1) } }).success).toBe(false);
  });

  it("rejects delta 0, duplicate cycle values, and out-of-domain cycle values", () => {
    expect(RuleSchema.safeParse({ kind: "sequence", transforms: { count: step(0) } }).success).toBe(false);
    expect(RuleSchema.safeParse({ kind: "sequence", transforms: { fill: { op: "cycle", values: ["solid", "solid"] } } }).success).toBe(false);
    expect(RuleSchema.safeParse({ kind: "sequence", transforms: { fill: { op: "cycle", values: ["solid", "striped"] } } }).success).toBe(false);
  });

  it("rejects all-constant rules and matrix rules governing one dim on both axes", () => {
    expect(RuleSchema.safeParse({ kind: "sequence", transforms: {} }).success).toBe(false);
    expect(RuleSchema.safeParse({ kind: "matrix", row: { count: step(1) }, col: { count: step(1) } }).success).toBe(false);
    expect(RuleSchema.safeParse({ kind: "matrix", row: { count: step(1) }, col: {} }).success).toBe(true);
  });

  it("rejects shape-changing analogies and out-of-domain oddOneOut values", () => {
    expect(RuleSchema.safeParse({ kind: "analogy", transforms: { shape: { op: "cycle", values: ["circle", "square"] } } }).success).toBe(false);
    expect(RuleSchema.safeParse({ kind: "oddOneOut", dimension: "fill", value: "striped" }).success).toBe(false);
    expect(RuleSchema.safeParse({ kind: "oddOneOut", dimension: "shape", value: "square" }).success).toBe(true);
  });
});

describe("PuzzleSchema rule field", () => {
  it("rejects a rule whose kind does not match the puzzle type", () => {
    const p = puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
      options: [c("square", 4, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "outline")],
      answerIndex: 0,
      rule: { kind: "oddOneOut", dimension: "shape", value: "square" },
    });
    expect(PuzzleSchema.safeParse(p).success).toBe(false);
    expect(PuzzleSchema.safeParse({ ...p, rule: { kind: "sequence", transforms: { count: step(1) } } }).success).toBe(true);
  });
});

describe("checkRule — sequence", () => {
  const seq = puzzle({
    type: "sequence",
    layout: "row",
    stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
    options: [c("square", 4, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "half")],
    answerIndex: 0,
    rule: { kind: "sequence", transforms: { count: step(1) } },
  });

  it("accepts a coherent sequence and derives the answer", () => {
    const res = checkRule(seq);
    expect(res).toEqual({ ok: true, derived: c("square", 4, 0, "solid") });
  });

  it("rejects a mis-marked answer with a derivation diff", () => {
    const res = checkRule({ ...seq, answerIndex: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/derives .*count 4.*answerIndex/s);
  });

  it("rejects a stem the rule does not explain", () => {
    const broken = { ...seq, stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 4, 0, "solid"), BLANK] };
    const res = checkRule(broken);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/predicts 3/);
  });

  it("rejects an ungoverned dimension that varies", () => {
    const drift = { ...seq, stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "solid"), BLANK] };
    const res = checkRule(drift);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/fill.*must stay constant/);
  });

  it("rejects a non-wrapping step that leaves the domain at the answer", () => {
    const edge = {
      ...seq,
      stem: [c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), c("square", 4, 0, "solid"), BLANK],
    };
    const res = checkRule(edge);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/one more step/);
  });

  it("derives across a wrap when the rule wraps", () => {
    const wrap = {
      ...seq,
      stem: [c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), c("square", 4, 0, "solid"), BLANK],
      options: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 4, 0, "outline"), c("square", 3, 0, "half")],
      rule: { kind: "sequence", transforms: { count: step(1, true) } } as Rule,
    };
    expect(checkRule(wrap)).toEqual({ ok: true, derived: c("square", 1, 0, "solid") });
  });

  it("rejects rotation rules on non-orientable shapes (triangles only)", () => {
    // Stars are too symmetric for orientation to read; the rule is illegible
    // even though the cells themselves are schema-legal (rotation 0).
    const onStars = puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("star", 1, 0, "solid"), c("star", 2, 0, "solid"), c("star", 3, 0, "solid"), BLANK],
      options: [c("star", 4, 0, "solid"), c("star", 1, 0, "outline"), c("star", 2, 0, "half"), c("circle", 1, 0, "solid")],
      answerIndex: 0,
      rule: { kind: "sequence", transforms: { rotation: step(1) } },
    });
    const res = checkRule(onStars);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/only legible on triangles|rotation/);
  });

  it("accepts quarter-turn rotation on triangles and shape cycles", () => {
    const rotating = puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("triangle", 1, 0, "solid"), c("triangle", 1, 90, "solid"), c("triangle", 1, 180, "solid"), BLANK],
      options: [c("triangle", 1, 270, "solid"), c("triangle", 1, 0, "outline"), c("triangle", 2, 0, "solid"), c("circle", 1, 0, "solid")],
      answerIndex: 0,
      rule: { kind: "sequence", transforms: { rotation: step(1) } },
    });
    expect(checkRule(rotating).ok).toBe(true);

    const shapes = puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("circle", 1, 0, "solid"), c("square", 1, 0, "solid"), c("triangle", 1, 0, "solid"), BLANK],
      options: [c("circle", 1, 0, "solid"), c("square", 1, 0, "outline"), c("star", 1, 0, "solid"), c("hexagon", 1, 0, "solid")],
      answerIndex: 0,
      rule: { kind: "sequence", transforms: { shape: { op: "cycle", values: ["circle", "square", "triangle"] } } },
    });
    expect(checkRule(shapes)).toEqual({ ok: true, derived: c("circle", 1, 0, "solid") });
  });
});

describe("checkRule — analogy", () => {
  const ana = puzzle({
    type: "analogy",
    layout: "analogy",
    // A: outline square → B: solid square; C: outline triangle (larger — C is free on ungoverned dims)
    stem: [c("square", 1, 0, "outline"), c("square", 1, 0, "solid"), c("triangle", 1, 0, "outline", "l")],
    options: [c("triangle", 1, 0, "solid", "l"), c("triangle", 1, 0, "half", "l"), c("square", 1, 0, "solid"), c("triangle", 2, 0, "solid", "l")],
    answerIndex: 0,
    rule: { kind: "analogy", transforms: { fill: step(2) } },
  });

  it("applies the A→B transform to C, copying C's ungoverned dims", () => {
    expect(checkRule(ana)).toEqual({ ok: true, derived: c("triangle", 1, 0, "solid", "l") });
  });

  it("rejects when A→B does not match the declared transform", () => {
    const res = checkRule({ ...ana, stem: [c("square", 1, 0, "outline"), c("square", 1, 0, "half"), c("triangle", 1, 0, "outline", "l")] });
    expect(res.ok).toBe(false);
  });
});

describe("checkRule — matrix", () => {
  // count steps +1 along rows (each row restarts at 1); fill steps down columns.
  const stem9 = [
    c("square", 1, 0, "outline"), c("square", 2, 0, "outline"), c("square", 3, 0, "outline"),
    c("square", 1, 0, "half"), c("square", 2, 0, "half"), c("square", 3, 0, "half"),
    c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), BLANK,
  ];
  const mat = puzzle({
    type: "matrix",
    layout: "grid3x3",
    stem: stem9,
    options: [c("square", 3, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "half")],
    answerIndex: 0,
    rule: { kind: "matrix", row: { count: step(1) }, col: { fill: step(1) } },
  });

  it("derives the blank from both axes", () => {
    expect(checkRule(mat)).toEqual({ ok: true, derived: c("square", 3, 0, "solid") });
  });

  it("derives a mid-grid blank via inverse steps", () => {
    const stem = [...stem9];
    stem[8] = c("square", 3, 0, "solid");
    stem[4] = BLANK; // blank in the centre
    const centre = { ...mat, stem, options: [c("square", 2, 0, "half"), c("square", 1, 0, "half"), c("square", 2, 0, "solid"), c("square", 3, 0, "outline")] };
    expect(checkRule(centre)).toEqual({ ok: true, derived: c("square", 2, 0, "half") });
  });

  it("rejects a grid cell that breaks its row rule", () => {
    const stem = [...stem9];
    stem[1] = c("square", 3, 0, "outline"); // row 1 goes 1, 3, 3
    const res = checkRule({ ...mat, stem });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/row 1/);
  });

  it("rejects an ungoverned dim varying anywhere in the grid", () => {
    const stem = [...stem9];
    stem[3] = c("square", 1, 45, "half"); // rotation drifts
    expect(checkRule({ ...mat, stem }).ok).toBe(false);
  });
});

describe("checkRule — oddOneOut", () => {
  const odd = puzzle({
    type: "oddOneOut",
    layout: "row",
    stem: [],
    options: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("circle", 2, 0, "solid"), c("square", 3, 0, "solid")],
    answerIndex: 2,
    rule: { kind: "oddOneOut", dimension: "shape", value: "square" },
  });

  it("accepts exactly one breaker at answerIndex", () => {
    expect(checkRule(odd)).toEqual({ ok: true, derived: null });
  });

  it("rejects multiple breakers and a mis-marked breaker", () => {
    const two = { ...odd, options: [c("square", 1, 0, "solid"), c("star", 2, 0, "solid"), c("circle", 2, 0, "solid"), c("square", 3, 0, "solid")] };
    expect(checkRule(two).ok).toBe(false);

    const wrong = { ...odd, answerIndex: 0 };
    const res = checkRule(wrong);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.join("\n")).toMatch(/fix answerIndex/);
  });
});

describe("checkRule — missing or mismatched rule", () => {
  it("fails on a missing rule with an instructive message", () => {
    const res = checkRule(puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
      options: [c("square", 4, 0, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "half")],
      answerIndex: 0,
      rule: undefined,
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]).toMatch(/missing "rule"/);
  });
});

describe("deriveAnswer", () => {
  it("is exposed for the procedural generator (size flips small ↔ large)", () => {
    const { cell, issues } = deriveAnswer(
      { kind: "sequence", transforms: { size: step(1, true) } },
      [c("hexagon", 1, 0, "solid", "s"), c("hexagon", 1, 0, "solid", "l"), c("hexagon", 1, 0, "solid", "s"), BLANK],
    );
    expect(issues).toEqual([]);
    expect(cell).toEqual(c("hexagon", 1, 0, "solid", "l"));
  });
});

describe("legibility doctrine", () => {
  it("rejects rules whose steps are not instantly visible (size via 'm')", () => {
    // s→m→l stem: each step is real but subtle; 'm' is not in the DSL size
    // domain, so the rule cannot even express it — and the schema separately
    // bans option pairs that differ only by an adjacent-size squint.
    const res = RuleSchema.safeParse({ kind: "sequence", transforms: { size: { op: "cycle", values: ["s", "m", "l"] } } });
    expect(res.success).toBe(false);
  });

  it("schema rejects rotated symmetric shapes at the cell level", () => {
    const p = puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
      options: [c("square", 4, 90, "solid"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline"), c("square", 3, 0, "half")],
      answerIndex: 0,
      rule: { kind: "sequence", transforms: { count: step(1) } },
    });
    expect(PuzzleSchema.safeParse(p).success).toBe(false);
  });

  it("schema rejects option pairs that are not instantly distinguishable", () => {
    const p = puzzle({
      type: "sequence",
      layout: "row",
      stem: [c("square", 1, 0, "solid"), c("square", 2, 0, "solid"), c("square", 3, 0, "solid"), BLANK],
      // options 0 and 1 differ only by size m vs l — a squint test.
      options: [c("square", 4, 0, "solid", "m"), c("square", 4, 0, "solid", "l"), c("square", 1, 0, "solid"), c("square", 2, 0, "outline")],
      answerIndex: 0,
      rule: { kind: "sequence", transforms: { count: step(1) } },
    });
    const res = PuzzleSchema.safeParse(p);
    expect(res.success).toBe(false);
    if (!res.success) expect(JSON.stringify(res.error.issues)).toMatch(/instantly distinguishable/);
  });
});
