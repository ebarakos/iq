import { createHash } from "node:crypto";
import { pick, shuffled, type Rng } from "../lib/rng";
import {
  areScenesCategoricallyDistinct,
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
  applySceneUnary,
  enumerateSceneConcepts,
  enumerateSceneUnaryOperations,
  sceneSatisfiesConcept,
  type SceneBinaryOperation,
  type SceneConcept,
  type SceneUnaryOperation,
} from "./scene-grammar";
import { sceneConstraintFailures, solveSceneCompletion, type SceneConstraint } from "./constraint-engine";
import { topologyFailures, type TopologyGoal } from "./topology";

export const SCENE_FAMILY_IDS = [
  "relational-sequence-v1",
  "compositional-analogy-v1",
  "containment-analogy-v1",
  "relational-outlier-v1",
  "relational-matrix-v1",
  "visual-set-algebra-v1",
  "constraint-mosaic-v1",
  "topology-path-v1",
  "spatial-transform-v1",
  "transformation-machine-v2",
  "rule-switching-v1",
  "concept-induction-v1",
  "fold-punch-v1",
  "inverse-fold-punch-v1",
  "interleaved-sequence-v1",
  "second-order-sequence-v1",
  "inverse-analogy-v1",
  "minimal-repair-v1",
] as const;
export type SceneFamilyId = (typeof SCENE_FAMILY_IDS)[number];

export interface SceneFamilyCandidate {
  familyId: SceneFamilyId;
  puzzle: Puzzle<Scene>;
  definition: FamilyDefinition<Scene, string>;
}

function token(shape: SceneToken["shape"], fill: SceneToken["fill"] = "outline"): SceneToken {
  return { kind: "token", shape, rotation: 0, fill, size: "l" };
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

function distinctOutputs(outputs: readonly (Scene | null)[]): Scene[] {
  const unique = new Map<string, Scene>();
  for (const output of outputs) {
    if (output) unique.set(sceneSignature(output), output);
  }
  return [...unique.values()];
}

function matchingUnaryOperations(
  examples: readonly { input: Scene; output: Scene }[],
): SceneUnaryOperation[] {
  const first = examples[0]?.input;
  if (!first) return [];
  return enumerateSceneUnaryOperations(first.rows, first.columns).filter((operation) =>
    examples.every((example) => {
      const output = applySceneUnary(example.input, operation);
      return output !== null && sceneSignature(output) === sceneSignature(example.output);
    }),
  );
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

function relationalSequence(rng: Rng): SceneFamilyCandidate {
  const [anchorShape, movingShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const operation: SceneUnaryOperation = { kind: "rotate", quarterTurns: 1 };
  const start = scene([
    { row: 1, column: 1, object: token(anchorShape, "solid") },
    { row: 0, column: 1, object: token(movingShape) },
  ]);
  const second = applySceneUnary(start, operation)!;
  const third = applySceneUnary(second, operation)!;
  const answer = applySceneUnary(third, operation)!;
  const distractors = [third, second, start];
  const puzzle = makePuzzle(
    "prototype-relational-sequence",
    "sequence",
    "row",
    "Which scene continues the relationship between the centre token and its neighbour?",
    2,
    [start, second, third, { blank: true }],
    answer,
    distractors,
    rng,
    "The solid token never moves, so it is the anchor. The outline token appears above it, then to its right, then below it: one quarter-turn clockwise per panel. One more identical move places the outline token to the left of the centre; the other options repeat an earlier position instead of continuing the cycle.",
  );
  const family = definition(
    "relational-sequence-v1",
    ["ordered-board-slots"],
    JSON.stringify(operation),
    (candidate) => {
      const [first, next, query] = candidate.stem.map(scenePanel);
      if (!first || !next || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = matchingUnaryOperations([
        { input: first, output: next },
        { input: next, output: query },
      ]);
      const predictions = distinctOutputs(survivors.map((candidateOperation) =>
        applySceneUnary(query, candidateOperation)));
      const grammar = enumerateSceneUnaryOperations(query.rows, query.columns);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["ordered-board-slots"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (sceneSignature(option) === sceneSignature(query)) return "repeats the last scene instead of continuing the relation";
          const wrongRule = grammar.find((candidateOperation) => {
            const output = applySceneUnary(query, candidateOperation);
            return output !== null && sceneSignature(output) === sceneSignature(option) &&
              ![
                { input: first, output: next },
                { input: next, output: query },
              ].every((example) => {
                const predicted = applySceneUnary(example.input, candidateOperation);
                return predicted !== null && sceneSignature(predicted) === sceneSignature(example.output);
              });
          });
          return wrongRule ? `the ${wrongRule.kind} alternative fails a shown transition` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function compositionalAnalogy(rng: Rng): SceneFamilyCandidate {
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const operations: SceneUnaryOperation[] = [
    { kind: "translate", rowDelta: 0, columnDelta: 1, wrap: false },
    { kind: "translate", rowDelta: 0, columnDelta: -1, wrap: false },
    { kind: "reflect", axis: "horizontal" },
    { kind: "reflect", axis: "vertical" },
  ];
  const programs = operations.flatMap((first) => [
    [first],
    ...operations.map((second) => [first, second]),
  ]);
  const applyProgram = (input: Scene, program: readonly SceneUnaryOperation[]): Scene | null => {
    let output: Scene | null = input;
    for (const operation of program) output = output && applySceneUnary(output, operation);
    return output;
  };
  const intended = [operations[0], operations[2]];
  const a = one(firstShape, 0, 1);
  const b = applyProgram(a, intended)!;
  const c = one(secondShape, 0, 1, "solid");
  const answer = applyProgram(c, intended)!;
  const distractors = [c, applyProgram(c, [operations[0]])!, applyProgram(c, [operations[3]])!];
  const puzzle = makePuzzle(
    "prototype-compositional-analogy",
    "analogy",
    "analogy",
    "Apply both demonstrated changes to the second scene.",
    3,
    [a, b, c],
    answer,
    distractors,
    rng,
    "Compare the first two boards as an ordered two-step change. First the token moves one column to the right; then the whole board is reflected from left to right. Applying those same steps, in that order, to the third board produces the highlighted option. The other choices omit a step or use the wrong reflection.",
  );
  const family = definition(
    "compositional-analogy-v1",
    ["worked-pair", "board-slots"],
    JSON.stringify(intended),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = programs.filter((program) => {
        const predicted = applyProgram(input, program);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
      });
      const predictions = distinctOutputs(survivors.map((program) => applyProgram(query, program)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-pair", "board-slots"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = programs.find((program) => {
            const queryOutput = applyProgram(query, program);
            const workedOutput = applyProgram(input, program);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(output));
          });
          return failedProgram ? "this one- or two-step program fails the worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function containmentAnalogy(rng: Rng): SceneFamilyCandidate {
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const intendedContainer = pick(rng, ["square", "diamond", "hexagon"] as const);
  const wrongContainer = intendedContainer === "square" ? "circle" : "square";
  const operations: SceneUnaryOperation[] = [
    { kind: "contain", at: { row: 0, column: 0 }, containerShape: intendedContainer },
    { kind: "contain", at: { row: 0, column: 0 }, containerShape: wrongContainer },
    { kind: "translate", rowDelta: 1, columnDelta: 0, wrap: false },
    { kind: "translate", rowDelta: 0, columnDelta: 1, wrap: false },
    { kind: "uncontain", at: { row: 0, column: 0 } },
    { kind: "remove", at: { row: 0, column: 0 } },
  ];
  const programs = operations.flatMap((first) => [
    [first],
    ...operations.map((second) => [first, second]),
  ]);
  const applyProgram = (input: Scene, program: readonly SceneUnaryOperation[]): Scene | null => {
    let output: Scene | null = input;
    for (const operation of program) output = output && applySceneUnary(output, operation);
    return output;
  };
  const intended = [operations[0], operations[2]];
  const input = one(firstShape, 0, 0);
  const output = applyProgram(input, intended)!;
  const query = one(secondShape, 0, 0, "solid");
  const answer = applyProgram(query, intended)!;
  const puzzle = makePuzzle(
    "prototype-containment-analogy",
    "analogy",
    "analogy",
    "Apply both demonstrated relationship changes in the same order.",
    4,
    [input, output, query],
    answer,
    [applyProgram(query, [operations[0]])!, applyProgram(query, [operations[2]])!, applyProgram(query, [operations[1], operations[2]])!],
    rng,
    `The worked pair changes both relationship and position. First the loose token is placed inside a ${intendedContainer}; then the complete container-and-token pair moves down one board slot. Repeating both changes on the third board gives the highlighted option. The distractors either perform only one change or use the wrong container.`,
  );
  const family = definition(
    "containment-analogy-v1",
    ["worked-containment-pair", "operation-order", "board-slots"],
    JSON.stringify(intended),
    (candidate) => {
      const [workedInput, workedOutput, queryInput] = candidate.stem.map(scenePanel);
      if (!workedInput || !workedOutput || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = programs.filter((program) => {
        const predicted = applyProgram(workedInput, program);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const predictions = distinctOutputs(survivors.map((program) => applyProgram(queryInput, program)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-containment-pair", "operation-order", "board-slots"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = programs.find((program) => {
            const queryOutput = applyProgram(queryInput, program);
            const worked = applyProgram(workedInput, program);
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

function relationalOutlier(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const options = [
    scene([{ row: 0, column: 0, object: token(shapes[0]) }, { row: 0, column: 1, object: token(shapes[1]) }]),
    scene([{ row: 1, column: 1, object: token(shapes[1]) }, { row: 2, column: 1, object: token(shapes[2]) }]),
    scene([{ row: 2, column: 0, object: token(shapes[2]) }, { row: 2, column: 1, object: token(shapes[3]) }]),
    scene([{ row: 0, column: 0, object: token(shapes[3]) }, { row: 2, column: 2, object: token(shapes[4]) }]),
  ];
  const order = shuffled(rng, options.map((_, index) => index));
  const shuffledOptions = order.map((index) => options[index]);
  const answerIndex = order.indexOf(3);
  const puzzle: Puzzle<Scene> = {
    id: "prototype-relational-outlier",
    type: "oddOneOut",
    layout: "row",
    instruction: "Which scene breaks the shared relationship?",
    difficulty: 2,
    stem: [],
    options: shuffledOptions,
    answerIndex,
    explanation: "Look at the relationship between the two tokens, not their shapes or fills. In three options the tokens occupy neighbouring board slots and share an edge. The highlighted option separates them across the board, so it is the only scene that breaks the common adjacency relationship.",
  };
  const family = definition(
    "relational-outlier-v1",
    ["relative-token-positions"],
    JSON.stringify({ concept: "adjacent" }),
    (candidate) => {
      const matchingConcepts = enumerateSceneConcepts().filter((concept) => {
        const results = candidate.options.map((option) => sceneSatisfiesConcept(option, concept));
        return results.filter((result) => !result).length === 1;
      });
      const predicted = new Set(matchingConcepts.map((concept) =>
        candidate.options.findIndex((option) => !sceneSatisfiesConcept(option, concept)),
      ));
      return {
        derivedAnswer: predicted.size === 1 ? candidate.options[[...predicted][0]] : null,
        solutionCount: predicted.size,
        usedCueIds: ["relative-token-positions"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const concept = matchingConcepts.find((candidateConcept) => sceneSatisfiesConcept(option, candidateConcept));
          return concept ? `satisfies the shared relation ${JSON.stringify(concept)}` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function relationalMatrix(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const atoms = [
    { row: 0, column: 0, object: token(shapes[0]) },
    { row: 0, column: 2, object: token(shapes[1]) },
    { row: 2, column: 0, object: token(shapes[2]) },
    { row: 2, column: 2, object: token(shapes[3]) },
  ] as const;
  const fromAtoms = (...indexes: number[]) => scene(indexes.map((index) => atoms[index]));
  const topLeft = fromAtoms(0, 1);
  const topMiddle = fromAtoms(1, 2);
  const topRight = applySceneBinary(topLeft, topMiddle, "union")!;
  const middleLeft = fromAtoms(0, 3);
  const middleMiddle = fromAtoms(2, 3);
  const middleRight = applySceneBinary(middleLeft, middleMiddle, "union")!;
  const bottomLeft = applySceneBinary(topLeft, middleLeft, "intersection")!;
  const bottomMiddle = applySceneBinary(topMiddle, middleMiddle, "intersection")!;
  const answer = applySceneBinary(bottomLeft, bottomMiddle, "union")!;
  const distractors = [
    applySceneBinary(bottomLeft, bottomMiddle, "subtract")!,
    applySceneBinary(topRight, middleRight, "union")!,
    applySceneBinary(topRight, middleRight, "xor")!,
  ];
  const puzzle = makePuzzle(
    "prototype-relational-matrix",
    "matrix",
    "grid3x3",
    "Infer the row operation and the column operation. Which board satisfies both?",
    4,
    [topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, { blank: true }],
    answer,
    distractors,
    rng,
    "The two directions use different set rules on matching board positions. Across each row, the third board keeps every token position present in either of the first two boards: a union. Down each column, the bottom board keeps only positions shared by the two boards above: an intersection. Applying both rules to the missing corner produces the same highlighted board; the distractors satisfy at most one direction.",
  );
  const family = definition(
    "relational-matrix-v1",
    ["worked-row-relations", "worked-column-relations", "shared-coordinate-frame"],
    JSON.stringify({ row: "union", column: "intersection" }),
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      if (panels.some((panel, index) => index !== 8 && panel === null)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const [a, b, rowA, c, d, rowB, colA, colB] = panels as Scene[];
      const grammar = ["union", "intersection", "subtract", "xor"] as const;
      const rowExamples = [{ left: a, right: b, output: rowA }, { left: c, right: d, output: rowB }];
      const columnExamples = [{ left: a, right: c, output: colA }, { left: b, right: d, output: colB }];
      const rowSurvivors = grammar.filter((operation) => rowExamples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const columnSurvivors = grammar.filter((operation) => columnExamples.every((example) => {
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
          const rowAlternative = grammar.find((operation) => {
            const output = applySceneBinary(colA, colB, operation);
            return output !== null && sceneSignature(output) === sceneSignature(option) && !rowSurvivors.includes(operation);
          });
          if (rowAlternative) return `${rowAlternative} predicts this board but fails a worked row`;
          const columnAlternative = grammar.find((operation) => {
            const output = applySceneBinary(rowA, rowB, operation);
            return output !== null && sceneSignature(output) === sceneSignature(option) && !columnSurvivors.includes(operation);
          });
          return columnAlternative ? `${columnAlternative} predicts this board but fails a worked column` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function setOperationExplanation(operation: SceneBinaryOperation): string {
  const rule = operation === "union"
    ? "keep every occupied position from either input, counting an overlap once"
    : operation === "intersection"
      ? "keep only positions occupied in both inputs"
      : operation === "subtract"
        ? "keep positions from the left input only when the right input does not also occupy them"
        : "keep positions occupied in exactly one input and cancel every overlap";
  return `The two completed rows demonstrate the same alignment rule: ${rule}. Board positions are compared directly; shape and fill identify the token that occupies each position. Applying that ${operation} rule to the last two boards produces the highlighted option. Each distractor is the result of one of the other three set operations.`;
}

function setAlgebra(rng: Rng, forcedOperation?: SceneBinaryOperation): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const operation: SceneBinaryOperation = forcedOperation ?? pick(rng, ["union", "intersection", "subtract", "xor"] as const);
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
  const outputA = applySceneBinary(leftA, rightA, operation)!;
  const [leftB, rightB] = pair(2);
  const outputB = applySceneBinary(leftB, rightB, operation)!;
  const [queryLeft, queryRight] = pair(1);
  const predictions = (["union", "intersection", "subtract", "xor"] as const)
    .map((candidate) => ({ candidate, output: applySceneBinary(queryLeft, queryRight, candidate) }))
    .filter((entry): entry is { candidate: SceneBinaryOperation; output: Scene } => entry.output !== null);
  const answer = applySceneBinary(queryLeft, queryRight, operation)!;
  const distractors = predictions
    .filter((entry) => entry.candidate !== operation && areScenesCategoricallyDistinct(entry.output, answer))
    .map((entry) => entry.output);
  if (distractors.length !== 3) throw new Error("set-algebra fixture must expose all three competing operations");
  const puzzle = makePuzzle(
    "prototype-set-algebra",
    "matrix",
    "grid3x3",
    "Infer how the first two boards combine to make the third.",
    4,
    [leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, { blank: true }],
    answer,
    distractors.slice(0, 3),
    rng,
    setOperationExplanation(operation),
  );
  const family = definition(
    "visual-set-algebra-v1",
    ["shared-coordinate-frame", "worked-combinations"],
    operation,
    (candidate) => {
      const scenes = candidate.stem.map(scenePanel);
      if (scenes.some((panel, index) => index !== 8 && panel === null)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const [exampleLeftA, exampleRightA, exampleOutputA, exampleLeftB, exampleRightB, exampleOutputB, left, right] = scenes as Scene[];
      const grammar = ["union", "intersection", "subtract", "xor"] as const;
      const examples = [
        { left: exampleLeftA, right: exampleRightA, output: exampleOutputA },
        { left: exampleLeftB, right: exampleRightB, output: exampleOutputB },
      ];
      const survivors = grammar.filter((candidateOperation) => examples.every((example) => {
        const output = applySceneBinary(example.left, example.right, candidateOperation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predicted = distinctOutputs(survivors.map((candidateOperation) =>
        applySceneBinary(left, right, candidateOperation)));
      return {
        derivedAnswer: predicted.length === 1 ? predicted[0] : null,
        solutionCount: predicted.length,
        usedCueIds: ["shared-coordinate-frame", "worked-combinations"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const wrongOperation = grammar.find((candidateOperation) => {
            const output = applySceneBinary(left, right, candidateOperation);
            return output !== null && sceneSignature(output) === sceneSignature(option) &&
              examples.some((example) => {
                const worked = applySceneBinary(example.left, example.right, candidateOperation);
                return worked === null || sceneSignature(worked) !== sceneSignature(example.output);
              });
          });
          return wrongOperation ? `${wrongOperation} fails at least one worked combination` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function constraintMosaic(rng: Rng): SceneFamilyCandidate {
  const [a, b, c, d] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const board = scene([
    { row: 0, column: 0, object: token(a) },
    { row: 0, column: 1, object: token(b) },
    { row: 1, column: 0, object: token(b) },
  ], 2, 2);
  const candidates: SceneObject[] = [token(a), token(b), token(c), token(d)];
  const constraints: SceneConstraint[] = [
    { kind: "allDifferent", axis: "row", index: 0, projection: "shape" },
    { kind: "allDifferent", axis: "row", index: 1, projection: "shape" },
    { kind: "allDifferent", axis: "column", index: 0, projection: "shape" },
    { kind: "allDifferent", axis: "column", index: 1, projection: "shape" },
    { kind: "exactCount", projection: "shape", value: a, count: 2 },
  ];
  const solved = solveSceneCompletion(board, { row: 1, column: 1 }, candidates, constraints);
  if (!solved.unique || solved.answerIndex === null) throw new Error("constraint fixture must have one completion");
  const options = solved.candidates.map((entry) => entry.scene);
  const order = shuffled(rng, options.map((_, index) => index));
  const shuffledOptions = order.map((index) => options[index]);
  const answerIndex = order.indexOf(solved.answerIndex!);
  const puzzle: Puzzle<Scene> = {
    id: "prototype-constraint-mosaic",
    type: "matrix",
    layout: "singleScene",
    instruction: "Which completed board satisfies every row and column constraint?",
    difficulty: 4,
    stem: [board],
    options: shuffledOptions,
    answerIndex,
    explanation: `Treat the four cells as one 2×2 board. The top row and left column already show that the two shapes must alternate, so the missing lower-right cell must contain ${a}. That choice gives one of each shape in both rows and both columns, and it makes exactly two ${a}s overall. Every other option breaks at least one of those visible constraints.`,
  };
  const family = definition(
    "constraint-mosaic-v1",
    ["upper-left-mosaic", "row-constraints", "column-constraints"],
    JSON.stringify(constraints),
    (candidate) => {
      const template = scenePanel(candidate.stem[0]);
      if (!template) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
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
        const failures = sceneConstraintFailures(option, constraints).map((failure) => failure.message);
        if (!preservesTemplate || !insertedAtTarget) failures.unshift("does not fill only the missing lower-right tile");
        return { option, failures };
      });
      const valid = evaluated.filter((entry) => entry.failures.length === 0);
      return {
        derivedAnswer: valid.length === 1 ? valid[0].option : null,
        solutionCount: valid.length,
        usedCueIds: ["upper-left-mosaic", "row-constraints", "column-constraints"],
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
  const optionEdges: Scene["tiles"][number]["edges"][] = [
    ["north", "west"],
    ["east", "west"],
    ["north", "south"],
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

function spatialTransform(rng: Rng): SceneFamilyCandidate {
  const [a, b] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const operation = pick(rng, [
    { kind: "reflect", axis: "horizontal" },
    { kind: "reflect", axis: "vertical" },
    { kind: "rotate", quarterTurns: 1 },
    { kind: "rotate", quarterTurns: 2 },
  ] as const);
  const first = scene([{ row: 0, column: 0, object: token(a) }, { row: 2, column: 1, object: token(b, "solid") }]);
  const transformed = applySceneUnary(first, operation)!;
  const query = scene([{ row: 0, column: 1, object: token(b) }, { row: 1, column: 0, object: token(a, "solid") }]);
  const answer = applySceneUnary(query, operation)!;
  const wrongCandidates = [
    query,
    ...([
      { kind: "reflect", axis: "horizontal" },
      { kind: "reflect", axis: "vertical" },
      { kind: "rotate", quarterTurns: 1 },
      { kind: "rotate", quarterTurns: 2 },
      { kind: "rotate", quarterTurns: 3 },
    ] as const).map((candidateOperation) => applySceneUnary(query, candidateOperation)!),
  ];
  const distractors = [...new Map(wrongCandidates
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer))
    .map((candidate) => [sceneSignature(candidate), candidate])).values()].slice(0, 3);
  if (distractors.length !== 3) throw new Error("spatial transform fixture needs three distinct alternatives");
  const puzzle = makePuzzle(
    "prototype-spatial-transform",
    "analogy",
    "analogy",
    "Apply the same spatial transformation.",
    3,
    [first, transformed, query],
    answer,
    distractors,
    rng,
    operation.kind === "rotate"
      ? `The first pair shows that the entire board rotates ${operation.quarterTurns} quarter-turn${operation.quarterTurns === 1 ? "" : "s"} clockwise. Both tokens keep their shapes and fills while their board positions rotate together. Applying that exact rotation to the third board gives the highlighted arrangement; the other choices leave it unchanged or use a different rotation or reflection.`
      : `The first pair shows a reflection of the entire board across its ${operation.axis} axis. Both tokens keep their shapes and fills while their positions mirror across that axis. Reflecting the third board in the same way gives the highlighted arrangement; the other choices leave it unchanged or use a different axis or rotation.`,
  );
  const family = definition(
    "spatial-transform-v1",
    ["worked-spatial-pair", "fixed-board-frame"],
    JSON.stringify(operation),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = matchingUnaryOperations([{ input, output }]);
      const predictions = distinctOutputs(survivors.map((candidateOperation) => applySceneUnary(query, candidateOperation)));
      const grammar = enumerateSceneUnaryOperations(query.rows, query.columns);
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-spatial-pair", "fixed-board-frame"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (sceneSignature(option) === sceneSignature(query)) return "omits the demonstrated spatial transformation";
          const failedRule = grammar.find((candidateOperation) => {
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

function transformationMachine(rng: Rng): SceneFamilyCandidate {
  const [shape] = shuffled(rng, ["circle", "diamond", "star"] as const);
  const gateA: SceneUnaryOperation = { kind: "rotate", quarterTurns: 1 };
  const gateB: SceneUnaryOperation = { kind: "setFill", fill: "solid" };
  const gateC: SceneUnaryOperation = {
    kind: "duplicate",
    from: { row: 0, column: 2 },
    to: { row: 2, column: 2 },
  };
  const inputA = scene([
    { row: 0, column: 0, object: token(shape) },
    { row: 2, column: 1, object: token("triangle", "solid") },
  ]);
  const outputA = applySceneUnary(inputA, gateA)!;
  const inputB = scene([
    { row: 0, column: 1, object: token(shape) },
    { row: 2, column: 0, object: token("triangle") },
  ]);
  const outputB = applySceneUnary(inputB, gateB)!;
  const inputC = one(shape, 0, 2, "solid");
  const outputC = applySceneUnary(inputC, gateC)!;
  const query = one(shape, 0, 0);
  const afterA = applySceneUnary(query, gateA)!;
  const afterB = applySceneUnary(afterA, gateB)!;
  const answer = applySceneUnary(afterB, gateC)!;
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
    [query, afterA, afterB],
    rng,
    "The three worked paths define the gates separately. The outline triangle rotates the entire board one quarter-turn clockwise; the solid square makes every token solid without moving it; the half-filled diamond duplicates the upper-right token into the lower-right slot. Apply them to the query from left to right: rotate the outline token into the upper-right, make it solid, then copy it to the lower-right. The distractors stop after zero, one, or two gates.",
  );
  const family = definition(
    "transformation-machine-v2",
    ["gate-a", "gate-b", "gate-c", "left-to-right-order"],
    JSON.stringify({ gateA, gateB, gateC }),
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
      const symbolKey = (object: SceneObject) => JSON.stringify(object);
      const gateAKey = shownGateA.objects[0] && symbolKey(shownGateA.objects[0].object);
      const gateBKey = shownGateB.objects[0] && symbolKey(shownGateB.objects[0].object);
      const gateCKey = shownGateC.objects[0] && symbolKey(shownGateC.objects[0].object);
      const shownOrder = [...queryGates.objects]
        .sort((left, right) => left.column - right.column)
        .map((placement) => symbolKey(placement.object));
      if (!gateAKey || !gateBKey || !gateCKey || shownOrder.length !== 3 ||
          shownOrder[0] !== gateAKey || shownOrder[1] !== gateBKey || shownOrder[2] !== gateCKey) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const gateASurvivors = matchingUnaryOperations([{ input: workedInputA, output: workedOutputA }]);
      const gateBSurvivors = matchingUnaryOperations([{ input: workedInputB, output: workedOutputB }]);
      const gateCSurvivors = matchingUnaryOperations([{ input: workedInputC, output: workedOutputC }]);
      const firstOutputs = distinctOutputs(gateASurvivors.map((operation) => applySceneUnary(queryInput, operation)));
      const secondOutputs = distinctOutputs(firstOutputs.flatMap((firstOutput) =>
        gateBSurvivors.map((operation) => applySceneUnary(firstOutput, operation))));
      const predictions = distinctOutputs(secondOutputs.flatMap((secondOutput) =>
        gateCSurvivors.map((operation) => applySceneUnary(secondOutput, operation))));
      const wrongExecutions = [
        { output: queryInput, reason: "omits all three demonstrated gates" },
        ...firstOutputs.map((output) => ({ output, reason: "stops after the rotation gate" })),
        ...secondOutputs.map((output) => ({ output, reason: "stops before the duplication gate" })),
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

function ruleSwitching(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const gateA: SceneUnaryOperation = { kind: "reflect", axis: "horizontal" };
  const gateB: SceneUnaryOperation = { kind: "setFill", fill: "solid" };
  const inputA = scene([
    { row: 0, column: 0, object: token(shapes[0]) },
    { row: 2, column: 1, object: token(shapes[1], "solid") },
  ]);
  const outputA = applySceneUnary(inputA, gateA)!;
  const inputB = scene([
    { row: 0, column: 1, object: token(shapes[2]) },
    { row: 1, column: 0, object: token(shapes[3]) },
  ]);
  const outputB = applySceneUnary(inputB, gateB)!;
  const query = scene([
    { row: 0, column: 0, object: token(shapes[4]) },
    { row: 2, column: 1, object: token(shapes[0]) },
  ]);
  const answer = applySceneUnary(query, gateB)!;
  const reflected = applySceneUnary(query, gateA)!;
  const reflectedAndFilled = applySceneUnary(reflected, gateB)!;
  const puzzle = makePuzzle(
    "prototype-rule-switching",
    "matrix",
    "machineTable",
    "Each gate has a demonstrated rule. Apply only the gate shown in the query path.",
    5,
    [inputA, gateVisual("a"), outputA, inputB, gateVisual("b"), outputB, query, gateVisual("b"), { blank: true }],
    answer,
    [reflected, query, reflectedAndFilled],
    rng,
    "The worked rows define two separate gates. The outline triangle reflects every token from left to right; the solid square changes every token to solid without moving it. The query displays only the solid square gate, so both query tokens keep their positions and become solid. The distractors either use the triangle gate, use both gates, or ignore the selected gate.",
  );
  const family = definition(
    "rule-switching-v1",
    ["two-worked-gates", "query-gate-cue", "gate-identity"],
    JSON.stringify({ gateA, gateB, query: "b" }),
    (candidate) => {
      const [workedInputA, shownGateA, workedOutputA, workedInputB, shownGateB, workedOutputB, queryInput, queryGate] =
        candidate.stem.map(scenePanel);
      if (!workedInputA || !shownGateA || !workedOutputA || !workedInputB || !shownGateB ||
          !workedOutputB || !queryInput || !queryGate) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const symbolKey = (sceneValue: Scene) => sceneValue.objects[0] && JSON.stringify(sceneValue.objects[0].object);
      if (!symbolKey(shownGateB) || symbolKey(queryGate) !== symbolKey(shownGateB) || symbolKey(queryGate) === symbolKey(shownGateA)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const gateASurvivors = matchingUnaryOperations([{ input: workedInputA, output: workedOutputA }]);
      const gateBSurvivors = matchingUnaryOperations([{ input: workedInputB, output: workedOutputB }]);
      const predictions = distinctOutputs(gateBSurvivors.map((operation) => applySceneUnary(queryInput, operation)));
      const wrongExecutions = [
        { output: queryInput, reason: "omits the selected gate" },
        ...gateASurvivors.map((operation) => ({ output: applySceneUnary(queryInput, operation), reason: "uses the other gate" })),
        ...gateASurvivors.flatMap((firstOperation) => {
          const firstOutput = applySceneUnary(queryInput, firstOperation);
          return firstOutput ? gateBSurvivors.map((secondOperation) => ({
            output: applySceneUnary(firstOutput, secondOperation),
            reason: "applies both gates instead of the one shown",
          })) : [];
        }),
      ];
      return {
        derivedAnswer: gateASurvivors.length > 0 && predictions.length === 1 ? predictions[0] : null,
        solutionCount: gateASurvivors.length > 0 ? predictions.length : 0,
        usedCueIds: ["two-worked-gates", "query-gate-cue", "gate-identity"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output && sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
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

function conceptCandidate(
  rng: Rng,
  ruleKey: string,
  relationCue: string,
  positives: readonly Scene[],
  negatives: readonly Scene[],
  rawOptions: readonly [Scene, Scene, Scene, Scene],
  explanation: string,
): SceneFamilyCandidate {
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
    "concept-induction-v1",
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

function conceptInduction(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const variant = pick(rng, ["contains", "adjacent", "symmetry", "equal-row-counts"] as const);

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
      JSON.stringify({ concept: { all: [{ kind: "adjacent" }] } satisfies SceneConcept }),
      "adjacency-relation",
      positives,
      negatives,
      [
        scene([{ row: 1, column: 0, object: token(shapes[0]) }, { row: 1, column: 1, object: token(shapes[2], "solid") }]),
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
      JSON.stringify({ concept: { all: [{ kind: "symmetry", axis: "horizontal" }] } satisfies SceneConcept }),
      "symmetry-relation",
      positives,
      negatives,
      [
        mirrorPair(1, shapes[4]),
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
      JSON.stringify({ concept: { all: [{ kind: "count", comparison: "equal" }] } satisfies SceneConcept }),
      "row-count-relation",
      positives,
      negatives,
      [
        scene([
          { row: 0, column: 1, object: token(shapes[4]) },
          { row: 1, column: 2, object: token(shapes[0]) },
          { row: 2, column: 0, object: token(shapes[2], "solid") },
        ]),
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
    JSON.stringify({ concept: { all: [{ kind: "contains" }] } satisfies SceneConcept }),
    "containment-relation",
    positives,
    negatives,
    [
      contained(shapes[3], shapes[4], 2, 1),
      one(shapes[4], 2, 1),
      scene([{ row: 1, column: 0, object: token(shapes[0]) }, { row: 1, column: 1, object: token(shapes[1]) }]),
      scene([{ row: 0, column: 0, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[2]) }]),
    ],
    "The check-marked examples all show a true containment relationship: one outlined shape visibly encloses another token. None of the crossed examples contains a token, even when two shapes are near each other. The highlighted option includes an enclosing shape with a token inside it; the distractors show only separate, adjacent, or distant tokens.",
  );
}

function foldedPaper(shape: SceneToken["shape"], row: number): Scene {
  return {
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: [{ row, column: 0, object: token(shape, "solid") }],
    tiles: [],
    guides: [{ kind: "crease", axis: "vertical", direction: "rightToLeft" }],
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
  const result: Scene = { ...input, objects: [...unique.values()], tiles: [], guides: [] };
  return result.objects.length > input.objects.length ? result : null;
}

function unfoldVertical(input: Scene): Scene | null {
  return unfoldAcross(input, "vertical");
}

function foldPunch(rng: Rng): SceneFamilyCandidate {
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const first = foldedPaper(firstShape, 0);
  const unfolded = unfoldVertical(first)!;
  const query = foldedPaper(secondShape, 2);
  const answer = unfoldVertical(query)!;
  const horizontalInput: Scene = { ...query, guides: [{ kind: "crease", axis: "horizontal", direction: "topToBottom" }] };
  const wrongAxis = unfoldAcross(horizontalInput, "horizontal")!;
  const noUnfold: Scene = { ...query, guides: [] };
  const reflectedOnly = applySceneUnary(noUnfold, { kind: "reflect", axis: "horizontal" })!;
  const puzzle = makePuzzle(
    "prototype-fold-punch",
    "analogy",
    "analogy",
    "The centre line is a fold. Apply the same unfolding to the new punch.",
    4,
    [first, unfolded, query],
    answer,
    [wrongAxis, noUnfold, reflectedOnly],
    rng,
    "The first pair establishes what the dashed vertical crease means. Opening the folded paper preserves the original punch and creates its mirror at the same row on the opposite side of the crease. The query punch is on the lower left, so the open paper must show matching lower-left and lower-right punches. The other options use the wrong axis, move rather than copy the punch, or leave the paper folded.",
  );
  const family = definition(
    "fold-punch-v1",
    ["vertical-crease", "worked-unfold"],
    "unfold:vertical",
    (candidate) => {
      const [workedInput, workedOutput, queryInput] = candidate.stem.map(scenePanel);
      if (!workedInput || !workedOutput || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const axes = ["horizontal", "vertical"] as const;
      const survivors = axes.filter((axis) => {
        const predicted = unfoldAcross(workedInput, axis);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const predictions = distinctOutputs(survivors.map((axis) => unfoldAcross(queryInput, axis)));
      const withoutCrease: Scene = { ...queryInput, guides: [] };
      const wrongRules = [
        { output: withoutCrease, reason: "leaves the paper folded" },
        { output: applySceneUnary(withoutCrease, { kind: "reflect", axis: "horizontal" }), reason: "moves the punch instead of mirroring it" },
        ...axes.map((axis) => ({
          output: unfoldAcross({
            ...queryInput,
            guides: [{
              kind: "crease" as const,
              axis,
              direction: axis === "vertical" ? "rightToLeft" as const : "topToBottom" as const,
            }],
          }, axis),
          reason: `unfolds across the ${axis} crease`,
        })),
      ];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["vertical-crease", "worked-unfold"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongRules.find((rule) => rule.output && sceneSignature(rule.output) === sceneSignature(option) &&
            (!predictions[0] || sceneSignature(option) !== sceneSignature(predictions[0])))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function inverseFoldPunch(rng: Rng): SceneFamilyCandidate {
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const firstFolded = foldedPaper(firstShape, 0);
  const firstUnfolded = unfoldVertical(firstFolded)!;
  const answer = foldedPaper(secondShape, 2);
  const queryUnfolded = unfoldVertical(answer)!;
  const wrongRow = foldedPaper(secondShape, 0);
  const wrongSide: Scene = {
    ...answer,
    objects: [{ row: 2, column: 2, object: token(secondShape, "solid") }],
  };
  const wrongAxis: Scene = {
    ...answer,
    guides: [{ kind: "crease", axis: "horizontal", direction: "topToBottom" }],
  };
  const puzzle = makePuzzle(
    "prototype-inverse-fold-punch",
    "analogy",
    "analogy",
    "Use the fold arrow and worked pair. Which folded punch produces the third board?",
    5,
    [firstUnfolded, firstFolded, queryUnfolded],
    answer,
    [wrongRow, wrongSide, wrongAxis],
    rng,
    "Work backward from the open query board. Its two matching punches occupy the lower-left and lower-right positions, so they must overlap when the right half folds left across the vertical crease. That places one punch in the lower-left of the folded paper, with the arrow and crease matching the worked pair. The other options use the wrong row, wrong folded side, or wrong fold axis.",
  );
  const family = definition(
    "inverse-fold-punch-v1",
    ["worked-inverse-fold", "fold-direction", "mirrored-punches"],
    "inverse-unfold:visible-crease",
    (candidate) => {
      const [workedOutput, workedFolded, queryOutput] = candidate.stem.map(scenePanel);
      if (!workedOutput || !workedFolded || !queryOutput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const workedGuide = workedFolded.guides?.[0];
      const workedPrediction = workedGuide && unfoldAcross(workedFolded, workedGuide.axis);
      const workedFits = workedPrediction !== null && workedPrediction !== undefined &&
        sceneSignature(workedPrediction) === sceneSignature(workedOutput);
      const evaluated = candidate.options.map((option) => {
        const guide = option.guides?.[0];
        const output = guide ? unfoldAcross(option, guide.axis) : null;
        const matches = workedFits && output !== null && sceneSignature(output) === sceneSignature(queryOutput);
        return {
          option,
          matches,
          witness: !guide ? "has no visible fold direction" : output === null
            ? "places the punch outside the folded stack indicated by the arrow"
            : `unfolds to ${sceneSignature(output)}, not the shown pattern`,
        };
      });
      const valid = evaluated.filter((entry) => entry.matches);
      return {
        derivedAnswer: valid.length === 1 ? valid[0].option : null,
        solutionCount: valid.length,
        usedCueIds: ["worked-inverse-fold", "fold-direction", "mirrored-punches"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || evaluated[optionIndex].matches
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].witness }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function interleavedSequence(rng: Rng): SceneFamilyCandidate {
  const [a, b] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const strandA = [one(a, 0, 0), one(a, 0, 1), one(a, 0, 2)];
  const strandB = [one(b, 2, 2, "solid"), one(b, 2, 1, "solid"), one(b, 2, 0, "solid")];
  const answer = strandB[2];
  const puzzle = makePuzzle(
    "prototype-interleaved-sequence",
    "sequence",
    "row",
    "Two alternating scenes each follow their own movement. What comes next?",
    4,
    [strandA[0], strandB[0], strandA[1], strandB[1], strandA[2], { blank: true }],
    answer,
    [strandA[0], strandB[1], one(b, 1, 0, "solid")],
    rng,
    "Split the six positions into two alternating sequences. Panels 1, 3, and 5 show the outline token moving left-to-right across the top row. Panels 2, 4, and 6 form a separate sequence in which the solid token moves right-to-left across the bottom row. The missing sixth panel must therefore place the solid token in the bottom-left slot; the other choices continue the wrong strand, repeat a position, or move to the middle row.",
  );
  const family = definition(
    "interleaved-sequence-v1",
    ["alternating-slots", "two-movement-strands"],
    "interleave:A-right:B-left",
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      const [a0, b0, a1, b1, a2] = panels;
      if (!a0 || !b0 || !a1 || !b1 || !a2) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const strandASurvivors = matchingUnaryOperations([{ input: a0, output: a1 }, { input: a1, output: a2 }]);
      const strandBSurvivors = matchingUnaryOperations([{ input: b0, output: b1 }]);
      const predictions = distinctOutputs(strandBSurvivors.map((candidateOperation) => applySceneUnary(b1, candidateOperation)));
      const grammar = enumerateSceneUnaryOperations(b1.rows, b1.columns);
      const aShape = a0.objects[0]?.object.kind === "token" ? a0.objects[0].object.shape : null;
      return {
        derivedAnswer: strandASurvivors.length > 0 && predictions.length === 1 ? predictions[0] : null,
        solutionCount: strandASurvivors.length > 0 ? predictions.length : 0,
        usedCueIds: ["alternating-slots", "two-movement-strands"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (aShape && option.objects.some((placement) => placement.object.kind === "token" && placement.object.shape === aShape)) {
            return "continues the other alternating strand";
          }
          const failedRule = grammar.find((candidateOperation) => {
            const queryOutput = applySceneUnary(b1, candidateOperation);
            const workedOutput = applySceneUnary(b0, candidateOperation);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(b1));
          });
          return failedRule ? `${failedRule.kind} fails the shown movement of this strand` : null;
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
  startStep: number;
  stepDelta: number;
}

const RING_STEP_GRAMMAR: readonly RingStepRule[] = Array.from({ length: 7 }, (_, index) => index + 1)
  .flatMap((startStep) => [-2, -1, 0, 1, 2].map((stepDelta) => ({ startStep, stepDelta })));

function ringIndexes(rule: RingStepRule, length: number): number[] {
  const indexes = [0];
  for (let transition = 0; transition < length - 1; transition++) {
    const step = rule.startStep + transition * rule.stepDelta;
    indexes.push(((indexes[indexes.length - 1] + step) % RING_POSITIONS.length + RING_POSITIONS.length) % RING_POSITIONS.length);
  }
  return indexes;
}

function secondOrderSequence(rng: Rng): SceneFamilyCandidate {
  const [shape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const rule: RingStepRule = { startStep: 1, stepDelta: 1 };
  const indexes = ringIndexes(rule, 6);
  const atIndex = (index: number) => one(shape, RING_POSITIONS[index].row, RING_POSITIONS[index].column, "solid");
  const shown = indexes.slice(0, 5).map(atIndex);
  const answer = atIndex(indexes[5]);
  const competingByPrediction = new Map<number, RingStepRule>();
  for (const candidateRule of RING_STEP_GRAMMAR) {
    const candidateIndexes = ringIndexes(candidateRule, 6);
    const fits = candidateIndexes.slice(0, 5).every((index, position) => index === indexes[position]);
    const prediction = candidateIndexes[5];
    if (!fits && prediction !== indexes[5]) competingByPrediction.set(prediction, candidateRule);
  }
  const distractorIndexes = shuffled(rng, [...competingByPrediction.keys()]).slice(0, 3);
  if (distractorIndexes.length !== 3) throw new Error("second-order sequence needs three competing predictions");
  const puzzle = makePuzzle(
    "prototype-second-order-sequence",
    "sequence",
    "row",
    "The clockwise jump grows by one slot each time. Where does the token land next?",
    4,
    [...shown, { blank: true }],
    answer,
    distractorIndexes.map(atIndex),
    rng,
    "Read the eight outside slots as one clockwise ring. The token first advances one perimeter slot, then two, then three, then four: the jump itself grows by one each time. The next move is therefore five clockwise perimeter slots from the fifth panel, which lands at the highlighted position. Each distractor follows a different fixed or changing jump pattern that fails at least one shown landing.",
  );
  const family = definition(
    "second-order-sequence-v1",
    ["perimeter-order", "growing-jump-size"],
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
      const survivors = RING_STEP_GRAMMAR.filter((candidateRule) =>
        ringIndexes(candidateRule, observed.length).every((index, position) => index === observed[position]));
      const predictedIndexes = new Set(survivors.map((candidateRule) => ringIndexes(candidateRule, observed.length + 1).at(-1)!));
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
        usedCueIds: ["perimeter-order", "growing-jump-size"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const optionPlacement = option.objects[0];
          if (!optionPlacement || !firstObject || JSON.stringify(optionPlacement.object) !== JSON.stringify(firstObject)) return null;
          const optionIndex = RING_POSITIONS.findIndex((position) =>
            position.row === optionPlacement.row && position.column === optionPlacement.column);
          const failedRule = RING_STEP_GRAMMAR.find((candidateRule) => {
            const candidateIndexes = ringIndexes(candidateRule, observed.length + 1);
            return candidateIndexes.at(-1) === optionIndex &&
              !candidateIndexes.slice(0, observed.length).every((index, position) => index === observed[position]);
          });
          return failedRule ? `the ${failedRule.startStep}, ${failedRule.stepDelta >= 0 ? "+" : ""}${failedRule.stepDelta} jump rule fails a shown landing` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function inverseAnalogy(rng: Rng): SceneFamilyCandidate {
  const [a, b] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const operations: SceneUnaryOperation[] = [
    { kind: "translate", rowDelta: 0, columnDelta: 1, wrap: false },
    { kind: "translate", rowDelta: 0, columnDelta: -1, wrap: false },
    { kind: "reflect", axis: "horizontal" },
    { kind: "reflect", axis: "vertical" },
  ];
  const programs = operations.flatMap((first) => [
    [first],
    ...operations.map((second) => [first, second]),
  ]);
  const applyProgram = (input: Scene, program: readonly SceneUnaryOperation[]): Scene | null => {
    let output: Scene | null = input;
    for (const operation of program) output = output && applySceneUnary(output, operation);
    return output;
  };
  const forward = [operations[0], operations[2]];
  const originalA = one(a, 0, 1);
  const outputA = applyProgram(originalA, forward)!;
  const originalB = one(b, 0, 1, "solid");
  const outputB = applyProgram(originalB, forward)!;
  const puzzle = makePuzzle(
    "prototype-inverse-analogy",
    "analogy",
    "analogy",
    "The first pair undoes two changes. Which scene similarly precedes the third?",
    4,
    [outputA, originalA, outputB],
    originalB,
    [one(b, 0, 2, "solid"), outputB, one(b, 2, 1, "solid")],
    rng,
    "The first pair is shown in reverse order: the second board is the input that becomes the first after two operations. Those operations move the token one slot right and then reflect the board from left to right. Test each option as the missing input and apply both operations; only the highlighted option produces the third board exactly. The distractors begin in the wrong column, copy the output, or use the wrong row.",
  );
  const family = definition(
    "inverse-analogy-v1",
    ["inverse-worked-pair", "ordered-board-slots"],
    `inverse:${JSON.stringify(forward)}`,
    (candidate) => {
      const [workedOutput, workedInput, queryOutput] = candidate.stem.map(scenePanel);
      if (!workedOutput || !workedInput || !queryOutput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = programs.filter((program) => {
        const predicted = applyProgram(workedInput, program);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const selections = survivors.map((program) => candidate.options.flatMap((option, optionIndex) => {
        const predicted = applyProgram(option, program);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(queryOutput) ? [optionIndex] : [];
      }));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["inverse-worked-pair", "ordered-board-slots"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (survivors.length === 0) return null;
          const outputs = survivors.map((program) => applyProgram(option, program));
          return outputs.every((output) => output === null || sceneSignature(output) !== sceneSignature(queryOutput))
            ? "no program consistent with the worked pair maps this input to the shown output"
            : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function minimalRepair(rng: Rng): SceneFamilyCandidate {
  const [a, b, c] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const valid = scene([
    { row: 0, column: 0, object: token(a) },
    { row: 0, column: 1, object: token(b) },
    { row: 1, column: 0, object: token(b) },
    { row: 1, column: 1, object: token(a) },
  ], 2, 2);
  const faulty = scene([
    ...valid.objects.slice(0, 3),
    { row: 1, column: 1, object: token(c) },
  ], 2, 2);
  const alternatives = [
    valid,
    scene([...valid.objects.slice(0, 3), { row: 1, column: 1, object: token(b) }], 2, 2),
    scene([
      { row: 0, column: 0, object: token(c) },
      ...faulty.objects.slice(1),
    ], 2, 2),
    scene([
      ...faulty.objects.slice(0, 2),
      { row: 1, column: 0, object: token(a) },
      faulty.objects[3],
    ], 2, 2),
  ];
  const constraints: SceneConstraint[] = [
    { kind: "allDifferent", axis: "row", index: 0, projection: "shape" },
    { kind: "allDifferent", axis: "row", index: 1, projection: "shape" },
    { kind: "allDifferent", axis: "column", index: 0, projection: "shape" },
    { kind: "allDifferent", axis: "column", index: 1, projection: "shape" },
    { kind: "exactCount", projection: "shape", value: a, count: 2 },
    { kind: "exactCount", projection: "shape", value: b, count: 2 },
  ];
  const generatedValidIndexes = alternatives.flatMap((candidate, index) =>
    sceneConstraintFailures(candidate, constraints).length === 0 ? [index] : []);
  if (generatedValidIndexes.length !== 1 || generatedValidIndexes[0] !== 0) {
    throw new Error("minimal-repair fixture must have one valid replacement");
  }
  const order = shuffled(rng, alternatives.map((_, index) => index));
  const puzzle: Puzzle<Scene> = {
    id: "prototype-minimal-repair",
    type: "oddOneOut",
    layout: "singleScene",
    instruction: "Each option changes one tile. Which repair restores every row and column constraint?",
    difficulty: 5,
    stem: [faulty],
    options: order.map((index) => alternatives[index]),
    answerIndex: order.indexOf(0),
    explanation: `The faulty 2×2 board should alternate ${a} and ${b}, giving one of each shape in every row and every column. Only the lower-right token is wrong: replacing it with ${a} restores the alternating diagonal and produces exactly two ${a}s and two ${b}s overall. Each other proposed repair changes the wrong cell or leaves a repeated shape in at least one row or column.`,
  };
  const family = definition(
    "minimal-repair-v1",
    ["faulty-board", "one-change-options", "row-column-constraints"],
    JSON.stringify(constraints),
    (candidate) => {
      const faultyBoard = scenePanel(candidate.stem[0]);
      if (!faultyBoard) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const faultyByPosition = new Map(faultyBoard.objects.map((placement) => [
        `${placement.row}:${placement.column}`,
        JSON.stringify(placement.object),
      ]));
      const evaluated = candidate.options.map((option) => {
        const optionByPosition = new Map(option.objects.map((placement) => [
          `${placement.row}:${placement.column}`,
          JSON.stringify(placement.object),
        ]));
        const positions = new Set([...faultyByPosition.keys(), ...optionByPosition.keys()]);
        const changedPositions = [...positions].filter((position) =>
          faultyByPosition.get(position) !== optionByPosition.get(position));
        const failures = sceneConstraintFailures(option, constraints).map((failure) => failure.message);
        if (option.rows !== faultyBoard.rows || option.columns !== faultyBoard.columns || changedPositions.length !== 1) {
          failures.unshift(`changes ${changedPositions.length} tiles instead of exactly one`);
        }
        return { option, failures };
      });
      const validOptions = evaluated.filter((entry) => entry.failures.length === 0);
      return {
        derivedAnswer: validOptions.length === 1 ? validOptions[0].option : null,
        solutionCount: validOptions.length,
        usedCueIds: ["faulty-board", "one-change-options", "row-column-constraints"],
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
    case "relational-sequence-v1": return relationalSequence(rng);
    case "compositional-analogy-v1": return compositionalAnalogy(rng);
    case "containment-analogy-v1": return containmentAnalogy(rng);
    case "relational-outlier-v1": return relationalOutlier(rng);
    case "relational-matrix-v1": return relationalMatrix(rng);
    case "visual-set-algebra-v1": return setAlgebra(rng);
    case "constraint-mosaic-v1": return constraintMosaic(rng);
    case "topology-path-v1": return topologyPath(rng);
    case "spatial-transform-v1": return spatialTransform(rng);
    case "transformation-machine-v2": return transformationMachine(rng);
    case "rule-switching-v1": return ruleSwitching(rng);
    case "concept-induction-v1": return conceptInduction(rng);
    case "fold-punch-v1": return foldPunch(rng);
    case "inverse-fold-punch-v1": return inverseFoldPunch(rng);
    case "interleaved-sequence-v1": return interleavedSequence(rng);
    case "second-order-sequence-v1": return secondOrderSequence(rng);
    case "inverse-analogy-v1": return inverseAnalogy(rng);
    case "minimal-repair-v1": return minimalRepair(rng);
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
