import { describe, expect, it } from "vitest";
import {
  PILOT_ITEMS_PER_FAMILY,
  buildPrototypePilotQuestions,
  gradePrototypePilotAnswer,
} from "./prototype-pilot";
import { SCENE_FAMILY_IDS, generateSceneFamilyCandidate } from "./scene-families";
import { seededRng } from "../lib/rng";

describe("prototype pilot manifest", () => {
  it("serves three fixed answer-free representatives for every family", () => {
    const questions = buildPrototypePilotQuestions();
    expect(questions).toHaveLength(SCENE_FAMILY_IDS.length * PILOT_ITEMS_PER_FAMILY);
    expect(new Set(questions.map((question) => question.itemId)).size).toBe(questions.length);
    for (const familyId of SCENE_FAMILY_IDS) {
      expect(questions.filter((question) => question.familyId === familyId)).toHaveLength(3);
    }
    for (const question of questions) {
      expect(question.puzzle).not.toHaveProperty("answerIndex");
      expect(question.puzzle).not.toHaveProperty("explanation");
      expect(question.puzzle.familyId).toBe(question.familyId);
    }
  });

  it("scores by rebuilding the fixed candidate on the server", () => {
    const familyId = SCENE_FAMILY_IDS[0];
    const candidate = generateSceneFamilyCandidate(
      familyId,
      seededRng("scene-prototype-pilot-v1", `${familyId}:r1`),
    );
    expect(gradePrototypePilotAnswer(`${familyId}:r1`, candidate.puzzle.answerIndex).correct).toBe(true);
    expect(() => gradePrototypePilotAnswer("unknown:r1", 0)).toThrow(/unknown/);
    expect(() => gradePrototypePilotAnswer(`${familyId}:r1`, 99)).toThrow(/range/);
  });
});
