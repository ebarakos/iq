import { z } from "zod";
import {
  isInstantlyDistinct,
  ORIENTABLE_SHAPES,
  ROTATIONS,
  SHAPES,
  visualSignature,
} from "./domains";
import type { Cell, OperatorLegend, Panel, Puzzle } from "./schema";

/**
 * Rule DSL — the machine-readable pattern behind a puzzle.
 *
 * A rule describes how cell dimensions change across the stem, in a form pure
 * code can re-apply. `checkRule` re-derives the correct answer from the rule and
 * verifies the whole puzzle against it; this is the semantic validator that
 * closes the "model mis-marks the answer" reliability gap. The same DSL drives
 * the procedural generator (generate.ts), whose items are correct by
 * construction. The implemented foundation is recorded in
 * docs/plans/rules-bank-agent-calibration.md.
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

// ── Visual operator induction ──────────────────────────────────────────────

/** Dimensions used by operator induction v1. Rotation stays pinned to zero. */
export const OPERATOR_DIMS = ["shape", "count", "fill", "size"] as const;
export type OperatorDim = (typeof OPERATOR_DIMS)[number];

const OPERATOR_MAX_ARITHMETIC_DEPTH = 2;

export const OperatorBaseSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("left") }),
  z.object({ op: z.literal("right") }),
]);
export type OperatorBase = z.infer<typeof OperatorBaseSchema>;
export const OperatorArithmeticOpSchema = z.enum(["addMod", "diffLRMod", "diffRLMod"] as const);
export type OperatorArithmeticOp = z.infer<typeof OperatorArithmeticOpSchema>;

export const OperatorPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equal"), dimension: z.enum(OPERATOR_DIMS) }),
  z.object({ kind: z.literal("sumCountsEven") }),
]);
export type OperatorPredicate = z.infer<typeof OperatorPredicateSchema>;

export type OperatorArithmeticExpression = {
  op: OperatorArithmeticOp;
  left: OperatorNonConditionalExpression;
  right: OperatorNonConditionalExpression;
};
type OperatorConditionalExpression = {
  op: "if";
  predicate: OperatorPredicate;
  whenTrue: OperatorNonConditionalExpression;
  whenFalse: OperatorNonConditionalExpression;
};

type OperatorNonConditionalExpression = OperatorBase | OperatorArithmeticExpression;
export type OperatorExpression = OperatorBase | OperatorArithmeticExpression | OperatorConditionalExpression;

const OperatorNonConditionalExpressionSchema: z.ZodType<OperatorNonConditionalExpression> = z.lazy(() =>
  z.union([
    OperatorBaseSchema,
    z.object({
      op: OperatorArithmeticOpSchema,
      left: OperatorNonConditionalExpressionSchema,
      right: OperatorNonConditionalExpressionSchema,
    }),
  ]),
);

export const OperatorExpressionSchema: z.ZodType<OperatorExpression> = z.lazy(() =>
  z.union([
    OperatorNonConditionalExpressionSchema,
    z.object({
      op: z.literal("if"),
      predicate: OperatorPredicateSchema,
      whenTrue: OperatorNonConditionalExpressionSchema,
      whenFalse: OperatorNonConditionalExpressionSchema,
    }),
  ]),
);

/** One bounded expression per output dimension. */
export const OperatorProgramSchema = z
  .object({
    shape: OperatorExpressionSchema,
    count: OperatorExpressionSchema,
    fill: OperatorExpressionSchema,
    size: OperatorExpressionSchema,
  })
  .strict()
  .superRefine((program, ctx) => {
    let conditionals = 0;
    let hasNonTrivial = false;
    for (const dim of OPERATOR_DIMS) {
      const expr = program[dim];
      if (expressionSemanticSignature(dim, expr, SHAPES) !== baseSemanticSignature(dim, { op: "left" }, SHAPES)) {
        hasNonTrivial = true;
      }
      validateOperatorExpression(dim, expr, [dim], () => {
        conditionals++;
      }, ctx);
    }

    if (conditionals > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "operator-v1 allows at most two conditional output dimensions",
      });
    }

    if (!hasNonTrivial) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "operator program must do more than copy the left cell",
      });
    }
  });
export type OperatorProgram = z.infer<typeof OperatorProgramSchema>;

function validateOperatorExpression(
  dim: OperatorDim,
  candidate: OperatorExpression,
  path: string[],
  onConditional: () => void,
  ctx: z.RefinementCtx,
): void {
  if (candidate.op === "if") {
    if (JSON.stringify(candidate.whenTrue) === JSON.stringify(candidate.whenFalse)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: "operator conditionals must differ between branches",
      });
    }
    if (candidate.predicate.kind === "equal" && candidate.predicate.dimension === dim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "predicate"],
        message: "operator equality must control a different output dimension",
      });
    }
    if (candidate.predicate.kind === "sumCountsEven" && dim === "count") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "predicate"],
        message: "count parity must control a different output dimension",
      });
    }

    onConditional();
    validateOperatorExpression(dim, candidate.whenTrue, [...path, "whenTrue"], onConditional, ctx);
    validateOperatorExpression(dim, candidate.whenFalse, [...path, "whenFalse"], onConditional, ctx);
    return;
  }

  if (!operatorExpressionAllowedForDimension(dim, candidate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "modular operator arithmetic is supported only for shape and count",
    });
  }

  if (arithmeticDepth(candidate) > OPERATOR_MAX_ARITHMETIC_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `operator arithmetic tree is deeper than ${OPERATOR_MAX_ARITHMETIC_DEPTH} levels for ${dim}`,
    });
  }
}

function arithmeticDepth(expr: OperatorExpression): number {
  if (expr.op === "left" || expr.op === "right") return 0;
  if (expr.op === "if") {
    return Math.max(arithmeticDepth(expr.whenTrue), arithmeticDepth(expr.whenFalse));
  }
  return 1 + Math.max(arithmeticDepth(expr.left), arithmeticDepth(expr.right));
}

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
    // Several worked (left, right) -> output examples reveal one bounded
    // per-dimension program, which is then applied to a query pair.
    z.object({ kind: z.literal("operatorInduction"), program: OperatorProgramSchema }),
  ])
  .superRefine((rule, ctx) => {
    if (rule.kind === "operatorInduction") return;
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

const OPERATOR_BASES: readonly OperatorBase[] = [{ op: "left" }, { op: "right" }];
const OPERATOR_ARITHMETIC_OPS: readonly OperatorArithmeticOp[] = ["addMod", "diffLRMod", "diffRLMod"];

/** Stable serialization used for enumeration, diagnostics, and fingerprints. */
export function operatorExpressionKey(expr: OperatorExpression): string {
  if (expr.op === "if") {
    const predicate =
      expr.predicate.kind === "equal" ? `eq:${expr.predicate.dimension}` : expr.predicate.kind;
    return `if:${predicate}:${operatorExpressionKey(expr.whenTrue)}:${operatorExpressionKey(expr.whenFalse)}`;
  }
  if (expr.op !== "left" && expr.op !== "right") {
    return `${expr.op}(${operatorExpressionKey(expr.left)},${operatorExpressionKey(expr.right)})`;
  }
  return expr.op;
}

function applyOperatorArithmetic(
  op: OperatorArithmeticOp,
  left: string | number,
  right: string | number,
  dim: OperatorDim,
  shapeCycle: readonly Cell["shape"][],
): string | number | null {
  if (left === null || right === null) return null;
  if (dim === "count") {
    if (typeof left !== "number" || typeof right !== "number") return null;
    const l = left % 4;
    const r = right % 4;
    const raw = op === "addMod" ? l + r : op === "diffLRMod" ? l - r : r - l;
    const residue = mod(raw, 4);
    return residue === 0 ? 4 : residue;
  }
  if (dim === "shape") {
    const l = shapeCycle.indexOf(left as Cell["shape"]);
    const r = shapeCycle.indexOf(right as Cell["shape"]);
    if (l === -1 || r === -1) return null;
    const raw = op === "addMod" ? l + r : op === "diffLRMod" ? l - r : r - l;
    return shapeCycle[mod(raw, shapeCycle.length)];
  }
  return null;
}

function operatorExpressionAllowedForDimension(dim: OperatorDim, expr: OperatorExpression): boolean {
  if (expr.op === "if") {
    return operatorExpressionAllowedForDimension(dim, expr.whenTrue) && operatorExpressionAllowedForDimension(dim, expr.whenFalse);
  }
  if (expr.op === "left" || expr.op === "right") return true;
  return dim === "shape" || dim === "count";
}

export function operatorProgramKey(program: OperatorProgram): string {
  return OPERATOR_DIMS.map((dim) => `${dim}=${operatorExpressionKey(program[dim])}`).join("|");
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

/** Apply one primitive to the corresponding dimension of an input pair. */
export function applyOperatorBase(
  base: OperatorBase,
  dim: OperatorDim,
  left: Cell,
  right: Cell,
): string | number | null {
  if (base.op === "left") return left[dim];
  if (base.op === "right") return right[dim];
  return null;
}

export function operatorPredicateValue(predicate: OperatorPredicate, left: Cell, right: Cell): boolean {
  if (predicate.kind === "sumCountsEven") return (left.count + right.count) % 2 === 0;
  return left[predicate.dimension] === right[predicate.dimension];
}

export function applyOperatorExpression(
  expr: OperatorExpression,
  dim: OperatorDim,
  left: Cell,
  right: Cell,
  shapeCycle: readonly Cell["shape"][],
): string | number | null {
  if (expr.op === "if") {
    const branch = operatorPredicateValue(expr.predicate, left, right) ? expr.whenTrue : expr.whenFalse;
    return applyOperatorExpression(branch, dim, left, right, shapeCycle);
  }
  if (expr.op === "left" || expr.op === "right") {
    return applyOperatorBase(expr, dim, left, right);
  }
  const leftValue = applyOperatorExpression(expr.left, dim, left, right, shapeCycle);
  const rightValue = applyOperatorExpression(expr.right, dim, left, right, shapeCycle);
  if (leftValue === null || rightValue === null) return null;
  return applyOperatorArithmetic(expr.op, leftValue, rightValue, dim, shapeCycle);
}

/** Apply a complete operator program. Rotation is deliberately absent in v1. */
export function applyOperatorProgram(
  program: OperatorProgram,
  left: Cell,
  right: Cell,
  shapeCycle: readonly Cell["shape"][],
): Cell | null {
  const output: Partial<Cell> = { rotation: 0 };
  for (const dim of OPERATOR_DIMS) {
    const value = applyOperatorExpression(program[dim], dim, left, right, shapeCycle);
    if (value === null) return null;
    (output as Record<OperatorDim, string | number>)[dim] = value;
  }
  return output as Cell;
}

function baseSemanticSignature(
  dim: OperatorDim,
  base: OperatorBase,
  shapeCycle: readonly Cell["shape"][],
): string {
  const domain = dim === "shape" ? shapeCycle : DIM_DOMAINS[dim];
  const dummy = (value: string | number): Cell => ({
    shape: (dim === "shape" ? value : shapeCycle[0]) as Cell["shape"],
    count: (dim === "count" ? value : 1) as Cell["count"],
    rotation: 0,
    fill: (dim === "fill" ? value : "outline") as Cell["fill"],
    size: (dim === "size" ? value : "s") as Cell["size"],
  });
  const table: (string | number | null)[] = [];
  for (const left of domain) {
    for (const right of domain) {
      table.push(applyOperatorBase(base, dim, dummy(left), dummy(right)));
    }
  }
  return JSON.stringify(table);
}

function expressionSemanticSignature(
  dim: OperatorDim,
  expression: OperatorExpression,
  shapeCycle: readonly Cell["shape"][],
): string {
  const targetDomain = dim === "shape" ? shapeCycle : DIM_DOMAINS[dim];
  const controlDim =
    expression.op === "if" && expression.predicate.kind === "equal"
      ? expression.predicate.dimension
      : expression.op === "if" && expression.predicate.kind === "sumCountsEven"
        ? "count"
        : null;
  const controlDomain = controlDim
    ? controlDim === "shape" ? shapeCycle : DIM_DOMAINS[controlDim]
    : [null];
  const make = (target: string | number, control: string | number | null): Cell => {
    const cell: Cell = {
      shape: shapeCycle[0],
      count: 1,
      rotation: 0,
      fill: "outline",
      size: "s",
    };
    (cell as unknown as Record<OperatorDim, string | number>)[dim] = target;
    if (controlDim && control !== null) {
      (cell as unknown as Record<OperatorDim, string | number>)[controlDim] = control;
    }
    return cell;
  };
  const table: (string | number | null)[] = [];
  for (const leftTarget of targetDomain) {
    for (const rightTarget of targetDomain) {
      for (const leftControl of controlDomain) {
        for (const rightControl of controlDomain) {
          table.push(
            applyOperatorExpression(
              expression,
              dim,
              make(leftTarget, leftControl),
              make(rightTarget, rightControl),
              shapeCycle,
            ),
          );
        }
      }
    }
  }
  return JSON.stringify(table);
}

const operatorExpressionCache = new Map<string, OperatorExpression[]>();

/**
 * Enumerate the complete v1 expression grammar for one output dimension.
 * Difficulty never narrows this list: the uniqueness proof uses every program
 * a solver could reasonably consider within the published family.
 */
export function enumerateOperatorExpressions(
  dim: OperatorDim,
  shapeCycle: readonly Cell["shape"][],
): OperatorExpression[] {
  // Grammar structure and semantic aliases depend on cycle length, not the
  // particular shape names or their order. Cache this finite enumeration: the
  // oracle consults it repeatedly during rejection sampling and sweeps.
  const cacheKey = `${dim}:${shapeCycle.length}`;
  const cached = operatorExpressionCache.get(cacheKey);
  if (cached) return cached;

  const byDepth: OperatorNonConditionalExpression[][] = [];
  const expressionByDepth = (depth: number): OperatorNonConditionalExpression[] =>
    byDepth[depth] ?? [];

  const baseExpressions: OperatorNonConditionalExpression[] = [];
  const semanticExpressions = new Set<string>();
  const semanticBases = new Set<string>();
  for (const base of OPERATOR_BASES) {
    const signature = baseSemanticSignature(dim, base, shapeCycle);
    if (semanticBases.has(signature)) continue;
    semanticBases.add(signature);
    baseExpressions.push(base);
  }
  const addExpression = (bag: OperatorExpression[], expression: OperatorExpression) => {
    const signature = expressionSemanticSignature(dim, expression, shapeCycle);
    if (semanticExpressions.has(signature)) return;
    semanticExpressions.add(signature);
    bag.push(expression);
  };
  const addNonConditionalExpression = (bag: OperatorNonConditionalExpression[], expression: OperatorNonConditionalExpression) => {
    addExpression(bag, expression);
  };
  const predicates: OperatorPredicate[] = OPERATOR_DIMS.filter((control) => control !== dim).map(
    (dimension) => ({ kind: "equal" as const, dimension }),
  );
  if (dim !== "count") predicates.push({ kind: "sumCountsEven" });

  byDepth[0] = [];
  baseExpressions.forEach((expression) => addNonConditionalExpression(byDepth[0], expression));

  // Arithmetic trees: depth means the max chain length. For depth d, both operands
  // may reach depth d-1; this guarantees exact depth growth and terminates.
  for (let depth = 1; depth <= OPERATOR_MAX_ARITHMETIC_DEPTH; depth++) {
    const level: OperatorNonConditionalExpression[] = [];
    for (const op of OPERATOR_ARITHMETIC_OPS) {
      for (let leftDepth = 0; leftDepth < depth; leftDepth++) {
        const rightDepth = depth - 1;
        for (const left of expressionByDepth(leftDepth)) {
          for (const right of expressionByDepth(rightDepth)) {
          const expression = { op, left: left as OperatorNonConditionalExpression, right: right as OperatorNonConditionalExpression };
          if (!operatorExpressionAllowedForDimension(dim, expression)) continue;
          addNonConditionalExpression(level, expression);
          }
        }
        if (leftDepth !== rightDepth) {
          for (const right of expressionByDepth(leftDepth)) {
            for (const left of expressionByDepth(rightDepth)) {
            const expression = { op, left: left as OperatorNonConditionalExpression, right: right as OperatorNonConditionalExpression };
            if (!operatorExpressionAllowedForDimension(dim, expression)) continue;
            addNonConditionalExpression(level, expression);
          }
        }
      }
    }
    }
    byDepth.push(level);
  }

  const nonIfExpressions = byDepth.flat();

  const all: OperatorExpression[] = [...nonIfExpressions];
  for (const predicate of predicates) {
    for (const whenTrue of nonIfExpressions) {
      for (const whenFalse of nonIfExpressions) {
        if (
          expressionSemanticSignature(dim, whenTrue, shapeCycle) ===
          expressionSemanticSignature(dim, whenFalse, shapeCycle)
        ) {
          // Not a true branch split in this output dimension.
          continue;
        }
        const expression = {
          op: "if",
          predicate,
          whenTrue,
          whenFalse,
        } as OperatorExpression;
        addExpression(all, expression);
      }
    }
  }

  operatorExpressionCache.set(cacheKey, all);
  return all;
}

export interface OperatorExample {
  left: Cell;
  right: Cell;
  output: Cell;
}

export interface OperatorNearMiss {
  cell: Cell;
  dimension: OperatorDim;
  expression: OperatorExpression;
  failedRows: number[];
}

export interface OperatorAnalysis {
  ok: boolean;
  answer: Cell | null;
  issues: string[];
  survivors: Record<OperatorDim, OperatorExpression[]>;
  nearMisses: OperatorNearMiss[];
}

function emptyOperatorSurvivors(): Record<OperatorDim, OperatorExpression[]> {
  return { shape: [], count: [], fill: [], size: [] };
}

/** Decode the triple-encoded operator stem into worked rows and its query pair. */
export function parseOperatorStem(stem: Panel[]): {
  examples: OperatorExample[];
  query: { left: Cell; right: Cell };
} | null {
  if (![12, 15, 18].includes(stem.length) || !isBlankPanel(stem[stem.length - 1])) return null;
  if (stem.slice(0, -1).some(isBlankPanel)) return null;
  const cells = stem.slice(0, -1) as Cell[];
  const query = { left: cells[cells.length - 2], right: cells[cells.length - 1] };
  const examples: OperatorExample[] = [];
  for (let i = 0; i < cells.length - 2; i += 3) {
    examples.push({ left: cells[i], right: cells[i + 1], output: cells[i + 2] });
  }
  return { examples, query };
}

/** Full-grammar, per-dimension answer-uniqueness proof and near-miss search. */
export function analyzeOperatorStem(stem: Panel[], legend: OperatorLegend): OperatorAnalysis {
  const decoded = parseOperatorStem(stem);
  const survivors = emptyOperatorSurvivors();
  if (!decoded) {
    return { ok: false, answer: null, issues: ["operator stem must contain 3–5 worked triples and one final query triple"], survivors, nearMisses: [] };
  }
  const { examples, query } = decoded;
  const answer: Partial<Cell> = { rotation: 0 };
  const issues: string[] = [];

  for (const dim of OPERATOR_DIMS) {
    const all = enumerateOperatorExpressions(dim, legend.shapeCycle);
    survivors[dim] = all.filter((expr) =>
      examples.every(
        ({ left, right, output }) =>
          applyOperatorExpression(expr, dim, left, right, legend.shapeCycle) === output[dim],
      ),
    );
    const predictions = new Set(
      survivors[dim].map((expr) => applyOperatorExpression(expr, dim, query.left, query.right, legend.shapeCycle)),
    );
    predictions.delete(null);
    if (survivors[dim].length === 0) {
      issues.push(`operator: no allowed ${dim} expression explains every worked row`);
    } else if (predictions.size !== 1) {
      issues.push(`operator: surviving ${dim} expressions predict ${predictions.size} different query values`);
    } else {
      (answer as Record<OperatorDim, string | number>)[dim] = [...predictions][0] as string | number;
    }
  }

  if (issues.length) return { ok: false, answer: null, issues, survivors, nearMisses: [] };
  const resolved = answer as Cell;
  const nearMissBySignature = new Map<string, OperatorNearMiss>();
  for (const dim of OPERATOR_DIMS) {
    for (const expression of enumerateOperatorExpressions(dim, legend.shapeCycle)) {
      const failedRows = examples
        .map(({ left, right, output }, index) =>
          applyOperatorExpression(expression, dim, left, right, legend.shapeCycle) === output[dim] ? -1 : index,
        )
        .filter((index) => index >= 0);
      if (failedRows.length === 0) continue;
      const value = applyOperatorExpression(expression, dim, query.left, query.right, legend.shapeCycle);
      if (value === null || value === resolved[dim]) continue;
      const cell = { ...resolved, [dim]: value } as Cell;
      const signature = visualSignature(cell);
      const candidate = { cell, dimension: dim, expression, failedRows };
      const prior = nearMissBySignature.get(signature);
      if (
        !prior ||
        failedRows.length < prior.failedRows.length ||
        (failedRows.length === prior.failedRows.length && operatorExpressionKey(expression) < operatorExpressionKey(prior.expression))
      ) {
        nearMissBySignature.set(signature, candidate);
      }
    }
  }
  const nearMisses = [...nearMissBySignature.values()].sort(
    (a, b) =>
      a.failedRows.length - b.failedRows.length ||
      operatorExpressionKey(a.expression).localeCompare(operatorExpressionKey(b.expression)) ||
      a.dimension.localeCompare(b.dimension),
  );
  return { ok: true, answer: resolved, issues: [], survivors, nearMisses };
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

function deriveOperator(
  rule: Extract<Rule, { kind: "operatorInduction" }>,
  stem: Panel[],
  legend: OperatorLegend | undefined,
): Derivation {
  if (!legend) return { cell: null, issues: ["operatorInduction needs a visible shapeCycle legend"] };
  const decoded = parseOperatorStem(stem);
  if (!decoded) {
    return { cell: null, issues: ["operator stem must contain 3–5 worked triples and one final query triple"] };
  }

  const issues: string[] = [];
  const allCells = decoded.examples.flatMap(({ left, right, output }) => [left, right, output]);
  allCells.push(decoded.query.left, decoded.query.right);
  if (allCells.some((cell) => cell.rotation !== 0)) {
    issues.push("operator v1 pins rotation to zero in every input and output cell");
  }
  const allowedShapes = new Set(legend.shapeCycle);
  if (allCells.some((cell) => !allowedShapes.has(cell.shape))) {
    issues.push("operator cells must use only shapes shown in the visible shapeCycle");
  }

  for (let i = 0; i < decoded.examples.length; i++) {
    const { left, right, output } = decoded.examples[i];
    const predicted = applyOperatorProgram(rule.program, left, right, legend.shapeCycle);
    if (!predicted || visualSignature(predicted) !== visualSignature(output)) {
      issues.push(`operator worked row ${i + 1} does not match the declared program`);
    }
  }

  for (const dim of OPERATOR_DIMS) {
    const expr = rule.program[dim];
    if (expr.op !== "if") continue;
    const outcomes = decoded.examples.map(({ left, right }) => operatorPredicateValue(expr.predicate, left, right));
    const trueCount = outcomes.filter(Boolean).length;
    const falseCount = outcomes.length - trueCount;
    if (trueCount < 2 || falseCount < 2) {
      issues.push(`operator conditional on ${dim} must demonstrate each branch in at least two worked rows`);
    }
  }

  const analysis = analyzeOperatorStem(stem, legend);
  issues.push(...analysis.issues);
  const declared = applyOperatorProgram(rule.program, decoded.query.left, decoded.query.right, legend.shapeCycle);
  if (analysis.answer && (!declared || visualSignature(declared) !== visualSignature(analysis.answer))) {
    issues.push("operator declared program disagrees with the full-grammar uniqueness oracle");
  }
  return { cell: issues.length ? null : analysis.answer, issues };
}

/** Re-derive the expected answer cell from a rule and stem (null for oddOneOut). */
export function deriveAnswer(rule: Rule, stem: Panel[], operatorLegend?: OperatorLegend): Derivation {
  switch (rule.kind) {
    case "sequence":
      return deriveSequence(rule, stem);
    case "analogy":
      return deriveAnalogy(rule, stem);
    case "matrix":
      return deriveMatrix(rule, stem);
    case "oddOneOut":
      return { cell: null, issues: [] };
    case "operatorInduction":
      return deriveOperator(rule, stem, operatorLegend);
  }
}

type DerivedRule = Extract<Rule, { kind: "sequence" | "analogy" | "matrix" }>;

export type DerivedNearMissProgram =
  | { kind: "sequence" | "analogy"; transforms: DimTransforms }
  | { kind: "matrix"; row: DimTransforms; col: DimTransforms };

export interface DerivedNearMissWitness {
  program: DerivedNearMissProgram;
  changedDimensions: Dim[];
  failedEvidence: { dimension: Dim; transitions: number[] }[];
}

type TransformSlot = "transforms" | "row" | "col";

interface DimensionEvidence {
  slot: TransformSlot;
  querySource: string | number;
  querySteps: number;
  transitions: { from: string | number; to: string | number; index: number }[];
}

const transformCandidateCache = new Map<Dim, DimTransform[]>();

/** Finite transform grammar used to reconstruct a competing derived-family program. */
function transformCandidates(dim: Dim): DimTransform[] {
  const cached = transformCandidateCache.get(dim);
  if (cached) return cached;

  const candidates: DimTransform[] = [{ op: "constant" }];
  if (dim !== "shape") {
    for (const delta of [-3, -2, -1, 1, 2, 3]) {
      candidates.push({ op: "step", delta, wrap: false }, { op: "step", delta, wrap: true });
    }
  }

  const domain = [...DIM_DOMAINS[dim]];
  const addCycles = (prefix: (string | number)[], remaining: (string | number)[]) => {
    if (prefix.length >= 2) candidates.push({ op: "cycle", values: [...prefix] });
    for (let i = 0; i < remaining.length; i++) {
      addCycles([...prefix, remaining[i]], [...remaining.slice(0, i), ...remaining.slice(i + 1)]);
    }
  };
  addCycles([], domain);
  transformCandidateCache.set(dim, candidates);
  return candidates;
}

function dimensionEvidence(rule: DerivedRule, stem: Panel[], dim: Dim): DimensionEvidence | null {
  if (rule.kind === "sequence") {
    const cells = stem.slice(0, -1);
    if (cells.length === 0 || cells.some(isBlankPanel)) return null;
    const drawn = cells as Cell[];
    return {
      slot: "transforms",
      querySource: drawn[drawn.length - 1][dim],
      querySteps: 1,
      transitions: drawn.slice(0, -1).map((cell, index) => ({
        from: cell[dim],
        to: drawn[index + 1][dim],
        index,
      })),
    };
  }

  if (rule.kind === "analogy") {
    if (stem.length !== 3 || stem.some(isBlankPanel)) return null;
    const [a, b, query] = stem as Cell[];
    return {
      slot: "transforms",
      querySource: query[dim],
      querySteps: 1,
      transitions: [{ from: a[dim], to: b[dim], index: 0 }],
    };
  }

  if (stem.length !== 9 || stem.filter(isBlankPanel).length !== 1) return null;
  const blankAt = stem.findIndex(isBlankPanel);
  const blankRow = Math.floor(blankAt / 3);
  const blankCol = blankAt % 3;
  const slot: "row" | "col" = isNonConstant(rule.row[dim])
    ? "row"
    : isNonConstant(rule.col[dim])
      ? "col"
      : "row";
  const grid = (row: number, col: number): Cell | null => {
    const panel = stem[row * 3 + col];
    return isBlankPanel(panel) ? null : panel;
  };
  const queryAxis = slot === "row" ? blankCol : blankRow;
  const sourceAxis = [0, 1, 2].find((axis) => {
    if (axis === queryAxis) return false;
    return slot === "row" ? grid(blankRow, axis) !== null : grid(axis, blankCol) !== null;
  });
  if (sourceAxis === undefined) return null;
  const source = slot === "row" ? grid(blankRow, sourceAxis) : grid(sourceAxis, blankCol);
  if (!source) return null;

  const transitions: DimensionEvidence["transitions"] = [];
  let transitionIndex = 0;
  for (let line = 0; line < 3; line++) {
    for (let position = 0; position < 2; position++) {
      const from = slot === "row" ? grid(line, position) : grid(position, line);
      const to = slot === "row" ? grid(line, position + 1) : grid(position + 1, line);
      if (from && to) transitions.push({ from: from[dim], to: to[dim], index: transitionIndex });
      transitionIndex++;
    }
  }
  return {
    slot,
    querySource: source[dim],
    querySteps: queryAxis - sourceAxis,
    transitions,
  };
}

/**
 * Reconstruct a concrete competing transform program for a derived-family
 * distractor. Every changed dimension must predict the distractor at the query
 * while failing at least one visible transition, so the option is a rule-space
 * near miss rather than an arbitrary visual perturbation.
 */
export function findDerivedNearMissWitness(
  rule: DerivedRule,
  stem: Panel[],
  distractor: Cell,
): DerivedNearMissWitness | null {
  const derivation = deriveAnswer(rule, stem);
  if (!derivation.cell || visualSignature(derivation.cell) === visualSignature(distractor)) return null;

  const changedDimensions = DIMENSIONS.filter((dim) => derivation.cell![dim] !== distractor[dim]);
  if (changedDimensions.length === 0) return null;
  const program: DerivedNearMissProgram = rule.kind === "matrix"
    ? { kind: "matrix", row: { ...rule.row }, col: { ...rule.col } }
    : { kind: rule.kind, transforms: { ...rule.transforms } };
  const failedEvidence: DerivedNearMissWitness["failedEvidence"] = [];

  for (const dim of changedDimensions) {
    const evidence = dimensionEvidence(rule, stem, dim);
    if (!evidence) return null;
    let match: { transform: DimTransform; transitions: number[] } | null = null;
    for (const transform of transformCandidates(dim)) {
      if (applyTransform(dim, transform, evidence.querySource, evidence.querySteps) !== distractor[dim]) continue;
      const transitions = evidence.transitions
        .filter(({ from, to }) => applyTransform(dim, transform, from) !== to)
        .map(({ index }) => index);
      if (transitions.length === 0) continue;
      match = { transform, transitions };
      break;
    }
    if (!match) return null;

    if (program.kind === "matrix") {
      if (evidence.slot === "transforms") return null;
      program[evidence.slot][dim] = match.transform;
    } else {
      program.transforms[dim] = match.transform;
    }
    failedEvidence.push({ dimension: dim, transitions: match.transitions });
  }

  return { program, changedDimensions, failedEvidence };
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

  const { cell, issues } = deriveAnswer(rule, puzzle.stem, puzzle.operatorLegend);
  if (!cell) {
    return { ok: false, issues: issues.length ? issues : ["the rule could not derive an answer from the stem"] };
  }
  const marked = puzzle.options[puzzle.answerIndex];
  if (visualSignature(marked) !== visualSignature(cell)) {
    issues.push(`the rule derives ${showCell(cell)} but options[${puzzle.answerIndex}] is ${showCell(marked)} — fix answerIndex (or the options) so the marked answer is the derived cell`);
  }
  return issues.length ? { ok: false, issues } : { ok: true, derived: cell };
}
