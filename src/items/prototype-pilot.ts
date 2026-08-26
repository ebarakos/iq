import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { seededRng, shuffled } from "../lib/rng";
import { bucketDifficulty } from "./expanded-quiz";
import {
  BAND_TIME_BUDGET_SECONDS,
  CURRENT_FAMILY_PROMOTION_REGISTRY,
  EXPANDED_PROFILE_BANDS,
  type ExpandedProfileBand,
} from "./family-promotion";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  requireSceneFamilyBucket,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import { MAXIMUM_DIFFICULTY, toPublicPuzzle, type PublicPuzzle, type Scene } from "./schema";

/**
 * How many items each enabled key contributes to the pilot.
 *
 * Was one per FAMILY until 2026-08-25. Pilot v3 covers one item per enabled
 * `(familyId, band, difficultyBucket)` key instead (escalate-the-quiz, Phase
 * 5), so a family that validates two buckets is now judged on both. That is
 * what makes the sitting able to see whether a deeper bucket is really deeper.
 *
 * What one item per key still costs: a key is judged on a single draw, so an
 * unlucky instance can condemn a sound key and a lucky one can hide a weak
 * key's variance. That is an acceptable trade while the pilot's job is the
 * retention gate — spotting formats nobody can read, which one item shows
 * plainly — and not difficulty calibration, which needs several items per key.
 */
export const PILOT_ITEMS_PER_KEY = 1;
export const PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION = "prototype-pilot-packets-v3";
export const PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION = "prototype-pilot-aggregate-v2";
/**
 * Items one sitting may hold. Kept at 24 for pilot v3 (owner decision): the
 * enabled keys must fit one uninterrupted sitting. It was set when there were
 * 20 of them, with room for a branch that would have added a 21st; the v12
 * battery of 2026-08-26 has exactly 21 and still fits one packet.
 */
export const PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET = 24;

/**
 * Width of the aggregate's solve-time bins, in seconds.
 *
 * Narrowed from fifteen to five for aggregate v2. Fifteen-second bins could not
 * answer the plan's time-headroom question: an item binned at "45" against a
 * 40-second budget might have taken 31 seconds or 45, and the difference
 * decides the gate. Five seconds is still coarse enough that a bin is not a
 * participant's stopwatch reading.
 */
export const PROTOTYPE_PILOT_TIME_BIN_SECONDS = 5;

/** Clean d4/d5 misses the final sitting needs for the escalation gate's first branch. */
export const ESCALATION_MINIMUM_CLEAN_MISSES = 2;
/** Largest median d5 time headroom the escalation gate's second branch allows, in seconds. */
export const ESCALATION_MAXIMUM_MEDIAN_HEADROOM_SECONDS = 10;

/** Seed namespace for pilot v3 draws. Changing it re-rolls every pilot item. */
const PILOT_SEED_NAMESPACE = "scene-prototype-pilot-v3";

/**
 * Full item identity: `${familyId}:${band}:${difficultyBucket}:r${n}`.
 *
 * Pilot v2 ids were `${familyId}:r1`, which could not name which of a family's
 * buckets was answered. Every parse path — grading, the answer route, and the
 * aggregate reader — uses this one pattern, so an id from the older pilot is
 * rejected rather than silently graded against a different item.
 */
const ITEM_ID_PATTERN = /^([a-z0-9-]+-v\d+):([a-z-]+):([a-z0-9-]+):r(\d+)$/;
const PACKET_ID_PATTERN = /^pilot-v3-[a-z]$/;

/** One enabled `(familyId, band, difficultyBucket)` key the pilot must cover. */
export interface PrototypePilotKey {
  familyId: SceneFamilyId;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  /** Difficulty every accepted draw in this bucket carries, from the bucket declaration. */
  difficulty: number;
  /** Documented median-time budget for the band this key sits in. */
  bandTimeBudgetSeconds: number;
}

export interface PrototypePilotQuestion extends PrototypePilotKey {
  itemId: string;
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

/**
 * Every enabled key, in registry order.
 *
 * Derived from the promotion registry every time, never a written-down count: a
 * family withdrawn by the human gate loses its bands and drops out here on the
 * next build, and a family that validates a second bucket gains a key.
 */
export function enabledPrototypePilotKeys(): PrototypePilotKey[] {
  const keys: PrototypePilotKey[] = [];
  for (const family of CURRENT_FAMILY_PROMOTION_REGISTRY) {
    if (!(SCENE_FAMILY_IDS as readonly string[]).includes(family.familyId)) continue;
    const familyId = family.familyId as SceneFamilyId;
    for (const band of family.bands) {
      // A prototype band has not passed the code-correctness contract, so it is
      // not something a person should be asked to read yet.
      if (band.state === "prototype") continue;
      const buckets = [...band.validatedDifficultyBuckets].sort((left, right) =>
        bucketDifficulty(left) - bucketDifficulty(right) || left.localeCompare(right));
      for (const difficultyBucket of buckets) {
        keys.push({
          familyId,
          band: band.band,
          difficultyBucket,
          difficulty: requireSceneFamilyBucket(familyId, difficultyBucket).difficulty,
          bandTimeBudgetSeconds: BAND_TIME_BUDGET_SECONDS[band.band],
        });
      }
    }
  }
  return keys;
}

export function prototypePilotItemId(key: PrototypePilotKey, representative: number): string {
  return `${key.familyId}:${key.band}:${key.difficultyBucket}:r${representative}`;
}

/**
 * Recover an item's full identity from its id, or explain why it is not one.
 *
 * The id alone is not trusted: the key it names must still be enabled, so an id
 * for a family the human gate has since withdrawn stops resolving instead of
 * quietly rebuilding an item nobody may serve.
 */
export function parsePrototypePilotItemId(itemId: string): {
  key: PrototypePilotKey;
  representative: number;
} {
  const match = ITEM_ID_PATTERN.exec(itemId);
  if (!match) throw new Error(`unknown pilot item id "${itemId}"`);
  const [, familyId, band, difficultyBucket, representative] = match;
  if (!(SCENE_FAMILY_IDS as readonly string[]).includes(familyId)) {
    throw new Error(`unknown pilot family "${familyId}"`);
  }
  if (!(EXPANDED_PROFILE_BANDS as readonly string[]).includes(band)) {
    throw new Error(`unknown pilot band "${band}"`);
  }
  const index = Number(representative);
  if (index < 1 || index > PILOT_ITEMS_PER_KEY) {
    throw new Error(`pilot representative must be between 1 and ${PILOT_ITEMS_PER_KEY}`);
  }
  const key = enabledPrototypePilotKeys().find((candidate) =>
    candidate.familyId === familyId &&
    candidate.band === band &&
    candidate.difficultyBucket === difficultyBucket);
  if (!key) throw new Error(`unknown pilot item "${itemId}": no enabled key matches it`);
  return { key, representative: index };
}

/**
 * Rebuild one pilot item from nothing but its identity.
 *
 * The candidate seed IS the item id, so a packet, an answer route, and a report
 * months apart all reconstruct byte-for-byte the same puzzle without storing it.
 */
export function prototypePilotCandidate(key: PrototypePilotKey, representative: number) {
  if (!Number.isInteger(representative) || representative < 1 || representative > PILOT_ITEMS_PER_KEY) {
    throw new Error(`pilot representative must be between 1 and ${PILOT_ITEMS_PER_KEY}`);
  }
  const itemId = prototypePilotItemId(key, representative);
  const candidate = generateSceneFamilyCandidate(
    key.familyId,
    seededRng(PILOT_SEED_NAMESPACE, itemId),
    key.difficultyBucket,
  );
  const acceptance = validateSceneFamilyCandidate(candidate);
  if (!acceptance.accepted) {
    throw new Error(`pilot item ${itemId} failed correctness acceptance`);
  }
  return candidate;
}

export function buildPrototypePilotQuestions(): PrototypePilotQuestion[] {
  return enabledPrototypePilotKeys().flatMap((key) =>
    Array.from({ length: PILOT_ITEMS_PER_KEY }, (_, index) => {
      const representative = index + 1;
      const candidate = prototypePilotCandidate(key, representative);
      return {
        ...key,
        itemId: prototypePilotItemId(key, representative),
        puzzle: toPublicPuzzle(candidate.puzzle),
      };
    }));
}

/**
 * The fewest packets that hold every enabled key once, in key order.
 *
 * With 20 keys and a cap of 24 this is a single sitting, which is what the plan
 * asks for. The split stays general so a future key count above the cap
 * produces two balanced sittings instead of an error.
 */
export function buildPrototypePilotPackets(): PrototypePilotPacket[] {
  const questions = buildPrototypePilotQuestions();
  const packetCount = Math.max(1, Math.ceil(questions.length / PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET));
  const perPacket = Math.ceil(questions.length / packetCount);
  return Array.from({ length: packetCount }, (_, index) => {
    const items = questions.slice(index * perPacket, (index + 1) * perPacket);
    if (items.length > PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET) {
      throw new Error(`pilot packet ${index + 1} exceeds ${PROTOTYPE_PILOT_MAX_ITEMS_PER_PACKET} items`);
    }
    return {
      packetId: `pilot-v3-${String.fromCharCode(97 + index)}`,
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
 * current registry — so `pilot-v3-a` run before and after a family change is
 * two different packets wearing one name. Recording this hash with a result
 * makes that detectable instead of silently pooling two populations.
 *
 * It hashes the answer-free public puzzle, so it pins exactly what a
 * participant saw and nothing they were not shown. It deliberately does not
 * include the generator version: family semantics decide what is on the screen,
 * and a version bump that changes no visible content must not invalidate a
 * result the owner already collected.
 */
export function prototypePilotPacketFingerprint(
  items: readonly PrototypePilotQuestion[],
): string {
  return fingerprint(items.map(canonicalPilotItem));
}

/**
 * The same identity, for one item on its own.
 *
 * A sitting freezes this next to the item it served and the browser echoes it
 * back on every later request, so a page still showing yesterday's build of an
 * item is refused instead of graded against today's.
 */
export function prototypePilotItemFingerprint(item: PrototypePilotQuestion): string {
  return fingerprint(canonicalPilotItem(item));
}

/** Exactly what a fingerprint covers: identity plus the answer-free puzzle. */
function canonicalPilotItem(item: PrototypePilotQuestion) {
  return {
    itemId: item.itemId,
    familyId: item.familyId,
    band: item.band,
    difficultyBucket: item.difficultyBucket,
    difficulty: item.difficulty,
    puzzle: item.puzzle,
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
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

// ---------------------------------------------------------------------------
// Sittings — server-stamped timing, single-use grading, frozen content
// ---------------------------------------------------------------------------

/**
 * A sitting is one participant working through one packet in front of a
 * moderator. It exists so three things stop depending on the browser:
 *
 *  - **When an item was first put in front of the person.** The server stamps
 *    it, so the solve time the pilot reports is the server's measurement. The
 *    escalation gate in `docs/plans/escalate-the-quiz.md` is partly a claim
 *    about median solve time on the hardest items, and a number the participant's
 *    own machine reported is not evidence for that claim.
 *  - **How many times an item may be graded.** Once. Without that, submitting
 *    each option in turn reads the answer out of the grader without solving
 *    anything, and a double-submit silently doubles an item's counts.
 *  - **What "the item" is.** The packet is derived from the live family
 *    registry, so a family withdrawn mid-sitting used to strand the person
 *    holding it. A sitting freezes the exact reconstruction it served, answer
 *    included, and grades against that copy for its whole life.
 *
 * **Where the state lives:** one `Map` in this server process, on `globalThis`
 * so the page render and the route handlers share it even when the bundler
 * gives them separate module instances. Nothing is written to disk. It is
 * deliberately not a database: this is one moderated sitting at a time, and a
 * persistence layer would be machinery the pilot cannot pay for.
 *
 * **What that costs, plainly:** every open sitting is lost when the server
 * restarts or redeploys, and a deployment running more than one server process
 * only works if every request from one browser lands on the same process. Both
 * are acceptable for a single-sitting research surface run on one machine, and
 * both would be wrong for a public test. A lost sitting is refused loudly
 * (`unknown-sitting`), never graded against a fresh guess.
 */
export const PROTOTYPE_PILOT_SITTING_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Open sittings kept at once. A sitting is ~20 small records, so this is not a
 * memory limit; it stops a page nobody finishes from accumulating forever.
 */
export const PROTOTYPE_PILOT_MAX_SITTINGS = 64;

/**
 * How far the browser's own stopwatch may sit from the server's before the two
 * are reported as disagreeing, in seconds. A round trip and a rounded second
 * account for one or two; three seconds apart means one of the clocks is not
 * measuring what it claims, and the moderator should see that rather than have
 * the server quietly win.
 */
export const PROTOTYPE_PILOT_TIMING_TOLERANCE_SECONDS = 3;

/** Why a pilot request was refused. Every value is safe to show a participant. */
export type PrototypePilotRefusalReason =
  | "unknown-sitting"
  | "unknown-item"
  | "content-drift"
  | "not-started"
  | "already-recorded";

/**
 * A refusal the participant is allowed to read.
 *
 * It never carries correctness, an explanation, or a solve time — a refusal
 * that leaked any of those would be the answer oracle it exists to close.
 */
export class PrototypePilotRefusal extends Error {
  readonly reason: PrototypePilotRefusalReason;

  constructor(reason: PrototypePilotRefusalReason, message: string) {
    super(message);
    this.name = "PrototypePilotRefusal";
    this.reason = reason;
  }
}

/** A pilot question plus the fingerprint of exactly what the browser was sent. */
export interface PrototypePilotServedQuestion extends PrototypePilotQuestion {
  contentFingerprint: string;
}

/** One item as a sitting froze it. The answer lives here and never leaves. */
interface FrozenPilotItem {
  itemId: string;
  contentFingerprint: string;
  bandTimeBudgetSeconds: number;
  optionCount: number;
  answerIndex: number;
  explanation: string;
  /** When the server first served this item to this sitting. */
  startedAtMs: number | null;
  /** When this item was graded. Non-null means it may never be graded again. */
  gradedAtMs: number | null;
}

interface PrototypePilotSitting {
  sittingId: string;
  packetId: string;
  packetContentFingerprint: string;
  openedAtMs: number;
  items: Map<string, FrozenPilotItem>;
}

/**
 * The store key is a registered symbol on purpose: the pilot page and the two
 * route handlers can end up in different module instances of this file, and a
 * plain module-level `Map` would then give each of them a private, empty store.
 */
const SITTING_STORE_KEY = Symbol.for("aiq.prototype-pilot.sittings");

function sittingStore(): Map<string, PrototypePilotSitting> {
  const holder = globalThis as unknown as Record<symbol, Map<string, PrototypePilotSitting> | undefined>;
  const existing = holder[SITTING_STORE_KEY];
  if (existing) return existing;
  const created = new Map<string, PrototypePilotSitting>();
  holder[SITTING_STORE_KEY] = created;
  return created;
}

function sweepExpiredSittings(now: number): Map<string, PrototypePilotSitting> {
  const store = sittingStore();
  for (const [sittingId, sitting] of store) {
    if (now - sitting.openedAtMs > PROTOTYPE_PILOT_SITTING_TTL_MS) store.delete(sittingId);
  }
  return store;
}

/** Drop every sitting. Used by tests; a running pilot never calls it. */
export function resetPrototypePilotSittings(): void {
  sittingStore().clear();
}

/**
 * Freeze one packet for one participant and hand back what the browser needs.
 *
 * Called once, when the pilot page renders. Every item is rebuilt here — the
 * one reconstruction the whole sitting will be graded against — and checked
 * against the copy being sent to the browser. A disagreement is a hard error
 * rather than a served item, because a sitting that starts out of step with its
 * own answer key can only produce results nobody can trust.
 */
export function openPrototypePilotSitting(
  packet: PrototypePilotPacket,
  orderedItems: readonly PrototypePilotQuestion[],
): { sittingId: string; items: PrototypePilotServedQuestion[] } {
  const now = Date.now();
  const store = sweepExpiredSittings(now);
  const items: PrototypePilotServedQuestion[] = orderedItems.map((item) => ({
    ...item,
    contentFingerprint: prototypePilotItemFingerprint(item),
  }));

  const frozen = new Map<string, FrozenPilotItem>();
  for (const item of items) {
    const { key, representative } = parsePrototypePilotItemId(item.itemId);
    const { puzzle } = prototypePilotCandidate(key, representative);
    const rebuilt = prototypePilotItemFingerprint({ ...item, puzzle: toPublicPuzzle(puzzle) });
    if (rebuilt !== item.contentFingerprint) {
      throw new Error(
        `pilot item ${item.itemId} rebuilds to content "${rebuilt}" but is being served as ` +
          `"${item.contentFingerprint}" — refusing to open a sitting on content it cannot grade`,
      );
    }
    frozen.set(item.itemId, {
      itemId: item.itemId,
      contentFingerprint: item.contentFingerprint,
      bandTimeBudgetSeconds: key.bandTimeBudgetSeconds,
      optionCount: puzzle.options.length,
      answerIndex: puzzle.answerIndex,
      explanation: puzzle.explanation,
      startedAtMs: null,
      gradedAtMs: null,
    });
  }

  while (store.size >= PROTOTYPE_PILOT_MAX_SITTINGS) {
    const oldest = [...store.values()].reduce((left, right) => (right.openedAtMs < left.openedAtMs ? right : left));
    store.delete(oldest.sittingId);
  }
  const sittingId = randomUUID().replaceAll("-", "");
  store.set(sittingId, {
    sittingId,
    packetId: packet.packetId,
    packetContentFingerprint: packet.contentFingerprint,
    openedAtMs: now,
    items: frozen,
  });
  return { sittingId, items };
}

function requireSitting(sittingId: string): PrototypePilotSitting {
  const sitting = sweepExpiredSittings(Date.now()).get(sittingId);
  if (!sitting) {
    throw new PrototypePilotRefusal(
      "unknown-sitting",
      "this pilot sitting is no longer active on the server",
    );
  }
  return sitting;
}

function requireFrozenItem(
  sitting: PrototypePilotSitting,
  itemId: string,
  contentFingerprint: string,
): FrozenPilotItem {
  const item = sitting.items.get(itemId);
  if (!item) {
    throw new PrototypePilotRefusal("unknown-item", `pilot item "${itemId}" is not part of this sitting`);
  }
  if (item.contentFingerprint !== contentFingerprint) {
    throw new PrototypePilotRefusal(
      "content-drift",
      `pilot item "${itemId}" does not match the content this sitting served`,
    );
  }
  return item;
}

/**
 * Stamp, on the server, the moment an item went in front of the participant.
 *
 * The first stamp wins: a re-render, a retry, or a browser that fires this
 * twice must not restart a clock the person has already been reading against.
 */
export function startPrototypePilotItem(request: {
  sittingId: string;
  itemId: string;
  contentFingerprint: string;
}): { started: true; alreadyStarted: boolean; timeBudgetSeconds: number } {
  const sitting = requireSitting(request.sittingId);
  const item = requireFrozenItem(sitting, request.itemId, request.contentFingerprint);
  if (item.gradedAtMs !== null) {
    throw new PrototypePilotRefusal(
      "already-recorded",
      "this item has already been recorded in this sitting",
    );
  }
  const alreadyStarted = item.startedAtMs !== null;
  if (!alreadyStarted) item.startedAtMs = Date.now();
  return { started: true, alreadyStarted, timeBudgetSeconds: item.bandTimeBudgetSeconds };
}

export interface PrototypePilotGrade {
  correct: boolean;
  explanation: string;
  /** Server verdict on the SERVER's solve time against the band's documented budget. */
  late: boolean;
  timeBudgetSeconds: number;
  /** Server-measured solve time. This is the number the pilot records. */
  elapsedSeconds: number;
  /** The browser's own reading, echoed back. Never decides anything. */
  clientElapsedSeconds: number;
  /** `clientElapsedSeconds - elapsedSeconds`; positive means the browser read longer. */
  clientTimingDisagreementSeconds: number;
  /** True when the two readings are further apart than the tolerance allows. */
  clientTimingDisagrees: boolean;
}

/**
 * Grade one answer, once, against the copy this sitting froze.
 *
 * Nothing here is rebuilt and nothing here is taken from the request except the
 * option that was chosen: the answer, the explanation, the band budget and the
 * solve time all come from the sitting. The browser's own elapsed reading is
 * carried through only so a disagreement between the two clocks is visible
 * instead of silently resolved in the server's favour.
 */
export function gradePrototypePilotSittingAnswer(request: {
  sittingId: string;
  itemId: string;
  contentFingerprint: string;
  selectedOption: number;
  clientElapsedSeconds: number;
}): PrototypePilotGrade {
  const sitting = requireSitting(request.sittingId);
  const item = requireFrozenItem(sitting, request.itemId, request.contentFingerprint);
  // Shape first, state second: a malformed request must never consume the one
  // grading attempt this item has.
  if (
    !Number.isInteger(request.selectedOption) ||
    request.selectedOption < 0 ||
    request.selectedOption >= item.optionCount
  ) {
    throw new Error("selected option is out of range");
  }
  if (!Number.isInteger(request.clientElapsedSeconds) || request.clientElapsedSeconds < 0) {
    throw new Error("elapsed seconds must be a non-negative integer");
  }
  if (item.gradedAtMs !== null) {
    throw new PrototypePilotRefusal(
      "already-recorded",
      "this item has already been recorded in this sitting and cannot be graded again",
    );
  }
  if (item.startedAtMs === null) {
    throw new PrototypePilotRefusal(
      "not-started",
      "the server never recorded this item being shown, so it has no solve time to grade against",
    );
  }

  const gradedAtMs = Date.now();
  item.gradedAtMs = gradedAtMs;
  // One second is the floor because a solve time of zero is not a time bin the
  // aggregate schema accepts, and nobody reads a puzzle in under a second.
  const elapsedSeconds = Math.max(1, Math.round((gradedAtMs - item.startedAtMs) / 1000));
  const disagreement = request.clientElapsedSeconds - elapsedSeconds;
  return {
    correct: request.selectedOption === item.answerIndex,
    explanation: item.explanation,
    late: elapsedSeconds > item.bandTimeBudgetSeconds,
    timeBudgetSeconds: item.bandTimeBudgetSeconds,
    elapsedSeconds,
    clientElapsedSeconds: request.clientElapsedSeconds,
    clientTimingDisagreementSeconds: disagreement,
    clientTimingDisagrees: Math.abs(disagreement) > PROTOTYPE_PILOT_TIMING_TOLERANCE_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Saved manifest — the answer-free record of what a packet held
// ---------------------------------------------------------------------------

const ManifestItemSchema = z.object({
  itemId: z.string().min(1),
  familyId: z.string().min(1),
  band: z.enum(EXPANDED_PROFILE_BANDS),
  difficultyBucket: z.string().min(1),
  difficulty: z.number().int().min(1).max(MAXIMUM_DIFFICULTY),
  bandTimeBudgetSeconds: z.number().int().positive(),
}).strict();

export const PrototypePilotManifestSchema = z.object({
  schemaVersion: z.literal(PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION),
  itemCount: z.number().int().positive(),
  packets: z.array(z.object({
    packetId: z.string().min(1),
    contentFingerprint: z.string().min(1),
    items: z.array(ManifestItemSchema).min(1),
  }).strict()).min(1),
}).strict().superRefine((manifest, ctx) => {
  const total = manifest.packets.reduce((sum, packet) => sum + packet.items.length, 0);
  if (total !== manifest.itemCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["itemCount"],
      message: `itemCount ${manifest.itemCount} does not match the ${total} items listed`,
    });
  }
});
export type PrototypePilotManifest = z.infer<typeof PrototypePilotManifestSchema>;

/**
 * The answer-free record of every packet, saved before a sitting is run.
 *
 * It carries identity, the content fingerprint, and the two numbers the report
 * gates need (difficulty and band budget) — never a puzzle, an answer, or an
 * explanation. Saving it is what keeps a result checkable after the live
 * registry moves on: the packet a person actually answered stops existing the
 * moment a family is withdrawn, but this file does not.
 */
export function buildPrototypePilotManifest(): PrototypePilotManifest {
  const packets = buildPrototypePilotPackets();
  return PrototypePilotManifestSchema.parse({
    schemaVersion: PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
    itemCount: packets.reduce((sum, packet) => sum + packet.items.length, 0),
    packets: packets.map((packet) => ({
      packetId: packet.packetId,
      contentFingerprint: packet.contentFingerprint,
      items: packet.items.map((item) => ({
        itemId: item.itemId,
        familyId: item.familyId,
        band: item.band,
        difficultyBucket: item.difficultyBucket,
        difficulty: item.difficulty,
        bandTimeBudgetSeconds: item.bandTimeBudgetSeconds,
      })),
    })),
  });
}

// ---------------------------------------------------------------------------
// Aggregate v2 — counts only, one row per item
// ---------------------------------------------------------------------------

const TimeBinsSchema = z.record(
  z.string().regex(/^[1-9][0-9]*$/, "a time bin is a positive whole number of seconds"),
  z.number().int().nonnegative(),
).refine(
  (bins) => Object.keys(bins).every((bin) => Number(bin) % PROTOTYPE_PILOT_TIME_BIN_SECONDS === 0),
  { message: `every time bin must be a multiple of ${PROTOTYPE_PILOT_TIME_BIN_SECONDS} seconds` },
);

/**
 * One item's counts. No answers, no free text, no session label, no per-attempt
 * record — the standing no-raw-participant-data rule, kept as aggregate v1 had
 * it, only now keyed per item instead of per family.
 */
export const PrototypePilotItemAggregateSchema = z.object({
  itemId: z.string().min(1),
  familyId: z.string().min(1),
  band: z.enum(EXPANDED_PROFILE_BANDS),
  difficultyBucket: z.string().min(1),
  difficulty: z.number().int().min(1).max(MAXIMUM_DIFFICULTY),
  attempts: z.number().int().positive(),
  correctAttempts: z.number().int().nonnegative(),
  /**
   * Incorrect responses that identified the intended relationship and reported
   * neither unclear notation nor a defensible alternative — the plan's clean
   * miss. Counted where the join is known (at the response), because the
   * separate counts below cannot reconstruct it once they are summed.
   */
  cleanMisses: z.number().int().nonnegative(),
  intendedRelationshipDescriptions: z.number().int().nonnegative(),
  notationMisunderstandingReports: z.number().int().nonnegative(),
  defensibleAlternativeReports: z.number().int().nonnegative(),
  /** Responses the server marked over the band's documented time budget. */
  lateAttempts: z.number().int().nonnegative(),
  timeBinsSeconds: TimeBinsSchema,
  desktopAttempts: z.number().int().nonnegative(),
  mobileAttempts: z.number().int().nonnegative(),
}).strict().superRefine((item, ctx) => {
  const cap = (label: string, value: number) => {
    if (value > item.attempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [label],
        message: `${label} (${value}) cannot exceed the ${item.attempts} attempts on ${item.itemId}`,
      });
    }
  };
  cap("correctAttempts", item.correctAttempts);
  cap("cleanMisses", item.cleanMisses);
  cap("intendedRelationshipDescriptions", item.intendedRelationshipDescriptions);
  cap("notationMisunderstandingReports", item.notationMisunderstandingReports);
  cap("defensibleAlternativeReports", item.defensibleAlternativeReports);
  cap("lateAttempts", item.lateAttempts);
  if (item.cleanMisses > item.attempts - item.correctAttempts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cleanMisses"],
      message: `${item.itemId} reports ${item.cleanMisses} clean misses but only ` +
        `${item.attempts - item.correctAttempts} incorrect responses`,
    });
  }
  if (item.desktopAttempts + item.mobileAttempts !== item.attempts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["desktopAttempts"],
      message: `desktop and mobile attempts must add up to the ${item.attempts} attempts on ${item.itemId}`,
    });
  }
  const binned = Object.values(item.timeBinsSeconds).reduce((sum, count) => sum + count, 0);
  if (binned !== item.attempts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["timeBinsSeconds"],
      message: `${item.itemId} bins ${binned} solve times for ${item.attempts} attempts`,
    });
  }
});
export type PrototypePilotItemAggregate = z.infer<typeof PrototypePilotItemAggregateSchema>;

export const PrototypePilotAggregateSchema = z.object({
  schemaVersion: z.literal(PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION),
  packetSchemaVersion: z.literal(PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION),
  packetId: z.string().min(1),
  packetContentFingerprint: z.string().min(1),
  timeBinSeconds: z.literal(PROTOTYPE_PILOT_TIME_BIN_SECONDS),
  items: z.array(PrototypePilotItemAggregateSchema).min(1),
}).strict();
export type PrototypePilotAggregate = z.infer<typeof PrototypePilotAggregateSchema>;

// ---------------------------------------------------------------------------
// Report — the documented withdrawal review and the escalation gate
// ---------------------------------------------------------------------------

/**
 * Nearest-rank median of the solve-time bins, as a bin upper bound.
 *
 * Nearest rank is the same convention the distance fixtures use, so "median"
 * means one thing across the project. An even attempt count therefore reports
 * the lower of the two middle bins — a bin somebody was actually in — rather
 * than an average landing between two bins nobody was in.
 */
export function medianTimeBinSeconds(bins: Readonly<Record<string, number>>): number | null {
  const ordered = Object.entries(bins)
    .map(([bin, count]) => [Number(bin), count] as const)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left - right);
  const attempts = ordered.reduce((sum, [, count]) => sum + count, 0);
  if (attempts === 0) return null;
  const target = Math.ceil(attempts / 2);
  let seen = 0;
  for (const [bin, count] of ordered) {
    seen += count;
    if (seen >= target) return bin;
  }
  return null;
}

/** Nearest-rank median of a list of numbers, matching `medianTimeBinSeconds`. */
function nearestRankMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length / 2) - 1];
}

export interface PrototypePilotItemFinding {
  itemId: string;
  familyId: string;
  band: ExpandedProfileBand;
  difficultyBucket: string;
  difficulty: number;
  attempts: number;
  correctAttempts: number;
  cleanMisses: number;
  medianSolveTimeSeconds: number | null;
  bandTimeBudgetSeconds: number;
  /** `band budget - median time bin`. Negative means the item ran over budget. */
  headroomSeconds: number | null;
  withdrawalReasons: string[];
}

export interface PrototypePilotReport {
  packetId: string;
  packetContentFingerprint: string;
  items: PrototypePilotItemFinding[];
  withdrawalReview: {
    flagged: PrototypePilotItemFinding[];
    clearedItems: number;
  };
  cleanMissGate: {
    pass: boolean;
    minimum: number;
    cleanMisses: number;
    deepItems: number;
    contributors: { itemId: string; cleanMisses: number }[];
  };
  timeHeadroomGate: {
    pass: boolean;
    maximumMedianHeadroomSeconds: number;
    deepestItems: number;
    overBudget: PrototypePilotItemFinding[];
    medianHeadroomSeconds: number | null;
  };
  escalation: {
    pass: boolean;
    branch: "clean-misses" | "time-headroom" | null;
  };
}

function packetFromManifest(manifest: PrototypePilotManifest, packetId: string) {
  const packet = manifest.packets.find((entry) => entry.packetId === packetId);
  if (!packet) {
    throw new Error(
      `the aggregate names packet "${packetId}", which the saved manifest does not hold ` +
        `(it holds ${manifest.packets.map((entry) => entry.packetId).join(", ")})`,
    );
  }
  return packet;
}

/**
 * Check an aggregate against the saved packet manifest, then apply both gates.
 *
 * Every mismatch is a hard error naming exactly what disagreed: a result that
 * came from a different packet, a different item set, or a packet whose visible
 * content has changed is not evidence about this battery, and reporting it as
 * if it were is the failure this function exists to prevent.
 */
export function analysePrototypePilotAggregate(
  manifest: PrototypePilotManifest,
  aggregate: PrototypePilotAggregate,
): PrototypePilotReport {
  const packet = packetFromManifest(manifest, aggregate.packetId);
  if (packet.contentFingerprint !== aggregate.packetContentFingerprint) {
    throw new Error(
      `packet ${packet.packetId} content fingerprint is ` +
        `"${aggregate.packetContentFingerprint}" in the aggregate and ` +
        `"${packet.contentFingerprint}" in the saved manifest — the two are not the same item set`,
    );
  }

  const expected = new Map(packet.items.map((item) => [item.itemId, item]));
  const answered = new Set(aggregate.items.map((item) => item.itemId));
  const unknown = aggregate.items.filter((item) => !expected.has(item.itemId)).map((item) => item.itemId);
  if (unknown.length > 0) {
    throw new Error(`the aggregate reports items packet ${packet.packetId} does not contain: ${unknown.join(", ")}`);
  }
  const missing = packet.items.filter((item) => !answered.has(item.itemId)).map((item) => item.itemId);
  if (missing.length > 0) {
    throw new Error(`the aggregate is missing ${missing.length} of packet ${packet.packetId}'s items: ${missing.join(", ")}`);
  }
  if (aggregate.items.length !== answered.size) {
    throw new Error(`the aggregate reports the same item twice in packet ${packet.packetId}`);
  }

  const items: PrototypePilotItemFinding[] = aggregate.items.map((item) => {
    const manifestItem = expected.get(item.itemId)!;
    for (const field of ["familyId", "band", "difficultyBucket", "difficulty"] as const) {
      if (item[field] !== manifestItem[field]) {
        throw new Error(
          `${item.itemId}: aggregate ${field} "${item[field]}" does not match the saved manifest's "${manifestItem[field]}"`,
        );
      }
    }
    const median = medianTimeBinSeconds(item.timeBinsSeconds);
    const budget = manifestItem.bandTimeBudgetSeconds;
    const withdrawalReasons: string[] = [];
    if (item.notationMisunderstandingReports > 0) {
      withdrawalReasons.push(
        `${item.notationMisunderstandingReports} of ${item.attempts} responses reported unclear notation`,
      );
    }
    const undescribed = item.attempts - item.intendedRelationshipDescriptions;
    if (undescribed > 0) {
      withdrawalReasons.push(
        `${undescribed} of ${item.attempts} responses did not describe the intended relationship`,
      );
    }
    if (item.defensibleAlternativeReports >= 2) {
      withdrawalReasons.push(
        `a repeated defensible alternative (${item.defensibleAlternativeReports} reports)`,
      );
    }
    const confusedMisses = item.attempts - item.correctAttempts - item.cleanMisses;
    if (confusedMisses > 0) {
      withdrawalReasons.push(
        `${confusedMisses} incorrect ${confusedMisses === 1 ? "response was" : "responses were"} confused or ambiguous rather than a clean miss`,
      );
    }
    if (median !== null && median > budget) {
      withdrawalReasons.push(`median ${median}s over the ${budget}s ${item.band} budget`);
    }
    return {
      itemId: item.itemId,
      familyId: item.familyId,
      band: item.band,
      difficultyBucket: item.difficultyBucket,
      difficulty: item.difficulty,
      attempts: item.attempts,
      correctAttempts: item.correctAttempts,
      cleanMisses: item.cleanMisses,
      medianSolveTimeSeconds: median,
      bandTimeBudgetSeconds: budget,
      headroomSeconds: median === null ? null : budget - median,
      withdrawalReasons,
    };
  });

  const flagged = items.filter((item) => item.withdrawalReasons.length > 0);

  const deep = items.filter((item) => item.difficulty >= 4);
  const cleanMisses = deep.reduce((sum, item) => sum + item.cleanMisses, 0);
  const cleanMissGate = {
    pass: cleanMisses >= ESCALATION_MINIMUM_CLEAN_MISSES,
    minimum: ESCALATION_MINIMUM_CLEAN_MISSES,
    cleanMisses,
    deepItems: deep.length,
    contributors: deep
      .filter((item) => item.cleanMisses > 0)
      .map((item) => ({ itemId: item.itemId, cleanMisses: item.cleanMisses })),
  };

  const deepest = items.filter((item) => item.difficulty === 5);
  const overBudget = deepest.filter((item) => item.headroomSeconds !== null && item.headroomSeconds < 0);
  const headrooms = deepest.flatMap((item) => item.headroomSeconds === null ? [] : [item.headroomSeconds]);
  const medianHeadroom = nearestRankMedian(headrooms);
  const timeHeadroomGate = {
    // "Every d5 item stays within its band's budget" is the first half of the
    // plan's second branch; a d5 item with no recorded time cannot satisfy it.
    pass: deepest.length > 0 &&
      overBudget.length === 0 &&
      headrooms.length === deepest.length &&
      medianHeadroom !== null &&
      medianHeadroom <= ESCALATION_MAXIMUM_MEDIAN_HEADROOM_SECONDS,
    maximumMedianHeadroomSeconds: ESCALATION_MAXIMUM_MEDIAN_HEADROOM_SECONDS,
    deepestItems: deepest.length,
    overBudget,
    medianHeadroomSeconds: medianHeadroom,
  };

  return {
    packetId: aggregate.packetId,
    packetContentFingerprint: aggregate.packetContentFingerprint,
    items,
    withdrawalReview: { flagged, clearedItems: items.length - flagged.length },
    cleanMissGate,
    timeHeadroomGate,
    escalation: {
      pass: cleanMissGate.pass || timeHeadroomGate.pass,
      branch: cleanMissGate.pass ? "clean-misses" : timeHeadroomGate.pass ? "time-headroom" : null,
    },
  };
}
