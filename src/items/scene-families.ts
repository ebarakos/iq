import { createHash } from "node:crypto";
import { pick, shuffled, type Rng } from "../lib/rng";
import {
  areScenesCategoricallyDistinct,
  DISTRACTORS_PER_ITEM,
  FILL_LOOP,
  OPTIONS_PER_ITEM,
  PuzzleSchema,
  SceneSchema,
  sceneSignature,
  type Puzzle,
  type Scene,
  type SceneObject,
  type SceneToken,
} from "./schema";
import {
  acceptFamilyCandidate,
  type AcceptanceResult,
  type DistractorWitness,
  type FamilyDefinition,
  type ValidationReport,
} from "./family";
import {
  applySceneBinary,
  applySceneCompositionPrimitive,
  applySceneUnary,
  enumerateSceneOrderedCompositions,
  enumerateSceneOrderedThreeStepCompositions,
  isSceneComposedProgram,
  partialSceneExecutions,
  SCENE_BINARY_OPERATIONS,
  sceneComposedPrimitives,
  sceneComposedProgramFromSteps,
  sceneComposedProgramKey,
  sceneComposedProgramSteps,
  type SceneBinaryOperation,
  type SceneComposedProgram,
  type SceneComposedProgramLength,
  type SceneCompositionPrimitive,
  type ScenePosition,
  type SceneUnaryOperation,
} from "./scene-grammar";
import { rankByCloseness } from "./scene-distance";
import { boardKey, conditionalMovementReadings, machineDistractorsWithoutSecondReadings, machineWorkedRowReadings, machineWorkedRowsAgreeOnQuery, setAlgebraPredictions } from "./worked-row-readings";
import {
  BLIND_MEASURES,
  MAXIMUM_BLIND_SOLVE_RATE,
  blindBoard,
  blindPairTerms,
  checkIntendedClues,
  clueBoard,
  type ClueModel,
  type IntendedClue,
  DISTRACTOR_ASPECTS,
  optionsAloneOnAClue,
  SHAPE_CLUE_PARTS,
} from "./blind-options";
import { gatePieceTexture } from "./gate-pieces";
import { everyAdjacentSwapMatters, gateOrderOutcome } from "./gate-order";
import { SCENE_ORIENTABLE_SHAPES } from "./domains";
import { drawSpatialAssembly, solveSpatialAssembly, spatialAssemblyClues, spatialAssemblyWrongReason } from "./spatial-assembly";
import { drawOverlappingFigures, overlappingFigureClues, solveOverlappingFigures } from "./overlapping-figures";
import { attributeMatrixClues, drawAttributeMatrix, solveAttributeMatrix } from "./attribute-matrix";

export const SCENE_FAMILY_IDS = [
  "relational-sequence-v2",
  "attribute-pairing-v1",
  "compositional-analogy-v2",
  "composed-transform-v2",
  "composed-transform-v3",
  "relational-matrix-v2",
  "visual-set-algebra-v2",
  "spatial-transform-v2",
  "transformation-machine-v3",
  "transformation-machine-v4",
  "spatial-assembly-v1",
  "overlapping-figures-v1",
  "attribute-matrix-v1",
  "second-order-sequence-v2",
  "inverse-analogy-v2",
] as const;
export type SceneFamilyId = (typeof SCENE_FAMILY_IDS)[number];

/**
 * What one clue is in each family (`ClueModel`), read by distractor selection,
 * the tests and `npm run families:verify`. The owner's rule of 2026-10-03: one
 * clue must never narrow the six options to one (`optionsAloneOnAClue`).
 *
 * `whole-rule` marks a family whose rule is a single clue, so knowing it is
 * solving the item: the second-order sequence, where every option is the same
 * token on a different square (kept as is by the owner's decision that day).
 */
export const SCENE_FAMILY_CLUE_MODELS = {
  "relational-sequence-v2": "features",
  "attribute-pairing-v1": "features",
  "compositional-analogy-v2": "features",
  "composed-transform-v2": "features",
  "composed-transform-v3": "features",
  "relational-matrix-v2": "squares",
  "visual-set-algebra-v2": "features",
  "spatial-transform-v2": "features",
  "transformation-machine-v3": "features",
  "transformation-machine-v4": "features",
  "spatial-assembly-v1": "features",
  "overlapping-figures-v1": "rays",
  "attribute-matrix-v1": "attributes",
  "second-order-sequence-v2": "whole-rule",
  "inverse-analogy-v2": "features",
} as const satisfies Readonly<Record<SceneFamilyId, ClueModel | "whole-rule">>;

/** Meaningful target outcomes, including absent and repeated shapes. */
export function sceneFamilyClueBases(
  familyId: SceneFamilyId,
  answer: Scene,
  domain: readonly Scene[],
): readonly (readonly IntendedClue[])[] {
  if (SCENE_FAMILY_CLUE_MODELS[familyId] === "whole-rule") return [];
  if (familyId === "spatial-assembly-v1") return [spatialAssemblyClues(answer)];
  if (familyId === "overlapping-figures-v1") return [overlappingFigureClues(answer)];
  if (familyId === "attribute-matrix-v1") return [attributeMatrixClues(answer,
    domain.some((value) => value.objects.length !== answer.objects.length))];
  if (familyId === "relational-matrix-v2") {
    return [[...([0, 2] as const).flatMap((row) => ([0, 2] as const).map((column) => ({
      id: `square:${row},${column}`,
      read: (value: Scene) => sceneSignature({
        ...value,
        objects: value.objects.filter((placement) => placement.row === row && placement.column === column),
        tiles: value.tiles.filter((tile) => tile.row === row && tile.column === column),
      }),
    })))]];
  }
  const placements = (value: Scene, shape: string) => value.objects
    .filter(({ object }) => object.kind === "token" && object.shape === shape)
    .sort((left, right) => left.row - right.row || left.column - right.column);
  if (familyId === "attribute-pairing-v1") {
    return [[
      { id: "shape", read: (value) => JSON.stringify(value.objects.map(({ object }) => object.shape).sort()) },
      { id: "position", read: (value) => JSON.stringify(value.objects.map(({ row, column }) => [row, column]).sort()) },
      { id: "fill", read: (value) => JSON.stringify(value.objects.map(({ object }) => object.kind === "token" ? object.fill : "container").sort()) },
    ]];
  }
  const shapes = [...new Set([answer, ...domain].flatMap((value) => value.objects.flatMap(({ object }) =>
    object.kind === "token" ? [object.shape] : [])))].sort();
  const targets = familyId === "relational-sequence-v2"
    ? shapes.filter((shape) => placements(answer, shape).some(({ row, column }) => row !== 1 || column !== 1))
    : shapes;
  const objects: IntendedClue[] = targets.map((shape) => ({
    id: `shape:${shape}`,
    singleInference: placements(answer, shape).length <= 1,
    read: (value) => sceneSignature({ kind: "scene", rows: value.rows, columns: value.columns, tiles: [], objects: placements(value, shape) }),
  }));
  const properties: IntendedClue[] = targets.flatMap((shape) => [
    { id: `${shape}:position`, read: (value: Scene) => JSON.stringify(placements(value, shape).map(({ row, column }) => [row, column])) },
    { id: `${shape}:fill`, read: (value: Scene) => JSON.stringify(placements(value, shape).map(({ object }) => object.kind === "token" ? object.fill : "container").sort()) },
    ...((SCENE_ORIENTABLE_SHAPES as readonly string[]).includes(shape) ? [{
      id: `${shape}:direction`,
      read: (value: Scene) => JSON.stringify(placements(value, shape).map(({ object }) => object.kind === "token" ? object.rotation : 0).sort()),
    }] : []),
  ]);
  // Separate bases avoid counting a whole shape and its derived properties as
  // independent facts. Repeated shapes need complete states to retain which
  // fill belongs at which square; sorted property multisets lose that pairing.
  const bases: IntendedClue[][] = objects.length > 1 || answer.objects.length > 1 ? [objects] : [];
  if (targets.every((shape) => placements(answer, shape).length === 1)) bases.push(properties);
  return bases;
}

/** Joint states of repeated shapes are several clues; each actual symbol still needs a near miss. */
function singleSceneFamilyClues(
  answer: Scene,
  bases: readonly (readonly IntendedClue[])[],
): IntendedClue[] {
  const singles = bases.flatMap((basis) => basis.length > 1
    ? basis.filter((clue) => clue.singleInference !== false) : []);
  if (!bases.length || !bases.some((basis) => basis.some((clue) => clue.singleInference === false))) return singles;
  for (const placement of answer.objects) {
    if (placement.object.kind !== "token") continue;
    const signature = sceneSignature({ ...answer, tiles: [], objects: [placement] });
    singles.push({
      id: `symbol:${placement.object.shape}:${placement.row},${placement.column}`,
      read: (value) => value.objects.some((object) =>
        sceneSignature({ ...value, tiles: [], objects: [object] }) === signature) ? "present" : "absent",
    });
  }
  return singles;
}

export interface SceneFamilyClueCheck {
  singleClueAnswerIds: string[];
  dispensableClueIds: string[];
  indistinguishableWrongOptionIndexes: number[];
}

/** Recheck served and bank items without trusting their generation labels. */
export function sceneFamilyClueCheck(puzzle: Puzzle): SceneFamilyClueCheck {
  const parsed = PuzzleSchema.safeParse(puzzle);
  const familyId = puzzle.familyId;
  if (!parsed.success || !SCENE_FAMILY_IDS.includes(familyId as SceneFamilyId)) {
    const indistinguishableWrongOptionIndexes: number[] = [];
    if (Array.isArray(puzzle.options) && Number.isInteger(puzzle.answerIndex)) {
      const answer = SceneSchema.safeParse(puzzle.options[puzzle.answerIndex]);
      if (answer.success) puzzle.options.forEach((option, index) => {
        const value = SceneSchema.safeParse(option);
        if (index !== puzzle.answerIndex && value.success && sceneSignature(value.data) === sceneSignature(answer.data)) {
          indistinguishableWrongOptionIndexes.push(index);
        }
      });
    }
    return { singleClueAnswerIds: ["invalid-puzzle-or-family"], dispensableClueIds: [], indistinguishableWrongOptionIndexes };
  }
  const { options, answerIndex } = parsed.data;
  const value = parsed.data;
  const sequence = familyId === "relational-sequence-v2" || familyId === "second-order-sequence-v2";
  const classicMatrix = familyId === "overlapping-figures-v1" || familyId === "attribute-matrix-v1";
  const grid = familyId === "relational-matrix-v2" || familyId === "visual-set-algebra-v2" || classicMatrix;
  const machine = familyId === "composed-transform-v2" || familyId === "composed-transform-v3" || familyId === "transformation-machine-v3" ||
    familyId === "transformation-machine-v4";
  const assembly = familyId === "spatial-assembly-v1";
  const expectedLayout = assembly ? "assembly" : sequence ? "row" : grid ? "grid3x3" : machine ? "machineTable" : "analogy";
  const stemLengthValid = sequence ? value.stem.length === (familyId === "relational-sequence-v2" ? 5 : 6)
    : assembly ? value.stem.length === 4 : grid ? value.stem.length === 9 : machine ? [9, 12].includes(value.stem.length) : value.stem.length === 3;
  const answer = options[answerIndex];
  const targetCountValid = familyId === "attribute-pairing-v1" || familyId === "second-order-sequence-v2"
    ? answer.objects.length === 1 : assembly ? answer.objects.length === 9 : machine
      ? answer.objects.length === 3 : familyId === "visual-set-algebra-v2" || familyId === "relational-matrix-v2" || classicMatrix
        ? true : answer.objects.length === 2;
  if (value.layout !== expectedLayout || !stemLengthValid || !targetCountValid ||
      answer.objects.some(({ object }) => object.kind !== "token")) {
    return { singleClueAnswerIds: ["invalid-family-structure"], dispensableClueIds: [], indistinguishableWrongOptionIndexes: [] };
  }
  // Target kinds come from the visible set operands, or the answer for
  // shape-preserving families. Unused near misses never define the rule.
  const queryLeft = familyId === "visual-set-algebra-v2" ? scenePanel(value.stem[6]) : null;
  const queryRight = familyId === "visual-set-algebra-v2" ? scenePanel(value.stem[7]) : null;
  if (familyId === "visual-set-algebra-v2" && (!queryLeft || !queryRight)) {
    return { singleClueAnswerIds: ["invalid-family-structure"], dispensableClueIds: [], indistinguishableWrongOptionIndexes: [] };
  }
  const domain = familyId === "attribute-matrix-v1" ? [...value.stem.filter((panel): panel is Scene => !("blank" in panel)), answer]
    : queryLeft && queryRight ? [queryLeft, queryRight] : [answer];
  const bases = sceneFamilyClueBases(familyId as SceneFamilyId, answer, domain);
  const singleClueAnswerIds: string[] = [];
  const dispensableClueIds: string[] = [];
  const indistinguishable = new Set<number>();
  for (const clue of singleSceneFamilyClues(options[answerIndex], bases)) {
    const correct = clue.read(options[answerIndex]);
    if (options.filter((option) => clue.read(option) === correct).length < 2) singleClueAnswerIds.push(clue.id);
  }
  bases.forEach((basis, basisIndex) => {
    const checked = checkIntendedClues(options, answerIndex, basis);
    dispensableClueIds.push(...checked.dispensableClueIds.map((id) => `${basisIndex}:${id}`));
    checked.indistinguishableWrongOptionIndexes.forEach((index) => indistinguishable.add(index));
  });
  return { singleClueAnswerIds, dispensableClueIds, indistinguishableWrongOptionIndexes: [...indistinguishable] };
}

/**
 * One named generation bucket: what a family produces when a schedule asks for
 * that bucket by name.
 *
 * Difficulty used to be a label pinned on whatever a family happened to
 * generate. It is now an INPUT: `generateSceneFamilyCandidate` refuses a bucket
 * this table does not declare, and the promotion registry may only enable a
 * bucket declared here. A schedule can therefore never ask a family for depth
 * it cannot actually produce, and a family can never quietly serve a shallower
 * item than the slot promised.
 */
export interface SceneFamilyBucket {
  /** Bucket id. Ends in `-d1` through `-d6`; that digit is the difficulty. */
  bucket: string;
  /** Difficulty every accepted draw in this bucket carries. */
  difficulty: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Ordered rule steps EVERY draw in this bucket makes the solver apply.
   *
   * This replaces the old `programDepth(band)` guess, which called every
   * composition item two steps and everything above it three, whatever the
   * family actually did. It is a floor, not an average, so a deeper bucket is
   * a real, checkable increase rather than a relabelling.
   */
  programDepth: number;
}

/**
 * Every bucket every family supports, easiest first.
 *
 * A bucket here is not a promise that anything is served, only that the
 * generator can produce it — a prototype family declares its buckets like any
 * other. Withdrawn families used to keep a verifier-only bucket so the build
 * sweep still covered them; the ten that were never served were deleted outright
 * on 2026-08-27, so no such bucket remains. What may be served is decided by
 * `CURRENT_FAMILY_PROMOTION_REGISTRY`, and the parity check in
 * `scripts/scene-family-verify.ts` proves every enabled registry bucket appears
 * here with the same difficulty.
 *
 * Bucket ids drop the family's version suffix. The one exception is
 * `relational-outlier-v3`: it is a redesign of a withdrawn family and would
 * otherwise take its predecessor's id, so it keeps the version and bucket ids
 * stay unique across the whole table.
 */
export const SCENE_FAMILY_BUCKETS: Readonly<Record<SceneFamilyId, readonly SceneFamilyBucket[]>> = {
  // One perimeter step per panel; the fill delta may be zero, so one step is
  // all a draw is guaranteed to show.
  "relational-sequence-v2": [{ bucket: "relational-sequence-d2", difficulty: 2, programDepth: 1 }],
  // One analogical mapping carried to the query token.
  "attribute-pairing-v1": [{ bucket: "attribute-pairing-d2", difficulty: 2, programDepth: 1 }],
  // d3 is board movement and fill cycling, both demonstrated by the worked pair.
  // d4 adds a third demonstrated change: every arrow turns where it stands.
  "compositional-analogy-v2": [
    { bucket: "compositional-analogy-d3", difficulty: 3, programDepth: 2 },
    { bucket: "compositional-analogy-d4", difficulty: 4, programDepth: 3 },
  ],
  // d4 demonstrates and applies two gates. d5 demonstrates and applies three,
  // sometimes in a different order from the worked rows. No worked example is
  // irrelevant to the requested result.
  "composed-transform-v2": [
    { bucket: "composed-transform-d4", difficulty: 4, programDepth: 2 },
    { bucket: "composed-transform-d5", difficulty: 5, programDepth: 3 },
  ],
  "composed-transform-v3": [
    { bucket: "composed-transform-v3-d5", difficulty: 5, programDepth: 3 },
  ],
  // A row rule and a column rule, both needed for the missing corner.
  "relational-matrix-v2": [{ bucket: "relational-matrix-d4", difficulty: 4, programDepth: 2 }],
  // d4 combines the two boards and then transforms the combined result. d5 adds
  // a third visible step: every orientable token on that result turns in place.
  "visual-set-algebra-v2": [
    { bucket: "visual-set-algebra-d4", difficulty: 4, programDepth: 2 },
    { bucket: "visual-set-algebra-d5", difficulty: 5, programDepth: 3 },
  ],
  // One spatial transformation of the whole arrangement belongs in warmup.
  "spatial-transform-v2": [{ bucket: "spatial-transform-d2", difficulty: 2, programDepth: 1 }],
  // Three worked gates applied in the order the query path shows them. The
  // depth counts those displayed gates — nothing else. Every gate is provably
  // load-bearing: a draw whose answer survives deleting any one of them is not
  // servable.
  "transformation-machine-v3": [
    { bucket: "transformation-machine-d5", difficulty: 5, programDepth: 3 },
  ],
  // The prototype redesign of v3: the same three gates' jobs, but the paint and
  // the copy read one square, so each gate depends on the board the gate before
  // it made. It keeps its version in the bucket id, like relational-outlier-v3,
  // so the two can be compared side by side. Not served until registered.
  "transformation-machine-v4": [
    { bucket: "transformation-machine-v4-d5", difficulty: 5, programDepth: 3 },
  ],
  "spatial-assembly-v1": [{ bucket: "spatial-assembly-d4", difficulty: 4, programDepth: 2 }],
  "overlapping-figures-v1": [
    { bucket: "overlapping-figures-d3", difficulty: 3, programDepth: 1 },
    { bucket: "overlapping-figures-d4", difficulty: 4, programDepth: 2 },
    { bucket: "overlapping-figures-d5", difficulty: 5, programDepth: 3 },
  ],
  "attribute-matrix-v1": [
    { bucket: "attribute-matrix-d2", difficulty: 2, programDepth: 2 },
    { bucket: "attribute-matrix-d3", difficulty: 3, programDepth: 3 },
    { bucket: "attribute-matrix-d4", difficulty: 4, programDepth: 3 },
  ],
  // A step rule plus the rule governing how that step grows.
  "second-order-sequence-v2": [{ bucket: "second-order-sequence-d4", difficulty: 4, programDepth: 2 }],
  // Two changes, run in reverse to recover the missing input.
  "inverse-analogy-v2": [{ bucket: "inverse-analogy-d4", difficulty: 4, programDepth: 2 }],
};

/** Every bucket a family declares, easiest first. */
export function sceneFamilyBucketsFor(familyId: SceneFamilyId): readonly SceneFamilyBucket[] {
  return SCENE_FAMILY_BUCKETS[familyId];
}

/**
 * The declaration for one named bucket, or an error naming what is available.
 *
 * Callers that are assembling a test treat the error as an ordinary rejected
 * draw, so a registry that has drifted ahead of the generator thins a band
 * loudly rather than serving something the slot did not ask for.
 */
export function requireSceneFamilyBucket(familyId: SceneFamilyId, bucket: string): SceneFamilyBucket {
  const declared = SCENE_FAMILY_BUCKETS[familyId].find((entry) => entry.bucket === bucket);
  if (!declared) {
    throw new Error(
      `${familyId} does not declare difficulty bucket "${bucket}"; it declares ` +
        SCENE_FAMILY_BUCKETS[familyId].map((entry) => entry.bucket).join(", "),
    );
  }
  return declared;
}

/** The easiest bucket a family declares — what a band's first occurrence uses. */
export function entrySceneFamilyBucket(familyId: SceneFamilyId): SceneFamilyBucket {
  return SCENE_FAMILY_BUCKETS[familyId][0];
}

export interface SceneFamilyCandidate {
  familyId: SceneFamilyId;
  puzzle: Puzzle;
  definition: FamilyDefinition;
  /**
   * For extrapolation layouts (type "sequence", layout "row"): which stem
   * panels belong to the strand that ends in the blank, in reading order.
   *
   * This used to be a bare count the family declared about itself, which the
   * build gate had to take on trust — exactly the kind of unchecked claim that
   * let interleaved-sequence-v2 ship a row whose answered strand showed only
   * one transition. Panel indexes are checkable against the puzzle:
   * `checkAnsweredStrand` re-reads the stem and proves the strand really is a
   * constant-stride run of visible panels whose next slot is the blank, and
   * that it shows at least `MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND` terms.
   * Families with other layouts leave it undefined.
   */
  answeredStrandPanelIndexes?: readonly number[];
  /**
   * For gate families: the order the question runs its gates in, and the
   * question's board run through the gates in any order (null when a gate
   * cannot apply). `gateOrderOutcome` reads it to report how much the order
   * matters (docs/plans/harden-reasoning.md). Other families leave it undefined.
   */
  queryGates?: {
    order: readonly number[];
    run(order: readonly number[]): Scene | null;
  };
}

/**
 * How many terms of the answered strand an extrapolation row must show.
 *
 * A sequence item asks the solver to KEEP GOING, so the step has to be
 * observed at least twice before it is applied. One observed transition is an
 * assumption, not evidence.
 */
export const MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND = 3;

/** What `checkAnsweredStrand` found when it re-read one candidate's stem. */
export interface AnsweredStrandCheck {
  /** Visible terms in the answered strand, or null when the item is not an extrapolation row. */
  observedTerms: number | null;
  /** Null when the declaration holds up against the stem; otherwise what is wrong with it. */
  problem: string | null;
}

/**
 * Verify a candidate's declared answered strand against its own stem.
 *
 * Extrapolation items only.
 *
 * For an extrapolation row the declaration must name panels that are inside
 * the stem, strictly increasing, visible rather than blank, evenly spaced, and
 * spaced so that one more stride lands exactly on the trailing blank — the
 * blank is the strand's next slot. Only then is the number of declared panels
 * really the number of terms the solver can read.
 */
export function checkAnsweredStrand(candidate: SceneFamilyCandidate): AnsweredStrandCheck {
  const { puzzle } = candidate;
  const declared = candidate.answeredStrandPanelIndexes;
  if (puzzle.type !== "sequence" || puzzle.layout !== "row") {
    return {
      observedTerms: null,
      problem: declared === undefined
        ? null
        : "declares an answered strand but is not an extrapolation row",
    };
  }
  if (declared === undefined) {
    return { observedTerms: null, problem: "no answeredStrandPanelIndexes declared" };
  }

  const observedTerms = declared.length;
  const fault = (problem: string): AnsweredStrandCheck => ({ observedTerms, problem });
  const blankIndexes = puzzle.stem.flatMap((panel, index) => "blank" in panel ? [index] : []);
  if (blankIndexes.length !== 1) {
    return fault(`an extrapolation row needs exactly one blank panel but has ${blankIndexes.length}`);
  }
  const blankIndex = blankIndexes[0];

  const outOfRange = declared.find((index) =>
    !Number.isInteger(index) || index < 0 || index >= puzzle.stem.length);
  if (outOfRange !== undefined) {
    return fault(`panel index ${outOfRange} is outside the ${puzzle.stem.length}-panel stem`);
  }
  for (let position = 1; position < declared.length; position++) {
    if (declared[position] <= declared[position - 1]) {
      return fault(
        `panel indexes must strictly increase, but ${declared[position - 1]} is followed by ${declared[position]}`,
      );
    }
  }
  const blankTerm = declared.find((index) => "blank" in puzzle.stem[index]);
  if (blankTerm !== undefined) return fault(`panel ${blankTerm} is blank, so it shows no term`);
  if (observedTerms < MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND) {
    return fault(`only ${observedTerms} observed term${observedTerms === 1 ? "" : "s"} in the answered strand`);
  }

  const stride = declared[1] - declared[0];
  const unevenAt = declared.findIndex((index, position) =>
    position > 0 && index - declared[position - 1] !== stride);
  if (unevenAt !== -1) {
    return fault(`panel indexes ${declared.join(", ")} do not share one stride`);
  }
  const lastTerm = declared[observedTerms - 1];
  if (lastTerm + stride !== blankIndex) {
    return fault(
      `a stride of ${stride} from panel ${lastTerm} lands on ${lastTerm + stride}, not on the blank at ${blankIndex}`,
    );
  }
  return { observedTerms, problem: null };
}

function token(
  shape: SceneToken["shape"],
  fill: SceneToken["fill"] = "outline",
  size: SceneToken["size"] = "l",
): SceneToken {
  return { kind: "token", shape, rotation: 0, fill, size };
}

function scene(
  placements: Array<{ row: number; column: number; object: SceneObject }>,
  rows = 3,
  columns = 3,
): Scene {
  return { kind: "scene", rows, columns, objects: placements, tiles: [] };
}

function one(shape: SceneToken["shape"], row: number, column: number, fill: SceneToken["fill"] = "outline"): Scene {
  return scene([{ row, column, object: token(shape, fill) }]);
}

function optionOrder(answer: Scene, distractors: readonly Scene[], rng: Rng): { options: Scene[]; answerIndex: number } {
  const all = [answer, ...distractors];
  const order = shuffled(rng, all.map((_, index) => index));
  return { options: order.map((index) => all[index]), answerIndex: order.indexOf(0) };
}

function scenePanel(panel: Puzzle["stem"][number] | undefined): Scene | null {
  return panel && !("blank" in panel) ? panel : null;
}

/**
 * How many of the nearest legible near misses the balanced search may use.
 *
 * Until 2026-09-29 the five slots came from the closest `slots + 2`
 * candidates. That window was the star the review of 2026-09-28 measured: with
 * only one-mistake variations of the answer to choose from, the answer was the
 * option closest to all the others and held the most common value on every
 * aspect, so a solver that never read the question picked it about 60% of the
 * time. Spreading the answer's rank needs wrong options that share a mistake
 * with another wrong option — the tree I-RAVEN built for the same flaw in
 * RAVEN — and those sit further out, so the search reaches past the nearest few.
 *
 * It searches the nearest `DISTRACTOR_REACH`, and the nearest
 * `DISTRACTOR_WIDE_REACH` only when those hold no legible list. A wider
 * reach was measured on 2026-09-29 and bought nothing: where a family's answer
 * cannot reach some rank, the cause is its grammar, not the reach.
 */
const DISTRACTOR_REACH = 20;
const DISTRACTOR_WIDE_REACH = 40;

/**
 * Lists the search may visit for one item. A safety bound on time, not a
 * tuning knob: every family's search ends far below it (a test checks), so
 * which list is served never depends on where the count ran out.
 */
const DISTRACTOR_SEARCH_BUDGET = 400_000;

/** Searches that hit `DISTRACTOR_SEARCH_BUDGET` before finishing. */
let exhaustedSearches = 0;
export function exhaustedDistractorSearches(): number { return exhaustedSearches; }
export function resetExhaustedDistractorSearches(): void { exhaustedSearches = 0; }

/**
 * No list of near misses lets every clue appear on two options
 * (`optionsAloneOnAClue`). A family that draws its inputs can catch this and
 * draw again; anywhere else it is a refused draw, like a thin grammar.
 */
export class CluesNotSharedError extends Error {
  override name = "CluesNotSharedError";
}

/**
 * Can this near-miss pool supply the agreement the option list needs?
 *
 * `selectDistractors` needs, per aspect, a wrong option that matches the answer
 * on it — but it can only take one if the pool holds one. When the pool does
 * not, the item ships with an aspect that picks the answer on its own, and no
 * amount of re-choosing fixes it. Families whose inputs are drawn rather than
 * enumerated can do better than ship it: check the pool here and draw again,
 * the same way a draw with two defensible answers is redrawn.
 *
 * Only for families that CAN satisfy it. Where a family's whole rule shows up in
 * one aspect — `second-order-sequence`, whose options are one token at
 * different places — a board agreeing on that aspect would be the answer, and
 * asking for one would reject every draw forever.
 */
function poolCoversEveryAspect(answer: Scene, pool: readonly Scene[]): boolean {
  return DISTRACTOR_ASPECTS.every((aspect) => {
    const target = aspect.of(answer);
    return pool.some((candidate) =>
      aspect.of(candidate) === target &&
      sceneSignature(candidate) !== sceneSignature(answer) &&
      areScenesCategoricallyDistinct(answer, candidate));
  });
}

/**
 * Rounds and step size of `leastCreditMix`. Measured 2026-09-29 on
 * `relational-matrix-d4`, the tightest served bucket: 100 to 800 rounds moved
 * its worst strategy by about a point either way.
 */
const LEAST_CREDIT_ROUNDS = 200;
const LEAST_CREDIT_STEP = 0.5;

/**
 * A mix of option lists that leaves every options-only strategy as little
 * credit on the answer as it can, found as a two-player game: the strategies
 * gain weight each round in proportion to what they earn (multiplicative
 * weights), and each round the list that pays the weighted strategies least is
 * played. The average of those plays approaches the list mix whose worst
 * strategy earns least. Returns the list played in each round, so a uniform
 * draw of one round is a draw from the mix.
 *
 * `rows[list]` holds the credit each strategy earns on that list's answer,
 * sparsely: strategy numbers and credits.
 */
function leastCreditMix(
  rows: readonly { index: Int32Array; credit: Float64Array }[],
  strategies: number,
): Int32Array {
  // Each strategy's column: the lists that pay it, and how much.
  const columns: { list: number[]; credit: number[] }[] = Array.from({ length: strategies }, () => ({ list: [], credit: [] }));
  // What each list pays the weighted strategies, kept current as weights move.
  const paid = new Float64Array(rows.length);
  rows.forEach(({ index, credit }, list) => {
    for (let entry = 0; entry < index.length; entry++) {
      columns[index[entry]].list.push(list);
      columns[index[entry]].credit.push(credit[entry]);
      paid[list] += credit[entry];
    }
  });
  // No renormalising: a weight grows at most e^(step) a round, so 200 rounds
  // stay far inside a double's range.
  const weights = new Float64Array(strategies).fill(1);
  const plays = new Int32Array(LEAST_CREDIT_ROUNDS);
  for (let round = 0; round < LEAST_CREDIT_ROUNDS; round++) {
    let played = 0;
    for (let list = 1; list < rows.length; list++) if (paid[list] < paid[played]) played = list;
    plays[round] = played;
    const { index, credit } = rows[played];
    for (let entry = 0; entry < index.length; entry++) {
      const strategy = index[entry];
      const growth = weights[strategy] * (Math.exp(LEAST_CREDIT_STEP * credit[entry]) - 1);
      weights[strategy] += growth;
      const column = columns[strategy];
      for (let member = 0; member < column.list.length; member++) paid[column.list[member]] += growth * column.credit[member];
    }
  }
  return plays;
}

/**
 * Choose the wrong options for one item so that neither one clue nor the six
 * options read without the question give the answer away.
 *
 * Every family builds its near misses from its own rule grammar and hands the
 * whole pool here; each one is still witnessed by exactly one failed program.
 * Taking the count from one constant is what lets the battery change option
 * count in a single edit. A family whose pool is too thin throws, so a grammar
 * that cannot support the current option count fails loudly at generation
 * instead of quietly serving an easier item.
 *
 * One rule is hard, since 2026-10-03: **every clue any option shows appears
 * on at least two options** (`optionsAloneOnAClue`, under the family's
 * `ClueModel`), the owner's rule that one of the clues a question needs must
 * never be enough. It holds for the wrong options too, so the answer cannot
 * stand out as the one option that is never alone. A pool that cannot meet it
 * throws `CluesNotSharedError`, which a family that draws its inputs can catch
 * and draw again.
 *
 * Everything else is balance. Agreement (2026-08-27: for every aspect a solver
 * can infer alone, some wrong option shares the answer's value) put the answer
 * at the centre of a star (2026-09-28). The first fix banned the centre — never
 * the majority on an aspect, never the option closest to all the others — and
 * the ban became the signal: the answer piled into the middle ranks, where a
 * solver reading the middle found it up to 53% of the time. So since
 * 2026-09-29 no rank is banned, and since 2026-09-30 agreement is not required
 * either: as a rule it fed the solver that rules out every option alone on some
 * aspect, which reached 42.9% on `relational-matrix-d4`. The goal is that a
 * blind guess is worth 1 in 6, which needs the answer's rank on every measure
 * spread evenly over 1 to 6, the top included, and the answer alone on an
 * aspect about as often as any other option:
 *
 *  - **The least-credit mix.** Every legible list within reach that shares
 *    every clue is scored by what each options-only strategy of the gate
 *    (`blindStrategyCredits`) would earn on its answer, the two lone-aspect
 *    strategies included. (Until 2026-10-03 the one-inference solver of
 *    2026-08-27 played here too, as a cost; the hard rule above retired it.)
 *    The list served is a seeded draw from the mix of lists whose worst
 *    strategy earns least (`leastCreditMix`). Credit no list of the item can
 *    avoid is taken out first, so an unavoidable strategy cannot crowd the
 *    others out of the mix. Where every rank is within reach the mix comes out
 *    close to even, so each blind strategy earns about 1 in 6.
 *  - **Agreement, then closeness** decide between lists every strategy reads
 *    alike: fewer aspects on which the answer stands alone, then nearer near
 *    misses, the ones a solver has to read rather than dismiss at a glance.
 *
 * The seeded generator breaks exact ties, so the same rng replays the same
 * options while two items from one grammar do not always serve the same near
 * misses.
 */
export function selectDistractors(
  pool: readonly Scene[],
  rng: Rng,
  familyName: string,
  options: {
    /** The correct scene. Near misses are ranked by how close they sit to it. */
    answer: Scene;
    /** Near misses that must appear whatever else is drawn — a family's sharpest contrast. */
    required?: readonly Scene[];
    /** What one clue is for this family's rule (`ClueModel`); features unless it combines square by square. */
    clueModel?: ClueModel;
    /** Family identity is explicit; human-readable error labels never select a contract. */
    familyId?: SceneFamilyId;
    /** Alternative independent semantic bases; each is checked separately. */
    intendedClueBases?: readonly (readonly IntendedClue[])[];
    /** Each declared relationship must change which option can be chosen. */
    requireEveryIntendedClue?: boolean;
    /** At least one wrong choice must survive each missing worked transformation. */
    requiredWitnessGroups?: readonly GateWitnessGroup[];
    /** Complete alternate runs that can balance the necessary comparisons. */
    alternateExecutions?: readonly Scene[];
    /** Visible operand scenes for rules that can remove shape kinds, such as set algebra. */
    clueDomain?: readonly Scene[];
  },
): Scene[] {
  const signatures = new WeakMap<Scene, string>();
  const signatureOf = (value: Scene): string => {
    let signature = signatures.get(value);
    if (signature === undefined) {
      signature = sceneSignature(value);
      signatures.set(value, signature);
    }
    return signature;
  };
  const clueValues = new Map<IntendedClue, WeakMap<Scene, string>>();
  const readClue = (clue: IntendedClue, value: Scene): string => {
    let cache = clueValues.get(clue);
    if (!cache) { cache = new WeakMap(); clueValues.set(clue, cache); }
    let reading = cache.get(value);
    if (reading === undefined) { reading = clue.read(value); cache.set(value, reading); }
    return reading;
  };
  const { answer, required = [], clueModel = "features" } = options;
  const familyId = options.familyId;
  const intendedClueBases = options.intendedClueBases ??
    (familyId ? sceneFamilyClueBases(familyId, answer, options.clueDomain ?? [answer]) : []);
  const witnessGroups = options.requiredWitnessGroups ?? [];
  const hasIntendedClues = intendedClueBases.length > 0 || witnessGroups.length > 0;
  const obligations: { bit: bigint }[] = [];
  const basisBits = intendedClueBases.map((basis) => {
    // Validate ids within each basis without deriving or merging its clues.
    checkIntendedClues([answer], 0, basis);
    return basis.map(() => {
      const bit = 1n << BigInt(obligations.length);
      obligations.push({ bit });
      return bit;
    });
  });
  let requiredWitnessCoverage = 0n;
  const witnessBits = witnessGroups.map(({ alternatives }) => {
    const bit = 1n << BigInt(obligations.length);
    obligations.push({ bit });
    requiredWitnessCoverage |= bit;
    return { bit, keys: new Set(alternatives.map(signatureOf)) };
  });
  const everyIntendedClue = (1n << BigInt(obligations.length)) - 1n;
  const mandatoryCoverage = options.requireEveryIntendedClue ? everyIntendedClue : requiredWitnessCoverage;
  const singleClues = singleSceneFamilyClues(answer, intendedClueBases);
  const singleAnswerValues = singleClues.map((clue) => readClue(clue, answer));
  const singleClueTarget = (1n << BigInt(singleClues.length)) - 1n;
  const intendedAnswerValues = intendedClueBases.map((basis) => basis.map((clue) => readClue(clue, answer)));
  const intendedCandidateCache = new Map<Scene, { coverage: bigint; agreement: bigint; indistinguishable: boolean }>();
  /** A single error can witness omissions in several alternative bases. */
  const intendedCandidate = (candidate: Scene): { coverage: bigint; agreement: bigint; indistinguishable: boolean } => {
    const cached = intendedCandidateCache.get(candidate);
    if (cached) return cached;
    let coverage = 0n;
    let agreement = 0n;
    let indistinguishable = false;
    intendedClueBases.forEach((basis, basisIndex) => {
      let differences = 0;
      let changed = -1;
      basis.forEach((clue, clueIndex) => {
        if (readClue(clue, candidate) !== intendedAnswerValues[basisIndex][clueIndex]) {
          differences += 1;
          changed = clueIndex;
        }
      });
      if (differences === 0) indistinguishable = true;
      else if (differences === 1) coverage |= basisBits[basisIndex][changed];
    });
    for (const { bit, keys } of witnessBits) if (keys.has(signatureOf(candidate))) coverage |= bit;
    singleClues.forEach((clue, index) => {
      if (readClue(clue, candidate) === singleAnswerValues[index]) agreement |= 1n << BigInt(index);
    });
    const result = { coverage, agreement, indistinguishable };
    intendedCandidateCache.set(candidate, result);
    return result;
  };
  const requiredKeys = new Set<string>();
  const kept: Scene[] = [];
  for (const contrast of required) {
    const key = signatureOf(contrast);
    if (requiredKeys.has(key)) continue;
    // A required contrast skips the search, so it must clear the legibility
    // floor here or nothing else will: the optional picks below are checked
    // against it, but it is never checked against them. The schema rejects an
    // illegible option pair too, but only after the whole candidate is built —
    // failing at the source names the family and the contrast.
    if (!areScenesCategoricallyDistinct(answer, contrast)) {
      throw new Error(
        `${familyName} requires a near miss that is not categorically distinct from its own answer`,
      );
    }
    if (hasIntendedClues && intendedCandidate(contrast).indistinguishable) {
      throw new CluesNotSharedError(`${familyName}: a required near miss matches a complete intended clue basis`);
    }
    for (const chosen of kept) {
      if (!areScenesCategoricallyDistinct(chosen, contrast)) {
        throw new Error(
          `${familyName} requires two near misses that are not categorically distinct from each other`,
        );
      }
    }
    requiredKeys.add(key);
    kept.push(contrast);
  }
  if (kept.length >= DISTRACTORS_PER_ITEM) {
    const fixed = kept.slice(0, DISTRACTORS_PER_ITEM);
    if (optionsAloneOnAClue([answer, ...fixed], clueModel).size > 0) {
      throw new CluesNotSharedError(`${familyName}: its required near misses leave a clue on one option`);
    }
    for (const clue of singleClues) {
      if (!fixed.some((candidate) => readClue(clue, candidate) === readClue(clue, answer))) {
        throw new CluesNotSharedError(`${familyName}: its required near misses leave an intended clue on one option`);
      }
    }
    for (const basis of intendedClueBases) {
      const checked = checkIntendedClues([answer, ...fixed], 0, basis);
      if (checked.indistinguishableWrongOptionIndexes.length > 0 ||
          (options.requireEveryIntendedClue && checked.dispensableClueIds.length > 0)) {
        throw new CluesNotSharedError(`${familyName}: its required near misses match every intended clue`);
      }
    }
    const coverage = fixed.reduce((mask, candidate) => mask | intendedCandidate(candidate).coverage, 0n);
    if ((coverage & mandatoryCoverage) !== mandatoryCoverage) {
      throw new CluesNotSharedError(`${familyName}: its required near misses let a worked transformation be skipped`);
    }
    return fixed;
  }

  const seen = new Set<string>([signatureOf(answer), ...requiredKeys]);
  const rest: Scene[] = [];
  for (const candidate of pool) {
    const key = signatureOf(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    rest.push(candidate);
  }
  // Shuffled before the stable ranking, so candidates at the same distance are
  // met in a seeded order rather than in the order the grammar lists them.
  const ranked = rankByCloseness(shuffled(rng, rest), answer, (candidate) => candidate)
    .filter((candidate) => areScenesCategoricallyDistinct(answer, candidate) &&
      kept.every((chosen) => areScenesCategoricallyDistinct(chosen, candidate)) &&
      (!hasIntendedClues || !intendedCandidate(candidate).indistinguishable));
  const keptIntendedCoverage = hasIntendedClues
    ? kept.reduce((coverage, candidate) => coverage | intendedCandidate(candidate).coverage, 0n)
    : 0n;
  const closestWitnesses = new Map<bigint, Scene[]>();
  if (hasIntendedClues) {
    for (const candidate of ranked) {
      const coverage = intendedCandidate(candidate).coverage;
      for (const { bit } of obligations) {
        if ((keptIntendedCoverage & bit) === 0n && (coverage & bit) !== 0n) {
          const witnesses = closestWitnesses.get(bit) ?? [];
          // A second witness can remain legible when the closest one clashes
          // with another required omission witness.
          if (witnesses.length < 2) {
            witnesses.push(candidate);
            closestWitnesses.set(bit, witnesses);
          }
        }
      }
    }
  }
  // Read once: an imported binding is a getter call in the loops below.
  const optionCount = OPTIONS_PER_ITEM;
  const slots = optionCount - 1 - kept.length;
  // Everything the search reads, computed once per board and once per pair.
  // Board 0 is the answer, then the required contrasts, then the reach.
  const answerBoard = blindBoard(answer);
  const aspectCount = DISTRACTOR_ASPECTS.length;
  const agreementMask = (aspectKeys: readonly string[]) => aspectKeys.reduce(
    (mask, key, index) => (key === answerBoard.aspectKeys[index] ? mask | (1 << index) : mask), 0);
  const keptBoards = kept.map(blindBoard);
  const keptAgreement = keptBoards.reduce((mask, board) => mask | agreementMask(board.aspectKeys), 0);
  // Aspects some legible wrong option could match. The rest cannot be helped
  // by choosing differently, so they neither steer the search nor fail it.
  let coverable = keptAgreement;
  const closestAgreeing = new Map<number, Scene>();
  for (const candidate of ranked) {
    const mask = agreementMask(DISTRACTOR_ASPECTS.map((aspect) => aspect.of(candidate)));
    coverable |= mask;
    for (let aspect = 0; aspect < aspectCount; aspect++) {
      if ((mask & (1 << aspect)) !== 0 && !closestAgreeing.has(aspect)) closestAgreeing.set(aspect, candidate);
    }
  }
  // The nearest few, then the closest agreeing candidate for any aspect they
  // cannot match, then the rest of the wide reach.
  // Conditional movement needs alternative footprints beside its mandatory
  // pre-movement contrast; the ordinary window mostly contains fill errors.
  const nearReach = familyId === "attribute-matrix-v1" ? ranked.length
    : witnessGroups.length > 0 || familyId === "composed-transform-v3" || familyId === "overlapping-figures-v1"
      ? DISTRACTOR_WIDE_REACH : DISTRACTOR_REACH;
  const reach = ranked.slice(0, nearReach);
  for (const candidate of closestAgreeing.values()) {
    if (!reach.includes(candidate)) reach.push(candidate);
  }
  for (const witnesses of closestWitnesses.values()) {
    for (const candidate of witnesses) if (!reach.includes(candidate)) reach.push(candidate);
  }
  // A required comparison can sit far from the answer. Keep its closest
  // partners too: the ordinary nearest window must not leave a required
  // footprint or fill value on that option alone.
  const symmetryValues = (value: Scene): string[] => {
    const board = clueBoard(value, clueModel);
    return [
      ...board.fixed.map((key, index) => `fixed:${index}:${key}`),
      ...[...board.once].flatMap(([shape, parts]) => parts.map((key, index) => `shape:${shape}:${index}:${key}`)),
    ];
  };
  const unpairedRequiredClues = new Set(kept.flatMap(symmetryValues));
  if (unpairedRequiredClues.size > 0) {
    for (const candidate of ranked) {
      let needed = false;
      symmetryValues(candidate).forEach((key) => {
        if (unpairedRequiredClues.delete(key)) needed = true;
      });
      if (needed && !reach.includes(candidate)) reach.push(candidate);
      if (unpairedRequiredClues.size === 0) break;
    }
  }
  const identityLayout = (value: Scene) => JSON.stringify(value.objects.map(({ row, column, object }) =>
    `${object.shape}:${row},${column}`).sort());
  for (const required of kept) {
    const layout = identityLayout(required);
    const partners = rankByCloseness(ranked.filter((candidate) => identityLayout(candidate) === layout),
      required, (candidate) => candidate).slice(0, OPTIONS_PER_ITEM);
    for (const partner of partners) if (!reach.includes(partner)) reach.push(partner);
  }
  // Local omission witnesses introduce new footprints. Their closest
  // same-layout partner can lie beyond the ordinary window when one other
  // property is also misread; keep it so the witness can actually be selected.
  const witnessLayouts = new Set([...closestWitnesses.values()].flat().map((value) =>
    identityLayout(value)));
  for (const candidate of ranked) {
    const layout = identityLayout(candidate);
    if (!witnessLayouts.has(layout)) continue;
    if (reach.some((value) => signatureOf(value) !== signatureOf(candidate) &&
        identityLayout(value) === layout)) {
      witnessLayouts.delete(layout);
      if (!reach.includes(candidate)) reach.push(candidate);
    }
    if (witnessLayouts.size === 0) break;
  }
  if (options.alternateExecutions) {
    // Three isolated mistakes form a star around the answer. Complete wrong
    // runs can change several outcomes together and balance those comparisons.
    const keys = new Set(options.alternateExecutions.map(signatureOf));
    for (const candidate of ranked) {
      if (keys.has(signatureOf(candidate)) && !reach.includes(candidate)) reach.push(candidate);
    }
  }
  const nearCount = reach.length;
  for (const candidate of ranked.slice(nearReach, DISTRACTOR_WIDE_REACH)) {
    if (!reach.includes(candidate)) reach.push(candidate);
  }
  const boards = [answerBoard, ...keptBoards, ...reach.map(blindBoard)];
  const size = boards.length;
  const firstChoice = 1 + keptBoards.length;
  const intendedCoverage = hasIntendedClues ? reach.map((candidate) => intendedCandidate(candidate).coverage) : [];
  const intendedAgreement = hasIntendedClues ? reach.map((candidate) => intendedCandidate(candidate).agreement) : [];
  const keptIntendedAgreement = kept.reduce((mask, candidate) => mask | intendedCandidate(candidate).agreement, 0n);
  const distance = new Float64Array(size * size);
  const aspects = new Float64Array(size * size);
  const cells = new Float64Array(size * size);
  const legible = new Uint8Array(size * size);
  /** Measure every pair whose later board is in `from`..`to` - 1. */
  const measurePairs = (from: number, to: number) => {
    for (let right = from; right < to; right++) {
      for (let left = 0; left < right; left++) {
        const terms = blindPairTerms(boards[left], boards[right]);
        const distinct = areScenesCategoricallyDistinct(boards[left].scene, boards[right].scene) ? 1 : 0;
        distance[left * size + right] = distance[right * size + left] = terms.distance;
        aspects[left * size + right] = aspects[right * size + left] = terms.aspects;
        cells[left * size + right] = cells[right * size + left] = terms.cells;
        legible[left * size + right] = legible[right * size + left] = distinct;
      }
    }
  };
  // The wide reach is measured only if the search has to widen.
  measurePairs(1, firstChoice + nearCount);
  const masks = boards.map((board, index) => (index === 0 ? 0 : agreementMask(board.aspectKeys)));
  // Each aspect's values as small integers, so counting them is cheap. Row
  // `aspect` of `valueIds` holds every board's value of that aspect.
  const valueIds = new Int32Array(aspectCount * size);
  for (let aspect = 0; aspect < aspectCount; aspect++) {
    const ids = new Map<string, number>();
    boards.forEach((board, index) => {
      const key = board.aspectKeys[aspect];
      if (!ids.has(key)) ids.set(key, ids.size);
      valueIds[aspect * size + index] = ids.get(key)!;
    });
  }
  /** `counts[aspect * size + value]`: how many current members hold that value. */
  const counts = new Int32Array(aspectCount * size);
  // Shared clues (`optionsAloneOnAClue`), as small integers so a finished list
  // is checked without building a string: each board's fixed clues (aspects or
  // squares), the shapes it holds once as a bitmask, and each such shape's
  // square, fill and turn.
  const clueBoards = boards.map((board) => clueBoard(board.scene, clueModel));
  const fixedCount = Math.max(...clueBoards.map((board) => board.fixed.length));
  const fixedClues = new Int32Array(size * fixedCount).fill(-1);
  const fixedIds = new Map<string, number>();
  clueBoards.forEach((board, index) => {
    board.fixed.forEach((value, clue) => {
      const key = `${clue}:${value}`;
      if (!fixedIds.has(key)) fixedIds.set(key, fixedIds.size);
      fixedClues[index * fixedCount + clue] = fixedIds.get(key)!;
    });
  });
  const shapeIds = new Map<string, number>();
  for (const board of clueBoards) for (const shape of board.once.keys()) if (!shapeIds.has(shape)) shapeIds.set(shape, shapeIds.size);
  const shapeCount = shapeIds.size;
  const partCount = SHAPE_CLUE_PARTS.length;
  const onceMasks = new Int32Array(size);
  const onceParts = new Int32Array(size * shapeCount * partCount);
  const partIds = new Map<string, number>();
  clueBoards.forEach((board, index) => {
    for (const [shape, parts] of board.once) {
      const id = shapeIds.get(shape)!;
      onceMasks[index] |= 1 << id;
      parts.forEach((value, part) => {
        const key = `${part}:${value}`;
        if (!partIds.has(key)) partIds.set(key, partIds.size);
        onceParts[(index * shapeCount + id) * partCount + part] = partIds.get(key)!;
      });
    }
  });

  const members = new Int32Array(optionCount);
  for (let index = 0; index < firstChoice; index++) members[index] = index;
  const chosen = new Int32Array(slots);
  // Each member's three solver scores, kept up to date as the search adds and
  // removes members, so a finished list is scored without a second pass.
  const typical = new Float64Array(optionCount);
  const aspectScore = new Float64Array(optionCount);
  const cellScore = new Float64Array(optionCount);
  const solverScores = [typical, aspectScore, cellScore];
  let visits = 0;
  let intendedVisits = 0;
  let selectedIntendedCoverage = keptIntendedCoverage;
  let selectedIntendedAgreement = keptIntendedAgreement;

  /**
   * The best list found for each way the answer can look to the options-only
   * strategies (`strategyKey`), by fewest aspects on which the answer stands
   * alone, then closeness to the answer.
   */
  const catalogue = new Map<number, { clueCoverage: number; uncovered: number; closeness: number; tied: number; chosen: Int32Array }>();

  /** Put the board at `position` into the list (`sign` 1) or take it out (-1). */
  const place = (position: number, sign: 1 | -1) => {
    const board = members[position];
    for (let aspect = 0; aspect < aspectCount; aspect++) counts[aspect * size + valueIds[aspect * size + board]] += sign;
    const row = board * size;
    for (let other = 0; other < position; other++) {
      const at = row + members[other];
      const t = distance[at] * sign;
      const a = aspects[at] * sign;
      const c = cells[at] * sign;
      typical[position] -= t;
      typical[other] -= t;
      aspectScore[position] += a;
      aspectScore[other] += a;
      cellScore[position] += c;
      cellScore[other] += c;
    }
  };
  for (let position = 0; position < firstChoice; position++) place(position, 1);

  // Scratch for `strategyKey`, one slot per member.
  const compositeRank = new Int32Array(optionCount);
  const deviation = new Int32Array(optionCount);
  const groups = optionCount * optionCount;
  /**
   * Everything the gate's strategies (`blindStrategyCredits`) can read about
   * the answer of the current list, packed into one integer: its tie group on
   * each solver and on their composite (`groups` values each, one per first and
   * last rank), how many options share the middle-rank pick with it (0 when it
   * is not among them), how many options are left to guess among after the
   * extremes are ruled out (0 when it is ruled out), the same after the
   * options alone in their value of some aspect are ruled out, and how many
   * options a solver picking a lone option chooses among (0 when the answer
   * is not one of them; all of them when none is lone). Two lists with the
   * same key pay every one of those strategies the same credit.
   */
  const strategyKey = (): number => {
    let key = 0;
    let excluded = 0;
    compositeRank.fill(0);
    deviation.fill(0);
    for (const scores of solverScores) {
      for (let position = 0; position < optionCount; position++) {
        let above = 0;
        let level = 0;
        for (let other = 0; other < optionCount; other++) {
          if (scores[other] > scores[position]) above += 1;
          else if (scores[other] === scores[position]) level += 1;
        }
        const lo = above + 1;
        const hi = above + level;
        // Twice the mid-rank, so every sum stays a whole number.
        compositeRank[position] += lo + hi;
        deviation[position] += Math.abs(lo + hi - (optionCount + 1));
        if (lo === hi && (lo === 1 || lo === optionCount)) excluded |= 1 << position;
        if (position === 0) key = key * groups + (lo - 1) * optionCount + (hi - 1);
      }
    }
    let above = 0;
    let level = 0;
    let fewest = deviation[0];
    for (let position = 0; position < optionCount; position++) {
      if (compositeRank[position] < compositeRank[0]) above += 1;
      else if (compositeRank[position] === compositeRank[0]) level += 1;
      if (deviation[position] < fewest) fewest = deviation[position];
    }
    key = key * groups + above * optionCount + (above + level - 1);
    let middleShare = 0;
    if (deviation[0] === fewest) for (let position = 0; position < optionCount; position++) if (deviation[position] === fewest) middleShare += 1;
    let ruledOut = 0;
    for (let position = 0; position < optionCount; position++) if ((excluded & (1 << position)) !== 0) ruledOut += 1;
    const left = ruledOut === optionCount ? optionCount : (excluded & 1) !== 0 ? 0 : optionCount - ruledOut;
    let lonely = 0;
    let loneCount = 0;
    for (let position = 0; position < optionCount; position++) {
      const board = members[position];
      for (let aspect = 0; aspect < aspectCount; aspect++) {
        if (counts[aspect * size + valueIds[aspect * size + board]] === 1) {
          lonely |= 1 << position;
          loneCount += 1;
          break;
        }
      }
    }
    const loneLeft = loneCount === optionCount ? optionCount : (lonely & 1) !== 0 ? 0 : optionCount - loneCount;
    const lonePick = loneCount === 0 ? optionCount : (lonely & 1) !== 0 ? loneCount : 0;
    // The one-inference solver of 2026-08-27 played here as a whole leak until
    // 2026-10-03. Every list now shares every clue (`cluesShared`), so it never
    // finishes an item, and under square clues it read aspects that are not
    // single clues at all: keeping it pushed relational-matrix-d4's
    // exclude-lone-aspect strategy to 31.8%.
    return (((key * (optionCount + 1) + middleShare) * (optionCount + 1) + left) * (optionCount + 1) + loneLeft) *
      (optionCount + 1) + lonePick;
  };
  /** The credit each strategy earns on the answer, read back from a key. */
  const strategyCredits = (key: number): { index: Int32Array; credit: Float64Array } => {
    const index: number[] = [];
    const credit: number[] = [];
    const rankStrategies = BLIND_MEASURES.length * optionCount;
    const lonePick = key % (optionCount + 1);
    key = Math.floor(key / (optionCount + 1));
    const loneLeft = key % (optionCount + 1);
    key = Math.floor(key / (optionCount + 1));
    const left = key % (optionCount + 1);
    key = Math.floor(key / (optionCount + 1));
    const middleShare = key % (optionCount + 1);
    key = Math.floor(key / (optionCount + 1));
    // Measures come out last first: the composite, then the solvers in reverse.
    for (let measure = BLIND_MEASURES.length - 1; measure >= 0; measure--) {
      const group = key % groups;
      key = Math.floor(key / groups);
      const lo = Math.floor(group / optionCount);
      const hi = group % optionCount;
      for (let rank = lo; rank <= hi; rank++) {
        index.push(measure * optionCount + rank);
        credit.push(1 / (hi - lo + 1));
      }
    }
    if (middleShare > 0) {
      index.push(rankStrategies);
      credit.push(1 / middleShare);
    }
    if (left > 0) {
      index.push(rankStrategies + 1);
      credit.push(1 / left);
    }
    if (loneLeft > 0) {
      index.push(rankStrategies + 2);
      credit.push(1 / loneLeft);
    }
    if (lonePick > 0) {
      index.push(rankStrategies + 3);
      credit.push(1 / lonePick);
    }
    return { index: Int32Array.from(index), credit: Float64Array.from(credit) };
  };
  const strategyCount = BLIND_MEASURES.length * optionCount + 4;

  /**
   * Does every clue a member shows appear on at least one other member? The
   * fast twin of `optionsAloneOnAClue`; a test holds every served item to that
   * one.
   */
  const cluesShared = (): boolean => {
    for (let clue = 0; clue < fixedCount; clue++) {
      for (let position = 0; position < optionCount; position++) {
        const value = fixedClues[members[position] * fixedCount + clue];
        let holders = 0;
        for (let other = 0; other < optionCount; other++) {
          if (fixedClues[members[other] * fixedCount + clue] === value) holders += 1;
        }
        if (holders < 2) return false;
      }
    }
    let followed = -1;
    for (let position = 0; position < optionCount; position++) followed &= onceMasks[members[position]];
    for (let shape = 0; shape < shapeCount; shape++) {
      if ((followed & (1 << shape)) === 0) continue;
      for (let part = 0; part < partCount; part++) {
        for (let position = 0; position < optionCount; position++) {
          const value = onceParts[(members[position] * shapeCount + shape) * partCount + part];
          let holders = 0;
          for (let other = 0; other < optionCount; other++) {
            if (onceParts[(members[other] * shapeCount + shape) * partCount + part] === value) holders += 1;
          }
          if (holders < 2) return false;
        }
      }
    }
    return true;
  };
  /** Legible lists met, shared clues or not: tells a thin grammar from a strict rule. */
  let legibleLists = 0;

  const evaluate = () => {
    visits += 1;
    legibleLists += 1;
    if (!cluesShared()) return;
    // A full symbol outcome is also a clue; every correct reading needs a
    // wrong option sharing it. Agreement is precomputed, including absence.
    if (selectedIntendedAgreement !== singleClueTarget) return;
    if ((selectedIntendedCoverage & mandatoryCoverage) !== mandatoryCoverage) return;
    let clueCoverage = 0;
    for (const { bit } of obligations) if ((selectedIntendedCoverage & bit) !== 0n) clueCoverage += 1;

    let covered = keptAgreement;
    let closeness = 0;
    for (let position = firstChoice; position < optionCount; position++) {
      covered |= masks[members[position]];
      closeness += distance[members[position]];
    }
    let uncovered = 0;
    for (let aspect = 0; aspect < aspectCount; aspect++) {
      if ((coverable & (1 << aspect)) !== 0 && (covered & (1 << aspect)) === 0) uncovered += 1;
    }

    const key = strategyKey();
    const entry = catalogue.get(key);
    if (!entry) {
      catalogue.set(key, { clueCoverage, uncovered, closeness, tied: 1, chosen: Int32Array.from(chosen) });
      return;
    }
    const order = clueCoverage !== entry.clueCoverage ? entry.clueCoverage - clueCoverage :
      uncovered !== entry.uncovered ? uncovered - entry.uncovered : closeness - entry.closeness;
    if (order > 0) return;
    if (order < 0) {
      entry.tied = 1;
    } else {
      entry.tied += 1;
      if (rng() * entry.tied >= 1) return;
    }
    entry.clueCoverage = clueCoverage;
    entry.uncovered = uncovered;
    entry.closeness = closeness;
    entry.chosen.set(chosen);
  };

  /**
   * Can the first `filled` members still end in a list that shares every
   * clue? A clue with more values held once than there are slots left cannot:
   * each board added pairs at most one of them. Pruning here only skips lists
   * the rule would refuse, so it changes what the search costs, never what it
   * finds — without it, a pool with few shared lists ran out of budget.
   */
  let pruned = false;
  const couldStillShare = (filled: number): boolean => {
    const left = optionCount - filled;
    for (let clue = 0; clue < fixedCount; clue++) {
      let alone = 0;
      for (let position = 0; position < filled; position++) {
        const value = fixedClues[members[position] * fixedCount + clue];
        let holders = 0;
        for (let other = 0; other < filled; other++) {
          if (fixedClues[members[other] * fixedCount + clue] === value) holders += 1;
        }
        if (holders === 1) alone += 1;
      }
      if (alone > left) {
        pruned = true;
        return false;
      }
    }
    return true;
  };

  const search = (windowCount: number) => {
    // Start with choices that keep each hidden transformation undecided.
    // This spends the search budget on complete proofs instead of lists that
    // already allow one of the transformations to be skipped.
    if (witnessGroups.length > 0) {
      const grow = (depth: number, from: number) => {
        if (visits >= DISTRACTOR_SEARCH_BUDGET || intendedVisits >= DISTRACTOR_SEARCH_BUDGET) return;
        intendedVisits += 1;
        if (depth === slots) { evaluate(); return; }
        const missing = mandatoryCoverage & ~selectedIntendedCoverage;
        const nextBit = missing & -missing;
        const choices = Array.from({ length: windowCount }, (_, index) => index)
          .filter((index) => missing !== 0n ? (intendedCoverage[index] & nextBit) !== 0n : index >= from);
        for (const next of choices) {
          if (chosen.subarray(0, depth).includes(next)) continue;
          const position = firstChoice + depth;
          const board = firstChoice + next;
          if (Array.from(members.subarray(0, position)).some((earlier) => legible[board * size + earlier] === 0)) continue;
          chosen[depth] = next;
          members[position] = board;
          place(position, 1);
          const previousCoverage = selectedIntendedCoverage;
          const previousAgreement = selectedIntendedAgreement;
          selectedIntendedCoverage |= intendedCoverage[next];
          selectedIntendedAgreement |= intendedAgreement[next];
          if (couldStillShare(position + 1)) grow(depth + 1, missing !== 0n ? 0 : next + 1);
          selectedIntendedCoverage = previousCoverage;
          selectedIntendedAgreement = previousAgreement;
          place(position, -1);
        }
      };
      grow(0, 0);
      return;
    }
    // A complete independent basis needs one omission witness per relationship.
    // Start with those witnesses instead of spending the budget on lists that
    // cannot require every relationship. The remaining choices still come from
    // the whole pool and use the same clue and options-only checks.
    if (options.requireEveryIntendedClue && witnessGroups.length === 0 && kept.length === 0 && basisBits.length === 1 && obligations.length <= slots) {
      const witnesses = basisBits[0].map((bit) => Array.from({ length: windowCount }, (_, index) => index)
        .filter((index) => intendedCoverage[index] === bit));
      const grow = (depth: number, from: number) => {
        if (visits >= DISTRACTOR_SEARCH_BUDGET) return;
        if (depth === slots) { evaluate(); return; }
        const choices = depth < witnesses.length ? witnesses[depth]
          : Array.from({ length: windowCount - from }, (_, index) => from + index);
        for (const next of choices) {
          if (chosen.subarray(0, depth).includes(next)) continue;
          const position = firstChoice + depth;
          const board = firstChoice + next;
          let distinct = true;
          for (let earlier = 0; earlier < position; earlier++) {
            if (legible[board * size + members[earlier]] === 0) { distinct = false; break; }
          }
          if (!distinct) continue;
          chosen[depth] = next;
          members[position] = board;
          place(position, 1);
          const previousCoverage = selectedIntendedCoverage;
          const previousAgreement = selectedIntendedAgreement;
          selectedIntendedCoverage |= intendedCoverage[next];
          selectedIntendedAgreement |= intendedAgreement[next];
          grow(depth + 1, depth < witnesses.length ? 0 : next + 1);
          selectedIntendedCoverage = previousCoverage;
          selectedIntendedAgreement = previousAgreement;
          place(position, -1);
        }
      };
      grow(0, 0);
      return;
    }
    const bitCount = (mask: bigint) => {
      let count = 0;
      for (let remaining = mask; remaining; remaining &= remaining - 1n) count++;
      return count;
    };
    const maxCoverage = mandatoryCoverage !== 0n
      ? Math.max(...Array.from({ length: windowCount }, (_, index) => bitCount(intendedCoverage[index] & mandatoryCoverage))) : 0;
    const grow = (depth: number, from: number) => {
      if (mandatoryCoverage !== 0n &&
          bitCount(mandatoryCoverage & ~selectedIntendedCoverage) > (slots - depth) * maxCoverage) return;
      if (hasIntendedClues) {
        if (intendedVisits >= DISTRACTOR_SEARCH_BUDGET) return;
        intendedVisits += 1;
      }
      if (depth === slots) {
        evaluate();
        return;
      }
      const position = firstChoice + depth;
      for (let next = from; next <= windowCount - (slots - depth); next++) {
        if (visits >= DISTRACTOR_SEARCH_BUDGET || intendedVisits >= DISTRACTOR_SEARCH_BUDGET) return;
        const board = firstChoice + next;
        const row = board * size + firstChoice;
        let admitted = true;
        for (let earlier = 0; earlier < depth; earlier++) {
          if (legible[row + chosen[earlier]] === 0) {
            admitted = false;
            break;
          }
        }
        if (!admitted) continue;
        chosen[depth] = next;
        members[position] = board;
        place(position, 1);
        const previousCoverage = selectedIntendedCoverage;
        const previousAgreement = selectedIntendedAgreement;
        if (hasIntendedClues) {
          selectedIntendedCoverage |= intendedCoverage[next];
          selectedIntendedAgreement |= intendedAgreement[next];
        }
        if (couldStillShare(position + 1)) grow(depth + 1, next + 1);
        selectedIntendedCoverage = previousCoverage;
        selectedIntendedAgreement = previousAgreement;
        place(position, -1);
      }
    };
    grow(0, 0);
  };

  search(nearCount);
  if (catalogue.size === 0 && reach.length > nearCount) {
    // The nearest few hold no legible list: widen.
    measurePairs(firstChoice + nearCount, size);
    visits = 0;
    intendedVisits = 0;
    search(reach.length);
  }
  if (visits >= DISTRACTOR_SEARCH_BUDGET || intendedVisits >= DISTRACTOR_SEARCH_BUDGET) exhaustedSearches += 1;
  if (catalogue.size === 0 && (legibleLists > 0 || pruned)) {
    throw new CluesNotSharedError(
      `${familyName}: no list of ${DISTRACTORS_PER_ITEM} near misses lets every clue appear on two options` +
        (hasIntendedClues ? " and shares every intended clue" : ""),
    );
  }
  if (catalogue.size === 0) {
    throw new Error(
      `${familyName} needs ${DISTRACTORS_PER_ITEM} near misses but its grammar produced ` +
        `${kept.length + rest.length} distinct candidates, no ${DISTRACTORS_PER_ITEM} of which ` +
        "stand apart from the answer and from each other",
    );
  }
  // Which list to serve: a draw from the mix of lists that leaves every
  // options-only strategy the least credit on the answer (`leastCreditMix`).
  const candidates = [...catalogue];
  const rows = candidates.map(([key]) => strategyCredits(key));
  // Each strategy is measured from the least it can earn on this item: a pool
  // can leave the answer alone on some aspect in every list, or always at one
  // rank, and credit no list can avoid must not crowd the others out of the mix.
  const floors = new Float64Array(strategyCount).fill(Number.POSITIVE_INFINITY);
  const earned = new Float64Array(strategyCount);
  for (const { index, credit } of rows) {
    earned.fill(0);
    for (let entry = 0; entry < index.length; entry++) earned[index[entry]] = credit[entry];
    for (let strategy = 0; strategy < strategyCount; strategy++) {
      if (earned[strategy] < floors[strategy]) floors[strategy] = earned[strategy];
    }
  }
  if (witnessGroups.length > 0 && Math.max(...floors) > MAXIMUM_BLIND_SOLVE_RATE) {
    throw new CluesNotSharedError(`${familyName}: requiring every transformation leaves an unavoidable options-only shortcut`);
  }
  const originalRows = witnessGroups.length > 0
    ? rows.map(({ index, credit }) => ({ index, credit: Float64Array.from(credit) })) : [];
  for (const { index, credit } of rows) {
    for (let entry = 0; entry < index.length; entry++) {
      const unavoidable = floors[index[entry]] - 1 / optionCount;
      if (witnessGroups.length === 0 && unavoidable > 0) credit[entry] -= unavoidable;
    }
  }
  const plays = leastCreditMix(rows, strategyCount);
  if (witnessGroups.length > 0) {
    const expected = new Float64Array(strategyCount);
    for (const play of plays) {
      const { index, credit } = originalRows[play];
      for (let entry = 0; entry < index.length; entry++) expected[index[entry]] += credit[entry] / plays.length;
    }
    if (Math.max(...expected) > MAXIMUM_BLIND_SOLVE_RATE + 1e-9) {
      throw new CluesNotSharedError(`${familyName}: no balanced choice mix requires every transformation`);
    }
  }
  const best = candidates[plays[Math.floor(rng() * plays.length)]][1];
  return [...kept, ...[...best.chosen].map((index) => reach[index])];
}

function distinctOutputs(outputs: readonly (Scene | null)[]): Scene[] {
  const unique = new Map<string, Scene>();
  for (const output of outputs) {
    if (output) unique.set(sceneSignature(output), output);
  }
  return [...unique.values()];
}

function actualWitnesses(
  options: readonly Scene[],
  answerIndex: number,
  witnessFor: (option: Scene) => string | null,
): DistractorWitness[] {
  return options.flatMap((option, optionIndex) => {
    if (optionIndex === answerIndex) return [];
    const witness = witnessFor(option);
    return witness === null ? [] : [{ optionIndex, witness }];
  });
}

/**
 * Each board a list of wrong runs produces, with the reason of the FIRST run
 * that produces it — the same answer as searching the list in order for every
 * option, built once per item instead of once per option.
 */
function firstReasonFor(executions: readonly { output: Scene | null; reason: string }[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const execution of executions) {
    if (!execution.output) continue;
    const key = sceneSignature(execution.output);
    if (!reasons.has(key)) reasons.set(key, execution.reason);
  }
  return reasons;
}

function asCandidate(
  family: FamilyDefinition,
  puzzle: Puzzle,
  answeredStrandPanelIndexes?: readonly number[],
): SceneFamilyCandidate {
  const familyId = family.familyId as SceneFamilyId;
  return {
    familyId,
    puzzle: { ...puzzle, familyId },
    definition: family,
    ...(answeredStrandPanelIndexes === undefined ? {} : { answeredStrandPanelIndexes }),
  };
}

function replayKey(familyId: SceneFamilyId, puzzle: Puzzle, ruleKey: string): string {
  const visible = {
    familyId,
    ruleKey,
    stem: puzzle.stem.map((panel) => "blank" in panel ? "blank" : sceneSignature(panel)),
    options: puzzle.options.map(sceneSignature),
    answerIndex: puzzle.answerIndex,
  };
  return createHash("sha256").update(JSON.stringify(visible)).digest("hex").slice(0, 24);
}

function definition(
  familyId: SceneFamilyId,
  cueIds: readonly string[],
  ruleKey: string,
  validate: (puzzle: Puzzle) => ValidationReport,
): FamilyDefinition {
  return {
    familyId,
    visibleCueIds: () => cueIds,
    validate,
    programFingerprint: () => createHash("sha256").update(`${familyId}:${ruleKey}`).digest("hex").slice(0, 16),
    replayKey: (puzzle) => replayKey(familyId, puzzle, ruleKey),
  };
}

function makePuzzle(
  id: string,
  type: Puzzle["type"],
  layout: Puzzle["layout"],
  instruction: string,
  difficulty: SceneFamilyBucket["difficulty"],
  stem: Puzzle["stem"],
  answer: Scene,
  distractors: readonly Scene[],
  rng: Rng,
  explanation: string,
): Puzzle {
  const { options, answerIndex } = optionOrder(answer, distractors, rng);
  return { id, type, layout, instruction, difficulty, stem, options, answerIndex, explanation };
}

const RELATIONAL_RING_POSITIONS = [
  { row: 0, column: 0 },
  { row: 0, column: 1 },
  { row: 0, column: 2 },
  { row: 1, column: 2 },
  { row: 2, column: 2 },
  { row: 2, column: 1 },
  { row: 2, column: 0 },
  { row: 1, column: 0 },
] as const;

const RELATIONAL_FILLS = FILL_LOOP;

/**
 * Pictures a relational sequence shows before its blank: four, so three steps.
 * Fills loop through three states, so three steps are one full lap: every fill
 * change, the white-after-black one included, is shown once, and the step into
 * the missing picture repeats the first. With three pictures (before
 * scene-families-v20) that last step was always one nobody had seen, and a
 * taker could not tell a loop from, say, white-gray-black-gray-white.
 */
export const RELATIONAL_SEQUENCE_SHOWN_PICTURES = 4;

interface RelationalStepProgram {
  positionDelta: -3 | -2 | -1 | 1 | 2 | 3 | 4;
  fillDelta: 0 | 1 | 2;
}

const RELATIONAL_STEP_GRAMMAR: readonly RelationalStepProgram[] =
  ([-3, -2, -1, 1, 2, 3, 4] as const).flatMap((positionDelta) =>
    ([0, 1, 2] as const).map((fillDelta) => ({ positionDelta, fillDelta })));

function relationalSceneParts(value: Scene): {
  anchor: Scene["objects"][number];
  moving: Scene["objects"][number] & { object: SceneToken };
} | null {
  if (value.rows !== 3 || value.columns !== 3 || value.objects.length !== 2 || value.tiles.length > 0) return null;
  const anchor = value.objects.find((placement) => placement.row === 1 && placement.column === 1);
  const moving = value.objects.find((placement) => placement !== anchor);
  if (!anchor || anchor.object.kind !== "token" || !moving || moving.object.kind !== "token") return null;
  if (RELATIONAL_RING_POSITIONS.every((position) =>
    position.row !== moving.row || position.column !== moving.column)) return null;
  return { anchor, moving: { ...moving, object: moving.object } };
}

function applyRelationalStep(input: Scene, program: RelationalStepProgram): Scene | null {
  const parts = relationalSceneParts(input);
  if (!parts) return null;
  const positionIndex = RELATIONAL_RING_POSITIONS.findIndex((position) =>
    position.row === parts.moving.row && position.column === parts.moving.column);
  const fillIndex = RELATIONAL_FILLS.indexOf(parts.moving.object.fill);
  if (positionIndex === -1 || fillIndex === -1) return null;
  const position = RELATIONAL_RING_POSITIONS[
    (positionIndex + program.positionDelta + RELATIONAL_RING_POSITIONS.length) % RELATIONAL_RING_POSITIONS.length
  ];
  const fill = RELATIONAL_FILLS[(fillIndex + program.fillDelta) % RELATIONAL_FILLS.length];
  return scene([
    parts.anchor,
    { ...position, object: { ...parts.moving.object, fill } },
  ]);
}

function matchingRelationalSteps(examples: readonly { input: Scene; output: Scene }[]): RelationalStepProgram[] {
  return RELATIONAL_STEP_GRAMMAR.filter((program) => examples.every((example) => {
    const output = applyRelationalStep(example.input, program);
    return output !== null && sceneSignature(output) === sceneSignature(example.output);
  }));
}

function relationalSequence(rng: Rng): SceneFamilyCandidate {
  const [anchorShape, movingShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const program = pick(rng, RELATIONAL_STEP_GRAMMAR);
  const startPosition = pick(rng, RELATIONAL_RING_POSITIONS);
  const startFill = pick(rng, RELATIONAL_FILLS);
  const start = scene([
    { row: 1, column: 1, object: token(anchorShape, "solid") },
    { ...startPosition, object: token(movingShape, startFill) },
  ]);
  const shown = [start];
  while (shown.length < RELATIONAL_SEQUENCE_SHOWN_PICTURES) {
    shown.push(applyRelationalStep(shown[shown.length - 1], program)!);
  }
  const last = shown[shown.length - 1];
  const answer = applyRelationalStep(last, program)!;
  const distractors = distinctOutputs(RELATIONAL_STEP_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyRelationalStep(last, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "relational sequence", { answer, familyId: "relational-sequence-v2" });
  const direction = program.positionDelta > 0 ? "clockwise" : "anticlockwise";
  const stepSize = Math.abs(program.positionDelta);
  const puzzle = makePuzzle(
    "prototype-relational-sequence",
    "sequence",
    "row",
    "Continue both changes around the fixed centre token.",
    2,
    [...shown, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    `The black shape in the centre never moves. From each picture to the next, the other shape moves ${squaresWords(stepSize)} ${direction} around the edge of the board, and its fill ${fillStepDescription(program.fillDelta)}. Take that same step once more from the last picture to get the missing one.`,
  );
  const family = definition(
    "relational-sequence-v2",
    ["ordered-perimeter-slots", "fixed-centre-anchor", "fill-states"],
    JSON.stringify(program),
    (candidate) => {
      const pictures = candidate.stem.slice(0, -1).map(scenePanel);
      if (pictures.length < 2 || pictures.some((picture) => !picture)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const shownPictures = pictures as Scene[];
      const query = shownPictures[shownPictures.length - 1];
      const examples = shownPictures.slice(1).map((output, index) => ({ input: shownPictures[index], output }));
      const survivors = matchingRelationalSteps(examples);
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyRelationalStep(query, candidateProgram)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["ordered-perimeter-slots", "fixed-centre-anchor", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (sceneSignature(option) === sceneSignature(query)) return "repeats the last scene instead of continuing the relation";
          const wrongRule = RELATIONAL_STEP_GRAMMAR.find((candidateProgram) => {
            const output = applyRelationalStep(query, candidateProgram);
            return output !== null && sceneSignature(output) === sceneSignature(option) &&
              !examples.every((example) => {
                const predicted = applyRelationalStep(example.input, candidateProgram);
                return predicted !== null && sceneSignature(predicted) === sceneSignature(example.output);
              });
          });
          return wrongRule
            ? `the ${wrongRule.positionDelta}, ${wrongRule.fillDelta} step rule fails a shown transition`
            : null;
        }),
      };
    },
  );
  // Single-strand row: every visible panel belongs to the answered strand, and
  // the blank is the next slot at the same stride of one.
  return asCandidate(family, puzzle, shown.map((_, index) => index));
}

type PairingRelation = "same" | "different";

interface AttributePairingProgram {
  shape: PairingRelation;
  fill: PairingRelation;
  direction: "right" | "down";
}

const ATTRIBUTE_PAIRING_GRAMMAR: readonly AttributePairingProgram[] =
  (["same", "different"] as const).flatMap((shape) =>
    (["same", "different"] as const).flatMap((fill) =>
      (["right", "down"] as const).map((direction) => ({ shape, fill, direction }))));

function singleTokenPlacement(value: Scene): (Scene["objects"][number] & { object: SceneToken }) | null {
  const placement = value.objects[0];
  return value.objects.length === 1 && value.tiles.length === 0 && placement?.object.kind === "token"
    ? { ...placement, object: placement.object }
    : null;
}

function pairingMatches(first: Scene, second: Scene, program: AttributePairingProgram): boolean {
  const left = singleTokenPlacement(first);
  const right = singleTokenPlacement(second);
  if (!left || !right) return false;
  const shapeMatches = left.object.shape === right.object.shape;
  const fillMatches = left.object.fill === right.object.fill;
  const placementMatches = program.direction === "right"
    ? right.row === left.row && right.column === left.column + 1
    : right.row === left.row + 1 && right.column === left.column;
  return shapeMatches === (program.shape === "same") &&
    fillMatches === (program.fill === "same") && placementMatches;
}

function attributePairing(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, ATTRIBUTE_PAIRING_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // The question's shape starts in the worked pair's first fill, and a fill
  // change takes it to the worked pair's second fill, so the one fill change the
  // answer needs is the one shown. Until 2026-10-04 the question started in a
  // third fill and changed to the first: "the fill changes" was the rule, but
  // the shown change also read as "one step darker" or "swap black and white",
  // and those readings kept the question's fill, which is an option. Both models
  // took the swap reading in the v25 re-run, and Codex the step reading in the
  // v23 one (docs/plans/one-reading-per-worked-row.md).
  const fills = shuffled(rng, RELATIONAL_FILLS);
  const workedStart = { row: 0, column: 0 } as const;
  const workedEnd = program.direction === "right" ? { row: 0, column: 1 } : { row: 1, column: 0 };
  const queryStart = { row: 1, column: 1 } as const;
  const a = one(shapes[0], workedStart.row, workedStart.column, fills[0]);
  const b = one(
    program.shape === "same" ? shapes[0] : shapes[1],
    workedEnd.row,
    workedEnd.column,
    program.fill === "same" ? fills[0] : fills[1],
  );
  const query = one(shapes[2], queryStart.row, queryStart.column, fills[0]);
  // One partner token per pairing rule in the grammar. The rule that fits the
  // worked pair produces the answer; each of the others produces a near miss
  // witnessed by exactly the rule that predicts it and fails the worked pair.
  const partnerFor = (candidateProgram: AttributePairingProgram): Scene => {
    const end = candidateProgram.direction === "right"
      ? { row: queryStart.row, column: queryStart.column + 1 }
      : { row: queryStart.row + 1, column: queryStart.column };
    return one(
      candidateProgram.shape === "same" ? shapes[2] : shapes[3],
      end.row,
      end.column,
      candidateProgram.fill === "same" ? fills[0] : fills[1],
    );
  };
  const answer = partnerFor(program);
  const competingPartners = ATTRIBUTE_PAIRING_GRAMMAR
    .map(partnerFor)
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const puzzle = makePuzzle(
    "prototype-attribute-pairing",
    "analogy",
    "analogy",
    "Choose the token that keeps all three relationships.",
    2,
    [a, b, query],
    answer,
    selectDistractors(distinctOutputs(competingPartners), rng, "attribute pairing", { answer, familyId: "attribute-pairing-v1" }),
    rng,
    `From the top-left board to the top-right board, three things happen: the shape ${program.shape === "same" ? "stays the same" : "changes to a different shape"}, its fill ${program.fill === "same" ? "stays the same" : `turns from ${FILL_WORDS[fills[0]]} to ${FILL_WORDS[fills[1]]}`}, and it moves one square ${program.direction === "right" ? "to the right" : "down"}. Make the same three changes to the shape on the bottom-left board. The missing board has ${program.shape === "same" ? "the same shape" : "a different shape"} ${program.fill === "same" ? "in the same fill" : `in ${FILL_WORDS[fills[1]]}`}, one square ${program.direction === "right" ? "to the right of" : "below"} where that shape sits.`,
  );
  const family = definition(
    "attribute-pairing-v1",
    ["worked-token-pair", "shape-relation", "fill-relation", "pair-direction"],
    JSON.stringify(program),
    (candidate) => {
      const [workedFirst, workedSecond, queryInput] = candidate.stem.map(scenePanel);
      if (!workedFirst || !workedSecond || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = ATTRIBUTE_PAIRING_GRAMMAR.filter((candidateProgram) =>
        pairingMatches(workedFirst, workedSecond, candidateProgram));
      const selections = survivors.map((candidateProgram) => candidate.options.flatMap((option, optionIndex) =>
        pairingMatches(queryInput, option, candidateProgram) ? [optionIndex] : []));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["worked-token-pair", "shape-relation", "fill-relation", "pair-direction"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          survivors.length > 0 && survivors.every((candidateProgram) => !pairingMatches(queryInput, option, candidateProgram))
            ? "breaks at least one relationship shown by the worked token pair"
            : null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

type AnalogySpatialOperation = Extract<SceneUnaryOperation, { kind: "reflect" | "rotate" }>;

interface AnalogyCompositionProgram {
  spatial: AnalogySpatialOperation;
  fillDelta: 1 | 2;
  /**
   * Quarter-turns applied to every orientable token, on the spot. Present only
   * in the d4 bucket, whose worked pair shows three changes rather than two.
   */
  turn?: 1 | 3;
}

const ANALOGY_SPATIAL_GRAMMAR: readonly AnalogySpatialOperation[] = [
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
] as const;

/** d3: the board moves and every fill advances. Two visible changes. */
const ANALOGY_COMPOSITION_GRAMMAR: readonly AnalogyCompositionProgram[] =
  ANALOGY_SPATIAL_GRAMMAR.flatMap((spatial) =>
    ([1, 2] as const).map((fillDelta) => ({ spatial, fillDelta })));

/** d4: the same two changes, plus a turn of every orientable token. */
const ANALOGY_TURN_GRAMMAR: readonly AnalogyCompositionProgram[] =
  ANALOGY_COMPOSITION_GRAMMAR.flatMap((program) =>
    ([1, 3] as const).map((turn) => ({ ...program, turn })));

const COMPOSITIONAL_ANALOGY_TURN_BUCKET = "compositional-analogy-d4";

function cycleObjectFill(object: SceneObject, fillDelta: 1 | 2): SceneObject {
  const cycle = (value: SceneToken): SceneToken => ({
    ...value,
    fill: RELATIONAL_FILLS[(RELATIONAL_FILLS.indexOf(value.fill) + fillDelta) % RELATIONAL_FILLS.length],
  });
  return object.kind === "token"
    ? cycle(object)
    : { ...object, contents: object.contents.map(cycle) };
}

function applyAnalogyComposition(input: Scene, program: AnalogyCompositionProgram): Scene | null {
  const moved = applySceneUnary(input, program.spatial);
  if (moved === null) return null;
  const cycled: Scene = {
    ...moved,
    objects: moved.objects.map((placement) => ({
      ...placement,
      object: cycleObjectFill(placement.object, program.fillDelta),
    })),
  };
  return program.turn === undefined
    ? cycled
    : applySceneUnary(cycled, { kind: "turn", quarterTurns: program.turn });
}

/**
 * A near miss of an analogy program: the same three kinds of change, where any
 * of them may be SKIPPED — the board left where it was, the fills left alone,
 * the arrows left pointing the same way. Never a candidate rule: the worked
 * pair shows every change, so skipping one always fails it.
 *
 * Added 2026-09-29. With the rule grammar alone the family had nine near misses
 * (ten programs, less the answer), too few for the option list to be anything
 * but a star around the answer, which a solver who never read the question
 * could pick out (docs/plans/blind-answer-leak.md). Applying only some of the
 * demonstrated changes is the commonest real mistake on an analogy, and it
 * gives each wrong change a sibling that shares it.
 */
interface AnalogyNearMissProgram {
  spatial: AnalogySpatialOperation | null;
  fillDelta: 0 | 1 | 2;
  turn: 0 | 1 | 3;
}

function applyAnalogyNearMiss(input: Scene, program: AnalogyNearMissProgram): Scene | null {
  const moved = program.spatial === null ? input : applySceneUnary(input, program.spatial);
  if (moved === null) return null;
  const { fillDelta } = program;
  const cycled: Scene = fillDelta === 0 ? moved : {
    ...moved,
    objects: moved.objects.map((placement) => ({ ...placement, object: cycleObjectFill(placement.object, fillDelta) })),
  };
  return program.turn === 0 ? cycled : applySceneUnary(cycled, { kind: "turn", quarterTurns: program.turn });
}

/** Every near-miss program: each change made, made differently, or skipped. */
function analogyNearMissGrammar(turning: boolean): AnalogyNearMissProgram[] {
  return [...ANALOGY_SPATIAL_GRAMMAR, null].flatMap((spatial) =>
    ([0, 1, 2] as const).flatMap((fillDelta) =>
      (turning ? ([0, 1, 3] as const) : ([0] as const)).map((turn) => ({ spatial, fillDelta, turn }))));
}

/** Does this near-miss program skip one of the demonstrated changes? */
function analogyNearMissSkips(program: AnalogyNearMissProgram, turning: boolean): boolean {
  return program.spatial === null || program.fillDelta === 0 || (turning && program.turn === 0);
}

/*
 * Explanations are read by the person who just took the test, on the review
 * screen. They say what to look at and how to reach the answer, in the words
 * the picture gives: shapes, squares, boards, white, grey and black, arrows,
 * jigsaw pieces. Never how the item was made — no distractors, near misses,
 * grammars, programs or primitives (owner's rule, 2026-10-04; CLAUDE.md).
 * A test fails any explanation that uses the generator's words.
 */

/** Fill names as a person sees them. */
const FILL_WORDS: Readonly<Record<SceneToken["fill"], string>> = { outline: "white", half: "grey", solid: "black" };

/** The fill loop as a step rule: "stays the same", or which way it moves round. */
function fillStepDescription(delta: number): string {
  switch (((delta % 3) + 3) % 3) {
    case 0: return "stays the same";
    case 1: return "moves one step along white → grey → black → white (white becomes grey, grey becomes black, black becomes white)";
    default: return "moves two steps along white → grey → black → white (white becomes black, grey becomes white, black becomes grey)";
  }
}

/** A square of the 3 × 3 board, named the way a person would point to it. */
function squareName(position: ScenePosition): string {
  const rows = ["top", "middle", "bottom"];
  const columns = ["left", "middle", "right"];
  if (position.row === 1 && position.column === 1) return "centre";
  return `${rows[position.row]}-${columns[position.column]}`;
}

function quarterTurnsWords(quarterTurns: number): string {
  if (quarterTurns === 2) return "a half-turn";
  return `a quarter-turn ${quarterTurns === 1 ? "clockwise" : "anticlockwise"}`;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const squaresWords = (count: number) => `${NUMBER_WORDS[count] ?? count} square${count === 1 ? "" : "s"}`;

/**
 * A move of the whole board, as a verb phrase: "rotates the board a
 * quarter-turn clockwise" (`does`) or "rotate the board …" (`do`). A board move
 * carries every shape to a new square and never turns one; a turn keeps every
 * shape in its square and turns it.
 */
function boardMoveDescription(operation: SceneUnaryOperation | AnalogySpatialOperation, form: "does" | "do"): string {
  const verb = (does: string, doIt: string) => (form === "does" ? does : doIt);
  if (operation.kind === "reflect") {
    // `horizontal` swaps the columns, so the board turns into its mirror image.
    return operation.axis === "horizontal"
      ? `${verb("mirrors", "mirror")} the board left to right`
      : `${verb("flips", "flip")} the board top to bottom`;
  }
  if (operation.kind === "rotate") return `${verb("rotates", "rotate")} the board ${quarterTurnsWords(operation.quarterTurns)}`;
  if (operation.kind === "turn") {
    return `${verb("keeps", "keep")} every shape in its square and ${verb("turns", "turn")} each one ${quarterTurnsWords(operation.quarterTurns)} on the spot`;
  }
  if (operation.kind === "translate") {
    const direction = operation.rowDelta === -1 ? "up" : operation.rowDelta === 1 ? "down"
      : operation.columnDelta === -1 ? "left" : "right";
    return `${verb("slides", "slide")} every shape one square ${direction}; a shape pushed off one edge comes back on the opposite edge`;
  }
  return operation.kind;
}

/**
 * How two boards combine square by square, as a verb phrase about the result.
 * `first` and `second` name the two boards the way the picture shows them
 * ("left" and "middle", or "top" and "middle").
 */
function combineDescription(operation: SceneBinaryOperation, first: string, second: string): string {
  switch (operation) {
    case "union-left":
      return `keeps every shape from the ${first} and ${second} boards; where both use a square, the ${first} board's shape stays`;
    case "union-right":
      return `keeps every shape from the ${first} and ${second} boards; where both use a square, the ${second} board's shape stays`;
    case "intersection":
      return `keeps only the shapes that are identical, in the same square, on the ${first} and ${second} boards`;
    case "overlap-left":
      return `keeps only the squares the ${first} and ${second} boards both use, with the ${first} board's shape`;
    case "overlap-right":
      return `keeps only the squares the ${first} and ${second} boards both use, with the ${second} board's shape`;
    case "subtract":
      return `keeps the ${first} board's shapes, except where the ${second} board has the identical shape in the same square`;
    case "mask-out":
      return `keeps the ${first} board's shapes, except in squares the ${second} board uses`;
    case "exclusive":
      return `keeps the shapes in squares that only one of the ${first} and ${second} boards uses`;
  }
}

/**
 * The fills of an analogy's worked board and of its question board: the same
 * two fills, drawn at random, each board in its own order. Every fill change
 * the question needs is then shown by a token on the worked board.
 *
 * Until scene-families-v20 the worked board always held white and gray and the
 * question board gray and black, so the question asked what a black shape
 * becomes and the worked pair never showed one; when fills stepped forward the
 * answer rested on a loop the taker had never seen close.
 */
function sharedAnalogyFills(rng: Rng): [SceneToken["fill"][], SceneToken["fill"][]] {
  const pair = shuffled(rng, RELATIONAL_FILLS).slice(0, 2);
  return [pair, shuffled(rng, pair)];
}

function compositionalAnalogy(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const turning = bucket.bucket === COMPOSITIONAL_ANALOGY_TURN_BUCKET;
  const grammar = turning ? ANALOGY_TURN_GRAMMAR : ANALOGY_COMPOSITION_GRAMMAR;
  const program = pick(rng, grammar);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const [workedFills, queryFills] = sharedAnalogyFills(rng);
  // The d4 bucket turns tokens as well as moving them, and a turn can only be
  // read off a token that has a direction, so one slot of each board carries an
  // arrow. d3 keeps the plain shapes it has always drawn.
  const a = scene([
    { row: 0, column: 0, object: token(turning ? "arrow" : shapes[0], workedFills[0]) },
    { row: 1, column: 2, object: token(shapes[1], workedFills[1]) },
  ]);
  const b = applyAnalogyComposition(a, program)!;
  const c = scene([
    { row: 0, column: 1, object: token(shapes[2], queryFills[0]) },
    { row: 2, column: 0, object: token(turning ? "arrow" : shapes[3], queryFills[1]) },
  ]);
  const answer = applyAnalogyComposition(c, program)!;
  const nearMissGrammar = analogyNearMissGrammar(turning);
  // Every other program in the grammar, and every run that skips one of the
  // demonstrated changes; each fails the worked pair. Applying a mistake to
  // only one shape makes checking both shape outcomes necessary.
  const wrongExecutionsFor = (input: Scene, output: Scene, query: Scene) =>
    nearMissGrammar.flatMap((candidateProgram) => {
      const worked = applyAnalogyNearMiss(input, candidateProgram);
      if (worked !== null && sceneSignature(worked) === sceneSignature(output)) return [];
      return [{
        output: applyAnalogyNearMiss(query, candidateProgram),
        reason: analogyNearMissSkips(candidateProgram, turning)
          ? "skips one of the changes the worked pair shows"
          : "this spatial-and-fill program fails the worked pair",
      }];
    });
  const wrongExecutions = wrongExecutionsFor(a, b, c);
  const distractors = distinctOutputs([
    ...wrongExecutions,
    ...partialSceneExecutions(answer, wrongExecutions, "features"),
  ].map((execution) => execution.output))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "compositional analogy", { answer, familyId: "compositional-analogy-v2" });
  const cueIds = turning
    ? ["worked-pair", "board-slots", "fill-states", "token-orientation"]
    : ["worked-pair", "board-slots", "fill-states"];
  // The d3 wording names two changes and d4 three. Both were reissued in
  // scene-families-v19, when skipped changes joined the near misses.
  const explanation = program.turn === undefined
    ? `From the top-left board to the top-right board, two things change. The change ${boardMoveDescription(program.spatial, "does")}, so every shape moves to a new square, and every fill ${fillStepDescription(program.fillDelta)}. Make both changes to the bottom-left board to get the missing board.`
    : `From the top-left board to the top-right board, three things change. The change ${boardMoveDescription(program.spatial, "does")}, so every shape moves to a new square; every fill ${fillStepDescription(program.fillDelta)}; and every arrow turns ${quarterTurnsWords(program.turn)} in its own square. Moving to a new square does not turn an arrow, so its new direction comes from that turn alone. Make all three changes to the bottom-left board to get the missing board.`;
  const puzzle = makePuzzle(
    "prototype-compositional-analogy",
    "analogy",
    "analogy",
    turning ? "Apply all three changes from the worked pair." : "Apply both changes from the worked pair.",
    bucket.difficulty,
    [a, b, c],
    answer,
    selectedDistractors,
    rng,
    explanation,
  );
  const family = definition(
    "compositional-analogy-v2",
    cueIds,
    JSON.stringify(program),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = grammar.filter((candidateProgram) => {
        const predicted = applyAnalogyComposition(input, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyAnalogyComposition(query, candidateProgram)));
      // Every near-miss program that fails the worked pair, and what it predicts.
      const wrongExecutions = wrongExecutionsFor(input, output, query);
      const reasons = firstReasonFor([
        ...wrongExecutions,
        ...(predictions.length === 1 ? partialSceneExecutions(predictions[0], wrongExecutions, "features") : []),
      ]);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/** The eight ways two boards combine (`SCENE_BINARY_OPERATIONS`). */
const SCENE_BINARY_GRAMMAR = SCENE_BINARY_OPERATIONS;

interface RelationalMatrixProgram {
  rowOperation: SceneBinaryOperation;
  columnOperation: SceneBinaryOperation;
}

const RELATIONAL_MATRIX_GRAMMAR: readonly RelationalMatrixProgram[] =
  SCENE_BINARY_GRAMMAR.flatMap((rowOperation) =>
    SCENE_BINARY_GRAMMAR.map((columnOperation) => ({ rowOperation, columnOperation })));

/**
 * Every non-empty subset of the four corner atoms, as a bitmask. The four input
 * boards are drawn from here rather than being fixed per rule pair: a fixed set
 * of inputs makes the whole option list collapse to three or four distinct
 * boards, which is not enough near misses to fill an option list.
 */
const RELATIONAL_MATRIX_MASKS: readonly number[] = Array.from({ length: 15 }, (_, index) => index + 1);

/** Input draws tried before this family gives up on the sampled rule pair. */
const RELATIONAL_MATRIX_INPUT_ATTEMPTS = 300;

/**
 * Which of each corner's three tokens a board holds — one base-3 digit per
 * corner, so 3^4 draws.
 *
 * It was two per corner until 2026-08-27. With two, a shape could sit at only
 * two of the four corners, so a board carrying the answer's shapes almost always
 * carried them in the answer's cells too — the same board. That left the answer
 * as the only option with its shape multiset in 80% of items, and a solver who
 * worked out which tokens survive was finished without ever working out where
 * they go. A third token per corner gives every shape three homes, which is what
 * lets a wrong option agree with the answer on shapes and still differ on
 * position.
 */
const RELATIONAL_MATRIX_VARIANTS: readonly number[] = Array.from({ length: 81 }, (_, index) => index);

function relationalMatrix(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // Three tokens per corner, not one.
  //
  // Until 2026-08-27 each corner held a single fixed token, so any two input
  // boards agreed wherever they overlapped and a CLASH was impossible. That had
  // the same two costs it had in `visual-set-algebra`: the eight combining
  // operations collapsed back to four, and — measured — every single item was
  // solvable from the answer's footprint alone, without ever reading a shape.
  // A solver only had to infer one of the two rules. With two tokens per corner
  // the operations separate, and the option list can hold a board that occupies
  // exactly the answer's cells while getting a token wrong, so knowing where
  // the tokens go no longer picks the answer on its own.
  const corners = [
    { row: 0, column: 0 },
    { row: 0, column: 2 },
    { row: 2, column: 0 },
    { row: 2, column: 2 },
  ] as const;
  const atomAt = (index: number, variant: number) =>
    ({ ...corners[index], object: token(shapes[(index + variant) % shapes.length]) });
  /**
   * `mask` says which corners a board occupies; `variants` says which of the
   * corner's two tokens it holds there. Two boards sharing a corner but not a
   * variant are the clash the old fixed atoms could never produce.
   */
  const fromDraw = (mask: number, variants: number) =>
    scene(corners.flatMap((_, index) =>
      (mask & (1 << index)) === 0 ? [] : [atomAt(index, Math.floor(variants / 3 ** index) % 3)]));

  // The same visible-board executions supply both the pool and its witnesses.
  // A partial execution makes one corner wrong while keeping the other
  // corners correct, including a corner whose correct state is empty.
  const wrongExecutionsFor = (visible: readonly Scene[], answer: Scene) => {
    const [, , rowA, , , rowB, colA, colB] = visible;
    const seen = new Set<string>([sceneSignature(answer)]);
    const correctPairs = new Set([
      `${sceneSignature(colA)}>${sceneSignature(colB)}`,
      `${sceneSignature(rowA)}>${sceneSignature(rowB)}`,
    ]);
    return [
      ...SCENE_BINARY_GRAMMAR.flatMap((operation) => [
        { output: applySceneBinary(colA, colB, operation), reason: `${operation} applied to the bottom pair does not satisfy both grid directions` },
        { output: applySceneBinary(rowA, rowB, operation), reason: `${operation} applied to the right pair does not satisfy both grid directions` },
        { output: applySceneBinary(colB, colA, operation), reason: `${operation} applied to the bottom pair in reverse order` },
        { output: applySceneBinary(rowB, rowA, operation), reason: `${operation} applied to the right pair in reverse order` },
      ]),
      ...[colA, colB, rowA, rowB].map((output) => ({
        output, reason: "copies a board beside the blank instead of combining both boards",
      })),
      ...visible.flatMap((left) => visible.flatMap((right) => {
        if (sceneSignature(left) === sceneSignature(right) ||
            correctPairs.has(`${sceneSignature(left)}>${sceneSignature(right)}`)) return [];
        return SCENE_BINARY_GRAMMAR.map((operation) => ({
          output: applySceneBinary(left, right, operation),
          reason: `${operation} applied to the wrong two boards of the grid`,
        }));
      })),
      ...visible.map((output) => ({ output, reason: "copies a board from the grid instead of combining the two beside the blank" })),
    ].filter((execution) => {
      if (execution.output === null) return false;
      const key = sceneSignature(execution.output);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  /**
   * Build the whole board from four input masks, or reject the draw.
   *
   * A draw is kept only when the completed grid is well posed: every derived
   * board exists, the two visible rows and the two visible columns each pin
   * down a single operation, and the near misses are numerous enough to fill
   * the option list. Rejecting here rather than at acceptance keeps a thin draw
   * from costing the assembler a whole retry.
   */
  const build = (
    program: RelationalMatrixProgram,
    draws: readonly { mask: number; variants: number }[],
  ) => {
    const [topLeft, topMiddle, middleLeft, middleMiddle] =
      draws.map((draw) => fromDraw(draw.mask, draw.variants));
    const topRight = applySceneBinary(topLeft, topMiddle, program.rowOperation);
    const middleRight = applySceneBinary(middleLeft, middleMiddle, program.rowOperation);
    const bottomLeft = applySceneBinary(topLeft, middleLeft, program.columnOperation);
    const bottomMiddle = applySceneBinary(topMiddle, middleMiddle, program.columnOperation);
    if (!topRight || !middleRight || !bottomLeft || !bottomMiddle) return null;
    const answer = applySceneBinary(bottomLeft, bottomMiddle, program.rowOperation);
    if (!answer) return null;

    // A combined board that just repeats one of its two inputs makes the grid
    // look like it is copying rather than combining, and hides the rule.
    const repeatsAnInput = ([
      [topRight, topLeft, topMiddle],
      [middleRight, middleLeft, middleMiddle],
      [bottomLeft, topLeft, middleLeft],
      [bottomMiddle, topMiddle, middleMiddle],
    ] as const).some(([output, left, right]) =>
      sceneSignature(output) === sceneSignature(left) ||
      sceneSignature(output) === sceneSignature(right));
    if (repeatsAnInput) return null;

    // The solver may only use the operations the visible rows and columns leave
    // standing. If those survivors disagree about the missing board, the item
    // has more than one defensible answer and the draw is discarded.
    const consistent = (examples: readonly { left: Scene; right: Scene; output: Scene }[]) =>
      SCENE_BINARY_GRAMMAR.filter((operation) => examples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
    const rowSurvivors = consistent([
      { left: topLeft, right: topMiddle, output: topRight },
      { left: middleLeft, right: middleMiddle, output: middleRight },
    ]);
    const columnSurvivors = consistent([
      { left: topLeft, right: middleLeft, output: bottomLeft },
      { left: topMiddle, right: middleMiddle, output: bottomMiddle },
    ]);
    const predictions = distinctOutputs(rowSurvivors.flatMap((rowOperation) =>
      columnSurvivors.flatMap((columnOperation) => {
        const rowPrediction = applySceneBinary(bottomLeft, bottomMiddle, rowOperation);
        const columnPrediction = applySceneBinary(topRight, middleRight, columnOperation);
        return rowPrediction && columnPrediction &&
          sceneSignature(rowPrediction) === sceneSignature(columnPrediction)
          ? [rowPrediction]
          : [];
      })));
    if (predictions.length !== 1 || sceneSignature(predictions[0]) !== sceneSignature(answer)) return null;

    // Four kinds of near miss, each witnessed by a mistake a solver can
    // actually make: applying an operation that fails a worked row or column;
    // applying the right operation to the two boards in the wrong order (order
    // matters for subtract — for the commutative operations the swapped result
    // repeats the forward one and is deduplicated away); copying one of the
    // two boards being combined instead of combining them; and combining a
    // wrong PAIR of the visible boards.
    //
    // That fourth kind was added on 2026-08-27. The first three draw only on the
    // four boards that border the blank, and measured, that pool was too narrow
    // to hold a board carrying the answer's own shapes: in 80% of items the
    // answer was the only option with its shape multiset, so reading the row
    // rule alone finished the item and the column rule was decoration. Reaching
    // for the wrong two boards is the commonest real mistake on a 3x3 grid, and
    // it widens the pool enough that the option list can agree with the answer
    // on shapes while still differing on where those shapes sit.
    const visible = [topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle];
    const wrongExecutions = wrongExecutionsFor(visible, answer);
    const distractors = distinctOutputs([
      ...wrongExecutions.map((execution) => execution.output),
      ...partialSceneExecutions(answer, wrongExecutions, "squares").map((execution) => execution.output),
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
    if (distractors.length < DISTRACTORS_PER_ITEM) return null;
    // The draw must also be able to hide the answer. A grid whose pool holds no
    // board carrying the answer's own shapes hands the item to whoever works out
    // which tokens survive, without ever working out where they land.
    if (!poolCoversEveryAspect(answer, distractors)) return null;

    return { topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, answer, distractors };
  };

  // Try the rule pairs in a random order and keep the first one whose inputs
  // work out. A pair that no draw can make well posed is simply skipped, so the
  // family never fails on an unusable combination it happened to sample first.
  let program: RelationalMatrixProgram | null = null;
  let board: ReturnType<typeof build> = null;
  for (const candidateProgram of shuffled(rng, RELATIONAL_MATRIX_GRAMMAR)) {
    for (let attempt = 0; attempt < RELATIONAL_MATRIX_INPUT_ATTEMPTS && !board; attempt++) {
      board = build(candidateProgram, [0, 0, 0, 0].map(() => ({
        mask: pick(rng, RELATIONAL_MATRIX_MASKS),
        variants: pick(rng, RELATIONAL_MATRIX_VARIANTS),
      })));
    }
    if (board) {
      program = candidateProgram;
      break;
    }
  }
  if (!board || !program) throw new Error("relational matrix found no well-posed input boards");
  const {
    topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, answer,
  } = board;
  const selectedDistractors = selectDistractors(board.distractors, rng, "relational matrix", {
    answer,
    familyId: "relational-matrix-v2",
    clueModel: SCENE_FAMILY_CLUE_MODELS["relational-matrix-v2"],
  });
  const puzzle = makePuzzle(
    "prototype-relational-matrix",
    "matrix",
    "grid3x3",
    "Infer the row operation and the column operation. Which board satisfies both?",
    4,
    [topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    `Every row works the same way: the right-hand board ${combineDescription(program.rowOperation, "left", "middle")}. Every column works too: the bottom board ${combineDescription(program.columnOperation, "top", "middle")}. The missing corner follows both rules, so combine the two boards to its left by the row rule and check the result against the two boards above it.`,
  );
  puzzle.gridFlow = "rowsAndColumns";
  const family = definition(
    "relational-matrix-v2",
    ["worked-row-relations", "worked-column-relations", "shared-coordinate-frame"],
    JSON.stringify({ row: program.rowOperation, column: program.columnOperation }),
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      if (panels.some((panel, index) => index !== 8 && panel === null)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const [a, b, rowA, c, d, rowB, colA, colB] = panels as Scene[];
      const rowExamples = [{ left: a, right: b, output: rowA }, { left: c, right: d, output: rowB }];
      const columnExamples = [{ left: a, right: c, output: colA }, { left: b, right: d, output: colB }];
      const rowSurvivors = SCENE_BINARY_GRAMMAR.filter((operation) => rowExamples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const columnSurvivors = SCENE_BINARY_GRAMMAR.filter((operation) => columnExamples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predictions = distinctOutputs(rowSurvivors.flatMap((rowOperation) =>
        columnSurvivors.flatMap((columnOperation) => {
          const rowPrediction = applySceneBinary(colA, colB, rowOperation);
          const columnPrediction = applySceneBinary(rowA, rowB, columnOperation);
          return rowPrediction && columnPrediction && sceneSignature(rowPrediction) === sceneSignature(columnPrediction)
            ? [rowPrediction]
            : [];
        })));
      const partialReasons = predictions.length === 1
        ? firstReasonFor(partialSceneExecutions(predictions[0],
          wrongExecutionsFor([a, b, rowA, c, d, rowB, colA, colB], predictions[0]), "squares"))
        : new Map<string, string>();
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-row-relations", "worked-column-relations", "shared-coordinate-frame"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const predicts = (left: Scene, right: Scene, operation: SceneBinaryOperation): boolean => {
            const output = applySceneBinary(left, right, operation);
            return output !== null && sceneSignature(output) === sceneSignature(option);
          };
          const rowAlternative = SCENE_BINARY_GRAMMAR.find((operation) =>
            predicts(colA, colB, operation) && !rowSurvivors.includes(operation));
          if (rowAlternative) return `${rowAlternative} predicts this board but fails a worked row`;
          const columnAlternative = SCENE_BINARY_GRAMMAR.find((operation) =>
            predicts(rowA, rowB, operation) && !columnSurvivors.includes(operation));
          if (columnAlternative) return `${columnAlternative} predicts this board but fails a worked column`;
          // A rule can fit the worked rows and still be contradicted by the
          // column direction (or the other way round). Such a board loses on the
          // second direction, not on the first.
          const rowOnly = rowSurvivors.find((operation) => predicts(colA, colB, operation));
          if (rowOnly) return `${rowOnly} fits the rows but no column rule agrees with this board`;
          const columnOnly = columnSurvivors.find((operation) => predicts(rowA, rowB, operation));
          if (columnOnly) return `${columnOnly} fits the columns but no row rule agrees with this board`;
          const swappedRow = SCENE_BINARY_GRAMMAR.find((operation) => predicts(colB, colA, operation));
          if (swappedRow) return `${swappedRow} predicts this board only with the two boards in the wrong order`;
          const swappedColumn = SCENE_BINARY_GRAMMAR.find((operation) => predicts(rowB, rowA, operation));
          if (swappedColumn) return `${swappedColumn} predicts this board only with the two boards in the wrong order`;
          const copied = [a, b, rowA, c, d, rowB, colA, colB].some((board) =>
            sceneSignature(board) === sceneSignature(option));
          if (copied) return "copies a board from the grid instead of combining the two beside the blank";
          // Last, the widest category: the right kind of rule applied to the
          // wrong two boards of the grid. It is checked last so a board that any
          // sharper mistake explains is named by that mistake instead.
          const visible = [a, b, rowA, c, d, rowB, colA, colB];
          for (const left of visible) {
            for (const right of visible) {
              if (sceneSignature(left) === sceneSignature(right)) continue;
              const operation = SCENE_BINARY_GRAMMAR.find((candidateOperation) =>
                predicts(left, right, candidateOperation));
              if (operation) return `${operation} applied to the wrong two boards of the grid`;
            }
          }
          return partialReasons.get(sceneSignature(option)) ?? null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

interface SetAlgebraProgram {
  operation: SceneBinaryOperation;
  spatial: AnalogySpatialOperation;
  /**
   * Quarter-turns applied to every orientable token of the combined board,
   * after the spatial move. Present only in the d5 bucket, whose rule is three
   * visible steps rather than two.
   */
  turn?: 1 | 3;
}

const SET_ALGEBRA_SPATIAL_GRAMMAR: readonly AnalogySpatialOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
] as const;

/** d4: combine the two boards, then move the result. Two visible steps. */
const SET_ALGEBRA_GRAMMAR: readonly SetAlgebraProgram[] = SCENE_BINARY_GRAMMAR.flatMap((operation) =>
  SET_ALGEBRA_SPATIAL_GRAMMAR.map((spatial) => ({ operation, spatial })));

/** d5: the same two steps, then a turn of every orientable token. */
const SET_ALGEBRA_TURN_GRAMMAR: readonly SetAlgebraProgram[] = SET_ALGEBRA_GRAMMAR.flatMap((program) =>
  ([1, 3] as const).map((turn) => ({ ...program, turn })));

const SET_ALGEBRA_TURN_BUCKET = "visual-set-algebra-d5";

/**
 * A near miss of a set-algebra program: combine the boards with any of the
 * eight operations, then make or SKIP each later step — the move, and in d5
 * the turn. Never a candidate rule: the worked rows show every step, so
 * skipping one always fails them. Added 2026-09-29 for the same reason as
 * `AnalogyNearMissProgram`: a skipped step gives each wrong combination a
 * sibling that shares it, so the option list can be a tree rather than a star.
 */
interface SetAlgebraNearMissProgram {
  operation: SceneBinaryOperation;
  spatial: AnalogySpatialOperation | null;
  turn: 0 | 1 | 3;
}

function applySetAlgebraNearMiss(left: Scene, right: Scene, program: SetAlgebraNearMissProgram): Scene | null {
  const combined = applySceneBinary(left, right, program.operation);
  const moved = combined && program.spatial !== null ? applySceneUnary(combined, program.spatial) : combined;
  if (!moved || program.turn === 0) return moved;
  return applySceneUnary(moved, { kind: "turn", quarterTurns: program.turn });
}

function setAlgebraNearMissGrammar(turning: boolean): SetAlgebraNearMissProgram[] {
  return SCENE_BINARY_GRAMMAR.flatMap((operation) =>
    [...SET_ALGEBRA_SPATIAL_GRAMMAR, null].flatMap((spatial) =>
      (turning ? ([0, 1, 3] as const) : ([0] as const)).map((turn) => ({ operation, spatial, turn }))));
}

function applySetAlgebraProgram(left: Scene, right: Scene, program: SetAlgebraProgram): Scene | null {
  const combined = applySceneBinary(left, right, program.operation);
  const moved = combined ? applySceneUnary(combined, program.spatial) : null;
  if (!moved || program.turn === undefined) return moved;
  return applySceneUnary(moved, { kind: "turn", quarterTurns: program.turn });
}

function setOperationExplanation(program: SetAlgebraProgram): string {
  // The d4 wording names two steps and d5 three. Both were reissued in
  // scene-families-v19, when skipped steps joined the near misses.
  if (program.turn === undefined) {
    return `In every row, the first two boards make the board after the arrow, in two steps. First, combine them square by square: the result ${combineDescription(program.operation, "first", "second")}. Then ${boardMoveDescription(program.spatial, "do")}. Do the same with the bottom row's two boards to get the missing board.`;
  }
  return `In every row, the first two boards make the board after the arrow, in three steps. First, combine them square by square: the result ${combineDescription(program.operation, "first", "second")}. Then ${boardMoveDescription(program.spatial, "do")}; the shapes move to new squares but keep pointing the same way. Last, turn every arrow and triangle ${quarterTurnsWords(program.turn)} in its own square. Do the same with the bottom row's two boards to get the missing board.`;
}

/**
 * The four roles a board position can play in a set-algebra row, and the reason
 * the family builds every row to contain all four.
 *
 * Until 2026-08-27 the two input boards were a fixed diagonal: two tokens each,
 * at (0,0)+(1,1) and (1,1)+(2,2), with the SAME token in the shared slot. The
 * owner called the results toys and they were, for a reason worth writing down.
 * On that skeleton a clash is impossible, so `union-left` and `union-right`
 * agree, `overlap-left`, `overlap-right` and `intersection` all agree, and
 * `subtract` and `mask-out` agree — eight operations collapse to four outputs,
 * and each output holds at most two tokens.
 *
 * A row that contains one of each role below separates all eight, because each
 * operation keeps a different subset of the roles:
 *
 * | role                      | uL | uR | int | oL | oR | sub | mask | excl |
 * |---------------------------|----|----|-----|----|----|-----|------|------|
 * | shared, same token        | y  | y  |  y  | y  | y  |  .  |  .   |  .   |
 * | shared, different tokens  | L  | R  |  .  | L  | R  |  L  |  .   |  .   |
 * | left only                 | y  | y  |  .  | .  | .  |  y  |  y   |  y   |
 * | right only                | y  | y  |  .  | .  | .  |  .  |  .   |  y   |
 *
 * No two columns match, so the worked rows pin exactly one operation and the
 * query yields seven distinct near misses — five of which the option list
 * needs. Boards go from two tokens to three, and answers from at most two to
 * as many as four, which is the "expand this a lot" the owner asked for. Three
 * tokens on a 3x3 board is the same density the machine families already ship,
 * so nothing here is a legibility change.
 */
interface SetAlgebraRoles {
  /** Same position, same token on both boards. */
  shared: ScenePosition;
  /** Same position, DIFFERENT tokens — the clash the old skeleton could not show. */
  clash: ScenePosition;
  leftOnly: ScenePosition;
  rightOnly: ScenePosition;
}

/** Every position of the 3x3 board, as draw material for the four roles. */
const SET_ALGEBRA_POSITIONS: readonly ScenePosition[] =
  [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));

/** One complete draw: two worked rows and the query, all built from roles. */
interface SetAlgebraRows {
  leftA: Scene; rightA: Scene; outputA: Scene;
  leftB: Scene; rightB: Scene; outputB: Scene;
  queryLeft: Scene; queryRight: Scene; answer: Scene;
}

/** Role draws tried before this family gives up on the sampled program. */
const SET_ALGEBRA_INPUT_ATTEMPTS = 300;

/** Draw four distinct positions and hand each one a role. */
function setAlgebraRoles(rng: Rng): SetAlgebraRoles {
  const [shared, clash, leftOnly, rightOnly] = shuffled(rng, SET_ALGEBRA_POSITIONS).slice(0, 4);
  return { shared, clash, leftOnly, rightOnly };
}

/**
 * Build one row's input pair from the four roles.
 *
 * `orientable` is the d5 bucket, whose rule ends in a token turn: a turn shows
 * only on a token that has a direction, and every operation keeps at least one
 * role, so every role has to carry an arrow or a triangle for the turn to be
 * visible whatever the operation turns out to be.
 */
function setAlgebraPair(
  roles: SetAlgebraRoles,
  shapes: readonly SceneToken["shape"][],
  offset: number,
  orientable: boolean,
): [Scene, Scene] {
  const rotation = SET_ALGEBRA_TURN_ROTATIONS[offset % SET_ALGEBRA_TURN_ROTATIONS.length];
  const at = (shape: SceneToken["shape"]): SceneToken =>
    orientable ? { ...token(shape), rotation } : token(shape);
  // The clash has to be READ, so its two tokens are always plainly different
  // shapes — never the same shape in two fills.
  const sharedToken = at(orientable ? "triangle" : shapes[offset % shapes.length]);
  const clashLeft = at(orientable ? "arrow" : shapes[(offset + 1) % shapes.length]);
  const clashRight = at(orientable ? "triangle" : shapes[(offset + 2) % shapes.length]);
  const leftToken = at(orientable ? "arrow" : shapes[(offset + 3) % shapes.length]);
  const rightToken = at(orientable ? "arrow" : shapes[(offset + 4) % shapes.length]);
  return [
    scene([
      { ...roles.shared, object: sharedToken },
      { ...roles.clash, object: clashLeft },
      { ...roles.leftOnly, object: leftToken },
    ]),
    scene([
      { ...roles.shared, object: sharedToken },
      { ...roles.clash, object: clashRight },
      { ...roles.rightOnly, object: rightToken },
    ]),
  ];
}

/** One starting direction per row, so no two rows of a d5 item show the same boards. */
const SET_ALGEBRA_TURN_ROTATIONS = [0, 180, 90] as const;

/**
 * Does dropping the program's move, or in d5 its turn, still reproduce every
 * worked row? Then that step never shows, and "no move" or "no turn" reads the
 * rows as well as the rule does.
 */
function setAlgebraStepHidden(
  program: SetAlgebraProgram,
  examples: readonly { left: Scene; right: Scene; output: Scene }[],
): boolean {
  const reproducedWithout = (skipped: Pick<SetAlgebraNearMissProgram, "spatial" | "turn">) =>
    examples.every((example) => {
      const board = applySetAlgebraNearMiss(example.left, example.right, { operation: program.operation, ...skipped });
      return board !== null && sceneSignature(board) === sceneSignature(example.output);
    });
  return reproducedWithout({ spatial: null, turn: program.turn ?? 0 }) ||
    (program.turn !== undefined && reproducedWithout({ spatial: program.spatial, turn: 0 }));
}

/** The squares a board's shapes stand on, as one comparable key. */
function sceneFootprintKey(board: Scene): string {
  return board.objects.map((placement) => `${placement.row},${placement.column}`).sort().join(" ");
}

/**
 * The near miss closest to the answer that holds the answer's shapes, fills and
 * turns on other squares, or nothing when the pool has none. The d5 bucket
 * requires it.
 *
 * d5 turns every token as a third step, so "which shapes" and "which turns" are
 * separate clues. Each was held by two options, yet until 2026-10-04 the answer
 * was the only option holding both in 134 of 200 d5 items, so where the shapes
 * stand never had to be worked out. In the v22 tests Sonnet 5.5 and Opus 5.5
 * both answered such items while saying they could not tell where the shapes
 * go (docs/plans/one-reading-per-worked-row.md). With this option beside the
 * answer, the move is a step the solver has to take.
 */
function setAlgebraShapesElsewhere(answer: Scene, pool: readonly Scene[]): Scene[] {
  const shapesOf = (board: Scene) =>
    board.objects.map((placement) => JSON.stringify(placement.object)).sort().join("|");
  const answerShapes = shapesOf(answer);
  const matches = pool.filter((candidate) => shapesOf(candidate) === answerShapes &&
    sceneSignature(candidate) !== sceneSignature(answer) &&
    areScenesCategoricallyDistinct(answer, candidate));
  return rankByCloseness(matches, answer, (candidate) => candidate).slice(0, 1);
}

function setAlgebra(
  rng: Rng,
  options: { bucket?: SceneFamilyBucket; forcedOperation?: SceneBinaryOperation } = {},
): SceneFamilyCandidate {
  const { bucket, forcedOperation } = options;
  const turning = bucket?.bucket === SET_ALGEBRA_TURN_BUCKET;
  const grammar = turning ? SET_ALGEBRA_TURN_GRAMMAR : SET_ALGEBRA_GRAMMAR;
  const program = pick(rng, grammar.filter((candidate) =>
    forcedOperation === undefined || candidate.operation === forcedOperation));
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // Each row draws its own four positions, so the solver cannot read the rule
  // off a fixed skeleton — only off what the operation does to the roles.
  //
  // Richer boards buy a problem the fixed diagonal never had: a role draw can
  // let a SECOND program in the grammar reproduce both worked rows and then
  // disagree about the query, which is an ambiguous item. Roughly one draw in
  // twenty did that when the boards were first enriched. So the draw is
  // repeated until the two worked rows pin exactly one predicted answer —
  // the same bounded-redraw shape `relationalMatrix` already uses. The oracle
  // below re-derives this from the finished puzzle and is what actually
  // guarantees it; this loop only stops the family handing it a draw it would
  // have to reject.
  /**
   * The near misses a draw can offer: every other program run on the query
   * pair, and every run that skips a step — whichever of them fail a worked row.
   */
  const nearMissGrammar = setAlgebraNearMissGrammar(turning);
  const wrongExecutionsFor = (
    examples: readonly { left: Scene; right: Scene; output: Scene }[],
    left: Scene,
    right: Scene,
  ) => nearMissGrammar.flatMap((candidateProgram) =>
    examples.some((example) => {
      const worked = applySetAlgebraNearMiss(example.left, example.right, candidateProgram);
      return worked === null || sceneSignature(worked) !== sceneSignature(example.output);
    })
      ? [{
          output: applySetAlgebraNearMiss(left, right, candidateProgram),
          reason: candidateProgram.spatial === null || (turning && candidateProgram.turn === 0)
            ? "combines the boards but skips a step the worked rows show"
            : "this set-and-spatial program fails at least one worked combination",
        }]
      : []);
  /**
   * A board some other reading of both worked rows predicts never becomes an
   * option (`setAlgebraPredictions`: any combination with either board first,
   * any flip or turn of the board, a wrapped one-square slide or none, any token
   * turn or none). Measured on 2026-10-04, one d4 item in 200 offered such a
   * board; on 2026-10-05 Codex found one d5 item in 200 whose board came from the
   * right board first and a wrapped slide, which the vocabulary then lacked.
   */
  const poolFor = (rows: SetAlgebraRows) => {
    const examples = [
      { left: rows.leftA, right: rows.rightA, output: rows.outputA },
      { left: rows.leftB, right: rows.rightB, output: rows.outputB },
    ];
    const otherReadings = new Set(setAlgebraPredictions(examples, rows.queryLeft, rows.queryRight)
      .map((prediction) => boardKey(prediction.board)));
    const wrongExecutions = wrongExecutionsFor(examples, rows.queryLeft, rows.queryRight);
    return distinctOutputs([
      ...wrongExecutions.map((execution) => execution.output),
      ...partialSceneExecutions(rows.answer, wrongExecutions, "features").map((execution) => execution.output),
    ])
      .filter((candidate) => sceneSignature(candidate) !== sceneSignature(rows.answer) &&
        !otherReadings.has(boardKey(candidate)));
  };

  const drawn = ((): { rows: SetAlgebraRows; selected: Scene[] | null } | null => {
    let last: SetAlgebraRows | null = null;
    let lastWellPosed: SetAlgebraRows | null = null;
    for (let attempt = 0; attempt < SET_ALGEBRA_INPUT_ATTEMPTS; attempt++) {
      const rowRoles = [setAlgebraRoles(rng), setAlgebraRoles(rng), setAlgebraRoles(rng)];
      const pair = (offset: number): [Scene, Scene] =>
        setAlgebraPair(rowRoles[offset % rowRoles.length], shapes, offset, turning);
      const [leftA, rightA] = pair(0);
      const [leftB, rightB] = pair(2);
      const [queryLeft, queryRight] = pair(1);
      const outputA = applySetAlgebraProgram(leftA, rightA, program);
      const outputB = applySetAlgebraProgram(leftB, rightB, program);
      const answer = applySetAlgebraProgram(queryLeft, queryRight, program);
      if (!outputA || !outputB || !answer) continue;
      // Two worked outputs on the same squares let "the result always stands
      // there" fit both rows as well as the rule. Opus 5.5 lost its one answer
      // of the v21 test to it; 9 of 200 d4 items and 7 of 200 d5 items had it
      // (docs/plans/one-reading-per-worked-row.md).
      if (sceneFootprintKey(outputA) === sceneFootprintKey(outputB)) continue;
      const draw: SetAlgebraRows = { leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, answer };
      last = draw;
      const examples = [
        { left: leftA, right: rightA, output: outputA },
        { left: leftB, right: rightB, output: outputB },
      ];
      const survivors = grammar.filter((candidateProgram) => examples.every((example) => {
        const output = applySetAlgebraProgram(example.left, example.right, candidateProgram);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predicted = distinctOutputs(survivors.map((candidateProgram) =>
        applySetAlgebraProgram(queryLeft, queryRight, candidateProgram)));
      if (predicted.length !== 1) continue;
      // Every step of the rule shows in a worked row. A move that leaves both
      // outputs as they were reads more simply as no move at all, and the
      // question would then hang on a step nobody saw (one d4 item in 200).
      if (survivors.some((candidateProgram) => setAlgebraStepHidden(candidateProgram, examples))) continue;
      lastWellPosed = draw;
      // Well posed is not yet enough. The d5 bucket turns the combined board as
      // a third step, so two programs differing only in that turn land in the
      // same cells and the option list always holds a board sharing the answer's
      // footprint. The d4 bucket has no such step, and measured on 2026-08-27 it
      // left the answer alone in its cells in 45% of items — one inference,
      // where the tokens go, and the combining rule never had to be read. Since
      // 2026-10-03 the bar is the owner's stricter rule, that every clue appear
      // on two options (`optionsAloneOnAClue`), which about one d4 draw in
      // twelve cannot meet: draw again until a list meets it. A pool that
      // cannot even cover the answer's aspects can never meet it, and is
      // skipped before the search spends any of the item's random numbers.
      const pool = poolFor(draw);
      if (pool.length < DISTRACTORS_PER_ITEM || !poolCoversEveryAspect(answer, pool)) continue;
      const required = turning ? setAlgebraShapesElsewhere(answer, pool) : [];
      if (turning && required.length === 0) continue;
      try {
        return { rows: draw, selected: selectDistractors(pool, rng, "set algebra", { answer, required, familyId: "visual-set-algebra-v2", clueDomain: [queryLeft, queryRight] }) };
      } catch (error) {
        if (!(error instanceof CluesNotSharedError)) throw error;
      }
    }
    // No draw satisfied everything. Prefer the last unambiguous one and fall
    // back to the last draw at all: acceptance rejects an unusable board and the
    // assembler retries the slot on a fresh seed, which is the failure path
    // every other family already uses.
    const fallback = lastWellPosed ?? last;
    return fallback && { rows: fallback, selected: null };
  })();
  if (drawn === null) throw new Error("set algebra could not build a single valid row draw");
  const { rows } = drawn;
  const { leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, answer } = rows;
  const fallbackPool = drawn.selected ? [] : poolFor(rows);
  const selectedDistractors = drawn.selected ?? selectDistractors(fallbackPool, rng, "set algebra", {
    answer,
    familyId: "visual-set-algebra-v2",
    clueDomain: [queryLeft, queryRight],
    required: turning ? setAlgebraShapesElsewhere(answer, fallbackPool) : [],
  });
  const cueIds = turning
    ? ["shared-coordinate-frame", "worked-combinations", "spatial-output-step", "token-orientation"]
    : ["shared-coordinate-frame", "worked-combinations", "spatial-output-step"];
  const puzzle = makePuzzle(
    "prototype-set-algebra",
    "matrix",
    "grid3x3",
    turning
      ? "Infer how the first two boards combine, move, and turn to make the third."
      : "Infer how the first two boards combine to make the third.",
    bucket?.difficulty ?? 4,
    [leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    setOperationExplanation(program),
  );
  puzzle.gridFlow = "rows";
  const family = definition(
    "visual-set-algebra-v2",
    cueIds,
    JSON.stringify(program),
    (candidate) => {
      const scenes = candidate.stem.map(scenePanel);
      if (scenes.some((panel, index) => index !== 8 && panel === null)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const [exampleLeftA, exampleRightA, exampleOutputA, exampleLeftB, exampleRightB, exampleOutputB, left, right] = scenes as Scene[];
      const examples = [
        { left: exampleLeftA, right: exampleRightA, output: exampleOutputA },
        { left: exampleLeftB, right: exampleRightB, output: exampleOutputB },
      ];
      const survivors = grammar.filter((candidateProgram) => examples.every((example) => {
        const output = applySetAlgebraProgram(example.left, example.right, candidateProgram);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predicted = distinctOutputs(survivors.map((candidateProgram) =>
        applySetAlgebraProgram(left, right, candidateProgram)));
      // Whole-board misreadings and the same mistakes applied to only one
      // shape group or property. Copies and missing shapes remain explicit.
      const wrongExecutions = wrongExecutionsFor(examples, left, right);
      const reasons = firstReasonFor([
        ...wrongExecutions,
        ...(predicted.length === 1 ? partialSceneExecutions(predicted[0], wrongExecutions, "features") : []),
      ]);
      return {
        derivedAnswer: predicted.length === 1 ? predicted[0] : null,
        solutionCount: predicted.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * Every rule this family may demonstrate.
 *
 * Since 2026-08-25 it contains BOTH readings of a quarter-turn: `rotate` turns
 * the whole board, carrying every token to a new slot, while `turn` leaves the
 * layout untouched and turns each token's own direction on the spot. They look
 * alike described in words and completely different on a board, which is the
 * distinction this family now teaches. Both live in the oracle's search space,
 * so an item is only servable when the worked pair separates them.
 */
const SPATIAL_TRANSFORM_GRAMMAR: readonly SceneUnaryOperation[] = [
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "turn", quarterTurns: 1 },
  { kind: "turn", quarterTurns: 2 },
  { kind: "turn", quarterTurns: 3 },
  { kind: "translate", rowDelta: -1, columnDelta: 0, wrap: true },
  { kind: "translate", rowDelta: 1, columnDelta: 0, wrap: true },
  { kind: "translate", rowDelta: 0, columnDelta: -1, wrap: true },
  { kind: "translate", rowDelta: 0, columnDelta: 1, wrap: true },
] as const;

/**
 * The other reading of the same quarter-turn: the board rotation that matches a
 * token turn, and the token turn that matches a board rotation. Null for a
 * reflection or a shift, which have no such twin.
 */
function spatialTurnCounterpart(operation: SceneUnaryOperation): SceneUnaryOperation | null {
  if (operation.kind === "rotate") return { kind: "turn", quarterTurns: operation.quarterTurns };
  if (operation.kind === "turn") return { kind: "rotate", quarterTurns: operation.quarterTurns };
  return null;
}

function spatialTransform(rng: Rng): SceneFamilyCandidate {
  // One drawn shape and one arrow. The arrow is what makes a token turn
  // readable at all: without a token that has a direction, turning the tokens
  // and leaving the board alone would look like doing nothing.
  const [a] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const b = "arrow" as const;
  const operation = pick(rng, SPATIAL_TRANSFORM_GRAMMAR);
  const first = scene([{ row: 0, column: 0, object: token(a) }, { row: 2, column: 1, object: token(b, "solid") }]);
  const transformed = applySceneUnary(first, operation)!;
  const query = scene([{ row: 0, column: 1, object: token(b) }, { row: 1, column: 0, object: token(a, "solid") }]);
  const answer = applySceneUnary(query, operation)!;
  // The pool is the other bounded operations, and each of them again with an
  // extra token turn.
  //
  // The plain operations alone were too narrow, measured on 2026-08-27: a board
  // rotation lands the tokens in cells no other operation reaches, so in 43% of
  // items the answer was the only option with its footprint and reading where
  // the tokens go finished the item without ever reading the arrow. Composing a
  // move with a turn keeps the footprint and changes only the arrow, which is
  // exactly the mix-up this family exists to test — the solver who moved the
  // board correctly but turned the tokens as well.
  const wrongExecutionsFor = (input: Scene, output: Scene, query: Scene) => {
    const singles = SPATIAL_TRANSFORM_GRAMMAR.flatMap((candidateOperation) => {
      const moved = applySceneUnary(query, candidateOperation);
      const worked = applySceneUnary(input, candidateOperation);
      return moved && (worked === null || sceneSignature(worked) !== sceneSignature(output))
        ? [{ output: moved, reason: `${candidateOperation.kind} does not reproduce the worked spatial pair` }]
        : [];
    });
    const movedAndTurned = SPATIAL_TRANSFORM_GRAMMAR.flatMap((candidateOperation) => {
      const moved = applySceneUnary(query, candidateOperation);
      return moved ? ([1, 2, 3] as const).map((quarterTurns) => ({
        output: applySceneUnary(moved, { kind: "turn", quarterTurns }),
        reason: `${candidateOperation.kind} with an extra token turn the worked pair does not show`,
      })) : [];
    });
    const swappedFills = (() => {
      const held = query.objects.flatMap((placement) => placement.object.kind === "token"
        ? [{ shape: placement.object.shape, fill: placement.object.fill }] : []);
      if (held.length !== 2 || held[0].shape === held[1].shape || held[0].fill === held[1].fill) return [];
      const otherFill = new Map([[held[0].shape, held[1].fill], [held[1].shape, held[0].fill]]);
      return SPATIAL_TRANSFORM_GRAMMAR.flatMap((candidateOperation) => {
        const moved = applySceneUnary(query, candidateOperation);
        if (!moved) return [];
        const runs = [
          { output: moved, extraTurn: false },
          ...([1, 2, 3] as const).map((quarterTurns) => ({
            output: applySceneUnary(moved, { kind: "turn", quarterTurns }),
            extraTurn: true,
          })),
        ];
        return runs.flatMap((run) => run.output ? [{
          output: {
            ...run.output,
            objects: run.output.objects.map((placement) => placement.object.kind === "token" ? {
              ...placement,
              object: { ...placement.object, fill: otherFill.get(placement.object.shape) ?? placement.object.fill },
            } : placement),
          },
          reason: `${candidateOperation.kind} swaps the two shapes' fills instead of keeping each shape's fill${run.extraTurn ? ", with an extra token turn" : ""}`,
        }] : []);
      });
    })();
    // Single-operation mistakes keep their simpler name when both readings
    // produce the same board. Partial executions preserve either shape's
    // correct outcome while applying the witnessed mistake to the other.
    return [
      { output: query, reason: "omits the demonstrated spatial transformation" },
      ...singles,
      ...movedAndTurned,
      ...swappedFills,
    ];
  };
  const wrongExecutions = wrongExecutionsFor(first, transformed, query);
  const distractors = distinctOutputs([
    ...wrongExecutions,
    ...partialSceneExecutions(answer, wrongExecutions, "features"),
  ].map((execution) => execution.output))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  // The confusable counterpart always ships: for a board rotation, the board
  // that results from turning the tokens instead, and the other way round. It
  // is the one wrong answer a solver who mixed the two readings up would give,
  // so the item has to offer it or it never tests the distinction.
  const counterpart = spatialTurnCounterpart(operation);
  const counterpartOutput = counterpart ? applySceneUnary(query, counterpart) : null;
  const required = counterpartOutput && sceneSignature(counterpartOutput) !== sceneSignature(answer)
    ? [counterpartOutput]
    : [];
  const selectedDistractors = selectDistractors(distractors, rng, "spatial transform", { answer, required, familyId: "spatial-transform-v2" });
  const movesTokens = operation.kind !== "turn";
  const puzzle = makePuzzle(
    "prototype-spatial-transform",
    "analogy",
    "analogy",
    "Apply the same transformation.",
    2,
    [first, transformed, query],
    answer,
    selectedDistractors,
    rng,
    `From the top-left board to the top-right board, the change ${boardMoveDescription(operation, "does")}. ${movesTokens
      ? "Every shape keeps its shape, its fill and the way it points; only its square changes."
      : "Nothing moves to another square; only the arrows point a new way, because the shapes turn and the board does not."} Make the same change to the bottom-left board to get the missing board.`,
  );
  const family = definition(
    "spatial-transform-v2",
    ["worked-spatial-pair", "fixed-board-frame"],
    JSON.stringify(operation),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = SPATIAL_TRANSFORM_GRAMMAR.filter((candidateOperation) => {
        const predicted = applySceneUnary(input, candidateOperation);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
      });
      const predictions = distinctOutputs(survivors.map((candidateOperation) => applySceneUnary(query, candidateOperation)));
      const wrongExecutions = wrongExecutionsFor(input, output, query);
      const reasons = firstReasonFor([
        ...wrongExecutions,
        ...(predictions.length === 1 ? partialSceneExecutions(predictions[0], wrongExecutions, "features") : []),
      ]);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-spatial-pair", "fixed-board-frame"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const COMPOSED_GATE_IDS = ["a", "b", "c"] as const;
type ComposedGateId = (typeof COMPOSED_GATE_IDS)[number];

/**
 * The glyph that labels one machine gate. Three shape-and-fill pairs, chosen so
 * no two are confusable at the size a query strip draws them — one per gate a
 * machine item may show under the owner's three-gate ceiling.
 */
const GATE_GLYPHS: Readonly<Record<ComposedGateId, { shape: SceneToken["shape"]; fill: SceneToken["fill"] }>> = {
  a: { shape: "triangle", fill: "outline" },
  b: { shape: "square", fill: "solid" },
  c: { shape: "diamond", fill: "half" },
};

/**
 * What a gate is called in an explanation: the jigsaw piece it is drawn as
 * ("dotted piece"), from the same table the renderers read.
 */
function gatePieceName(gateId: ComposedGateId): string {
  const glyph = GATE_GLYPHS[gateId];
  return `${gatePieceTexture(glyph.shape, glyph.fill)} piece`;
}

/** Pieces in the order a question runs them: "the striped piece, then the dark piece". */
function gatePieceRun(gateIds: readonly ComposedGateId[]): string {
  return gateIds.map((gateId) => `the ${gatePieceName(gateId)}`).join(", then ");
}

/**
 * A machine gate control: a worked row's single gate, or a query strip.
 *
 * One, two, or three glyphs sit on the ordinary board, one per column of its
 * middle row. The wide one-row strip that four- and five-gate queries needed
 * went with the d6 buckets and has left the schema.
 */
function gateVisual(...gateIds: ComposedGateId[]): Scene {
  // Field order matters: `sceneSignature` stringifies a placement as written,
  // and the schema rebuilds it as (row, column, object) on parse. A placement
  // built any other way replays to a different key than it validates to.
  if (gateIds.length > 3) {
    throw new Error(`a gate control shows at most three glyphs, not ${gateIds.length}`);
  }
  return scene(gateIds.map((gateId, column) => ({
    row: 1,
    column,
    object: token(GATE_GLYPHS[gateId].shape, GATE_GLYPHS[gateId].fill),
  })));
}

type MachineSpatialOperation = Extract<SceneUnaryOperation, { kind: "rotate" | "reflect" }>;
type MachineFillOperation = Extract<SceneUnaryOperation, { kind: "setFill" }>;
type MachineDuplicateOperation = Extract<SceneUnaryOperation, { kind: "duplicate" }>;

interface MachineProgram {
  gateA: MachineSpatialOperation;
  gateB: MachineFillOperation;
  gateC: MachineDuplicateOperation;
}

const MACHINE_SPATIAL_GRAMMAR: readonly MachineSpatialOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
] as const;
const MACHINE_FILL_GRAMMAR: readonly MachineFillOperation[] = [
  { kind: "setFill", fill: "half" },
  { kind: "setFill", fill: "solid" },
] as const;

/** Where the duplication gate puts its copy. Every board move leaves it empty. */
const MACHINE_CENTRE: ScenePosition = { row: 1, column: 1 };

/** The eight cells around the centre: where a query token may stand, and a copy may come from. */
const MACHINE_OUTER_CELLS: readonly ScenePosition[] = [0, 1, 2]
  .flatMap((row) => [0, 1, 2].map((column) => ({ row, column })))
  .filter((cell) => cell.row !== MACHINE_CENTRE.row || cell.column !== MACHINE_CENTRE.column);

/**
 * Every duplication gate a solver could read off the third worked row: copy
 * whatever stands in one outer cell into the empty centre. The row shows a
 * single token in its source cell, so it names exactly one of these eight.
 */
const MACHINE_DUPLICATE_GRAMMAR: readonly MachineDuplicateOperation[] = MACHINE_OUTER_CELLS.map((from) => ({
  kind: "duplicate",
  from,
  to: MACHINE_CENTRE,
}));

/**
 * The oracle's search space: 4 board moves x 2 fills x 8 duplication sources =
 * 64 machines.
 *
 * Until 2026-09-28 the duplication source was tied to the board move — always
 * wherever the upper-left token landed — and the query was always the same two
 * cells, so the family could only ever ask 8 machines x 12 shape pairs = 96
 * questions, and about 2.5 of them in every long test. The source is now a gate
 * of its own, read off its worked row like the other two, and the query tokens
 * stand anywhere around the centre.
 */
const MACHINE_PROGRAM_GRAMMAR: readonly MachineProgram[] = MACHINE_SPATIAL_GRAMMAR.flatMap((gateA) =>
  MACHINE_FILL_GRAMMAR.flatMap((gateB) =>
    MACHINE_DUPLICATE_GRAMMAR.map((gateC) => ({ gateA, gateB, gateC }))));

/** The gate count of the one transformation-machine bucket, which is also its depth. */
const TRANSFORMATION_MACHINE_BUCKET_GATES: Readonly<Record<string, number>> = {
  "transformation-machine-d5": 3,
  "transformation-machine-v4-d5": 3,
};

/** One program's gates, in the order the query strip shows them. */
function machineGates(program: MachineProgram): SceneUnaryOperation[] {
  return [program.gateA, program.gateB, program.gateC];
}

function unaryExampleMatches(input: Scene, output: Scene, operation: SceneUnaryOperation): boolean {
  const predicted = applySceneUnary(input, operation);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

function runMachineInOrder(input: Scene, program: MachineProgram, order: readonly number[]): Scene | null {
  const gates = machineGates(program);
  let value: Scene | null = input;
  for (const index of order) value = value && applySceneUnary(value, gates[index]);
  return value;
}

/**
 * Every board the machine passes through, in order. Null means some gate could
 * not apply, which is a rejected draw rather than a silently shorter run.
 */
function runMachine(input: Scene, program: MachineProgram): readonly Scene[] | null {
  const stages: Scene[] = [];
  let value: Scene | null = input;
  for (const gate of machineGates(program)) {
    value = applySceneUnary(value, gate);
    if (!value) return null;
    stages.push(value);
  }
  return stages;
}

/** The board a finished run lands on, or null if the machine does not apply. */
function machineAnswer(input: Scene, program: MachineProgram): Scene | null {
  return runMachine(input, program)?.at(-1) ?? null;
}

/**
 * One way to pose the machine: which machine runs, where the two outline query
 * tokens stand, and which of them the duplication gate copies.
 */
export interface TransformationMachineDraw {
  program: MachineProgram;
  queryCells: readonly [ScenePosition, ScenePosition];
  /** 0 when the gate copies the first query token, 1 when it copies the second. */
  copies: 0 | 1;
}

/**
 * The query board: two outline tokens in the draw's cells, listed in reading
 * order so one board is always written the same way.
 */
function machineQuery(
  queryCells: readonly [ScenePosition, ScenePosition],
  shape: SceneToken["shape"],
  secondShape: SceneToken["shape"],
): Scene {
  return scene([
    { ...queryCells[0], object: token(shape) },
    { ...queryCells[1], object: token(secondShape) },
  ].sort((left, right) => left.row - right.row || left.column - right.column));
}

/**
 * The duplication gate's worked row: the token it copies, in its source cell,
 * and a second token the gate leaves alone.
 *
 * Shown alone, a token in a corner sits on a diagonal, so "flip the board across
 * that diagonal, then copy" fits the row as well as the copy itself. The reading
 * check of 2026-10-04 (`worked-row-readings.ts`) found a wrong option behind that
 * flip in 36 of 200 items. A lone token also cannot say whether the gate copies
 * every token, which Sonnet 5.5 and Opus 5.5 both asked in the v22 tests. The
 * second token stands where each of those readings would change the row: off
 * every line that keeps the source in place, with room for a copy of its own.
 */
function machineCopyRow(
  gate: MachineDuplicateOperation,
  copiedShape: SceneToken["shape"],
  keptShape: SceneToken["shape"],
  fill: SceneToken["fill"],
  rng: Rng,
): Scene {
  const boardWith = (cell: ScenePosition) => scene([
    { ...gate.from, object: token(copiedShape, fill) },
    { ...cell, object: token(keptShape, fill) },
  ].sort((left, right) => left.row - right.row || left.column - right.column));
  const cells = MACHINE_OUTER_CELLS.filter((cell) => {
    if (cell.row === gate.from.row && cell.column === gate.from.column) return false;
    const input = boardWith(cell);
    const output = applySceneUnary(input, gate);
    return output !== null && machineWorkedRowReadings("transformation-machine-v3", input, output).length === 1;
  });
  if (cells.length === 0) throw new Error("the duplication gate's worked row has no cell that pins its reading");
  return boardWith(pick(rng, cells));
}

/**
 * The board servability and single-gate ablation are decided on for one draw.
 *
 * Geometry alone decides both — which slots hold a token, and whether two of
 * them hold the SAME token — and renaming the two shapes is a bijection on
 * scene signatures, so settling one shape order settles every shape order.
 */
export function canonicalTransformationMachineQuery(draw: TransformationMachineDraw): Scene {
  return machineQuery(draw.queryCells, "circle", "triangle");
}

/**
 * Does this draw run end to end, and does every gate it displays matter?
 *
 * SINGLE-GATE ABLATION: deleting any one displayed gate must change the final
 * board. An ablated run that does not apply at all counts as changed — it
 * produces no board, so it cannot reproduce the answer. Without the fill gate
 * the tokens keep their outline, and without the duplication gate the board is
 * a token short, so only the board move can fail: a reflection leaves the two
 * cells on its own axis where they are, and a query standing on both of them
 * would show a board move that moves nothing.
 */
function machineDrawIsServable(draw: TransformationMachineDraw): boolean {
  const query = canonicalTransformationMachineQuery(draw);
  const answer = machineAnswer(query, draw.program);
  if (!answer) return false;
  const answerKey = sceneSignature(answer);
  const gates = machineGates(draw.program);
  for (let gate = 0; gate < gates.length; gate++) {
    let ablated: Scene | null = query;
    for (const [index, step] of gates.entries()) {
      if (index === gate) continue;
      ablated = ablated && applySceneUnary(ablated, step);
    }
    if (ablated && sceneSignature(ablated) === answerKey) return false;
  }
  return true;
}

let machineServableDraws: readonly TransformationMachineDraw[] | null = null;

/**
 * Every draw the generator may pose: 4 board moves x 2 fills x 56 ordered pairs
 * of outer cells x 2 tokens to copy = 896, of which 880 are servable (see the
 * lock in scene-families.test.ts for the arithmetic). Times the 12 ordered shape
 * pairs, that is 10,560 different questions where there were 96.
 */
export function servableTransformationMachineDraws(): readonly TransformationMachineDraw[] {
  if (machineServableDraws) return machineServableDraws;
  const draws: TransformationMachineDraw[] = [];
  for (const gateA of MACHINE_SPATIAL_GRAMMAR) {
    for (const gateB of MACHINE_FILL_GRAMMAR) {
      for (const first of MACHINE_OUTER_CELLS) {
        for (const second of MACHINE_OUTER_CELLS) {
          if (first === second) continue;
          for (const copies of [0, 1] as const) {
            // The copy comes from wherever the board move carries that token.
            const moved = applySceneUnary(one("circle", (copies === 0 ? first : second).row,
              (copies === 0 ? first : second).column), gateA)!.objects[0];
            const gateC = MACHINE_DUPLICATE_GRAMMAR.find((gate) =>
              gate.from.row === moved.row && gate.from.column === moved.column)!;
            const draw: TransformationMachineDraw = {
              program: { gateA, gateB, gateC },
              queryCells: [first, second],
              copies,
            };
            if (machineDrawIsServable(draw)) draws.push(draw);
          }
        }
      }
    }
  }
  machineServableDraws = draws;
  return draws;
}

/** The complete grammar the oracle searches, before any filter. */
export function transformationMachineGrammar(): readonly MachineProgram[] {
  return MACHINE_PROGRAM_GRAMMAR;
}

/** The gates of one program, exposed so the ablation proof reads the real list. */
export function transformationMachineGates(program: MachineProgram): readonly SceneUnaryOperation[] {
  return machineGates(program);
}

function gateSymbolKey(value: Scene): string | null {
  const placement = value.objects[0];
  return value.objects.length === 1 && value.tiles.length === 0 && placement?.row === 1 && placement.column === 0
    ? JSON.stringify(placement.object)
    : null;
}

/**
 * Gate labels for the review-screen reasons, in displayed order.
 *
 * Index 1 is named by the job the gate does rather than by its letter: "stops
 * before the duplication gate" says what a solver left out.
 */
const MACHINE_STOP_REASONS = [
  "stops after the first gate",
  "stops before the duplication gate",
] as const;

function transformationMachine(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = TRANSFORMATION_MACHINE_BUCKET_GATES[bucket.bucket] ?? 3;
  const { program, queryCells, copies } = pick(rng, servableTransformationMachineDraws());
  const [shape, secondShape] = shuffled(rng, ["circle", "triangle", "diamond", "star"] as const);
  const inputA = scene([
    { row: 0, column: 0, object: token(shape) },
    { row: 1, column: 2, object: token(secondShape, "solid") },
  ]);
  const outputA = applySceneUnary(inputA, program.gateA)!;
  const inputB = scene([
    { row: 0, column: 1, object: token(shape) },
    { row: 2, column: 0, object: token(secondShape, "solid") },
  ]);
  const outputB = applySceneUnary(inputB, program.gateB)!;
  // The third row shows the token the query will actually copy, so reading the
  // gate as "copy the circle" and as "copy whatever is in that cell" lead to
  // the same answer; only the cell is part of the rule the oracle checks.
  const copiedShape = copies === 0 ? shape : secondShape;
  const keptShape = copies === 0 ? secondShape : shape;
  const inputC = machineCopyRow(program.gateC, copiedShape, keptShape, program.gateB.fill, rng);
  const outputC = applySceneUnary(inputC, program.gateC)!;
  const query = machineQuery(queryCells, shape, secondShape);
  const stages = runMachine(query, program);
  if (!stages || stages.length !== gateCount) throw new Error("machine program must apply to its query");
  const answer = stages[stages.length - 1];
  const gateIds = COMPOSED_GATE_IDS.slice(0, gateCount) as ComposedGateId[];
  const wrongOrders = composedWrongGateOrders(gateCount);
  const cueIds = [...gateIds.map((gateId) => `gate-${gateId}`), "left-to-right-order"];
  const wrongExecutionsFor = (input: Scene, survivors: readonly MachineProgram[]) => {
    const executions = survivors.flatMap((candidateProgram) => {
      const outputs = runMachine(input, candidateProgram);
      return outputs ? [{ program: candidateProgram, outputs }] : [];
    });
    const survivingKeys = new Set(survivors.map((survivor) => JSON.stringify(survivor)));
    return [
      { output: input, reason: "omits all three demonstrated gates" },
      ...executions.flatMap((execution) => execution.outputs.slice(0, -1).map((stage, index) => ({
        output: stage, reason: MACHINE_STOP_REASONS[index],
      }))),
      ...executions.flatMap((execution) => wrongOrders.map((order) => ({
        output: runMachineInOrder(input, execution.program, order),
        reason: "runs the demonstrated gates in another order",
      }))),
      ...MACHINE_PROGRAM_GRAMMAR.flatMap((candidateProgram) => survivingKeys.has(JSON.stringify(candidateProgram))
        ? []
        : [{ output: machineAnswer(input, candidateProgram), reason: "runs a gate that fails a worked path" }]),
      ...MACHINE_PROGRAM_GRAMMAR.flatMap((candidateProgram) => survivingKeys.has(JSON.stringify(candidateProgram))
        ? []
        : [
            ...(runMachine(input, candidateProgram)?.slice(0, -1) ?? []).map((stage) => ({
              output: stage, reason: "runs a gate that fails a worked path, and stops early",
            })),
            ...wrongOrders.map((order) => ({
              output: runMachineInOrder(input, candidateProgram, order),
              reason: "runs a gate that fails a worked path, in another order",
            })),
          ]),
    ];
  };
  const workedRows = [
    { input: inputA, output: outputA },
    { input: inputB, output: outputB },
    { input: inputC, output: outputC },
  ];
  const demonstratedPrograms = MACHINE_PROGRAM_GRAMMAR.filter((candidateProgram) =>
    machineGates(candidateProgram).every((gate, index) =>
      unaryExampleMatches(workedRows[index].input, workedRows[index].output, gate)));
  const wrongExecutions = wrongExecutionsFor(query, demonstratedPrograms);
  const stem = [
    inputA, gateVisual("a"), outputA,
    inputB, gateVisual("b"), outputB,
    inputC, gateVisual("c"), outputC,
    query, gateVisual(...gateIds), { blank: true as const },
  ];
  const nearMissPool = machineDistractorsWithoutSecondReadings("transformation-machine-v3", stem, answer,
    distinctOutputs([
      ...wrongExecutions.map((execution) => execution.output),
      ...partialSceneExecutions(answer, wrongExecutions, "features").map((execution) => execution.output),
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)));
  const puzzle = makePuzzle(
    "prototype-transformation-machine",
    "matrix",
    "machineTable",
    "Follow the worked gate paths, then apply the query gates from left to right.",
    bucket.difficulty,
    stem,
    answer,
    selectDistractors(
      // Three kinds of mistake: stopping early, running the gates out of order,
      // and reading a gate wrongly so a different machine runs end to end —
      // and, since 2026-09-29, a misread machine that also stops early or runs
      // out of order. A run with two mistakes is still one program; it sits
      // beside the one-mistake run it extends, which is what lets the option
      // list be a tree rather than a star (docs/plans/blind-answer-leak.md).
      //
      // The run that stops before the duplication gate was required until
      // 2026-10-03. Measured that day, three items in four had no list around
      // it in which every clue appears on two options (`optionsAloneOnAClue`);
      // without the requirement every item has one. It still competes like any
      // other near miss.
      nearMissPool,
      rng,
      "transformation machine",
      { answer, familyId: "transformation-machine-v3" },
    ),
    rng,
    `Each example row shows one jigsaw piece changing a board. The ${gatePieceName("a")} ${boardMoveDescription(program.gateA, "does")}. The ${gatePieceName("b")} colours every shape ${FILL_WORDS[program.gateB.fill]} without moving it. The ${gatePieceName("c")} copies the shape in the ${squareName(program.gateC.from)} square into the empty centre square. In the question the board goes through the pieces one after another, the way their tabs point, and the board after the last piece is the missing one.`,
  );
  const family = definition(
    "transformation-machine-v3",
    cueIds,
    JSON.stringify(program),
    (candidate) => {
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      if (candidate.stem.length !== gateCount * 3 + 3) return empty;
      const panels = candidate.stem.map(scenePanel);
      const worked: { input: Scene; output: Scene; gateKey: string }[] = [];
      for (let row = 0; row < gateCount; row++) {
        const input = panels[row * 3];
        const shownGate = panels[row * 3 + 1];
        const output = panels[row * 3 + 2];
        const gateKey = shownGate && gateSymbolKey(shownGate);
        if (!input || !output || !gateKey) return empty;
        worked.push({ input, output, gateKey });
      }
      const queryInput = panels[gateCount * 3];
      const queryGates = panels[gateCount * 3 + 1];
      if (!queryInput || !queryGates) return empty;

      // The query strip must show exactly the worked gates, once each, left to
      // right across the middle row of an ordinary board.
      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const stripValid = queryGates.tiles.length === 0 &&
        queryGates.rows === 3 &&
        queryGates.columns === 3 &&
        orderedQueryGates.length === gateCount &&
        orderedQueryGates.every((placement, index) => placement.row === 1 && placement.column === index) &&
        orderedQueryGates.every((placement, index) => JSON.stringify(placement.object) === worked[index].gateKey);
      if (!stripValid) return empty;

      const survivors = MACHINE_PROGRAM_GRAMMAR.filter((candidateProgram) =>
        machineGates(candidateProgram).every((gate, index) =>
          unaryExampleMatches(worked[index].input, worked[index].output, gate)));
      const executions = survivors.flatMap((candidateProgram) => {
        const outputs = runMachine(queryInput, candidateProgram);
        return outputs ? [{ program: candidateProgram, outputs }] : [];
      });
      const predictions = distinctOutputs(executions.map((execution) => execution.outputs[gateCount - 1]));
      const wrongExecutions = wrongExecutionsFor(queryInput, survivors);
      const reasons = firstReasonFor([
        ...wrongExecutions,
        ...(predictions.length === 1 ? partialSceneExecutions(predictions[0], wrongExecutions, "features") : []),
      ]);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return {
    ...asCandidate(family, puzzle),
    queryGates: { order: composedGateIndexes(gateCount), run: (order) => runMachineInOrder(query, program, order) },
  };
}

// ── transformation-machine-v4: gates that read what the gate before them made ──

/**
 * The interacting machine (docs/plans/harden-reasoning.md, section 2): a
 * prototype, generated and verified but not served until the promotion
 * registry lists it.
 *
 * v3's fill gate colours every shape, so it commutes with both other gates:
 * swapping either adjacent pair of v3's gates gives the same board in all 200
 * verified items. Here the fill gate colours only the shape on ONE square, and
 * the copy gate copies the shape on that same square. Which shape the paint
 * reaches depends on the board move before it, and whether the copy comes out
 * coloured depends on the paint before it, so every adjacent swap changes the
 * board (`ORDER_DEPENDENT_BUCKETS` in `scripts/scene-family-verify.ts`).
 */
interface MachinePaintOperation {
  kind: "paintAt";
  at: ScenePosition;
  fill: "half" | "solid";
}

interface InteractingMachineProgram {
  gateA: MachineSpatialOperation;
  gateB: MachinePaintOperation;
  gateC: MachineDuplicateOperation;
}

type InteractingMachineGate = InteractingMachineProgram[keyof InteractingMachineProgram];

/** Colour the shape on one outer square grey or black: 16 gates. */
const MACHINE_PAINT_GRAMMAR: readonly MachinePaintOperation[] = MACHINE_OUTER_CELLS.flatMap((at) =>
  (["half", "solid"] as const).map((fill) => ({ kind: "paintAt" as const, at, fill })));

/** The oracle's search space: 4 board moves × 16 paints × 8 copies = 512 machines. */
const INTERACTING_MACHINE_GRAMMAR: readonly InteractingMachineProgram[] = MACHINE_SPATIAL_GRAMMAR.flatMap((gateA) =>
  MACHINE_PAINT_GRAMMAR.flatMap((gateB) =>
    MACHINE_DUPLICATE_GRAMMAR.map((gateC) => ({ gateA, gateB, gateC }))));

function interactingGates(program: InteractingMachineProgram): InteractingMachineGate[] {
  return [program.gateA, program.gateB, program.gateC];
}

/** One gate on one board; null when it cannot apply (nothing to paint, or already that colour). */
function applyInteractingGate(board: Scene, gate: InteractingMachineGate): Scene | null {
  return gate.kind === "paintAt"
    ? applySceneCompositionPrimitive(board, { kind: "setFillAt", at: gate.at, fill: gate.fill })
    : applySceneUnary(board, gate);
}

function interactingExampleMatches(input: Scene, output: Scene, gate: InteractingMachineGate): boolean {
  const predicted = applyInteractingGate(input, gate);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

function runInteractingInOrder(input: Scene, program: InteractingMachineProgram, order: readonly number[]): Scene | null {
  const gates = interactingGates(program);
  let value: Scene | null = input;
  for (const index of order) value = value && applyInteractingGate(value, gates[index]);
  return value;
}

/** Every board the machine passes through, or null when some gate cannot apply. */
function runInteracting(
  input: Scene,
  program: InteractingMachineProgram,
  order: readonly number[],
): readonly Scene[] | null {
  const stages: Scene[] = [];
  const gates = interactingGates(program);
  let value: Scene | null = input;
  for (const index of order) {
    value = applyInteractingGate(value, gates[index]);
    if (!value) return null;
    stages.push(value);
  }
  return stages;
}

/**
 * One way to pose the interacting machine: which machine runs, and the two
 * squares the query uses — the one the board move carries onto the paint
 * square, and the paint square itself, each holding a white shape.
 */
export interface InteractingMachineDraw {
  program: InteractingMachineProgram;
  /** [where the painted shape starts, the square the paint and the copy read]. */
  queryCells: readonly [ScenePosition, ScenePosition];
}

function interactingQuery(
  queryCells: readonly [ScenePosition, ScenePosition],
  arriving: SceneToken["shape"],
  staying: SceneToken["shape"],
): Scene {
  return scene([
    { ...queryCells[0], object: token(arriving) },
    { ...queryCells[1], object: token(staying) },
  ].sort((left, right) => left.row - right.row || left.column - right.column));
}

let interactingServableDraws: readonly InteractingMachineDraw[] | null = null;

/**
 * Every draw the generator may pose. Geometry alone decides servability, as in
 * v3, so the canonical circle-and-triangle query settles every shape pair. A
 * draw serves when every gate is needed and when swapping either adjacent pair
 * of gates reaches a different valid board.
 */
export function servableInteractingMachineDraws(): readonly InteractingMachineDraw[] {
  if (interactingServableDraws) return interactingServableDraws;
  const draws: InteractingMachineDraw[] = [];
  for (const gateA of MACHINE_SPATIAL_GRAMMAR) {
    for (const gateB of MACHINE_PAINT_GRAMMAR) {
      const arriving = MACHINE_OUTER_CELLS.find((cell) => {
        const moved = applySceneUnary(one("circle", cell.row, cell.column), gateA)!.objects[0];
        return moved.row === gateB.at.row && moved.column === gateB.at.column;
      });
      if (!arriving || (arriving.row === gateB.at.row && arriving.column === gateB.at.column)) continue;
      const gateC = MACHINE_DUPLICATE_GRAMMAR.find((gate) =>
        gate.from.row === gateB.at.row && gate.from.column === gateB.at.column)!;
      const draw: InteractingMachineDraw = { program: { gateA, gateB, gateC }, queryCells: [arriving, gateB.at] };
      const query = interactingQuery(draw.queryCells, "circle", "triangle");
      const outcome = gateOrderOutcome([0, 1, 2], (order) => runInteractingInOrder(query, draw.program, order));
      if (everyAdjacentSwapMatters(outcome) && !outcome.ablations.includes("same")) draws.push(draw);
    }
  }
  interactingServableDraws = draws;
  return draws;
}

/**
 * A worked row for the paint or copy gate: the shape on the gate's square, and
 * the same shape on a second square that the gate leaves alone.
 *
 * The second shape is what makes the row about a SQUARE. With it white, "colour
 * every <shape>" and "colour every shape" do not reproduce the paint row. The
 * copy row shows the selected shape in the same fill as the query receives,
 * and the matching shape in another fill; a third shape shares the source's
 * fill, so neither its shape nor its fill alone picks the copy source.
 * The question then paints and copies a different shape from the one shown
 * here, so only the square carries over.
 *
 * The second square is chosen so that every reading of the row — "copy every
 * shape one square up and left" fits a copy row whose other shape sits in a
 * corner — does to `received`, the board the question hands this gate, exactly
 * what the gate does.
 */
function interactingSquareRow(
  gate: MachinePaintOperation | MachineDuplicateOperation,
  shape: SceneToken["shape"],
  otherFill: SceneToken["fill"],
  received: Scene,
  rng: Rng,
  contrastShape?: SceneToken["shape"],
): { input: Scene; output: Scene } {
  const square = gate.kind === "paintAt" ? gate.at : gate.from;
  const source = received.objects.find(({ row, column }) => row === square.row && column === square.column)?.object;
  const sourceFill = gate.kind === "duplicate" && source?.kind === "token" ? source.fill : "outline";
  // A copy before painting receives a white shape. Its matching shape elsewhere
  // must have another fill, or either square would explain the worked copy.
  const contrastingFill = gate.kind === "duplicate" && sourceFill === otherFill
    ? sourceFill === "outline" ? "solid" : "outline" : otherFill;
  const expected = applyInteractingGate(received, gate);
  if (!expected) throw new Error("an interacting machine gate must apply to the board the question gives it");
  const rows = MACHINE_OUTER_CELLS
    .filter((cell) => cell.row !== square.row || cell.column !== square.column)
    .flatMap((other) => {
      const contrasts = contrastShape ? MACHINE_OUTER_CELLS.filter((cell) =>
        (cell.row !== square.row || cell.column !== square.column) &&
        (cell.row !== other.row || cell.column !== other.column)) : [null];
      return contrasts.flatMap((contrast) => {
        const input = scene([
          { ...square, object: token(shape, sourceFill) },
          { ...other, object: token(shape, contrastingFill) },
          ...(contrast && contrastShape ? [{ ...contrast, object: token(contrastShape, sourceFill) }] : []),
        ].sort((left, right) => left.row - right.row || left.column - right.column));
        const output = applyInteractingGate(input, gate);
        if (!output) return [];
        const pinned = machineWorkedRowReadings("transformation-machine-v4", input, output).every((reading) => {
          const read = reading.apply(received);
          return read !== null && boardKey(read) === boardKey(expected);
        });
        return pinned ? [{ input, output }] : [];
      });
    });
  if (rows.length === 0) throw new Error("an interacting machine row has no second square that pins its reading");
  return pick(rng, rows);
}

function interactingMachine(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = 3;
  const { program, queryCells } = pick(rng, servableInteractingMachineDraws());
  const [arriving, staying, painted, copied] = shuffled(rng, ["circle", "triangle", "diamond", "star"] as const);
  // The board move's row is v3's: two shapes off every line a flip or turn keeps.
  const inputA = scene([
    { row: 0, column: 0, object: token(arriving) },
    { row: 1, column: 2, object: token(staying, "solid") },
  ]);
  const outputA = applySceneUnary(inputA, program.gateA)!;
  const query = interactingQuery(queryCells, arriving, staying);
  const queryOrder = pick(rng, COMPOSED_TRANSFORM_HARD_ORDERS);
  const stages = runInteracting(query, program, queryOrder);
  if (!stages) throw new Error("interacting machine program must apply to its query");
  const received = new Map(queryOrder.map((gate, index) => [gate, index === 0 ? query : stages[index - 1]]));
  const rowB = interactingSquareRow(program.gateB, painted, "outline", received.get(1)!, rng);
  const rowC = interactingSquareRow(program.gateC, copied, "outline", received.get(2)!, rng, painted);
  const answer = stages[gateCount - 1];
  const gateIds = COMPOSED_GATE_IDS.slice(0, gateCount) as ComposedGateId[];
  const queryGateIds = queryOrder.map((index) => gateIds[index]);
  const cueIds = [...gateIds.map((gateId) => `gate-${gateId}`), "left-to-right-order"];
  const wrongExecutionsFor = (
    input: Scene, survivors: readonly InteractingMachineProgram[], order: readonly number[],
  ) => {
    const wrongOrders = composedWrongGateOrders(gateCount, order);
    const executions = survivors.flatMap((candidateProgram) => {
      const outputs = runInteracting(input, candidateProgram, order);
      return outputs ? [{ program: candidateProgram, outputs }] : [];
    });
    const survivingKeys = new Set(survivors.map((survivor) => JSON.stringify(survivor)));
    const misread = INTERACTING_MACHINE_GRAMMAR.filter((candidateProgram) =>
      !survivingKeys.has(JSON.stringify(candidateProgram)));
    return [
      { output: input, reason: "omits all three demonstrated gates" },
      ...executions.flatMap((execution) => execution.outputs.slice(0, -1).map((stage, index) => ({
        output: stage, reason: index === 0 ? "stops after the first gate" : "stops before the last shown gate",
      }))),
      ...executions.flatMap((execution) => wrongOrders.map((order) => ({
        output: runInteractingInOrder(input, execution.program, order),
        reason: "runs the demonstrated gates in another order",
      }))),
      ...misread.map((candidateProgram) => ({
        output: runInteracting(input, candidateProgram, order)?.at(-1) ?? null,
        reason: "runs a gate that fails a worked path",
      })),
      ...misread.flatMap((candidateProgram) => [
        ...(runInteracting(input, candidateProgram, order)?.slice(0, -1) ?? []).map((stage) => ({
          output: stage, reason: "runs a gate that fails a worked path, and stops early",
        })),
        ...wrongOrders.map((order) => ({
          output: runInteractingInOrder(input, candidateProgram, order),
          reason: "runs a gate that fails a worked path, in another order",
        })),
      ]),
    ];
  };
  const workedRows = [{ input: inputA, output: outputA }, rowB, rowC];
  const demonstratedPrograms = INTERACTING_MACHINE_GRAMMAR.filter((candidateProgram) =>
    interactingGates(candidateProgram).every((gate, index) =>
      interactingExampleMatches(workedRows[index].input, workedRows[index].output, gate)));
  const wrongExecutions = wrongExecutionsFor(query, demonstratedPrograms, queryOrder);
  const stem = [
    inputA, gateVisual("a"), outputA,
    rowB.input, gateVisual("b"), rowB.output,
    rowC.input, gateVisual("c"), rowC.output,
    query, gateVisual(...queryGateIds), { blank: true as const },
  ];
  const nearMissPool = machineDistractorsWithoutSecondReadings("transformation-machine-v4", stem, answer,
    distinctOutputs([
      ...wrongExecutions.map((execution) => execution.output),
      ...partialSceneExecutions(answer, wrongExecutions, "features").map((execution) => execution.output),
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)));
  const square = squareName(program.gateB.at);
  const puzzle = makePuzzle(
    "prototype-interacting-machine",
    "matrix",
    "machineTable",
    "Follow the worked gate paths, then apply the query gates from left to right.",
    bucket.difficulty,
    stem,
    answer,
    // No near miss is required: forcing every wrong order into the list would
    // let the options alone point at the answer (docs/plans/harden-reasoning.md).
    selectDistractors(nearMissPool, rng, "interacting machine", { answer, familyId: "transformation-machine-v4",
      requiredWitnessGroups: machineGateWitnessGroups("transformation-machine-v4", stem)?.groups ?? [],
      alternateExecutions: distinctOutputs(wrongExecutions.map(({ output }) => output)).filter((output) => output.objects.length === answer.objects.length),
    }),
    rng,
    `Each example row shows one jigsaw piece changing a board. The ${gatePieceName("a")} ${boardMoveDescription(program.gateA, "does")}. The ${gatePieceName("b")} colours ${FILL_WORDS[program.gateB.fill]} only the shape in the ${square} square: the same shape elsewhere stays white. The ${gatePieceName("c")} copies the shape in the ${square} square into the empty centre square. In the question the pieces snap together as ${gatePieceRun(queryGateIds)}. Follow them in that order, using the board each piece leaves for the next piece. The board after the last piece is the missing one.`,
  );
  const family = definition(
    "transformation-machine-v4",
    cueIds,
    JSON.stringify({ program, queryOrder }),
    (candidate) => {
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      if (candidate.stem.length !== gateCount * 3 + 3) return empty;
      const panels = candidate.stem.map(scenePanel);
      const worked: { input: Scene; output: Scene; gateKey: string }[] = [];
      for (let row = 0; row < gateCount; row++) {
        const input = panels[row * 3];
        const shownGate = panels[row * 3 + 1];
        const output = panels[row * 3 + 2];
        const gateKey = shownGate && gateSymbolKey(shownGate);
        if (!input || !output || !gateKey) return empty;
        worked.push({ input, output, gateKey });
      }
      const queryInput = panels[gateCount * 3];
      const queryGates = panels[gateCount * 3 + 1];
      if (!queryInput || !queryGates) return empty;
      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const stripValid = queryGates.tiles.length === 0 &&
        queryGates.rows === 3 &&
        queryGates.columns === 3 &&
        orderedQueryGates.length === gateCount &&
        orderedQueryGates.every((placement, index) => placement.row === 1 && placement.column === index) &&
        orderedQueryGates.every((placement) => worked.some((row) => JSON.stringify(placement.object) === row.gateKey)) &&
        new Set(orderedQueryGates.map((placement) => JSON.stringify(placement.object))).size === gateCount;
      if (!stripValid) return empty;
      const shownOrder = orderedQueryGates.map((placement) =>
        worked.findIndex((row) => row.gateKey === JSON.stringify(placement.object)));

      const survivors = INTERACTING_MACHINE_GRAMMAR.filter((candidateProgram) =>
        interactingGates(candidateProgram).every((gate, index) =>
          interactingExampleMatches(worked[index].input, worked[index].output, gate)));
      const executions = survivors.flatMap((candidateProgram) => {
        const outputs = runInteracting(queryInput, candidateProgram, shownOrder);
        return outputs ? [{ program: candidateProgram, outputs }] : [];
      });
      const predictions = distinctOutputs(executions.map((execution) => execution.outputs[gateCount - 1]));
      const wrong = wrongExecutionsFor(queryInput, survivors, shownOrder);
      const reasons = firstReasonFor([
        ...wrong,
        ...(predictions.length === 1 ? partialSceneExecutions(predictions[0], wrong, "features") : []),
      ]);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return {
    ...asCandidate(family, puzzle),
    queryGates: { order: queryOrder, run: (order) => runInteractingInOrder(query, program, order) },
  };
}

/** How many worked gates a composed-transform item shows. */
export type ComposedGateCount = SceneComposedProgramLength;

const COMPOSED_TRANSFORM_D4_BUCKET = "composed-transform-d4";
const COMPOSED_TRANSFORM_D5_BUCKET = "composed-transform-d5";

/** The displayed gate count each named bucket draws at. */
const COMPOSED_TRANSFORM_BUCKET_GATES: Readonly<Record<string, ComposedGateCount>> = {
  [COMPOSED_TRANSFORM_D4_BUCKET]: 2,
  [COMPOSED_TRANSFORM_D5_BUCKET]: 3,
};

/** d4 applies its two worked transformations in their demonstrated order. */
const COMPOSED_TRANSFORM_PAIR_ORDER = [0, 1] as const;

/** The hardest served machine questions always reorder all three worked transforms. */
const COMPOSED_TRANSFORM_HARD_ORDERS: readonly (readonly [number, number, number])[] = [
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Every ordered program a solver could posit at each displayed depth — the
 * oracle's search space. Servability, single-gate ablation, and the
 * public/held-out split are narrower views of these two lists.
 */
const composedTransformGrammars = new Map<ComposedGateCount, readonly SceneComposedProgram[]>();

function composedTransformGrammarFor(gateCount: ComposedGateCount): readonly SceneComposedProgram[] {
  const cached = composedTransformGrammars.get(gateCount);
  if (cached) return cached;
  const grammar: readonly SceneComposedProgram[] = gateCount === 2
    ? enumerateSceneOrderedCompositions()
    : enumerateSceneOrderedThreeStepCompositions();
  composedTransformGrammars.set(gateCount, grammar);
  return grammar;
}

/** Gate labels, in the order the query strip shows them. */
const COMPOSED_GATE_LETTERS = ["A", "B", "C"] as const;
const COMPOSED_GATE_COUNT_WORDS: Readonly<Record<ComposedGateCount, string>> = {
  2: "two",
  3: "three",
};

/** Applies one gate to one board. The sweep below passes a memoizing version. */
type ComposedStepper = (input: Scene, step: SceneCompositionPrimitive) => Scene | null;

function runComposedGates(
  input: Scene,
  steps: readonly SceneCompositionPrimitive[],
  order: readonly number[],
  apply: ComposedStepper,
): Scene | null {
  let value: Scene | null = input;
  for (const index of order) value = value && apply(value, steps[index]);
  return value;
}

function composedGateIndexes(gateCount: number): number[] {
  return Array.from({ length: gateCount }, (_, index) => index);
}

/** Every ordered selection of `length` distinct gates. */
function composedGateRuns(gateCount: number, length: number): number[][] {
  const build = (available: readonly number[], remaining: number): number[][] => {
    if (remaining === 0) return [[]];
    return available.flatMap((head) =>
      build(available.filter((index) => index !== head), remaining - 1)
        .map((tail) => [head, ...tail]));
  };
  return build(composedGateIndexes(gateCount), length);
}

/** Every query-gate run except the one the strip shows. */
function composedWrongGateOrders(gateCount: number, runOrder?: readonly number[]): number[][] {
  const correctOrder = runOrder ?? composedGateIndexes(gateCount);
  const correct = correctOrder.join(",");
  return composedGateRuns(gateCount, correctOrder.length)
    .filter((order) => order.join(",") !== correct);
}

/**
 * Every proper, non-empty run of the gates in displayed order — that is, every
 * way to skip at least one gate but keep the rest in the order shown.
 */
function composedGateOmissions(
  gateCount: number,
  runOrder?: readonly number[],
): { kept: number[]; skipped: number[] }[] {
  const all = runOrder ?? composedGateIndexes(gateCount);
  const omissions: { kept: number[]; skipped: number[] }[] = [];
  for (let mask = 1; mask < (1 << all.length) - 1; mask++) {
    const kept = all.filter((_, position) => ((mask >> position) & 1) === 1);
    const skipped = all.filter((_, position) => ((mask >> position) & 1) === 0);
    omissions.push({ kept, skipped });
  }
  return omissions;
}

function composedGateList(indexes: readonly number[]): string {
  const letters = indexes.map((index) => COMPOSED_GATE_LETTERS[index]);
  return letters.length === 1
    ? letters[0]
    : `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`;
}

/**
 * Wrong ways to RUN the demonstrated gates: a wrong order, or a run that skips
 * at least one of them.
 *
 * These need no search through the grammar, which is what lets the servability
 * sweep enumerate a whole grammar without re-deriving every program.
 */
function composedRunErrors(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  const gateCount = steps.length;
  const queryGateCount = runOrder?.length ?? gateCount;
  return [
    ...composedWrongGateOrders(gateCount, runOrder).map((order) => ({
      output: runComposedGates(query, steps, order, apply),
      reason: `applies the ${queryGateCount} query gates in a different order`,
    })),
    ...composedGateOmissions(gateCount, runOrder).map(({ kept, skipped }) => ({
      output: runComposedGates(query, steps, kept, apply),
      reason: `skips demonstrated gate ${composedGateList(skipped)}`,
    })),
  ];
}

/**
 * Wrong READINGS of the worked rows: one gate replaced by another primitive
 * that does not reproduce that gate's own worked row.
 *
 * Enumerated from the primitive pool rather than by scanning the grammar for
 * near neighbours — the same set, at a fraction of the cost.
 */
function composedReadingErrors(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  const executions: Array<{ output: Scene | null; reason: string }> = [];
  const order = runOrder ?? composedGateIndexes(steps.length);
  for (const index of order) {
    for (const replacement of sceneComposedPrimitives()) {
      if (compositionPrimitiveKey(replacement) === compositionPrimitiveKey(steps[index])) continue;
      const misread = steps.map((step, position) => (position === index ? replacement : step));
      if (!isSceneComposedProgram(misread)) continue;
      executions.push({
        // A misread gate is still run the way this item runs its gates.
        output: runComposedGates(query, misread, order, apply),
        reason: "replaces one step with a primitive that fails its worked row",
      });
    }
  }
  return executions;
}

/**
 * Wrong ways to answer that make TWO of the mistakes above in one run: two
 * gates misread, or one gate misread and the gates then run in another order or
 * with one skipped.
 *
 * Added 2026-09-29. With single mistakes only, every near miss sat one mistake
 * from the answer and none shared a mistake with another, so the answer was the
 * centre of the option list and a solver who never read the question picked it
 * (docs/plans/blind-answer-leak.md). A two-mistake run sits beside the
 * one-mistake run it extends, which is what lets the option list be a tree
 * rather than a star. A run with two mistakes is still one program, and the
 * review screen names it as one.
 *
 * Kept apart from `composedWrongExecutions` because servability counts only
 * single mistakes: whether a program is well posed does not depend on how
 * wrong an answer can get.
 */
function composedCompoundErrors(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  const executions: Array<{ output: Scene | null; reason: string }> = [];
  const order = runOrder ?? composedGateIndexes(steps.length);
  const primitives = sceneComposedPrimitives();
  const misreadsOf = (base: readonly SceneCompositionPrimitive[], index: number) => primitives
    .filter((replacement) => compositionPrimitiveKey(replacement) !== compositionPrimitiveKey(steps[index]))
    .map((replacement) => base.map((step, position) => (position === index ? replacement : step)))
    .filter((misread) => isSceneComposedProgram(misread));
  for (const index of order) {
    for (const misread of misreadsOf(steps, index)) {
      for (const wrongOrder of composedWrongGateOrders(steps.length, order)) {
        executions.push({
          output: runComposedGates(query, misread, wrongOrder, apply),
          reason: "misreads one gate and runs the gates in another order",
        });
      }
      for (const { kept } of composedGateOmissions(steps.length, order)) {
        if (!kept.includes(index)) continue;
        executions.push({
          output: runComposedGates(query, misread, kept, apply),
          reason: "misreads one gate and skips another",
        });
      }
      for (const other of order) {
        if (other <= index) continue;
        for (const twice of misreadsOf(misread, other)) {
          executions.push({
            output: runComposedGates(query, twice, order, apply),
            reason: "misreads two gates",
          });
        }
      }
    }
  }
  if (steps.length === 3) {
    for (const program of composedTransformGrammar(3)) {
      const replacements = sceneComposedProgramSteps(program);
      if (replacements.some((step, index) => compositionPrimitiveKey(step) === compositionPrimitiveKey(steps[index]))) continue;
      executions.push({
        output: runComposedGates(query, replacements, order, apply),
        reason: "misreads all three gates",
      });
    }
  }
  return executions;
}

/**
 * Every wrong way to answer a composed item, with the reason the review screen
 * shows. Generation draws its near misses from exactly this list and the
 * validator witnesses options against it, so nothing can be served that the
 * oracle cannot explain.
 */
function composedWrongExecutions(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper = applySceneCompositionPrimitive,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  return [
    ...composedRunErrors(query, steps, apply, runOrder),
    ...composedReadingErrors(query, steps, apply, runOrder),
  ];
}

function compositionPrimitiveDescription(primitive: SceneCompositionPrimitive): string {
  if (primitive.kind === "spatial") return boardMoveDescription(primitive.operation, "does");
  if (primitive.kind === "turn") return `turns every arrow ${quarterTurnsWords(primitive.quarterTurns)} in its own square`;
  if (primitive.kind === "moveSolid") return `moves every black shape one square ${primitive.direction}, leaving white and grey shapes where they are`;
  return `colours the shape in the ${squareName(primitive.at)} square ${FILL_WORDS[primitive.fill]}`;
}

function compositionPrimitiveMatches(input: Scene, output: Scene, primitive: SceneCompositionPrimitive): boolean {
  const predicted = applySceneCompositionPrimitive(input, primitive);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

function compositionPrimitiveKey(primitive: SceneCompositionPrimitive): string {
  return JSON.stringify(primitive);
}

/**
 * The shapes a composed-transform board draws from, plus the one arrow every
 * board carries.
 *
 * The arrow is the only token on the board whose own direction can be read, so
 * it is what makes a token turn visible at all. It is present whether or not
 * the drawn program turns anything: a board with nothing orientable would make
 * `turn` a step that changes nothing, and the grammar rejects such a step
 * rather than serving it.
 */
const CANONICAL_COMPOSED_SHAPES = ["circle", "square", "triangle", "diamond", "star"] as const;
const COMPOSED_ORIENTABLE_SHAPE = "arrow" as const;

/** The query board every composed-transform item shows: two tokens and an arrow. */
function composedTransformQuery(shapes: readonly SceneToken["shape"][]): Scene {
  return scene([
    { row: 0, column: 0, object: token(shapes[4]) },
    { row: 2, column: 0, object: token(shapes[3]) },
    { row: 0, column: 2, object: token(COMPOSED_ORIENTABLE_SHAPE) },
  ]);
}

/**
 * The input board of one gate's worked row.
 *
 * A fill gate needs a token in the upper-left slot to repaint; every other gate
 * needs a board whose movement, or whose arrow, is easy to follow. Both layouts
 * carry the arrow, which is what lets one worked row show a board that moved
 * while its arrow kept pointing the same way, and another show an arrow that
 * turned while the board stood still.
 *
 * Neither layout has both tokens on the upper-left-to-lower-right diagonal.
 * Until 2026-10-04 the fill layout put its arrow in the lower-right corner, so
 * a flip across that diagonal left the whole board in place and "flip, then
 * repaint" reproduced the row as well as "repaint". In 131 of 200 d4 items a
 * wrong option followed from that reading (docs/plans/one-reading-per-worked-row.md).
 * With one token off the diagonal, no flip or turn but "none" keeps both where
 * they are.
 */
function composedWorkedInput(
  primitive: SceneCompositionPrimitive,
  shapes: readonly SceneToken["shape"][],
  offset: number,
): Scene {
  const partner = token(shapes[offset % shapes.length]);
  // A left-right mirror leaves an up arrow looking the same, so with one the row
  // also fits "a mirror turns arrows round too". In the v22 tests a turn had
  // pointed the question's arrow sideways before the mirror ran, and Sonnet 5.5
  // and Opus 5.5 both reversed it (a wrong option followed in 10 of 200 d5
  // items). A sideways arrow that keeps its direction rules that reading out.
  // An up arrow already does it for the top-bottom flip: a real flip would
  // point it down.
  const mirrorsColumns = primitive.kind === "spatial" &&
    primitive.operation.kind === "reflect" && primitive.operation.axis === "horizontal";
  // The fill layout shows the partner twice, and only the top-left one changes.
  // With one partner, "colour that kind of shape, wherever it stands" fitted the
  // row as well as "colour the top-left square"; when the question started with
  // the same shape in that square, it led to a wrong option, and Opus 5.5 and
  // Codex both took it in the v23 re-run (26 of 200 d5 items, 19 of 200 d4).
  // The second partner stands where no flip or turn of the board maps the row
  // onto itself.
  return primitive.kind === "setFillAt"
    ? scene([
        { row: 0, column: 0, object: partner },
        { row: 1, column: 2, object: partner },
        { row: 2, column: 1, object: token(COMPOSED_ORIENTABLE_SHAPE) },
      ])
    : scene([
        { row: 0, column: 0, object: partner },
        {
          row: 1,
          column: 2,
          object: { ...token(COMPOSED_ORIENTABLE_SHAPE, "solid"), rotation: mirrorsColumns ? 90 : 0 },
        },
      ]);
}

/**
 * Does a fill piece land on the arrow when the query runs in this order?
 *
 * Every fill example colours a shape in the top-left square while an arrow
 * elsewhere stays uncoloured, so "the fill piece never colours an arrow" fits it
 * as well as "it colours whatever stands there". The two readings part only when
 * the question has carried the arrow into that square first. In the v22 tests
 * (2026-10-04) Sonnet 5.5 and Opus 5.5 then coloured the shape that had started
 * there and lost 5 of 6 such answers; 51 of 200 d4 items and 38 of 200 d5 items
 * had it (docs/plans/one-reading-per-worked-row.md). The query board is fixed,
 * so it is a property of the program and its order, and such programs are not
 * served.
 */
function composedFillLandsOnArrow(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  order: readonly number[],
  apply: ComposedStepper,
): boolean {
  let board: Scene | null = query;
  for (const index of order) {
    if (!board) return false;
    const step = steps[index];
    if (step.kind === "setFillAt" && board.objects.some((placement) =>
      placement.row === step.at.row && placement.column === step.at.column &&
      placement.object.kind === "token" && placement.object.shape === COMPOSED_ORIENTABLE_SHAPE)) {
      return true;
    }
    board = apply(board, step);
  }
  return false;
}

/**
 * Cache one gate application per (board, gate) pair.
 *
 * The servability sweep runs every ordering and every partial run of every
 * program on ONE canonical query, so the same board meets the same gate many
 * times, and each application re-validates a scene. The cache is created per
 * sweep and holds only the boards one query can reach, and it changes nothing
 * about the result: the same pair always had the same answer.
 */
function memoizedComposedStepper(): ComposedStepper {
  // Keyed by object identity, not by scene contents: every board in a sweep
  // either is the one canonical query or came out of this cache, so identical
  // boards are the same object and hashing a reference costs nothing. A caller
  // that passes a structurally equal but different object simply misses.
  const byInput = new Map<Scene, Map<SceneCompositionPrimitive, Scene | null>>();
  return (input, step) => {
    let bySteps = byInput.get(input);
    if (!bySteps) {
      bySteps = new Map();
      byInput.set(input, bySteps);
    }
    if (bySteps.has(step)) return bySteps.get(step) ?? null;
    const output = applySceneCompositionPrimitive(input, step);
    bySteps.set(step, output);
    return output;
  };
}

/**
 * Is this program servable, and does every gate it displays actually matter?
 *
 * Four conditions, all on the fixed canonical query. Geometry alone decides
 * them, so checking one shape order is exact: renaming shapes is a bijection on
 * scene signatures.
 *
 *  1. the program runs end to end;
 *  2. the fully reversed order lands on a different board, so order is visibly
 *     part of the rule;
 *  3. SINGLE-GATE ABLATION — deleting any one displayed gate changes the final
 *     board. Before 2026-08-25, 16 of the 56 public three-step programs failed
 *     this: they painted the upper-left slot twice in a row, so the first paint
 *     was invisible and a nominally three-step item really needed two. A gate a
 *     solver can ignore is not a step; the program is not servable. An ablated
 *     run that does not apply at all counts as changed — it produces no board,
 *     so it cannot reproduce the answer; and
 *  4. running the gates wrongly leaves enough distinct boards to fill the
 *     option list; and
 *  5. no fill gate lands on the arrow (`composedFillLandsOnArrow`), since
 *     2026-10-04.
 */
function composedProgramIsServable(program: SceneComposedProgram, apply: ComposedStepper): boolean {
  const steps = sceneComposedProgramSteps(program);
  const displayed = composedGateIndexes(steps.length);
  const query = composedTransformQuery(CANONICAL_COMPOSED_SHAPES);
  const answer = runComposedGates(query, steps, displayed, apply);
  if (!answer) return false;
  if (composedFillLandsOnArrow(query, steps, displayed, apply)) return false;
  const answerKey = sceneSignature(answer);

  const reversed = runComposedGates(query, steps, [...displayed].reverse(), apply);
  if (!reversed || sceneSignature(reversed) === answerKey) return false;

  for (const gate of displayed) {
    const ablated = runComposedGates(query, steps, displayed.filter((index) => index !== gate), apply);
    if (ablated && sceneSignature(ablated) === answerKey) return false;
  }

  // Counted lazily, and only over the wrong RUNS: they are a subset of the near
  // misses generation actually draws from, so a program that clears the bar
  // here clears it there too, and the sweep never has to price the rest.
  const wrongBoards = new Set<string>();
  const collect = (order: readonly number[]) => {
    if (wrongBoards.size >= DISTRACTORS_PER_ITEM) return;
    const output = runComposedGates(query, steps, order, apply);
    if (!output) return;
    const key = sceneSignature(output);
    if (key !== answerKey) wrongBoards.add(key);
  };
  for (const order of composedWrongGateOrders(steps.length)) collect(order);
  for (const { kept } of composedGateOmissions(steps.length)) collect(kept);
  return wrongBoards.size >= DISTRACTORS_PER_ITEM;
}

/**
 * A held-out program moves the board twice and then only touches tokens.
 *
 * The committed split (raise-the-ceiling plan, Lever 2): a program is HELD OUT
 * when its first two steps both move board positions and every remaining step
 * is token-local — a fill change or a turn. That is the one composition shape
 * the public pool never practises, while every primitive stays publicly
 * visible. Only three gates can have that shape: two gates cannot begin with
 * two board moves in this grammar, and nothing deeper exists any more.
 */
function composedProgramIsHeldOut(program: SceneComposedProgram): boolean {
  const steps = sceneComposedProgramSteps(program);
  return steps[0].kind === "spatial" && steps[1].kind === "spatial" &&
    steps.slice(2).every((step) => step.kind !== "spatial");
}

interface ComposedTransformPartition {
  publicPrograms: readonly SceneComposedProgram[];
  heldOutPrograms: readonly SceneComposedProgram[];
}

const composedPartitions = new Map<ComposedGateCount, ComposedTransformPartition>();

/**
 * Public/held-out split over the servable programs of one displayed depth.
 *
 * The held-out list is consumed only by evaluation harnesses, never by the
 * public assembler; the leakage test in scene-families.test.ts enforces the
 * boundary, and the partition test proves the two sides are disjoint and
 * together are the whole servable space.
 */
export function partitionComposedTransformPrograms(
  gateCount: ComposedGateCount = 3,
): ComposedTransformPartition {
  const cached = composedPartitions.get(gateCount);
  if (cached) return cached;
  const apply = memoizedComposedStepper();
  const servable = composedTransformGrammarFor(gateCount)
    .filter((program) => gateCount === 2
      ? composedRecombinedOrderIsServable(program, COMPOSED_TRANSFORM_PAIR_ORDER)
      : composedProgramIsServable(program, apply));
  const partition: ComposedTransformPartition = {
    publicPrograms: servable.filter((program) => !composedProgramIsHeldOut(program)),
    heldOutPrograms: servable.filter(composedProgramIsHeldOut),
  };
  composedPartitions.set(gateCount, partition);
  return partition;
}

/** Every servable program of one displayed depth, public and held out alike. */
export function servableComposedTransformPrograms(
  gateCount: ComposedGateCount,
): readonly SceneComposedProgram[] {
  const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
  return [...publicPrograms, ...heldOutPrograms];
}

/** The complete grammar one displayed depth is drawn from, before any filter. */
export function composedTransformGrammar(gateCount: ComposedGateCount): readonly SceneComposedProgram[] {
  return composedTransformGrammarFor(gateCount);
}

/**
 * The board servability and single-gate ablation are decided on.
 *
 * Exported so the ablation and partition proofs measure the same board the
 * filter used. A test that rebuilt this board from a copy of the template would
 * keep passing after the template changed, which is exactly the kind of proof
 * that proves nothing.
 */
export function canonicalComposedTransformQuery(): Scene {
  return composedTransformQuery(CANONICAL_COMPOSED_SHAPES);
}

/**
 * Every bucket that displays a gate strip, and how many gates it shows.
 *
 * The owner's standing rule of 2026-08-27 is that no item may display more than
 * three gates: a fourth is more procedure, not more reasoning. A rule kept only
 * in comments gets broken by the next batch, so a test walks this table against
 * the promotion registry and fails if anything a band can draw shows a fourth.
 * A new gate bucket has to be registered here to be covered — which is the
 * point: the table is the single place gate counts are declared.
 */
export function declaredGateCounts(): Readonly<Record<string, number>> {
  return {
    ...COMPOSED_TRANSFORM_BUCKET_GATES,
    ...TRANSFORMATION_MACHINE_BUCKET_GATES,
    "composed-transform-v3-d5": 3,
  };
}

interface GateWitnessGroup {
  id: string;
  alternatives: readonly Scene[];
}

interface MachineWitnesses {
  groups: GateWitnessGroup[];
  predictions: readonly Scene[];
  order: readonly number[];
}

/**
 * Hide one worked transformation at a time. Re-read the other examples and
 * run every fitting program in the visible query order. A wrong choice among
 * those predictions proves that the hidden transformation is needed.
 * Keeping the other transformations exact is stronger than merely checking
 * that omitting a step changes the generated answer.
 */
function machineGateWitnessGroups(familyId: SceneFamilyId, stem: Puzzle["stem"]): MachineWitnesses | null {
  const gateCount = (stem.length - 3) / 3;
  if (gateCount !== 2 && gateCount !== 3) return null;
  const panels = stem.map(scenePanel);
  const worked = composedGateIndexes(gateCount).map((index) => ({
    input: panels[index * 3], output: panels[index * 3 + 2],
    glyph: panels[index * 3 + 1] && gateSymbolKey(panels[index * 3 + 1]!),
  }));
  const query = panels[gateCount * 3];
  const strip = panels[gateCount * 3 + 1];
  if (!query || !strip || worked.some((row) => !row.input || !row.output || !row.glyph)) return null;
  const placements = [...strip.objects].sort((left, right) => left.column - right.column);
  const order = placements.map((placement) => worked.findIndex((row) => row.glyph === JSON.stringify(placement.object)));
  if (strip.tiles.length !== 0 || strip.rows !== 3 || strip.columns !== 3 || order.length !== gateCount ||
      new Set(order).size !== gateCount || order.includes(-1) ||
      placements.some((placement, index) => placement.row !== 1 || placement.column !== index)) return null;

  if (familyId === "transformation-machine-v4") {
    if (gateCount !== 3) return null;
    const pools = [MACHINE_SPATIAL_GRAMMAR, MACHINE_PAINT_GRAMMAR, MACHINE_DUPLICATE_GRAMMAR];
    const matches = worked.map((row, index) => new Set<InteractingMachineGate>(pools[index]
      .filter((gate) => interactingExampleMatches(row.input!, row.output!, gate))));
    const predictions = (omitted: number) => distinctOutputs(INTERACTING_MACHINE_GRAMMAR
      .filter((program) => interactingGates(program).every((gate, index) => index === omitted || matches[index].has(gate)))
      .map((program) => runInteractingInOrder(query, program, order)));
    return { order, predictions: predictions(-1), groups: order.map((omitted) => ({
      id: `worked-gate-${COMPOSED_GATE_IDS[omitted]}`, alternatives: predictions(omitted),
    })) };
  }
  if (familyId === "composed-transform-v2") {
    const matches = worked.map((row) => new Set(sceneComposedPrimitives()
      .filter((gate) => compositionPrimitiveMatches(row.input!, row.output!, gate))
      .map((gate) => JSON.stringify(gate))));
    const programs = composedTransformGrammar(gateCount).map(sceneComposedProgramSteps);
    const predictions = (omitted: number) => distinctOutputs(programs
      .filter((steps) => steps.every((gate, index) => index === omitted || matches[index].has(JSON.stringify(gate))))
      .map((steps) => runComposedGates(query, steps, order, applySceneCompositionPrimitive)));
    return { order, predictions: predictions(-1), groups: order.map((omitted) => ({
      id: `worked-gate-${COMPOSED_GATE_IDS[omitted]}`, alternatives: predictions(omitted),
    })) };
  }
  return null;
}

export interface MachineGateNecessity {
  valid: boolean;
  queryOrder: readonly number[];
  dispensableGateIds: string[];
  /** Option indexes still possible when just this transformation is unknown. */
  remainingOptions: { gateId: string; optionIndexes: number[] }[];
}

/** Re-check authored and generated choices from visible examples alone. */
export function machineGateNecessity(puzzle: Puzzle): MachineGateNecessity | null {
  if (puzzle.familyId !== "transformation-machine-v4" && puzzle.familyId !== "composed-transform-v2") return null;
  const witnesses = machineGateWitnessGroups(puzzle.familyId, puzzle.stem);
  if (!witnesses) return { valid: false, queryOrder: [], dispensableGateIds: ["invalid-machine"], remainingOptions: [] };
  const { groups, predictions, order } = witnesses;
  const remainingOptions = groups.map(({ id, alternatives }) => {
    const possible = new Set(alternatives.map(sceneSignature));
    return { gateId: id, optionIndexes: puzzle.options.flatMap((option, index) => possible.has(sceneSignature(option)) ? [index] : []) };
  });
  const dispensableGateIds = remainingOptions.filter(({ optionIndexes }) =>
    !optionIndexes.includes(puzzle.answerIndex) || optionIndexes.length < 2).map(({ gateId }) => gateId);
  if (predictions.length !== 1 || sceneSignature(predictions[0]) !== sceneSignature(puzzle.options[puzzle.answerIndex])) {
    dispensableGateIds.push("invalid-machine-answer");
  }
  return { valid: dispensableGateIds.length === 0, queryOrder: order, dispensableGateIds, remainingOptions };
}

interface ComposedProgramOrder {
  program: SceneComposedProgram;
  queryOrder: readonly number[];
}

/** Program/order eligibility depends only on the cached program population. */
const composedProgramOrderCache = new WeakMap<
  readonly SceneComposedProgram[],
  Map<string, ComposedProgramOrder[]>
>();

/**
 * Whether an ordered query has a unique answer and a full near-miss set, and
 * never asks a fill gate to colour the arrow (`composedFillLandsOnArrow`).
 */
function composedRecombinedOrderIsServable(
  program: SceneComposedProgram,
  queryOrder: readonly number[],
): boolean {
  const steps = sceneComposedProgramSteps(program);
  const query = composedTransformQuery(CANONICAL_COMPOSED_SHAPES);
  if (composedFillLandsOnArrow(query, steps, queryOrder, applySceneCompositionPrimitive)) return false;
  const answer = runComposedGates(query, steps, queryOrder, applySceneCompositionPrimitive);
  const reversed = runComposedGates(
    query, steps, [...queryOrder].reverse(), applySceneCompositionPrimitive);
  if (!answer || !reversed || sceneSignature(answer) === sceneSignature(reversed)) return false;
  const answerKey = sceneSignature(answer);
  for (const gate of queryOrder) {
    const ablated = runComposedGates(
      query, steps, queryOrder.filter((index) => index !== gate), applySceneCompositionPrimitive);
    if (ablated && sceneSignature(ablated) === answerKey) return false;
  }
  const wrongBoards = distinctOutputs(
    composedWrongExecutions(query, steps, applySceneCompositionPrimitive, queryOrder)
      .map((execution) => execution.output),
  ).filter((candidate) => sceneSignature(candidate) !== answerKey);
  return wrongBoards.length >= DISTRACTORS_PER_ITEM;
}

function composedProgramOrders(
  programs: readonly SceneComposedProgram[],
  bucketId: string,
): ComposedProgramOrder[] {
  const byBucket = composedProgramOrderCache.get(programs) ?? new Map<string, ComposedProgramOrder[]>();
  const cached = byBucket.get(bucketId);
  if (cached) return cached;
  const choices = bucketId !== COMPOSED_TRANSFORM_D5_BUCKET
    ? programs.map((program) => ({
      program,
      queryOrder: composedGateIndexes(sceneComposedProgramSteps(program).length),
    }))
    : programs
      .filter((program) => sceneComposedProgramSteps(program).length === 3)
      .flatMap((program) => COMPOSED_TRANSFORM_HARD_ORDERS
        .filter((queryOrder) => composedRecombinedOrderIsServable(program, queryOrder))
        .map((queryOrder) => ({ program, queryOrder })));
  byBucket.set(bucketId, choices);
  composedProgramOrderCache.set(programs, byBucket);
  return choices;
}

function composedTransform(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = COMPOSED_TRANSFORM_BUCKET_GATES[bucket.bucket] ?? 3;
  const choices = composedProgramOrders(
    partitionComposedTransformPrograms(gateCount).publicPrograms,
    bucket.bucket,
  );
  const choice = pick(rng, choices);
  return composedTransformForProgram(choice.program, rng, {
    bucketId: bucket.bucket,
    queryOrder: choice.queryOrder,
  });
}

function composedTransformForProgram(
  program: SceneComposedProgram,
  rng: Rng,
  options: { bucketId: string; queryOrder?: readonly number[] },
): SceneFamilyCandidate {
  const steps = sceneComposedProgramSteps(program);
  const gateCount = steps.length as ComposedGateCount;
  const displayed = composedGateIndexes(gateCount);
  const gateIds = displayed.map((index) => COMPOSED_GATE_IDS[index]);
  const queryOrder = options.queryOrder ?? displayed;
  if (queryOrder.length !== gateCount || new Set(queryOrder).size !== queryOrder.length ||
    queryOrder.some((index) => index < 0 || index >= gateCount)) {
    throw new Error("composed transform query must use every worked gate exactly once");
  }
  const queryGateIds = queryOrder.map((index) => gateIds[index]);
  const bucket = requireSceneFamilyBucket(
    "composed-transform-v2",
    options.bucketId,
  );
  const shapes = shuffled(rng, CANONICAL_COMPOSED_SHAPES);
  const worked = steps.map((step, index) => {
    const input = composedWorkedInput(step, shapes, index * 2);
    const output = applySceneCompositionPrimitive(input, step);
    if (!output) throw new Error("composed transform needs a worked row for every displayed gate");
    return { input, output };
  });
  const query = composedTransformQuery(shapes);
  const answer = runComposedGates(query, steps, queryOrder, applySceneCompositionPrimitive);
  const otherDirection = runComposedGates(
    query, steps, [...queryOrder].reverse(), applySceneCompositionPrimitive);
  if (!answer || !otherDirection || sceneSignature(otherDirection) === sceneSignature(answer)) {
    throw new Error(`composed transform needs a servable ${queryOrder.length}-gate query`);
  }
  // One stepper for the whole pool: the runs share most of their prefixes.
  const poolStepper = memoizedComposedStepper();
  const wrongExecutions = [
    ...composedWrongExecutions(query, steps, poolStepper, queryOrder),
    ...composedCompoundErrors(query, steps, poolStepper, queryOrder),
  ];
  const stem = [
    ...worked.flatMap((row, index) => [row.input, gateVisual(gateIds[index]), row.output]),
    query,
    gateVisual(...queryGateIds),
    { blank: true as const },
  ];
  const nearMissPool = machineDistractorsWithoutSecondReadings("composed-transform-v2", stem, answer,
    distinctOutputs([
      ...wrongExecutions,
      ...partialSceneExecutions(answer, wrongExecutions, "features"),
    ].map((execution) => execution.output))
      .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)));
  // The five wrong choices must keep every worked transformation necessary.
  // Reversed runs remain in the pool, alongside other plausible mistakes.
  const composedDistractors = selectDistractors(nearMissPool, rng, "composed transform", { answer, familyId: "composed-transform-v2",
    requiredWitnessGroups: machineGateWitnessGroups("composed-transform-v2", stem)?.groups ?? [],
    alternateExecutions: distinctOutputs(wrongExecutions.map(({ output }) => output)).filter((output) => output.objects.length === answer.objects.length),
  });
  const gateWord = COMPOSED_GATE_COUNT_WORDS[gateCount];
  const cueIds = [
    ...gateIds.map((gateId) => `worked-gate-${gateId}`),
    "query-gate-order",
    ...(steps.some((step) => step.kind === "setFillAt") ? ["targeted-fill-slot"] : []),
    ...(steps.some((step) => step.kind === "turn") ? ["token-orientation"] : []),
  ];
  const instruction = `Infer each worked gate, then apply the ${gateWord} query gates from left to right.`;
  const gateEffects = steps
    .map((step, index) => `The ${gatePieceName(gateIds[index])} ${compositionPrimitiveDescription(step)}.`)
    .join(" ");
  const arrowNote = steps.some((step) => step.kind === "spatial")
    ? " A piece that rotates or mirrors the board moves the shapes to new squares, but the arrows keep pointing the same way."
    : "";
  const explanation = `Each example row shows one jigsaw piece changing a board. ${gateEffects}${arrowNote} In the question the pieces snap together as ${gatePieceRun(queryOrder.map((index) => gateIds[index]))}, and the board goes through them in that order. The board after the last piece is the missing one.`;
  const puzzle = makePuzzle(
    "prototype-composed-transform",
    "matrix",
    "machineTable",
    instruction,
    bucket.difficulty,
    stem,
    answer,
    composedDistractors,
    rng,
    explanation,
  );
  const family = definition(
    "composed-transform-v2",
    cueIds,
    sceneComposedProgramKey(program),
    (candidate) => {
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      if (candidate.stem.length !== gateCount * 3 + 3) return empty;
      const panels = candidate.stem.map(scenePanel);
      const workedRows: { input: Scene; output: Scene; gateKey: string }[] = [];
      for (const index of displayed) {
        const input = panels[index * 3];
        const shownGate = panels[index * 3 + 1];
        const output = panels[index * 3 + 2];
        const gateKey = shownGate && gateSymbolKey(shownGate);
        if (!input || !output || !gateKey) return empty;
        workedRows.push({ input, output, gateKey });
      }
      const queryInput = panels[gateCount * 3];
      const queryGates = panels[gateCount * 3 + 1];
      if (!queryInput || !queryGates) return empty;

      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const visibleQueryOrder = orderedQueryGates.map((placement) =>
        workedRows.findIndex((row) => row.gateKey === JSON.stringify(placement.object)));
      const queryGateCount = visibleQueryOrder.length;
      const stripValid = queryGates.tiles.length === 0 &&
        queryGates.rows === 3 &&
        queryGates.columns === 3 &&
        queryGateCount === queryOrder.length &&
        orderedQueryGates.every((placement, index) => placement.row === 1 && placement.column === index) &&
        visibleQueryOrder.every((index) => index >= 0) &&
        new Set(visibleQueryOrder).size === visibleQueryOrder.length;
      if (!stripValid) return empty;

      // Every program in the grammar whose i-th gate reproduces the i-th worked
      // row. Building it slot by slot from the primitive pool and then keeping
      // only the combinations the grammar contains is exactly the same set as
      // filtering the whole grammar, and the equivalence has its own test.
      const matchesByGate = workedRows.map((row) =>
        sceneComposedPrimitives().filter((primitive) =>
          compositionPrimitiveMatches(row.input, row.output, primitive)));
      const survivors: SceneComposedProgram[] = [];
      const build = (index: number, chosen: SceneCompositionPrimitive[]) => {
        if (index === gateCount) {
          if (isSceneComposedProgram(chosen)) survivors.push(sceneComposedProgramFromSteps(chosen));
          return;
        }
        for (const primitive of matchesByGate[index]) build(index + 1, [...chosen, primitive]);
      };
      build(0, []);

      const predictFor = (candidateProgram: SceneComposedProgram): Scene | null => {
        const candidateSteps = sceneComposedProgramSteps(candidateProgram);
        return runComposedGates(
          queryInput, candidateSteps, visibleQueryOrder, applySceneCompositionPrimitive);
      };
      const predictions = distinctOutputs(survivors.map(predictFor));
      // Single mistakes first, so a board one mistake explains keeps that name.
      const stepper = memoizedComposedStepper();
      const wrongExecutions = [
        ...survivors.flatMap((survivor) => composedWrongExecutions(
          queryInput, sceneComposedProgramSteps(survivor), stepper, visibleQueryOrder)),
        ...survivors.flatMap((survivor) => composedCompoundErrors(
          queryInput, sceneComposedProgramSteps(survivor), stepper, visibleQueryOrder)),
      ];
      const reasons = firstReasonFor([
        ...wrongExecutions,
        ...(predictions.length === 1 ? partialSceneExecutions(predictions[0], wrongExecutions, "features") : []),
      ]);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return {
    ...asCandidate(family, puzzle),
    queryGates: {
      order: queryOrder,
      run: (order) => runComposedGates(query, steps, order, applySceneCompositionPrimitive),
    },
  };
}

/** Conditional prototype: board move, local repaint, then move current solids. */
type ConditionalMove = Extract<SceneCompositionPrimitive, { kind: "moveSolid" }>;
interface ConditionalComposedDraw {
  steps: readonly SceneCompositionPrimitive[];
  queryCells: readonly ScenePosition[];
}
const CONDITIONAL_DIRECTIONS = ["up", "right", "down", "left"] as const;
const CONDITIONAL_SQUARES = Array.from({ length: 9 }, (_, index) => ({ row: Math.floor(index / 3), column: index % 3 }));
const CONDITIONAL_PRIMITIVES: readonly SceneCompositionPrimitive[] = [
  ...sceneComposedPrimitives().filter((primitive) => primitive.kind === "spatial"),
  ...CONDITIONAL_SQUARES.map((at): SceneCompositionPrimitive => ({ kind: "setFillAt", at, fill: "solid" })),
  ...CONDITIONAL_DIRECTIONS.map((direction): ConditionalMove => ({ kind: "moveSolid", direction })),
];
const sameSquare = (first: ScenePosition, second: ScenePosition) => first.row === second.row && first.column === second.column;
function conditionalQuery(cells: readonly ScenePosition[], shapes: readonly SceneToken["shape"][]): Scene {
  return scene(cells.map((at, index) => ({ ...at, object: token(shapes[index], index === 2 ? "solid" : "outline") })));
}
let conditionalComposedDraws: readonly ConditionalComposedDraw[] | undefined;

/** Exhaustive geometric filter, independent of answer options and shape names. */
export function servableConditionalComposedDraws(): readonly ConditionalComposedDraw[] {
  if (conditionalComposedDraws) return conditionalComposedDraws;
  const draws: ConditionalComposedDraw[] = [];
  for (const spatial of CONDITIONAL_PRIMITIVES.filter((primitive) => primitive.kind === "spatial")) {
    for (const at of CONDITIONAL_SQUARES) {
      const arriving = CONDITIONAL_SQUARES.find((cell) => {
        const moved = applySceneCompositionPrimitive(one("circle", cell.row, cell.column), spatial)!;
        return sameSquare(moved.objects[0], at);
      })!;
      if (sameSquare(arriving, at)) continue;
      for (const third of CONDITIONAL_SQUARES.filter((cell) => !sameSquare(cell, at) && !sameSquare(cell, arriving))) {
        for (const direction of CONDITIONAL_DIRECTIONS) {
          const steps: SceneCompositionPrimitive[] = [spatial, { kind: "setFillAt", at, fill: "solid" }, { kind: "moveSolid", direction }];
          const queryCells = [arriving, at, third];
          const query = conditionalQuery(queryCells, ["circle", "square", "diamond"]);
          const run = (order: readonly number[]) => runComposedGates(query, steps, order, applySceneCompositionPrimitive);
          if (!run([0, 1, 2])) continue;
          const outcome = gateOrderOutcome([0, 1, 2], run);
          if (everyAdjacentSwapMatters(outcome) && outcome.ablations.every((result) => result === "different")) {
            draws.push({ steps, queryCells });
          }
        }
      }
    }
  }
  conditionalComposedDraws = draws;
  return draws;
}

function conditionalPinnedRow(
  primitive: SceneCompositionPrimitive,
  received: Scene,
  inputs: readonly Scene[],
  rng: Rng,
): { input: Scene; output: Scene } {
  const expected = applySceneCompositionPrimitive(received, primitive);
  if (!expected) throw new Error("a conditional gate must apply to its received query board");
  const rows = inputs.flatMap((input) => {
    const output = applySceneCompositionPrimitive(input, primitive);
    if (!output) return [];
    const readings = machineWorkedRowReadings("composed-transform-v3", input, output);
    return readings.length > 0 && readings.every((reading) => {
      const predicted = reading.apply(received);
      return predicted !== null && boardKey(predicted) === boardKey(expected);
    }) ? [{ input, output }] : [];
  });
  if (!rows.length) throw new Error(`no contrasting row pins ${primitive.kind} on its query`);
  return pick(rng, rows);
}

function conditionalWorkedRows(steps: readonly SceneCompositionPrimitive[], query: Scene, rng: Rng) {
  // Three different shapes show every query-occupied square. This also rules
  // out conditional slides wrapped in a symmetry that fit a sparse two-shape row.
  const moveShapes = ["star", "hexagon", "triangle"] as const;
  const moveInput = scene(query.objects.map((placement, index) => ({
    row: placement.row, column: placement.column,
    object: token(moveShapes[index], (placement.object as SceneToken).fill),
  })));
  const move = conditionalPinnedRow(steps[0], query, [moveInput], rng);
  const afterMove = applySceneCompositionPrimitive(query, steps[0])!;
  const paint = steps[1] as Extract<SceneCompositionPrimitive, { kind: "setFillAt" }>;
  const paintInputs = CONDITIONAL_SQUARES.filter((cell) => !sameSquare(cell, paint.at)).flatMap((second) =>
    CONDITIONAL_SQUARES.filter((cell) => !sameSquare(cell, paint.at) && !sameSquare(cell, second)).map((third) => scene([
      { ...paint.at, object: token("star") }, { ...second, object: token("star") },
      { ...third, object: token("hexagon", "half") },
    ])));
  const repaint = conditionalPinnedRow(paint, afterMove, paintInputs, rng);
  const received = applySceneCompositionPrimitive(afterMove, paint)!;
  const solids = received.objects.filter(({ object }) => object.kind === "token" && object.fill === "solid");
  const white = received.objects.find(({ object }) => object.kind === "token" && object.fill === "outline")!;
  // Every query-occupied square appears here with the same moved/stationary status.
  // Thus even fixed-square readings involving extra empty squares agree on the query.
  const movementInputs = CONDITIONAL_SQUARES.filter((cell) => !received.objects.some((placement) => sameSquare(cell, placement)))
    .map((half) => scene([
      { row: solids[0].row, column: solids[0].column, object: token("star", "solid") },
      { row: solids[1].row, column: solids[1].column, object: token("hexagon", "solid") },
      { row: white.row, column: white.column, object: token("star") },
      { ...half, object: token("hexagon", "half") },
    ]));
  const movement = conditionalPinnedRow(steps[2], received, movementInputs, rng);
  return [move, repaint, movement];
}

function conditionalWrongExecutions(query: Scene, steps: readonly SceneCompositionPrimitive[], order: readonly number[] = [0, 1, 2]) {
  const stepper = memoizedComposedStepper();
  const alternatives = ["spatial", "setFillAt", "moveSolid"].map((kind) =>
    CONDITIONAL_PRIMITIVES.filter((primitive) => primitive.kind === kind));
  const compound: { output: Scene | null; reason: string }[] = [];
  for (const first of alternatives[0]) for (const second of alternatives[1]) for (const third of alternatives[2]) {
    const mistaken = [first, second, third];
    const errors = mistaken.filter((step, index) => compositionPrimitiveKey(step) !== compositionPrimitiveKey(steps[index])).length;
    if (errors === 0 || errors > 2) continue;
    compound.push({ output: runComposedGates(query, mistaken, order, stepper),
      reason: "misreads the board move, painted square or movement direction" });
    if (errors === 1) {
      const changed = mistaken.findIndex((step, index) => compositionPrimitiveKey(step) !== compositionPrimitiveKey(steps[index]));
      for (const { kept } of composedGateOmissions(3, order)) {
        if (!kept.includes(changed)) continue;
        compound.push({ output: runComposedGates(query, mistaken, kept, stepper),
          reason: "misreads one gate and skips another demonstrated gate" });
      }
      for (const wrongOrder of composedWrongGateOrders(3, order)) {
        compound.push({ output: runComposedGates(query, mistaken, wrongOrder, stepper),
          reason: "misreads one gate and applies the gates in another order" });
      }
    }
  }
  return [
    ...composedWrongExecutions(query, steps, stepper, order),
    ...composedCompoundErrors(query, steps, stepper, order),
    ...compound,
    ...conditionalMovementReadings().map((reading) => {
      let output: Scene | null = query;
      for (const index of order) {
        output = output && (index === 2 ? reading.apply(output) : stepper(output, steps[index]));
      }
      return { output, reason: `misreads the movement gate as ${reading.name}` };
    }),
  ];
}

function conditionalComposedTransform(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const draw = pick(rng, servableConditionalComposedDraws());
  const shapes = shuffled(rng, ["circle", "square", "diamond"] as const);
  const query = conditionalQuery(draw.queryCells, shapes);
  const worked = conditionalWorkedRows(draw.steps, query, rng);
  const answer = runComposedGates(query, draw.steps, [0, 1, 2], applySceneCompositionPrimitive)!;
  const stem = [
    ...worked.flatMap((row, index) => [row.input, gateVisual(COMPOSED_GATE_IDS[index]), row.output]),
    query, gateVisual("a", "b", "c"), { blank: true as const },
  ];
  if (!machineWorkedRowsAgreeOnQuery("composed-transform-v3", stem, answer)) {
    throw new Error("conditional worked rows allow a different or undefined query answer");
  }
  const wrong = conditionalWrongExecutions(query, draw.steps);
  const fillKey = (value: Scene) => JSON.stringify(value.objects.map(({ object }) =>
    `${object.shape}:${(object as SceneToken).fill}`).sort());
  const fillPatterns = new Set([fillKey(answer), fillKey(runComposedGates(query, draw.steps, [0], applySceneCompositionPrimitive)!)]);
  const pool = distinctOutputs([
    ...wrong, ...partialSceneExecutions(answer, wrong, "features"),
  ].map((execution) => execution.output)).filter((output) => boardKey(output) !== boardKey(answer) && fillPatterns.has(fillKey(output)));
  const cueIds = ["worked-gate-a", "worked-gate-b", "worked-gate-c", "current-fill-selection", "query-gate-order"];
  const puzzle = makePuzzle("prototype-conditional-composed-transform", "matrix", "machineTable",
    "Infer each worked gate, then apply the three query gates from left to right.", bucket.difficulty,
    stem, answer, selectDistractors(pool, rng, "conditional composed transform", {
      answer, familyId: "composed-transform-v3",
      // Same fills, different positions: the last movement must be solved to
      // choose between the answer and a board that stops after repainting.
      required: [
        runComposedGates(query, draw.steps, [0, 1], applySceneCompositionPrimitive)!,
      ],
    }), rng,
    `Each example shows one jigsaw piece changing a board. The ${gatePieceName("a")} ${compositionPrimitiveDescription(draw.steps[0])}. The ${gatePieceName("b")} ${compositionPrimitiveDescription(draw.steps[1])}. The ${gatePieceName("c")} ${compositionPrimitiveDescription(draw.steps[2])}. In the question, follow the pieces in order. After the board moves and one shape turns black, both black shapes move together. The white shape stays where it is.`);
  const definition_ = definition("composed-transform-v3", cueIds, JSON.stringify(draw.steps), (candidate) => {
    const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
    if (candidate.stem.length !== 12 || !candidate.stem[11] || !("blank" in candidate.stem[11])) return empty;
    const panels = candidate.stem.map(scenePanel);
    const queryInput = panels[9];
    const strip = panels[10];
    if (!queryInput || !strip || strip.rows !== 3 || strip.columns !== 3 || strip.tiles.length) return empty;
    const rows = [0, 1, 2].map((index) => ({ input: panels[index * 3], gate: panels[index * 3 + 1], output: panels[index * 3 + 2] }));
    if (rows.some((row) => !row.input || !row.output || !row.gate || !gateSymbolKey(row.gate))) return empty;
    const stripObjects = [...strip.objects].sort((left, right) => left.column - right.column);
    if (stripObjects.length !== 3 || stripObjects.some((entry, index) => entry.row !== 1 || entry.column !== index)) return empty;
    const keys = rows.map((row) => gateSymbolKey(row.gate!));
    if (new Set(keys).size !== 3) return empty;
    const order = stripObjects.map(({ object }) => keys.indexOf(JSON.stringify(object)));
    if (order.some((index) => index < 0) || new Set(order).size !== 3) return empty;
    // Derive each gate from its visible row; the chosen generation program is not used.
    const matches = rows.map((row) => CONDITIONAL_PRIMITIVES.filter((primitive) => compositionPrimitiveMatches(row.input!, row.output!, primitive)));
    const predictions: Scene[] = [];
    const programs: SceneCompositionPrimitive[][] = [];
    for (const first of matches[0]) for (const second of matches[1]) for (const third of matches[2]) {
      const program = [first, second, third];
      const output = runComposedGates(queryInput, program, order, applySceneCompositionPrimitive);
      if (!output) return empty;
      programs.push(program); predictions.push(output);
    }
    const outputs = distinctOutputs(predictions);
    if (outputs.length !== 1 || !machineWorkedRowsAgreeOnQuery("composed-transform-v3", candidate.stem, outputs[0])) return empty;
    const errors = programs.flatMap((program) => conditionalWrongExecutions(queryInput, program, order));
    const reasons = firstReasonFor([...errors, ...partialSceneExecutions(outputs[0], errors, "features")]);
    return { derivedAnswer: outputs[0], solutionCount: 1, usedCueIds: cueIds,
      distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => reasons.get(sceneSignature(option)) ?? null) };
  });
  return { ...asCandidate(definition_, puzzle), queryGates: { order: [0, 1, 2], run: (order) =>
    runComposedGates(query, draw.steps, order, applySceneCompositionPrimitive) } };
}

const RING_POSITIONS = [
  { row: 0, column: 0 },
  { row: 0, column: 1 },
  { row: 0, column: 2 },
  { row: 1, column: 2 },
  { row: 2, column: 2 },
  { row: 2, column: 1 },
  { row: 2, column: 0 },
  { row: 1, column: 0 },
] as const;

interface RingStepRule {
  direction: -1 | 1;
  startStep: 1 | 2 | 3;
  stepDelta: 0 | 1 | 2;
}

/**
 * Every bounded jump rule a solver could read off the shown landings, including
 * the constant-jump rules where the step never grows. Those cannot be the hidden
 * rule — a constant jump is a first-order sequence — but a solver who assumes
 * one lands somewhere specific, so they belong in the enumeration that finds
 * competing predictions and witnesses the wrong options.
 */
const RING_STEP_GRAMMAR: readonly RingStepRule[] = ([-1, 1] as const).flatMap((direction) =>
  ([1, 2, 3] as const).flatMap((startStep) =>
    ([0, 1, 2] as const).map((stepDelta) => ({ direction, startStep, stepDelta }))));

/** The rules this family may actually hide: the jump has to grow. */
const RING_SECOND_ORDER_RULES: readonly RingStepRule[] =
  RING_STEP_GRAMMAR.filter((rule) => rule.stepDelta > 0);

function ringRuleDescription(rule: RingStepRule): string {
  const direction = rule.direction === 1 ? "clockwise" : "counter-clockwise";
  return rule.stepDelta === 0
    ? `the ${direction} rule that jumps ${rule.startStep} slot${rule.startStep === 1 ? "" : "s"} every time`
    : `the ${direction} rule that starts at ${rule.startStep} and grows by ${rule.stepDelta}`;
}

function ringIndexes(rule: RingStepRule, length: number, startIndex = 0): number[] {
  const indexes = [startIndex];
  for (let transition = 0; transition < length - 1; transition++) {
    const step = rule.direction * (rule.startStep + transition * rule.stepDelta);
    indexes.push(((indexes[indexes.length - 1] + step) % RING_POSITIONS.length + RING_POSITIONS.length) % RING_POSITIONS.length);
  }
  return indexes;
}

/** Same contract as `selectDistractors`, for a family whose near misses are ring slots. */
function selectRingIndexes(pool: readonly number[], rng: Rng): number[] {
  const selected = shuffled(rng, pool).slice(0, DISTRACTORS_PER_ITEM);
  if (selected.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(
      `second-order sequence needs ${DISTRACTORS_PER_ITEM} competing predictions but found ${selected.length}`,
    );
  }
  return selected;
}

function secondOrderSequence(rng: Rng): SceneFamilyCandidate {
  const rule = pick(rng, RING_SECOND_ORDER_RULES);
  const [shape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const startIndex = pick(rng, RING_POSITIONS.map((_, index) => index));
  const indexes = ringIndexes(rule, 6, startIndex);
  const atIndex = (index: number) => one(shape, RING_POSITIONS[index].row, RING_POSITIONS[index].column, "solid");
  const shown = indexes.slice(0, 5).map(atIndex);
  const answer = atIndex(indexes[5]);
  const competingByPrediction = new Map<number, RingStepRule>();
  for (const candidateRule of RING_STEP_GRAMMAR) {
    const candidateIndexes = ringIndexes(candidateRule, 6, startIndex);
    const fits = candidateIndexes.slice(0, 5).every((index, position) => index === indexes[position]);
    const prediction = candidateIndexes[5];
    if (!fits && prediction !== indexes[5]) competingByPrediction.set(prediction, candidateRule);
  }
  const distractorIndexes = selectRingIndexes([...competingByPrediction.keys()], rng);
  const puzzle = makePuzzle(
    "prototype-second-order-sequence",
    "sequence",
    "row",
    "Track how the perimeter jump changes. Where does the token land next?",
    4,
    [...shown, { blank: true }],
    answer,
    distractorIndexes.map(atIndex),
    rng,
    `Follow the shape around the eight squares at the edge of the board. It jumps ${[0, 1, 2, 3].map((index) => rule.startStep + index * rule.stepDelta).join(", ")} squares ${rule.direction === 1 ? "clockwise" : "anticlockwise"}: each jump is ${squaresWords(rule.stepDelta)} longer than the one before. So the next jump is ${rule.startStep + 4 * rule.stepDelta} squares, counted on from the shape's square in the last picture${rule.startStep + 4 * rule.stepDelta >= 8 ? ", going all the way round the edge and on" : ""}.`,
  );
  const family = definition(
    "second-order-sequence-v2",
    ["perimeter-order", "movement-direction", "growing-jump-size"],
    JSON.stringify(rule),
    (candidate) => {
      const scenes = candidate.stem.slice(0, -1).map(scenePanel);
      if (scenes.some((panel) => !panel)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const firstObject = scenes[0]!.objects[0]?.object;
      const observed = scenes.map((panel) => {
        if (!panel || panel.objects.length !== 1 || panel.tiles.length > 0 || !firstObject ||
            firstObject.kind !== "token" || JSON.stringify(panel.objects[0].object) !== JSON.stringify(firstObject)) return -1;
        return RING_POSITIONS.findIndex((position) =>
          position.row === panel.objects[0].row && position.column === panel.objects[0].column);
      });
      const observedStart = observed[0];
      const survivors = observedStart === -1 ? [] : RING_STEP_GRAMMAR.filter((candidateRule) =>
        ringIndexes(candidateRule, observed.length, observedStart)
          .every((index, position) => index === observed[position]));
      const predictedIndexes = new Set(survivors.map((candidateRule) =>
        ringIndexes(candidateRule, observed.length + 1, observedStart).at(-1)!));
      const predictions = firstObject?.kind === "token"
        ? [...predictedIndexes].map((index) => scene([{
            row: RING_POSITIONS[index].row,
            column: RING_POSITIONS[index].column,
            object: firstObject,
          }]))
        : [];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["perimeter-order", "movement-direction", "growing-jump-size"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const optionPlacement = option.objects[0];
          if (!optionPlacement || !firstObject || JSON.stringify(optionPlacement.object) !== JSON.stringify(firstObject)) return null;
          const optionIndex = RING_POSITIONS.findIndex((position) =>
            position.row === optionPlacement.row && position.column === optionPlacement.column);
          const failedRule = RING_STEP_GRAMMAR.find((candidateRule) => {
            const candidateIndexes = ringIndexes(candidateRule, observed.length + 1, observedStart);
            return candidateIndexes.at(-1) === optionIndex &&
              !candidateIndexes.slice(0, observed.length).every((index, position) => index === observed[position]);
          });
          return failedRule ? `${ringRuleDescription(failedRule)} fails a shown landing` : null;
        }),
      };
    },
  );
  // Single-strand row: all five shown landings belong to the answered strand,
  // and the blank is the sixth slot at the same stride of one.
  return asCandidate(family, puzzle, [0, 1, 2, 3, 4]);
}

function inverseAnalogy(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, ANALOGY_COMPOSITION_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // Both inputs share their two fills, so both shown boards do too after the
  // same fill step: every change the question needs has a worked twin.
  const [workedFills, queryFills] = sharedAnalogyFills(rng);
  const originalA = scene([
    { row: 0, column: 0, object: token(shapes[0], workedFills[0]) },
    { row: 1, column: 2, object: token(shapes[1], workedFills[1]) },
  ]);
  const outputA = applyAnalogyComposition(originalA, program)!;
  const originalB = scene([
    { row: 0, column: 1, object: token(shapes[2], queryFills[0]) },
    { row: 2, column: 0, object: token(shapes[3], queryFills[1]) },
  ]);
  const outputB = applyAnalogyComposition(originalB, program)!;
  // The input each near-miss program would need to reach the third board:
  // every other program in the grammar, and every run that undoes only some of
  // the two changes (see `AnalogyNearMissProgram`). Each fails the worked pair.
  const inverseProgram = (candidateProgram: AnalogyNearMissProgram): AnalogyNearMissProgram => ({
    spatial: candidateProgram.spatial === null || candidateProgram.spatial.kind === "reflect"
      ? candidateProgram.spatial
      : {
          kind: "rotate",
          quarterTurns: (4 - candidateProgram.spatial.quarterTurns) as 1 | 2 | 3,
        },
    fillDelta: ((3 - candidateProgram.fillDelta) % 3) as 0 | 1 | 2,
    turn: 0,
  });
  const nearMissGrammar = analogyNearMissGrammar(false);
  const wrongExecutionsFor = (workedInput: Scene, workedOutput: Scene, queryOutput: Scene) =>
    nearMissGrammar.flatMap((candidateProgram) => {
      const worked = applyAnalogyNearMiss(workedInput, candidateProgram);
      if (worked !== null && sceneSignature(worked) === sceneSignature(workedOutput)) return [];
      return [{
        output: applyAnalogyNearMiss(queryOutput, inverseProgram(candidateProgram)),
        reason: analogyNearMissSkips(candidateProgram, false)
          ? "this input undoes only one of the two changes the worked pair shows"
          : "this input works only under a program that fails the inverse worked pair",
      }];
    });
  const wrongExecutions = wrongExecutionsFor(originalA, outputA, outputB);
  const distractors = distinctOutputs([
    ...wrongExecutions,
    ...partialSceneExecutions(originalB, wrongExecutions, "features"),
  ].map((execution) => execution.output))
    .filter((candidate) => {
      if (sceneSignature(candidate) === sceneSignature(originalB)) return false;
      const targetOutput = applyAnalogyComposition(candidate, program);
      return targetOutput === null || sceneSignature(targetOutput) !== sceneSignature(outputB);
    });
  const selectedDistractors = selectDistractors(distractors, rng, "inverse analogy", { answer: originalB, familyId: "inverse-analogy-v2" });
  const puzzle = makePuzzle(
    "prototype-inverse-analogy",
    "analogy",
    "analogy",
    "The first pair undoes two changes. Which scene similarly precedes the third?",
    4,
    [outputA, originalA, outputB],
    originalB,
    selectedDistractors,
    rng,
    `From the top-left board to the top-right board, two things change. The change ${boardMoveDescription(program.spatial.kind === "rotate" ? { kind: "rotate", quarterTurns: (4 - program.spatial.quarterTurns) as 1 | 2 | 3 } : program.spatial, "does")}, so every shape moves to a new square, and every fill ${fillStepDescription(3 - program.fillDelta)}. Make both changes to the bottom-left board to get the missing board.`,
  );
  const family = definition(
    "inverse-analogy-v2",
    ["inverse-worked-pair", "ordered-board-slots", "fill-states"],
    `inverse:${JSON.stringify(program)}`,
    (candidate) => {
      const [workedOutput, workedInput, queryOutput] = candidate.stem.map(scenePanel);
      if (!workedOutput || !workedInput || !queryOutput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = ANALOGY_COMPOSITION_GRAMMAR.filter((candidateProgram) => {
        const predicted = applyAnalogyComposition(workedInput, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const selections = survivors.map((candidateProgram) => candidate.options.flatMap((option, optionIndex) => {
        const predicted = applyAnalogyComposition(option, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(queryOutput) ? [optionIndex] : [];
      }));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      const derivedAnswer = unique ? candidate.options[[...predictedIndexes][0]] : null;
      const wrongExecutions = wrongExecutionsFor(workedInput, workedOutput, queryOutput);
      const reasons = firstReasonFor([
        ...wrongExecutions,
        ...(derivedAnswer ? partialSceneExecutions(derivedAnswer, wrongExecutions, "features") : []),
      ]);
      return {
        derivedAnswer,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["inverse-worked-pair", "ordered-board-slots", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          reasons.get(sceneSignature(option)) ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function spatialAssembly(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const draw = drawSpatialAssembly(rng);
  const cueIds = ["placed-piece", "second-piece", "third-piece", "quarter-turns-only"];
  const puzzle = makePuzzle("prototype-spatial-assembly", "matrix", "assembly",
    "Fit the pieces into the frame, keeping the placed piece where it is.", bucket.difficulty,
    draw.stem, draw.answer, selectDistractors(draw.distractors, rng, "spatial assembly", {
      answer: draw.answer, required: draw.required, familyId: "spatial-assembly-v1",
    }), rng, draw.explanation);
  return asCandidate(definition("spatial-assembly-v1", cueIds, draw.program, (candidate) => {
    const solutions = solveSpatialAssembly(candidate.stem);
    return {
      derivedAnswer: solutions.length === 1 ? solutions[0] : null,
      solutionCount: solutions.length,
      usedCueIds: cueIds,
      distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex,
        (option) => spatialAssemblyWrongReason(candidate.stem, option)),
    };
  }), puzzle);
}

function classicMatrixCandidate(
  familyId: "overlapping-figures-v1" | "attribute-matrix-v1",
  rng: Rng,
  bucket: SceneFamilyBucket,
): SceneFamilyCandidate {
  for (let attempt = 0; attempt < 64; attempt++) {
    const draw = familyId === "overlapping-figures-v1"
      ? drawOverlappingFigures(rng, bucket.difficulty as 3 | 4 | 5)
      : drawAttributeMatrix(rng, bucket.difficulty as 2 | 3 | 4);
    let distractors: Scene[];
    try {
      distractors = selectDistractors(draw.pool, rng, familyId, {
        answer: draw.answer, familyId, clueModel: SCENE_FAMILY_CLUE_MODELS[familyId], clueDomain: draw.boards,
        requireEveryIntendedClue: familyId === "attribute-matrix-v1",
      });
    } catch (error) {
      if (error instanceof CluesNotSharedError) continue;
      throw error;
    }
    const puzzle = makePuzzle(`prototype-${familyId}`, "matrix", "grid3x3", "Complete the pattern.",
      bucket.difficulty, [...draw.boards.slice(0, 8), { blank: true }], draw.answer, distractors, rng, draw.explanation);
    puzzle.gridFlow = "rowsAndColumns";
    const solve = familyId === "overlapping-figures-v1" ? solveOverlappingFigures : solveAttributeMatrix;
    return asCandidate(definition(familyId, draw.cueIds, draw.ruleKey, solve), puzzle);
  }
  throw new Error(`${familyId}: no balanced six-option list after 64 draws`);
}

/** Retry drawings that cannot require every transform while balancing the six choices. */
function withNecessaryMachineChoices(draw: () => SceneFamilyCandidate): SceneFamilyCandidate {
  for (let attempt = 0; attempt < 64; attempt++) {
    try { return draw(); }
    catch (error) {
      if (!(error instanceof CluesNotSharedError)) throw error;
    }
  }
  throw new Error("no balanced six-choice machine requiring every transformation after 64 draws");
}

/** Build one candidate at a named bucket; refuse undeclared levels before drawing randomness. */
export function generateSceneFamilyCandidate(
  familyId: SceneFamilyId,
  rng: Rng,
  difficultyBucket: string,
): SceneFamilyCandidate {
  const bucket = requireSceneFamilyBucket(familyId, difficultyBucket);
  switch (familyId) {
    case "relational-sequence-v2": return relationalSequence(rng);
    case "attribute-pairing-v1": return attributePairing(rng);
    case "compositional-analogy-v2": return compositionalAnalogy(rng, bucket);
    case "composed-transform-v2": return withNecessaryMachineChoices(() => composedTransform(rng, bucket));
    case "composed-transform-v3": return conditionalComposedTransform(rng, bucket);
    case "relational-matrix-v2": return relationalMatrix(rng);
    case "visual-set-algebra-v2": return setAlgebra(rng, { bucket });
    case "spatial-transform-v2": return spatialTransform(rng);
    case "transformation-machine-v3": return transformationMachine(rng, bucket);
    case "transformation-machine-v4": return withNecessaryMachineChoices(() => interactingMachine(rng, bucket));
    case "spatial-assembly-v1": return spatialAssembly(rng, bucket);
    case "overlapping-figures-v1":
    case "attribute-matrix-v1": return classicMatrixCandidate(familyId, rng, bucket);
    case "second-order-sequence-v2": return secondOrderSequence(rng);
    case "inverse-analogy-v2": return inverseAnalogy(rng);
  }
}

export function validateSceneFamilyCandidate(
  candidate: SceneFamilyCandidate,
  expectedReplayKey?: string,
): AcceptanceResult {
  const acceptance = acceptFamilyCandidate(candidate.definition, candidate.puzzle, { expectedReplayKey });
  if (!acceptance.puzzle) return acceptance;
  const clues = sceneFamilyClueCheck(acceptance.puzzle);
  const issues = [...acceptance.issues];
  const necessity = machineGateNecessity(acceptance.puzzle);
  if (necessity && !necessity.valid) {
    issues.push({ code: "clue-shortcut", message: `worked transformations can be skipped: ${necessity.dispensableGateIds.join(", ")}` });
  }
  if (candidate.puzzle.difficulty >= 5 && necessity &&
      (necessity.queryOrder.length !== 3 || necessity.queryOrder.every((gate, index) => gate === index) ||
       JSON.stringify(necessity.queryOrder) !== JSON.stringify(candidate.queryGates?.order))) {
    issues.push({ code: "gate-order", message: "the hardest machine query must reorder its three worked transforms" });
  }
  if (candidate.familyId === "transformation-machine-v4" || candidate.familyId === "composed-transform-v3") {
    const gates = candidate.queryGates;
    const outcome = gates ? gateOrderOutcome(gates.order, gates.run) : null;
    if (!outcome || outcome.gateCount !== 3 || !everyAdjacentSwapMatters(outcome) || outcome.ablations.includes("same") ||
        (candidate.familyId === "composed-transform-v3" && outcome.ablations.some((result) => result !== "different"))) {
      issues.push({ code: "gate-order", message: "the interacting gates need three necessary steps and two valid different adjacent swaps" });
    }
  }
  if (clues.singleClueAnswerIds.length > 0 || clues.indistinguishableWrongOptionIndexes.length > 0) {
    issues.push({ code: "clue-shortcut", message: `single-clue answer: ${clues.singleClueAnswerIds.join(", ")}; ambiguous options: ${clues.indistinguishableWrongOptionIndexes.join(", ")}` });
  }
  if (candidate.familyId === "attribute-matrix-v1" && clues.dispensableClueIds.length > 0) {
    issues.push({ code: "clue-shortcut", message: `matrix relationships can be skipped: ${clues.dispensableClueIds.join(", ")}` });
  }
  return { ...acceptance, accepted: issues.length === 0, issues };
}

/**
 * Build one item for a RESERVED combination (raise-the-ceiling plan, Lever 2).
 * Evaluation harnesses only: the public assembler never calls this, and the
 * leakage test asserts the public pool cannot produce these programs.
 */
export function generateHeldOutComposedTransformCandidate(
  rng: Rng,
  gateCount: ComposedGateCount = 3,
  bucketId: string = COMPOSED_TRANSFORM_D5_BUCKET,
): SceneFamilyCandidate {
  const { heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
  if (heldOutPrograms.length === 0) {
    throw new Error(`no held-out composed-transform programs at ${gateCount} gates`);
  }
  const choices = composedProgramOrders(heldOutPrograms, bucketId);
  if (choices.length === 0) {
    throw new Error(`no held-out composed-transform programs support ${bucketId}`);
  }
  return withNecessaryMachineChoices(() => {
    const choice = pick(rng, choices);
    return composedTransformForProgram(choice.program, rng, {
      bucketId,
      queryOrder: choice.queryOrder,
    });
  });
}

/** Materialize the only currently supported LLM-proposed rule through pure code. */
export function generateProposedSetAlgebraCandidate(
  operation: SceneBinaryOperation,
  rng: Rng,
): SceneFamilyCandidate {
  return setAlgebra(rng, { forcedOperation: operation });
}
