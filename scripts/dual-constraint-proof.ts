/**
 * Mechanism proof for the proposed `dual-constraint-matrix-v1` family
 * (docs/plans/escalate-the-quiz.md, Phase 4). Nothing here is production code:
 * the plan gates the family behind this proof, and the script exists to decide
 * that gate one way or the other.
 *
 * The proposed item is a 3x3 grid of scene panels with the bottom-right panel
 * blank. A row operation R advances a row left to right, a column operation C
 * advances a column top to bottom, and the composition convention is
 *
 *     cell(i, j) = C^i(R^j(base))
 *
 * which the solver can check for themselves because cell(1, 1) = C(R(base)) is
 * visible. Revision 1 of the design failed because R and C acted on disjoint
 * aspects of the scene and therefore commuted, so one rule applied to one
 * neighbouring panel already produced the answer. This revision proposes
 * non-commuting same-aspect operations (both move token positions) as the fix.
 *
 * The proof runs the five checks the plan demands over seeded draws:
 *
 *   1. build      - all nine cells exist and no two of them look alike;
 *   2. oracle     - every (R', C') pair in the grammar that reproduces the eight
 *                   visible cells must predict the same hidden cell;
 *   3. necessity  - the two naive single-rule predictions (row rule applied to
 *                   the left neighbour, column rule applied to the top
 *                   neighbour) must BOTH differ from the answer, so that no
 *                   single rule shortcuts the item;
 *   4. near miss  - at least five distinct wrong scenes must exist;
 *   5. variety    - at least eight distinct (R, C) fingerprints must survive.
 *
 * Run it with:
 *
 *     node --import tsx scripts/dual-constraint-proof.ts
 */

import { performance } from "node:perf_hooks";
import { pick, seededRng, shuffled, type Rng } from "../src/lib/rng";
import { applySceneUnary, type SceneUnaryOperation } from "../src/items/scene-grammar";
import {
  DISTRACTORS_PER_ITEM,
  areScenesCategoricallyDistinct,
  sceneSignature,
  type Scene,
  type SceneToken,
} from "../src/items/schema";

/** Seeded draws attempted per grammar configuration, as the plan specifies. */
const PROOF_SEEDS = 200;

/** The plan's variety floor: eight distinct programs over the seed sweep. */
const MIN_DISTINCT_PROGRAM_FINGERPRINTS = 8;

/** Generation must not have to retry forever to find a well-posed draw. */
const MIN_ACCEPTANCE_RATE = 0.1;

/** Board size shared with the other relational scene families. */
const BOARD_ROWS = 3;
const BOARD_COLUMNS = 3;

/** Two tokens of distinct shapes, mirroring `relationalMatrix`'s atom style. */
const TOKENS_PER_SCENE = 2;
const TOKEN_SHAPES = ["circle", "square", "triangle", "diamond", "star"] as const;

/**
 * Where the answer sits in the nine-panel grid, and which panels a solver would
 * reach for if they only used one of the two rules.
 */
const ANSWER_INDEX = 8; // cell(2, 2)
const LEFT_NEIGHBOUR_INDEX = 7; // cell(2, 1) — the row rule's shortcut
const TOP_NEIGHBOUR_INDEX = 5; // cell(1, 2) — the column rule's shortcut

/**
 * The order in which a cell's row steps and column steps are composed. The plan
 * names composition order as part of the grammar, so every order is searched,
 * not only the one the redesign proposes.
 *
 *   columnOuter          cell(i, j) = C^i(R^j(base))   — the proposed convention
 *   rowOuter             cell(i, j) = R^j(C^i(base))   — the mirror image
 *   staircaseRowFirst    R, C, R, C, ... alternating, row step first
 *   staircaseColumnFirst C, R, C, R, ... alternating, column step first
 *
 * These are the four natural ways to walk a monotone path from the top-left cell
 * to cell (i, j), which is the complete space of conventions a solver could read
 * off the visible grid.
 */
type CompositionOrder = "columnOuter" | "rowOuter" | "staircaseRowFirst" | "staircaseColumnFirst";

const COMPOSITION_ORDERS: readonly CompositionOrder[] = [
  "columnOuter",
  "rowOuter",
  "staircaseRowFirst",
  "staircaseColumnFirst",
];

interface GrammarConfiguration {
  readonly name: string;
  readonly description: string;
  readonly operations: readonly SceneUnaryOperation[];
}

function token(shape: SceneToken["shape"]): SceneToken {
  return { kind: "token", shape, rotation: 0, fill: "outline", size: "l" };
}

function scene(placements: Scene["objects"]): Scene {
  return { kind: "scene", rows: BOARD_ROWS, columns: BOARD_COLUMNS, objects: placements, tiles: [] };
}

function operationKey(operation: SceneUnaryOperation): string {
  return JSON.stringify(operation);
}

/** Rotations and reflections: the dihedral group of the square board. */
function dihedralOperations(): SceneUnaryOperation[] {
  return [
    { kind: "rotate", quarterTurns: 1 },
    { kind: "rotate", quarterTurns: 2 },
    { kind: "rotate", quarterTurns: 3 },
    { kind: "reflect", axis: "horizontal" },
    { kind: "reflect", axis: "vertical" },
  ];
}

/** Board slides that wrap around the edge, so they are always applicable. */
function wrappingTranslations(): SceneUnaryOperation[] {
  const operations: SceneUnaryOperation[] = [];
  for (const rowDelta of [-1, 0, 1] as const) {
    for (const columnDelta of [-1, 0, 1] as const) {
      if (rowDelta === 0 && columnDelta === 0) continue;
      operations.push({ kind: "translate", rowDelta, columnDelta, wrap: true });
    }
  }
  return operations;
}

/** Board slides that fall off the edge, so a draw can be rejected as inapplicable. */
function clippingTranslations(): SceneUnaryOperation[] {
  const operations: SceneUnaryOperation[] = [];
  for (const rowDelta of [-1, 0, 1] as const) {
    for (const columnDelta of [-1, 0, 1] as const) {
      if (rowDelta === 0 && columnDelta === 0) continue;
      operations.push({ kind: "translate", rowDelta, columnDelta, wrap: false });
    }
  }
  return operations;
}

/**
 * The configurations searched. Every one is a bounded list of same-aspect
 * spatial operations; they differ in how much non-commutation they contain,
 * which is the property the redesign claims will make both rules necessary.
 */
const GRAMMAR_CONFIGURATIONS: readonly GrammarConfiguration[] = [
  {
    name: "dihedral",
    description: "rotations and reflections only — every pair of distinct operations here fails to commute except through the half turn",
    operations: dihedralOperations(),
  },
  {
    name: "wrapping-translations",
    description: "wrapping board slides only — a control: slides commute with each other, so this should behave like the failed revision 1",
    operations: wrappingTranslations(),
  },
  {
    name: "dihedral-and-wrapping-translations",
    description: "rotations, reflections and wrapping slides — the widest grammar in which every operation is always applicable",
    operations: [...dihedralOperations(), ...wrappingTranslations()],
  },
  {
    name: "all-spatial",
    description: "rotations, reflections, wrapping slides and clipping slides — the full same-aspect grammar the plan describes",
    operations: [...dihedralOperations(), ...wrappingTranslations(), ...clippingTranslations()],
  },
];

/** The configuration the headline verdict is taken from. */
const PRIMARY_CONFIGURATION = "all-spatial";
const PRIMARY_ORDER: CompositionOrder = "columnOuter";

/**
 * `applySceneUnary` validates its output with zod on every call, and the oracle
 * applies the whole grammar to every draw. Caching by (scene, operation) keeps
 * the sweep to a few seconds without changing a single result.
 */
const applicationCache = new Map<string, Scene | null>();

function apply(input: Scene, operation: SceneUnaryOperation): Scene | null {
  const key = `${sceneSignature(input)}|${operationKey(operation)}`;
  const cached = applicationCache.get(key);
  if (cached !== undefined) return cached;
  const result = applySceneUnary(input, operation);
  applicationCache.set(key, result);
  return result;
}

/**
 * The operations that carry the top-left cell to cell (row, column), in the
 * order they are applied, under the declared composition convention.
 */
function compositionWord(
  rowOperation: SceneUnaryOperation,
  columnOperation: SceneUnaryOperation,
  row: number,
  column: number,
  order: CompositionOrder,
): SceneUnaryOperation[] {
  const rowSteps = Array.from({ length: column }, () => rowOperation);
  const columnSteps = Array.from({ length: row }, () => columnOperation);
  if (order === "columnOuter") return [...rowSteps, ...columnSteps];
  if (order === "rowOuter") return [...columnSteps, ...rowSteps];
  const word: SceneUnaryOperation[] = [];
  let remainingRowSteps = column;
  let remainingColumnSteps = row;
  let takeRowStep = order === "staircaseRowFirst";
  while (remainingRowSteps > 0 || remainingColumnSteps > 0) {
    if (takeRowStep && remainingRowSteps > 0) {
      word.push(rowOperation);
      remainingRowSteps -= 1;
    } else if (!takeRowStep && remainingColumnSteps > 0) {
      word.push(columnOperation);
      remainingColumnSteps -= 1;
    }
    takeRowStep = !takeRowStep;
  }
  return word;
}

/**
 * Build one cell of the grid under the declared composition order. Returns null
 * when any step of the composition is inapplicable on this board.
 */
function buildCell(
  base: Scene,
  rowOperation: SceneUnaryOperation,
  columnOperation: SceneUnaryOperation,
  row: number,
  column: number,
  order: CompositionOrder,
): Scene | null {
  let current: Scene | null = base;
  for (const operation of compositionWord(rowOperation, columnOperation, row, column, order)) {
    if (!current) return null;
    current = apply(current, operation);
  }
  return current;
}

/** All nine cells in reading order, or null if the program does not complete. */
function buildGrid(
  base: Scene,
  rowOperation: SceneUnaryOperation,
  columnOperation: SceneUnaryOperation,
  order: CompositionOrder,
): (Scene | null)[] {
  const cells: (Scene | null)[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      cells.push(buildCell(base, rowOperation, columnOperation, row, column, order));
    }
  }
  return cells;
}

function randomBase(rng: Rng): Scene {
  const positions: { row: number; column: number }[] = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let column = 0; column < BOARD_COLUMNS; column++) positions.push({ row, column });
  }
  const chosenPositions = shuffled(rng, positions).slice(0, TOKENS_PER_SCENE);
  const chosenShapes = shuffled(rng, TOKEN_SHAPES).slice(0, TOKENS_PER_SCENE);
  return scene(chosenPositions.map((position, index) => ({
    ...position,
    object: token(chosenShapes[index]),
  })));
}

interface OrderedPair {
  readonly rowOperation: SceneUnaryOperation;
  readonly columnOperation: SceneUnaryOperation;
  readonly fingerprint: string;
}

function orderedPairs(operations: readonly SceneUnaryOperation[]): OrderedPair[] {
  const pairs: OrderedPair[] = [];
  for (const rowOperation of operations) {
    for (const columnOperation of operations) {
      if (operationKey(rowOperation) === operationKey(columnOperation)) continue;
      pairs.push({
        rowOperation,
        columnOperation,
        fingerprint: JSON.stringify({ R: rowOperation, C: columnOperation }),
      });
    }
  }
  return pairs;
}

/**
 * Does this pair fail to commute somewhere on the board? Reported per grammar so
 * the verdict can be read against the redesign's central claim.
 */
function pairFailsToCommute(pair: OrderedPair, probes: readonly Scene[]): boolean {
  return probes.some((probe) => {
    const rowThenColumn = apply(apply(probe, pair.rowOperation) ?? probe, pair.columnOperation);
    const columnThenRow = apply(apply(probe, pair.columnOperation) ?? probe, pair.rowOperation);
    const rowFirst = apply(probe, pair.rowOperation);
    const columnFirst = apply(probe, pair.columnOperation);
    if (!rowFirst || !columnFirst || !rowThenColumn || !columnThenRow) return false;
    return sceneSignature(rowThenColumn) !== sceneSignature(columnThenRow);
  });
}

type RejectionReason =
  | "incompleteGrid"
  | "repeatedCell"
  | "ambiguousOracle"
  | "rowShortcutAnswersIt"
  | "columnShortcutAnswersIt"
  | "tooFewNearMisses";

interface DrawOutcome {
  readonly accepted: boolean;
  readonly reason: RejectionReason | null;
  readonly fingerprint: string;
  /** True when everything except the necessity check passed. */
  readonly wellPosedAndVaried: boolean;
  readonly rowShortcutAnswersIt: boolean;
  readonly columnShortcutAnswersIt: boolean;
  readonly nearMissCount: number;
  readonly legibleNearMissCount: number;
  readonly survivorCount: number;
}

function evaluateDraw(
  base: Scene,
  pair: OrderedPair,
  grammar: readonly OrderedPair[],
  order: CompositionOrder,
): DrawOutcome {
  const empty = {
    fingerprint: pair.fingerprint,
    wellPosedAndVaried: false,
    rowShortcutAnswersIt: false,
    columnShortcutAnswersIt: false,
    nearMissCount: 0,
    legibleNearMissCount: 0,
    survivorCount: 0,
  };

  // 1. Build: every cell must exist and no two cells may look the same.
  const cells = buildGrid(base, pair.rowOperation, pair.columnOperation, order);
  if (cells.some((cell) => cell === null)) {
    return { accepted: false, reason: "incompleteGrid", ...empty };
  }
  const built = cells as Scene[];
  const signatures = built.map(sceneSignature);
  if (new Set(signatures).size !== signatures.length) {
    return { accepted: false, reason: "repeatedCell", ...empty };
  }
  const answer = built[ANSWER_INDEX];
  const answerSignature = signatures[ANSWER_INDEX];

  // 2. Oracle: every grammar pair that reproduces the eight visible cells must
  //    agree on the hidden one. The drawn pair is always among the survivors.
  const survivors: OrderedPair[] = [];
  const nonSurvivorPredictions: Scene[] = [];
  for (const candidate of grammar) {
    const candidateCells = buildGrid(base, candidate.rowOperation, candidate.columnOperation, order);
    const reproducesVisible = candidateCells.every((cell, index) =>
      index === ANSWER_INDEX || (cell !== null && sceneSignature(cell) === signatures[index]));
    if (reproducesVisible) {
      survivors.push(candidate);
    } else {
      const prediction = candidateCells[ANSWER_INDEX];
      if (prediction) nonSurvivorPredictions.push(prediction);
    }
  }
  const survivorPredictions = new Set(survivors.map((candidate) => {
    const prediction = buildGrid(base, candidate.rowOperation, candidate.columnOperation, order)[ANSWER_INDEX];
    return prediction ? sceneSignature(prediction) : "unbuildable";
  }));
  if (survivorPredictions.size !== 1 || !survivorPredictions.has(answerSignature)) {
    return { accepted: false, reason: "ambiguousOracle", ...empty, survivorCount: survivors.length };
  }

  // 3. Necessity: neither single-rule shortcut may land on the answer. A null
  //    prediction counts as differing — a solver who applies that rule alone
  //    gets nothing rather than the answer.
  const rowShortcut = apply(built[LEFT_NEIGHBOUR_INDEX], pair.rowOperation);
  const columnShortcut = apply(built[TOP_NEIGHBOUR_INDEX], pair.columnOperation);
  const rowShortcutAnswersIt = rowShortcut !== null && sceneSignature(rowShortcut) === answerSignature;
  const columnShortcutAnswersIt = columnShortcut !== null && sceneSignature(columnShortcut) === answerSignature;

  // 4. Near misses: the two shortcut predictions plus what every rejected pair
  //    would have predicted, minus the answer, deduplicated by signature.
  const nearMisses = new Map<string, Scene>();
  for (const candidate of [rowShortcut, columnShortcut, ...nonSurvivorPredictions]) {
    if (!candidate) continue;
    const signature = sceneSignature(candidate);
    if (signature === answerSignature) continue;
    nearMisses.set(signature, candidate);
  }
  const legibleNearMisses = [...nearMisses.values()]
    .filter((candidate) => areScenesCategoricallyDistinct(candidate, answer));

  const stats = {
    fingerprint: pair.fingerprint,
    rowShortcutAnswersIt,
    columnShortcutAnswersIt,
    nearMissCount: nearMisses.size,
    legibleNearMissCount: legibleNearMisses.length,
    survivorCount: survivors.length,
    wellPosedAndVaried: nearMisses.size >= DISTRACTORS_PER_ITEM,
  };

  if (rowShortcutAnswersIt) return { accepted: false, reason: "rowShortcutAnswersIt", ...stats };
  if (columnShortcutAnswersIt) return { accepted: false, reason: "columnShortcutAnswersIt", ...stats };
  if (nearMisses.size < DISTRACTORS_PER_ITEM) {
    return { accepted: false, reason: "tooFewNearMisses", ...stats };
  }
  return { accepted: true, reason: null, ...stats };
}

interface RunReport {
  readonly grammar: string;
  readonly compositionOrder: CompositionOrder;
  readonly operationCount: number;
  readonly orderedPairCount: number;
  readonly nonCommutingPairCount: number;
  readonly drawsAttempted: number;
  readonly drawsAccepted: number;
  readonly acceptanceRate: number;
  readonly distinctAcceptedFingerprints: number;
  readonly rejections: Record<RejectionReason, number>;
  readonly rowShortcutAnsweredIt: number;
  readonly columnShortcutAnsweredIt: number;
  readonly bothShortcutsFailed: number;
  readonly wellPosedDraws: number;
  readonly wellPosedFingerprints: number;
  readonly medianNearMisses: number;
  readonly minimumLegibleNearMisses: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function runConfiguration(
  configuration: GrammarConfiguration,
  order: CompositionOrder,
): RunReport {
  const grammar = orderedPairs(configuration.operations);
  const commutationProbes = [0, 1, 2, 3].map((index) => randomBase(seededRng(`commutation-probe:${index}`)));
  const nonCommutingPairCount = grammar
    .filter((candidate) => pairFailsToCommute(candidate, commutationProbes)).length;

  const rejections: Record<RejectionReason, number> = {
    incompleteGrid: 0,
    repeatedCell: 0,
    ambiguousOracle: 0,
    rowShortcutAnswersIt: 0,
    columnShortcutAnswersIt: 0,
    tooFewNearMisses: 0,
  };
  const acceptedFingerprints = new Set<string>();
  const wellPosedFingerprints = new Set<string>();
  const nearMissCounts: number[] = [];
  let legibleFloor = Number.POSITIVE_INFINITY;
  let accepted = 0;
  let rowShortcutAnsweredIt = 0;
  let columnShortcutAnsweredIt = 0;
  let bothShortcutsFailed = 0;
  let wellPosedDraws = 0;

  for (let seedIndex = 0; seedIndex < PROOF_SEEDS; seedIndex++) {
    const rng = seededRng(`dual-constraint:${configuration.name}:${order}:${seedIndex}`);
    const base = randomBase(rng);
    const pair = pick(rng, grammar);
    const outcome = evaluateDraw(base, pair, grammar, order);

    if (outcome.reason) rejections[outcome.reason] += 1;
    if (outcome.accepted) {
      accepted += 1;
      acceptedFingerprints.add(outcome.fingerprint);
    }
    if (outcome.rowShortcutAnswersIt) rowShortcutAnsweredIt += 1;
    if (outcome.columnShortcutAnswersIt) columnShortcutAnsweredIt += 1;
    if (outcome.wellPosedAndVaried) {
      wellPosedDraws += 1;
      wellPosedFingerprints.add(outcome.fingerprint);
      nearMissCounts.push(outcome.nearMissCount);
      legibleFloor = Math.min(legibleFloor, outcome.legibleNearMissCount);
      if (!outcome.rowShortcutAnswersIt && !outcome.columnShortcutAnswersIt) bothShortcutsFailed += 1;
    }
  }

  return {
    grammar: configuration.name,
    compositionOrder: order,
    operationCount: configuration.operations.length,
    orderedPairCount: grammar.length,
    nonCommutingPairCount,
    drawsAttempted: PROOF_SEEDS,
    drawsAccepted: accepted,
    acceptanceRate: accepted / PROOF_SEEDS,
    distinctAcceptedFingerprints: acceptedFingerprints.size,
    rejections,
    rowShortcutAnsweredIt,
    columnShortcutAnsweredIt,
    bothShortcutsFailed,
    wellPosedDraws,
    wellPosedFingerprints: wellPosedFingerprints.size,
    medianNearMisses: median(nearMissCounts),
    minimumLegibleNearMisses: Number.isFinite(legibleFloor) ? legibleFloor : 0,
  };
}

/**
 * The decisive check, run exhaustively rather than by sampling.
 *
 * Whatever the composition convention, the path from the top-left cell to the
 * answer cell (2, 2) ends with either a row step or a column step, and the cell
 * it steps from is cell(2, 1) or cell(1, 2) — both of them visible. So the answer
 * is one operation away from a visible neighbour by construction, and one of the
 * two single-rule shortcuts must land on it exactly.
 *
 * This sweeps every ordered pair in the widest grammar against many bases and
 * reports how many complete grids escape BOTH shortcuts. The necessity check the
 * plan requires can only pass on such a grid, so if this count is zero the
 * mechanism cannot be fixed by choosing different operations.
 */
const EXHAUSTIVE_BASE_COUNT = 16;

function exhaustiveShortcutSweep(order: CompositionOrder): {
  compositionOrder: CompositionOrder;
  gridsBuilt: number;
  gridsCompleteAndVaried: number;
  rowShortcutExact: number;
  columnShortcutExact: number;
  gridsEscapingBothShortcuts: number;
} {
  const configuration = GRAMMAR_CONFIGURATIONS.find((entry) => entry.name === PRIMARY_CONFIGURATION);
  if (!configuration) throw new Error(`unknown primary configuration ${PRIMARY_CONFIGURATION}`);
  const grammar = orderedPairs(configuration.operations);
  const bases = Array.from({ length: EXHAUSTIVE_BASE_COUNT }, (_, index) =>
    randomBase(seededRng(`exhaustive-base:${index}`)));

  let gridsBuilt = 0;
  let complete = 0;
  let rowShortcutExact = 0;
  let columnShortcutExact = 0;
  let escaping = 0;

  for (const base of bases) {
    for (const pair of grammar) {
      gridsBuilt += 1;
      const cells = buildGrid(base, pair.rowOperation, pair.columnOperation, order);
      if (cells.some((cell) => cell === null)) continue;
      const built = cells as Scene[];
      const signatures = built.map(sceneSignature);
      if (new Set(signatures).size !== signatures.length) continue;
      complete += 1;
      const answerSignature = signatures[ANSWER_INDEX];
      const rowShortcut = apply(built[LEFT_NEIGHBOUR_INDEX], pair.rowOperation);
      const columnShortcut = apply(built[TOP_NEIGHBOUR_INDEX], pair.columnOperation);
      const rowExact = rowShortcut !== null && sceneSignature(rowShortcut) === answerSignature;
      const columnExact = columnShortcut !== null && sceneSignature(columnShortcut) === answerSignature;
      if (rowExact) rowShortcutExact += 1;
      if (columnExact) columnShortcutExact += 1;
      if (!rowExact && !columnExact) escaping += 1;
    }
  }

  return {
    compositionOrder: order,
    gridsBuilt,
    gridsCompleteAndVaried: complete,
    rowShortcutExact,
    columnShortcutExact,
    gridsEscapingBothShortcuts: escaping,
  };
}

function main(): void {
  const startedAt = performance.now();
  const sweep: RunReport[] = [];
  for (const configuration of GRAMMAR_CONFIGURATIONS) {
    for (const order of COMPOSITION_ORDERS) sweep.push(runConfiguration(configuration, order));
  }

  const primary = sweep.find((report) =>
    report.grammar === PRIMARY_CONFIGURATION && report.compositionOrder === PRIMARY_ORDER)!;

  const failures: string[] = [];
  if (primary.distinctAcceptedFingerprints < MIN_DISTINCT_PROGRAM_FINGERPRINTS) {
    failures.push(
      `program variety: ${primary.distinctAcceptedFingerprints} distinct accepted (R, C) fingerprints, ` +
      `needed at least ${MIN_DISTINCT_PROGRAM_FINGERPRINTS}`,
    );
  }
  if (primary.acceptanceRate < MIN_ACCEPTANCE_RATE) {
    failures.push(
      `acceptance rate: ${(primary.acceptanceRate * 100).toFixed(1)}% of draws accepted, ` +
      `needed at least ${(MIN_ACCEPTANCE_RATE * 100).toFixed(0)}%`,
    );
  }
  const bestElsewhere = sweep
    .filter((report) => report !== primary)
    .filter((report) => report.drawsAccepted > 0);

  const report = {
    family: "dual-constraint-matrix-v1 (proposed)",
    plan: "docs/plans/escalate-the-quiz.md, Phase 4",
    board: `${BOARD_ROWS}x${BOARD_COLUMNS}, ${TOKENS_PER_SCENE} tokens of distinct shapes`,
    seedsPerConfiguration: PROOF_SEEDS,
    criteria: {
      minimumDistinctProgramFingerprints: MIN_DISTINCT_PROGRAM_FINGERPRINTS,
      minimumAcceptanceRate: MIN_ACCEPTANCE_RATE,
      minimumNearMisses: DISTRACTORS_PER_ITEM,
      necessity: "both the row-only and the column-only neighbour prediction must differ from the answer",
    },
    primary,
    sweep,
    exhaustiveShortcutSweep: COMPOSITION_ORDERS.map(exhaustiveShortcutSweep),
    configurationsWithAnyAcceptedDraw: bestElsewhere.map((entry) =>
      `${entry.grammar}/${entry.compositionOrder}: ${entry.drawsAccepted}`),
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("");
  for (const configuration of GRAMMAR_CONFIGURATIONS) {
    console.log(`grammar ${configuration.name}: ${configuration.description}`);
  }
  console.log("");
  if (failures.length === 0) {
    console.log(
      `VERDICT: PASS — ${PRIMARY_CONFIGURATION}/${PRIMARY_ORDER} accepted ` +
      `${primary.drawsAccepted}/${primary.drawsAttempted} draws ` +
      `(${(primary.acceptanceRate * 100).toFixed(1)}%) across ` +
      `${primary.distinctAcceptedFingerprints} distinct programs.`,
    );
    return;
  }
  console.log(`VERDICT: FAIL — ${failures.join("; ")}.`);
  process.exitCode = 1;
}

main();
