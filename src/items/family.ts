import { isInstantlyDistinct, visualSignature } from "./domains";
import {
  areScenesCategoricallyDistinct,
  isCell,
  isScene,
  sceneSignature,
  VisualPuzzleSchema,
  type Puzzle,
  type Visual,
} from "./schema";

/** A concrete reason one option fails a family's rule or constraint system. */
export interface DistractorWitness<Witness = unknown> {
  optionIndex: number;
  witness: Witness;
}

/**
 * Result of a family's complete, pure-code solver.
 *
 * `solutionCount` is the number of distinct answers predicted by every rule
 * that survives the declared complete grammar, or the number of valid
 * completions for a constraint family. Multiple equivalent rules may survive;
 * they are safe only when they all predict the same visible answer.
 */
export interface ValidationReport<V extends Visual = Visual, Witness = unknown> {
  derivedAnswer: V | null;
  solutionCount: number;
  usedCueIds: readonly string[];
  distractorWitnesses: readonly DistractorWitness<Witness>[];
}

/**
 * The common registry entry for a generated puzzle family.
 *
 * Family implementations own their bounded solver and the names of visible
 * cues. The shared gate owns all cross-family acceptance invariants.
 */
export interface FamilyDefinition<V extends Visual = Visual, Witness = unknown> {
  readonly familyId: string;
  isVisual(visual: Visual): visual is V;
  visibleCueIds(puzzle: Puzzle<V>): readonly string[];
  validate(puzzle: Puzzle<V>): ValidationReport<V, Witness>;
  /** Canonical hidden-program identity, independent of the sampled visual surface. */
  programFingerprint?(puzzle: Puzzle<V>): string;
  /** Canonical hidden-and-visible identity used when a caller checks replay. */
  replayKey?(puzzle: Puzzle<V>): string;
}

/** A registry is homogeneous at its boundary; individual families may narrow internally. */
export type FamilyRegistry<V extends Visual = Visual, Witness = unknown> = ReadonlyMap<
  string,
  FamilyDefinition<V, Witness>
>;

/** Build a lookup registry while rejecting ambiguous family identities. */
export function defineFamilyRegistry<V extends Visual, Witness>(
  definitions: readonly FamilyDefinition<V, Witness>[],
): FamilyRegistry<V, Witness> {
  const registry = new Map<string, FamilyDefinition<V, Witness>>();
  for (const definition of definitions) {
    if (definition.familyId.trim().length === 0) {
      throw new Error("familyId must not be empty");
    }
    if (registry.has(definition.familyId)) {
      throw new Error(`duplicate familyId: ${definition.familyId}`);
    }
    registry.set(definition.familyId, definition);
  }
  return registry;
}

export type AcceptanceIssueCode =
  | "schema"
  | "visual-vocabulary"
  | "solution-count"
  | "derived-answer"
  | "option-distinction"
  | "cue-id"
  | "unused-cue"
  | "unknown-used-cue"
  | "distractor-witness"
  | "replay-key";

export interface AcceptanceIssue {
  code: AcceptanceIssueCode;
  message: string;
}

export interface AcceptanceOptions {
  /** The key from a prior generation of the same versioned seed. */
  expectedReplayKey?: string;
}

export interface AcceptanceResult<V extends Visual = Visual, Witness = unknown> {
  accepted: boolean;
  issues: readonly AcceptanceIssue[];
  /** Present once the shared runtime schema and family vocabulary both pass. */
  puzzle?: Puzzle<V>;
  /** Present once the family's validator has run. */
  report?: ValidationReport<V, Witness>;
  replayKey?: string;
}

function visualsAreCategoricallyDistinct(left: Visual, right: Visual): boolean {
  if (isCell(left) && isCell(right)) return isInstantlyDistinct(left, right);
  if (isScene(left) && isScene(right)) return areScenesCategoricallyDistinct(left, right);
  return true;
}

function sameVisual(left: Visual, right: Visual): boolean {
  if (isCell(left) && isCell(right)) return visualSignature(left) === visualSignature(right);
  if (isScene(left) && isScene(right)) return sceneSignature(left) === sceneSignature(right);
  return false;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Apply the invariants shared by every generated family.
 *
 * The function is deterministic and has no generator or storage dependency.
 * A rejected candidate is returned with concrete issues instead of throwing;
 * programmer errors inside a family validator still surface normally.
 */
export function acceptFamilyCandidate<V extends Visual, Witness>(
  definition: FamilyDefinition<V, Witness>,
  candidate: unknown,
  options: AcceptanceOptions = {},
): AcceptanceResult<V, Witness> {
  const parsed = VisualPuzzleSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      accepted: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema" as const,
        message: issue.message,
      })),
    };
  }

  const parsedPuzzle = parsed.data;
  const visuals = [
    ...parsedPuzzle.stem.flatMap((panel) => "blank" in panel ? [] : [panel]),
    ...parsedPuzzle.options,
  ];
  const wrongVocabulary = visuals.findIndex((visual) => !definition.isVisual(visual));
  if (wrongVocabulary !== -1) {
    return {
      accepted: false,
      issues: [{
        code: "visual-vocabulary",
        message: `${definition.familyId} does not accept every visual used by the puzzle`,
      }],
    };
  }

  const puzzle = parsedPuzzle as Puzzle<V>;
  const report = definition.validate(puzzle);
  const issues: AcceptanceIssue[] = [];

  if (!Number.isInteger(report.solutionCount) || report.solutionCount !== 1) {
    issues.push({
      code: "solution-count",
      message: `expected exactly one predicted answer or valid solution, found ${report.solutionCount}`,
    });
  }

  const derivedMatches = report.derivedAnswer === null
    ? []
    : puzzle.options.flatMap((option, index) => sameVisual(option, report.derivedAnswer!) ? [index] : []);
  if (derivedMatches.length !== 1) {
    issues.push({
      code: "derived-answer",
      message: `derived answer must match exactly one option, matched ${derivedMatches.length}`,
    });
  } else if (derivedMatches[0] !== puzzle.answerIndex) {
    issues.push({
      code: "derived-answer",
      message: `derived answer is option ${derivedMatches[0]}, but answerIndex is ${puzzle.answerIndex}`,
    });
  }

  for (let left = 0; left < puzzle.options.length; left++) {
    for (let right = left + 1; right < puzzle.options.length; right++) {
      if (!visualsAreCategoricallyDistinct(puzzle.options[left], puzzle.options[right])) {
        issues.push({
          code: "option-distinction",
          message: `options ${left} and ${right} are not categorically distinct`,
        });
      }
    }
  }

  const visibleCueIds = definition.visibleCueIds(puzzle);
  for (const duplicate of duplicateValues(visibleCueIds)) {
    issues.push({ code: "cue-id", message: `visible cue id is duplicated: ${duplicate}` });
  }
  for (const duplicate of duplicateValues(report.usedCueIds)) {
    issues.push({ code: "cue-id", message: `used cue id is duplicated: ${duplicate}` });
  }
  const visibleCues = new Set(visibleCueIds);
  const usedCues = new Set(report.usedCueIds);
  for (const cueId of visibleCues) {
    if (!usedCues.has(cueId)) {
      issues.push({ code: "unused-cue", message: `visible cue is not used by the solution: ${cueId}` });
    }
  }
  for (const cueId of usedCues) {
    if (!visibleCues.has(cueId)) {
      issues.push({ code: "unknown-used-cue", message: `solver used an undeclared visible cue: ${cueId}` });
    }
  }

  const answerIndex = derivedMatches.length === 1 ? derivedMatches[0] : puzzle.answerIndex;
  const expectedDistractors = new Set(
    puzzle.options.flatMap((_, index) => index === answerIndex ? [] : [index]),
  );
  const witnessCounts = new Map<number, number>();
  for (const entry of report.distractorWitnesses) {
    witnessCounts.set(entry.optionIndex, (witnessCounts.get(entry.optionIndex) ?? 0) + 1);
    if (entry.witness === null || entry.witness === undefined) {
      issues.push({
        code: "distractor-witness",
        message: `option ${entry.optionIndex} has an empty distractor witness`,
      });
    }
  }
  for (const index of expectedDistractors) {
    const count = witnessCounts.get(index) ?? 0;
    if (count !== 1) {
      issues.push({
        code: "distractor-witness",
        message: `wrong option ${index} needs exactly one witness, found ${count}`,
      });
    }
  }
  for (const [index] of witnessCounts) {
    if (!expectedDistractors.has(index)) {
      issues.push({
        code: "distractor-witness",
        message: `option ${index} is not a wrong option for this candidate`,
      });
    }
  }

  let replayKey: string | undefined;
  if (options.expectedReplayKey !== undefined) {
    replayKey = definition.replayKey?.(puzzle);
    if (replayKey === undefined) {
      issues.push({
        code: "replay-key",
        message: `${definition.familyId} cannot check replay equality because it has no replayKey function`,
      });
    } else if (replayKey !== options.expectedReplayKey) {
      issues.push({ code: "replay-key", message: "generated puzzle does not match the expected replay key" });
    }
  }

  return {
    accepted: issues.length === 0,
    issues,
    puzzle,
    report,
    ...(replayKey === undefined ? {} : { replayKey }),
  };
}
