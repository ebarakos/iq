import { describe, expect, it, vi } from "vitest";
import {
  acceptFamilyCandidate,
  defineFamilyRegistry,
  type FamilyDefinition,
  type ValidationReport,
} from "./family";
import { isCell, type Cell, type Puzzle, type Visual } from "./schema";

function cell(count: number, fill: Cell["fill"] = "solid"): Cell {
  return { shape: "square", count, rotation: 0, fill, size: "s" };
}

const puzzle: Puzzle = {
  id: "family-contract-fixture",
  type: "sequence",
  instruction: "Choose the next panel.",
  difficulty: 1,
  layout: "row",
  stem: [cell(1), cell(2), cell(3), { blank: true }],
  options: [cell(4), cell(1, "outline"), cell(2, "half"), cell(3, "outline")],
  answerIndex: 0,
  explanation: "The count increases by one.",
};

function report(overrides: Partial<ValidationReport<Cell, string>> = {}): ValidationReport<Cell, string> {
  return {
    derivedAnswer: puzzle.options[0],
    solutionCount: 1,
    usedCueIds: ["count-step"],
    distractorWitnesses: [
      { optionIndex: 1, witness: "count restarted" },
      { optionIndex: 2, witness: "fill changed" },
      { optionIndex: 3, witness: "count did not advance" },
    ],
    ...overrides,
  };
}

function family(
  validate: FamilyDefinition<Cell, string>["validate"] = () => report(),
): FamilyDefinition<Cell, string> {
  return {
    familyId: "sequence-test-v1",
    isVisual: isCell,
    visibleCueIds: () => ["count-step"],
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
      visibleCueIds: () => ["count-step", "decorative-arrow"],
      validate: () => report({
        usedCueIds: ["count-step", "hidden-cue"],
        distractorWitnesses: [
          { optionIndex: 1, witness: "count restarted" },
          { optionIndex: 3, witness: "count did not advance" },
        ],
      }),
    } satisfies FamilyDefinition<Cell, string>;

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

describe("defineFamilyRegistry", () => {
  it("indexes family definitions and rejects duplicate ids", () => {
    const definition = family();
    const registry = defineFamilyRegistry([definition]);
    expect(registry.get(definition.familyId)).toBe(definition);
    expect(() => defineFamilyRegistry([definition, definition])).toThrow("duplicate familyId");
  });

  it("supports a visual-wide registry contract", () => {
    const definition: FamilyDefinition<Visual, string> = {
      familyId: "visual-wide-v1",
      isVisual: (visual): visual is Visual => isCell(visual),
      visibleCueIds: () => [],
      validate: (candidate) => ({
        derivedAnswer: candidate.options[0],
        solutionCount: 1,
        usedCueIds: [],
        distractorWitnesses: candidate.options.slice(1).map((_, index) => ({
          optionIndex: index + 1,
          witness: "fails",
        })),
      }),
    };
    expect(defineFamilyRegistry([definition]).has("visual-wide-v1")).toBe(true);
  });
});
