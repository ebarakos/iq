import { seededRng } from "../lib/rng";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, type ExpandedProfileBand } from "./family-promotion";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import { toPublicPuzzle, type PublicPuzzle, type Scene } from "./schema";

export const PILOT_ITEMS_PER_FAMILY = 3;
const ITEM_ID_PATTERN = /^([a-z-]+-v\d+):r([1-3])$/;

export interface PrototypePilotQuestion {
  itemId: string;
  familyId: SceneFamilyId;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  puzzle: PublicPuzzle<Scene>;
}

function promotionFor(familyId: SceneFamilyId) {
  const family = CURRENT_FAMILY_PROMOTION_REGISTRY.find((entry) => entry.familyId === familyId);
  const band = family?.bands.find((entry) => entry.validatedDifficultyBuckets.length > 0);
  if (!band || band.validatedDifficultyBuckets.length !== 1) {
    throw new Error(`${familyId} needs exactly one code-valid pilot band and bucket`);
  }
  return { band: band.band, difficultyBucket: band.validatedDifficultyBuckets[0] };
}

export function prototypePilotCandidate(familyId: SceneFamilyId, representative: number) {
  if (!Number.isInteger(representative) || representative < 1 || representative > PILOT_ITEMS_PER_FAMILY) {
    throw new Error("pilot representative must be 1, 2, or 3");
  }
  const candidate = generateSceneFamilyCandidate(
    familyId,
    seededRng("scene-prototype-pilot-v1", `${familyId}:r${representative}`),
  );
  const acceptance = validateSceneFamilyCandidate(candidate);
  if (!acceptance.accepted) {
    throw new Error(`${familyId} representative ${representative} failed correctness acceptance`);
  }
  return candidate;
}

export function buildPrototypePilotQuestions(): PrototypePilotQuestion[] {
  return SCENE_FAMILY_IDS.flatMap((familyId) => {
    const promotion = promotionFor(familyId);
    return Array.from({ length: PILOT_ITEMS_PER_FAMILY }, (_, index) => {
      const representative = index + 1;
      const candidate = prototypePilotCandidate(familyId, representative);
      return {
        itemId: `${familyId}:r${representative}`,
        familyId,
        ...promotion,
        puzzle: toPublicPuzzle(candidate.puzzle),
      };
    });
  });
}

export function gradePrototypePilotAnswer(itemId: string, selectedOption: number): {
  correct: boolean;
  explanation: string;
} {
  const match = ITEM_ID_PATTERN.exec(itemId);
  if (!match || !(SCENE_FAMILY_IDS as readonly string[]).includes(match[1])) {
    throw new Error("unknown pilot item");
  }
  const familyId = match[1] as SceneFamilyId;
  const representative = Number(match[2]);
  const { puzzle } = prototypePilotCandidate(familyId, representative);
  if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= puzzle.options.length) {
    throw new Error("selected option is out of range");
  }
  return {
    correct: selectedOption === puzzle.answerIndex,
    explanation: puzzle.explanation,
  };
}
