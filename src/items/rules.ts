import { z } from "zod";
import {
  isInstantlyDistinct,
  ORIENTABLE_SHAPES,
  ROTATIONS,
  SHAPES,
  visualSignature,
} from "./domains";
import type { Cell, Panel, Puzzle } from "./schema";

/**
 * Rule DSL — the machine-readable pattern behind a puzzle.
 *
 * A rule describes how cell dimensions change across the stem, in a form pure
 * code can re-apply. `checkRule` re-derives the correct answer from the rule and
 * verifies the whole puzzle against it; this is the semantic validator that
 * closes the "model mis-marks the answer" reliability gap. The same DSL drives
 * the procedural generator (generate.ts), whose items are correct by
 * construction. Design: docs/plans/rules-bank-agent-calibration.md (Phase A).
 *
 * Not expressible in v1 (escape hatch — items simply omit `rule` and are
 * excluded from the calibrated bank): multiplicative count rules, shape-changing
 * analogies, Latin-square matrices, XOR/set-operation rules.
 */

export const DIMENSIONS = ["shape", "count", "rotation", "fill", "size"] as const;
export type Dim = (typeof DIMENSIONS)[number];

/**
 * Ordered value domains. Transforms operate on the INDEX into these arrays.
 * Note `fill` is deliberately ordinal here (outline < half < solid), unlike the
 * unordered FILLS constant; `rotation` is inherently cyclic (index step of 1 =
 * a quarter turn, triangles only). Legibility doctrine: `size` is two-valued
 * (small/large) — the schema still renders legacy "m", but no rule may trade
 * on a small-vs-medium judgement.
 */
export const DIM_DOMAINS: Record<Dim, readonly (string | number)[]> = {
  shape: SHAPES, // nominal — only constant/cycle allowed
  count: [1, 2, 3, 4],
  rotation: ROTATIONS,
  fill: ["outline", "half", "solid"],
  size: ["s", "l"],
};

/** How one dimension changes per step along one axis. */
export const DimTransformSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("constant") }),
  // Index-step in the dimension's ordered domain. wrap=true → modular (4→1,
  // l→s, solid→outline). rotation always wraps regardless of the flag.
  z.object({ op: z.literal("step"), delta: z.number().int().min(-3).max(3), wrap: z.boolean() }),
  // Explicit value cycle: the next value is the cycle-successor of the current
  // one. The only non-constant op available for `shape`.
  z.object({ op: z.literal("cycle"), values: z.array(z.union([z.string(), z.number()])).min(2).max(6) }),
]);
export type DimTransform = z.infer<typeof DimTransformSchema>;

/**
 * Per-dimension transforms; unlisted dims are implicitly constant and the
 * validator CHECKS they are constant in the stem. An explicit { op: "constant" }
 * entry means the same as omitting the dim.
 */
export const DimTransformsSchema = z
  .object({
    shape: DimTransformSchema.optional(),
    count: DimTransformSchema.optional(),
    rotation: DimTransformSchema.optional(),
    fill: DimTransformSchema.optional(),
    size: DimTransformSchema.optional(),
  })
  .strict();
export type DimTransforms = z.infer<typeof DimTransformsSchema>;

const CONSTANT: DimTransform = { op: "constant" };

function isNonConstant(t: DimTransform | undefined): t is Exclude<DimTransform, { op: "constant" }> {
  return t !== undefined && t.op !== "constant";
}

function nonConstantDims(transforms: DimTransforms): Dim[] {
  return DIMENSIONS.filter((d) => isNonConstant(transforms[d]));
}

/** Validate one transforms map's values against its dimensions' domains. */
function refineTransforms(transforms: DimTransforms, ctx: z.RefinementCtx, path: (string | number)[]): void {
  for (const dim of DIMENSIONS) {
    const t = transforms[dim];
    if (!t || t.op === "constant") continue;
    if (dim === "shape" && t.op === "step") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, dim], message: "shape is nominal — use a cycle of shape names, not a step" });
    }
    if (t.op === "step" && t.delta === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, dim], message: "a step with delta 0 is constant — omit the dimension instead" });
    }
    if (t.op === "cycle") {
      const domain = DIM_DOMAINS[dim];
      const bad = t.values.filter((v) => !domain.includes(v));
      if (bad.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, dim], message: `cycle values [${bad.join(", ")}] are not valid for ${dim} (allowed: ${domain.join(", ")})` });
      }
      if (new Set(t.values).size !== t.values.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, dim], message: "cycle values must be distinct" });
      }
    }
  }
}

export const RuleSchema = z
  .discriminatedUnion("kind", [
    // 1-D: each consecutive stem cell pair must satisfy every transform;
    // answer = one more step from the last drawn cell.
    z.object({ kind: z.literal("sequence"), transforms: DimTransformsSchema }),
    // 2-D: row = transforms applied left→right within EVERY row (each row
    // anchors on its own first cell); col = top→bottom within every column.
    // A dim may be governed by at most ONE axis; dims in neither are globally
    // constant across the grid.
    z.object({ kind: z.literal("matrix"), row: DimTransformsSchema, col: DimTransformsSchema }),
    // A→B single-step transform, re-applied to C to derive the answer.
    // v1 restriction: shape must be constant.
    z.object({ kind: z.literal("analogy"), transforms: DimTransformsSchema }),
    // All non-answer options share `value` on `dimension`; the answer breaks it.
    z.object({ kind: z.literal("oddOneOut"), dimension: z.enum(DIMENSIONS), value: z.union([z.string(), z.number()]) }),
  ])
  .superRefine((rule, ctx) => {
    if (rule.kind === "oddOneOut") {
      if (!DIM_DOMAINS[rule.dimension].includes(rule.value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${JSON.stringify(rule.value)} is not a valid ${rule.dimension} (allowed: ${DIM_DOMAINS[rule.dimension].join(", ")})` });
      }
      return;
    }
    if (rule.kind === "matrix") {
      refineTransforms(rule.row, ctx, ["row"]);
      refineTransforms(rule.col, ctx, ["col"]);
      const overlap = nonConstantDims(rule.row).filter((d) => isNonConstant(rule.col[d]));
      if (overlap.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `dimension(s) ${overlap.join(", ")} are governed by both row and col — a dimension may vary along at most one axis` });
      }
      if (nonConstantDims(rule.row).length + nonConstantDims(rule.col).length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a matrix rule needs at least one non-constant transform on row or col" });
      }
      return;
    }
    refineTransforms(rule.transforms, ctx, ["transforms"]);
    if (nonConstantDims(rule.transforms).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["transforms"], message: `a ${rule.kind} rule needs at least one non-constant transform` });
    }
    if (rule.kind === "analogy" && isNonConstant(rule.transforms.shape)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["transforms", "shape"], message: "shape-changing analogies are not supported — keep shape constant" });
    }
  });
export type Rule = z.infer<typeof RuleSchema>;

/**
 * Apply a transform `steps` times (negative = inverse, used to derive a matrix
 * blank from a cell on its other side). Returns null when inapplicable: value
 * outside the domain/cycle, or a non-wrapping step leaving the domain.
 */
export function applyTransform(dim: Dim, t: DimTransform, value: string | number, steps = 1): string | number | null {
  if (t.op === "constant" || steps === 0) return value;
  if (t.op === "cycle") {
    const i = t.values.indexOf(value);
    if (i === -1) return null;
    const n = t.values.length;
    return t.values[(((i + steps) % n) + n) % n];
  }
  const domain = DIM_DOMAINS[dim];
  const i = domain.indexOf(value);
  if (i === -1) return null;
  const raw = i + t.delta * steps;
  if (dim === "rotation" || t.wrap) {
    const n = domain.length;
    return domain[((raw % n) + n) % n];
  }
  return raw >= 0 && raw < domain.length ? domain[raw] : null;
}

/** Apply a transforms map to a whole cell (unlisted dims copied). Null if any dim is inapplicable. */
export function applyTransforms(transforms: DimTransforms, cell: Cell, steps = 1): Cell | null {
  const next: Record<string, string | number> = {};
  for (const dim of DIMENSIONS) {
    const v = applyTransform(dim, transforms[dim] ?? CONSTANT, cell[dim], steps);
    if (v === null) return null;
    next[dim] = v;
  }
  return next as unknown as Cell;
}

const isBlankPanel = (p: Panel): p is { blank: true } => "blank" in p;

const showCell = (c: Cell) => `{${c.shape}, count ${c.count}, rot ${c.rotation}, ${c.fill}, ${c.size}}`;
const showTransform = (dim: Dim, t: DimTransform) =>
  t.op === "step" ? `${dim} step ${t.delta > 0 ? "+" : ""}${t.delta}${t.wrap ? " (wrap)" : ""}` : t.op === "cycle" ? `${dim} cycle [${t.values.join(" → ")}]` : `${dim} constant`;

interface Derivation {
  cell: Cell | null; // null when issues prevent derivation (or kind = oddOneOut)
  issues: string[];
}

/**
 * Check pairwise transform consistency along a run of cells. Unlisted dims must
 * stay constant, except dims in `skip` (matrix dims governed by the other axis,
 * which vary freely along this one because every line anchors its own first cell).
 */
function checkRun(cells: Cell[], transforms: DimTransforms, label: string, skip: readonly Dim[] = []): string[] {
  const issues: string[] = [];
  for (const dim of DIMENSIONS) {
    if (skip.includes(dim)) continue;
    const t = transforms[dim] ?? CONSTANT;
    for (let i = 0; i < cells.length - 1; i++) {
      const expected = applyTransform(dim, t, cells[i][dim]);
      if (expected === null) {
        issues.push(`${label}: ${showTransform(dim, t)} cannot apply to ${dim} ${JSON.stringify(cells[i][dim])} (out of domain/cycle, or step leaves the domain — use wrap or a smaller delta)`);
      } else if (expected !== cells[i + 1][dim]) {
        issues.push(
          t.op === "constant"
            ? `${label}: ${dim} is not governed by the rule so it must stay constant, but it changes ${JSON.stringify(cells[i][dim])} → ${JSON.stringify(cells[i + 1][dim])}`
            : `${label}: ${showTransform(dim, t)} predicts ${JSON.stringify(expected)} after ${JSON.stringify(cells[i][dim])}, but the next cell has ${JSON.stringify(cells[i + 1][dim])}`,
        );
      }
    }
  }
  return issues;
}

/**
 * Legibility: along a governed run, consecutive cells must be INSTANTLY
 * distinguishable (not merely non-identical — a subtle change makes the item a
 * visual-acuity test, which is as ill-posed as no change). Rotation rules are
 * additionally restricted to orientable shapes (triangles): on anything more
 * symmetric a quarter turn renders identically or as a wobble.
 */
function checkVisibility(runs: { cells: Cell[]; transforms: DimTransforms; label: string }[]): string[] {
  const issues: string[] = [];
  for (const { cells, transforms, label } of runs) {
    if (nonConstantDims(transforms).length === 0) continue;
    for (let i = 0; i < cells.length - 1; i++) {
      if (!isInstantlyDistinct(cells[i], cells[i + 1])) {
        issues.push(
          `${label}: consecutive cells ${showCell(cells[i])} and ${showCell(cells[i + 1])} are not instantly distinguishable — every step of the rule must be obvious at a glance (different shape/count/fill, size s vs l, or a triangle turning)`,
        );
      }
    }
    if (isNonConstant(transforms.rotation)) {
      for (const cell of cells) {
        if (!(ORIENTABLE_SHAPES as readonly string[]).includes(cell.shape)) {
          issues.push(`${label}: rotation rules are only legible on triangles — a ${cell.shape} is too symmetric for its orientation to be read; govern a different dimension or use triangles`);
          break;
        }
      }
    }
  }
  return issues;
}

function deriveSequence(rule: Extract<Rule, { kind: "sequence" }>, stem: Panel[]): Derivation {
  const drawn = stem.slice(0, -1);
  if (drawn.some(isBlankPanel) || stem.length === 0 || !isBlankPanel(stem[stem.length - 1])) {
    return { cell: null, issues: ["sequence stem must be drawn cells followed by a single trailing blank"] };
  }
  const cells = drawn as Cell[];
  const issues = checkRun(cells, rule.transforms, "sequence");
  const derived = applyTransforms(rule.transforms, cells[cells.length - 1]);
  if (!derived) {
    issues.push("sequence: the rule cannot be applied one more step past the last cell (step leaves the domain — use wrap or a smaller delta)");
    return { cell: null, issues };
  }
  issues.push(...checkVisibility([{ cells: [...cells, derived], transforms: rule.transforms, label: "sequence" }]));
  return { cell: issues.length ? null : derived, issues };
}

function deriveAnalogy(rule: Extract<Rule, { kind: "analogy" }>, stem: Panel[]): Derivation {
  if (stem.length !== 3 || stem.some(isBlankPanel)) {
    return { cell: null, issues: ["analogy stem must be exactly 3 drawn cells [A, B, C]"] };
  }
  const [a, b, c] = stem as Cell[];
  const issues = checkRun([a, b], rule.transforms, "analogy A→B");
  const derived = applyTransforms(rule.transforms, c);
  if (!derived) {
    issues.push("analogy: the A→B transform cannot apply to C (out of domain — pick a C the transform applies to)");
    return { cell: null, issues };
  }
  issues.push(
    ...checkVisibility([
      { cells: [a, b], transforms: rule.transforms, label: "analogy A→B" },
      { cells: [c, derived], transforms: rule.transforms, label: "analogy C→answer" },
    ]),
  );
  return { cell: issues.length ? null : derived, issues };
}

function deriveMatrix(rule: Extract<Rule, { kind: "matrix" }>, stem: Panel[]): Derivation {
  if (stem.length !== 9 || stem.filter(isBlankPanel).length !== 1) {
    return { cell: null, issues: ["matrix stem must be 9 panels with exactly one blank"] };
  }
  const blankAt = stem.findIndex(isBlankPanel);
  const [br, bc] = [Math.floor(blankAt / 3), blankAt % 3];
  const grid = (r: number, c: number): Cell | null => {
    const p = stem[r * 3 + c];
    return isBlankPanel(p) ? null : p;
  };

  // Derive the blank per dimension: row-governed dims step from a drawn cell in
  // its row, col-governed from its column, ungoverned dims copy the global value.
  const issues: string[] = [];
  const derived: Record<string, string | number> = {};
  for (const dim of DIMENSIONS) {
    const rowT = rule.row[dim];
    const colT = rule.col[dim];
    if (isNonConstant(rowT)) {
      const k = [0, 1, 2].find((c) => c !== bc && grid(br, c) !== null)!;
      const v = applyTransform(dim, rowT, grid(br, k)![dim], bc - k);
      if (v === null) issues.push(`matrix: ${showTransform(dim, rowT)} cannot derive the blank from its row (step leaves the domain — use wrap or a smaller delta)`);
      else derived[dim] = v;
    } else if (isNonConstant(colT)) {
      const k = [0, 1, 2].find((r) => r !== br && grid(r, bc) !== null)!;
      const v = applyTransform(dim, colT, grid(k, bc)![dim], br - k);
      if (v === null) issues.push(`matrix: ${showTransform(dim, colT)} cannot derive the blank from its column (step leaves the domain — use wrap or a smaller delta)`);
      else derived[dim] = v;
    } else {
      const any = stem.find((p): p is Cell => !isBlankPanel(p))!;
      derived[dim] = any[dim];
    }
  }
  if (issues.length) return { cell: null, issues };
  const derivedCell = derived as unknown as Cell;

  // Verify the COMPLETED grid: every row against the row transforms, every
  // column against the col transforms — this checks whole-stem consistency
  // (incl. that ungoverned dims are globally constant) and that the derived
  // cell coheres on both axes.
  const full = (r: number, c: number): Cell => grid(r, c) ?? derivedCell;
  const runs: { cells: Cell[]; transforms: DimTransforms; label: string }[] = [];
  for (let r = 0; r < 3; r++) runs.push({ cells: [full(r, 0), full(r, 1), full(r, 2)], transforms: rule.row, label: `matrix row ${r + 1}` });
  for (let c = 0; c < 3; c++) runs.push({ cells: [full(0, c), full(1, c), full(2, c)], transforms: rule.col, label: `matrix col ${c + 1}` });
  for (const run of runs) {
    // Dims governed by the OTHER axis vary freely along this one.
    const other = run.transforms === rule.row ? rule.col : rule.row;
    issues.push(...checkRun(run.cells, run.transforms, run.label, nonConstantDims(other)));
  }
  issues.push(...checkVisibility(runs));
  return { cell: issues.length ? null : derivedCell, issues };
}

/** Re-derive the expected answer cell from a rule and stem (null for oddOneOut). */
export function deriveAnswer(rule: Rule, stem: Panel[]): Derivation {
  switch (rule.kind) {
    case "sequence":
      return deriveSequence(rule, stem);
    case "analogy":
      return deriveAnalogy(rule, stem);
    case "matrix":
      return deriveMatrix(rule, stem);
    case "oddOneOut":
      return { cell: null, issues: [] };
  }
}

export type RuleCheck =
  | { ok: true; derived: Cell | null } // null for oddOneOut (the rule selects an index, not a cell)
  | { ok: false; issues: string[] };

/**
 * The semantic validator: verify a puzzle against its own rule.
 *
 * Checks, in order: rule presence + kind/type match → whole-stem consistency
 * (the rule must explain the entire stem, with unlisted dims constant) → answer
 * match by visualSignature → unique solution (oddOneOut: exactly one breaker;
 * derived kinds get uniqueness free from the options-distinctness superRefine
 * in PuzzleSchema) → visibility/degeneracy (invisible rotation steps, identical
 * consecutive renders).
 *
 * Issue strings are written to be fed back to the generating model verbatim.
 */
export function checkRule(puzzle: Puzzle): RuleCheck {
  const { rule } = puzzle;
  if (!rule) {
    return { ok: false, issues: ['missing "rule" — every puzzle must declare the machine-readable rule it follows'] };
  }
  if (rule.kind !== puzzle.type) {
    return { ok: false, issues: [`rule.kind "${rule.kind}" does not match puzzle type "${puzzle.type}"`] };
  }

  if (rule.kind === "oddOneOut") {
    const issues: string[] = [];
    const breakers = puzzle.options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o[rule.dimension] !== rule.value);
    if (breakers.length !== 1) {
      issues.push(
        `oddOneOut: exactly ONE option must break the shared ${rule.dimension} = ${JSON.stringify(rule.value)}, but ${breakers.length} do (${breakers.map(({ i }) => `option ${i}`).join(", ") || "none"})`,
      );
    } else if (breakers[0].i !== puzzle.answerIndex) {
      issues.push(`oddOneOut: the rule says option ${breakers[0].i} is the odd one (${rule.dimension} ≠ ${JSON.stringify(rule.value)}), but answerIndex is ${puzzle.answerIndex} — fix answerIndex`);
    }
    return issues.length ? { ok: false, issues } : { ok: true, derived: null };
  }

  const { cell, issues } = deriveAnswer(rule, puzzle.stem);
  if (!cell) {
    return { ok: false, issues: issues.length ? issues : ["the rule could not derive an answer from the stem"] };
  }
  const marked = puzzle.options[puzzle.answerIndex];
  if (visualSignature(marked) !== visualSignature(cell)) {
    issues.push(`the rule derives ${showCell(cell)} but options[${puzzle.answerIndex}] is ${showCell(marked)} — fix answerIndex (or the options) so the marked answer is the derived cell`);
  }
  return issues.length ? { ok: false, issues } : { ok: true, derived: cell };
}
