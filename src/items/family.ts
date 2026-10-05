import {
  areScenesCategoricallyDistinct,
  sceneSignature,
  PuzzleSchema,
  type Puzzle,
  type Scene,
} from "./schema";

/** A concrete reason one option fails a family's rule or constraint system. */
export interface DistractorWitness {
  optionIndex: number;
  witness: string;
}

/**
 * Result of a family's complete, pure-code solver.
 *
 * `solutionCount` is the number of distinct answers predicted by every rule
 * that survives the declared complete grammar, or the number of valid
 * completions for a constraint family. Multiple equivalent rules may survive;
 * they are safe only when they all predict the same visible answer.
 */
export interface ValidationReport {
  derivedAnswer: Scene | null;
  solutionCount: number;
  usedCueIds: readonly string[];
  distractorWitnesses: readonly DistractorWitness[];
}

/**
 * The common registry entry for a generated puzzle family.
 *
 * Family implementations own their bounded solver and the names of visible
 * cues. The shared gate owns all cross-family acceptance invariants.
 */
export interface FamilyDefinition {
  readonly familyId: string;
  visibleCueIds(puzzle: Puzzle): readonly string[];
  validate(puzzle: Puzzle): ValidationReport;
  /** Canonical hidden-program identity, independent of the sampled visual surface. */
  programFingerprint?(puzzle: Puzzle): string;
  /** Canonical hidden-and-visible identity used when a caller checks replay. */
  replayKey?(puzzle: Puzzle): string;
}

export type AcceptanceIssueCode =
  | "schema"
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

export interface AcceptanceResult {
  accepted: boolean;
  issues: readonly AcceptanceIssue[];
  /** Present once the shared runtime schema passes. */
  puzzle?: Puzzle;
  /** Present once the family's validator has run. */
  report?: ValidationReport;
  replayKey?: string;
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
export function acceptFamilyCandidate(
  definition: FamilyDefinition,
  candidate: unknown,
  options: AcceptanceOptions = {},
): AcceptanceResult {
  const parsed = PuzzleSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      accepted: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema" as const,
        message: issue.message,
      })),
    };
  }

  const puzzle = parsed.data;
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
    : puzzle.options.flatMap((option, index) =>
      sceneSignature(option) === sceneSignature(report.derivedAnswer!) ? [index] : []);
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
      if (!areScenesCategoricallyDistinct(puzzle.options[left], puzzle.options[right])) {
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
