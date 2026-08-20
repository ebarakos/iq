import { describe, expect, it } from "vitest";
import {
  PILOT_ITEMS_PER_FAMILY,
  PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
  PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET,
  buildPrototypePilotQuestions,
  buildPrototypePilotPackets,
  gradePrototypePilotAnswer,
  orderPrototypePilotPacket,
  prototypePilotAggregateFilename,
} from "./prototype-pilot";
import { SCENE_FAMILY_IDS, generateSceneFamilyCandidate } from "./scene-families";
import { seededRng } from "../lib/rng";

describe("prototype pilot manifest", () => {
  it("serves three fixed answer-free representatives for every family", () => {
    const questions = buildPrototypePilotQuestions();
    // topology-path-v1 is withdrawn (no eligible band), so the gallery skips it.
    expect(questions).toHaveLength((SCENE_FAMILY_IDS.length - 1) * PILOT_ITEMS_PER_FAMILY);
    expect(questions.some((question) => question.familyId === "topology-path-v1")).toBe(false);
    expect(new Set(questions.map((question) => question.itemId)).size).toBe(questions.length);
    for (const familyId of SCENE_FAMILY_IDS) {
      if (familyId === "topology-path-v1") continue;
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

  it("splits every fixed representative into stable, balanced moderator packets", () => {
    const packets = buildPrototypePilotPackets();
    const questions = buildPrototypePilotQuestions();

    expect(packets.map((packet) => packet.packetId)).toEqual([
      "pilot-v1-a",
      "pilot-v1-b",
      "pilot-v1-c",
      "pilot-v1-d",
      "pilot-v1-e",
      "pilot-v1-f",
    ]);
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
    expect(prototypePilotAggregateFilename("pilot-v1-c")).toBe("aiq-prototype-pilot-v1-c.json");
    expect(() => prototypePilotAggregateFilename("pilot-v1-z")).toThrow(/unknown/);
  });
});
