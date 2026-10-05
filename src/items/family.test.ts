import { describe, expect, it, vi } from "vitest";
import {
  acceptFamilyCandidate,
  type FamilyDefinition,
  type ValidationReport,
} from "./family";
import type { Puzzle, Scene, SceneToken } from "./schema";

/** A 2×2 board holding one large circle. */
function board(row: number, column: number, fill: SceneToken["fill"] = "solid"): Scene {
  return {
    kind: "scene",
    rows: 2,
    columns: 2,
    objects: [{ row, column, object: { kind: "token", shape: "circle", rotation: 0, fill, size: "l" } }],
    tiles: [],
  };
}

const puzzle: Puzzle = {
  id: "family-contract-fixture",
  type: "sequence",
  instruction: "Choose the next panel.",
  difficulty: 1,
  layout: "row",
  stem: [board(0, 0), board(0, 1), board(1, 1), { blank: true }],
  options: [board(1, 0), board(0, 0, "outline"), board(0, 1, "half"), board(1, 1, "outline")],
  answerIndex: 0,
  explanation: "The circle walks round the board.",
};

function report(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    derivedAnswer: puzzle.options[0],
    solutionCount: 1,
    usedCueIds: ["walk-step"],
    distractorWitnesses: [
      { optionIndex: 1, witness: "walk restarted" },
      { optionIndex: 2, witness: "fill changed" },
      { optionIndex: 3, witness: "circle did not move" },
    ],
    ...overrides,
  };
}

function family(
  validate: FamilyDefinition["validate"] = () => report(),
): FamilyDefinition {
  return {
    familyId: "sequence-test-v1",
    visibleCueIds: () => ["walk-step"],
    validate,
    replayKey: (candidate) => JSON.stringify(candidate),
  };
}

describe("acceptFamilyCandidate", () => {
  it("accepts a schema-valid, unique, fully witnessed replay", () => {
    const expectedReplayKey = JSON.stringify(puzzle);
    const result = acceptFamilyCandidate(family(), puzzle, { expectedReplayKey });

    expect(result.accepted).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.report).toEqual(report());
    expect(result.replayKey).toBe(expectedReplayKey);
  });

  it("rejects schema-invalid candidates before running the family solver", () => {
    const validate = vi.fn(() => report());
    const result = acceptFamilyCandidate(family(validate), { ...puzzle, answerIndex: 99 });

    expect(result.accepted).toBe(false);
    expect(result.issues.some((issue) => issue.code === "schema")).toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });

  it("requires one solution and a mechanically derived answer", () => {
    const result = acceptFamilyCandidate(family(() => report({
      derivedAnswer: puzzle.options[1],
      solutionCount: 2,
    })), puzzle);

    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "solution-count",
      "derived-answer",
    ]));
  });

  it("rejects unused or undeclared cues and incomplete distractor evidence", () => {
    const definition = {
      ...family(),
      visibleCueIds: () => ["walk-step", "decorative-arrow"],
      validate: () => report({
        usedCueIds: ["walk-step", "hidden-cue"],
        distractorWitnesses: [
          { optionIndex: 1, witness: "walk restarted" },
          { optionIndex: 3, witness: "circle did not move" },
        ],
      }),
    } satisfies FamilyDefinition;

    const result = acceptFamilyCandidate(definition, puzzle);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "unused-cue",
      "unknown-used-cue",
      "distractor-witness",
    ]));
  });

  it("requires exactly one non-empty witness for each wrong option", () => {
    const result = acceptFamilyCandidate(family(() => report({
      distractorWitnesses: [
        { optionIndex: 1, witness: "first" },
        { optionIndex: 1, witness: "duplicate" },
        { optionIndex: 2, witness: "" },
        { optionIndex: 0, witness: "answer is not a distractor" },
      ],
    })), puzzle);

    expect(result.accepted).toBe(false);
    expect(result.issues.filter((issue) => issue.code === "distractor-witness").length).toBeGreaterThanOrEqual(3);
  });

  it("checks replay equality only when the caller supplies an expected key", () => {
    expect(acceptFamilyCandidate(family(), puzzle).accepted).toBe(true);

    const mismatch = acceptFamilyCandidate(family(), puzzle, { expectedReplayKey: "another item" });
    expect(mismatch.issues).toContainEqual(expect.objectContaining({ code: "replay-key" }));

    const noReplay = { ...family() };
    delete noReplay.replayKey;
    expect(acceptFamilyCandidate(noReplay, puzzle, { expectedReplayKey: "key" }).issues)
      .toContainEqual(expect.objectContaining({ code: "replay-key" }));
  });
});
