import { createHash } from "node:crypto";
import { seededRng, shuffled } from "../lib/rng";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, type ExpandedProfileBand } from "./family-promotion";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import { toPublicPuzzle, type PublicPuzzle, type Scene } from "./schema";

/**
 * How many items each family contributes to the pilot.
 *
 * Lowered from three to one on 2026-08-23 at the user's request: the whole
 * battery was 45 items over six sittings, which is more than a person will
 * actually sit through. One per family covers every family in two sittings.
 *
 * What that costs: a family is now judged on a single draw, so an unlucky
 * instance can condemn a sound family and a lucky one can hide a weak family's
 * variance. That is an acceptable trade while the pilot's job is the retention
 * gate — spotting formats nobody can read, which one item shows plainly — and
 * not difficulty calibration, which needs several items per family.
 */
export const PILOT_ITEMS_PER_FAMILY = 1;
export const PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION = "prototype-pilot-packets-v2";
export const PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION = "prototype-pilot-aggregate-v1";
export const PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET = 10;
const ITEM_ID_PATTERN = new RegExp(`^([a-z-]+-v\\d+):r([1-${PILOT_ITEMS_PER_FAMILY}])$`);
const PACKET_ID_PATTERN = /^pilot-v2-[a-f]$/;

export interface PrototypePilotQuestion {
  itemId: string;
  familyId: SceneFamilyId;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  puzzle: PublicPuzzle<Scene>;
}

export interface PrototypePilotPacket {
  /** Stable assignment name for moderator scheduling and aggregate exports. */
  packetId: string;
  schemaVersion: typeof PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION;
  /** Hash of this packet's exact membership and visible content. */
  contentFingerprint: string;
  items: readonly PrototypePilotQuestion[];
}

function promotionFor(familyId: SceneFamilyId) {
  const family = CURRENT_FAMILY_PROMOTION_REGISTRY.find((entry) => entry.familyId === familyId);
  // A family with no bands has been withdrawn by the human gate; there is
  // nothing to pilot until a redesign gives it an eligible band again.
  if (family && family.bands.length === 0) return null;
  const band = family?.bands.find((entry) => entry.validatedDifficultyBuckets.length > 0);
  if (!band || band.validatedDifficultyBuckets.length !== 1) {
    throw new Error(`${familyId} needs exactly one code-valid pilot band and bucket`);
  }
  return { band: band.band, difficultyBucket: band.validatedDifficultyBuckets[0] };
}

export function prototypePilotCandidate(familyId: SceneFamilyId, representative: number) {
  if (!Number.isInteger(representative) || representative < 1 || representative > PILOT_ITEMS_PER_FAMILY) {
    throw new Error(`pilot representative must be between 1 and ${PILOT_ITEMS_PER_FAMILY}`);
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
    if (!promotion) return [];
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

/**
 * The fewest near-equal packets that cover every eligible representative once.
 *
 * When a family contributes more than one representative, the staggered
 * assignment spreads them across different packets. It also gives every packet a
 * spread of the family list without turning the moderator's packet label into a
 * participant record.
 */
export function buildPrototypePilotPackets(): PrototypePilotPacket[] {
  const questions = buildPrototypePilotQuestions();
  // As few packets as will hold the battery. A fixed six left two or three
  // items per sitting once the pilot shrank, which wastes a whole sitting.
  const packetCount = Math.max(1, Math.ceil(questions.length / PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET));
  const packetItems = Array.from({ length: packetCount }, () => [] as PrototypePilotQuestion[]);
  const familyIndex = new Map(
    [...new Set(questions.map((question) => question.familyId))].map((familyId, index) => [familyId, index]),
  );

  for (const question of questions) {
    const index = familyIndex.get(question.familyId);
    if (index === undefined) throw new Error(`pilot family ${question.familyId} is missing from the assignment`);
    const representative = Number(question.itemId.split(":r")[1]);
    const packetIndex = (index + (representative - 1) * 2) % packetItems.length;
    packetItems[packetIndex].push(question);
  }

  return packetItems.map((items, index) => {
    if (items.length > PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET) {
      throw new Error(`pilot packet ${index + 1} exceeds ${PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET} items`);
    }
    return {
      packetId: `pilot-v2-${String.fromCharCode(97 + index)}`,
      schemaVersion: PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
      contentFingerprint: prototypePilotPacketFingerprint(items),
      items,
    };
  });
}

/**
 * Identity of what a packet actually contains, not just what it is called.
 *
 * A packet id is stable by construction, but its membership is derived from the
 * current family list — so `pilot-v1-a` run before and after a family change is
 * two different packets wearing one name. Recording this hash with a result
 * makes that detectable instead of silently pooling two populations.
 */
export function prototypePilotPacketFingerprint(
  items: readonly PrototypePilotQuestion[],
): string {
  const canonical = items.map((item) => ({
    itemId: item.itemId,
    familyId: item.familyId,
    band: item.band,
    difficultyBucket: item.difficultyBucket,
    puzzle: item.puzzle,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

export function findPrototypePilotPacket(packetId: string): PrototypePilotPacket | undefined {
  return buildPrototypePilotPackets().find((packet) => packet.packetId === packetId);
}

export function prototypePilotAggregateFilename(packetId: string): string {
  if (!PACKET_ID_PATTERN.test(packetId)) throw new Error("unknown pilot packet");
  return `aiq-prototype-${packetId}.json`;
}

/**
 * Order is reproducible for a moderator's session label but changes between
 * labels, so repeated sessions do not always encounter families in one order.
 */
export function orderPrototypePilotPacket(
  packet: PrototypePilotPacket,
  sessionLabel: string,
): PrototypePilotQuestion[] {
  const normalizedLabel = sessionLabel.trim();
  if (!normalizedLabel || normalizedLabel.length > 80) {
    throw new Error("pilot session label must contain 1 to 80 characters");
  }
  return shuffled(
    seededRng(PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION, `${packet.packetId}:${normalizedLabel}`),
    packet.items,
  );
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
