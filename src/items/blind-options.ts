import type { Scene, SceneObject, ScenePlacement, SceneToken } from "./schema";
import {
  canonicalizeForDistance,
  canonicalSceneDistance,
  type DistanceCanonical,
  type SceneDistance,
} from "./scene-distance";

/**
 * Options-only ("blind") solvers: three ways to pick an answer that never look
 * at the question, only at the six options as served.
 *
 * Found in the review of 2026-09-28 (docs/plans/blind-answer-leak.md): every
 * wrong option was built as one mistake away from the answer, and selection
 * made sure some wrong option agreed with the answer on every aspect. Together
 * those put the answer at the centre of a star — the most common value on every
 * aspect, and the option nearest to all the others — so these solvers picked
 * it about 60% of the time against a chance rate of 1 in 6.
 *
 * The same module serves the build gate (`scripts/scene-family-verify.ts`), a
 * fast test, and `selectDistractors`, which scores its candidate option lists
 * with exactly these solvers (`blindPairTerms`) and plays against exactly the
 * strategies of `blindStrategyCredits`. A gate that measured one thing while
 * the generator balanced another would pass without proving anything.
 */

/**
 * The aspects a solver can infer one at a time.
 *
 * The owner's report of 2026-08-27: "the answers are so different from each
 * other, and using only one first inference you can select the right answer
 * without looking at the other rules." Closeness ranking alone cannot fix that:
 * a board can sit close to the answer overall and still be the only one with
 * the answer's exact footprint. What stops it is agreement — for every aspect
 * below, at least one wrong option matches the answer on it.
 *
 * Agreement alone overshoots (see above): it made the answer the majority on
 * every aspect. The fix is not a mirror ban — a "never" on any rank is itself
 * a signal — but spreading the answer's rank evenly on every measure these
 * aspects feed (`blindStrategyCredits`, `selectDistractors`). Since 2026-09-30
 * agreement itself is no longer a hard rule either: as a rule it fed a solver
 * that rules out every option alone in its value of some aspect (42.9% on
 * `relational-matrix-d4`), so being alone on an aspect, and being ruled out
 * for it, are two more strategies the mix balances (the owner's decision of
 * 2026-09-29).
 */
export const DISTRACTOR_ASPECTS: readonly { readonly name: string; readonly of: (scene: Scene) => string }[] = [
  { name: "positions", of: (scene) => sceneAspectKey(scene, (placement) => `${placement.row},${placement.column}`) },
  { name: "shapes", of: (scene) => sceneAspectKey(scene, (placement) => tokenOf(placement)?.shape ?? "-") },
  { name: "fills", of: (scene) => sceneAspectKey(scene, (placement) => tokenOf(placement)?.fill ?? "-") },
  { name: "rotations", of: (scene) => sceneAspectKey(scene, (placement) => String(tokenOf(placement)?.rotation ?? 0)) },
  { name: "count", of: (scene) => String(scene.objects.length) },
];

function tokenOf(placement: ScenePlacement): SceneToken | null {
  return placement.object.kind === "token" ? placement.object : null;
}

/** An order-free fingerprint of one aspect, so two boards agree on it or do not. */
function sceneAspectKey(scene: Scene, read: (placement: ScenePlacement) => string): string {
  return [...scene.objects].map(read).sort().join("|");
}

export const BLIND_SOLVERS = ["most-typical", "aspect-majority", "cell-majority"] as const;
export type BlindSolver = (typeof BLIND_SOLVERS)[number];

/**
 * What "incomparable" (boards of different sizes) costs the most-typical
 * solver. Larger than any finite distance a 3x3 board can reach.
 */
const INCOMPARABLE_DISTANCE = 1_000_000;

/** `sceneEditDistance` flattened to one number: positions dominate atoms. */
function flatten(distance: SceneDistance): number {
  return distance === "incomparable" ? INCOMPARABLE_DISTANCE : distance.positions * 1000 + distance.atoms;
}

function tokenKey(token: SceneToken): string {
  return `${token.shape}/${token.rotation}/${token.fill}/${token.size}`;
}

function objectKey(object: SceneObject): string {
  return object.kind === "token"
    ? `token:${tokenKey(object)}`
    : `container:${object.shape}:[${object.contents.map(tokenKey).join(",")}]`;
}

/**
 * What stands in every cell of one board, written the same way however the
 * board was built, plus one pseudo-cell for the crease guides. Key order in
 * the source objects never matters.
 */
function cellContents(scene: Scene): Map<string, string> {
  const cells = new Map<string, string>();
  for (let row = 0; row < scene.rows; row++) {
    for (let column = 0; column < scene.columns; column++) cells.set(`${row}:${column}`, "empty");
  }
  for (const placement of scene.objects) {
    const key = `${placement.row}:${placement.column}`;
    cells.set(key, cells.get(key) === "empty" ? objectKey(placement.object) : `${cells.get(key)}+${objectKey(placement.object)}`);
  }
  for (const tile of scene.tiles) {
    const key = `${tile.row}:${tile.column}`;
    const edges = `tile:${[...tile.edges].sort().join(",")}`;
    cells.set(key, cells.get(key) === "empty" ? edges : `${cells.get(key)}+${edges}`);
  }
  cells.set("guides", (scene.guides ?? []).map((guide) => `${guide.axis}:${guide.direction}`).sort().join("|"));
  return cells;
}

/**
 * Everything the three solvers read about one PAIR of options. Every solver
 * score is a sum of these over the other options, which is what lets
 * `selectDistractors` score thousands of candidate lists cheaply.
 */
export interface BlindPairTerms {
  /** Flattened edit distance; smaller is more alike. */
  distance: number;
  /** How many `DISTRACTOR_ASPECTS` the two boards share. */
  aspects: number;
  /** How many cells (and the guide pseudo-cell) hold the same content on both. */
  cells: number;
}

/** A reusable reader: aspect keys and cell contents are computed once per board. */
export interface BlindBoard {
  scene: Scene;
  aspectKeys: readonly string[];
  cells: ReadonlyMap<string, string>;
  dimensions: string;
  distance: DistanceCanonical;
}

export function blindBoard(scene: Scene): BlindBoard {
  return {
    scene,
    aspectKeys: DISTRACTOR_ASPECTS.map((aspect) => aspect.of(scene)),
    cells: cellContents(scene),
    dimensions: `${scene.rows}x${scene.columns}`,
    distance: canonicalizeForDistance(scene),
  };
}

export function blindPairTerms(left: BlindBoard, right: BlindBoard): BlindPairTerms {
  let aspects = 0;
  left.aspectKeys.forEach((key, index) => { if (key === right.aspectKeys[index]) aspects += 1; });
  let cells = 0;
  if (left.dimensions === right.dimensions) {
    for (const [key, value] of left.cells) if (right.cells.get(key) === value) cells += 1;
  }
  return { distance: flatten(canonicalSceneDistance(left.distance, right.distance)), aspects, cells };
}

/**
 * Each solver's score for every option; the solver picks the highest.
 *
 *  - most typical: the smallest total edit distance to the other options
 *    (scored as its negative, so higher is still "more likely");
 *  - aspect majority: for each aspect, how many other options share this
 *    option's value, summed over the aspects;
 *  - cell majority: the same count, cell by cell.
 */
export function blindSolverScores(options: readonly Scene[]): Record<BlindSolver, number[]> {
  const boards = options.map(blindBoard);
  const scores: Record<BlindSolver, number[]> = {
    "most-typical": boards.map(() => 0),
    "aspect-majority": boards.map(() => 0),
    "cell-majority": boards.map(() => 0),
  };
  for (let left = 0; left < boards.length; left++) {
    for (let right = left + 1; right < boards.length; right++) {
      const terms = blindPairTerms(boards[left], boards[right]);
      for (const index of [left, right]) {
        scores["most-typical"][index] -= terms.distance;
        scores["aspect-majority"][index] += terms.aspects;
        scores["cell-majority"][index] += terms.cells;
      }
    }
  }
  return scores;
}

/**
 * The ranks one option's tie group spans on a score list, 1 being the top
 * score. An option alone at the top is `{ lo: 1, hi: 1 }`; three options
 * sharing the second-best score are each `{ lo: 2, hi: 4 }`.
 */
export interface RankGroup {
  lo: number;
  hi: number;
}

export function rankGroup(scores: readonly number[], index: number): RankGroup {
  let above = 0;
  let level = 0;
  for (const score of scores) {
    if (score > scores[index]) above += 1;
    else if (score === scores[index]) level += 1;
  }
  return { lo: above + 1, hi: above + level };
}

/** Every option's rank, a tie group sharing the mean of the ranks it spans. */
export function midRanks(scores: readonly number[]): number[] {
  return scores.map((_, index) => {
    const { lo, hi } = rankGroup(scores, index);
    return (lo + hi) / 2;
  });
}

/**
 * The credit of a solver that picks the option at `rank` (1 = top score): 1
 * when the answer alone holds that rank, 1/k when the answer is one of k tied
 * options whose group spans it (ties broken at random), and 0 otherwise.
 * Summed over the ranks it is always exactly 1.
 */
export function rankCredit(scores: readonly number[], answerIndex: number, rank: number): number {
  const { lo, hi } = rankGroup(scores, answerIndex);
  return rank >= lo && rank <= hi ? 1 / (hi - lo + 1) : 0;
}

/**
 * The credit a solver earns on one item: 1 when the answer alone has the top
 * score, 1/k when it shares the top with k - 1 others (a fair tie-break), and 0
 * otherwise.
 */
export function topCredit(scores: readonly number[], answerIndex: number): number {
  return rankCredit(scores, answerIndex, 1);
}

/** The mirror image: the credit of a solver that picks the LOWEST score. */
export function bottomCredit(scores: readonly number[], answerIndex: number): number {
  return rankCredit(scores, answerIndex, scores.length);
}

/**
 * The three solvers plus their composite, each option's mean rank across the
 * three. Every measure is a score list, higher meaning nearer the top.
 */
export const BLIND_MEASURES = [...BLIND_SOLVERS, "composite"] as const;
export type BlindMeasure = (typeof BLIND_MEASURES)[number];

/**
 * The composite measure, from the three solvers' scores: minus the sum of each
 * option's mid-ranks, so the option ranked highest overall scores highest. A
 * sum of half-integers is exact, so ties are real ties.
 */
export function compositeScores(scores: Readonly<Record<BlindSolver, readonly number[]>>): number[] {
  const ranks = BLIND_SOLVERS.map((solver) => midRanks(scores[solver]));
  return scores[BLIND_SOLVERS[0]].map((_, index) => -ranks.reduce((sum, solverRanks) => sum + solverRanks[index], 0));
}

/**
 * The rank-reading strategies the gate holds every served bucket to.
 *
 * The first gate (2026-09-29) asked only that no solver's TOP pick be the
 * answer too often. Selection met it by keeping the answer off the top, which
 * moved the leak rather than closing it: a review the same day found the answer
 * piled into the middle ranks, picked 36% to 52% of the time by a solver that
 * takes the option whose ranks sit closest to the middle. A "never" on any rank
 * is itself a signal. What a blind guess worth 1 in 6 needs is that the
 * answer's rank on every measure be spread evenly over 1 to 6, so the gate
 * reads every rank, not only the top:
 *
 *  - `<measure>@<rank>`: pick the option at that rank on that measure, for each
 *    of the three solvers and their composite, and each rank 1 to 6;
 *  - `middle-rank`: pick the option whose three solver ranks sit closest to the
 *    middle (the review's own attack);
 *  - `exclude-extremes`: rule out every option alone at the top or the bottom of
 *    some solver, and guess among the rest;
 *  - `lone-aspect`: pick an option that is alone in its value of some aspect
 *    (the owner's "one first inference" of 2026-08-27), guessing among the lone
 *    ones, or among all six when none is alone;
 *  - `exclude-lone-aspect`: rule those out instead, and guess among the rest —
 *    the strategy the old agreement rule fed, gated since 2026-09-30.
 */
export function blindStrategyCredits(options: readonly Scene[], answerIndex: number): Record<string, number> {
  const scores = blindSolverScores(options);
  const measures: Record<BlindMeasure, readonly number[]> = { ...scores, composite: compositeScores(scores) };
  const credits: Record<string, number> = {};
  for (const measure of BLIND_MEASURES) {
    for (let rank = 1; rank <= options.length; rank++) {
      credits[`${measure}@${rank}`] = rankCredit(measures[measure], answerIndex, rank);
    }
  }
  const middle = (options.length + 1) / 2;
  const ranks = BLIND_SOLVERS.map((solver) => midRanks(scores[solver]));
  const middleness = options.map((_, index) => -ranks.reduce((sum, solverRanks) => sum + Math.abs(solverRanks[index] - middle), 0));
  credits["middle-rank"] = topCredit(middleness, answerIndex);
  const excluded = new Set<number>();
  for (const solver of BLIND_SOLVERS) {
    for (const rank of [1, options.length]) {
      const alone = options.flatMap((_, index) => {
        const group = rankGroup(scores[solver], index);
        return group.lo === rank && group.hi === rank ? [index] : [];
      });
      for (const index of alone) excluded.add(index);
    }
  }
  credits["exclude-extremes"] = excludedGuessCredit(options.length, excluded, answerIndex);
  const lone = loneAspectOptions(options);
  credits["lone-aspect"] = includedGuessCredit(options.length, lone, answerIndex);
  credits["exclude-lone-aspect"] = excludedGuessCredit(options.length, lone, answerIndex);
  return credits;
}

/** A guess among the options not excluded; among all of them if every one was. */
function excludedGuessCredit(optionCount: number, excluded: ReadonlySet<number>, answerIndex: number): number {
  if (excluded.size >= optionCount) return 1 / optionCount;
  return excluded.has(answerIndex) ? 0 : 1 / (optionCount - excluded.size);
}

/** A guess among the options picked out; among all of them if none was. */
function includedGuessCredit(optionCount: number, included: ReadonlySet<number>, answerIndex: number): number {
  if (included.size === 0) return 1 / optionCount;
  return included.has(answerIndex) ? 1 / included.size : 0;
}

/** The options alone in their value of some aspect: what one inference picks out. */
function loneAspectOptions(options: readonly Scene[]): Set<number> {
  const lone = new Set<number>();
  for (const aspect of DISTRACTOR_ASPECTS) {
    const values = options.map((option) => aspect.of(option));
    values.forEach((value, index) => {
      if (values.filter((other) => other === value).length === 1) lone.add(index);
    });
  }
  return lone;
}

/**
 * One clue: a single fact about a board that one part of a rule can tell a
 * solver on its own. The owner's rule of 2026-10-03: the answer must never be
 * guessable "with 1 out of x clues needed to solve a test", so every clue any
 * option shows is held by at least two options (`optionsAloneOnAClue`).
 * Holding it for every option, not only the answer, is what keeps the answer
 * from standing out as the one option that is never alone.
 *
 * What counts as one clue depends on how the family's rule acts on a board
 * (`ClueModel`):
 *
 *  - `features`, for rules made of separate changes (a move, a fill step, a
 *    turn, a copy): each whole-board aspect (`DISTRACTOR_ASPECTS`: where the
 *    shapes stand, which shapes, which fills, which turns, how many), and the
 *    square, fill and turn of every shape that each option holds exactly once
 *    ("the triangle ends up black"). A shape that some option lacks or holds
 *    twice is itself something the rule decides, so a fact about it would
 *    already need the shape clue too; the shapes aspect covers it. What
 *    stands on one square is not a clue here: it usually takes every change
 *    to know.
 *  - `squares`, for rules that combine two boards square by square: what
 *    stands on each square. There a solver works out one square at a time,
 *    and the whole-board aspects need every square at once.
 */
export const CLUE_MODELS = ["features", "squares"] as const;
export type ClueModel = (typeof CLUE_MODELS)[number];

export interface ClueBoard {
  /** One value per clue every board has: the aspects, or the squares. */
  fixed: readonly string[];
  /** Square, fill and turn of each shape the board holds exactly once (`features` only). */
  once: ReadonlyMap<string, readonly [string, string, string]>;
}

export const SHAPE_CLUE_PARTS = ["square", "fill", "turn"] as const;

export function clueBoard(scene: Scene, model: ClueModel): ClueBoard {
  if (model === "squares") {
    const fixed: string[] = [];
    const cells = cellContents(scene);
    for (let row = 0; row < scene.rows; row++) {
      for (let column = 0; column < scene.columns; column++) fixed.push(cells.get(`${row}:${column}`)!);
    }
    return { fixed, once: new Map() };
  }
  const held = new Map<string, ScenePlacement[]>();
  for (const placement of scene.objects) {
    const token = tokenOf(placement);
    if (token) held.set(token.shape, [...(held.get(token.shape) ?? []), placement]);
  }
  const once = new Map<string, readonly [string, string, string]>();
  for (const [shape, placements] of held) {
    if (placements.length !== 1) continue;
    const [placement] = placements;
    const token = tokenOf(placement)!;
    once.set(shape, [`${placement.row},${placement.column}`, token.fill, String(token.rotation)]);
  }
  return { fixed: DISTRACTOR_ASPECTS.map((aspect) => aspect.of(scene)), once };
}

/** The shapes every board holds exactly once: the ones a solver can follow by shape. */
export function followedShapes(boards: readonly ClueBoard[]): string[] {
  return [...(boards[0]?.once.keys() ?? [])].filter((shape) => boards.every((board) => board.once.has(shape)));
}

/**
 * The options that hold some clue no other option holds. Empty means one clue
 * never narrows the six to one, whichever option is the answer.
 */
export function optionsAloneOnAClue(options: readonly Scene[], model: ClueModel): Set<number> {
  const boards = options.map((option) => clueBoard(option, model));
  const alone = new Set<number>();
  const markAlone = (read: (board: ClueBoard) => string | undefined) => {
    const values = boards.map(read);
    values.forEach((value, index) => {
      if (values.filter((other) => other === value).length === 1) alone.add(index);
    });
  };
  const fixedCount = Math.max(...boards.map((board) => board.fixed.length));
  for (let clue = 0; clue < fixedCount; clue++) markAlone((board) => board.fixed[clue]);
  for (const shape of followedShapes(boards)) {
    SHAPE_CLUE_PARTS.forEach((_, part) => markAlone((board) => board.once.get(shape)![part]));
  }
  return alone;
}

/** Each solver's credit on one item, read from the options exactly as given. */
export function blindCredits(options: readonly Scene[], answerIndex: number): Record<BlindSolver, number> {
  const scores = blindSolverScores(options);
  return {
    "most-typical": topCredit(scores["most-typical"], answerIndex),
    "aspect-majority": topCredit(scores["aspect-majority"], answerIndex),
    "cell-majority": topCredit(scores["cell-majority"], answerIndex),
  };
}
