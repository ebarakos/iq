import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESCALATION_MAXIMUM_MEDIAN_HEADROOM_SECONDS,
  ESCALATION_MINIMUM_CLEAN_MISSES,
  PILOT_ITEMS_PER_KEY,
  PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
  PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET,
  PROTOTYPE_PILOT_MAX_SITTINGS,
  PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
  PROTOTYPE_PILOT_SITTING_TTL_MS,
  PROTOTYPE_PILOT_TIME_BIN_SECONDS,
  PrototypePilotAggregateSchema,
  PrototypePilotRefusal,
  analysePrototypePilotAggregate,
  buildPrototypePilotManifest,
  buildPrototypePilotPackets,
  buildPrototypePilotQuestions,
  enabledPrototypePilotKeys,
  gradePrototypePilotSittingAnswer,
  medianTimeBinSeconds,
  openPrototypePilotSitting,
  orderPrototypePilotPacket,
  parsePrototypePilotItemId,
  prototypePilotAggregateFilename,
  prototypePilotCandidate,
  prototypePilotItemFingerprint,
  prototypePilotItemId,
  prototypePilotPacketFingerprint,
  resetPrototypePilotSittings,
  startPrototypePilotItem,
  type PrototypePilotAggregate,
  type PrototypePilotManifest,
} from "./prototype-pilot";
import {
  formatPilotReport,
  loadPilotManifest,
  parsePilotAggregate,
  PILOT_MANIFEST_PATH,
} from "../../scripts/pilot-report";
import { BAND_TIME_BUDGET_SECONDS, CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { requireSceneFamilyBucket, type SceneFamilyId } from "./scene-families";

/** The enabled keys, derived the same way the registry documents them. */
const registryKeys = CURRENT_FAMILY_PROMOTION_REGISTRY.flatMap((family) =>
  family.bands
    .filter((band) => band.state !== "prototype")
    .flatMap((band) => band.validatedDifficultyBuckets.map((bucket) =>
      `${family.familyId}:${band.band}:${bucket}`)));

describe("pilot v3 identity", () => {
  it("covers every enabled family, band, and bucket key exactly once", () => {
    const keys = enabledPrototypePilotKeys();
    // Derived from the registry on both sides, never a written-down count: a
    // family withdrawn by the human gate drops out of both lists together.
    expect(keys.map((key) => `${key.familyId}:${key.band}:${key.difficultyBucket}`).sort())
      .toEqual([...registryKeys].sort());
    expect(keys.length).toBeGreaterThan(0);

    const questions = buildPrototypePilotQuestions();
    expect(questions).toHaveLength(keys.length * PILOT_ITEMS_PER_KEY);
    expect(new Set(questions.map((question) => question.itemId)).size).toBe(questions.length);
  });

  it("gives every item the full four-part identity and round-trips it", () => {
    for (const question of buildPrototypePilotQuestions()) {
      expect(question.itemId)
        .toBe(`${question.familyId}:${question.band}:${question.difficultyBucket}:r1`);
      const parsed = parsePrototypePilotItemId(question.itemId);
      expect(parsed.representative).toBe(1);
      expect(parsed.key.familyId).toBe(question.familyId);
      expect(parsed.key.band).toBe(question.band);
      expect(parsed.key.difficultyBucket).toBe(question.difficultyBucket);
      // Difficulty and band budget are read from the bucket declaration and the
      // band table, so an item can never claim a difficulty its bucket denies.
      expect(parsed.key.difficulty)
        .toBe(requireSceneFamilyBucket(question.familyId as SceneFamilyId, question.difficultyBucket).difficulty);
      expect(parsed.key.bandTimeBudgetSeconds).toBe(BAND_TIME_BUDGET_SECONDS[question.band]);
    }
  });

  it("rejects ids from the previous pilot and ids no enabled key matches", () => {
    const first = enabledPrototypePilotKeys()[0];
    // Pilot v2 ids named a family and nothing else. Grading one against a v3
    // packet would answer a different question than the participant saw.
    expect(() => parsePrototypePilotItemId(`${first.familyId}:r1`)).toThrow(/unknown pilot item id/);
    expect(() => parsePrototypePilotItemId("not-a-family-v9:warmup:some-d2:r1")).toThrow(/unknown pilot family/);
    expect(() => parsePrototypePilotItemId(`${first.familyId}:no-such-band:${first.difficultyBucket}:r1`))
      .toThrow(/unknown pilot band/);
    // A real family in a band it is not enabled in is still not a pilot item.
    expect(() => parsePrototypePilotItemId(`${first.familyId}:induction-transfer:${first.difficultyBucket}:r1`))
      .toThrow(/no enabled key matches/);
    expect(() => parsePrototypePilotItemId(prototypePilotItemId(first, 2)))
      .toThrow(/representative must be between/);
  });

  it("rebuilds the same item from the id alone", () => {
    const key = enabledPrototypePilotKeys()[0];
    const question = buildPrototypePilotQuestions()
      .find((entry) => entry.itemId === prototypePilotItemId(key, 1))!;
    const parsed = parsePrototypePilotItemId(question.itemId);
    const rebuilt = prototypePilotCandidate(parsed.key, parsed.representative);
    expect(rebuilt.puzzle.stem).toEqual(question.puzzle.stem);
    expect(rebuilt.puzzle.options).toEqual(question.puzzle.options);
  });
});

describe("pilot v3 packets", () => {
  it("fits the whole battery into one capped sitting", () => {
    const packets = buildPrototypePilotPackets();
    const questions = buildPrototypePilotQuestions();
    expect(PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET).toBe(24);
    expect(PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION).toBe("prototype-pilot-packets-v3");
    const expectedCount = Math.ceil(questions.length / PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET);
    expect(packets.map((packet) => packet.packetId)).toEqual(
      Array.from({ length: expectedCount }, (_, index) => `pilot-v3-${String.fromCharCode(97 + index)}`),
    );
    expect(packets.flatMap((packet) => packet.items).map((item) => item.itemId).sort())
      .toEqual(questions.map((item) => item.itemId).sort());
    expect(Math.max(...packets.map((packet) => packet.items.length)))
      .toBeLessThanOrEqual(PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET);
  });

  it("serves no answer or explanation to the participant", () => {
    for (const question of buildPrototypePilotQuestions()) {
      expect(question.puzzle).not.toHaveProperty("answerIndex");
      expect(question.puzzle).not.toHaveProperty("explanation");
      expect(question.puzzle.familyId).toBe(question.familyId);
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

  it("names the aggregate export after the packet, and only a v3 packet", () => {
    expect(PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION).toBe("prototype-pilot-aggregate-v2");
    expect(prototypePilotAggregateFilename("pilot-v3-a")).toBe("aiq-prototype-pilot-v3-a.json");
    // Packet names from the previous pilots must not resolve: their packets
    // held different items, and a result filed under one is not comparable.
    expect(() => prototypePilotAggregateFilename("pilot-v2-a")).toThrow(/unknown/);
    expect(() => prototypePilotAggregateFilename("pilot-v1-a")).toThrow(/unknown/);
  });
});

describe("pilot v3 content fingerprint", () => {
  it("is stable across builds and pins the visible content", () => {
    const first = buildPrototypePilotPackets();
    const second = buildPrototypePilotPackets();
    expect(second.map((packet) => packet.contentFingerprint))
      .toEqual(first.map((packet) => packet.contentFingerprint));

    const items = first[0].items;
    // Same items, same hash — order and content are what it pins.
    expect(prototypePilotPacketFingerprint(items)).toBe(first[0].contentFingerprint);
    // Change one visible option and the fingerprint has to move, or a packet
    // whose content drifted would keep passing as the one that was answered.
    const tampered = items.map((item, index) => index !== 0 ? item : {
      ...item,
      puzzle: { ...item.puzzle, options: [...item.puzzle.options].reverse() },
    });
    expect(prototypePilotPacketFingerprint(tampered)).not.toBe(first[0].contentFingerprint);
    // Dropping an item is a different packet too.
    expect(prototypePilotPacketFingerprint(items.slice(1))).not.toBe(first[0].contentFingerprint);
  });
});

describe("pilot v3 saved manifest", () => {
  const live = buildPrototypePilotManifest();

  it("matches the manifest committed beside the pilot results", () => {
    // The saved file is the reference a report is checked against. If it drifts
    // from what the code builds, every later report checks the wrong packet.
    const saved: PrototypePilotManifest = JSON.parse(readFileSync(PILOT_MANIFEST_PATH, "utf8"));
    expect(saved).toEqual(live);
    expect(loadPilotManifest()).toEqual(live);
  });

  it("records identity and gate inputs but never any answer", () => {
    const serialized = JSON.stringify(live);
    expect(serialized).not.toContain("answerIndex");
    expect(serialized).not.toContain("explanation");
    expect(serialized).not.toContain("options");
    expect(serialized).not.toContain("stem");
    // It must not pin the generator version either: a version bump that changes
    // no visible content must not invalidate a result the owner already has.
    expect(serialized).not.toContain("scene-families-v");
    for (const packet of live.packets) {
      for (const item of packet.items) {
        expect(Object.keys(item).sort()).toEqual([
          "band", "bandTimeBudgetSeconds", "difficulty", "difficultyBucket", "familyId", "itemId",
        ]);
      }
    }
    expect(live.itemCount).toBe(buildPrototypePilotQuestions().length);
  });
});

describe("pilot v3 sittings: server timing, single-use grading, frozen content", () => {
  const key = enabledPrototypePilotKeys()[0];
  const itemId = prototypePilotItemId(key, 1);
  const { puzzle } = prototypePilotCandidate(key, 1);
  const sittingPacket = buildPrototypePilotPackets()
    .find((entry) => entry.items.some((entry_) => entry_.itemId === itemId))!;
  const START_MS = Date.UTC(2026, 7, 26, 9, 0, 0);

  /** Open one sitting and hand back what the browser would have been sent. */
  function openSitting() {
    const ordered = orderPrototypePilotPacket(sittingPacket, "unit-test");
    const { sittingId, items } = openPrototypePilotSitting(sittingPacket, ordered);
    const served = items.find((item) => item.itemId === itemId)!;
    return { sittingId, itemId, contentFingerprint: served.contentFingerprint };
  }

  beforeEach(() => {
    resetPrototypePilotSittings();
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetPrototypePilotSittings();
  });

  it("serves every item with the fingerprint of exactly what it sent", () => {
    const ordered = orderPrototypePilotPacket(sittingPacket, "unit-test");
    const { items } = openPrototypePilotSitting(sittingPacket, ordered);
    expect(items).toHaveLength(ordered.length);
    for (const [index, item] of items.entries()) {
      expect(item.itemId).toBe(ordered[index].itemId);
      expect(item.contentFingerprint).toBe(prototypePilotItemFingerprint(ordered[index]));
      // The served question is still answer-free: freezing happens server-side.
      expect(item).not.toHaveProperty("answerIndex");
      expect(item.puzzle).not.toHaveProperty("answerIndex");
      expect(item.puzzle).not.toHaveProperty("explanation");
    }
  });

  it("grades a right answer, a wrong answer, and the frozen explanation", () => {
    const first = openSitting();
    startPrototypePilotItem(first);
    const right = gradePrototypePilotSittingAnswer({
      ...first, selectedOption: puzzle.answerIndex, clientElapsedSeconds: 5,
    });
    expect(right.correct).toBe(true);
    expect(right.explanation).toBe(puzzle.explanation);
    expect(right.timeBudgetSeconds).toBe(key.bandTimeBudgetSeconds);

    const second = openSitting();
    startPrototypePilotItem(second);
    const wrongIndex = (puzzle.answerIndex + 1) % puzzle.options.length;
    expect(gradePrototypePilotSittingAnswer({
      ...second, selectedOption: wrongIndex, clientElapsedSeconds: 5,
    }).correct).toBe(false);
  });

  it("measures the solve time itself and ignores what the browser reports", () => {
    const inside = openSitting();
    startPrototypePilotItem(inside);
    vi.setSystemTime(START_MS + key.bandTimeBudgetSeconds * 1000);
    const onBudget = gradePrototypePilotSittingAnswer({
      ...inside, selectedOption: 0, clientElapsedSeconds: 86_400,
    });
    expect(onBudget.elapsedSeconds).toBe(key.bandTimeBudgetSeconds);
    // A browser claiming a whole day cannot make an on-budget answer late.
    expect(onBudget.late).toBe(false);
    expect(onBudget.clientElapsedSeconds).toBe(86_400);
    expect(onBudget.clientTimingDisagrees).toBe(true);

    vi.setSystemTime(START_MS);
    const over = openSitting();
    startPrototypePilotItem(over);
    vi.setSystemTime(START_MS + (key.bandTimeBudgetSeconds + 1) * 1000);
    const late = gradePrototypePilotSittingAnswer({
      ...over, selectedOption: 0, clientElapsedSeconds: 1,
    });
    // Nor can a browser claiming one second hide a slow answer.
    expect(late.elapsedSeconds).toBe(key.bandTimeBudgetSeconds + 1);
    expect(late.late).toBe(true);
    expect(late.clientTimingDisagreementSeconds).toBe(1 - (key.bandTimeBudgetSeconds + 1));
  });

  it("keeps the first stamp when an item is started more than once", () => {
    const sitting = openSitting();
    expect(startPrototypePilotItem(sitting)).toEqual({
      started: true, alreadyStarted: false, timeBudgetSeconds: key.bandTimeBudgetSeconds,
    });
    vi.setSystemTime(START_MS + 10_000);
    expect(startPrototypePilotItem(sitting).alreadyStarted).toBe(true);
    vi.setSystemTime(START_MS + 20_000);
    // Twenty seconds since the item was first shown, not ten since the retry.
    expect(gradePrototypePilotSittingAnswer({
      ...sitting, selectedOption: 0, clientElapsedSeconds: 20,
    }).elapsedSeconds).toBe(20);
  });

  it("reports agreeing clocks as agreeing, and rounds a sub-second answer up to one", () => {
    const sitting = openSitting();
    startPrototypePilotItem(sitting);
    vi.setSystemTime(START_MS + 100);
    const grade = gradePrototypePilotSittingAnswer({
      ...sitting, selectedOption: 0, clientElapsedSeconds: 1,
    });
    // Zero is not a solve-time bin the aggregate schema accepts.
    expect(grade.elapsedSeconds).toBe(1);
    expect(grade.clientTimingDisagrees).toBe(false);
  });

  it("grades one item once and says nothing about correctness when it refuses", () => {
    const sitting = openSitting();
    startPrototypePilotItem(sitting);
    gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: 0, clientElapsedSeconds: 5 });
    for (let option = 0; option < puzzle.options.length; option += 1) {
      // Every option, including the right one: the second grade tells a probing
      // participant nothing they did not already have.
      let refusal: unknown;
      try {
        gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: option, clientElapsedSeconds: 5 });
      } catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(PrototypePilotRefusal);
      expect((refusal as PrototypePilotRefusal).reason).toBe("already-recorded");
      expect((refusal as PrototypePilotRefusal).message).not.toContain(puzzle.explanation);
    }
    // Starting it again is refused too, so the clock cannot be reset and reused.
    expect(() => startPrototypePilotItem(sitting)).toThrow(PrototypePilotRefusal);
  });

  it("refuses to grade an item the server never recorded showing", () => {
    const sitting = openSitting();
    expect(() => gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: 0, clientElapsedSeconds: 5 }))
      .toThrow(/no solve time/);
  });

  it("refuses an unknown sitting, an unknown item, and drifted content", () => {
    const sitting = openSitting();
    expect(() => startPrototypePilotItem({ ...sitting, sittingId: "0".repeat(32) }))
      .toThrow(/no longer active/);
    expect(() => startPrototypePilotItem({ ...sitting, itemId: "made-up-v1:warmup:made-up-d2:r1" }))
      .toThrow(/not part of this sitting/);
    expect(() => startPrototypePilotItem({ ...sitting, contentFingerprint: "0".repeat(16) }))
      .toThrow(/does not match the content this sitting served/);
  });

  it("grades against the copy it froze, not a fresh rebuild", () => {
    const sitting = openSitting();
    startPrototypePilotItem(sitting);
    // A malformed option must not consume the item's one grading attempt.
    expect(() => gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: 99, clientElapsedSeconds: 5 }))
      .toThrow(/range/);
    expect(() => gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: 0, clientElapsedSeconds: -1 }))
      .toThrow(/elapsed seconds/);
    expect(() => gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: 0, clientElapsedSeconds: 1.5 }))
      .toThrow(/elapsed seconds/);
    expect(gradePrototypePilotSittingAnswer({
      ...sitting, selectedOption: puzzle.answerIndex, clientElapsedSeconds: 5,
    }).correct).toBe(true);
  });

  it("forgets a sitting once it is older than the documented lifetime", () => {
    const sitting = openSitting();
    startPrototypePilotItem(sitting);
    vi.setSystemTime(START_MS + PROTOTYPE_PILOT_SITTING_TTL_MS + 1);
    expect(() => gradePrototypePilotSittingAnswer({ ...sitting, selectedOption: 0, clientElapsedSeconds: 5 }))
      .toThrow(/no longer active/);
  });

  it("keeps at most the documented number of open sittings, dropping the oldest", () => {
    const ordered = orderPrototypePilotPacket(sittingPacket, "unit-test");
    const first = openPrototypePilotSitting(sittingPacket, ordered).sittingId;
    for (let extra = 1; extra < PROTOTYPE_PILOT_MAX_SITTINGS; extra += 1) {
      vi.setSystemTime(START_MS + extra);
      openPrototypePilotSitting(sittingPacket, ordered);
    }
    // Full but intact: the first sitting is still usable at the cap.
    expect(() => startPrototypePilotItem({
      sittingId: first, itemId, contentFingerprint: prototypePilotItemFingerprint(ordered.find((entry) => entry.itemId === itemId)!),
    })).not.toThrow();
    vi.setSystemTime(START_MS + PROTOTYPE_PILOT_MAX_SITTINGS);
    const newest = openPrototypePilotSitting(sittingPacket, ordered).sittingId;
    expect(newest).not.toBe(first);
    expect(() => startPrototypePilotItem({
      sittingId: first, itemId, contentFingerprint: prototypePilotItemFingerprint(ordered.find((entry) => entry.itemId === itemId)!),
    })).toThrow(/no longer active/);
  });
});

// ---------------------------------------------------------------------------
// Aggregate v2 and the report gates
// ---------------------------------------------------------------------------

const manifest = buildPrototypePilotManifest();
const packet = manifest.packets[0];

type ItemOverride = Partial<PrototypePilotAggregate["items"][number]>;

/** One perfect sitting: every item right, first bin, nothing reported. */
function aggregateFor(overrides: Record<string, ItemOverride> = {}): PrototypePilotAggregate {
  return PrototypePilotAggregateSchema.parse({
    schemaVersion: PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
    packetSchemaVersion: PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
    packetId: packet.packetId,
    packetContentFingerprint: packet.contentFingerprint,
    timeBinSeconds: PROTOTYPE_PILOT_TIME_BIN_SECONDS,
    items: packet.items.map((item) => ({
      itemId: item.itemId,
      familyId: item.familyId,
      band: item.band,
      difficultyBucket: item.difficultyBucket,
      difficulty: item.difficulty,
      attempts: 1,
      correctAttempts: 1,
      cleanMisses: 0,
      intendedRelationshipDescriptions: 1,
      notationMisunderstandingReports: 0,
      defensibleAlternativeReports: 0,
      lateAttempts: 0,
      timeBinsSeconds: { "15": 1 },
      desktopAttempts: 1,
      mobileAttempts: 0,
      ...overrides[item.itemId],
    })),
  });
}

const deepItemIds = packet.items.filter((item) => item.difficulty >= 4).map((item) => item.itemId);
const deepestItems = packet.items.filter((item) => item.difficulty === 5);

/** A wrong answer the participant understood: the plan's clean miss. */
const cleanMiss: ItemOverride = {
  correctAttempts: 0,
  cleanMisses: 1,
  intendedRelationshipDescriptions: 1,
};

describe("aggregate v2 schema", () => {
  it("uses five-second bins and an explicit defensible-alternative count", () => {
    expect(PROTOTYPE_PILOT_TIME_BIN_SECONDS).toBe(5);
    const aggregate = aggregateFor();
    for (const item of aggregate.items) {
      expect(item).toHaveProperty("defensibleAlternativeReports");
      expect(item).toHaveProperty("cleanMisses");
      for (const bin of Object.keys(item.timeBinsSeconds)) {
        expect(Number(bin) % PROTOTYPE_PILOT_TIME_BIN_SECONDS).toBe(0);
      }
    }
    // No raw participant data: an export carries counts and nothing else.
    const serialized = JSON.stringify(aggregate);
    expect(serialized).not.toContain("session");
    expect(serialized).not.toContain("answerIndex");
  });

  it("refuses counts that cannot describe one sitting", () => {
    const base = aggregateFor().items[0];
    const parse = (item: Record<string, unknown>) =>
      PrototypePilotAggregateSchema.safeParse({
        ...aggregateFor(),
        items: [{ ...base, ...item }],
      });
    expect(parse({ correctAttempts: 2 }).success).toBe(false);
    expect(parse({ cleanMisses: 1 }).success).toBe(false); // no incorrect response to be clean
    expect(parse({ desktopAttempts: 0 }).success).toBe(false); // viewports must add up
    expect(parse({ timeBinsSeconds: { "15": 2 } }).success).toBe(false); // bins must add up
    expect(parse({ timeBinsSeconds: { "13": 1 } }).success).toBe(false); // not a five-second bin
    expect(parse({ unexpectedField: 1 }).success).toBe(false); // strict
  });

  it("takes the median solve time by nearest rank over the bins", () => {
    expect(medianTimeBinSeconds({})).toBeNull();
    expect(medianTimeBinSeconds({ "20": 1 })).toBe(20);
    expect(medianTimeBinSeconds({ "10": 1, "20": 1, "60": 1 })).toBe(20);
    // Even count: nearest rank takes the lower of the two middle bins, which is
    // a bin somebody was in, never an average landing between two that nobody was.
    expect(medianTimeBinSeconds({ "10": 1, "40": 1 })).toBe(10);
  });
});

describe("pilot report validation", () => {
  it("accepts an aggregate that matches the saved packet", () => {
    const report = analysePrototypePilotAggregate(manifest, aggregateFor());
    expect(report.packetId).toBe(packet.packetId);
    expect(report.items).toHaveLength(packet.items.length);
  });

  it("refuses a tampered content fingerprint and names both values", () => {
    const aggregate = { ...aggregateFor(), packetContentFingerprint: "0000000000000000" };
    expect(() => analysePrototypePilotAggregate(manifest, aggregate))
      .toThrow(/content fingerprint is "0000000000000000".*"" ?|content fingerprint/);
    expect(() => analysePrototypePilotAggregate(manifest, aggregate))
      .toThrow(new RegExp(packet.contentFingerprint));
    expect(() => analysePrototypePilotAggregate(manifest, aggregate))
      .toThrow(/not the same item set/);
  });

  it("refuses a packet the saved manifest does not hold", () => {
    const aggregate = { ...aggregateFor(), packetId: "pilot-v3-z" };
    expect(() => analysePrototypePilotAggregate(manifest, aggregate))
      .toThrow(/names packet "pilot-v3-z", which the saved manifest does not hold/);
  });

  it("refuses a wrong schema version by name, on both axes", () => {
    expect(() => parsePilotAggregate({ ...aggregateFor(), schemaVersion: "prototype-pilot-aggregate-v1" }, "fixture"))
      .toThrow(/declares aggregate schema "prototype-pilot-aggregate-v1"/);
    expect(() => parsePilotAggregate({ ...aggregateFor(), packetSchemaVersion: "prototype-pilot-packets-v2" }, "fixture"))
      .toThrow(/collected against packet schema "prototype-pilot-packets-v2"/);
    expect(() => parsePilotAggregate({ nothing: true }, "fixture")).toThrow(/declares aggregate schema null/);
    expect(parsePilotAggregate(aggregateFor(), "fixture").packetId).toBe(packet.packetId);
  });

  it("refuses an item set that is not the packet's", () => {
    const valid = aggregateFor();
    expect(() => analysePrototypePilotAggregate(manifest, { ...valid, items: valid.items.slice(1) }))
      .toThrow(/is missing 1 of packet .*'s items/);
    const extra = {
      ...valid,
      items: [...valid.items, { ...valid.items[0], itemId: "made-up-v1:warmup:made-up-d2:r1" }],
    };
    expect(() => analysePrototypePilotAggregate(manifest, extra))
      .toThrow(/reports items packet .* does not contain: made-up-v1/);
  });

  it("refuses an item whose identity disagrees with the saved manifest", () => {
    const valid = aggregateFor();
    const drifted = {
      ...valid,
      items: valid.items.map((item, index) => index === 0 ? { ...item, difficulty: 5 } : item),
    };
    expect(() => analysePrototypePilotAggregate(manifest, drifted))
      .toThrow(/aggregate difficulty "5" does not match the saved manifest's/);
  });
});

describe("pilot report gates", () => {
  it("flags the documented withdrawal reasons per item and withdraws nothing", () => {
    const [first, second, third, fourth] = packet.items.map((item) => item.itemId);
    const slow = deepestItems[0];
    const report = analysePrototypePilotAggregate(manifest, aggregateFor({
      [first]: { notationMisunderstandingReports: 1 },
      [second]: { intendedRelationshipDescriptions: 0 },
      [third]: { attempts: 2, correctAttempts: 2, intendedRelationshipDescriptions: 2,
        defensibleAlternativeReports: 2, timeBinsSeconds: { "15": 2 }, desktopAttempts: 2 },
      // Wrong, but not a clean miss: a confused response is a withdrawal
      // question, never evidence that the item is hard.
      [fourth]: { correctAttempts: 0, cleanMisses: 0 },
      [slow.itemId]: { timeBinsSeconds: { [String(slow.bandTimeBudgetSeconds + 5)]: 1 } },
    }));
    const flaggedIds = report.withdrawalReview.flagged.map((item) => item.itemId);
    expect(flaggedIds).toContain(first);
    expect(flaggedIds).toContain(second);
    expect(flaggedIds).toContain(third);
    expect(flaggedIds).toContain(fourth);
    expect(flaggedIds).toContain(slow.itemId);
    expect(report.withdrawalReview.clearedItems).toBe(report.items.length - flaggedIds.length);

    const reasons = report.withdrawalReview.flagged.flatMap((item) => item.withdrawalReasons).join("\n");
    expect(reasons).toMatch(/reported unclear notation/);
    expect(reasons).toMatch(/did not describe the intended relationship/);
    expect(reasons).toMatch(/repeated defensible alternative/);
    expect(reasons).toMatch(/confused or ambiguous rather than a clean miss/);
    expect(reasons).toMatch(/over the \d+s .* budget/);
  });

  it("passes the escalation gate on two clean d4/d5 misses", () => {
    const report = analysePrototypePilotAggregate(manifest, aggregateFor({
      [deepItemIds[0]]: cleanMiss,
      [deepItemIds[1]]: cleanMiss,
    }));
    expect(report.cleanMissGate.cleanMisses).toBe(ESCALATION_MINIMUM_CLEAN_MISSES);
    expect(report.cleanMissGate.pass).toBe(true);
    expect(report.escalation).toEqual({ pass: true, branch: "clean-misses" });
    // A clean miss the participant understood is not a withdrawal question.
    expect(report.withdrawalReview.flagged.map((item) => item.itemId)).not.toContain(deepItemIds[0]);
  });

  it("does not count a clean miss on an easy item towards the gate", () => {
    const easy = packet.items.find((item) => item.difficulty < 4)!;
    const report = analysePrototypePilotAggregate(manifest, aggregateFor({
      [easy.itemId]: cleanMiss,
      [deepItemIds[0]]: cleanMiss,
    }));
    expect(report.cleanMissGate.cleanMisses).toBe(1);
    expect(report.cleanMissGate.pass).toBe(false);
  });

  it("passes the escalation gate on a tight median d5 headroom", () => {
    // Every d5 item finishes inside its budget with at most ten seconds spare.
    const tight = Object.fromEntries(deepestItems.map((item) => [item.itemId, {
      timeBinsSeconds: { [String(item.bandTimeBudgetSeconds - 5)]: 1 },
    }]));
    const report = analysePrototypePilotAggregate(manifest, aggregateFor(tight));
    expect(report.cleanMissGate.pass).toBe(false);
    expect(report.timeHeadroomGate.medianHeadroomSeconds).toBe(5);
    expect(report.timeHeadroomGate.overBudget).toHaveLength(0);
    expect(report.timeHeadroomGate.pass).toBe(true);
    expect(report.escalation).toEqual({ pass: true, branch: "time-headroom" });
  });

  it("fails the headroom branch when any d5 item runs over its budget", () => {
    const overrides = Object.fromEntries(deepestItems.map((item, index) => [item.itemId, {
      timeBinsSeconds: {
        [String(item.bandTimeBudgetSeconds + (index === 0 ? 5 : -5))]: 1,
      },
    }]));
    const report = analysePrototypePilotAggregate(manifest, aggregateFor(overrides));
    expect(report.timeHeadroomGate.overBudget.map((item) => item.itemId)).toEqual([deepestItems[0].itemId]);
    expect(report.timeHeadroomGate.pass).toBe(false);
  });

  it("fails both branches when the sitting is swept quickly", () => {
    const report = analysePrototypePilotAggregate(manifest, aggregateFor());
    expect(report.cleanMissGate.pass).toBe(false);
    expect(report.timeHeadroomGate.medianHeadroomSeconds)
      .toBeGreaterThan(ESCALATION_MAXIMUM_MEDIAN_HEADROOM_SECONDS);
    expect(report.timeHeadroomGate.pass).toBe(false);
    expect(report.escalation).toEqual({ pass: false, branch: null });
  });

  it("prints the miss and time numbers without turning them into a difficulty verdict", () => {
    // Changed on 2026-08-27, when the owner's instruction changed what this
    // report is allowed to claim. It used to print `RESULT PASS` when two clean
    // misses landed among the deep items, and read that as the human ceiling
    // having risen. The only participant these aggregates have does other things
    // while sitting them, so a miss from boredom is recorded exactly like a miss
    // from difficulty and the gate measured engagement. The numbers still print
    // — they are data; the verdict does not.
    const swept = formatPilotReport(
      analysePrototypePilotAggregate(manifest, aggregateFor()),
      "fixture.json",
      PILOT_MANIFEST_PATH,
    );
    expect(swept).toContain("Withdrawal review");
    expect(swept).toContain("NOT difficulty evidence");
    expect(swept).toContain("Clean misses among d4/d5 items");
    expect(swept).toContain("d5 solve times against their band budgets");
    expect(swept).toContain(packet.contentFingerprint);

    const withCleanMisses = formatPilotReport(
      analysePrototypePilotAggregate(manifest, aggregateFor({
        [deepItemIds[0]]: cleanMiss,
        [deepItemIds[1]]: cleanMiss,
      })),
      "fixture.json",
      PILOT_MANIFEST_PATH,
    );
    // Two clean misses used to be the passing case. It must now read the same as
    // the swept sitting: no verdict either way, and never the word PASS.
    expect(withCleanMisses).toContain("2 clean misses");
    for (const rendered of [swept, withCleanMisses]) {
      expect(rendered).not.toContain("RESULT  PASS");
      expect(rendered).not.toContain("RESULT  FAIL");
      expect(rendered).toContain("The withdrawal review above is the finding");
    }
  });
});
