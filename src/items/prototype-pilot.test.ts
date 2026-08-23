import { describe, expect, it } from "vitest";
import {
  PILOT_ITEMS_PER_FAMILY,
  PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
  PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET,
  PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
  buildPrototypePilotQuestions,
  buildPrototypePilotPackets,
  gradePrototypePilotAnswer,
  orderPrototypePilotPacket,
  prototypePilotAggregateFilename,
} from "./prototype-pilot";
import { SCENE_FAMILY_IDS, generateSceneFamilyCandidate } from "./scene-families";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { seededRng } from "../lib/rng";

describe("prototype pilot manifest", () => {
  it("serves three fixed answer-free representatives for every family", () => {
    const questions = buildPrototypePilotQuestions();
    // The gallery follows the registry: a family with no eligible band is
    // withdrawn and must not appear, however many are withdrawn at the time.
    const eligible = CURRENT_FAMILY_PROMOTION_REGISTRY
      .filter((family) => family.bands.some((band) => band.state !== "prototype" && band.validatedDifficultyBuckets.length > 0))
      .map((family) => family.familyId);
    expect(questions).toHaveLength(eligible.length * PILOT_ITEMS_PER_FAMILY);
    expect(new Set(questions.map((question) => question.itemId)).size).toBe(questions.length);
    for (const familyId of SCENE_FAMILY_IDS) {
      const expected = eligible.includes(familyId) ? PILOT_ITEMS_PER_FAMILY : 0;
      expect(questions.filter((question) => question.familyId === familyId), familyId).toHaveLength(expected);
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

  it("splits every fixed representative into stable, balanced moderator packets", () => {
    const packets = buildPrototypePilotPackets();
    const questions = buildPrototypePilotQuestions();

    // Derived, not hardcoded: the packet count follows the battery size, which
    // shrinks whenever the human gate withdraws a family.
    const expectedCount = Math.ceil(questions.length / PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET);
    expect(packets.map((packet) => packet.packetId)).toEqual(
      Array.from({ length: expectedCount }, (_, index) => `pilot-v2-${String.fromCharCode(97 + index)}`),
    );
    expect(packets.flatMap((packet) => packet.items).map((item) => item.itemId).sort())
      .toEqual(questions.map((item) => item.itemId).sort());
    expect(Math.max(...packets.map((packet) => packet.items.length))).toBeLessThanOrEqual(
      PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET,
    );
    expect(Math.max(...packets.map((packet) => packet.items.length)) - Math.min(...packets.map((packet) => packet.items.length)))
      .toBeLessThanOrEqual(1);
    for (const packet of packets) {
      expect(new Set(packet.items.map((item) => item.familyId)).size).toBe(packet.items.length);
    }
  });

  it("uses the moderator session label to rotate a packet reproducibly", () => {
    const packet = buildPrototypePilotPackets()[0];
    const first = orderPrototypePilotPacket(packet, "participant-01");
    expect(orderPrototypePilotPacket(packet, "participant-01").map((item) => item.itemId))
      .toEqual(first.map((item) => item.itemId));
    expect(orderPrototypePilotPacket(packet, "participant-02").map((item) => item.itemId))
      .not.toEqual(first.map((item) => item.itemId));
    expect(() => orderPrototypePilotPacket(packet, " ")).toThrow(/session label/);
  });

  it("uses a versioned aggregate envelope and packet-specific export filename", () => {
    expect(PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION).toBe("prototype-pilot-aggregate-v1");
    expect(PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION).toBe("prototype-pilot-packets-v2");
    expect(prototypePilotAggregateFilename("pilot-v2-b")).toBe("aiq-prototype-pilot-v2-b.json");
    expect(() => prototypePilotAggregateFilename("pilot-v2-z")).toThrow(/unknown/);
    // A packet name from the previous, longer pilot must not resolve — its
    // packets held different items, and a result filed under it is not comparable.
    expect(() => prototypePilotAggregateFilename("pilot-v1-a")).toThrow(/unknown/);
  });
});
