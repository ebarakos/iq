import { createHash } from "node:crypto";
import { isInstantlyDistinct, ORIENTABLE_SHAPES, SHAPES, type Shape } from "./domains";
import { pick, randInt, seededRng, shuffled, type Rng, type Seed } from "../lib/rng";
import {
  analyzeOperatorStem,
  applyOperatorProgram,
  applyTransform,
  applyTransforms,
  checkRule,
  deriveAnswer,
  DIM_DOMAINS,
  DIMENSIONS,
  enumerateOperatorExpressions,
  operatorPredicateValue,
  OPERATOR_DIMS,
  type Dim,
  type DimTransform,
  type DimTransforms,
  type OperatorDim,
  type OperatorExpression,
  type OperatorPredicate,
  type OperatorBase,
  type OperatorProgram,
  type Rule,
} from "./rules";
import {
  PUZZLE_TYPES,
  PuzzleSchema,
  PuzzleSetSchema,
  type Cell,
  type GenerationMetadata,
  type OperatorLegend,
  type Panel,
  type PuzzleType,
  type Puzzle,
  type PuzzleSet,
} from "./schema";

/**
 * Procedural puzzle generator — items correct by construction.
 *
 * Every `generatePuzzle` result passes `PuzzleSchema.parse` AND `checkRule`. The
 * rule DSL (rules.ts) is the single source of truth: we sample a rule, build a
 * stem the rule explains, derive the answer with the SAME code the validator
 * uses, and surround it with near-miss distractors. Generation rejection-samples
 * (bounded retries) and the invariant-sweep test proves exhaustion never bites.
 * Difficulty drives rule complexity (Q5 a-priori anchor; ruleComplexity scores
 * it). Design: docs/plans/rules-bank-agent-calibration.md (Phase A).
 */

const MAX_ATTEMPTS = 100;

/** Change this value whenever deterministic quiz-generation semantics change. */
export const CURRENT_GENERATOR_VERSION = "procedural-v2" as const;
export type GeneratorVersion = "procedural-v1" | typeof CURRENT_GENERATOR_VERSION;

const LEGACY_PUZZLE_TYPES = ["matrix", "sequence", "analogy", "oddOneOut"] as const;

/** The same user-facing profiles used by the existing bank-backed quiz. */
export type QuizProfile = "easy" | "standard" | "hard";

const FAMILY_IDS: Record<PuzzleType, string> = {
  matrix: "matrix-axis-transform-v1",
  sequence: "sequence-transform-v1",
  analogy: "analogy-transform-v1",
  oddOneOut: "odd-one-out-v1",
  operatorInduction: "operator-induction-v1",
};

const QUIZ_DIFFICULTY_RAMPS: Record<QuizProfile, readonly (1 | 2 | 3 | 4 | 5)[]> = {
  easy: [1, 1, 2, 2, 3],
  standard: [2, 2, 3, 3, 5],
  hard: [3, 4, 4, 5, 5],
};

/** Non-shape dims a step transform can govern. Shape is nominal (cycle only). */
const STEP_DIMS = ["count", "rotation", "fill", "size"] as const;

/**
 * Rotation rules anchor an orientable shape (triangles only — the one shape
 * whose quarter-turn orientation reads instantly).
 */
const ROTATABLE: readonly Shape[] = ORIENTABLE_SHAPES;

/** A step transform on a non-rotation dim leaves the domain unless wrapped. */
function nonRotationStep(dim: Dim, rng: Rng, allowWrap: boolean, allowBigDelta: boolean): DimTransform {
  // size is a two-value domain (s/l): only |delta| = 1 produces a visible change.
  const mag = dim !== "size" && allowBigDelta && rng() < 0.5 ? 2 : 1;
  const delta = rng() < 0.5 ? mag : -mag;
  return { op: "step", delta, wrap: allowWrap && rng() < 0.5 };
}

/** A rotation step: quarter (|1|) or half (|2|) turns — both unmistakable on a triangle. */
function rotationStep(rng: Rng, allowBigDelta: boolean): DimTransform {
  const mag = allowBigDelta && rng() < 0.5 ? 2 : 1;
  const delta = rng() < 0.5 ? mag : -mag;
  return { op: "step", delta, wrap: true };
}

/** A shape cycle of 2–3 distinct shapes (the only non-constant op for shape). */
function shapeCycle(rng: Rng, len: number): DimTransform {
  return { op: "cycle", values: shuffled(rng, SHAPES).slice(0, len) };
}

/**
 * Sample one non-constant transform for `dim`, honouring visibility. `rotation`
 * picks its own shape into `shapeHint` so the stem anchors a rotatable shape;
 * `shape` returns a cycle. Returns null when no visible transform exists.
 */
function sampleDimTransform(
  dim: Dim,
  rng: Rng,
  opts: { allowWrap: boolean; allowBigDelta: boolean },
  shapeHint: { shape?: Shape; cycle?: (string | number)[] },
): DimTransform | null {
  if (dim === "shape") {
    const cyc = shapeCycle(rng, randInt(rng, 2, 3));
    shapeHint.cycle = cyc.op === "cycle" ? cyc.values : undefined;
    return cyc;
  }
  if (dim === "rotation") {
    shapeHint.shape = pick(rng, ROTATABLE);
    return rotationStep(rng, opts.allowBigDelta);
  }
  return nonRotationStep(dim, rng, opts.allowWrap, opts.allowBigDelta);
}

interface ComplexityBudget {
  wrap: boolean; // step transforms may wrap
  bigDelta: boolean; // |delta| ≥ 2 allowed
  dims: number; // number of non-constant dims to place
  cycle: boolean; // shape cycle eligible
}

/** Difficulty → a-priori complexity budget. Higher difficulty → richer rules. */
function budgetFor(difficulty: 1 | 2 | 3 | 4 | 5): ComplexityBudget {
  switch (difficulty) {
    case 1:
    case 2:
      return { wrap: false, bigDelta: false, dims: 1, cycle: false };
    case 3:
      // One dim with wrap or |delta| ≥ 2, or a cycle.
      return { wrap: true, bigDelta: true, dims: 1, cycle: true };
    case 4:
      return { wrap: true, bigDelta: true, dims: 2, cycle: true };
    case 5:
      return { wrap: true, bigDelta: true, dims: 2, cycle: true };
  }
}

/**
 * Sample a transforms map placing `count` non-constant dims, collecting shape
 * constraints (a rotation step or shape cycle constrains which shape the stem
 * may anchor). Returns null on an impossible draw (caller rejection-samples).
 */
function sampleTransforms(
  rng: Rng,
  count: number,
  budget: ComplexityBudget,
  excludeShape: boolean,
): { transforms: DimTransforms; shape?: Shape; cycle?: (string | number)[] } | null {
  // Never combine a shape cycle with a rotation step: visibility would have to
  // hold for every shape in the cycle. Keep them mutually exclusive.
  const candidates = [...STEP_DIMS, ...(budget.cycle && !excludeShape ? (["shape"] as const) : [])];
  const chosen = shuffled(rng, candidates).slice(0, count);
  if (chosen.includes("shape") && chosen.includes("rotation")) return null;

  const transforms: DimTransforms = {};
  const hint: { shape?: Shape; cycle?: (string | number)[] } = {};
  for (const dim of chosen) {
    const t = sampleDimTransform(dim, rng, { allowWrap: budget.wrap, allowBigDelta: budget.bigDelta }, hint);
    if (!t) return null;
    transforms[dim] = t;
  }
  return { transforms, ...hint };
}

/**
 * A base cell honouring a shape constraint from the sampled transforms.
 * Non-triangles (and shape-cycle stems, which mix shapes) always use rotation 0
 * — the schema rejects rotated symmetric shapes as illegible.
 */
function baseCell(rng: Rng, shape: Shape | undefined, cycle: (string | number)[] | undefined): Cell {
  const s = (cycle?.[0] as Shape | undefined) ?? shape ?? pick(rng, SHAPES);
  const rotatable = cycle === undefined && (ORIENTABLE_SHAPES as readonly string[]).includes(s);
  return {
    shape: s,
    count: pick(rng, DIM_DOMAINS.count as readonly number[]) as Cell["count"],
    rotation: rotatable ? pick(rng, DIM_DOMAINS.rotation as readonly number[]) : 0,
    fill: pick(rng, DIM_DOMAINS.fill as readonly string[]) as Cell["fill"],
    size: pick(rng, DIM_DOMAINS.size as readonly string[]) as Cell["size"],
  };
}

/**
 * Pick an anchor value for `dim` so applying transform `t` `steps` times stays
 * in-domain across the whole run (probed via applyTransform). Returns null when
 * no anchor survives the run.
 */
function safeAnchor(dim: Dim, t: DimTransform, steps: number, rng: Rng): string | number | null {
  const domain = DIM_DOMAINS[dim];
  const survives = (start: string | number) => {
    let v: string | number | null = start;
    for (let i = 0; i < steps; i++) {
      v = applyTransform(dim, t, v as string | number);
      if (v === null) return false;
    }
    return true;
  };
  const ok = shuffled(rng, domain).filter(survives);
  return ok.length ? ok[0] : null;
}

/** Build a sequence stem whose run-length is anchored so every step (incl. the answer) stays valid. */
function buildSequenceStem(transforms: DimTransforms, base: Cell, drawn: number, rng: Rng): Panel[] | null {
  // The answer is one extra step past the last drawn cell → probe `drawn` steps.
  const cell: Record<string, string | number> = { ...base };
  for (const dim of DIMENSIONS) {
    const t = transforms[dim];
    if (!t || t.op === "constant") continue;
    const anchor = safeAnchor(dim, t, drawn, rng);
    if (anchor === null) return null;
    cell[dim] = anchor;
  }
  const cells: Cell[] = [cell as unknown as Cell];
  for (let i = 1; i < drawn; i++) {
    const next = applyTransforms(transforms, cells[i - 1]);
    if (!next) return null;
    cells.push(next);
  }
  return [...cells, { blank: true }];
}

/** Build the 9-cell matrix grid: row 0 left→right, then each column top→bottom (axes disjoint → consistent). */
function buildMatrixStem(row: DimTransforms, col: DimTransforms, base: Cell, rng: Rng): Panel[] | null {
  const corner: Record<string, string | number> = { ...base };
  // Anchor the top-left so two row steps and two column steps both stay in-domain.
  for (const dim of DIMENSIONS) {
    const rt = row[dim];
    const ct = col[dim];
    const t = rt && rt.op !== "constant" ? rt : ct && ct.op !== "constant" ? ct : null;
    if (!t) continue;
    const anchor = safeAnchor(dim, t, 2, rng);
    if (anchor === null) return null;
    corner[dim] = anchor;
  }
  const grid: Cell[][] = [[corner as unknown as Cell, corner as unknown as Cell, corner as unknown as Cell]];
  for (let c = 1; c < 3; c++) {
    const next = applyTransforms(row, grid[0][c - 1]);
    if (!next) return null;
    grid[0][c] = next;
  }
  for (let r = 1; r < 3; r++) {
    grid.push([] as unknown as Cell[]);
    for (let c = 0; c < 3; c++) {
      const next = applyTransforms(col, grid[r - 1][c]);
      if (!next) return null;
      grid[r][c] = next;
    }
  }
  const flat: Panel[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) flat.push(grid[r][c]);
  flat[8] = { blank: true }; // canonical: blank last
  return flat;
}

/**
 * Build an analogy stem [A, B, C]: A→B via the transform, C with a different
 * shape (free on ungoverned dims) the transform also applies to.
 */
function buildAnalogyStem(transforms: DimTransforms, base: Cell, rng: Rng): Panel[] | null {
  const a: Record<string, string | number> = { ...base };
  for (const dim of DIMENSIONS) {
    const t = transforms[dim];
    if (!t || t.op === "constant") continue;
    const anchor = safeAnchor(dim, t, 1, rng);
    if (anchor === null) return null;
    a[dim] = anchor;
  }
  const aCell = a as unknown as Cell;
  const b = applyTransforms(transforms, aCell);
  if (!b) return null;
  // C: visibly different from A so the analogy is non-trivial; reuse A's
  // governed anchors (already proven to survive one step). When rotation is
  // governed, C must stay a triangle (the only rotatable shape) — vary its
  // count instead; otherwise vary the shape (zeroing rotation for symmetric
  // shapes, which the schema requires).
  let c: Cell;
  if (isNonConstantT(transforms.rotation)) {
    const otherCounts = (DIM_DOMAINS.count as readonly number[]).filter((n) => n !== aCell.count);
    c = { ...aCell, count: pick(rng, otherCounts) as Cell["count"] };
  } else {
    const newShape = pick(rng, SHAPES.filter((s) => s !== aCell.shape));
    const rotatable = (ORIENTABLE_SHAPES as readonly string[]).includes(newShape);
    c = { ...aCell, shape: newShape, rotation: rotatable ? aCell.rotation : 0 };
  }
  if (!applyTransforms(transforms, c)) return null;
  return [aCell, b, c];
}

function isNonConstantT(t: DimTransform | undefined): boolean {
  return t !== undefined && t.op !== "constant";
}

// ── Distractors ────────────────────────────────────────────────────────────

/** ±1-step neighbours of `value` in its domain (wrapping rotation), for near-miss perturbations. */
function neighbours(dim: Dim, value: string | number): (string | number)[] {
  const out: (string | number)[] = [];
  for (const delta of [-1, 1]) {
    const v = applyTransform(dim, { op: "step", delta, wrap: dim === "rotation" }, value);
    if (v !== null && v !== value) out.push(v);
  }
  return out;
}

/** Single-dimension perturbations of the answer — near-misses in RULE space, always bold in VISUAL space. */
function singleDimPerturbations(answer: Cell, rng: Rng): Cell[] {
  const out: Cell[] = [];
  for (const dim of shuffled(rng, DIMENSIONS)) {
    if (dim === "shape") {
      for (const s of shuffled(rng, SHAPES.filter((x) => x !== answer.shape))) {
        const rotatable = (ORIENTABLE_SHAPES as readonly string[]).includes(s);
        out.push({ ...answer, shape: s, rotation: rotatable ? answer.rotation : 0 });
      }
    } else if (dim === "rotation" && !(ORIENTABLE_SHAPES as readonly string[]).includes(answer.shape)) {
      continue; // symmetric shapes can't carry a rotation difference
    } else {
      for (const v of neighbours(dim, answer[dim])) out.push({ ...answer, [dim]: v } as Cell);
    }
  }
  return out;
}

/** Normalize a perturbed cell so it stays schema-legal (no rotated symmetric shapes). */
function legalize(cell: Cell): Cell {
  return (ORIENTABLE_SHAPES as readonly string[]).includes(cell.shape) ? cell : { ...cell, rotation: 0 };
}

/** Two-dimension perturbations (more obviously wrong) — only used at low difficulty. */
function twoDimPerturbations(answer: Cell, rng: Rng): Cell[] {
  const out: Cell[] = [];
  const dims = shuffled(rng, DIMENSIONS);
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      const a = dims[i];
      const b = dims[j];
      const av = a === "shape" ? pick(rng, SHAPES.filter((x) => x !== answer.shape)) : neighbours(a, answer[a])[0];
      const bv = b === "shape" ? pick(rng, SHAPES.filter((x) => x !== answer.shape)) : neighbours(b, answer[b])[0];
      if (av === undefined || bv === undefined) continue;
      out.push(legalize({ ...answer, [a]: av, [b]: bv } as Cell));
    }
  }
  return out;
}

/**
 * Distractors for a derived-answer puzzle: near-misses in RULE space (single-dim
 * perturbations, the "forgot the final step" trap, two-dim perturbations at low
 * difficulty) that are always BOLD in visual space — every kept cell must be
 * instantly distinguishable from the answer and from every other option.
 * Difficulty never tightens perceptual proximity; only the rule gets harder.
 */
function generateDerivedDistractors(answer: Cell, stem: Panel[], difficulty: number, rng: Rng, want: number): Cell[] | null {
  const pool: Cell[] = [...singleDimPerturbations(answer, rng)];
  // The last drawn stem value is a classic "forgot the final step" trap.
  const drawn = stem.filter((p): p is Cell => !("blank" in p));
  if (drawn.length) pool.push(drawn[drawn.length - 1]);
  if (difficulty <= 2) pool.push(...twoDimPerturbations(answer, rng));

  const out: Cell[] = [];
  for (const cell of pool) {
    if (!isInstantlyDistinct(cell, answer)) continue;
    if (out.some((o) => !isInstantlyDistinct(cell, o))) continue;
    out.push(cell);
    if (out.length === want) break;
  }
  return out.length === want ? out : null;
}

/** Does some dimension make `cell` a defensible second odd-one among `options`? */
function isSecondCandidate(cell: Cell, options: Cell[]): boolean {
  const others = options.filter((o) => o !== cell);
  return DIMENSIONS.some((d) => others.every((o) => o[d] === others[0][d]) && cell[d] !== others[0][d]);
}

/**
 * Build oddOneOut options: a coherent group sharing `rule.value` on
 * `rule.dimension`, plus the answer that breaks it. Difficulty controls how
 * close the answer sits to the group IN RULE SPACE (d3+: it matches a group
 * member on everything except the rule dimension — the reasoning is harder,
 * but the difference itself is always categorical and instantly visible).
 * Legibility by construction: rotation only ever varies on triangle-only
 * option sets; every pair of options must be instantly distinguishable. The
 * ambiguity guard rejects any set where a NON-answer is a defensible odd-one.
 */
function buildOddOneOut(
  rule: Extract<Rule, { kind: "oddOneOut" }>,
  difficulty: number,
  rng: Rng,
): { options: Cell[]; answerIndex: number } | null {
  const groupCount = randInt(rng, 3, difficulty >= 5 ? 5 : 4);
  const dim = rule.dimension;

  // Rotation as the shared/broken dimension only reads on triangles; in every
  // other case rotation is pinned to 0 and never varied (symmetric shapes
  // cannot legibly carry it).
  const rotationRule = dim === "rotation";
  const template = baseCell(rng, rotationRule ? ("triangle" as Shape) : undefined, undefined);
  const fix = legalize({ ...template, [dim]: rule.value } as Cell);
  const varyDims = DIMENSIONS.filter(
    (d) => d !== dim && d !== "rotation" && (rotationRule ? d !== "shape" : true),
  );

  // Group: pairwise instantly-distinct cells all sharing rule.value on `dim`.
  const group: Cell[] = [];
  let guard = 0;
  while (group.length < groupCount && guard++ < 200) {
    const varyDim = pick(rng, varyDims);
    const candidate = legalize(
      varyDim === "shape"
        ? { ...fix, shape: pick(rng, SHAPES) }
        : ({ ...fix, [varyDim]: pick(rng, DIM_DOMAINS[varyDim] as readonly (string | number)[]) } as Cell),
    );
    if (rotationRule && candidate.shape !== "triangle") continue;
    if (group.some((o) => !isInstantlyDistinct(candidate, o))) continue;
    group.push(candidate);
  }
  if (group.length < groupCount) return null;

  // Answer breaks `dim`. At d3+ it otherwise matches a group member exactly
  // (only the rule dimension differs → harder reasoning); at d1–2 it drifts on
  // one more dimension (more obvious).
  const breakValue = pick(rng, (DIM_DOMAINS[dim] as readonly (string | number)[]).filter((v) => v !== rule.value));
  let answer: Cell;
  if (difficulty >= 3) {
    answer = legalize({ ...group[0], [dim]: breakValue } as Cell);
  } else {
    const drift = pick(rng, varyDims);
    const driftVal =
      drift === "shape" ? pick(rng, SHAPES) : pick(rng, DIM_DOMAINS[drift] as readonly (string | number)[]);
    answer = legalize({ ...group[0], [dim]: breakValue, [drift]: driftVal } as Cell);
  }
  if (answer[dim] === rule.value) return null; // legalize() may have zeroed a rotation break
  if (group.some((o) => !isInstantlyDistinct(answer, o))) return null;

  const options = [...group, answer];
  // Ambiguity guard: no NON-answer option may itself be a defensible odd-one.
  if (group.some((o) => isSecondCandidate(o, options))) return null;
  // The answer itself must break the group (schema's group-coherence check).
  if (!isSecondCandidate(answer, options)) return null;

  const order = shuffled(rng, options.map((_, i) => i));
  const shuffledOpts = order.map((i) => options[i]);
  return { options: shuffledOpts, answerIndex: order.indexOf(options.length - 1) };
}

// ── Visual operator induction ──────────────────────────────────────────────

function operatorCell(rng: Rng, legend: OperatorLegend): Cell {
  return {
    shape: pick(rng, legend.shapeCycle),
    count: pick(rng, DIM_DOMAINS.count as readonly Cell["count"][]),
    rotation: 0,
    fill: pick(rng, DIM_DOMAINS.fill as readonly Cell["fill"][]),
    size: pick(rng, DIM_DOMAINS.size as readonly Cell["size"][]),
  };
}

function sampleBaseExpression(dim: OperatorDim, rng: Rng, preferArithmetic: boolean): OperatorExpression {
  const bases = enumerateOperatorExpressions(dim, SHAPES.slice(0, 4)).filter((expr) => expr.op !== "if");
  const arithmetic = bases.filter((expr) => expr.op !== "left" && expr.op !== "right");
  return pick(rng, preferArithmetic && arithmetic.length ? arithmetic : bases);
}

function availablePredicates(dim: OperatorDim): OperatorPredicate[] {
  const predicates: OperatorPredicate[] = OPERATOR_DIMS.filter((control) => control !== dim).map(
    (dimension) => ({ kind: "equal" as const, dimension }),
  );
  if (dim !== "count") predicates.push({ kind: "sumCountsEven" });
  return predicates;
}

function sampleConditionalExpression(dim: OperatorDim, rng: Rng): OperatorExpression {
  const bases = enumerateOperatorExpressions(dim, SHAPES.slice(0, 4)).filter(
    (expr): expr is Exclude<OperatorExpression, { op: "if" }> => expr.op !== "if",
  );
  const whenTrue = pick(rng, bases);
  const alternatives = bases.filter((base) => base.op !== whenTrue.op);
  return {
    op: "if",
    predicate: pick(rng, availablePredicates(dim)),
    whenTrue,
    whenFalse: pick(rng, alternatives),
  };
}

function sampleOperatorProgram(difficulty: 1 | 2 | 3 | 4 | 5, rng: Rng): OperatorProgram {
  const conditionalDim = difficulty >= 4 ? pick(rng, OPERATOR_DIMS) : null;
  const arithmeticDims = shuffled(rng, ["shape", "count"] as const).slice(0, difficulty >= 3 ? 2 : 1);
  const program = {} as OperatorProgram;
  for (const dim of OPERATOR_DIMS) {
    program[dim] =
      dim === conditionalDim
        ? sampleConditionalExpression(dim, rng)
        : sampleBaseExpression(dim, rng, arithmeticDims.includes(dim as "shape" | "count"));
  }
  // The arithmetic preference guarantees a non-trivial program at every level.
  return program;
}

function branchCoverage(
  program: OperatorProgram,
  examples: { left: Cell; right: Cell }[],
): boolean {
  for (const dim of OPERATOR_DIMS) {
    const expression = program[dim];
    if (expression.op !== "if") continue;
    const outcomes = examples.map(({ left, right }) => operatorPredicateValue(expression.predicate, left, right));
    const trueCount = outcomes.filter(Boolean).length;
    if (trueCount < 2 || outcomes.length - trueCount < 2) return false;
  }
  return true;
}

function buildOperatorPuzzleParts(
  difficulty: 1 | 2 | 3 | 4 | 5,
  rng: Rng,
): { rule: Extract<Rule, { kind: "operatorInduction" }>; legend: OperatorLegend; stem: Panel[]; options: Cell[]; answerIndex: number } | null {
  const legend: OperatorLegend = { shapeCycle: shuffled(rng, SHAPES).slice(0, difficulty >= 3 ? 4 : 3) };
  const program = sampleOperatorProgram(difficulty, rng);
  const workedCount = difficulty >= 4 ? 5 : 4;
  const inputRows = Array.from({ length: workedCount + 1 }, () => ({
    left: operatorCell(rng, legend),
    right: operatorCell(rng, legend),
  }));
  if (!branchCoverage(program, inputRows.slice(0, workedCount))) return null;

  const worked = inputRows.slice(0, workedCount).map(({ left, right }) => ({
    left,
    right,
    output: applyOperatorProgram(program, left, right, legend.shapeCycle),
  }));
  if (worked.some(({ output }) => output === null)) return null;
  const query = inputRows[workedCount];
  const stem: Panel[] = [
    ...worked.flatMap(({ left, right, output }) => [left, right, output!] as Cell[]),
    query.left,
    query.right,
    { blank: true },
  ];

  const analysis = analyzeOperatorStem(stem, legend);
  if (!analysis.ok || !analysis.answer) return null;
  const distractors: Cell[] = [];
  for (const nearMiss of analysis.nearMisses) {
    if (!isInstantlyDistinct(nearMiss.cell, analysis.answer)) continue;
    if (distractors.some((cell) => !isInstantlyDistinct(cell, nearMiss.cell))) continue;
    distractors.push(nearMiss.cell);
    if (distractors.length === 3) break;
  }
  if (distractors.length < 3) return null;

  const all = [analysis.answer, ...distractors];
  const order = shuffled(rng, all.map((_, index) => index));
  return {
    rule: { kind: "operatorInduction", program },
    legend,
    stem,
    options: order.map((index) => all[index]),
    answerIndex: order.indexOf(0),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Sample a rule for `type` whose complexity matches `difficulty` (visibility honoured). */
export function sampleRule(type: PuzzleType, difficulty: 1 | 2 | 3 | 4 | 5, rng: Rng): Rule {
  const budget = budgetFor(difficulty);

  if (type === "operatorInduction") {
    return { kind: "operatorInduction", program: sampleOperatorProgram(difficulty, rng) };
  }

  if (type === "oddOneOut") {
    // Difficulty drives distractor proximity, not rule shape; pick any dimension/value.
    const dimension = pick(rng, DIMENSIONS);
    const value = pick(rng, DIM_DOMAINS[dimension] as readonly (string | number)[]);
    return { kind: "oddOneOut", dimension, value };
  }

  if (type === "matrix") {
    // d5 → both axes active; otherwise distribute the budget's dims across axes,
    // keeping each axis's governed dims disjoint.
    const bothAxes = difficulty >= 5;
    const rowSample = sampleTransforms(rng, bothAxes ? 1 : Math.min(budget.dims, 2), budget, false);
    if (!rowSample) return sampleRule(type, difficulty, rng);
    const rowDims = Object.keys(rowSample.transforms) as Dim[];
    const colSample = bothAxes || (budget.dims >= 2 && rng() < 0.5)
      ? sampleTransformsExcluding(rng, 1, budget, rowDims, rowSample.cycle !== undefined)
      : null;
    if (bothAxes && !colSample) return sampleRule(type, difficulty, rng);
    return { kind: "matrix", row: rowSample.transforms, col: colSample?.transforms ?? {} };
  }

  // sequence / analogy
  const excludeShape = type === "analogy"; // shape-changing analogies unsupported
  const sample = sampleTransforms(rng, budget.dims, budget, excludeShape);
  if (!sample) return sampleRule(type, difficulty, rng);
  return type === "sequence"
    ? { kind: "sequence", transforms: sample.transforms }
    : { kind: "analogy", transforms: sample.transforms };
}

/** Like sampleTransforms but never reuses a dim in `exclude` (matrix col vs row) or shape with a row cycle. */
function sampleTransformsExcluding(
  rng: Rng,
  count: number,
  budget: ComplexityBudget,
  exclude: Dim[],
  rowHasCycle: boolean,
): { transforms: DimTransforms; shape?: Shape; cycle?: (string | number)[] } | null {
  const candidates = [...STEP_DIMS, ...(budget.cycle && !rowHasCycle ? (["shape"] as const) : [])].filter(
    (d) => !exclude.includes(d),
  );
  if (candidates.length < count) return null;
  const chosen = shuffled(rng, candidates).slice(0, count);
  if (chosen.includes("shape") && chosen.includes("rotation")) return null;
  const transforms: DimTransforms = {};
  const hint: { shape?: Shape; cycle?: (string | number)[] } = {};
  for (const dim of chosen) {
    const t = sampleDimTransform(dim, rng, { allowWrap: budget.wrap, allowBigDelta: budget.bigDelta }, hint);
    if (!t) return null;
    transforms[dim] = t;
  }
  return { transforms, ...hint };
}

/** Collect the shape constraint (rotation rules anchor a triangle / cycle fixes the shape run) implied by a transforms map. */
function shapeConstraint(transforms: DimTransforms): { shape?: Shape; cycle?: (string | number)[] } {
  const out: { shape?: Shape; cycle?: (string | number)[] } = {};
  if (transforms.shape && transforms.shape.op === "cycle") out.cycle = transforms.shape.values;
  if (transforms.rotation && transforms.rotation.op !== "constant") out.shape = ROTATABLE[0];
  return out;
}

/** Build a stem the rule explains (anchors chosen so every step stays in-domain). [] for oddOneOut. */
export function generateStem(rule: Rule, rng: Rng): Panel[] {
  if (rule.kind === "oddOneOut") return [];
  if (rule.kind === "operatorInduction") return [];
  if (rule.kind === "sequence") {
    const { shape, cycle } = shapeConstraint(rule.transforms);
    const drawn = randInt(rng, 3, 5);
    return buildSequenceStem(rule.transforms, baseCell(rng, shape, cycle), drawn, rng) ?? [];
  }
  if (rule.kind === "analogy") {
    const { shape } = shapeConstraint(rule.transforms);
    return buildAnalogyStem(rule.transforms, baseCell(rng, shape, undefined), rng) ?? [];
  }
  // matrix
  const merged = { ...rule.row, ...rule.col };
  const { shape, cycle } = shapeConstraint(merged);
  return buildMatrixStem(rule.row, rule.col, baseCell(rng, shape, cycle), rng) ?? [];
}

/**
 * Near-miss distractors for the derived answer (non-oddOneOut). Higher
 * difficulty → only single-dim perturbations (closer); lower → two-dim allowed.
 * Returns visualSignature-distinct cells excluding the answer.
 */
export function generateDistractors(rule: Rule, answer: Cell, stem: Panel[], difficulty: number, rng: Rng): Cell[] {
  if (rule.kind === "oddOneOut" || rule.kind === "operatorInduction") return []; // these build their own option sets
  const want = difficulty >= 5 && rng() < 0.5 ? randInt(rng, 4, 5) : 3;
  return generateDerivedDistractors(answer, stem, difficulty, rng, want) ?? [];
}

const INSTRUCTIONS: Record<PuzzleType, string> = {
  matrix: "Which option completes the grid?",
  sequence: "Which option continues the sequence?",
  analogy: "Which option completes the analogy?",
  oddOneOut: "Which one does not belong?",
  operatorInduction: "Infer the visual operation. Which output completes the last row?",
};

const LAYOUTS: Record<PuzzleType, Puzzle["layout"]> = {
  matrix: "grid3x3",
  sequence: "row",
  analogy: "analogy",
  oddOneOut: "row",
  operatorInduction: "operatorTable",
};

/** Plain-words description of a single transform, for the auto-written explanation. */
function describeTransform(dim: Dim, t: DimTransform): string {
  if (t.op === "cycle") return `the ${dim} cycles ${t.values.join(" → ")}`;
  if (t.op !== "step") return "";
  if (dim === "rotation") {
    const turn = Math.abs(t.delta) === 1 ? "a quarter turn" : "a half turn";
    return `the triangle turns ${turn} ${t.delta > 0 ? "clockwise" : "counter-clockwise"} each step`;
  }
  if (dim === "size") return `the size flips between small and large`;
  const dir = t.delta > 0 ? "increases" : "decreases";
  const mag = Math.abs(t.delta) === 1 ? "by one step" : `by ${Math.abs(t.delta)} steps`;
  const wrap = t.wrap ? " (wrapping around)" : "";
  return `the ${dim} ${dir} ${mag}${wrap}`;
}

function describeTransforms(transforms: DimTransforms): string {
  const parts = DIMENSIONS.filter((d) => transforms[d] && transforms[d]!.op !== "constant").map((d) =>
    describeTransform(d, transforms[d]!),
  );
  return parts.join(" and ");
}

function describeOperatorBase(base: OperatorBase, dim: OperatorDim): string {
  if (base.op === "left") return `copy the left ${dim}`;
  if (base.op === "right") return `copy the right ${dim}`;
  if (dim === "count") {
    if (base.op === "addMod") return "add counts (mod 4)";
    return base.op === "diffLRMod" ? "left minus right (mod 4)" : "right minus left (mod 4)";
  }

  if (dim === "shape") {
    if (base.op === "addMod") return "move left-shape forward in the shape order";
    return base.op === "diffLRMod"
      ? "move left-shape backward in the shape order"
      : "move right-shape backward in the shape order";
  }

  return `copy the ${base.op === "addMod" ? "right" : "left"} ${dim}`;
}

function describeOperatorPredicate(predicate: OperatorPredicate, dim: OperatorDim): string {
  if (predicate.kind === "sumCountsEven") return "if left and right count total is even";
  return `if left and right ${dim} match`;
}

function describeOperatorExpression(expr: OperatorExpression, dim: OperatorDim): string {
  if (expr.op === "if") {
    return `${describeOperatorPredicate(expr.predicate, dim)}, then ${describeOperatorBase(expr.whenTrue, dim)}, otherwise ${describeOperatorBase(
      expr.whenFalse,
      dim,
    )}`;
  }
  return describeOperatorBase(expr, dim);
}

function describeOperatorRule(program: OperatorProgram): string {
  return [
    `shape=${describeOperatorExpression(program.shape, "shape")}`,
    `count=${describeOperatorExpression(program.count, "count")}`,
    `fill=${describeOperatorExpression(program.fill, "fill")}`,
    `size=${describeOperatorExpression(program.size, "size")}`,
  ].join("; ");
}

/** Auto-write a plain-language explanation from the rule. */
function explain(rule: Rule): string {
  switch (rule.kind) {
    case "sequence":
      return `Along the sequence, ${describeTransforms(rule.transforms)}.`;
    case "analogy":
      return `As in the first pair, ${describeTransforms(rule.transforms)}.`;
    case "matrix": {
      const row = describeTransforms(rule.row);
      const col = describeTransforms(rule.col);
      const clauses = [row && `across each row, ${row}`, col && `down each column, ${col}`].filter(Boolean);
      return `In the grid, ${clauses.join("; ")}.`;
    }
    case "oddOneOut":
      return `Every other option shares ${rule.dimension} ${JSON.stringify(rule.value)}; the odd one breaks it.`;
    case "operatorInduction":
      return `Use one fixed rule for every worked row: combine left and right to get output.`
        + ` Rules: ${describeOperatorRule(rule.program)}.`
        + " Apply that same rule to the last pair, then choose the option that matches.";
  }
}

/** 8 hex chars derived from the rng, for the generated item id. */
function hexId(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}

/** JSON with recursively sorted object keys, used only for stable fingerprints. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function activeDimensions(rule: Rule): Dim[] {
  if (rule.kind === "oddOneOut") return [rule.dimension];
  if (rule.kind === "operatorInduction") {
    return OPERATOR_DIMS.filter((dim) => rule.program[dim].op !== "left");
  }
  if (rule.kind === "matrix") {
    return DIMENSIONS.filter((dim) => {
      const row = rule.row[dim];
      const col = rule.col[dim];
      return (row !== undefined && row.op !== "constant") || (col !== undefined && col.op !== "constant");
    });
  }
  return DIMENSIONS.filter((dim) => {
    const transform = rule.transforms[dim];
    return transform !== undefined && transform.op !== "constant";
  });
}

function transformsFor(rule: Rule): DimTransforms[] {
  if (rule.kind === "oddOneOut" || rule.kind === "operatorInduction") return [];
  return rule.kind === "matrix" ? [rule.row, rule.col] : [rule.transforms];
}

/** Derive stable provenance without storing the quiz seed or exposing the rule. */
function generationMetadata(
  puzzle: Puzzle,
  generatorVersion: string,
): GenerationMetadata {
  if (!puzzle.rule) throw new Error(`generated puzzle ${puzzle.id} is missing its rule`);
  const rule = puzzle.rule;
  const dimensions = activeDimensions(rule);
  const maps = transformsFor(rule);
  const usesWrap = maps.some((transforms) => DIMENSIONS.some((dim) => {
    const transform = transforms[dim];
    return transform?.op === "step" && (transform.wrap || dim === "rotation");
  }));
  const activeAxes = rule.kind === "operatorInduction"
    ? OPERATOR_DIMS.some((dim) => rule.program[dim].op === "if") ? 2 : 1
    : rule.kind === "matrix"
    ? [rule.row, rule.col].filter((transforms) => DIMENSIONS.some((dim) => {
      const transform = transforms[dim];
      return transform !== undefined && transform.op !== "constant";
    })).length
    : 1;
  const complexity = ruleComplexity(rule);
  const strategy = rule.kind === "oddOneOut" ? "coherent-outlier" : "near-miss";
  const familyId = FAMILY_IDS[puzzle.type];
  const dimensionKey = dimensions.join("+") || "none";
  const featureBucket = [
    generatorVersion,
    familyId,
    `d${puzzle.difficulty}`,
    `c${complexity}`,
    `p${activeAxes}`,
    `a-${dimensionKey}`,
    `w${usesWrap ? 1 : 0}`,
    strategy,
  ].join("|");

  return {
    generatorVersion,
    familyId,
    programFingerprint: createHash("sha256")
      .update(`aiq-program-v1\0${canonicalJson(rule)}`)
      .digest("hex")
      .slice(0, 16),
    featureBucket,
    features: {
      difficulty: puzzle.difficulty,
      ruleComplexity: complexity,
      programDepth: activeAxes,
      activeDimensions: dimensions,
      usesWrap,
      distractorStrategy: strategy,
    },
  };
}

/**
 * Generate a puzzle correct by construction: it passes PuzzleSchema.parse AND
 * checkRule. Rejection-samples (sample rule → stem → derive → options → validate)
 * up to MAX_ATTEMPTS; throws on exhaustion (the invariant sweep proves it never
 * happens in practice).
 */
export function generatePuzzle(type: PuzzleType, difficulty: 1 | 2 | 3 | 4 | 5, rng: Rng): Puzzle {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let rule = sampleRule(type, difficulty, rng);

    let options: Cell[];
    let answerIndex: number;
    let stem: Panel[];
    let operatorLegend: OperatorLegend | undefined;

    if (type === "operatorInduction") {
      const built = buildOperatorPuzzleParts(difficulty, rng);
      if (!built) continue;
      ({ options, answerIndex, stem } = built);
      operatorLegend = built.legend;
      rule = built.rule;
    } else if (rule.kind === "oddOneOut") {
      stem = [];
      const built = buildOddOneOut(rule, difficulty, rng);
      if (!built) continue;
      ({ options, answerIndex } = built);
    } else {
      stem = generateStem(rule, rng);
      if (stem.length === 0) continue;
      const { cell } = deriveAnswer(rule, stem);
      if (!cell) continue;
      const distractors = generateDistractors(rule, cell, stem, difficulty, rng);
      if (distractors.length < 3) continue;
      // Place the answer at a random index among the options.
      const all = [cell, ...distractors];
      const order = shuffled(rng, all.map((_, i) => i));
      options = order.map((i) => all[i]);
      answerIndex = order.indexOf(0);
    }

    const candidate: Puzzle = {
      id: `gen-${type}-${hexId(rng)}`,
      type,
      instruction: INSTRUCTIONS[type],
      difficulty,
      layout: LAYOUTS[type],
      operatorLegend,
      stem,
      options,
      answerIndex,
      explanation: explain(rule),
      rule,
    };

    const parsed = PuzzleSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (!checkRule(parsed.data).ok) continue;
    return parsed.data;
  }
  throw new Error(`generatePuzzle: exhausted ${MAX_ATTEMPTS} attempts for type=${type} difficulty=${difficulty}`);
}

/**
 * Generate a complete reproducible quiz from the current procedural families.
 *
 * Each slot has its own named random stream, so rejection sampling or a future
 * change in one family cannot perturb the remaining slots without a generator
 * version change. procedural-v1 retains its four-family layout for exact replay;
 * procedural-v2 has exactly one item from each of the five current families.
 */
export function generateQuiz(seed: Seed, generatorVersion: string, profile: QuizProfile): PuzzleSet {
  if (generatorVersion !== "procedural-v1" && generatorVersion !== CURRENT_GENERATOR_VERSION) {
    throw new Error(`unsupported generator version: ${generatorVersion}`);
  }

  const difficulties = QUIZ_DIFFICULTY_RAMPS[profile];
  if (!difficulties) throw new Error(`unsupported quiz profile: ${String(profile)}`);

  const layoutRng = seededRng(seed, `${generatorVersion}:layout`);
  const familyOrder = shuffled(
    layoutRng,
    generatorVersion === "procedural-v1" ? LEGACY_PUZZLE_TYPES : PUZZLE_TYPES,
  );
  const types: PuzzleType[] =
    generatorVersion === "procedural-v1"
      ? [...familyOrder, pick(layoutRng, familyOrder)]
      : [...familyOrder];
  const puzzles = difficulties.map((difficulty, index) => {
    const type = types[index];
    const rng = seededRng(seed, `${generatorVersion}:${profile}:slot-${index}:${type}:d${difficulty}`);
    const puzzle = generatePuzzle(type, difficulty, rng);
    return PuzzleSchema.parse({
      ...puzzle,
      generation: generationMetadata(puzzle, generatorVersion),
    });
  });

  return PuzzleSetSchema.parse(puzzles);
}

/**
 * A-priori difficulty anchor (Q5): a small integer scoring a rule's intrinsic
 * complexity. Higher = harder. Recalibrated empirically from attempt data later
 * (Phase D); for now it orders procedurally generated items before any data.
 */
export function ruleComplexity(rule: Rule): number {
  if (rule.kind === "oddOneOut") return 1; // proximity is the lever, not rule shape
  if (rule.kind === "operatorInduction") {
    return OPERATOR_DIMS.reduce((score, dim) => {
      const expression = rule.program[dim];
      if (expression.op === "left") return score;
      if (expression.op === "if") return score + 3;
      return score + (expression.op === "right" ? 1 : 2);
    }, 0);
  }
  const score = (transforms: DimTransforms): number => {
    let s = 0;
    for (const dim of DIMENSIONS) {
      const t = transforms[dim];
      if (!t || t.op === "constant") continue;
      s += 1; // each non-constant dim
      if (t.op === "step") {
        if (t.wrap) s += 1;
        if (Math.abs(t.delta) >= 2) s += 1;
      }
      if (t.op === "cycle" && t.values.length >= 3) s += 1;
    }
    return s;
  };
  if (rule.kind === "matrix") {
    const rowActive = DIMENSIONS.some((d) => rule.row[d] && rule.row[d]!.op !== "constant");
    const colActive = DIMENSIONS.some((d) => rule.col[d] && rule.col[d]!.op !== "constant");
    return score(rule.row) + score(rule.col) + (rowActive && colActive ? 1 : 0);
  }
  return score(rule.transforms);
}
