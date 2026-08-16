import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import { VisualPuzzleSchema, sceneSignature } from "./schema";
import { puzzleToSvg } from "./compose-image";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
} from "./scene-families";

describe("scene family prototypes", () => {
  it("generates deterministic schema-valid candidates", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const first = generateSceneFamilyCandidate(familyId, seededRng(`scene:${familyId}:${seed}`));
        const replay = generateSceneFamilyCandidate(familyId, seededRng(`scene:${familyId}:${seed}`));
        expect(first.puzzle).toEqual(replay.puzzle);
        expect(first.definition.replayKey?.(first.puzzle)).toBe(replay.definition.replayKey?.(replay.puzzle));
        expect(VisualPuzzleSchema.safeParse(first.puzzle).success, familyId).toBe(true);
      }
    }
  });

  it("accepts each prototype through the shared correctness contract", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const candidate = generateSceneFamilyCandidate(familyId, seededRng(`accept:${familyId}:${seed}`));
        const first = validateSceneFamilyCandidate(candidate);
        expect(first.accepted, `${familyId} seed ${seed}: ${first.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
        const replayKey = candidate.definition.replayKey?.(candidate.puzzle);
        expect(replayKey).toBeTruthy();
        expect(validateSceneFamilyCandidate(candidate, replayKey).accepted).toBe(true);
      }
    }
  });

  it("keeps every option visually unique", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`unique:${familyId}`));
      expect(new Set(puzzle.options.map(sceneSignature)).size).toBe(puzzle.options.length);
    }
  });

  it("provides rich final-review explanations for every family", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`explanation:${familyId}`));
      const sentenceCount = puzzle.explanation.match(/[.!?](?:\s|$)/g)?.length ?? 0;
      expect(puzzle.explanation.length, familyId).toBeGreaterThanOrEqual(180);
      expect(sentenceCount, familyId).toBeGreaterThanOrEqual(3);
    }
  });

  it("re-solves visible evidence instead of trusting captured generator state", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const candidate = generateSceneFamilyCandidate(familyId, seededRng(`tamper:${familyId}`));
      const tampered = structuredClone(candidate.puzzle);
      const wrongIndex = tampered.options.findIndex((_, index) => index !== tampered.answerIndex);
      const visibleIndexes = tampered.stem.flatMap((panel, panelIndex) => "blank" in panel ? [] : [panelIndex]);
      if (familyId === "rule-switching-v1") {
        tampered.stem[5] = tampered.stem[3];
      } else if (tampered.layout === "conceptGroups") {
        tampered.stem[0] = tampered.options[wrongIndex];
      } else if (visibleIndexes.length >= 2) {
        tampered.stem[visibleIndexes[1]] = tampered.stem[visibleIndexes[0]];
      } else if (visibleIndexes.length === 1) {
        tampered.stem[visibleIndexes[0]] = tampered.options[tampered.answerIndex];
      } else {
        tampered.options[tampered.answerIndex] = tampered.options[wrongIndex];
      }

      const result = validateSceneFamilyCandidate({ ...candidate, puzzle: tampered });
      expect(result.accepted, `${familyId} accepted changed visible evidence`).toBe(false);
    }
  });

  it("renders every prototype through the same standalone image path used by agents", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`render:${familyId}`));
      const svg = puzzleToSvg(puzzle);
      expect(svg).toContain("<svg");
      expect(svg).toContain("data-scene-");
    }
  });

  it("samples all bounded concept relations and both spatial transform classes", () => {
    const conceptExplanations = new Set<string>();
    const spatialClasses = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const concept = generateSceneFamilyCandidate("concept-induction-v1", seededRng(`concept-variety:${seed}`));
      conceptExplanations.add(concept.puzzle.explanation);
      expect(validateSceneFamilyCandidate(concept).accepted).toBe(true);

      const spatial = generateSceneFamilyCandidate("spatial-transform-v1", seededRng(`spatial-variety:${seed}`));
      spatialClasses.add(spatial.puzzle.explanation.includes("rotates") ? "rotation" : "reflection");
      expect(validateSceneFamilyCandidate(spatial).accepted).toBe(true);
    }
    expect(conceptExplanations.size).toBe(4);
    expect(spatialClasses).toEqual(new Set(["rotation", "reflection"]));
  });
});
