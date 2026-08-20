import { createHash } from "node:crypto";
import { pick, shuffled, type Rng } from "../lib/rng";
import {
  areScenesCategoricallyDistinct,
  DISTRACTORS_PER_ITEM,
  isScene,
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
  applySceneOrderedComposition,
  applySceneUnary,
  enumerateSceneConcepts,
  enumerateSceneOrderedCompositions,
  sceneOrderedCompositionKey,
  sceneSatisfiesConcept,
  type SceneBinaryOperation,
  type SceneCompositionPrimitive,
  type SceneConcept,
  type SceneOrderedComposition,
  type SceneUnaryOperation,
} from "./scene-grammar";
import { topologyFailures, type TopologyGoal } from "./topology";

export const SCENE_FAMILY_IDS = [
  "relational-sequence-v2",
  "attribute-pairing-v1",
  "compositional-analogy-v2",
  "containment-analogy-v2",
  "composed-transform-v1",
  "relational-outlier-v2",
  "relational-matrix-v2",
  "visual-set-algebra-v2",
  "constraint-mosaic-v2",
  "topology-path-v1",
  "spatial-transform-v2",
  "transformation-machine-v3",
  "rule-switching-v2",
  "concept-induction-v2",
  "fold-punch-v2",
  "inverse-fold-punch-v2",
  "interleaved-sequence-v2",
  "second-order-sequence-v2",
  "inverse-analogy-v2",
  "minimal-repair-v3",
] as const;
export type SceneFamilyId = (typeof SCENE_FAMILY_IDS)[number];

export interface SceneFamilyCandidate {
  familyId: SceneFamilyId;
  puzzle: Puzzle<Scene>;
  definition: FamilyDefinition<Scene, string>;
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

function scenePanel(panel: Puzzle<Scene>["stem"][number] | undefined): Scene | null {
  return panel && !("blank" in panel) ? panel : null;
}

/**
 * Choose the wrong options for one item.
 *
 * Every family builds its near misses from its own rule grammar and hands the
 * whole pool here. Taking the count from one constant is what lets the battery
 * change option count in a single edit. A family whose pool is too thin throws,
 * so a grammar that cannot support the current option count fails loudly at
 * generation instead of quietly serving an easier item.
 */
function selectDistractors(
  pool: readonly Scene[],
  rng: Rng,
  familyName: string,
  /** Near misses that must appear whatever else is drawn — a family's sharpest contrast. */
  required: readonly Scene[] = [],
): Scene[] {
  const requiredKeys = new Set(required.map(sceneSignature));
  const rest = pool.filter((candidate) => !requiredKeys.has(sceneSignature(candidate)));
  const selected = [...required, ...shuffled(rng, rest)].slice(0, DISTRACTORS_PER_ITEM);
  if (selected.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(
      `${familyName} needs ${DISTRACTORS_PER_ITEM} near misses but its grammar produced ${selected.length}`,
    );
  }
  return selected;
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
): DistractorWitness<string>[] {
  return options.flatMap((option, optionIndex) => {
    if (optionIndex === answerIndex) return [];
    const witness = witnessFor(option);
    return witness === null ? [] : [{ optionIndex, witness }];
  });
}

function asCandidate(
  family: FamilyDefinition<Scene, string>,
  puzzle: Puzzle<Scene>,
): SceneFamilyCandidate {
  const familyId = family.familyId as SceneFamilyId;
  return { familyId, puzzle: { ...puzzle, familyId }, definition: family };
}

function replayKey(familyId: SceneFamilyId, puzzle: Puzzle<Scene>, ruleKey: string): string {
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
  validate: (puzzle: Puzzle<Scene>) => ValidationReport<Scene, string>,
): FamilyDefinition<Scene, string> {
  return {
    familyId,
    isVisual: isScene,
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
  difficulty: 1 | 2 | 3 | 4 | 5,
  stem: Puzzle<Scene>["stem"],
  answer: Scene,
  distractors: readonly Scene[],
  rng: Rng,
  explanation: string,
): Puzzle<Scene> {
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

const RELATIONAL_FILLS = ["outline", "half", "solid"] as const;

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
  const second = applyRelationalStep(start, program)!;
  const third = applyRelationalStep(second, program)!;
  const answer = applyRelationalStep(third, program)!;
  const distractors = distinctOutputs(RELATIONAL_STEP_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyRelationalStep(third, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "relational sequence");
  const direction = program.positionDelta > 0 ? "clockwise" : "counter-clockwise";
  const stepSize = Math.abs(program.positionDelta);
  const fillRule = program.fillDelta === 0
    ? "keeps the same fill"
    : program.fillDelta === 1
      ? "cycles outline to half to solid"
      : "cycles outline to solid to half";
  const puzzle = makePuzzle(
    "prototype-relational-sequence",
    "sequence",
    "row",
    "Continue both changes around the fixed centre token.",
    2,
    [start, second, third, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    `The solid centre token is the fixed anchor. In every step, the other token moves ${stepSize} perimeter slot${stepSize === 1 ? "" : "s"} ${direction} and ${fillRule}. Applying both visible changes once more gives the highlighted scene; each other option follows a different step or fill rule that fails one of the shown transitions.`,
  );
  const family = definition(
    "relational-sequence-v2",
    ["ordered-perimeter-slots", "fixed-centre-anchor", "fill-states"],
    JSON.stringify(program),
    (candidate) => {
      const [first, next, query] = candidate.stem.map(scenePanel);
      if (!first || !next || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const examples = [
        { input: first, output: next },
        { input: next, output: query },
      ];
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
  return asCandidate(family, puzzle);
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
  const query = one(shapes[2], queryStart.row, queryStart.column, fills[2]);
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
      candidateProgram.fill === "same" ? fills[2] : fills[0],
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
    selectDistractors(distinctOutputs(competingPartners), rng, "attribute pairing"),
    rng,
    `In the worked pair, the second token has ${program.shape === "same" ? "the same shape" : "a different shape"} and ${program.fill === "same" ? "the same fill" : "a different fill"}, and it sits ${program.direction === "right" ? "one slot to the right of" : "one slot below"} the first token. The highlighted option keeps all three relationships beside the query token. Every other choice is what a different shape, fill, and direction rule would predict, and each of those rules disagrees with the worked pair.`,
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
}

const ANALOGY_SPATIAL_GRAMMAR: readonly AnalogySpatialOperation[] = [
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
] as const;

const ANALOGY_COMPOSITION_GRAMMAR: readonly AnalogyCompositionProgram[] =
  ANALOGY_SPATIAL_GRAMMAR.flatMap((spatial) =>
    ([1, 2] as const).map((fillDelta) => ({ spatial, fillDelta })));

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
  return moved === null
    ? null
    : {
        ...moved,
        objects: moved.objects.map((placement) => ({
          ...placement,
          object: cycleObjectFill(placement.object, program.fillDelta),
        })),
      };
}

function analogySpatialDescription(operation: AnalogySpatialOperation): string {
  if (operation.kind === "reflect") {
    return operation.axis === "horizontal" ? "reflects left to right" : "reflects top to bottom";
  }
  return `rotates ${operation.quarterTurns} quarter-turn${operation.quarterTurns === 1 ? "" : "s"} clockwise`;
}

function compositionalAnalogy(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, ANALOGY_COMPOSITION_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const a = scene([
    { row: 0, column: 0, object: token(shapes[0], "outline") },
    { row: 1, column: 2, object: token(shapes[1], "half") },
  ]);
  const b = applyAnalogyComposition(a, program)!;
  const c = scene([
    { row: 0, column: 1, object: token(shapes[2], "half") },
    { row: 2, column: 0, object: token(shapes[3], "solid") },
  ]);
  const answer = applyAnalogyComposition(c, program)!;
  const distractors = distinctOutputs(ANALOGY_COMPOSITION_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyAnalogyComposition(c, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "compositional analogy");
  const puzzle = makePuzzle(
    "prototype-compositional-analogy",
    "analogy",
    "analogy",
    "Apply both changes from the worked pair.",
    3,
    [a, b, c],
    answer,
    selectedDistractors,
    rng,
    `The worked pair shows two clear changes. The whole board ${analogySpatialDescription(program.spatial)}, while every token advances ${program.fillDelta} step${program.fillDelta === 1 ? "" : "s"} through outline, half, and solid fill. Applying both changes to the third board gives the highlighted option. Each distractor is produced by a different bounded spatial or fill program that fails the worked pair.`,
  );
  const family = definition(
    "compositional-analogy-v2",
    ["worked-pair", "board-slots", "fill-states"],
    JSON.stringify(program),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = ANALOGY_COMPOSITION_GRAMMAR.filter((candidateProgram) => {
        const predicted = applyAnalogyComposition(input, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyAnalogyComposition(query, candidateProgram)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-pair", "board-slots", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = ANALOGY_COMPOSITION_GRAMMAR.find((candidateProgram) => {
            const queryOutput = applyAnalogyComposition(query, candidateProgram);
            const workedOutput = applyAnalogyComposition(input, candidateProgram);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(output));
          });
          return failedProgram ? "this spatial-and-fill program fails the worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

interface ContainmentAnalogyProgram {
  containerShape: "circle" | "square" | "diamond" | "hexagon";
  movement: "right" | "down" | "diagonal";
}

const CONTAINMENT_ANALOGY_GRAMMAR: readonly ContainmentAnalogyProgram[] =
  (["circle", "square", "diamond", "hexagon"] as const).flatMap((containerShape) =>
    (["right", "down", "diagonal"] as const).map((movement) => ({ containerShape, movement })));

function applyContainmentAnalogy(input: Scene, program: ContainmentAnalogyProgram): Scene | null {
  const placement = singleTokenPlacement(input);
  if (!placement) return null;
  const contained = applySceneUnary(input, {
    kind: "contain",
    at: { row: placement.row, column: placement.column },
    containerShape: program.containerShape,
  });
  if (!contained) return null;
  const movement = program.movement === "right"
    ? { rowDelta: 0 as const, columnDelta: 1 as const }
    : program.movement === "down"
      ? { rowDelta: 1 as const, columnDelta: 0 as const }
      : { rowDelta: 1 as const, columnDelta: 1 as const };
  return applySceneUnary(contained, { kind: "translate", ...movement, wrap: false });
}

function containmentAnalogy(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, CONTAINMENT_ANALOGY_GRAMMAR);
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const input = one(firstShape, 0, 0);
  const output = applyContainmentAnalogy(input, program)!;
  const query = one(secondShape, 0, 0, "solid");
  const answer = applyContainmentAnalogy(query, program)!;
  const distractors = distinctOutputs(CONTAINMENT_ANALOGY_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyContainmentAnalogy(query, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "containment analogy");
  const puzzle = makePuzzle(
    "prototype-containment-analogy",
    "analogy",
    "analogy",
    "Apply both demonstrated relationship changes.",
    4,
    [input, output, query],
    answer,
    selectedDistractors,
    rng,
    `The worked pair changes both relationship and position. First the loose token is placed inside a ${program.containerShape}; then the complete container moves ${program.movement === "right" ? "one slot right" : program.movement === "down" ? "one slot down" : "one slot down and right"}. Repeating both visible changes on the third board gives the highlighted option. Each distractor uses a different container or movement program that fails the worked pair.`,
  );
  const family = definition(
    "containment-analogy-v2",
    ["worked-containment-pair", "containment-and-movement", "board-slots"],
    JSON.stringify(program),
    (candidate) => {
      const [workedInput, workedOutput, queryInput] = candidate.stem.map(scenePanel);
      if (!workedInput || !workedOutput || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = CONTAINMENT_ANALOGY_GRAMMAR.filter((candidateProgram) => {
        const predicted = applyContainmentAnalogy(workedInput, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyContainmentAnalogy(queryInput, candidateProgram)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-containment-pair", "containment-and-movement", "board-slots"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = CONTAINMENT_ANALOGY_GRAMMAR.find((candidateProgram) => {
            const queryOutput = applyContainmentAnalogy(queryInput, candidateProgram);
            const worked = applyContainmentAnalogy(workedInput, candidateProgram);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (worked === null || sceneSignature(worked) !== sceneSignature(workedOutput));
          });
          return failedProgram ? "this containment or movement program fails the worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * Size is deliberately absent as a relation. A scene token may only be medium or
 * large, and this project treats that difference as too small to read at answer
 * size — `isInstantlyDistinct` in domains.ts refuses to call two tokens distinct
 * on size alone. An item asking which pair differs in size would therefore be an
 * eyesight test, which is the one thing difficulty here may never come from.
 * Size is still held constant inside every option, so it cannot become the
 * discriminator by accident either.
 */
type OutlierRelationProgram =
  | { kind: "position"; relation: "same-row" | "same-column" | "adjacent" | "diagonal" | "opposite" }
  | { kind: "attribute"; attribute: "shape" | "fill"; relation: PairingRelation };

const OUTLIER_RELATION_GRAMMAR: readonly OutlierRelationProgram[] = [
  { kind: "position", relation: "same-row" },
  { kind: "position", relation: "same-column" },
  { kind: "position", relation: "adjacent" },
  { kind: "position", relation: "diagonal" },
  { kind: "position", relation: "opposite" },
  { kind: "attribute", attribute: "shape", relation: "same" },
  { kind: "attribute", attribute: "shape", relation: "different" },
  { kind: "attribute", attribute: "fill", relation: "same" },
  { kind: "attribute", attribute: "fill", relation: "different" },
] as const;

type PositionPair = readonly [
  { readonly row: number; readonly column: number },
  { readonly row: number; readonly column: number },
];

/** Every unordered pair of distinct board slots — the position vocabulary here. */
const OUTLIER_POSITION_PAIRS: readonly PositionPair[] = (() => {
  const slots = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
  return slots.flatMap((first, index) =>
    slots.slice(index + 1).map((second) => [first, second] as PositionPair));
})();

/** The two slots every attribute item uses, so only the attributes vary between options. */
const OUTLIER_ATTRIBUTE_POSITIONS: PositionPair = [{ row: 1, column: 0 }, { row: 1, column: 2 }];

/** The attributes an option may vary. Size is excluded on purpose — see above. */
const OUTLIER_ATTRIBUTES = ["shape", "fill"] as const;

function outlierScene(pair: PositionPair, first: SceneToken, second: SceneToken): Scene {
  return scene([
    { ...pair[0], object: first },
    { ...pair[1], object: second },
  ]);
}

/**
 * Every option this family may show for one relation, split into the ones that
 * keep it and the ones that break it.
 *
 * The construction is what makes the item well posed. For a position relation
 * both tokens in an option are identical, so every attribute relation holds
 * equally across the whole option list and none of them can single anything out.
 * For an attribute relation every option uses the same two slots, holds size
 * fixed, and shares the attribute the relation does not name, so only the named
 * attribute can.
 */
function outlierOptionUniverse(
  program: OutlierRelationProgram,
  shapes: readonly SceneToken["shape"][],
): { satisfying: Scene[]; breaking: Scene[] } {
  const all: Scene[] = [];
  if (program.kind === "position") {
    for (const pair of OUTLIER_POSITION_PAIRS) {
      for (const shape of shapes) all.push(outlierScene(pair, token(shape), token(shape)));
    }
  } else {
    for (const shape of shapes) {
      for (const otherShape of shapes) {
        for (const fill of RELATIONAL_FILLS) {
          for (const otherFill of RELATIONAL_FILLS) {
            const differs = { shape: shape !== otherShape, fill: fill !== otherFill };
            if (OUTLIER_ATTRIBUTES.some((attribute) =>
              attribute !== program.attribute && differs[attribute])) continue;
            all.push(outlierScene(
              OUTLIER_ATTRIBUTE_POSITIONS,
              token(shape, fill),
              token(otherShape, otherFill),
            ));
          }
        }
      }
    }
  }
  return {
    satisfying: all.filter((option) => sceneSatisfiesOutlierRelation(option, program)),
    breaking: all.filter((option) => !sceneSatisfiesOutlierRelation(option, program)),
  };
}

/**
 * Take options from the pool until `count` of them are held, skipping any that
 * a viewer could not tell apart from one already taken at a glance.
 */
function takeDistinctScenes(pool: readonly Scene[], count: number, held: readonly Scene[]): Scene[] {
  const chosen = [...held];
  for (const candidate of pool) {
    if (chosen.length >= count + held.length) break;
    if (chosen.every((other) => areScenesCategoricallyDistinct(candidate, other))) chosen.push(candidate);
  }
  return chosen.slice(held.length);
}

function outlierPair(value: Scene): readonly [
  Scene["objects"][number] & { object: SceneToken },
  Scene["objects"][number] & { object: SceneToken },
] | null {
  if (value.objects.length !== 2 || value.tiles.length > 0 ||
      value.objects[0].object.kind !== "token" || value.objects[1].object.kind !== "token") return null;
  return [
    { ...value.objects[0], object: value.objects[0].object },
    { ...value.objects[1], object: value.objects[1].object },
  ];
}

function sceneSatisfiesOutlierRelation(value: Scene, program: OutlierRelationProgram): boolean {
  const pair = outlierPair(value);
  if (!pair) return false;
  const [first, second] = pair;
  if (program.kind === "attribute") {
    const matches = first.object[program.attribute] === second.object[program.attribute];
    return matches === (program.relation === "same");
  }
  const rowDelta = Math.abs(first.row - second.row);
  const columnDelta = Math.abs(first.column - second.column);
  if (program.relation === "same-row") return rowDelta === 0;
  if (program.relation === "same-column") return columnDelta === 0;
  if (program.relation === "adjacent") return rowDelta + columnDelta === 1;
  if (program.relation === "diagonal") return rowDelta > 0 && rowDelta === columnDelta;
  return first.row + second.row === 2 && first.column + second.column === 2;
}

/** Draws tried per relation before this family moves on to the next relation. */
const OUTLIER_OPTION_ATTEMPTS = 40;

function relationalOutlier(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);

  /**
   * Draw one option list for a relation, or reject the draw.
   *
   * Rejected when any other relation in the grammar also singles out exactly one
   * option and it is not the same one: that is a second defensible answer, and
   * the item has to be thrown away rather than shipped ambiguous.
   */
  const draw = (program: OutlierRelationProgram): Scene[] | null => {
    const universe = outlierOptionUniverse(program, shapes);
    const breaker = shuffled(rng, universe.breaking)[0];
    if (!breaker) return null;
    const keepers = takeDistinctScenes(
      shuffled(rng, universe.satisfying),
      DISTRACTORS_PER_ITEM,
      [breaker],
    );
    if (keepers.length !== DISTRACTORS_PER_ITEM) return null;
    const options = [...keepers, breaker];
    const singledOut = OUTLIER_RELATION_GRAMMAR.flatMap((candidateProgram) => {
      const failures = options.flatMap((option, index) =>
        sceneSatisfiesOutlierRelation(option, candidateProgram) ? [] : [index]);
      return failures.length === 1 ? failures : [];
    });
    return singledOut.length > 0 && singledOut.every((index) => index === options.length - 1)
      ? options
      : null;
  };

  let program: OutlierRelationProgram | null = null;
  let options: Scene[] | null = null;
  for (const candidateProgram of shuffled(rng, OUTLIER_RELATION_GRAMMAR)) {
    for (let attempt = 0; attempt < OUTLIER_OPTION_ATTEMPTS && !options; attempt++) {
      options = draw(candidateProgram);
    }
    if (options) {
      program = candidateProgram;
      break;
    }
  }
  if (!options || !program) throw new Error("relational outlier found no well-posed option list");

  const breakerIndex = options.length - 1;
  const order = shuffled(rng, options.map((_, index) => index));
  const shuffledOptions = order.map((index) => options![index]);
  const answerIndex = order.indexOf(breakerIndex);
  const relationText = program.kind === "position"
    ? program.relation === "same-row" ? "sit in the same row"
      : program.relation === "same-column" ? "sit in the same column"
        : program.relation === "adjacent" ? "share a horizontal or vertical edge"
          : program.relation === "diagonal" ? "sit on one diagonal line"
            : "sit opposite each other across the board centre"
    : `have ${program.relation} ${program.attribute}`;
  const puzzle: Puzzle<Scene> = {
    id: "prototype-relational-outlier",
    type: "oddOneOut",
    layout: "row",
    instruction: "Which scene breaks the shared relationship?",
    difficulty: 2,
    stem: [],
    options: shuffledOptions,
    answerIndex,
    explanation: `Compare the relationship inside each two-token scene. In every option but one, the tokens ${relationText}; the clearly separated board positions, shapes, and fills provide the evidence. The highlighted option is the only one that breaks that shared relationship. Every other bounded relation in this family either agrees on the same outlier or does not isolate one option.`,
  };
  const family = definition(
    "relational-outlier-v2",
    ["two-token-scenes", "relative-token-relation"],
    JSON.stringify(program),
    (candidate) => {
      const matchingPrograms = OUTLIER_RELATION_GRAMMAR.filter((candidateProgram) => {
        const results = candidate.options.map((option) => sceneSatisfiesOutlierRelation(option, candidateProgram));
        return results.filter((result) => !result).length === 1;
      });
      const predicted = new Set(matchingPrograms.map((candidateProgram) =>
        candidate.options.findIndex((option) => !sceneSatisfiesOutlierRelation(option, candidateProgram)),
      ));
      return {
        derivedAnswer: predicted.size === 1 ? candidate.options[[...predicted][0]] : null,
        solutionCount: predicted.size,
        usedCueIds: ["two-token-scenes", "relative-token-relation"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const sharedProgram = matchingPrograms.find((candidateProgram) =>
            sceneSatisfiesOutlierRelation(option, candidateProgram));
          return sharedProgram ? `satisfies the shared relation ${JSON.stringify(sharedProgram)}` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const SCENE_BINARY_GRAMMAR = ["union", "intersection", "subtract", "xor"] as const;

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

function binaryOperationDescription(operation: SceneBinaryOperation): string {
  return operation === "union"
    ? "keeps every occupied position from either input"
    : operation === "intersection"
      ? "keeps only positions shared by both inputs"
      : operation === "subtract"
        ? "keeps positions from the first input that are absent from the second"
        : "keeps positions found in exactly one input";
}

function relationalMatrix(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const atoms = [
    { row: 0, column: 0, object: token(shapes[0]) },
    { row: 0, column: 2, object: token(shapes[1]) },
    { row: 2, column: 0, object: token(shapes[2]) },
    { row: 2, column: 2, object: token(shapes[3]) },
  ] as const;
  const fromMask = (mask: number) => scene(atoms.filter((_, index) => (mask & (1 << index)) !== 0));

  /**
   * Build the whole board from four input masks, or reject the draw.
   *
   * A draw is kept only when the completed grid is well posed: every derived
   * board exists, the two visible rows and the two visible columns each pin
   * down a single operation, and the near misses are numerous enough to fill
   * the option list. Rejecting here rather than at acceptance keeps a thin draw
   * from costing the assembler a whole retry.
   */
  const build = (program: RelationalMatrixProgram, masks: readonly number[]) => {
    const [topLeft, topMiddle, middleLeft, middleMiddle] = masks.map(fromMask);
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

    // Three kinds of near miss, each witnessed by a mistake a solver can
    // actually make: applying an operation that fails a worked row or column;
    // applying the right operation to the two boards in the wrong order (order
    // matters for subtract — for the commutative operations the swapped result
    // repeats the forward one and is deduplicated away); and copying one of the
    // two boards being combined instead of combining them.
    const distractors = distinctOutputs([
      ...SCENE_BINARY_GRAMMAR.flatMap((operation) => [
        applySceneBinary(bottomLeft, bottomMiddle, operation),
        applySceneBinary(topRight, middleRight, operation),
        applySceneBinary(bottomMiddle, bottomLeft, operation),
        applySceneBinary(middleRight, topRight, operation),
      ]),
      bottomLeft, bottomMiddle, topRight, middleRight,
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
    if (distractors.length < DISTRACTORS_PER_ITEM) return null;

    return { topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, answer, distractors };
  };

  // Try the rule pairs in a random order and keep the first one whose inputs
  // work out. A pair that no draw can make well posed is simply skipped, so the
  // family never fails on an unusable combination it happened to sample first.
  let program: RelationalMatrixProgram | null = null;
  let board: ReturnType<typeof build> = null;
  for (const candidateProgram of shuffled(rng, RELATIONAL_MATRIX_GRAMMAR)) {
    for (let attempt = 0; attempt < RELATIONAL_MATRIX_INPUT_ATTEMPTS && !board; attempt++) {
      board = build(candidateProgram, [0, 0, 0, 0].map(() => pick(rng, RELATIONAL_MATRIX_MASKS)));
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
  const selectedDistractors = selectDistractors(board.distractors, rng, "relational matrix");
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
    `The two directions use independently demonstrated set rules on matching board positions. Across each row, the third board ${binaryOperationDescription(program.rowOperation)}. Down each column, the bottom board ${binaryOperationDescription(program.columnOperation)}. Applying both rules to the missing corner produces the same highlighted board; every distractor comes from a set rule that fails a worked row or column, from the right rule applied to the two boards in the wrong order, or from copying one of those two boards instead of combining them.`,
  );
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
          const copied = [colA, colB, rowA, rowB].some((board) =>
            sceneSignature(board) === sceneSignature(option));
          return copied ? "copies one of the two boards instead of combining them" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

interface SetAlgebraProgram {
  operation: SceneBinaryOperation;
  spatial: AnalogySpatialOperation;
}

const SET_ALGEBRA_SPATIAL_GRAMMAR: readonly AnalogySpatialOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
] as const;

const SET_ALGEBRA_GRAMMAR: readonly SetAlgebraProgram[] = SCENE_BINARY_GRAMMAR.flatMap((operation) =>
  SET_ALGEBRA_SPATIAL_GRAMMAR.map((spatial) => ({ operation, spatial })));

function applySetAlgebraProgram(left: Scene, right: Scene, program: SetAlgebraProgram): Scene | null {
  const combined = applySceneBinary(left, right, program.operation);
  return combined ? applySceneUnary(combined, program.spatial) : null;
}

function setOperationExplanation(program: SetAlgebraProgram): string {
  return `The two completed rows demonstrate the same two-part rule. First, aligned positions are combined so the output ${binaryOperationDescription(program.operation)}; then that result ${analogySpatialDescription(program.spatial)}. Board positions and token identities make both steps visible. Applying the complete rule to the last pair gives the highlighted option. Each distractor comes from another set-and-spatial program that fails at least one worked row.`;
}

function setAlgebra(rng: Rng, forcedOperation?: SceneBinaryOperation): SceneFamilyCandidate {
  const program = pick(rng, SET_ALGEBRA_GRAMMAR.filter((candidate) =>
    forcedOperation === undefined || candidate.operation === forcedOperation));
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const pair = (offset: number): [Scene, Scene] => [
    scene([
      { row: 0, column: 0, object: token(shapes[offset % shapes.length]) },
      { row: 1, column: 1, object: token(shapes[(offset + 1) % shapes.length]) },
    ]),
    scene([
      { row: 1, column: 1, object: token(shapes[(offset + 1) % shapes.length]) },
      { row: 2, column: 2, object: token(shapes[(offset + 2) % shapes.length]) },
    ]),
  ];
  const [leftA, rightA] = pair(0);
  const outputA = applySetAlgebraProgram(leftA, rightA, program)!;
  const [leftB, rightB] = pair(2);
  const outputB = applySetAlgebraProgram(leftB, rightB, program)!;
  const [queryLeft, queryRight] = pair(1);
  const answer = applySetAlgebraProgram(queryLeft, queryRight, program)!;
  const distractors = distinctOutputs(SET_ALGEBRA_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applySetAlgebraProgram(queryLeft, queryRight, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "set algebra");
  const puzzle = makePuzzle(
    "prototype-set-algebra",
    "matrix",
    "grid3x3",
    "Infer how the first two boards combine to make the third.",
    4,
    [leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    setOperationExplanation(program),
  );
  const family = definition(
    "visual-set-algebra-v2",
    ["shared-coordinate-frame", "worked-combinations", "spatial-output-step"],
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
      const survivors = SET_ALGEBRA_GRAMMAR.filter((candidateProgram) => examples.every((example) => {
        const output = applySetAlgebraProgram(example.left, example.right, candidateProgram);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predicted = distinctOutputs(survivors.map((candidateProgram) =>
        applySetAlgebraProgram(left, right, candidateProgram)));
      return {
        derivedAnswer: predicted.length === 1 ? predicted[0] : null,
        solutionCount: predicted.length,
        usedCueIds: ["shared-coordinate-frame", "worked-combinations", "spatial-output-step"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const wrongProgram = SET_ALGEBRA_GRAMMAR.find((candidateProgram) => {
            const output = applySetAlgebraProgram(left, right, candidateProgram);
            return output !== null && sceneSignature(output) === sceneSignature(option) &&
              examples.some((example) => {
                const worked = applySetAlgebraProgram(example.left, example.right, candidateProgram);
                return worked === null || sceneSignature(worked) !== sceneSignature(example.output);
              });
          });
          return wrongProgram ? "this set-and-spatial program fails at least one worked combination" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

type MosaicProjection = "shape" | "fill";
type MosaicPattern = "rows" | "columns" | "diagonals" | "all-same";

interface MosaicProgram {
  projection: MosaicProjection;
  pattern: MosaicPattern;
}

const MOSAIC_GRAMMAR: readonly MosaicProgram[] = (["shape", "fill"] as const).flatMap((projection) =>
  (["rows", "columns", "diagonals", "all-same"] as const).map((pattern) => ({ projection, pattern })));

function mosaicGroups(pattern: MosaicPattern): readonly [number, number, number, number] {
  if (pattern === "rows") return [0, 0, 1, 1];
  if (pattern === "columns") return [0, 1, 0, 1];
  if (pattern === "diagonals") return [0, 1, 1, 0];
  return [0, 0, 0, 0];
}

function mosaicValues(value: Scene, projection: MosaicProjection): string[] | null {
  const byPosition = new Map(value.objects.map((placement) => [
    `${placement.row}:${placement.column}`,
    placement.object.kind === "token" ? placement.object[projection] : null,
  ]));
  const values = ["0:0", "0:1", "1:0", "1:1"].map((position) => byPosition.get(position));
  return values.some((entry) => typeof entry !== "string") ? null : values as string[];
}

function valuesMatchGroups(values: readonly string[], groups: readonly number[]): boolean {
  return values.every((value, left) => values.every((other, right) =>
    (value === other) === (groups[left] === groups[right])));
}

function mosaicVisibleFits(template: Scene, program: MosaicProgram): boolean {
  const byPosition = new Map(template.objects.map((placement) => [
    `${placement.row}:${placement.column}`,
    placement.object.kind === "token" ? placement.object[program.projection] : null,
  ]));
  const visibleValues = ["0:0", "0:1", "1:0"].map((position) => byPosition.get(position));
  if (visibleValues.some((value) => typeof value !== "string")) return false;
  const visibleGroups = mosaicGroups(program.pattern).slice(0, 3);
  return valuesMatchGroups(visibleValues as string[], visibleGroups);
}

function mosaicCompletedFits(value: Scene, program: MosaicProgram): boolean {
  const values = mosaicValues(value, program.projection);
  return values !== null && valuesMatchGroups(values, mosaicGroups(program.pattern));
}

function constraintMosaic(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, MOSAIC_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const fills = shuffled(rng, RELATIONAL_FILLS);
  const groups = mosaicGroups(program.pattern);
  const shapeAt = (index: number): SceneToken["shape"] => program.projection === "shape"
    ? shapes[groups[index]]
    : shapes[index];
  const fillAt = (index: number): SceneToken["fill"] => program.projection === "fill"
    ? fills[groups[index]]
    : fills[index % 3];
  const placements = [
    { row: 0, column: 0, object: token(shapeAt(0), fillAt(0)) },
    { row: 0, column: 1, object: token(shapeAt(1), fillAt(1)) },
    { row: 1, column: 0, object: token(shapeAt(2), fillAt(2)) },
  ];
  const board = scene(placements, 2, 2);
  const answerToken = token(shapeAt(3), fillAt(3));
  const inserted = (object: SceneToken) => scene([
    ...placements,
    { row: 1, column: 1, object },
  ], 2, 2);
  const answerBoard = inserted(answerToken);
  // A wrong tile is any token that visibly breaks the grouping — under every
  // grouping the three shown tiles still allow, not just the sampled one, since
  // the solver can only rule out what the visible board rules out.
  const survivingPrograms = MOSAIC_GRAMMAR.filter((candidateProgram) =>
    mosaicVisibleFits(board, candidateProgram));
  const wrongBoards = shapes.flatMap((shape) => fills.map((fill) => inserted(token(shape, fill))))
    .filter((option) => survivingPrograms.every((candidateProgram) =>
      !mosaicCompletedFits(option, candidateProgram)));
  const nearMisses = takeDistinctScenes(shuffled(rng, wrongBoards), DISTRACTORS_PER_ITEM, [answerBoard]);
  if (!mosaicCompletedFits(answerBoard, program) || nearMisses.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(`constraint mosaic needs one completion and ${DISTRACTORS_PER_ITEM} near misses`);
  }
  const options = [answerBoard, ...nearMisses];
  const order = shuffled(rng, options.map((_, index) => index));
  const shuffledOptions = order.map((index) => options[index]);
  const answerIndex = order.indexOf(0);
  const patternText = program.pattern === "rows" ? "each row repeats one value"
    : program.pattern === "columns" ? "each column repeats one value"
      : program.pattern === "diagonals" ? "matching values sit on opposite diagonals"
        : "all four cells repeat one value";
  const puzzle: Puzzle<Scene> = {
    id: "prototype-constraint-mosaic",
    type: "matrix",
    layout: "singleScene",
    instruction: "Which completed board continues the visible grouping?",
    difficulty: 4,
    stem: [board],
    options: shuffledOptions,
    answerIndex,
    explanation: `Treat the four cells as one 2×2 board and compare their ${program.projection}. The three shown cells establish that ${patternText}, so the lower-right value is fixed by the same grouping. The highlighted completion preserves every shown cell and supplies that value. Each distractor changes only the missing tile but breaks at least one visible equality or difference in the grouping.`,
  };
  const family = definition(
    "constraint-mosaic-v2",
    ["upper-left-mosaic", "categorical-grouping", "missing-lower-right-tile"],
    JSON.stringify(program),
    (candidate) => {
      const template = scenePanel(candidate.stem[0]);
      if (!template) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const survivors = MOSAIC_GRAMMAR.filter((candidateProgram) => mosaicVisibleFits(template, candidateProgram));
      const evaluated = candidate.options.map((option) => {
        const fixed = new Map(template.objects.map((placement) => [
          `${placement.row}:${placement.column}`,
          JSON.stringify(placement.object),
        ]));
        const preservesTemplate = option.rows === template.rows && option.columns === template.columns &&
          option.objects.length === template.objects.length + 1 &&
          [...fixed].every(([position, object]) => option.objects.some((placement) =>
            `${placement.row}:${placement.column}` === position && JSON.stringify(placement.object) === object));
        const insertedAtTarget = option.objects.some((placement) => placement.row === 1 && placement.column === 1) &&
          !fixed.has("1:1");
        const matchingPrograms = survivors.filter((candidateProgram) => mosaicCompletedFits(option, candidateProgram));
        const failures = !preservesTemplate || !insertedAtTarget
          ? ["does not fill only the missing lower-right tile"]
          : matchingPrograms.length === 0
            ? ["breaks the grouping shown by the three fixed tiles"]
            : [];
        return { option, failures, matchingPrograms };
      });
      const selections = survivors.map((candidateProgram) => evaluated.flatMap((entry, optionIndex) =>
        entry.failures.length === 0 && entry.matchingPrograms.includes(candidateProgram) ? [optionIndex] : []));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["upper-left-mosaic", "categorical-grouping", "missing-lower-right-tile"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || !evaluated[optionIndex]?.failures[0]
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].failures[0] }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function topologyPath(rng: Rng): SceneFamilyCandidate {
  const fixedTiles: Scene["tiles"] = [
    { row: 0, column: 0, edges: ["east", "south"] },
    { row: 0, column: 1, edges: ["south", "west"] },
    { row: 1, column: 0, edges: ["north", "east"] },
  ];
  const baseIncomplete: Scene = { kind: "scene", rows: 2, columns: 2, objects: [], tiles: fixedTiles };
  // Every way two edges of the missing tile can be joined. Exactly one of them
  // meets both exposed ends; the rest leave an open end or a mismatched seam.
  const optionEdges: Scene["tiles"][number]["edges"][] = [
    ["north", "east"],
    ["north", "south"],
    ["north", "west"],
    ["east", "south"],
    ["east", "west"],
    ["south", "west"],
  ];
  const baseOptions = optionEdges.map((edges): Scene => ({
    kind: "scene",
    rows: 2,
    columns: 2,
    objects: [],
    tiles: [...fixedTiles, { row: 1, column: 1, edges }],
  }));
  const quarterTurns = pick(rng, [0, 1, 2, 3] as const);
  const rotateScene = (candidate: Scene) => quarterTurns === 0
    ? candidate
    : applySceneUnary(candidate, { kind: "rotate", quarterTurns })!;
  const incomplete = rotateScene(baseIncomplete);
  const options = baseOptions.map(rotateScene);
  const goal: TopologyGoal = "singleLoop";
  const valid = options.map((candidate) => topologyFailures(candidate, goal).length === 0);
  const validIndexes = valid.flatMap((isValid, index) => isValid ? [index] : []);
  const canonicalAnswer = validIndexes[0] ?? 0;
  const order = shuffled(rng, options.map((_, index) => index));
  const puzzle: Puzzle<Scene> = {
    id: "prototype-topology-path",
    type: "matrix",
    layout: "singleScene",
    instruction: "Which completed board makes one closed loop?",
    difficulty: 4,
    stem: [incomplete],
    options: order.map((index) => options[index]),
    answerIndex: order.indexOf(canonicalAnswer),
    explanation: "Follow each line through the completed 2×2 board. At every shared edge, a line must meet a line on the neighbouring tile; no line may stop at a seam or leave the outside boundary. The highlighted completion connects the two exposed ends and makes one closed loop. Each other tile leaves an open end, creates a mismatch, or fails to form a single loop.",
  };
  const family = definition(
    "topology-path-v1",
    ["edge-connections", "loop-goal"],
    goal,
    (candidate) => {
      const template = scenePanel(candidate.stem[0]);
      if (!template) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const fixed = new Map(template.tiles.map((tile) => [
        `${tile.row}:${tile.column}`,
        tile.edges.join(","),
      ]));
      const missingPositions = Array.from({ length: template.rows * template.columns }, (_, index) => ({
        row: Math.floor(index / template.columns),
        column: index % template.columns,
      })).filter((position) => !fixed.has(`${position.row}:${position.column}`));
      const evaluated = candidate.options.map((option) => {
        const preservesTemplate = option.rows === template.rows && option.columns === template.columns &&
          option.tiles.length === template.tiles.length + 1 &&
          [...fixed].every(([position, edges]) => option.tiles.some((tile) =>
            `${tile.row}:${tile.column}` === position && tile.edges.join(",") === edges));
        const target = missingPositions[0];
        const fillsTarget = missingPositions.length === 1 && target &&
          option.tiles.some((tile) => tile.row === target.row && tile.column === target.column);
        const failures = topologyFailures(option, goal).map((failure) => failure.message);
        if (!preservesTemplate || !fillsTarget) failures.unshift("changes a fixed tile instead of filling the one empty slot");
        return { option, failures };
      });
      const validOptions = evaluated.filter((entry) => entry.failures.length === 0);
      return {
        derivedAnswer: validOptions.length === 1 ? validOptions[0].option : null,
        solutionCount: validOptions.length,
        usedCueIds: ["edge-connections", "loop-goal"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || !evaluated[optionIndex]?.failures[0]
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].failures[0] }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const SPATIAL_TRANSFORM_GRAMMAR: readonly SceneUnaryOperation[] = [
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "translate", rowDelta: -1, columnDelta: 0, wrap: true },
  { kind: "translate", rowDelta: 1, columnDelta: 0, wrap: true },
  { kind: "translate", rowDelta: 0, columnDelta: -1, wrap: true },
  { kind: "translate", rowDelta: 0, columnDelta: 1, wrap: true },
] as const;

function spatialOperationDescription(operation: SceneUnaryOperation): string {
  if (operation.kind === "reflect") return `reflects across the ${operation.axis} axis`;
  if (operation.kind === "rotate") {
    return `rotates ${operation.quarterTurns} quarter-turn${operation.quarterTurns === 1 ? "" : "s"} clockwise`;
  }
  if (operation.kind === "translate") {
    const direction = operation.rowDelta === -1 ? "up" : operation.rowDelta === 1 ? "down"
      : operation.columnDelta === -1 ? "left" : "right";
    return `moves one slot ${direction}, wrapping across the board edge`;
  }
  return operation.kind;
}

function spatialTransform(rng: Rng): SceneFamilyCandidate {
  const [a, b] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const operation = pick(rng, SPATIAL_TRANSFORM_GRAMMAR);
  const first = scene([{ row: 0, column: 0, object: token(a) }, { row: 2, column: 1, object: token(b, "solid") }]);
  const transformed = applySceneUnary(first, operation)!;
  const query = scene([{ row: 0, column: 1, object: token(b) }, { row: 1, column: 0, object: token(a, "solid") }]);
  const answer = applySceneUnary(query, operation)!;
  const distractors = [...new Map(SPATIAL_TRANSFORM_GRAMMAR
    .map((candidateOperation) => applySceneUnary(query, candidateOperation))
    .filter((candidate): candidate is Scene => candidate !== null)
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer))
    .map((candidate) => [sceneSignature(candidate), candidate])).values()];
  const selectedDistractors = selectDistractors(distractors, rng, "spatial transform");
  const puzzle = makePuzzle(
    "prototype-spatial-transform",
    "analogy",
    "analogy",
    "Apply the same spatial transformation.",
    3,
    [first, transformed, query],
    answer,
    selectedDistractors,
    rng,
    `The first pair shows that the complete arrangement ${spatialOperationDescription(operation)}. Both tokens keep their shapes and fills while their board positions change together. Applying that exact spatial rule to the third board gives the highlighted arrangement. Every distractor is the output of another bounded rotation, reflection, or wrapped shift that fails the worked pair.`,
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
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-spatial-pair", "fixed-board-frame"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (sceneSignature(option) === sceneSignature(query)) return "omits the demonstrated spatial transformation";
          const failedRule = SPATIAL_TRANSFORM_GRAMMAR.find((candidateOperation) => {
            const queryOutput = applySceneUnary(query, candidateOperation);
            const workedOutput = applySceneUnary(input, candidateOperation);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(output));
          });
          return failedRule ? `${failedRule.kind} does not reproduce the worked spatial pair` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function gateVisual(...gateIds: Array<"a" | "b" | "c">): Scene {
  const gateShapes = { a: "triangle", b: "square", c: "diamond" } as const;
  return scene(gateIds.map((gateId, column) => ({
    row: 1,
    column,
    object: token(gateShapes[gateId], gateId === "a" ? "outline" : gateId === "b" ? "solid" : "half"),
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

function duplicateAfterSpatial(operation: MachineSpatialOperation): MachineDuplicateOperation {
  const moved = applySceneUnary(one("circle", 0, 0), operation);
  const source = moved?.objects[0];
  if (!source) throw new Error("machine spatial operation must preserve its source token");
  return {
    kind: "duplicate",
    from: { row: source.row, column: source.column },
    to: { row: 1, column: 1 },
  };
}

const MACHINE_PROGRAM_GRAMMAR: readonly MachineProgram[] = MACHINE_SPATIAL_GRAMMAR.flatMap((gateA) =>
  MACHINE_FILL_GRAMMAR.map((gateB) => ({ gateA, gateB, gateC: duplicateAfterSpatial(gateA) })));

function unaryExampleMatches(input: Scene, output: Scene, operation: SceneUnaryOperation): boolean {
  const predicted = applySceneUnary(input, operation);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

/** The five ways to run the three gates that are not the demonstrated left-to-right order. */
const MACHINE_WRONG_GATE_ORDERS: readonly (readonly number[])[] = [
  [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

function runMachineInOrder(input: Scene, program: MachineProgram, order: readonly number[]): Scene | null {
  const gates = [program.gateA, program.gateB, program.gateC];
  let value: Scene | null = input;
  for (const index of order) value = value && applySceneUnary(value, gates[index]);
  return value;
}

function runMachine(input: Scene, program: MachineProgram): readonly [Scene, Scene, Scene] | null {
  const afterA = applySceneUnary(input, program.gateA);
  const afterB = afterA && applySceneUnary(afterA, program.gateB);
  const afterC = afterB && applySceneUnary(afterB, program.gateC);
  return afterA && afterB && afterC ? [afterA, afterB, afterC] : null;
}

function gateSymbolKey(value: Scene): string | null {
  const placement = value.objects[0];
  return value.objects.length === 1 && value.tiles.length === 0 && placement?.row === 1 && placement.column === 0
    ? JSON.stringify(placement.object)
    : null;
}

function transformationMachine(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, MACHINE_PROGRAM_GRAMMAR);
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
  const inputC = one(shape, program.gateC.from.row, program.gateC.from.column, program.gateB.fill);
  const outputC = applySceneUnary(inputC, program.gateC)!;
  const query = scene([
    { row: 0, column: 0, object: token(shape) },
    { row: 1, column: 2, object: token(secondShape) },
  ]);
  const stages = runMachine(query, program);
  if (!stages) throw new Error("machine program must apply to its query");
  const [afterA, afterB, answer] = stages;
  const puzzle = makePuzzle(
    "prototype-transformation-machine",
    "matrix",
    "machineTable",
    "Follow the worked gate paths, then apply the query gates from left to right.",
    5,
    [
      inputA, gateVisual("a"), outputA,
      inputB, gateVisual("b"), outputB,
      inputC, gateVisual("c"), outputC,
      query, gateVisual("a", "b", "c"), { blank: true },
    ],
    answer,
    selectDistractors(
      // Three kinds of mistake: stopping early, running the gates out of order,
      // and reading a gate wrongly so a different machine runs end to end.
      distinctOutputs([
        query,
        afterA,
        afterB,
        ...MACHINE_WRONG_GATE_ORDERS.map((order) => runMachineInOrder(query, program, order)),
        ...MACHINE_PROGRAM_GRAMMAR.flatMap((candidateProgram) =>
          JSON.stringify(candidateProgram) === JSON.stringify(program)
            ? []
            : [runMachine(query, candidateProgram)?.[2] ?? null]),
      ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)),
      rng,
      "transformation machine",
      [afterB],
    ),
    rng,
    `The three worked paths define the gates separately. The outline triangle ${spatialOperationDescription(program.gateA)}. The solid square changes every token to ${program.gateB.fill} without moving it. The half-filled diamond copies the token at the demonstrated source into the empty centre. Applying those gates from left to right gives the highlighted board. The distractors stop early, run the same gates in another order, or run a machine whose gates disagree with a worked path.`,
  );
  const family = definition(
    "transformation-machine-v3",
    ["gate-a", "gate-b", "gate-c", "left-to-right-order"],
    JSON.stringify(program),
    (candidate) => {
      const [
        workedInputA, shownGateA, workedOutputA,
        workedInputB, shownGateB, workedOutputB,
        workedInputC, shownGateC, workedOutputC,
        queryInput, queryGates,
      ] =
        candidate.stem.map(scenePanel);
      if (!workedInputA || !shownGateA || !workedOutputA || !workedInputB || !shownGateB ||
          !workedOutputB || !workedInputC || !shownGateC || !workedOutputC || !queryInput || !queryGates) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const gateAKey = gateSymbolKey(shownGateA);
      const gateBKey = gateSymbolKey(shownGateB);
      const gateCKey = gateSymbolKey(shownGateC);
      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const shownOrder = orderedQueryGates.map((placement) => JSON.stringify(placement.object));
      const queryGateLayoutValid = orderedQueryGates.length === 3 && queryGates.tiles.length === 0 &&
        orderedQueryGates.every((placement, index) => placement.row === 1 && placement.column === index);
      if (!gateAKey || !gateBKey || !gateCKey || !queryGateLayoutValid ||
          shownOrder[0] !== gateAKey || shownOrder[1] !== gateBKey || shownOrder[2] !== gateCKey) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = MACHINE_PROGRAM_GRAMMAR.filter((candidateProgram) =>
        unaryExampleMatches(workedInputA, workedOutputA, candidateProgram.gateA) &&
        unaryExampleMatches(workedInputB, workedOutputB, candidateProgram.gateB) &&
        unaryExampleMatches(workedInputC, workedOutputC, candidateProgram.gateC));
      const executions = survivors.flatMap((candidateProgram) => {
        const outputs = runMachine(queryInput, candidateProgram);
        return outputs ? [{ program: candidateProgram, outputs }] : [];
      });
      const predictions = distinctOutputs(executions.map((execution) => execution.outputs[2]));
      const wrongExecutions = [
        { output: queryInput, reason: "omits all three demonstrated gates" },
        ...executions.map((execution) => ({ output: execution.outputs[0], reason: "stops after the first gate" })),
        ...executions.map((execution) => ({ output: execution.outputs[1], reason: "stops before the duplication gate" })),
        ...executions.flatMap((execution) => MACHINE_WRONG_GATE_ORDERS.map((order) => ({
          output: runMachineInOrder(queryInput, execution.program, order),
          reason: "runs the demonstrated gates in another order",
        }))),
        // Listed last: a machine whose gates contradict a worked path loses on
        // the worked paths, so the more specific reasons above win when both fit.
        ...MACHINE_PROGRAM_GRAMMAR.flatMap((candidateProgram) =>
          survivors.some((survivor) => JSON.stringify(survivor) === JSON.stringify(candidateProgram))
            ? []
            : [{
                output: runMachine(queryInput, candidateProgram)?.[2] ?? null,
                reason: "runs a gate that fails a worked path",
              }]),
      ];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["gate-a", "gate-b", "gate-c", "left-to-right-order"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output &&
            sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const RULE_SWITCH_OPERATION_GRAMMAR: readonly SceneUnaryOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "setFill", fill: "half" },
  { kind: "setFill", fill: "solid" },
  { kind: "translate", rowDelta: 1, columnDelta: 1, wrap: true },
] as const;

interface RuleSwitchProgram {
  gateA: SceneUnaryOperation;
  gateB: SceneUnaryOperation;
  queryGate: "a" | "b";
}

const RULE_SWITCH_PROGRAM_GRAMMAR: readonly RuleSwitchProgram[] = RULE_SWITCH_OPERATION_GRAMMAR.map(
  (selected, index) => {
    const other = RULE_SWITCH_OPERATION_GRAMMAR[(index + 3) % RULE_SWITCH_OPERATION_GRAMMAR.length];
    return index % 2 === 0
      ? { gateA: selected, gateB: other, queryGate: "a" }
      : { gateA: other, gateB: selected, queryGate: "b" };
  },
);

function selectedRuleSwitchOperation(program: RuleSwitchProgram): SceneUnaryOperation {
  return program.queryGate === "a" ? program.gateA : program.gateB;
}

function unselectedRuleSwitchOperation(program: RuleSwitchProgram): SceneUnaryOperation {
  return program.queryGate === "a" ? program.gateB : program.gateA;
}

function ruleSwitchOperationDescription(operation: SceneUnaryOperation): string {
  return operation.kind === "setFill"
    ? `changes every token to ${operation.fill}`
    : spatialOperationDescription(operation);
}

function ruleSwitching(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, RULE_SWITCH_PROGRAM_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const inputA = scene([
    { row: 0, column: 0, object: token(shapes[0]) },
    { row: 1, column: 2, object: token(shapes[1], "solid") },
  ]);
  const outputA = applySceneUnary(inputA, program.gateA)!;
  const inputB = scene([
    { row: 0, column: 1, object: token(shapes[2]) },
    { row: 2, column: 0, object: token(shapes[3], "solid") },
  ]);
  const outputB = applySceneUnary(inputB, program.gateB)!;
  const query = scene([
    { row: 0, column: 1, object: token(shapes[4]) },
    { row: 2, column: 0, object: token(shapes[0]) },
  ]);
  const selectedOperation = selectedRuleSwitchOperation(program);
  const unselectedOperation = unselectedRuleSwitchOperation(program);
  const answer = applySceneUnary(query, selectedOperation)!;
  const otherGateOutput = applySceneUnary(query, unselectedOperation)!;
  const bothOrders = [
    applySceneUnary(otherGateOutput, selectedOperation),
    applySceneUnary(answer, unselectedOperation),
  ];
  const nearMissPool = distinctOutputs([
    query,
    otherGateOutput,
    ...bothOrders,
    ...RULE_SWITCH_OPERATION_GRAMMAR.map((operation) => applySceneUnary(query, operation)),
  ]).filter((output) => sceneSignature(output) !== sceneSignature(answer));
  const nearMisses = selectDistractors(nearMissPool, rng, "rule switching");
  const puzzle = makePuzzle(
    "prototype-rule-switching",
    "matrix",
    "machineTable",
    "Each gate has a demonstrated rule. Apply only the gate shown in the query path.",
    5,
    [
      inputA, gateVisual("a"), outputA,
      inputB, gateVisual("b"), outputB,
      query, gateVisual(program.queryGate), { blank: true },
    ],
    answer,
    nearMisses,
    rng,
    `The worked rows define two separate gates. Gate A ${ruleSwitchOperationDescription(program.gateA)}, while gate B ${ruleSwitchOperationDescription(program.gateB)}. The query displays only gate ${program.queryGate.toUpperCase()}, so applying that demonstrated operation gives the highlighted board. The distractors omit the selected gate, use the other gate, combine both gates, or follow another bounded operation that fails the selected gate's worked row.`,
  );
  const family = definition(
    "rule-switching-v2",
    ["two-worked-gates", "query-gate-cue", "gate-identity"],
    JSON.stringify(program),
    (candidate) => {
      const [workedInputA, shownGateA, workedOutputA, workedInputB, shownGateB, workedOutputB, queryInput, queryGate] =
        candidate.stem.map(scenePanel);
      if (!workedInputA || !shownGateA || !workedOutputA || !workedInputB || !shownGateB ||
          !workedOutputB || !queryInput || !queryGate) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const gateAKey = gateSymbolKey(shownGateA);
      const gateBKey = gateSymbolKey(shownGateB);
      const queryGateKey = gateSymbolKey(queryGate);
      const shownQueryGate = queryGateKey === gateAKey && queryGateKey !== gateBKey ? "a"
        : queryGateKey === gateBKey && queryGateKey !== gateAKey ? "b"
          : null;
      if (!shownQueryGate) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = RULE_SWITCH_PROGRAM_GRAMMAR.filter((candidateProgram) =>
        candidateProgram.queryGate === shownQueryGate &&
        unaryExampleMatches(workedInputA, workedOutputA, candidateProgram.gateA) &&
        unaryExampleMatches(workedInputB, workedOutputB, candidateProgram.gateB));
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applySceneUnary(queryInput, selectedRuleSwitchOperation(candidateProgram))));
      const wrongExecutions = [
        { output: queryInput, reason: "omits the selected gate" },
        ...survivors.flatMap((candidateProgram) => {
          const selected = selectedRuleSwitchOperation(candidateProgram);
          const unselected = unselectedRuleSwitchOperation(candidateProgram);
          const otherOutput = applySceneUnary(queryInput, unselected);
          const selectedOutput = applySceneUnary(queryInput, selected);
          return [
            { output: otherOutput, reason: "uses the other demonstrated gate" },
            {
              output: otherOutput && applySceneUnary(otherOutput, selected),
              reason: "applies both gates instead of the one shown",
            },
            {
              output: selectedOutput && applySceneUnary(selectedOutput, unselected),
              reason: "applies both gates instead of the one shown",
            },
          ];
        }),
        // Anything else the bounded operation set can produce from the query.
        // Listed last so the more specific reasons above win when both apply.
        ...RULE_SWITCH_OPERATION_GRAMMAR.flatMap((operation) => {
          const selectedByASurvivor = survivors.some((candidateProgram) =>
            JSON.stringify(selectedRuleSwitchOperation(candidateProgram)) === JSON.stringify(operation));
          return selectedByASurvivor
            ? []
            : [{
                output: applySceneUnary(queryInput, operation),
                reason: "follows an operation that fails the selected gate's worked row",
              }];
        }),
      ];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["two-worked-gates", "query-gate-cue", "gate-identity"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output && sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const COMPOSED_TRANSFORM_GRAMMAR: readonly SceneOrderedComposition[] = enumerateSceneOrderedCompositions();

function compositionPrimitiveDescription(primitive: SceneCompositionPrimitive): string {
  return primitive.kind === "spatial"
    ? spatialOperationDescription(primitive.operation)
    : `changes only the token in the upper-left slot to ${primitive.fill}`;
}

function compositionPrimitiveMatches(input: Scene, output: Scene, primitive: SceneCompositionPrimitive): boolean {
  const predicted = applySceneCompositionPrimitive(input, primitive);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

function compositionPrimitiveKey(primitive: SceneCompositionPrimitive): string {
  return JSON.stringify(primitive);
}

function compositionProgramsDifferByOneStep(
  first: SceneOrderedComposition,
  second: SceneOrderedComposition,
): boolean {
  const firstMatches = compositionPrimitiveKey(first.first) === compositionPrimitiveKey(second.first);
  const secondMatches = compositionPrimitiveKey(first.second) === compositionPrimitiveKey(second.second);
  return firstMatches !== secondMatches;
}

function spatialPreimageOfUpperLeft(primitive: SceneCompositionPrimitive): { row: number; column: number } | null {
  if (primitive.kind !== "spatial") return null;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const moved = applySceneCompositionPrimitive(one("circle", row, column), primitive);
      const placement = moved?.objects[0];
      if (placement?.row === 0 && placement.column === 0) return { row, column };
    }
  }
  return null;
}

function composedTransform(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, COMPOSED_TRANSFORM_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const spatialPrimitive = program.first.kind === "spatial" ? program.first : program.second;
  const preimage = spatialPreimageOfUpperLeft(spatialPrimitive);
  if (!preimage || (preimage.row === 0 && preimage.column === 0)) {
    throw new Error("composed transform needs a moving upper-left preimage");
  }
  const workedInputFor = (primitive: SceneCompositionPrimitive, offset: number): Scene =>
    primitive.kind === "spatial"
      ? scene([
          { row: 0, column: 0, object: token(shapes[offset % shapes.length]) },
          { row: 1, column: 2, object: token(shapes[(offset + 1) % shapes.length], "solid") },
        ])
      : scene([
          { row: 0, column: 0, object: token(shapes[offset % shapes.length]) },
          { row: 2, column: 2, object: token(shapes[(offset + 1) % shapes.length]) },
        ]);
  const workedInputA = workedInputFor(program.first, 0);
  const workedOutputA = applySceneCompositionPrimitive(workedInputA, program.first)!;
  const workedInputB = workedInputFor(program.second, 2);
  const workedOutputB = applySceneCompositionPrimitive(workedInputB, program.second)!;
  const query = scene([
    { row: 0, column: 0, object: token(shapes[4]) },
    { ...preimage, object: token(shapes[3]) },
    { row: 1, column: 2, object: token(shapes[2]) },
  ]);
  const answer = applySceneOrderedComposition(query, program);
  const wrongOrder = applySceneOrderedComposition(query, { first: program.second, second: program.first });
  if (!answer || !wrongOrder || sceneSignature(answer) === sceneSignature(wrongOrder)) {
    throw new Error("composed transform needs a visible order effect");
  }
  // The three ways to get this wrong, in the same order the validator witnesses
  // them: run the two gates the other way round, stop after one gate, or swap
  // one gate for a primitive that fails its own worked row.
  const nearMissPool = distinctOutputs([
    wrongOrder,
    applySceneCompositionPrimitive(query, program.first),
    applySceneCompositionPrimitive(query, program.second),
    ...COMPOSED_TRANSFORM_GRAMMAR.flatMap((candidateProgram) =>
      compositionProgramsDifferByOneStep(program, candidateProgram)
        ? [applySceneOrderedComposition(query, candidateProgram)]
        : []),
  ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  // Keep the reversed-order board: it is the near miss that proves order matters.
  const composedDistractors = selectDistractors(nearMissPool, rng, "composed transform", [wrongOrder]);
  const puzzle = makePuzzle(
    "prototype-composed-transform",
    "matrix",
    "machineTable",
    "Infer each worked gate, then apply the two query gates from left to right.",
    4,
    [
      workedInputA, gateVisual("a"), workedOutputA,
      workedInputB, gateVisual("b"), workedOutputB,
      query, gateVisual("a", "b"), { blank: true },
    ],
    answer,
    composedDistractors,
    rng,
    `The two worked rows expose both primitives separately. Gate A ${compositionPrimitiveDescription(program.first)}, and gate B ${compositionPrimitiveDescription(program.second)}. The query shows A before B, so their effects must be applied in that visible order to obtain the highlighted board. The distractors reverse the order, omit one demonstrated step, or replace one step with another bounded primitive that fails its worked row.`,
  );
  const family = definition(
    "composed-transform-v1",
    ["worked-gate-a", "worked-gate-b", "left-to-right-order", "targeted-fill-slot"],
    sceneOrderedCompositionKey(program),
    (candidate) => {
      const [
        inputA, shownGateA, outputA,
        inputB, shownGateB, outputB,
        queryInput, queryGates,
      ] = candidate.stem.map(scenePanel);
      if (!inputA || !shownGateA || !outputA || !inputB || !shownGateB || !outputB || !queryInput || !queryGates) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const gateAKey = gateSymbolKey(shownGateA);
      const gateBKey = gateSymbolKey(shownGateB);
      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const queryGateLayoutValid = orderedQueryGates.length === 2 && queryGates.tiles.length === 0 &&
        orderedQueryGates.every((placement, index) => placement.row === 1 && placement.column === index);
      if (!gateAKey || !gateBKey || !queryGateLayoutValid ||
          JSON.stringify(orderedQueryGates[0].object) !== gateAKey ||
          JSON.stringify(orderedQueryGates[1].object) !== gateBKey) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = COMPOSED_TRANSFORM_GRAMMAR.filter((candidateProgram) =>
        compositionPrimitiveMatches(inputA, outputA, candidateProgram.first) &&
        compositionPrimitiveMatches(inputB, outputB, candidateProgram.second));
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applySceneOrderedComposition(queryInput, candidateProgram)));
      const wrongExecutions = survivors.flatMap((survivor) => {
        const reversed = applySceneOrderedComposition(queryInput, {
          first: survivor.second,
          second: survivor.first,
        });
        return [
          { output: reversed, reason: "applies the two demonstrated gates in reverse order" },
          {
            output: applySceneCompositionPrimitive(queryInput, survivor.first),
            reason: "omits the second demonstrated gate",
          },
          {
            output: applySceneCompositionPrimitive(queryInput, survivor.second),
            reason: "omits the first demonstrated gate",
          },
          ...COMPOSED_TRANSFORM_GRAMMAR.flatMap((candidateProgram) =>
            compositionProgramsDifferByOneStep(survivor, candidateProgram)
              ? [{
                  output: applySceneOrderedComposition(queryInput, candidateProgram),
                  reason: "replaces one step with a primitive that fails its worked row",
                }]
              : []),
        ];
      });
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-gate-a", "worked-gate-b", "left-to-right-order", "targeted-fill-slot"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output &&
            sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function contained(shape: SceneToken["shape"], inner: SceneToken["shape"], row: number, column: number): Scene {
  return scene([{
    row,
    column,
    object: {
      kind: "container",
      shape: shape === "triangle" || shape === "star" ? "circle" : shape,
      contents: [token(inner)],
    },
  }]);
}

/**
 * Simple boards this family can offer as extra wrong options: one token in each
 * slot, and two tokens in a spread of arrangements and attribute combinations.
 * Nothing here is wrong by construction — `conceptCandidate` keeps only the
 * boards that fail every concept the shown examples still allow.
 */
function conceptNearMissPool(shapes: readonly SceneToken["shape"][]): Scene[] {
  const slots = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
  const singles = slots.flatMap((slot, index) =>
    RELATIONAL_FILLS.map((fill) => scene([{ ...slot, object: token(shapes[index % shapes.length], fill) }])));
  const pairs = slots.flatMap((first, firstIndex) => slots.slice(firstIndex + 1).flatMap((second) =>
    shapes.flatMap((shape, shapeIndex) => [
      scene([
        { ...first, object: token(shape) },
        { ...second, object: token(shapes[(shapeIndex + 1) % shapes.length], "solid") },
      ]),
      scene([
        { ...first, object: token(shape) },
        { ...second, object: token(shape, "solid") },
      ]),
    ])));
  return [...singles, ...pairs];
}

function conceptCandidate(
  rng: Rng,
  shapes: readonly SceneToken["shape"][],
  ruleKey: string,
  relationCue: string,
  positives: readonly Scene[],
  negatives: readonly Scene[],
  answer: Scene,
  authoredDistractors: readonly Scene[],
  explanation: string,
): SceneFamilyCandidate {
  // A wrong option has to fail every concept still consistent with the shown
  // examples — exactly the test the validator applies — or the item would have a
  // second defensible answer. The hand-written near misses come first because
  // they are the ones chosen to look tempting; the pool only tops up the rest.
  const survivors = enumerateSceneConcepts().filter((concept) =>
    positives.every((example) => sceneSatisfiesConcept(example, concept)) &&
    negatives.every((example) => !sceneSatisfiesConcept(example, concept)));
  const failsEverySurvivor = (option: Scene) =>
    survivors.length > 0 && survivors.every((concept) => !sceneSatisfiesConcept(option, concept));
  const distractors = takeDistinctScenes(
    [
      ...authoredDistractors.filter(failsEverySurvivor),
      ...shuffled(rng, conceptNearMissPool(shapes).filter(failsEverySurvivor)),
    ],
    DISTRACTORS_PER_ITEM,
    [answer],
  );
  if (distractors.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(`concept induction needs ${DISTRACTORS_PER_ITEM} boards that break the concept`);
  }
  const rawOptions = [answer, ...distractors];
  const order = shuffled(rng, rawOptions.map((_, index) => index));
  const options = order.map((index) => rawOptions[index]);
  const answerIndex = order.indexOf(0);
  const puzzle: Puzzle<Scene> = {
    id: "prototype-concept-induction",
    type: "oddOneOut",
    layout: "conceptGroups",
    instruction: "The top scenes belong; the lower scenes do not. Which option belongs?",
    difficulty: 5,
    stem: [...positives, ...negatives],
    options,
    answerIndex,
    explanation,
  };
  const family = definition(
    "concept-induction-v2",
    ["positive-group", "negative-group", relationCue],
    ruleKey,
    (candidate) => {
      const examples = candidate.stem.map(scenePanel);
      if (examples.some((example) => !example)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const positiveExamples = examples.slice(0, 3) as Scene[];
      const negativeExamples = examples.slice(3, 6) as Scene[];
      const survivors = enumerateSceneConcepts().filter((concept) =>
        positiveExamples.every((example) => sceneSatisfiesConcept(example, concept)) &&
        negativeExamples.every((example) => !sceneSatisfiesConcept(example, concept)),
      );
      const classifications = survivors.map((concept) =>
        candidate.options.flatMap((option, optionIndex) =>
          sceneSatisfiesConcept(option, concept) ? [optionIndex] : []));
      const everyConceptSelectsOne = classifications.length > 0 &&
        classifications.every((matches) => matches.length === 1);
      const predictedAnswers = new Set(classifications.flat());
      const unique = everyConceptSelectsOne && predictedAnswers.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedAnswers][0]] : null,
        solutionCount: unique ? 1 : predictedAnswers.size,
        usedCueIds: ["positive-group", "negative-group", relationCue],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          survivors.length > 0 && survivors.every((concept) => !sceneSatisfiesConcept(option, concept))
            ? "fails every concept consistent with the positive and negative examples"
            : null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

type AttributeConceptRelation = "same" | "different";
type AttributeConceptAttribute = "shape" | "fill";

function attributeConceptScene(
  shapes: readonly SceneToken["shape"][],
  attribute: AttributeConceptAttribute,
  values: readonly string[],
  variant: 0 | 1 | 2,
): Scene {
  const positions = variant === 0
    ? [{ row: 0, column: 0 }, { row: 0, column: 1 }]
    : variant === 1
      ? [{ row: 0, column: 0 }, { row: 2, column: 2 }]
      : [{ row: 0, column: 0 }, { row: 0, column: 2 }, { row: 2, column: 1 }];
  const nuisanceShapes = variant === 0 ? [shapes[0], shapes[1]]
    : variant === 1 ? [shapes[2], shapes[2]]
      : [shapes[0], shapes[3], shapes[4]];
  const nuisanceFills = variant === 0 ? ["outline", "solid"] as const
    : variant === 1 ? ["half", "half"] as const
      : ["outline", "half", "solid"] as const;
  const sizes = variant === 0 ? ["m", "l"] as const
    : variant === 1 ? ["l", "l"] as const
      : ["l", "m", "l"] as const;
  return scene(positions.map((position, index) => ({
    ...position,
    object: token(
      attribute === "shape" ? values[index] as SceneToken["shape"] : nuisanceShapes[index],
      attribute === "fill" ? values[index] as SceneToken["fill"] : nuisanceFills[index],
      sizes[index],
    ),
  })));
}

function attributeConceptCandidate(
  rng: Rng,
  shapes: readonly SceneToken["shape"][],
  relation: AttributeConceptRelation,
  attribute: AttributeConceptAttribute,
): SceneFamilyCandidate {
  const domain: readonly string[] = attribute === "shape" ? shapes : RELATIONAL_FILLS;
  const positives = relation === "same"
    ? [
        attributeConceptScene(shapes, attribute, [domain[0], domain[0]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[1]], 1),
        attributeConceptScene(shapes, attribute, [domain[2], domain[2], domain[2]], 2),
      ]
    : [
        attributeConceptScene(shapes, attribute, [domain[0], domain[1]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[2]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[1], domain[2]], 2),
      ];
  const negatives = relation === "same"
    ? [
        attributeConceptScene(shapes, attribute, [domain[0], domain[1]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[2]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[0], domain[1]], 2),
      ]
    : [
        attributeConceptScene(shapes, attribute, [domain[0], domain[0]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[1]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[1], domain[0]], 2),
      ];
  const answerValues = relation === "same"
    ? [domain[2], domain[2]]
    : [domain[0], domain[1], domain[2]];
  const answerOption = relation === "same"
    ? attributeConceptScene(shapes, attribute, answerValues, 1)
    : attributeConceptScene(shapes, attribute, answerValues, 2);
  const authoredDistractors: readonly Scene[] = relation === "same"
    ? [
        attributeConceptScene(shapes, attribute, [domain[0], domain[1]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[2]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[0], domain[1]], 2),
      ]
    : [
        attributeConceptScene(shapes, attribute, [domain[0], domain[0]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[1]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[1], domain[0]], 2),
      ];
  const concept: SceneConcept = { all: [{ kind: relation, attribute }] };
  const relationText = relation === "same" ? "the same" : "a different";
  const failureText = relation === "same" ? "mixes at least two values" : "repeats at least one value";
  return conceptCandidate(
    rng,
    shapes,
    JSON.stringify({ concept }),
    `${relation}-${attribute}-relation`,
    positives,
    negatives,
    answerOption,
    authoredDistractors,
    `Compare only the ${attribute} of each top-level token. Every check-marked scene gives every token ${relationText} ${attribute}, while each crossed scene ${failureText}; position, the other token attributes, and token count vary to rule out shortcuts. The highlighted option follows that complete relation. Every distractor visibly breaks it even when another feature looks regular.`,
  );
}

function conceptInduction(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const variant = pick(rng, [
    "contains",
    "adjacent",
    "symmetry",
    "equal-row-counts",
    "same-shape",
    "same-fill",
    "different-shape",
    "different-fill",
  ] as const);

  if (variant === "same-shape") return attributeConceptCandidate(rng, shapes, "same", "shape");
  if (variant === "same-fill") return attributeConceptCandidate(rng, shapes, "same", "fill");
  if (variant === "different-shape") return attributeConceptCandidate(rng, shapes, "different", "shape");
  if (variant === "different-fill") return attributeConceptCandidate(rng, shapes, "different", "fill");

  if (variant === "adjacent") {
    const positives = [
      scene([{ row: 0, column: 0, object: token(shapes[0]) }, { row: 0, column: 1, object: token(shapes[1]) }]),
      scene([{ row: 0, column: 2, object: token(shapes[2]) }, { row: 1, column: 2, object: token(shapes[2], "solid") }]),
      scene([
        { row: 2, column: 0, object: token(shapes[3]) },
        { row: 2, column: 1, object: token(shapes[4], "solid") },
        { row: 0, column: 2, object: token(shapes[3]) },
      ]),
    ];
    const negatives = [
      scene([{ row: 0, column: 0, object: token(shapes[0]) }, { row: 2, column: 2, object: token(shapes[1]) }]),
      scene([{ row: 0, column: 2, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[2]) }]),
      one(shapes[4], 1, 1),
    ];
    return conceptCandidate(
      rng,
      shapes,
      JSON.stringify({ concept: { all: [{ kind: "adjacent" }] } satisfies SceneConcept }),
      "adjacency-relation",
      positives,
      negatives,
      scene([{ row: 1, column: 0, object: token(shapes[0]) }, { row: 1, column: 1, object: token(shapes[2], "solid") }]),
      [
        scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 2, column: 2, object: token(shapes[3]) }]),
        one(shapes[4], 0, 2),
        scene([
          { row: 0, column: 0, object: token(shapes[0]) },
          { row: 0, column: 2, object: token(shapes[1], "solid") },
        ]),
      ],
      "The check-marked examples all contain at least one pair of top-level tokens in neighbouring slots: the two tokens share a horizontal or vertical edge. The crossed examples have no such pair. The highlighted option has two adjacent tokens and therefore follows the concept; each distractor keeps its tokens separated or has only one token.",
    );
  }

  if (variant === "symmetry") {
    const mirrorPair = (row: number, shape: SceneToken["shape"]) => scene([
      { row, column: 0, object: token(shape) },
      { row, column: 2, object: token(shape) },
    ]);
    const positives = [mirrorPair(0, shapes[0]), mirrorPair(2, shapes[1]), one(shapes[2], 1, 1, "solid")];
    const negatives = [
      one(shapes[0], 0, 0),
      scene([{ row: 1, column: 0, object: token(shapes[1]) }, { row: 1, column: 2, object: token(shapes[2]) }]),
      scene([{ row: 0, column: 0, object: token(shapes[3]) }, { row: 1, column: 0, object: token(shapes[3]) }]),
    ];
    return conceptCandidate(
      rng,
      shapes,
      JSON.stringify({ concept: { all: [{ kind: "symmetry", axis: "horizontal" }] } satisfies SceneConcept }),
      "symmetry-relation",
      positives,
      negatives,
      mirrorPair(1, shapes[4]),
      [
        scene([{ row: 0, column: 0, object: token(shapes[4]) }, { row: 2, column: 0, object: token(shapes[4]) }]),
        one(shapes[2], 0, 0),
        scene([{ row: 2, column: 0, object: token(shapes[0]) }, { row: 2, column: 2, object: token(shapes[1]) }]),
      ],
      "The check-marked examples are unchanged when the board is reflected from left to right. A centred token reflects onto itself, while a matching pair at equal distances from the centre swaps into the same arrangement. The crossed examples lose that match. The highlighted option is the only candidate with the required left-right symmetry.",
    );
  }

  if (variant === "equal-row-counts") {
    const positives = [
      scene([
        { row: 0, column: 0, object: token(shapes[0]) },
        { row: 1, column: 1, object: token(shapes[1], "solid") },
        { row: 2, column: 2, object: token(shapes[2]) },
      ]),
      scene([
        { row: 0, column: 0, object: token(shapes[0]) }, { row: 0, column: 2, object: token(shapes[1]) },
        { row: 1, column: 0, object: token(shapes[2], "solid") }, { row: 1, column: 2, object: token(shapes[3]) },
        { row: 2, column: 0, object: token(shapes[4]) }, { row: 2, column: 2, object: token(shapes[0], "solid") },
      ]),
      scene([
        { row: 0, column: 2, object: token(shapes[3]) },
        { row: 1, column: 0, object: token(shapes[3]) },
        { row: 2, column: 1, object: token(shapes[3]) },
      ]),
    ];
    const negatives = [
      one(shapes[0], 0, 0),
      scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 1, column: 1, object: token(shapes[2]) }]),
      scene([
        { row: 1, column: 0, object: token(shapes[2]) },
        { row: 2, column: 0, object: token(shapes[3]) },
        { row: 2, column: 2, object: token(shapes[4]) },
      ]),
    ];
    return conceptCandidate(
      rng,
      shapes,
      JSON.stringify({ concept: { all: [{ kind: "count", comparison: "equal" }] } satisfies SceneConcept }),
      "row-count-relation",
      positives,
      negatives,
      scene([
          { row: 0, column: 1, object: token(shapes[4]) },
          { row: 1, column: 2, object: token(shapes[0]) },
          { row: 2, column: 0, object: token(shapes[2], "solid") },
        ]),
      [
        scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 1, column: 1, object: token(shapes[2]) }]),
        scene([
          { row: 1, column: 0, object: token(shapes[2]) },
          { row: 2, column: 0, object: token(shapes[3]) },
          { row: 2, column: 2, object: token(shapes[4]) },
        ]),
        scene([
          { row: 0, column: 0, object: token(shapes[0]) },
          { row: 0, column: 2, object: token(shapes[1], "solid") },
        ]),
      ],
      "Count only top-level tokens in each of the three rows. Every check-marked example has the same count in row one, row two, and row three; the crossed examples do not. The highlighted option places one token in each row, so its row counts are 1–1–1. Each distractor leaves at least one row with a different count.",
    );
  }

  const positives = [
    contained(shapes[0], shapes[1], 1, 1),
    contained(shapes[1], shapes[2], 0, 0),
    scene([
      { row: 2, column: 2, object: { kind: "container", shape: "hexagon", contents: [token(shapes[3])] } },
      { row: 0, column: 0, object: token(shapes[0], "solid") },
      { row: 0, column: 2, object: token(shapes[1]) },
    ]),
  ];
  const negatives = [
    one(shapes[0], 1, 1),
    scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 0, column: 1, object: token(shapes[2]) }]),
    scene([{ row: 0, column: 0, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[3], "solid") }]),
  ];
  return conceptCandidate(
    rng,
      shapes,
    JSON.stringify({ concept: { all: [{ kind: "contains" }] } satisfies SceneConcept }),
    "containment-relation",
    positives,
    negatives,
      contained(shapes[3], shapes[4], 2, 1),
      [
        one(shapes[4], 2, 1),
        scene([{ row: 1, column: 0, object: token(shapes[0]) }, { row: 1, column: 1, object: token(shapes[1]) }]),
        scene([{ row: 0, column: 0, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[2]) }]),
      ],
    "The check-marked examples all show a true containment relationship: one outlined shape visibly encloses another token. None of the crossed examples contains a token, even when two shapes are near each other. The highlighted option includes an enclosing shape with a token inside it; the distractors show only separate, adjacent, or distant tokens.",
    );
}

type CreaseGuide = NonNullable<Scene["guides"]>[number];

interface FoldProgram {
  guides: readonly [CreaseGuide] | readonly [CreaseGuide, CreaseGuide];
}

const VERTICAL_FOLD_GUIDES: readonly CreaseGuide[] = [
  { kind: "crease", axis: "vertical", direction: "rightToLeft" },
  { kind: "crease", axis: "vertical", direction: "leftToRight" },
] as const;
const HORIZONTAL_FOLD_GUIDES: readonly CreaseGuide[] = [
  { kind: "crease", axis: "horizontal", direction: "bottomToTop" },
  { kind: "crease", axis: "horizontal", direction: "topToBottom" },
] as const;
const FOLD_PROGRAM_GRAMMAR: readonly FoldProgram[] = [
  ...VERTICAL_FOLD_GUIDES.map((guide): FoldProgram => ({ guides: [guide] })),
  ...HORIZONTAL_FOLD_GUIDES.map((guide): FoldProgram => ({ guides: [guide] })),
  ...VERTICAL_FOLD_GUIDES.flatMap((vertical) =>
    HORIZONTAL_FOLD_GUIDES.map((horizontal): FoldProgram => ({ guides: [vertical, horizontal] }))),
];

function guideKey(guide: CreaseGuide): string {
  return `${guide.axis}:${guide.direction}`;
}

function foldedPosition(program: FoldProgram, variant: 0 | 1): { row: number; column: number } {
  const vertical = program.guides.find((guide) => guide.axis === "vertical");
  const horizontal = program.guides.find((guide) => guide.axis === "horizontal");
  return {
    row: horizontal?.direction === "bottomToTop" ? 0
      : horizontal?.direction === "topToBottom" ? 2
        : variant === 0 ? 0 : 2,
    column: vertical?.direction === "rightToLeft" ? 0
      : vertical?.direction === "leftToRight" ? 2
        : variant === 0 ? 0 : 2,
  };
}

function foldedPaper(shape: SceneToken["shape"], program: FoldProgram, variant: 0 | 1): Scene {
  const position = foldedPosition(program, variant);
  return {
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: [{ ...position, object: token(shape, "solid") }],
    tiles: [],
    guides: [...program.guides],
  };
}

function unfoldAcross(input: Scene, axis: "horizontal" | "vertical"): Scene | null {
  const guide = (input.guides ?? []).find((candidate) => candidate.kind === "crease" && candidate.axis === axis);
  if (!guide) return null;
  const onFoldedStack = input.objects.every((placement) =>
    guide.direction === "rightToLeft" ? placement.column <= Math.floor((input.columns - 1) / 2) :
    guide.direction === "leftToRight" ? placement.column >= Math.ceil((input.columns - 1) / 2) :
    guide.direction === "bottomToTop" ? placement.row <= Math.floor((input.rows - 1) / 2) :
    placement.row >= Math.ceil((input.rows - 1) / 2));
  if (!onFoldedStack) return null;
  const objects = input.objects.flatMap((placement) => [
    placement,
    axis === "vertical"
      ? { ...placement, column: input.columns - 1 - placement.column }
      : { ...placement, row: input.rows - 1 - placement.row },
  ]);
  const unique = new Map(objects.map((placement) => [`${placement.row}:${placement.column}:${JSON.stringify(placement.object)}`, placement]));
  const remainingGuides = (input.guides ?? []).filter((candidate) => candidate !== guide);
  const result: Scene = { ...input, objects: [...unique.values()], tiles: [], guides: remainingGuides };
  return result.objects.length > input.objects.length ? result : null;
}

function sceneUsesFoldProgram(input: Scene, program: FoldProgram): boolean {
  const shown = (input.guides ?? []).map(guideKey);
  const expected = program.guides.map(guideKey);
  return shown.length === expected.length && shown.every((key, index) => key === expected[index]);
}

function unfoldWithProgram(input: Scene, program: FoldProgram): Scene | null {
  if (!sceneUsesFoldProgram(input, program)) return null;
  let output: Scene | null = input;
  for (const guide of program.guides) output = output && unfoldAcross(output, guide.axis);
  return output;
}

function compatibleFoldPrograms(input: Scene): readonly [FoldProgram, FoldProgram, FoldProgram] | null {
  const placement = input.objects[0];
  if (!placement || input.objects.length !== 1) return null;
  const vertical = VERTICAL_FOLD_GUIDES.find((guide) =>
    guide.direction === (placement.column === 0 ? "rightToLeft" : placement.column === 2 ? "leftToRight" : ""));
  const horizontal = HORIZONTAL_FOLD_GUIDES.find((guide) =>
    guide.direction === (placement.row === 0 ? "bottomToTop" : placement.row === 2 ? "topToBottom" : ""));
  return vertical && horizontal
    ? [{ guides: [vertical] }, { guides: [horizontal] }, { guides: [vertical, horizontal] }]
    : null;
}

/** Move every punch across the program's creases instead of keeping both copies. */
function mirroredWithoutOriginal(input: Scene, program: FoldProgram): Scene | null {
  let objects = input.objects;
  for (const guide of program.guides) {
    objects = objects.map((placement) => guide.axis === "vertical"
      ? { ...placement, column: input.columns - 1 - placement.column }
      : { ...placement, row: input.rows - 1 - placement.row });
  }
  const moved: Scene = { ...input, objects, tiles: [], guides: [] };
  return sceneSignature(moved) === sceneSignature({ ...input, guides: [] }) ? null : moved;
}

function foldNearMissOutputs(input: Scene, answer: Scene): Array<{ output: Scene; reason: string }> {
  const withoutCrease: Scene = { ...input, guides: [] };
  const compatible = compatibleFoldPrograms(input) ?? [];
  return [
    { output: withoutCrease, reason: "leaves every fold closed" },
    ...compatible.flatMap((program) => {
      const folded: Scene = { ...input, guides: [...program.guides] };
      const output = unfoldWithProgram(folded, program);
      return output ? [{ output, reason: `uses the ${program.guides.map(guideKey).join(" then ")} fold program` }] : [];
    }),
    // Opening a fold keeps the punch and adds its mirror. Moving the punch to
    // the mirror instead is the other way to get the count wrong.
    ...compatible.flatMap((program) => {
      const output = mirroredWithoutOriginal(input, program);
      return output
        ? [{ output, reason: `moves the punch across the ${program.guides.map(guideKey).join(" then ")} crease instead of keeping both` }]
        : [];
    }),
  ].filter((entry, index, entries) =>
    sceneSignature(entry.output) !== sceneSignature(answer) &&
    entries.findIndex((candidate) => sceneSignature(candidate.output) === sceneSignature(entry.output)) === index);
}

function foldPunch(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, FOLD_PROGRAM_GRAMMAR);
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const first = foldedPaper(firstShape, program, 0);
  const unfolded = unfoldWithProgram(first, program)!;
  const query = foldedPaper(secondShape, program, 1);
  const answer = unfoldWithProgram(query, program)!;
  const nearMisses = selectDistractors(
    foldNearMissOutputs(query, answer).map((entry) => entry.output),
    rng,
    "fold punch",
  );
  const puzzle = makePuzzle(
    "prototype-fold-punch",
    "analogy",
    "analogy",
    "The centre line is a fold. Apply the same unfolding to the new punch.",
    4,
    [first, unfolded, query],
    answer,
    nearMisses,
    rng,
    `The worked pair establishes the visible crease program: ${program.guides.map(guideKey).join(", then ")}. Opening each fold preserves every existing punch and adds its mirror across that crease, so one crease makes two punches and two creases make four. Applying the same complete program to the query gives the highlighted board. The distractors leave a fold closed, omit one crease, unfold across the wrong axis, or move the punch to its mirror instead of keeping both.`,
  );
  const family = definition(
    "fold-punch-v2",
    ["visible-creases", "fold-directions", "worked-unfold"],
    JSON.stringify(program),
    (candidate) => {
      const [workedInput, workedOutput, queryInput] = candidate.stem.map(scenePanel);
      if (!workedInput || !workedOutput || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = FOLD_PROGRAM_GRAMMAR.filter((candidateProgram) => {
        const predicted = unfoldWithProgram(workedInput, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        unfoldWithProgram(queryInput, candidateProgram)));
      const wrongRules = predictions[0] ? foldNearMissOutputs(queryInput, predictions[0]) : [];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["visible-creases", "fold-directions", "worked-unfold"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongRules.find((rule) => rule.output && sceneSignature(rule.output) === sceneSignature(option) &&
            (!predictions[0] || sceneSignature(option) !== sceneSignature(predictions[0])))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function inverseFoldPunch(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, FOLD_PROGRAM_GRAMMAR);
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const firstFolded = foldedPaper(firstShape, program, 0);
  const firstUnfolded = unfoldWithProgram(firstFolded, program)!;
  const answer = foldedPaper(secondShape, program, 1);
  const queryUnfolded = unfoldWithProgram(answer, program)!;
  const distractors = FOLD_PROGRAM_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram, index) => foldedPaper(secondShape, candidateProgram, index % 2 as 0 | 1))
    .filter((candidate, index, candidates) =>
      sceneSignature(candidate) !== sceneSignature(answer) &&
      candidates.findIndex((other) => sceneSignature(other) === sceneSignature(candidate)) === index);
  const selectedDistractors = selectDistractors(distractors, rng, "inverse fold punch");
  const puzzle = makePuzzle(
    "prototype-inverse-fold-punch",
    "analogy",
    "analogy",
    "Use the fold arrow and worked pair. Which folded punch produces the third board?",
    5,
    [firstUnfolded, firstFolded, queryUnfolded],
    answer,
    selectedDistractors,
    rng,
    `Work backward from the open query board using the worked crease program: ${program.guides.map(guideKey).join(", then ")}. Mirrored punches overlap when each indicated side folds across its centre line, leaving the single punch shown by the highlighted folded board. Its punch position, crease axes, and arrows all match the worked pair. The other options use a different bounded fold program, so they either unfold to another pattern or contradict the demonstrated directions.`,
  );
  const family = definition(
    "inverse-fold-punch-v2",
    ["worked-inverse-fold", "fold-direction", "mirrored-punches"],
    `inverse:${JSON.stringify(program)}`,
    (candidate) => {
      const [workedOutput, workedFolded, queryOutput] = candidate.stem.map(scenePanel);
      if (!workedOutput || !workedFolded || !queryOutput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = FOLD_PROGRAM_GRAMMAR.filter((candidateProgram) => {
        const prediction = unfoldWithProgram(workedFolded, candidateProgram);
        return prediction !== null && sceneSignature(prediction) === sceneSignature(workedOutput);
      });
      const evaluated = candidate.options.map((option) => {
        const matchingPrograms = survivors.filter((candidateProgram) => {
          const output = unfoldWithProgram(option, candidateProgram);
          return output !== null && sceneSignature(output) === sceneSignature(queryOutput);
        });
        return {
          option,
          matchingPrograms,
          witness: matchingPrograms.length === 0
            ? "its punch position, crease axes, or arrows do not reproduce the shown unfolding under the worked program"
            : "matches more than one surviving fold program",
        };
      });
      const selections = survivors.map((candidateProgram) => evaluated.flatMap((entry, optionIndex) =>
        entry.matchingPrograms.includes(candidateProgram) ? [optionIndex] : []));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["worked-inverse-fold", "fold-direction", "mirrored-punches"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || evaluated[optionIndex].matchingPrograms.length > 0
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].witness }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function applySingleTokenStep(input: Scene, program: RelationalStepProgram): Scene | null {
  const placement = singleTokenPlacement(input);
  if (!placement) return null;
  const positionIndex = RELATIONAL_RING_POSITIONS.findIndex((position) =>
    position.row === placement.row && position.column === placement.column);
  const fillIndex = RELATIONAL_FILLS.indexOf(placement.object.fill);
  if (positionIndex === -1 || fillIndex === -1) return null;
  const position = RELATIONAL_RING_POSITIONS[
    (positionIndex + program.positionDelta + RELATIONAL_RING_POSITIONS.length) % RELATIONAL_RING_POSITIONS.length
  ];
  const fill = RELATIONAL_FILLS[(fillIndex + program.fillDelta) % RELATIONAL_FILLS.length];
  return scene([{ ...position, object: { ...placement.object, fill } }]);
}

function matchingSingleTokenSteps(
  examples: readonly { input: Scene; output: Scene }[],
): RelationalStepProgram[] {
  return RELATIONAL_STEP_GRAMMAR.filter((program) => examples.every((example) => {
    const output = applySingleTokenStep(example.input, program);
    return output !== null && sceneSignature(output) === sceneSignature(example.output);
  }));
}

function tokenStepDescription(program: RelationalStepProgram): string {
  const direction = program.positionDelta > 0 ? "clockwise" : "counter-clockwise";
  const distance = Math.abs(program.positionDelta);
  const fill = program.fillDelta === 0
    ? "keeps its fill"
    : program.fillDelta === 1
      ? "cycles outline to half to solid"
      : "cycles outline to solid to half";
  return `moves ${distance} perimeter slot${distance === 1 ? "" : "s"} ${direction} and ${fill}`;
}

function interleavedSequence(rng: Rng): SceneFamilyCandidate {
  const [a, b] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const programA = pick(rng, RELATIONAL_STEP_GRAMMAR);
  const programB = pick(rng, RELATIONAL_STEP_GRAMMAR.filter((program) =>
    JSON.stringify(program) !== JSON.stringify(programA)));
  const startA = pick(rng, RELATIONAL_RING_POSITIONS);
  const startB = pick(rng, RELATIONAL_RING_POSITIONS);
  const strandA = [one(a, startA.row, startA.column, pick(rng, RELATIONAL_FILLS))];
  strandA.push(applySingleTokenStep(strandA[0], programA)!);
  strandA.push(applySingleTokenStep(strandA[1], programA)!);
  const strandB = [one(b, startB.row, startB.column, pick(rng, RELATIONAL_FILLS))];
  strandB.push(applySingleTokenStep(strandB[0], programB)!);
  strandB.push(applySingleTokenStep(strandB[1], programB)!);
  const answer = strandB[2];
  const distractors = distinctOutputs(RELATIONAL_STEP_GRAMMAR
    .filter((program) => JSON.stringify(program) !== JSON.stringify(programB))
    .map((program) => applySingleTokenStep(strandB[1], program)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "interleaved sequence");
  const puzzle = makePuzzle(
    "prototype-interleaved-sequence",
    "sequence",
    "row",
    "Split the panels into two alternating rules. What comes next?",
    4,
    [strandA[0], strandB[0], strandA[1], strandB[1], strandA[2], { blank: true }],
    answer,
    selectedDistractors,
    rng,
    `Split the row into odd and even panels. In the odd-panel strand, the ${a} token ${tokenStepDescription(programA)}; in the even-panel strand, the ${b} token ${tokenStepDescription(programB)}. The missing panel belongs to the even strand, so applying its own position and fill rule once more gives the highlighted option. Each distractor is a prediction from another bounded step rule that fails the shown even transition.`,
  );
  const family = definition(
    "interleaved-sequence-v2",
    ["alternating-slots", "perimeter-order", "two-step-rules", "fill-states"],
    JSON.stringify({ strandA: programA, strandB: programB }),
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      const [a0, b0, a1, b1, a2] = panels;
      if (!a0 || !b0 || !a1 || !b1 || !a2) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const strandAExamples = [{ input: a0, output: a1 }, { input: a1, output: a2 }];
      const strandBExamples = [{ input: b0, output: b1 }];
      const strandASurvivors = matchingSingleTokenSteps(strandAExamples);
      const strandBSurvivors = matchingSingleTokenSteps(strandBExamples);
      const predictions = distinctOutputs(strandASurvivors.flatMap(() =>
        strandBSurvivors.map((program) => applySingleTokenStep(b1, program))));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["alternating-slots", "perimeter-order", "two-step-rules", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedRule = RELATIONAL_STEP_GRAMMAR.find((program) => {
            const queryOutput = applySingleTokenStep(b1, program);
            const workedOutput = applySingleTokenStep(b0, program);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(b1));
          });
          return failedRule
            ? `the ${failedRule.positionDelta}, ${failedRule.fillDelta} step rule fails the shown even transition`
            : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
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
    `Read the eight outside slots as one ordered ring. The token moves ${rule.direction === 1 ? "clockwise" : "counter-clockwise"}, starting with a jump of ${rule.startStep} slot${rule.startStep === 1 ? "" : "s"}; each later jump grows by ${rule.stepDelta}. The next jump is therefore ${rule.startStep + 4 * rule.stepDelta} slots in the same direction, which lands at the highlighted position. Each distractor comes from another bounded direction, starting jump, or growth rule that fails a shown landing.`,
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
  return asCandidate(family, puzzle);
}

function inverseAnalogy(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, ANALOGY_COMPOSITION_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const originalA = scene([
    { row: 0, column: 0, object: token(shapes[0], "outline") },
    { row: 1, column: 2, object: token(shapes[1], "half") },
  ]);
  const outputA = applyAnalogyComposition(originalA, program)!;
  const originalB = scene([
    { row: 0, column: 1, object: token(shapes[2], "solid") },
    { row: 2, column: 0, object: token(shapes[3], "half") },
  ]);
  const outputB = applyAnalogyComposition(originalB, program)!;
  const inverseProgram = (candidateProgram: AnalogyCompositionProgram): AnalogyCompositionProgram => ({
    spatial: candidateProgram.spatial.kind === "reflect"
      ? candidateProgram.spatial
      : {
          kind: "rotate",
          quarterTurns: (4 - candidateProgram.spatial.quarterTurns) as 1 | 2 | 3,
        },
    fillDelta: (3 - candidateProgram.fillDelta) as 1 | 2,
  });
  const distractors = distinctOutputs(ANALOGY_COMPOSITION_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyAnalogyComposition(outputB, inverseProgram(candidateProgram))))
    .filter((candidate) => {
      if (sceneSignature(candidate) === sceneSignature(originalB)) return false;
      const targetOutput = applyAnalogyComposition(candidate, program);
      return targetOutput === null || sceneSignature(targetOutput) !== sceneSignature(outputB);
    });
  const selectedDistractors = selectDistractors(distractors, rng, "inverse analogy");
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
    `The first pair is shown in reverse order: the second board becomes the first after the board ${analogySpatialDescription(program.spatial)} and every fill advances ${program.fillDelta} step${program.fillDelta === 1 ? "" : "s"}. Test each option as the missing input and apply both changes. Only the highlighted input produces the third board exactly. Each distractor would work under another bounded spatial-and-fill program, but that program fails the worked pair.`,
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
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["inverse-worked-pair", "ordered-board-slots", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = ANALOGY_COMPOSITION_GRAMMAR.find((candidateProgram) => {
            const optionOutput = applyAnalogyComposition(option, candidateProgram);
            const worked = applyAnalogyComposition(workedInput, candidateProgram);
            return optionOutput !== null && sceneSignature(optionOutput) === sceneSignature(queryOutput) &&
              (worked === null || sceneSignature(worked) !== sceneSignature(workedOutput));
          });
          return failedProgram ? "this input works only under a program that fails the inverse worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

type RepairProjection = "shape" | "fill";
type RepairRule = "latin" | "horizontal-stripes" | "vertical-stripes" | "checkerboard";

interface RepairProgram {
  projection: RepairProjection;
  rule: RepairRule;
}

const REPAIR_GRAMMAR: readonly RepairProgram[] = (["shape", "fill"] as const).flatMap((projection) =>
  (["latin", "horizontal-stripes", "vertical-stripes", "checkerboard"] as const)
    .map((rule) => ({ projection, rule })));

const REPAIR_SHAPE_DOMAIN: readonly SceneToken["shape"][] = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
] as const;

function repairTokenGrid(value: Scene): SceneToken[][] | null {
  if (value.rows !== 3 || value.columns !== 3 || value.objects.length !== 9 || value.tiles.length > 0) return null;
  const byPosition = new Map(value.objects.map((placement) => [
    `${placement.row}:${placement.column}`,
    placement.object.kind === "token" ? placement.object : null,
  ]));
  const grid = [0, 1, 2].map((row) => [0, 1, 2].map((column) => byPosition.get(`${row}:${column}`)));
  return grid.some((row) => row.some((entry) => !entry)) ? null : grid as SceneToken[][];
}

function repairProgramFailures(value: Scene, program: RepairProgram): string[] {
  const grid = repairTokenGrid(value);
  if (!grid) return ["board is not a complete 3 by 3 token grid"];
  const projected = grid.map((row) => row.map((entry) => entry[program.projection]));
  if (program.rule === "latin") {
    const failures: string[] = [];
    for (let index = 0; index < 3; index++) {
      if (new Set(projected[index]).size !== 3) {
        failures.push(`row ${index + 1} repeats a ${program.projection}`);
      }
      if (new Set(projected.map((row) => row[index])).size !== 3) {
        failures.push(`column ${index + 1} repeats a ${program.projection}`);
      }
    }
    const counts = new Map<string, number>();
    for (const entry of projected.flat()) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    if (counts.size !== 3 || [...counts.values()].some((count) => count !== 3)) {
      failures.push(`the Latin board does not use exactly three ${program.projection} values three times each`);
    }
    return failures;
  }
  if (program.rule === "horizontal-stripes") {
    const representatives = projected.map((row) => row[0]);
    const rowsAreUniform = projected.every((row) => row.every((entry) => entry === row[0]));
    return rowsAreUniform && new Set(representatives).size === 3
      ? []
      : [`${program.projection} values do not form three different horizontal stripes`];
  }
  if (program.rule === "vertical-stripes") {
    const representatives = projected[0];
    const columnsAreUniform = [0, 1, 2].every((column) =>
      projected.every((row) => row[column] === projected[0][column]));
    return columnsAreUniform && new Set(representatives).size === 3
      ? []
      : [`${program.projection} values do not form three different vertical stripes`];
  }
  const even = projected.flatMap((row, rowIndex) => row.filter((_, columnIndex) =>
    (rowIndex + columnIndex) % 2 === 0));
  const odd = projected.flatMap((row, rowIndex) => row.filter((_, columnIndex) =>
    (rowIndex + columnIndex) % 2 === 1));
  return new Set(even).size === 1 && new Set(odd).size === 1 && even[0] !== odd[0]
    ? []
    : [`${program.projection} values do not alternate as a two-value checkerboard`];
}

function repairProjectionDomain(projection: RepairProjection): readonly string[] {
  return projection === "shape" ? REPAIR_SHAPE_DOMAIN : RELATIONAL_FILLS;
}

function withRepairProjection(tokenValue: SceneToken, projection: RepairProjection, value: string): SceneToken {
  return projection === "shape"
    ? { ...tokenValue, shape: value as SceneToken["shape"] }
    : { ...tokenValue, fill: value as SceneToken["fill"] };
}

function oneTileRepairChanges(value: Scene, projection: RepairProjection): Scene[] {
  const grid = repairTokenGrid(value);
  if (!grid) return [];
  return grid.flatMap((row, rowIndex) => row.flatMap((entry, columnIndex) =>
    repairProjectionDomain(projection)
      .filter((replacement) => replacement !== entry[projection])
      .map((replacement) => scene(grid.flatMap((tokenRow, placedRow) =>
        tokenRow.map((cell, placedColumn) => ({
          row: placedRow,
          column: placedColumn,
          object: placedRow === rowIndex && placedColumn === columnIndex
            ? withRepairProjection(cell, projection, replacement)
            : cell,
        }))), 3, 3))));
}

function programRepairs(value: Scene, program: RepairProgram): Scene[] {
  return oneTileRepairChanges(value, program.projection)
    .filter((candidate) => repairProgramFailures(candidate, program).length === 0);
}

function repairRuleDescription(program: RepairProgram): string {
  if (program.rule === "latin") {
    return `every row and column contains three different ${program.projection} values`;
  }
  if (program.rule === "horizontal-stripes") {
    return `each row repeats one ${program.projection}, while the three rows use different values`;
  }
  if (program.rule === "vertical-stripes") {
    return `each column repeats one ${program.projection}, while the three columns use different values`;
  }
  return `${program.projection} values alternate between two values like a checkerboard`;
}

function minimalRepair(rng: Rng): SceneFamilyCandidate {
  // v3 keeps v2's visible 3x3 one-tile repair, but every sampled program now
  // changes the projected pattern that determines the repaired tile and value.
  const program = pick(rng, REPAIR_GRAMMAR);
  const shapes = shuffled(rng, REPAIR_SHAPE_DOMAIN);
  const fills = shuffled(rng, RELATIONAL_FILLS);
  const projectedValues: readonly string[] = program.projection === "shape" ? shapes : fills;
  const valueIndexAt = (row: number, column: number): number =>
    program.rule === "latin" ? (row + column) % 3
      : program.rule === "horizontal-stripes" ? row
        : program.rule === "vertical-stripes" ? column
          : (row + column) % 2;
  const validTokenAt = (row: number, column: number): SceneToken => {
    const projectedValue = projectedValues[valueIndexAt(row, column)];
    return program.projection === "shape"
      ? token(projectedValue as SceneToken["shape"], fills[0])
      : token(shapes[3], projectedValue as SceneToken["fill"]);
  };
  const faultRow = pick(rng, [0, 1, 2]);
  const faultColumn = pick(rng, [0, 1, 2]);
  const validGrid = [0, 1, 2].map((row) => [0, 1, 2].map((column) => validTokenAt(row, column)));
  const original = validGrid[faultRow][faultColumn][program.projection];
  const usedValueCount = program.rule === "checkerboard" ? 2 : 3;
  const wrong = pick(rng, projectedValues.slice(0, usedValueCount).filter((value) => value !== original));
  const faultyGrid = validGrid.map((row) => row.map((entry) => ({ ...entry })));
  faultyGrid[faultRow][faultColumn] = withRepairProjection(
    faultyGrid[faultRow][faultColumn],
    program.projection,
    wrong,
  );
  const faulty = scene(faultyGrid.flatMap((row, rowIndex) => row.map((cell, columnIndex) => ({
    row: rowIndex,
    column: columnIndex,
    object: cell,
  }))), 3, 3);
  const repairs = REPAIR_GRAMMAR.flatMap((candidateProgram) => programRepairs(faulty, candidateProgram));
  const distinctRepairs = distinctOutputs(repairs);
  const answer = scene(validGrid.flatMap((row, rowIndex) => row.map((cell, columnIndex) => ({
    row: rowIndex,
    column: columnIndex,
    object: cell,
  }))), 3, 3);
  if (distinctRepairs.length !== 1 || sceneSignature(distinctRepairs[0]) !== sceneSignature(answer)) {
    throw new Error("minimal-repair grammar must predict one visible repair");
  }
  const distractors = selectDistractors(
    oneTileRepairChanges(faulty, program.projection)
      .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)),
    rng,
    "minimal repair",
  );
  const alternatives = [answer, ...distractors];
  const order = shuffled(rng, alternatives.map((_, index) => index));
  const puzzle: Puzzle<Scene> = {
    id: "prototype-minimal-repair",
    type: "oddOneOut",
    layout: "singleScene",
    instruction: "Each option changes exactly one tile. Which change repairs the faulty board?",
    difficulty: 5,
    stem: [faulty],
    options: order.map((index) => alternatives[index]),
    answerIndex: order.indexOf(0),
    explanation: `Read the board by its ${program.projection}: ${repairRuleDescription(program)}. One tile breaks that visible pattern. Restoring ${original} at its position repairs the complete board with exactly one change, which is the highlighted option. Every distractor also changes only one tile, but it changes the wrong position or inserts a value that leaves the sampled pattern visibly broken.`,
  };
  const family = definition(
    "minimal-repair-v3",
    ["faulty-board", "one-change-options", "projected-pattern"],
    JSON.stringify(program),
    (candidate) => {
      const faultyBoard = scenePanel(candidate.stem[0]);
      if (!faultyBoard) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const faultyByPosition = new Map(faultyBoard.objects.map((placement) => [
        `${placement.row}:${placement.column}`,
        JSON.stringify(placement.object),
      ]));
      const survivors = REPAIR_GRAMMAR.map((candidateProgram) => ({
        program: candidateProgram,
        repairs: programRepairs(faultyBoard, candidateProgram),
      })).filter((entry) => entry.repairs.length > 0);
      const predictions = distinctOutputs(survivors.flatMap((entry) => entry.repairs));
      const evaluated = candidate.options.map((option) => {
        const optionByPosition = new Map(option.objects.map((placement) => [
          `${placement.row}:${placement.column}`,
          JSON.stringify(placement.object),
        ]));
        const positions = new Set([...faultyByPosition.keys(), ...optionByPosition.keys()]);
        const changedPositions = [...positions].filter((position) =>
          faultyByPosition.get(position) !== optionByPosition.get(position));
        const matchingPrograms = survivors.filter((entry) =>
          entry.repairs.some((repair) => sceneSignature(repair) === sceneSignature(option)));
        const failures = matchingPrograms.length > 0 ? []
          : survivors.flatMap((entry) => repairProgramFailures(option, entry.program)).slice(0, 1);
        if (option.rows !== faultyBoard.rows || option.columns !== faultyBoard.columns || changedPositions.length !== 1) {
          failures.unshift(`changes ${changedPositions.length} tiles instead of exactly one`);
        }
        return { option, failures, matchingPrograms };
      });
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["faulty-board", "one-change-options", "projected-pattern"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || !evaluated[optionIndex]?.failures[0]
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].failures[0] }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

export function generateSceneFamilyCandidate(familyId: SceneFamilyId, rng: Rng): SceneFamilyCandidate {
  switch (familyId) {
    case "relational-sequence-v2": return relationalSequence(rng);
    case "attribute-pairing-v1": return attributePairing(rng);
    case "compositional-analogy-v2": return compositionalAnalogy(rng);
    case "containment-analogy-v2": return containmentAnalogy(rng);
    case "composed-transform-v1": return composedTransform(rng);
    case "relational-outlier-v2": return relationalOutlier(rng);
    case "relational-matrix-v2": return relationalMatrix(rng);
    case "visual-set-algebra-v2": return setAlgebra(rng);
    case "constraint-mosaic-v2": return constraintMosaic(rng);
    case "topology-path-v1": return topologyPath(rng);
    case "spatial-transform-v2": return spatialTransform(rng);
    case "transformation-machine-v3": return transformationMachine(rng);
    case "rule-switching-v2": return ruleSwitching(rng);
    case "concept-induction-v2": return conceptInduction(rng);
    case "fold-punch-v2": return foldPunch(rng);
    case "inverse-fold-punch-v2": return inverseFoldPunch(rng);
    case "interleaved-sequence-v2": return interleavedSequence(rng);
    case "second-order-sequence-v2": return secondOrderSequence(rng);
    case "inverse-analogy-v2": return inverseAnalogy(rng);
    case "minimal-repair-v3": return minimalRepair(rng);
  }
}

export function validateSceneFamilyCandidate(
  candidate: SceneFamilyCandidate,
  expectedReplayKey?: string,
): AcceptanceResult<Scene, string> {
  return acceptFamilyCandidate(candidate.definition, candidate.puzzle, { expectedReplayKey });
}

/** Materialize the only currently supported LLM-proposed rule through pure code. */
export function generateProposedSetAlgebraCandidate(
  operation: SceneBinaryOperation,
  rng: Rng,
): SceneFamilyCandidate {
  return setAlgebra(rng, operation);
}
