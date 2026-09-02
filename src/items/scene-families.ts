import { createHash } from "node:crypto";
import { pick, shuffled, type Rng } from "../lib/rng";
import {
  areScenesCategoricallyDistinct,
  DISTRACTORS_PER_ITEM,
  GATE_STRIP_COLUMNS,
  GATE_STRIP_ROWS,
  MAXIMUM_GATE_STRIP_COLUMNS,
  isScene,
  sceneSignature,
  type Puzzle,
  type Scene,
  type SceneObject,
  type ScenePlacement,
  type SceneToken,
} from "./schema";
import {
  acceptFamilyCandidate,
  type AcceptanceResult,
  type DistractorWitness,
  type FamilyDefinition,
  type ValidationReport,
} from "./family";
import {
  applySceneBinary,
  applySceneCompositionPrimitive,
  applySceneUnary,
  enumerateSceneOrderedCompositions,
  enumerateSceneOrderedFiveStepCompositions,
  enumerateSceneOrderedFourStepCompositions,
  enumerateSceneOrderedThreeStepCompositions,
  isSceneComposedProgram,
  sceneComposedPrimitives,
  sceneComposedProgramFromSteps,
  sceneComposedProgramKey,
  sceneComposedProgramSteps,
  type SceneBinaryOperation,
  type SceneComposedProgram,
  type SceneComposedProgramLength,
  type SceneCompositionPrimitive,
  type ScenePosition,
  type SceneUnaryOperation,
} from "./scene-grammar";
import { rankByCloseness } from "./scene-distance";

export const SCENE_FAMILY_IDS = [
  "relational-sequence-v2",
  "attribute-pairing-v1",
  "compositional-analogy-v2",
  "composed-transform-v2",
  "relational-matrix-v2",
  "visual-set-algebra-v2",
  "spatial-transform-v2",
  "transformation-machine-v3",
  "rule-switching-v2",
  "second-order-sequence-v2",
  "inverse-analogy-v2",
  "parallel-evolution-v1",
  "combining-machine-v1",
] as const;
export type SceneFamilyId = (typeof SCENE_FAMILY_IDS)[number];

/**
 * One named generation bucket: what a family produces when a schedule asks for
 * that bucket by name.
 *
 * Difficulty used to be a label pinned on whatever a family happened to
 * generate. It is now an INPUT: `generateSceneFamilyCandidate` refuses a bucket
 * this table does not declare, and the promotion registry may only enable a
 * bucket declared here. A schedule can therefore never ask a family for depth
 * it cannot actually produce, and a family can never quietly serve a shallower
 * item than the slot promised.
 */
export interface SceneFamilyBucket {
  /** Bucket id. Ends in `-d1` through `-d6`; that digit is the difficulty. */
  bucket: string;
  /** Difficulty every accepted draw in this bucket carries. */
  difficulty: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Ordered rule steps EVERY draw in this bucket makes the solver apply.
   *
   * This replaces the old `programDepth(band)` guess, which called every
   * composition item two steps and everything above it three, whatever the
   * family actually did. It is a floor, not an average, so a deeper bucket is
   * a real, checkable increase rather than a relabelling.
   */
  programDepth: number;
}

/**
 * Every bucket every family supports, easiest first.
 *
 * A bucket here is not a promise that anything is served, only that the
 * generator can produce it — a prototype family declares its buckets like any
 * other. Withdrawn families used to keep a verifier-only bucket so the build
 * sweep still covered them; the ten that were never served were deleted outright
 * on 2026-08-27, so no such bucket remains. What may be served is decided by
 * `CURRENT_FAMILY_PROMOTION_REGISTRY`, and the parity check in
 * `scripts/scene-family-verify.ts` proves every enabled registry bucket appears
 * here with the same difficulty.
 *
 * Bucket ids drop the family's version suffix. The one exception is
 * `relational-outlier-v3`: it is a redesign of a withdrawn family and would
 * otherwise take its predecessor's id, so it keeps the version and bucket ids
 * stay unique across the whole table.
 */
export const SCENE_FAMILY_BUCKETS: Readonly<Record<SceneFamilyId, readonly SceneFamilyBucket[]>> = {
  // One perimeter step per panel; the fill delta may be zero, so one step is
  // all a draw is guaranteed to show.
  "relational-sequence-v2": [{ bucket: "relational-sequence-d2", difficulty: 2, programDepth: 1 }],
  // One analogical mapping carried to the query token.
  "attribute-pairing-v1": [{ bucket: "attribute-pairing-d2", difficulty: 2, programDepth: 1 }],
  // d3 is board movement and fill cycling, both demonstrated by the worked pair.
  // d4 adds a third demonstrated change: every arrow turns where it stands.
  "compositional-analogy-v2": [
    { bucket: "compositional-analogy-d3", difficulty: 3, programDepth: 2 },
    { bucket: "compositional-analogy-d4", difficulty: 4, programDepth: 3 },
  ],
  // d4 demonstrates and applies two gates. d5 demonstrates and applies three,
  // sometimes in a different order from the worked rows. No worked example is
  // irrelevant to the requested result.
  "composed-transform-v2": [
    { bucket: "composed-transform-d4", difficulty: 4, programDepth: 2 },
    { bucket: "composed-transform-d5", difficulty: 5, programDepth: 3 },
    { bucket: "composed-transform-d6", difficulty: 6, programDepth: 5 },
  ],
  // A row rule and a column rule, both needed for the missing corner.
  "relational-matrix-v2": [{ bucket: "relational-matrix-d4", difficulty: 4, programDepth: 2 }],
  // Two or three combining gates, never more: the three-gate ceiling of
  // 2026-08-27 applies here like everywhere else.
  "combining-machine-v1": [
    { bucket: "combining-machine-d4", difficulty: 4, programDepth: 2 },
    { bucket: "combining-machine-d5", difficulty: 5, programDepth: 3 },
  ],
  // d4 combines the two boards and then transforms the combined result. d5 adds
  // a third visible step: every orientable token on that result turns in place.
  "visual-set-algebra-v2": [
    { bucket: "visual-set-algebra-d4", difficulty: 4, programDepth: 2 },
    { bucket: "visual-set-algebra-d5", difficulty: 5, programDepth: 3 },
  ],
  // One spatial transformation of the whole arrangement belongs in warmup.
  "spatial-transform-v2": [{ bucket: "spatial-transform-d2", difficulty: 2, programDepth: 1 }],
  // Worked gates applied in the order the query path shows them: d5 shows
  // three, d6 four. The depth counts those displayed gates — nothing else.
  // Every gate is provably load-bearing: a program whose answer survives
  // deleting any one of them is not servable, so a four-gate item really costs
  // four reading steps.
  "transformation-machine-v3": [
    { bucket: "transformation-machine-d5", difficulty: 5, programDepth: 3 },
    { bucket: "transformation-machine-d6", difficulty: 6, programDepth: 4 },
  ],
  // Two gates are demonstrated, but the query selects exactly one to apply. A
  // one-operation result belongs in the easy opening pool, never the hard tail.
  "rule-switching-v2": [{ bucket: "rule-switching-d2", difficulty: 2, programDepth: 1 }],
  // A step rule plus the rule governing how that step grows.
  "second-order-sequence-v2": [{ bucket: "second-order-sequence-d4", difficulty: 4, programDepth: 2 }],
  // Two changes, run in reverse to recover the missing input.
  "inverse-analogy-v2": [{ bucket: "inverse-analogy-d4", difficulty: 4, programDepth: 2 }],
  // Depth counts the separate rule applications that turn the last shown
  // board into the answer, one per token. d3 draws single-aspect rules, so
  // that is three (one aspect each); d4 always includes at least one
  // both-aspect rule, so it is four.
  "parallel-evolution-v1": [
    { bucket: "parallel-evolution-d3", difficulty: 3, programDepth: 3 },
    { bucket: "parallel-evolution-d4", difficulty: 4, programDepth: 4 },
  ],
};

/** Every bucket a family declares, easiest first. */
export function sceneFamilyBucketsFor(familyId: SceneFamilyId): readonly SceneFamilyBucket[] {
  return SCENE_FAMILY_BUCKETS[familyId];
}

/**
 * The declaration for one named bucket, or an error naming what is available.
 *
 * Callers that are assembling a test treat the error as an ordinary rejected
 * draw, so a registry that has drifted ahead of the generator thins a band
 * loudly rather than serving something the slot did not ask for.
 */
export function requireSceneFamilyBucket(familyId: SceneFamilyId, bucket: string): SceneFamilyBucket {
  const declared = SCENE_FAMILY_BUCKETS[familyId].find((entry) => entry.bucket === bucket);
  if (!declared) {
    throw new Error(
      `${familyId} does not declare difficulty bucket "${bucket}"; it declares ` +
        SCENE_FAMILY_BUCKETS[familyId].map((entry) => entry.bucket).join(", "),
    );
  }
  return declared;
}

/** The easiest bucket a family declares — what a band's first occurrence uses. */
export function entrySceneFamilyBucket(familyId: SceneFamilyId): SceneFamilyBucket {
  return SCENE_FAMILY_BUCKETS[familyId][0];
}

export interface SceneFamilyCandidate {
  familyId: SceneFamilyId;
  puzzle: Puzzle<Scene>;
  definition: FamilyDefinition<Scene, string>;
  /**
   * For extrapolation layouts (type "sequence", layout "row"): which stem
   * panels belong to the strand that ends in the blank, in reading order.
   *
   * This used to be a bare count the family declared about itself, which the
   * build gate had to take on trust — exactly the kind of unchecked claim that
   * let interleaved-sequence-v2 ship a row whose answered strand showed only
   * one transition. Panel indexes are checkable against the puzzle:
   * `checkAnsweredStrand` re-reads the stem and proves the strand really is a
   * constant-stride run of visible panels whose next slot is the blank, and
   * that it shows at least `MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND` terms.
   * Families with other layouts leave it undefined.
   */
  answeredStrandPanelIndexes?: readonly number[];
}

/**
 * How many terms of the answered strand an extrapolation row must show.
 *
 * A sequence item asks the solver to KEEP GOING, so the step has to be
 * observed at least twice before it is applied. One observed transition is an
 * assumption, not evidence.
 */
export const MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND = 3;

/** What `checkAnsweredStrand` found when it re-read one candidate's stem. */
export interface AnsweredStrandCheck {
  /** Visible terms in the answered strand, or null when the item is not an extrapolation row. */
  observedTerms: number | null;
  /** Null when the declaration holds up against the stem; otherwise what is wrong with it. */
  problem: string | null;
}

/**
 * Verify a candidate's declared answered strand against its own stem.
 *
 * Extrapolation items only: an `oddOneOut` also uses layout "row", but with an
 * empty stem — its options are the items and nothing is extrapolated, so it
 * declares no strand and is not checked.
 *
 * For an extrapolation row the declaration must name panels that are inside
 * the stem, strictly increasing, visible rather than blank, evenly spaced, and
 * spaced so that one more stride lands exactly on the trailing blank — the
 * blank is the strand's next slot. Only then is the number of declared panels
 * really the number of terms the solver can read.
 */
export function checkAnsweredStrand(candidate: SceneFamilyCandidate): AnsweredStrandCheck {
  const { puzzle } = candidate;
  const declared = candidate.answeredStrandPanelIndexes;
  if (puzzle.type !== "sequence" || puzzle.layout !== "row") {
    return {
      observedTerms: null,
      problem: declared === undefined
        ? null
        : "declares an answered strand but is not an extrapolation row",
    };
  }
  if (declared === undefined) {
    return { observedTerms: null, problem: "no answeredStrandPanelIndexes declared" };
  }

  const observedTerms = declared.length;
  const fault = (problem: string): AnsweredStrandCheck => ({ observedTerms, problem });
  const blankIndexes = puzzle.stem.flatMap((panel, index) => "blank" in panel ? [index] : []);
  if (blankIndexes.length !== 1) {
    return fault(`an extrapolation row needs exactly one blank panel but has ${blankIndexes.length}`);
  }
  const blankIndex = blankIndexes[0];

  const outOfRange = declared.find((index) =>
    !Number.isInteger(index) || index < 0 || index >= puzzle.stem.length);
  if (outOfRange !== undefined) {
    return fault(`panel index ${outOfRange} is outside the ${puzzle.stem.length}-panel stem`);
  }
  for (let position = 1; position < declared.length; position++) {
    if (declared[position] <= declared[position - 1]) {
      return fault(
        `panel indexes must strictly increase, but ${declared[position - 1]} is followed by ${declared[position]}`,
      );
    }
  }
  const blankTerm = declared.find((index) => "blank" in puzzle.stem[index]);
  if (blankTerm !== undefined) return fault(`panel ${blankTerm} is blank, so it shows no term`);
  if (observedTerms < MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND) {
    return fault(`only ${observedTerms} observed term${observedTerms === 1 ? "" : "s"} in the answered strand`);
  }

  const stride = declared[1] - declared[0];
  const unevenAt = declared.findIndex((index, position) =>
    position > 0 && index - declared[position - 1] !== stride);
  if (unevenAt !== -1) {
    return fault(`panel indexes ${declared.join(", ")} do not share one stride`);
  }
  const lastTerm = declared[observedTerms - 1];
  if (lastTerm + stride !== blankIndex) {
    return fault(
      `a stride of ${stride} from panel ${lastTerm} lands on ${lastTerm + stride}, not on the blank at ${blankIndex}`,
    );
  }
  return { observedTerms, problem: null };
}

function token(
  shape: SceneToken["shape"],
  fill: SceneToken["fill"] = "outline",
  size: SceneToken["size"] = "l",
): SceneToken {
  return { kind: "token", shape, rotation: 0, fill, size };
}

function scene(
  placements: Array<{ row: number; column: number; object: SceneObject }>,
  rows = 3,
  columns = 3,
): Scene {
  return { kind: "scene", rows, columns, objects: placements, tiles: [] };
}

function one(shape: SceneToken["shape"], row: number, column: number, fill: SceneToken["fill"] = "outline"): Scene {
  return scene([{ row, column, object: token(shape, fill) }]);
}

function optionOrder(answer: Scene, distractors: readonly Scene[], rng: Rng): { options: Scene[]; answerIndex: number } {
  const all = [answer, ...distractors];
  const order = shuffled(rng, all.map((_, index) => index));
  return { options: order.map((index) => all[index]), answerIndex: order.indexOf(0) };
}

function scenePanel(panel: Puzzle<Scene>["stem"][number] | undefined): Scene | null {
  return panel && !("blank" in panel) ? panel : null;
}

/**
 * How many times `selectDistractors` had to look past the nearest
 * `slots + 2` candidates because the closest ones were not categorically
 * distinct from one another.
 *
 * The owner chose a tight window, so this widening is a safety valve, not a
 * strategy: it exists only so a family with an awkward pool degrades instead of
 * failing to generate. A test asserts it stays at zero across every declared
 * bucket, which is what makes "the near misses come from the closest few" a
 * checked promise rather than a hope.
 */
let widenedSelections = 0;

/** Read the widening counter — diagnostics only. */
export function widenedDistractorSelections(): number {
  return widenedSelections;
}

/** Reset the widening counter so a test can measure one sweep. */
export function resetWidenedDistractorSelections(): void {
  widenedSelections = 0;
}

/**
 * Choose the wrong options for one item, closest to the answer first.
 *
 * Every family builds its near misses from its own rule grammar and hands the
 * whole pool here. Taking the count from one constant is what lets the battery
 * change option count in a single edit. A family whose pool is too thin throws,
 * so a grammar that cannot support the current option count fails loudly at
 * generation instead of quietly serving an easier item.
 *
 * Until 2026-08-25 the optional slots were a uniform sample of the pool, so a
 * distractor that rebuilt half the board shipped as readily as one that
 * recoloured a single token, and the easy elimination was the common case.
 * Now the pool is ranked by `sceneEditDistance` to the answer and the optional
 * slots are drawn from the closest `slots + 2` candidates. The two spare
 * places keep the choice seeded rather than fixed: the same rng still replays
 * the same options, but two items built from one grammar do not always serve
 * the same near misses.
 */
/**
 * The aspects a solver can infer one at a time.
 *
 * The owner's report of 2026-08-27: "the answers are so different from each
 * other, and using only one first inference you can select the right answer
 * without looking at the other rules." Measured, that was true of EVERY item in
 * four buckets — work out where the tokens go and `fold-punch`, `relational-
 * matrix` and `second-order-sequence` were solved without ever reading a shape
 * or a fill.
 *
 * Closeness ranking alone cannot fix that. A distractor can sit close to the
 * answer overall and still be the only board with the answer's exact footprint,
 * which hands the whole item to one inference. What stops it is agreement: for
 * every aspect below, at least one WRONG option must match the answer on that
 * aspect, so knowing that aspect alone never narrows the six to one.
 */
const DISTRACTOR_ASPECTS: readonly { readonly name: string; readonly of: (scene: Scene) => string }[] = [
  { name: "positions", of: (scene) => sceneAspectKey(scene, (placement) => `${placement.row},${placement.column}`) },
  { name: "shapes", of: (scene) => sceneAspectKey(scene, (placement) => tokenOf(placement)?.shape ?? "-") },
  { name: "fills", of: (scene) => sceneAspectKey(scene, (placement) => tokenOf(placement)?.fill ?? "-") },
  { name: "rotations", of: (scene) => sceneAspectKey(scene, (placement) => String(tokenOf(placement)?.rotation ?? 0)) },
  { name: "count", of: (scene) => String(scene.objects.length) },
];

function tokenOf(placement: ScenePlacement): SceneToken | null {
  return placement.object.kind === "token" ? placement.object : null;
}

/** An order-free fingerprint of one aspect, so two boards agree on it or do not. */
function sceneAspectKey(scene: Scene, read: (placement: ScenePlacement) => string): string {
  return [...scene.objects].map(read).sort().join("|");
}

/**
 * Wrong options that left some aspect of the answer unmatched, because the
 * family's near-miss pool held nothing that agreed on it. Zero is the goal; a
 * test reports the families that cannot reach it rather than letting the gap
 * pass unseen.
 */
let uncoveredAspectSelections = 0;
export function uncoveredDistractorAspects(): number { return uncoveredAspectSelections; }
export function resetUncoveredDistractorAspects(): void { uncoveredAspectSelections = 0; }

/**
 * Can this near-miss pool supply the agreement the option list needs?
 *
 * `selectDistractors` takes, per aspect, the closest wrong option that matches
 * the answer on it — but it can only take one if the pool holds one. When the
 * pool does not, the item ships with an aspect that picks the answer on its own,
 * and no amount of re-choosing fixes it. Families whose inputs are drawn rather
 * than enumerated can do better than ship it: check the pool here and draw
 * again, the same way a draw with two defensible answers is redrawn.
 *
 * Only for families that CAN satisfy it. Where a family's whole rule shows up in
 * one aspect — `fold-punch` and `second-order-sequence`, whose options are one
 * token at different places — a board agreeing on that aspect would be the
 * answer, and asking for one would reject every draw forever.
 */
function poolCoversEveryAspect(answer: Scene, pool: readonly Scene[]): boolean {
  return DISTRACTOR_ASPECTS.every((aspect) => {
    const target = aspect.of(answer);
    return pool.some((candidate) =>
      aspect.of(candidate) === target &&
      sceneSignature(candidate) !== sceneSignature(answer) &&
      areScenesCategoricallyDistinct(answer, candidate));
  });
}

function selectDistractors(
  pool: readonly Scene[],
  rng: Rng,
  familyName: string,
  options: {
    /** The correct scene. Near misses are ranked by how close they sit to it. */
    answer: Scene;
    /** Near misses that must appear whatever else is drawn — a family's sharpest contrast. */
    required?: readonly Scene[];
  },
): Scene[] {
  const { answer, required = [] } = options;
  const requiredKeys = new Set<string>();
  const kept: Scene[] = [];
  for (const contrast of required) {
    const key = sceneSignature(contrast);
    if (requiredKeys.has(key)) continue;
    // A required contrast skips the closeness ranking, so it must clear the
    // legibility floor here or nothing else will: the optional picks below are
    // checked against it, but it is never checked against them. The schema
    // rejects an illegible option pair too, but only after the whole candidate
    // is built — failing at the source names the family and the contrast.
    if (!areScenesCategoricallyDistinct(answer, contrast)) {
      throw new Error(
        `${familyName} requires a near miss that is not categorically distinct from its own answer`,
      );
    }
    for (const chosen of kept) {
      if (!areScenesCategoricallyDistinct(chosen, contrast)) {
        throw new Error(
          `${familyName} requires two near misses that are not categorically distinct from each other`,
        );
      }
    }
    requiredKeys.add(key);
    kept.push(contrast);
  }
  if (kept.length >= DISTRACTORS_PER_ITEM) return kept.slice(0, DISTRACTORS_PER_ITEM);

  const seen = new Set<string>([sceneSignature(answer), ...requiredKeys]);
  const rest: Scene[] = [];
  for (const candidate of pool) {
    const key = sceneSignature(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    rest.push(candidate);
  }
  const ranked = rankByCloseness(rest, answer, (candidate) => candidate);
  const slots = DISTRACTORS_PER_ITEM - kept.length;

  // Closeness and legibility pull in opposite directions: the nearest
  // candidates are also the likeliest to be indistinguishable from the answer
  // rather than merely similar, and an option pair that is not categorically
  // distinct is rejected by the schema (see `areScenesCategoricallyDistinct`).
  // Legibility wins. A window that cannot fill its slots with categorically
  // distinct scenes grows by one candidate and is drawn again, so a family
  // only fails when its whole pool is too thin — never because the closest few
  // happened to be illegible together.
  const nearestWindow = Math.min(slots + 2, ranked.length);
  for (let window = nearestWindow; window <= ranked.length; window++) {
    if (window > nearestWindow) widenedSelections += 1;
    const selected = [...kept];
    const admits = (candidate: Scene) =>
      areScenesCategoricallyDistinct(answer, candidate) &&
      selected.every((chosen) => areScenesCategoricallyDistinct(chosen, candidate));

    // First, agreement. For every aspect the answer has, take the CLOSEST wrong
    // option that matches the answer on it, searching the whole ranked pool
    // rather than the nearest window — an item is only worth solving if no
    // single inference narrows the six to one, and the candidate that supplies
    // that agreement is sometimes just outside the window. Aspects are visited
    // in a fixed order, so the choice replays with the seed.
    for (const aspect of DISTRACTOR_ASPECTS) {
      if (selected.length === DISTRACTORS_PER_ITEM) break;
      const target = aspect.of(answer);
      if (selected.some((chosen) => aspect.of(chosen) === target)) continue;
      const agreeing = ranked.find((candidate) =>
        aspect.of(candidate) === target && !selected.includes(candidate) && admits(candidate));
      if (agreeing) selected.push(agreeing);
    }

    // Then closeness, for whatever slots the agreement pass left.
    for (const candidate of shuffled(rng, ranked.slice(0, window))) {
      if (selected.length === DISTRACTORS_PER_ITEM) break;
      if (selected.includes(candidate)) continue;
      if (admits(candidate)) selected.push(candidate);
    }
    if (selected.length === DISTRACTORS_PER_ITEM) {
      for (const aspect of DISTRACTOR_ASPECTS) {
        const target = aspect.of(answer);
        if (!selected.some((chosen) => aspect.of(chosen) === target)) uncoveredAspectSelections += 1;
      }
      return selected;
    }
  }
  throw new Error(
    `${familyName} needs ${DISTRACTORS_PER_ITEM} near misses but its grammar produced ` +
      `${kept.length + ranked.length} distinct candidates, no ${DISTRACTORS_PER_ITEM} of which ` +
      "stand apart from the answer and from each other",
  );
}

function distinctOutputs(outputs: readonly (Scene | null)[]): Scene[] {
  const unique = new Map<string, Scene>();
  for (const output of outputs) {
    if (output) unique.set(sceneSignature(output), output);
  }
  return [...unique.values()];
}

function actualWitnesses(
  options: readonly Scene[],
  answerIndex: number,
  witnessFor: (option: Scene) => string | null,
): DistractorWitness<string>[] {
  return options.flatMap((option, optionIndex) => {
    if (optionIndex === answerIndex) return [];
    const witness = witnessFor(option);
    return witness === null ? [] : [{ optionIndex, witness }];
  });
}

function asCandidate(
  family: FamilyDefinition<Scene, string>,
  puzzle: Puzzle<Scene>,
  answeredStrandPanelIndexes?: readonly number[],
): SceneFamilyCandidate {
  const familyId = family.familyId as SceneFamilyId;
  return {
    familyId,
    puzzle: { ...puzzle, familyId },
    definition: family,
    ...(answeredStrandPanelIndexes === undefined ? {} : { answeredStrandPanelIndexes }),
  };
}

function replayKey(familyId: SceneFamilyId, puzzle: Puzzle<Scene>, ruleKey: string): string {
  const visible = {
    familyId,
    ruleKey,
    stem: puzzle.stem.map((panel) => "blank" in panel ? "blank" : sceneSignature(panel)),
    options: puzzle.options.map(sceneSignature),
    answerIndex: puzzle.answerIndex,
  };
  return createHash("sha256").update(JSON.stringify(visible)).digest("hex").slice(0, 24);
}

function definition(
  familyId: SceneFamilyId,
  cueIds: readonly string[],
  ruleKey: string,
  validate: (puzzle: Puzzle<Scene>) => ValidationReport<Scene, string>,
): FamilyDefinition<Scene, string> {
  return {
    familyId,
    isVisual: isScene,
    visibleCueIds: () => cueIds,
    validate,
    programFingerprint: () => createHash("sha256").update(`${familyId}:${ruleKey}`).digest("hex").slice(0, 16),
    replayKey: (puzzle) => replayKey(familyId, puzzle, ruleKey),
  };
}

function makePuzzle(
  id: string,
  type: Puzzle["type"],
  layout: Puzzle["layout"],
  instruction: string,
  difficulty: SceneFamilyBucket["difficulty"],
  stem: Puzzle<Scene>["stem"],
  answer: Scene,
  distractors: readonly Scene[],
  rng: Rng,
  explanation: string,
): Puzzle<Scene> {
  const { options, answerIndex } = optionOrder(answer, distractors, rng);
  return { id, type, layout, instruction, difficulty, stem, options, answerIndex, explanation };
}

const RELATIONAL_RING_POSITIONS = [
  { row: 0, column: 0 },
  { row: 0, column: 1 },
  { row: 0, column: 2 },
  { row: 1, column: 2 },
  { row: 2, column: 2 },
  { row: 2, column: 1 },
  { row: 2, column: 0 },
  { row: 1, column: 0 },
] as const;

const RELATIONAL_FILLS = ["outline", "half", "solid"] as const;

interface RelationalStepProgram {
  positionDelta: -3 | -2 | -1 | 1 | 2 | 3 | 4;
  fillDelta: 0 | 1 | 2;
}

const RELATIONAL_STEP_GRAMMAR: readonly RelationalStepProgram[] =
  ([-3, -2, -1, 1, 2, 3, 4] as const).flatMap((positionDelta) =>
    ([0, 1, 2] as const).map((fillDelta) => ({ positionDelta, fillDelta })));

function relationalSceneParts(value: Scene): {
  anchor: Scene["objects"][number];
  moving: Scene["objects"][number] & { object: SceneToken };
} | null {
  if (value.rows !== 3 || value.columns !== 3 || value.objects.length !== 2 || value.tiles.length > 0) return null;
  const anchor = value.objects.find((placement) => placement.row === 1 && placement.column === 1);
  const moving = value.objects.find((placement) => placement !== anchor);
  if (!anchor || anchor.object.kind !== "token" || !moving || moving.object.kind !== "token") return null;
  if (RELATIONAL_RING_POSITIONS.every((position) =>
    position.row !== moving.row || position.column !== moving.column)) return null;
  return { anchor, moving: { ...moving, object: moving.object } };
}

function applyRelationalStep(input: Scene, program: RelationalStepProgram): Scene | null {
  const parts = relationalSceneParts(input);
  if (!parts) return null;
  const positionIndex = RELATIONAL_RING_POSITIONS.findIndex((position) =>
    position.row === parts.moving.row && position.column === parts.moving.column);
  const fillIndex = RELATIONAL_FILLS.indexOf(parts.moving.object.fill);
  if (positionIndex === -1 || fillIndex === -1) return null;
  const position = RELATIONAL_RING_POSITIONS[
    (positionIndex + program.positionDelta + RELATIONAL_RING_POSITIONS.length) % RELATIONAL_RING_POSITIONS.length
  ];
  const fill = RELATIONAL_FILLS[(fillIndex + program.fillDelta) % RELATIONAL_FILLS.length];
  return scene([
    parts.anchor,
    { ...position, object: { ...parts.moving.object, fill } },
  ]);
}

function matchingRelationalSteps(examples: readonly { input: Scene; output: Scene }[]): RelationalStepProgram[] {
  return RELATIONAL_STEP_GRAMMAR.filter((program) => examples.every((example) => {
    const output = applyRelationalStep(example.input, program);
    return output !== null && sceneSignature(output) === sceneSignature(example.output);
  }));
}

function relationalSequence(rng: Rng): SceneFamilyCandidate {
  const [anchorShape, movingShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const program = pick(rng, RELATIONAL_STEP_GRAMMAR);
  const startPosition = pick(rng, RELATIONAL_RING_POSITIONS);
  const startFill = pick(rng, RELATIONAL_FILLS);
  const start = scene([
    { row: 1, column: 1, object: token(anchorShape, "solid") },
    { ...startPosition, object: token(movingShape, startFill) },
  ]);
  const second = applyRelationalStep(start, program)!;
  const third = applyRelationalStep(second, program)!;
  const answer = applyRelationalStep(third, program)!;
  const distractors = distinctOutputs(RELATIONAL_STEP_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyRelationalStep(third, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "relational sequence", { answer });
  const direction = program.positionDelta > 0 ? "clockwise" : "counter-clockwise";
  const stepSize = Math.abs(program.positionDelta);
  const fillRule = program.fillDelta === 0
    ? "keeps the same fill"
    : program.fillDelta === 1
      ? "cycles outline to half to solid"
      : "cycles outline to solid to half";
  const puzzle = makePuzzle(
    "prototype-relational-sequence",
    "sequence",
    "row",
    "Continue both changes around the fixed centre token.",
    2,
    [start, second, third, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    `The solid centre token is the fixed anchor. In every step, the other token moves ${stepSize} perimeter slot${stepSize === 1 ? "" : "s"} ${direction} and ${fillRule}. Applying both visible changes once more gives the highlighted scene; each other option follows a different step or fill rule that fails one of the shown transitions.`,
  );
  const family = definition(
    "relational-sequence-v2",
    ["ordered-perimeter-slots", "fixed-centre-anchor", "fill-states"],
    JSON.stringify(program),
    (candidate) => {
      const [first, next, query] = candidate.stem.map(scenePanel);
      if (!first || !next || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const examples = [
        { input: first, output: next },
        { input: next, output: query },
      ];
      const survivors = matchingRelationalSteps(examples);
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyRelationalStep(query, candidateProgram)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["ordered-perimeter-slots", "fixed-centre-anchor", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (sceneSignature(option) === sceneSignature(query)) return "repeats the last scene instead of continuing the relation";
          const wrongRule = RELATIONAL_STEP_GRAMMAR.find((candidateProgram) => {
            const output = applyRelationalStep(query, candidateProgram);
            return output !== null && sceneSignature(output) === sceneSignature(option) &&
              !examples.every((example) => {
                const predicted = applyRelationalStep(example.input, candidateProgram);
                return predicted !== null && sceneSignature(predicted) === sceneSignature(example.output);
              });
          });
          return wrongRule
            ? `the ${wrongRule.positionDelta}, ${wrongRule.fillDelta} step rule fails a shown transition`
            : null;
        }),
      };
    },
  );
  // Single-strand row: every visible panel belongs to the answered strand, and
  // the blank is the next slot at the same stride of one.
  return asCandidate(family, puzzle, [0, 1, 2]);
}

type PairingRelation = "same" | "different";

interface AttributePairingProgram {
  shape: PairingRelation;
  fill: PairingRelation;
  direction: "right" | "down";
}

const ATTRIBUTE_PAIRING_GRAMMAR: readonly AttributePairingProgram[] =
  (["same", "different"] as const).flatMap((shape) =>
    (["same", "different"] as const).flatMap((fill) =>
      (["right", "down"] as const).map((direction) => ({ shape, fill, direction }))));

function singleTokenPlacement(value: Scene): (Scene["objects"][number] & { object: SceneToken }) | null {
  const placement = value.objects[0];
  return value.objects.length === 1 && value.tiles.length === 0 && placement?.object.kind === "token"
    ? { ...placement, object: placement.object }
    : null;
}

function pairingMatches(first: Scene, second: Scene, program: AttributePairingProgram): boolean {
  const left = singleTokenPlacement(first);
  const right = singleTokenPlacement(second);
  if (!left || !right) return false;
  const shapeMatches = left.object.shape === right.object.shape;
  const fillMatches = left.object.fill === right.object.fill;
  const placementMatches = program.direction === "right"
    ? right.row === left.row && right.column === left.column + 1
    : right.row === left.row + 1 && right.column === left.column;
  return shapeMatches === (program.shape === "same") &&
    fillMatches === (program.fill === "same") && placementMatches;
}

function attributePairing(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, ATTRIBUTE_PAIRING_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const fills = shuffled(rng, RELATIONAL_FILLS);
  const workedStart = { row: 0, column: 0 } as const;
  const workedEnd = program.direction === "right" ? { row: 0, column: 1 } : { row: 1, column: 0 };
  const queryStart = { row: 1, column: 1 } as const;
  const a = one(shapes[0], workedStart.row, workedStart.column, fills[0]);
  const b = one(
    program.shape === "same" ? shapes[0] : shapes[1],
    workedEnd.row,
    workedEnd.column,
    program.fill === "same" ? fills[0] : fills[1],
  );
  const query = one(shapes[2], queryStart.row, queryStart.column, fills[2]);
  // One partner token per pairing rule in the grammar. The rule that fits the
  // worked pair produces the answer; each of the others produces a near miss
  // witnessed by exactly the rule that predicts it and fails the worked pair.
  const partnerFor = (candidateProgram: AttributePairingProgram): Scene => {
    const end = candidateProgram.direction === "right"
      ? { row: queryStart.row, column: queryStart.column + 1 }
      : { row: queryStart.row + 1, column: queryStart.column };
    return one(
      candidateProgram.shape === "same" ? shapes[2] : shapes[3],
      end.row,
      end.column,
      candidateProgram.fill === "same" ? fills[2] : fills[0],
    );
  };
  const answer = partnerFor(program);
  const competingPartners = ATTRIBUTE_PAIRING_GRAMMAR
    .map(partnerFor)
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const puzzle = makePuzzle(
    "prototype-attribute-pairing",
    "analogy",
    "analogy",
    "Choose the token that keeps all three relationships.",
    2,
    [a, b, query],
    answer,
    selectDistractors(distinctOutputs(competingPartners), rng, "attribute pairing", { answer }),
    rng,
    `In the worked pair, the second token has ${program.shape === "same" ? "the same shape" : "a different shape"} and ${program.fill === "same" ? "the same fill" : "a different fill"}, and it sits ${program.direction === "right" ? "one slot to the right of" : "one slot below"} the first token. The highlighted option keeps all three relationships beside the query token. Every other choice is what a different shape, fill, and direction rule would predict, and each of those rules disagrees with the worked pair.`,
  );
  const family = definition(
    "attribute-pairing-v1",
    ["worked-token-pair", "shape-relation", "fill-relation", "pair-direction"],
    JSON.stringify(program),
    (candidate) => {
      const [workedFirst, workedSecond, queryInput] = candidate.stem.map(scenePanel);
      if (!workedFirst || !workedSecond || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = ATTRIBUTE_PAIRING_GRAMMAR.filter((candidateProgram) =>
        pairingMatches(workedFirst, workedSecond, candidateProgram));
      const selections = survivors.map((candidateProgram) => candidate.options.flatMap((option, optionIndex) =>
        pairingMatches(queryInput, option, candidateProgram) ? [optionIndex] : []));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["worked-token-pair", "shape-relation", "fill-relation", "pair-direction"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          survivors.length > 0 && survivors.every((candidateProgram) => !pairingMatches(queryInput, option, candidateProgram))
            ? "breaks at least one relationship shown by the worked token pair"
            : null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

type AnalogySpatialOperation = Extract<SceneUnaryOperation, { kind: "reflect" | "rotate" }>;

interface AnalogyCompositionProgram {
  spatial: AnalogySpatialOperation;
  fillDelta: 1 | 2;
  /**
   * Quarter-turns applied to every orientable token, on the spot. Present only
   * in the d4 bucket, whose worked pair shows three changes rather than two.
   */
  turn?: 1 | 3;
}

const ANALOGY_SPATIAL_GRAMMAR: readonly AnalogySpatialOperation[] = [
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
] as const;

/** d3: the board moves and every fill advances. Two visible changes. */
const ANALOGY_COMPOSITION_GRAMMAR: readonly AnalogyCompositionProgram[] =
  ANALOGY_SPATIAL_GRAMMAR.flatMap((spatial) =>
    ([1, 2] as const).map((fillDelta) => ({ spatial, fillDelta })));

/** d4: the same two changes, plus a turn of every orientable token. */
const ANALOGY_TURN_GRAMMAR: readonly AnalogyCompositionProgram[] =
  ANALOGY_COMPOSITION_GRAMMAR.flatMap((program) =>
    ([1, 3] as const).map((turn) => ({ ...program, turn })));

const COMPOSITIONAL_ANALOGY_TURN_BUCKET = "compositional-analogy-d4";

function cycleObjectFill(object: SceneObject, fillDelta: 1 | 2): SceneObject {
  const cycle = (value: SceneToken): SceneToken => ({
    ...value,
    fill: RELATIONAL_FILLS[(RELATIONAL_FILLS.indexOf(value.fill) + fillDelta) % RELATIONAL_FILLS.length],
  });
  return object.kind === "token"
    ? cycle(object)
    : { ...object, contents: object.contents.map(cycle) };
}

function applyAnalogyComposition(input: Scene, program: AnalogyCompositionProgram): Scene | null {
  const moved = applySceneUnary(input, program.spatial);
  if (moved === null) return null;
  const cycled: Scene = {
    ...moved,
    objects: moved.objects.map((placement) => ({
      ...placement,
      object: cycleObjectFill(placement.object, program.fillDelta),
    })),
  };
  return program.turn === undefined
    ? cycled
    : applySceneUnary(cycled, { kind: "turn", quarterTurns: program.turn });
}

function analogySpatialDescription(operation: AnalogySpatialOperation): string {
  if (operation.kind === "reflect") {
    return operation.axis === "horizontal" ? "reflects left to right" : "reflects top to bottom";
  }
  return `rotates ${operation.quarterTurns} quarter-turn${operation.quarterTurns === 1 ? "" : "s"} clockwise`;
}

function compositionalAnalogy(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const turning = bucket.bucket === COMPOSITIONAL_ANALOGY_TURN_BUCKET;
  const grammar = turning ? ANALOGY_TURN_GRAMMAR : ANALOGY_COMPOSITION_GRAMMAR;
  const program = pick(rng, grammar);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // The d4 bucket turns tokens as well as moving them, and a turn can only be
  // read off a token that has a direction, so one slot of each board carries an
  // arrow. d3 keeps the plain shapes it has always drawn.
  const a = scene([
    { row: 0, column: 0, object: token(turning ? "arrow" : shapes[0], "outline") },
    { row: 1, column: 2, object: token(shapes[1], "half") },
  ]);
  const b = applyAnalogyComposition(a, program)!;
  const c = scene([
    { row: 0, column: 1, object: token(shapes[2], "half") },
    { row: 2, column: 0, object: token(turning ? "arrow" : shapes[3], "solid") },
  ]);
  const answer = applyAnalogyComposition(c, program)!;
  const distractors = distinctOutputs(grammar
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyAnalogyComposition(c, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "compositional analogy", { answer });
  const cueIds = turning
    ? ["worked-pair", "board-slots", "fill-states", "token-orientation"]
    : ["worked-pair", "board-slots", "fill-states"];
  // The two-change wording is the d3 bucket's, unchanged: d3 items are a
  // released population and must replay byte for byte.
  const explanation = program.turn === undefined
    ? `The worked pair shows two clear changes. The whole board ${analogySpatialDescription(program.spatial)}, while every token advances ${program.fillDelta} step${program.fillDelta === 1 ? "" : "s"} through outline, half, and solid fill. Applying both changes to the third board gives the highlighted option. Each distractor is produced by a different bounded spatial or fill program that fails the worked pair.`
    : `The worked pair shows three clear changes. The whole board ${analogySpatialDescription(program.spatial)}, while every token advances ${program.fillDelta} step${program.fillDelta === 1 ? "" : "s"} through outline, half, and solid fill. Every arrow also turns a quarter-turn ${program.turn === 1 ? "clockwise" : "anticlockwise"} where it stands, so its direction changes even though the slot it lands in is fixed by the board move. Applying all three changes to the third board gives the highlighted option. Each distractor is produced by a different bounded program in the same grammar that fails the worked pair.`;
  const puzzle = makePuzzle(
    "prototype-compositional-analogy",
    "analogy",
    "analogy",
    turning ? "Apply all three changes from the worked pair." : "Apply both changes from the worked pair.",
    bucket.difficulty,
    [a, b, c],
    answer,
    selectedDistractors,
    rng,
    explanation,
  );
  const family = definition(
    "compositional-analogy-v2",
    cueIds,
    JSON.stringify(program),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = grammar.filter((candidateProgram) => {
        const predicted = applyAnalogyComposition(input, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyAnalogyComposition(query, candidateProgram)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = grammar.find((candidateProgram) => {
            const queryOutput = applyAnalogyComposition(query, candidateProgram);
            const workedOutput = applyAnalogyComposition(input, candidateProgram);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(output));
          });
          return failedProgram ? "this spatial-and-fill program fails the worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * The eight ways two boards combine. See `SceneBinaryOperation` for why this
 * doubled on 2026-08-27; the short version is that the old four could not say
 * what happens when the boards hold different tokens at one position, so the
 * generator threw away every input pair that disagreed and the survivors looked
 * like toys.
 */
const SCENE_BINARY_GRAMMAR = [
  "union-left",
  "union-right",
  "intersection",
  "overlap-left",
  "overlap-right",
  "subtract",
  "mask-out",
  "exclusive",
] as const;

interface RelationalMatrixProgram {
  rowOperation: SceneBinaryOperation;
  columnOperation: SceneBinaryOperation;
}

const RELATIONAL_MATRIX_GRAMMAR: readonly RelationalMatrixProgram[] =
  SCENE_BINARY_GRAMMAR.flatMap((rowOperation) =>
    SCENE_BINARY_GRAMMAR.map((columnOperation) => ({ rowOperation, columnOperation })));

/**
 * Every non-empty subset of the four corner atoms, as a bitmask. The four input
 * boards are drawn from here rather than being fixed per rule pair: a fixed set
 * of inputs makes the whole option list collapse to three or four distinct
 * boards, which is not enough near misses to fill an option list.
 */
const RELATIONAL_MATRIX_MASKS: readonly number[] = Array.from({ length: 15 }, (_, index) => index + 1);

/** Input draws tried before this family gives up on the sampled rule pair. */
const RELATIONAL_MATRIX_INPUT_ATTEMPTS = 300;

/**
 * Which of each corner's three tokens a board holds — one base-3 digit per
 * corner, so 3^4 draws.
 *
 * It was two per corner until 2026-08-27. With two, a shape could sit at only
 * two of the four corners, so a board carrying the answer's shapes almost always
 * carried them in the answer's cells too — the same board. That left the answer
 * as the only option with its shape multiset in 80% of items, and a solver who
 * worked out which tokens survive was finished without ever working out where
 * they go. A third token per corner gives every shape three homes, which is what
 * lets a wrong option agree with the answer on shapes and still differ on
 * position.
 */
const RELATIONAL_MATRIX_VARIANTS: readonly number[] = Array.from({ length: 81 }, (_, index) => index);

function binaryOperationDescription(operation: SceneBinaryOperation): string {
  switch (operation) {
    case "union-left":
      return "keeps every occupied position from either input, and where the two disagree it keeps the first input's token";
    case "union-right":
      return "keeps every occupied position from either input, and where the two disagree it keeps the second input's token";
    case "intersection":
      return "keeps only the positions where both inputs hold the very same token";
    case "overlap-left":
      return "keeps every position both inputs occupy, whatever the tokens are, showing the first input's token";
    case "overlap-right":
      return "keeps every position both inputs occupy, whatever the tokens are, showing the second input's token";
    case "subtract":
      return "keeps the first input's tokens except where the second input repeats the very same token";
    case "mask-out":
      return "keeps the first input's tokens except wherever the second input has anything at all";
    case "exclusive":
      return "keeps the positions exactly one input occupies";
  }
}

function relationalMatrix(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // Three tokens per corner, not one.
  //
  // Until 2026-08-27 each corner held a single fixed token, so any two input
  // boards agreed wherever they overlapped and a CLASH was impossible. That had
  // the same two costs it had in `visual-set-algebra`: the eight combining
  // operations collapsed back to four, and — measured — every single item was
  // solvable from the answer's footprint alone, without ever reading a shape.
  // A solver only had to infer one of the two rules. With two tokens per corner
  // the operations separate, and the option list can hold a board that occupies
  // exactly the answer's cells while getting a token wrong, so knowing where
  // the tokens go no longer picks the answer on its own.
  const corners = [
    { row: 0, column: 0 },
    { row: 0, column: 2 },
    { row: 2, column: 0 },
    { row: 2, column: 2 },
  ] as const;
  const atomAt = (index: number, variant: number) =>
    ({ ...corners[index], object: token(shapes[(index + variant) % shapes.length]) });
  /**
   * `mask` says which corners a board occupies; `variants` says which of the
   * corner's two tokens it holds there. Two boards sharing a corner but not a
   * variant are the clash the old fixed atoms could never produce.
   */
  const fromDraw = (mask: number, variants: number) =>
    scene(corners.flatMap((_, index) =>
      (mask & (1 << index)) === 0 ? [] : [atomAt(index, Math.floor(variants / 3 ** index) % 3)]));

  /**
   * Build the whole board from four input masks, or reject the draw.
   *
   * A draw is kept only when the completed grid is well posed: every derived
   * board exists, the two visible rows and the two visible columns each pin
   * down a single operation, and the near misses are numerous enough to fill
   * the option list. Rejecting here rather than at acceptance keeps a thin draw
   * from costing the assembler a whole retry.
   */
  const build = (
    program: RelationalMatrixProgram,
    draws: readonly { mask: number; variants: number }[],
  ) => {
    const [topLeft, topMiddle, middleLeft, middleMiddle] =
      draws.map((draw) => fromDraw(draw.mask, draw.variants));
    const topRight = applySceneBinary(topLeft, topMiddle, program.rowOperation);
    const middleRight = applySceneBinary(middleLeft, middleMiddle, program.rowOperation);
    const bottomLeft = applySceneBinary(topLeft, middleLeft, program.columnOperation);
    const bottomMiddle = applySceneBinary(topMiddle, middleMiddle, program.columnOperation);
    if (!topRight || !middleRight || !bottomLeft || !bottomMiddle) return null;
    const answer = applySceneBinary(bottomLeft, bottomMiddle, program.rowOperation);
    if (!answer) return null;

    // A combined board that just repeats one of its two inputs makes the grid
    // look like it is copying rather than combining, and hides the rule.
    const repeatsAnInput = ([
      [topRight, topLeft, topMiddle],
      [middleRight, middleLeft, middleMiddle],
      [bottomLeft, topLeft, middleLeft],
      [bottomMiddle, topMiddle, middleMiddle],
    ] as const).some(([output, left, right]) =>
      sceneSignature(output) === sceneSignature(left) ||
      sceneSignature(output) === sceneSignature(right));
    if (repeatsAnInput) return null;

    // The solver may only use the operations the visible rows and columns leave
    // standing. If those survivors disagree about the missing board, the item
    // has more than one defensible answer and the draw is discarded.
    const consistent = (examples: readonly { left: Scene; right: Scene; output: Scene }[]) =>
      SCENE_BINARY_GRAMMAR.filter((operation) => examples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
    const rowSurvivors = consistent([
      { left: topLeft, right: topMiddle, output: topRight },
      { left: middleLeft, right: middleMiddle, output: middleRight },
    ]);
    const columnSurvivors = consistent([
      { left: topLeft, right: middleLeft, output: bottomLeft },
      { left: topMiddle, right: middleMiddle, output: bottomMiddle },
    ]);
    const predictions = distinctOutputs(rowSurvivors.flatMap((rowOperation) =>
      columnSurvivors.flatMap((columnOperation) => {
        const rowPrediction = applySceneBinary(bottomLeft, bottomMiddle, rowOperation);
        const columnPrediction = applySceneBinary(topRight, middleRight, columnOperation);
        return rowPrediction && columnPrediction &&
          sceneSignature(rowPrediction) === sceneSignature(columnPrediction)
          ? [rowPrediction]
          : [];
      })));
    if (predictions.length !== 1 || sceneSignature(predictions[0]) !== sceneSignature(answer)) return null;

    // Four kinds of near miss, each witnessed by a mistake a solver can
    // actually make: applying an operation that fails a worked row or column;
    // applying the right operation to the two boards in the wrong order (order
    // matters for subtract — for the commutative operations the swapped result
    // repeats the forward one and is deduplicated away); copying one of the
    // two boards being combined instead of combining them; and combining a
    // wrong PAIR of the visible boards.
    //
    // That fourth kind was added on 2026-08-27. The first three draw only on the
    // four boards that border the blank, and measured, that pool was too narrow
    // to hold a board carrying the answer's own shapes: in 80% of items the
    // answer was the only option with its shape multiset, so reading the row
    // rule alone finished the item and the column rule was decoration. Reaching
    // for the wrong two boards is the commonest real mistake on a 3x3 grid, and
    // it widens the pool enough that the option list can agree with the answer
    // on shapes while still differing on where those shapes sit.
    const visible = [topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle];
    const correctPair = new Set([
      `${sceneSignature(bottomLeft)}>${sceneSignature(bottomMiddle)}`,
      `${sceneSignature(topRight)}>${sceneSignature(middleRight)}`,
    ]);
    const wrongPairOutputs = visible.flatMap((left) =>
      visible.flatMap((right) => {
        if (sceneSignature(left) === sceneSignature(right)) return [];
        if (correctPair.has(`${sceneSignature(left)}>${sceneSignature(right)}`)) return [];
        return SCENE_BINARY_GRAMMAR.map((operation) => applySceneBinary(left, right, operation));
      }));
    const distractors = distinctOutputs([
      ...SCENE_BINARY_GRAMMAR.flatMap((operation) => [
        applySceneBinary(bottomLeft, bottomMiddle, operation),
        applySceneBinary(topRight, middleRight, operation),
        applySceneBinary(bottomMiddle, bottomLeft, operation),
        applySceneBinary(middleRight, topRight, operation),
      ]),
      bottomLeft, bottomMiddle, topRight, middleRight,
      ...wrongPairOutputs,
      ...visible,
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
    if (distractors.length < DISTRACTORS_PER_ITEM) return null;
    // The draw must also be able to hide the answer. A grid whose pool holds no
    // board carrying the answer's own shapes hands the item to whoever works out
    // which tokens survive, without ever working out where they land.
    if (!poolCoversEveryAspect(answer, distractors)) return null;

    return { topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, answer, distractors };
  };

  // Try the rule pairs in a random order and keep the first one whose inputs
  // work out. A pair that no draw can make well posed is simply skipped, so the
  // family never fails on an unusable combination it happened to sample first.
  let program: RelationalMatrixProgram | null = null;
  let board: ReturnType<typeof build> = null;
  for (const candidateProgram of shuffled(rng, RELATIONAL_MATRIX_GRAMMAR)) {
    for (let attempt = 0; attempt < RELATIONAL_MATRIX_INPUT_ATTEMPTS && !board; attempt++) {
      board = build(candidateProgram, [0, 0, 0, 0].map(() => ({
        mask: pick(rng, RELATIONAL_MATRIX_MASKS),
        variants: pick(rng, RELATIONAL_MATRIX_VARIANTS),
      })));
    }
    if (board) {
      program = candidateProgram;
      break;
    }
  }
  if (!board || !program) throw new Error("relational matrix found no well-posed input boards");
  const {
    topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, answer,
  } = board;
  const selectedDistractors = selectDistractors(board.distractors, rng, "relational matrix", { answer });
  const puzzle = makePuzzle(
    "prototype-relational-matrix",
    "matrix",
    "grid3x3",
    "Infer the row operation and the column operation. Which board satisfies both?",
    4,
    [topLeft, topMiddle, topRight, middleLeft, middleMiddle, middleRight, bottomLeft, bottomMiddle, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    `The two directions use independently demonstrated set rules on matching board positions. Across each row, the third board ${binaryOperationDescription(program.rowOperation)}. Down each column, the bottom board ${binaryOperationDescription(program.columnOperation)}. Applying both rules to the missing corner produces the same highlighted board; every distractor comes from a set rule that fails a worked row or column, from the right rule applied to the two boards in the wrong order, or from copying one of those two boards instead of combining them.`,
  );
  const family = definition(
    "relational-matrix-v2",
    ["worked-row-relations", "worked-column-relations", "shared-coordinate-frame"],
    JSON.stringify({ row: program.rowOperation, column: program.columnOperation }),
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      if (panels.some((panel, index) => index !== 8 && panel === null)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const [a, b, rowA, c, d, rowB, colA, colB] = panels as Scene[];
      const rowExamples = [{ left: a, right: b, output: rowA }, { left: c, right: d, output: rowB }];
      const columnExamples = [{ left: a, right: c, output: colA }, { left: b, right: d, output: colB }];
      const rowSurvivors = SCENE_BINARY_GRAMMAR.filter((operation) => rowExamples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const columnSurvivors = SCENE_BINARY_GRAMMAR.filter((operation) => columnExamples.every((example) => {
        const output = applySceneBinary(example.left, example.right, operation);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predictions = distinctOutputs(rowSurvivors.flatMap((rowOperation) =>
        columnSurvivors.flatMap((columnOperation) => {
          const rowPrediction = applySceneBinary(colA, colB, rowOperation);
          const columnPrediction = applySceneBinary(rowA, rowB, columnOperation);
          return rowPrediction && columnPrediction && sceneSignature(rowPrediction) === sceneSignature(columnPrediction)
            ? [rowPrediction]
            : [];
        })));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-row-relations", "worked-column-relations", "shared-coordinate-frame"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const predicts = (left: Scene, right: Scene, operation: SceneBinaryOperation): boolean => {
            const output = applySceneBinary(left, right, operation);
            return output !== null && sceneSignature(output) === sceneSignature(option);
          };
          const rowAlternative = SCENE_BINARY_GRAMMAR.find((operation) =>
            predicts(colA, colB, operation) && !rowSurvivors.includes(operation));
          if (rowAlternative) return `${rowAlternative} predicts this board but fails a worked row`;
          const columnAlternative = SCENE_BINARY_GRAMMAR.find((operation) =>
            predicts(rowA, rowB, operation) && !columnSurvivors.includes(operation));
          if (columnAlternative) return `${columnAlternative} predicts this board but fails a worked column`;
          // A rule can fit the worked rows and still be contradicted by the
          // column direction (or the other way round). Such a board loses on the
          // second direction, not on the first.
          const rowOnly = rowSurvivors.find((operation) => predicts(colA, colB, operation));
          if (rowOnly) return `${rowOnly} fits the rows but no column rule agrees with this board`;
          const columnOnly = columnSurvivors.find((operation) => predicts(rowA, rowB, operation));
          if (columnOnly) return `${columnOnly} fits the columns but no row rule agrees with this board`;
          const swappedRow = SCENE_BINARY_GRAMMAR.find((operation) => predicts(colB, colA, operation));
          if (swappedRow) return `${swappedRow} predicts this board only with the two boards in the wrong order`;
          const swappedColumn = SCENE_BINARY_GRAMMAR.find((operation) => predicts(rowB, rowA, operation));
          if (swappedColumn) return `${swappedColumn} predicts this board only with the two boards in the wrong order`;
          const copied = [a, b, rowA, c, d, rowB, colA, colB].some((board) =>
            sceneSignature(board) === sceneSignature(option));
          if (copied) return "copies a board from the grid instead of combining the two beside the blank";
          // Last, the widest category: the right kind of rule applied to the
          // wrong two boards of the grid. It is checked last so a board that any
          // sharper mistake explains is named by that mistake instead.
          const visible = [a, b, rowA, c, d, rowB, colA, colB];
          for (const left of visible) {
            for (const right of visible) {
              if (sceneSignature(left) === sceneSignature(right)) continue;
              const operation = SCENE_BINARY_GRAMMAR.find((candidateOperation) =>
                predicts(left, right, candidateOperation));
              if (operation) return `${operation} applied to the wrong two boards of the grid`;
            }
          }
          return null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

interface SetAlgebraProgram {
  operation: SceneBinaryOperation;
  spatial: AnalogySpatialOperation;
  /**
   * Quarter-turns applied to every orientable token of the combined board,
   * after the spatial move. Present only in the d5 bucket, whose rule is three
   * visible steps rather than two.
   */
  turn?: 1 | 3;
}

const SET_ALGEBRA_SPATIAL_GRAMMAR: readonly AnalogySpatialOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
] as const;

/** d4: combine the two boards, then move the result. Two visible steps. */
const SET_ALGEBRA_GRAMMAR: readonly SetAlgebraProgram[] = SCENE_BINARY_GRAMMAR.flatMap((operation) =>
  SET_ALGEBRA_SPATIAL_GRAMMAR.map((spatial) => ({ operation, spatial })));

/** d5: the same two steps, then a turn of every orientable token. */
const SET_ALGEBRA_TURN_GRAMMAR: readonly SetAlgebraProgram[] = SET_ALGEBRA_GRAMMAR.flatMap((program) =>
  ([1, 3] as const).map((turn) => ({ ...program, turn })));

const SET_ALGEBRA_TURN_BUCKET = "visual-set-algebra-d5";

function applySetAlgebraProgram(left: Scene, right: Scene, program: SetAlgebraProgram): Scene | null {
  const combined = applySceneBinary(left, right, program.operation);
  const moved = combined ? applySceneUnary(combined, program.spatial) : null;
  if (!moved || program.turn === undefined) return moved;
  return applySceneUnary(moved, { kind: "turn", quarterTurns: program.turn });
}

function setOperationExplanation(program: SetAlgebraProgram): string {
  // The two-step wording is the d4 bucket's, unchanged: d4 items are a released
  // population and must replay byte for byte.
  if (program.turn === undefined) {
    return `The two completed rows demonstrate the same two-part rule. First, aligned positions are combined so the output ${binaryOperationDescription(program.operation)}; then that result ${analogySpatialDescription(program.spatial)}. Board positions and token identities make both steps visible. Applying the complete rule to the last pair gives the highlighted option. Each distractor comes from another set-and-spatial program that fails at least one worked row.`;
  }
  return `The two completed rows demonstrate the same three-part rule. First, aligned positions are combined so the output ${binaryOperationDescription(program.operation)}; then that result ${analogySpatialDescription(program.spatial)}. Last, every arrow and triangle left on that board turns a quarter-turn ${program.turn === 1 ? "clockwise" : "anticlockwise"} where it stands, which moves no token but changes every direction. Board positions, token identities, and token directions make all three steps visible. Applying the complete rule to the last pair gives the highlighted option. Each distractor comes from another program in the same grammar that fails at least one worked row.`;
}

/**
 * The four roles a board position can play in a set-algebra row, and the reason
 * the family builds every row to contain all four.
 *
 * Until 2026-08-27 the two input boards were a fixed diagonal: two tokens each,
 * at (0,0)+(1,1) and (1,1)+(2,2), with the SAME token in the shared slot. The
 * owner called the results toys and they were, for a reason worth writing down.
 * On that skeleton a clash is impossible, so `union-left` and `union-right`
 * agree, `overlap-left`, `overlap-right` and `intersection` all agree, and
 * `subtract` and `mask-out` agree — eight operations collapse to four outputs,
 * and each output holds at most two tokens.
 *
 * A row that contains one of each role below separates all eight, because each
 * operation keeps a different subset of the roles:
 *
 * | role                      | uL | uR | int | oL | oR | sub | mask | excl |
 * |---------------------------|----|----|-----|----|----|-----|------|------|
 * | shared, same token        | y  | y  |  y  | y  | y  |  .  |  .   |  .   |
 * | shared, different tokens  | L  | R  |  .  | L  | R  |  L  |  .   |  .   |
 * | left only                 | y  | y  |  .  | .  | .  |  y  |  y   |  y   |
 * | right only                | y  | y  |  .  | .  | .  |  .  |  .   |  y   |
 *
 * No two columns match, so the worked rows pin exactly one operation and the
 * query yields seven distinct near misses — five of which the option list
 * needs. Boards go from two tokens to three, and answers from at most two to
 * as many as four, which is the "expand this a lot" the owner asked for. Three
 * tokens on a 3x3 board is the same density the machine families already ship,
 * so nothing here is a legibility change.
 */
interface SetAlgebraRoles {
  /** Same position, same token on both boards. */
  shared: ScenePosition;
  /** Same position, DIFFERENT tokens — the clash the old skeleton could not show. */
  clash: ScenePosition;
  leftOnly: ScenePosition;
  rightOnly: ScenePosition;
}

/** Every position of the 3x3 board, as draw material for the four roles. */
const SET_ALGEBRA_POSITIONS: readonly ScenePosition[] =
  [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));

/** One complete draw: two worked rows and the query, all built from roles. */
interface SetAlgebraRows {
  leftA: Scene; rightA: Scene; outputA: Scene;
  leftB: Scene; rightB: Scene; outputB: Scene;
  queryLeft: Scene; queryRight: Scene; answer: Scene;
}

/** Role draws tried before this family gives up on the sampled program. */
const SET_ALGEBRA_INPUT_ATTEMPTS = 300;

/** Draw four distinct positions and hand each one a role. */
function setAlgebraRoles(rng: Rng): SetAlgebraRoles {
  const [shared, clash, leftOnly, rightOnly] = shuffled(rng, SET_ALGEBRA_POSITIONS).slice(0, 4);
  return { shared, clash, leftOnly, rightOnly };
}

/**
 * Build one row's input pair from the four roles.
 *
 * `orientable` is the d5 bucket, whose rule ends in a token turn: a turn shows
 * only on a token that has a direction, and every operation keeps at least one
 * role, so every role has to carry an arrow or a triangle for the turn to be
 * visible whatever the operation turns out to be.
 */
function setAlgebraPair(
  roles: SetAlgebraRoles,
  shapes: readonly SceneToken["shape"][],
  offset: number,
  orientable: boolean,
): [Scene, Scene] {
  const rotation = SET_ALGEBRA_TURN_ROTATIONS[offset % SET_ALGEBRA_TURN_ROTATIONS.length];
  const at = (shape: SceneToken["shape"]): SceneToken =>
    orientable ? { ...token(shape), rotation } : token(shape);
  // The clash has to be READ, so its two tokens are always plainly different
  // shapes — never the same shape in two fills.
  const sharedToken = at(orientable ? "triangle" : shapes[offset % shapes.length]);
  const clashLeft = at(orientable ? "arrow" : shapes[(offset + 1) % shapes.length]);
  const clashRight = at(orientable ? "triangle" : shapes[(offset + 2) % shapes.length]);
  const leftToken = at(orientable ? "arrow" : shapes[(offset + 3) % shapes.length]);
  const rightToken = at(orientable ? "arrow" : shapes[(offset + 4) % shapes.length]);
  return [
    scene([
      { ...roles.shared, object: sharedToken },
      { ...roles.clash, object: clashLeft },
      { ...roles.leftOnly, object: leftToken },
    ]),
    scene([
      { ...roles.shared, object: sharedToken },
      { ...roles.clash, object: clashRight },
      { ...roles.rightOnly, object: rightToken },
    ]),
  ];
}

/** One starting direction per row, so no two rows of a d5 item show the same boards. */
const SET_ALGEBRA_TURN_ROTATIONS = [0, 180, 90] as const;

function setAlgebra(
  rng: Rng,
  options: { bucket?: SceneFamilyBucket; forcedOperation?: SceneBinaryOperation } = {},
): SceneFamilyCandidate {
  const { bucket, forcedOperation } = options;
  const turning = bucket?.bucket === SET_ALGEBRA_TURN_BUCKET;
  const grammar = turning ? SET_ALGEBRA_TURN_GRAMMAR : SET_ALGEBRA_GRAMMAR;
  const program = pick(rng, grammar.filter((candidate) =>
    forcedOperation === undefined || candidate.operation === forcedOperation));
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  // Each row draws its own four positions, so the solver cannot read the rule
  // off a fixed skeleton — only off what the operation does to the roles.
  //
  // Richer boards buy a problem the fixed diagonal never had: a role draw can
  // let a SECOND program in the grammar reproduce both worked rows and then
  // disagree about the query, which is an ambiguous item. Roughly one draw in
  // twenty did that when the boards were first enriched. So the draw is
  // repeated until the two worked rows pin exactly one predicted answer —
  // the same bounded-redraw shape `relationalMatrix` already uses. The oracle
  // below re-derives this from the finished puzzle and is what actually
  // guarantees it; this loop only stops the family handing it a draw it would
  // have to reject.
  /** The near misses a draw can offer: every other program run on the query pair. */
  const poolFor = (queryLeft: Scene, queryRight: Scene, answer: Scene) => distinctOutputs(grammar
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applySetAlgebraProgram(queryLeft, queryRight, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));

  const rows = (() => {
    let last: SetAlgebraRows | null = null;
    let lastWellPosed: SetAlgebraRows | null = null;
    for (let attempt = 0; attempt < SET_ALGEBRA_INPUT_ATTEMPTS; attempt++) {
      const rowRoles = [setAlgebraRoles(rng), setAlgebraRoles(rng), setAlgebraRoles(rng)];
      const pair = (offset: number): [Scene, Scene] =>
        setAlgebraPair(rowRoles[offset % rowRoles.length], shapes, offset, turning);
      const [leftA, rightA] = pair(0);
      const [leftB, rightB] = pair(2);
      const [queryLeft, queryRight] = pair(1);
      const outputA = applySetAlgebraProgram(leftA, rightA, program);
      const outputB = applySetAlgebraProgram(leftB, rightB, program);
      const answer = applySetAlgebraProgram(queryLeft, queryRight, program);
      if (!outputA || !outputB || !answer) continue;
      const draw: SetAlgebraRows = { leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, answer };
      last = draw;
      const examples = [
        { left: leftA, right: rightA, output: outputA },
        { left: leftB, right: rightB, output: outputB },
      ];
      const survivors = grammar.filter((candidateProgram) => examples.every((example) => {
        const output = applySetAlgebraProgram(example.left, example.right, candidateProgram);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predicted = distinctOutputs(survivors.map((candidateProgram) =>
        applySetAlgebraProgram(queryLeft, queryRight, candidateProgram)));
      if (predicted.length !== 1) continue;
      lastWellPosed = draw;
      // Well posed is not yet enough. The d5 bucket turns the combined board as
      // a third step, so two programs differing only in that turn land in the
      // same cells and the option list always holds a board sharing the answer's
      // footprint. The d4 bucket has no such step, and measured on 2026-08-27 it
      // left the answer alone in its cells in 45% of items — one inference,
      // where the tokens go, and the combining rule never had to be read. Draw
      // again until the pool can cover every aspect.
      const pool = poolFor(queryLeft, queryRight, answer);
      if (pool.length >= DISTRACTORS_PER_ITEM && poolCoversEveryAspect(answer, pool)) return draw;
    }
    // No draw satisfied everything. Prefer the last unambiguous one and fall
    // back to the last draw at all: acceptance rejects an unusable board and the
    // assembler retries the slot on a fresh seed, which is the failure path
    // every other family already uses.
    return lastWellPosed ?? last;
  })();
  if (rows === null) throw new Error("set algebra could not build a single valid row draw");
  const { leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, answer } = rows;
  const distractors = poolFor(queryLeft, queryRight, answer);
  const selectedDistractors = selectDistractors(distractors, rng, "set algebra", { answer });
  const cueIds = turning
    ? ["shared-coordinate-frame", "worked-combinations", "spatial-output-step", "token-orientation"]
    : ["shared-coordinate-frame", "worked-combinations", "spatial-output-step"];
  const puzzle = makePuzzle(
    "prototype-set-algebra",
    "matrix",
    "grid3x3",
    turning
      ? "Infer how the first two boards combine, move, and turn to make the third."
      : "Infer how the first two boards combine to make the third.",
    bucket?.difficulty ?? 4,
    [leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, { blank: true }],
    answer,
    selectedDistractors,
    rng,
    setOperationExplanation(program),
  );
  const family = definition(
    "visual-set-algebra-v2",
    cueIds,
    JSON.stringify(program),
    (candidate) => {
      const scenes = candidate.stem.map(scenePanel);
      if (scenes.some((panel, index) => index !== 8 && panel === null)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const [exampleLeftA, exampleRightA, exampleOutputA, exampleLeftB, exampleRightB, exampleOutputB, left, right] = scenes as Scene[];
      const examples = [
        { left: exampleLeftA, right: exampleRightA, output: exampleOutputA },
        { left: exampleLeftB, right: exampleRightB, output: exampleOutputB },
      ];
      const survivors = grammar.filter((candidateProgram) => examples.every((example) => {
        const output = applySetAlgebraProgram(example.left, example.right, candidateProgram);
        return output !== null && sceneSignature(output) === sceneSignature(example.output);
      }));
      const predicted = distinctOutputs(survivors.map((candidateProgram) =>
        applySetAlgebraProgram(left, right, candidateProgram)));
      return {
        derivedAnswer: predicted.length === 1 ? predicted[0] : null,
        solutionCount: predicted.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const wrongProgram = grammar.find((candidateProgram) => {
            const output = applySetAlgebraProgram(left, right, candidateProgram);
            return output !== null && sceneSignature(output) === sceneSignature(option) &&
              examples.some((example) => {
                const worked = applySetAlgebraProgram(example.left, example.right, candidateProgram);
                return worked === null || sceneSignature(worked) !== sceneSignature(example.output);
              });
          });
          return wrongProgram ? "this set-and-spatial program fails at least one worked combination" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}


/**
 * The glyph keys a combining machine's gate panel shows, in the order they are
 * drawn left to right — one for a worked row, two or three for the query strip.
 *
 * The oracle matches the query strip's glyphs against the worked rows' glyphs to
 * decide which rule runs when. Without that the strip would be decoration: the
 * answer would always be "the worked rows in the order they appear", the
 * displayed order would carry nothing, and repainting a glyph would change no
 * answer. Reading it here is what makes the gate labels load-bearing.
 */
function combineGateKeys(value: Scene): string[] | null {
  if (value.tiles.length > 0 || value.objects.length === 0) return null;
  const sorted = [...value.objects].sort((left, right) => left.column - right.column);
  if (sorted.some((placement, index) => placement.column !== index)) return null;
  return sorted.map((placement) => JSON.stringify(placement.object));
}

/**
 * One row's operand pair for the combining machine.
 *
 * The same four roles `visual-set-algebra` uses, but the left-only and
 * right-only tokens deliberately carry the SAME shape. That one change is what
 * lets this family hide its answer.
 *
 * With a distinct shape per role — which is what `setAlgebraPair` gives — a
 * board's shape multiset says exactly which roles survived, and which roles
 * survived says exactly which cells are filled. Shape and footprint become the
 * same fact, so the only board carrying the answer's shapes is the answer, and
 * measured, one inference decided every item. Giving one shape two homes breaks
 * that identity: a chain that keeps the left-only cell and a chain that keeps
 * the right-only cell now show the same shapes in different places. It does not
 * blur the gates at all — the eight operations are separated by which POSITIONS
 * survive, and those are untouched.
 */
function combiningMachinePair(
  roles: SetAlgebraRoles,
  shapes: readonly SceneToken["shape"][],
  offset: number,
): [Scene, Scene] {
  const sharedToken = token(shapes[offset % shapes.length]);
  const clashLeft = token(shapes[(offset + 1) % shapes.length]);
  const clashRight = token(shapes[(offset + 2) % shapes.length]);
  const twoHomes = token(shapes[(offset + 3) % shapes.length]);
  return [
    scene([
      { ...roles.shared, object: sharedToken },
      { ...roles.clash, object: clashLeft },
      { ...roles.leftOnly, object: twoHomes },
    ]),
    scene([
      { ...roles.shared, object: sharedToken },
      { ...roles.clash, object: clashRight },
      { ...roles.rightOnly, object: twoHomes },
    ]),
  ];
}

/**
 * The answer with the clash cell's other token, and the answer with its
 * exclusive token moved to the other exclusive cell.
 *
 * These are the only two ways a board can sit near this family's answer: the
 * clash cell is the one position whose token differs between the two operands,
 * and the left-only and right-only cells are the one pair that carries the same
 * shape. So the first keeps the answer's footprint and changes a shape, and the
 * second keeps the answer's shapes and changes the footprint — exactly the two
 * agreements the near-miss pool could not otherwise reach.
 *
 * Both name a mistake a solver makes: reading the clash the wrong way round, and
 * keeping the token only the other board had. Each returns null when the answer
 * does not occupy the cell in question, in which case there is nothing to swap.
 */
function clashSwapped(answer: Scene, roles: SetAlgebraRoles, left: Scene, right: Scene): Scene | null {
  const at = (board: Scene, position: ScenePosition) => board.objects.find(
    (placement) => placement.row === position.row && placement.column === position.column);
  const here = at(answer, roles.clash);
  if (!here) return null;
  const fromLeft = at(left, roles.clash);
  const fromRight = at(right, roles.clash);
  if (!fromLeft || !fromRight) return null;
  const other = JSON.stringify(here.object) === JSON.stringify(fromLeft.object) ? fromRight : fromLeft;
  if (JSON.stringify(other.object) === JSON.stringify(here.object)) return null;
  return scene(answer.objects.map((placement) =>
    placement === here ? { ...placement, object: other.object } : placement));
}

function exclusiveSwapped(answer: Scene, roles: SetAlgebraRoles, left: Scene, right: Scene): Scene | null {
  const at = (board: Scene, position: ScenePosition) => board.objects.find(
    (placement) => placement.row === position.row && placement.column === position.column);
  const onLeft = at(answer, roles.leftOnly);
  const onRight = at(answer, roles.rightOnly);
  // Exactly one of the two must be present, or there is no move to make.
  if (Boolean(onLeft) === Boolean(onRight)) return null;
  const present = (onLeft ?? onRight)!;
  const target = onLeft ? roles.rightOnly : roles.leftOnly;
  const source = onLeft ? at(right, roles.rightOnly) : at(left, roles.leftOnly);
  if (!source) return null;
  return scene([
    ...answer.objects.filter((placement) => placement !== present),
    { ...target, object: source.object },
  ]);
}

/**
 * Every ordered tuple of DISTINCT combining operations of the given length.
 *
 * Distinct because two identical gates would give the query two glyphs that
 * mean the same thing, and a solver who noticed would rightly wonder why the
 * item bothered. 8 x 7 = 56 two-gate orders and 8 x 7 x 6 = 336 three-gate ones,
 * which is the search room the oracle needs and far more than the draw uses.
 */
function combiningGateOrders(gateCount: number): SceneBinaryOperation[][] {
  const grow = (prefix: SceneBinaryOperation[]): SceneBinaryOperation[][] =>
    prefix.length === gateCount
      ? [prefix]
      : SCENE_BINARY_GRAMMAR
          .filter((operation) => !prefix.includes(operation))
          .flatMap((operation) => grow([...prefix, operation]));
  return grow([]);
}

/** How many combining gates each named bucket displays. */
const COMBINING_MACHINE_BUCKET_GATES: Readonly<Record<string, number>> = {
  "combining-machine-d4": 2,
  "combining-machine-d5": 3,
};

/**
 * Role draws tried before this family gives up on the sampled gate order, and
 * how many gate orders it tries at all.
 *
 * Both are small on purpose. A draw is rejected unless every worked row pins its
 * own gate AND the near-miss pool can cover every aspect, and there are 336
 * three-gate orders — trying each of them a few hundred times is tens of
 * thousands of builds for an item the assembler wanted in milliseconds. A dozen
 * orders at forty draws each finds a good item comfortably; when it does not,
 * the throw below is a rejected attempt the assembler retries on a fresh seed,
 * which is the failure path every other family already uses.
 */
const COMBINING_MACHINE_INPUT_ATTEMPTS = 40;
const COMBINING_MACHINE_GATE_ORDERS_TRIED = 140;
/**
 * Gate orders searched for full aspect coverage before settling for a sound
 * draw. Deliberately large: it takes a wide search to find a three-gate chain
 * whose answer some OTHER chain can sit beside, and the payoff is real — d5 items
 * decided by a single aspect fall from 47% at 40 orders to 8% at 120. The cost is
 * roughly 700ms an item, which is fine while this family is a prototype the
 * assembler never calls, and the first thing to revisit if it is ever promoted.
 */
const COMBINING_MACHINE_COVERAGE_ORDERS = 120;

/**
 * A machine whose gates COMBINE two boards instead of transforming one.
 *
 * Built 2026-08-27 on the owner's instruction to "add this common
 * abstraction/sum in the big Gate transformations". `visual-set-algebra` already
 * asks a solver to infer ONE hidden combining rule; a transformation machine
 * already asks them to read several named gates off worked paths and run them in
 * order. Neither asks for both, because a machine row is (input, gate, output)
 * and a gate that eats two boards cannot be shown in it. This family gets the
 * row shape it needs — `combineTable`, where the gate glyph sits BETWEEN its two
 * operands — and is the first item in the battery where a named, reusable gate
 * takes a pair.
 *
 * The rule, stated once and then never restated in the item: each gate combines
 * what you have so far with the right-hand board. So a two-gate query is
 * `b(a(left, right), right)`, and the right-hand board is read three times, not
 * consumed. That is the one thing a solver has to work out that neither parent
 * family teaches, which is the point — difficulty from a mechanism you have to
 * discover, not from more steps of one you know.
 */
function combiningMachine(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = COMBINING_MACHINE_BUCKET_GATES[bucket.bucket] ?? 2;
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const gateIds = COMPOSED_GATE_IDS.slice(0, gateCount) as ComposedGateId[];

  /**
   * One complete draw, or null.
   *
   * A draw is kept only when every worked row pins its own gate — exactly one
   * operation in the grammar carries that row's pair to that row's output. If a
   * row leaves two operations standing, the query has two defensible answers and
   * the item is unsound, so it is discarded here rather than at acceptance.
   */
  const build = (gates: readonly SceneBinaryOperation[], runOrder: readonly number[]) => {
    const rows = gates.map((gate, index) => {
      const roles = setAlgebraRoles(rng);
      const [left, right] = combiningMachinePair(roles, shapes, index);
      const output = applySceneBinary(left, right, gate);
      return output ? { gate, left, right, output } : null;
    });
    if (rows.some((row) => row === null)) return null;
    const worked = rows as { gate: SceneBinaryOperation; left: Scene; right: Scene; output: Scene }[];
    const pins = worked.every((row) => SCENE_BINARY_GRAMMAR.filter((operation) => {
      const output = applySceneBinary(row.left, row.right, operation);
      return output !== null && sceneSignature(output) === sceneSignature(row.output);
    }).length === 1);
    if (!pins) return null;

    const queryRoles = setAlgebraRoles(rng);
    const [queryLeft, queryRight] = combiningMachinePair(queryRoles, shapes, gateCount);
    const run = (order: readonly SceneBinaryOperation[]): Scene[] | null => {
      const stages: Scene[] = [];
      let value: Scene | null = queryLeft;
      for (const gate of order) {
        value = value && applySceneBinary(value, queryRight, gate);
        if (!value) return null;
        stages.push(value);
      }
      return stages;
    };
    const stages = run(runOrder.map((index) => gates[index]));
    if (!stages) return null;
    const answer = stages[stages.length - 1];
    // An answer that repeats one of the two boards it was built from hides the
    // rule behind a copy, the same way a repeated board does in relational
    // matrix.
    if ([queryLeft, queryRight, ...stages.slice(0, -1)]
      .some((board) => sceneSignature(board) === sceneSignature(answer))) return null;
    if (answer.objects.length === 0) return null;

    // Five kinds of mistake, each one a solver can actually make: stopping
    // before the last gate; running the gates in another order; misreading one
    // gate as a different operation; chaining onto the LEFT board instead of the
    // right one, which is the rule this family is really testing; and copying an
    // operand instead of combining.
    const runOnBoards = (start: Scene, order: readonly SceneBinaryOperation[], right: Scene): Scene | null => {
      let value: Scene | null = start;
      for (const gate of order) value = value && applySceneBinary(value, right, gate);
      return value;
    };
    const ordered = runOrder.map((index) => gates[index]);
    const pool = distinctOutputs([
      ...stages.slice(0, -1),
      ...composedWrongGateOrders(gates.length).map((order) =>
        runOnBoards(queryLeft, order.map((index) => ordered[index]), queryRight)),
      ...ordered.flatMap((_, index) => SCENE_BINARY_GRAMMAR.map((operation) =>
        runOnBoards(queryLeft, ordered.map((gate, at) => (at === index ? operation : gate)), queryRight))),
      runOnBoards(queryLeft, ordered, queryLeft),
      runOnBoards(queryRight, ordered, queryLeft),
      queryLeft, queryRight,
      // The two boards that sit exactly where the answer sits, or carry exactly
      // the answer's shapes, and differ in one readable way. Measured, the
      // chains above could not reach either: with four role cells, the answer's
      // own footprint was reachable only by the correct chain, so the answer was
      // the only option in its cells in 60% of items and where the tokens go
      // finished it. Both are real mistakes rather than manufactured contrast —
      // taking the losing side of the clash, and keeping the wrong board's
      // exclusive token — which is why each earns a witness below.
      clashSwapped(answer, queryRoles, queryLeft, queryRight),
      exclusiveSwapped(answer, queryRoles, queryLeft, queryRight),
      // Two more, added 2026-08-27 because the pool above holds only whole-chain
      // variants and the answer of a chain often lands where no other whole
      // chain does — leaving the answer alone in its cells. These go wrong at
      // ONE step and run the rest correctly, so they land beside the answer
      // rather than somewhere else entirely: feeding the left board in as the
      // second operand at one step, and combining that step's two boards the
      // wrong way round, which changes the result for every operation that is
      // not symmetric.
      ...ordered.flatMap((_, index) => {
        let value: Scene | null = queryLeft;
        for (let step = 0; step < index; step++) value = value && applySceneBinary(value, queryRight, ordered[step]);
        if (!value) return [];
        const slipped = applySceneBinary(value, queryLeft, ordered[index]);
        const reversed = applySceneBinary(queryRight, value, ordered[index]);
        return [slipped, reversed].map((after) => {
          let rest: Scene | null = after;
          for (let step = index + 1; step < ordered.length; step++) {
            rest = rest && applySceneBinary(rest, queryRight, ordered[step]);
          }
          return rest;
        });
      }),
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
    if (pool.length < DISTRACTORS_PER_ITEM) return null;

    return { worked, queryLeft, queryRight, stages, answer, pool, runOrder };
  };

  // Prefer a draw whose near misses can cover every aspect a solver can infer
  // alone, so no single inference picks the answer — the rule the whole battery
  // was held to on 2026-08-27. Unlike `relational-matrix`, this family cannot
  // insist on it: its boards are combinations of combinations, and the answer's
  // footprint is often reachable by no other chain at all. So coverage is a
  // preference with a well-posed fallback, and how often the fallback is taken
  // is measured rather than assumed — see the aspect test.
  let drawn: ReturnType<typeof build> = null;
  let fallback: { draw: NonNullable<ReturnType<typeof build>>; gates: readonly SceneBinaryOperation[] } | null = null;
  let gates: readonly SceneBinaryOperation[] = [];
  const runOrder = shuffled(rng, gateIds.map((_, index) => index));
  const orders = shuffled(rng, combiningGateOrders(gateCount)).slice(0, COMBINING_MACHINE_GATE_ORDERS_TRIED);
  for (const [ordersTried, candidateGates] of orders.entries()) {
    for (let attempt = 0; attempt < COMBINING_MACHINE_INPUT_ATTEMPTS && !drawn; attempt++) {
      const candidate = build(candidateGates, runOrder);
      if (!candidate) continue;
      if (!fallback) fallback = { draw: candidate, gates: candidateGates };
      if (poolCoversEveryAspect(candidate.answer, candidate.pool)) {
        drawn = candidate;
        gates = candidateGates;
      }
    }
    if (drawn) break;
    // Stop hunting for coverage once a usable item is in hand and the search has
    // had a fair run. Most draws here cannot cover — the answer of a chain of
    // combining gates often sits where no other chain lands — and without this
    // bound a d5 item costs most of a second to build.
    if (fallback && ordersTried + 1 >= COMBINING_MACHINE_COVERAGE_ORDERS) break;
  }
  if (!drawn && fallback) {
    drawn = fallback.draw;
    gates = fallback.gates;
  }
  if (!drawn) throw new Error("combining machine found no well-posed gate order");
  const { worked, queryLeft, queryRight, answer, pool: distractors } = drawn;

  const runOn = (start: Scene, order: readonly SceneBinaryOperation[], right: Scene): Scene | null => {
    let value: Scene | null = start;
    for (const gate of order) value = value && applySceneBinary(value, right, gate);
    return value;
  };
  const wrongOrders = composedWrongGateOrders(gateCount);

  const stem: Puzzle<Scene>["stem"] = [
    ...worked.flatMap((row, index) => [row.left, gateVisual(gateIds[index]), row.right, row.output]),
    queryLeft, gateVisual(...runOrder.map((index) => gateIds[index])), queryRight, { blank: true },
  ];
  const puzzle = makePuzzle(
    "prototype-combining-machine",
    "matrix",
    "combineTable",
    "Each gate combines two boards. Apply the query gates from left to right.",
    bucket.difficulty,
    stem,
    answer,
    selectDistractors(distractors, rng, "combining machine", { answer }),
    rng,
    `Each worked row shows one gate combining the two boards beside it. ${worked
      .map((row, index) => `Gate ${gateIds[index].toUpperCase()} ${binaryOperationDescription(row.gate)}.`)
      .join(" ")} The query names its gates in order; each one combines the board you have so far with the right-hand board, which is read again every time rather than used up. That gives the highlighted board. Distractors stop early, run the gates in another order, misread a gate, chain onto the left board, or copy an input.`,
  );
  const cueIds = [...gateIds.map((gateId) => `gate-${gateId}`), "left-to-right-order", "right-board-reused"];
  const family = definition(
    "combining-machine-v1",
    cueIds,
    JSON.stringify(gates),
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      if (panels.some((panel, index) => index !== panels.length - 1 && panel === null)) return empty;
      const rows = Array.from({ length: panels.length / 4 }, (_, index) =>
        panels.slice(index * 4, index * 4 + 4) as Scene[]);
      const workedRows = rows.slice(0, -1);
      const [readLeft, queryStrip, readRight] = rows[rows.length - 1];
      // Which operation each worked row leaves standing. A row that leaves two
      // makes the whole item ambiguous, so the oracle reports no answer rather
      // than guessing which the solver was meant to read.
      const survivorsPerRow = workedRows.map(([left, , right, output]) =>
        SCENE_BINARY_GRAMMAR.filter((operation) => {
          const produced = applySceneBinary(left, right, operation);
          return produced !== null && sceneSignature(produced) === sceneSignature(output);
        }));
      if (survivorsPerRow.some((survivors) => survivors.length !== 1)) return empty;
      // Match the query strip's glyphs to the worked rows that display them, so
      // the ORDER on screen is what runs. A glyph the worked rows never show, a
      // glyph shown twice, or a strip of the wrong length all mean the visible
      // evidence no longer determines an answer.
      const byGlyph = new Map<string, SceneBinaryOperation>();
      for (const [index, row] of workedRows.entries()) {
        const keys = combineGateKeys(row[1]);
        if (!keys || keys.length !== 1 || byGlyph.has(keys[0])) return empty;
        byGlyph.set(keys[0], survivorsPerRow[index][0]);
      }
      const stripKeys = combineGateKeys(queryStrip);
      if (!stripKeys || stripKeys.length !== workedRows.length) return empty;
      if (new Set(stripKeys).size !== stripKeys.length) return empty;
      const readGates: SceneBinaryOperation[] = [];
      for (const key of stripKeys) {
        const operation = byGlyph.get(key);
        if (!operation) return empty;
        readGates.push(operation);
      }
      const predicted = runOn(readLeft, readGates, readRight);
      return {
        derivedAnswer: predicted,
        solutionCount: predicted ? 1 : 0,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const is = (board: Scene | null) => board !== null && sceneSignature(board) === sceneSignature(option);
          for (let stop = 1; stop < readGates.length; stop++) {
            if (is(runOn(readLeft, readGates.slice(0, stop), readRight))) return "stops before the last gate";
          }
          if (wrongOrders.some((order) => is(runOn(readLeft, order.map((index) => readGates[index]), readRight)))) {
            return "runs the demonstrated gates in another order";
          }
          for (let index = 0; index < readGates.length; index++) {
            const misread = SCENE_BINARY_GRAMMAR.some((operation) =>
              operation !== readGates[index] &&
              is(runOn(readLeft, readGates.map((gate, at) => (at === index ? operation : gate)), readRight)));
            if (misread) return "misreads one gate as a different combining rule";
          }
          if (is(runOn(readLeft, readGates, readLeft)) || is(runOn(readRight, readGates, readLeft))) {
            return "chains onto the left board instead of the right one";
          }
          // One step wrong, the rest right. Checked after the whole-chain
          // mistakes above so a board either of those explains keeps the
          // sharper name.
          for (let index = 0; index < readGates.length; index++) {
            let value: Scene | null = readLeft;
            for (let step = 0; step < index; step++) {
              value = value && applySceneBinary(value, readRight, readGates[step]);
            }
            if (!value) break;
            for (const after of [
              applySceneBinary(value, readLeft, readGates[index]),
              applySceneBinary(readRight, value, readGates[index]),
            ]) {
              let rest: Scene | null = after;
              for (let step = index + 1; step < readGates.length; step++) {
                rest = rest && applySceneBinary(rest, readRight, readGates[step]);
              }
              if (is(rest)) return "goes wrong at one gate and runs the rest correctly";
            }
          }
          if (is(readLeft) || is(readRight)) return "copies one of the two boards instead of combining them";
          // The two boards built beside the answer. The roles are readable off
          // the visible query pair: the clash is the one cell both boards fill
          // differently, and the exclusive cells are the ones only one fills.
          if (predicted) {
            const cellOf = (board: Scene, position: ScenePosition) => board.objects.find(
              (placement) => placement.row === position.row && placement.column === position.column);
            const positions = [...readLeft.objects, ...readRight.objects]
              .map((placement) => ({ row: placement.row, column: placement.column }));
            const clashAt = positions.find((position) => {
              const onLeft = cellOf(readLeft, position);
              const onRight = cellOf(readRight, position);
              return onLeft && onRight &&
                JSON.stringify(onLeft.object) !== JSON.stringify(onRight.object);
            });
            const leftOnlyAt = positions.find((position) =>
              cellOf(readLeft, position) && !cellOf(readRight, position));
            const rightOnlyAt = positions.find((position) =>
              !cellOf(readLeft, position) && cellOf(readRight, position));
            if (clashAt && leftOnlyAt && rightOnlyAt) {
              const roles: SetAlgebraRoles = {
                shared: clashAt, clash: clashAt, leftOnly: leftOnlyAt, rightOnly: rightOnlyAt,
              };
              if (is(clashSwapped(predicted, roles, readLeft, readRight))) {
                return "takes the losing side where the two boards disagree";
              }
              if (is(exclusiveSwapped(predicted, roles, readLeft, readRight))) {
                return "keeps the token only the other board had";
              }
            }
          }
          return null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * Every rule this family may demonstrate.
 *
 * Since 2026-08-25 it contains BOTH readings of a quarter-turn: `rotate` turns
 * the whole board, carrying every token to a new slot, while `turn` leaves the
 * layout untouched and turns each token's own direction on the spot. They look
 * alike described in words and completely different on a board, which is the
 * distinction this family now teaches. Both live in the oracle's search space,
 * so an item is only servable when the worked pair separates them.
 */
const SPATIAL_TRANSFORM_GRAMMAR: readonly SceneUnaryOperation[] = [
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "turn", quarterTurns: 1 },
  { kind: "turn", quarterTurns: 2 },
  { kind: "turn", quarterTurns: 3 },
  { kind: "translate", rowDelta: -1, columnDelta: 0, wrap: true },
  { kind: "translate", rowDelta: 1, columnDelta: 0, wrap: true },
  { kind: "translate", rowDelta: 0, columnDelta: -1, wrap: true },
  { kind: "translate", rowDelta: 0, columnDelta: 1, wrap: true },
] as const;

/**
 * The other reading of the same quarter-turn: the board rotation that matches a
 * token turn, and the token turn that matches a board rotation. Null for a
 * reflection or a shift, which have no such twin.
 */
function spatialTurnCounterpart(operation: SceneUnaryOperation): SceneUnaryOperation | null {
  if (operation.kind === "rotate") return { kind: "turn", quarterTurns: operation.quarterTurns };
  if (operation.kind === "turn") return { kind: "rotate", quarterTurns: operation.quarterTurns };
  return null;
}

function spatialOperationDescription(operation: SceneUnaryOperation): string {
  if (operation.kind === "reflect") return `reflects across the ${operation.axis} axis`;
  if (operation.kind === "rotate") {
    return `rotates ${operation.quarterTurns} quarter-turn${operation.quarterTurns === 1 ? "" : "s"} clockwise`;
  }
  if (operation.kind === "turn") {
    return `keeps every token in its slot and turns each one ${operation.quarterTurns} quarter-turn${operation.quarterTurns === 1 ? "" : "s"} clockwise on the spot`;
  }
  if (operation.kind === "translate") {
    const direction = operation.rowDelta === -1 ? "up" : operation.rowDelta === 1 ? "down"
      : operation.columnDelta === -1 ? "left" : "right";
    return `moves one slot ${direction}, wrapping across the board edge`;
  }
  return operation.kind;
}

function spatialTransform(rng: Rng): SceneFamilyCandidate {
  // One drawn shape and one arrow. The arrow is what makes a token turn
  // readable at all: without a token that has a direction, turning the tokens
  // and leaving the board alone would look like doing nothing.
  const [a] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const b = "arrow" as const;
  const operation = pick(rng, SPATIAL_TRANSFORM_GRAMMAR);
  const first = scene([{ row: 0, column: 0, object: token(a) }, { row: 2, column: 1, object: token(b, "solid") }]);
  const transformed = applySceneUnary(first, operation)!;
  const query = scene([{ row: 0, column: 1, object: token(b) }, { row: 1, column: 0, object: token(a, "solid") }]);
  const answer = applySceneUnary(query, operation)!;
  // The pool is the other bounded operations, and each of them again with an
  // extra token turn.
  //
  // The plain operations alone were too narrow, measured on 2026-08-27: a board
  // rotation lands the tokens in cells no other operation reaches, so in 43% of
  // items the answer was the only option with its footprint and reading where
  // the tokens go finished the item without ever reading the arrow. Composing a
  // move with a turn keeps the footprint and changes only the arrow, which is
  // exactly the mix-up this family exists to test — the solver who moved the
  // board correctly but turned the tokens as well.
  const withExtraTurn = (base: Scene) => ([1, 2, 3] as const)
    .map((quarterTurns) => applySceneUnary(base, { kind: "turn", quarterTurns }));
  const distractors = [...new Map(SPATIAL_TRANSFORM_GRAMMAR
    .flatMap((candidateOperation) => {
      const moved = applySceneUnary(query, candidateOperation);
      return moved ? [moved, ...withExtraTurn(moved)] : [];
    })
    .filter((candidate): candidate is Scene => candidate !== null)
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer))
    .map((candidate) => [sceneSignature(candidate), candidate])).values()];
  // The confusable counterpart always ships: for a board rotation, the board
  // that results from turning the tokens instead, and the other way round. It
  // is the one wrong answer a solver who mixed the two readings up would give,
  // so the item has to offer it or it never tests the distinction.
  const counterpart = spatialTurnCounterpart(operation);
  const counterpartOutput = counterpart ? applySceneUnary(query, counterpart) : null;
  const required = counterpartOutput && sceneSignature(counterpartOutput) !== sceneSignature(answer)
    ? [counterpartOutput]
    : [];
  const selectedDistractors = selectDistractors(distractors, rng, "spatial transform", { answer, required });
  const movesTokens = operation.kind !== "turn";
  const puzzle = makePuzzle(
    "prototype-spatial-transform",
    "analogy",
    "analogy",
    "Apply the same transformation.",
    2,
    [first, transformed, query],
    answer,
    selectedDistractors,
    rng,
    `The first pair shows that the arrangement ${spatialOperationDescription(operation)}. ${movesTokens
      ? "Both tokens keep their shapes, fills, and their own directions while their board positions change together."
      : "Both tokens stay in the slots they started in; only the arrow's direction changes, because turning a token is not the same as turning the board."} Applying that exact rule to the third board gives the highlighted arrangement. Every distractor is the output of another bounded board rotation, token turn, reflection, or wrapped shift that fails the worked pair.`,
  );
  const family = definition(
    "spatial-transform-v2",
    ["worked-spatial-pair", "fixed-board-frame"],
    JSON.stringify(operation),
    (candidate) => {
      const [input, output, query] = candidate.stem.map(scenePanel);
      if (!input || !output || !query) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = SPATIAL_TRANSFORM_GRAMMAR.filter((candidateOperation) => {
        const predicted = applySceneUnary(input, candidateOperation);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
      });
      const predictions = distinctOutputs(survivors.map((candidateOperation) => applySceneUnary(query, candidateOperation)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-spatial-pair", "fixed-board-frame"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          if (sceneSignature(option) === sceneSignature(query)) return "omits the demonstrated spatial transformation";
          const failedRule = SPATIAL_TRANSFORM_GRAMMAR.find((candidateOperation) => {
            const queryOutput = applySceneUnary(query, candidateOperation);
            const workedOutput = applySceneUnary(input, candidateOperation);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (workedOutput === null || sceneSignature(workedOutput) !== sceneSignature(output));
          });
          if (failedRule) return `${failedRule.kind} does not reproduce the worked spatial pair`;
          // Checked second, so a board a single operation already explains is
          // named by that operation rather than by this wider category.
          const movedAndTurned = SPATIAL_TRANSFORM_GRAMMAR.find((candidateOperation) => {
            const moved = applySceneUnary(query, candidateOperation);
            if (!moved) return false;
            return ([1, 2, 3] as const).some((quarterTurns) => {
              const turned = applySceneUnary(moved, { kind: "turn", quarterTurns });
              return turned !== null && sceneSignature(turned) === sceneSignature(option);
            });
          });
          return movedAndTurned
            ? `${movedAndTurned.kind} with an extra token turn the worked pair does not show`
            : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const COMPOSED_GATE_IDS = ["a", "b", "c", "d", "e"] as const;
type ComposedGateId = (typeof COMPOSED_GATE_IDS)[number];

/**
 * The glyph that labels one machine gate. Five shape-and-fill pairs, chosen so
 * no two are confusable at the size a query strip draws them. The fifth arrived
 * with `composed-transform-d6`; a hexagon is the last legacy shape not already
 * spoken for, and outline-versus-solid keeps it apart from the square.
 */
const GATE_GLYPHS: Readonly<Record<ComposedGateId, { shape: SceneToken["shape"]; fill: SceneToken["fill"] }>> = {
  a: { shape: "triangle", fill: "outline" },
  b: { shape: "square", fill: "solid" },
  c: { shape: "diamond", fill: "half" },
  d: { shape: "star", fill: "outline" },
  e: { shape: "hexagon", fill: "solid" },
};

/**
 * A machine gate control: a worked row's single gate, or a query strip.
 *
 * One, two, or three glyphs sit on the ordinary board, one per column of its
 * middle row — the shape this family has always drawn. Four glyphs do not fit
 * that board, so a four-gate strip is the one place the schema admits a wide
 * scene: a single row of glyphs, laid out full width by both renderers and
 * never offered as an answer option. A five-gate strip is the same shape one
 * column wider (`composed-transform-d6`, 2026-08-26).
 */
function gateVisual(...gateIds: ComposedGateId[]): Scene {
  // Field order matters: `sceneSignature` stringifies a placement as written,
  // and the schema rebuilds it as (row, column, object) on parse. A placement
  // built any other way replays to a different key than it validates to.
  const strip = gateIds.length >= GATE_STRIP_COLUMNS;
  if (gateIds.length > MAXIMUM_GATE_STRIP_COLUMNS) {
    throw new Error(
      `a gate strip holds at most ${MAXIMUM_GATE_STRIP_COLUMNS} glyphs, not ${gateIds.length}`,
    );
  }
  const glyphs = gateIds.map((gateId, column) => ({
    row: strip ? 0 : 1,
    column,
    object: token(GATE_GLYPHS[gateId].shape, GATE_GLYPHS[gateId].fill),
  }));
  return strip
    ? { kind: "scene", rows: GATE_STRIP_ROWS, columns: gateIds.length, objects: glyphs, tiles: [] }
    : scene(glyphs);
}

type MachineSpatialOperation = Extract<SceneUnaryOperation, { kind: "rotate" | "reflect" }>;
type MachineFillOperation = Extract<SceneUnaryOperation, { kind: "setFill" }>;
type MachineDuplicateOperation = Extract<SceneUnaryOperation, { kind: "duplicate" }>;
type MachineSwapOperation = Extract<SceneUnaryOperation, { kind: "swap" }>;

interface MachineProgram {
  gateA: MachineSpatialOperation;
  gateB: MachineFillOperation;
  gateC: MachineDuplicateOperation;
  /**
   * The fourth gate, drawn only by `transformation-machine-d6`. A three-gate
   * program carries no such key at all, so its `JSON.stringify` fingerprint and
   * replay key are the very strings the family produced before this gate
   * existed — which is what keeps the released d5 population byte-identical.
   */
  gateD?: MachineSwapOperation;
}

const MACHINE_SPATIAL_GRAMMAR: readonly MachineSpatialOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
] as const;
const MACHINE_FILL_GRAMMAR: readonly MachineFillOperation[] = [
  { kind: "setFill", fill: "half" },
  { kind: "setFill", fill: "solid" },
] as const;

function duplicateAfterSpatial(operation: MachineSpatialOperation): MachineDuplicateOperation {
  const moved = applySceneUnary(one("circle", 0, 0), operation);
  const source = moved?.objects[0];
  if (!source) throw new Error("machine spatial operation must preserve its source token");
  return {
    kind: "duplicate",
    from: { row: source.row, column: source.column },
    to: { row: 1, column: 1 },
  };
}

const MACHINE_PROGRAM_GRAMMAR: readonly MachineProgram[] = MACHINE_SPATIAL_GRAMMAR.flatMap((gateA) =>
  MACHINE_FILL_GRAMMAR.map((gateB) => ({ gateA, gateB, gateC: duplicateAfterSpatial(gateA) })));

/**
 * Every swap a solver could read off a worked row: each unordered pair of the
 * nine board slots, written once with its upper-left member first.
 *
 * C(9, 2) = 36 pairs. The four-gate space is this list crossed with the
 * three-gate one, 8 x 36 = 288 programs, and servability keeps 16 of them —
 * see `machineProgramIsServable` for the arithmetic.
 */
const MACHINE_SWAP_GRAMMAR: readonly MachineSwapOperation[] = (() => {
  const slots: ScenePosition[] = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
  return slots.flatMap((first, index) =>
    slots.slice(index + 1).map((second): MachineSwapOperation => ({ kind: "swap", first, second })));
})();

/**
 * The whole four-gate space, before any filter: the oracle's search room.
 *
 * A solver who reads the fourth worked row sees two tokens change places and
 * may posit any pair of slots, so uniqueness has to be proved against all 288,
 * not against the 16 the generator draws from.
 */
const MACHINE_FOUR_GATE_GRAMMAR: readonly MachineProgram[] = MACHINE_PROGRAM_GRAMMAR.flatMap((base) =>
  MACHINE_SWAP_GRAMMAR.map((gateD): MachineProgram => ({ ...base, gateD })));

/** How many gates each named bucket displays — also the program's honest depth. */
const TRANSFORMATION_MACHINE_BUCKET_GATES: Readonly<Record<string, MachineGateCount>> = {
  "transformation-machine-d5": 3,
  "transformation-machine-d6": 4,
};

/** Three gates is the `-d5` bucket, four the `-d6` bucket. */
type MachineGateCount = 3 | 4;

/** Gate labels, in the order the worked rows show them. */
const MACHINE_GATE_COUNT_WORDS: Readonly<Record<MachineGateCount, string>> = { 3: "three", 4: "four" };

function machineGrammarFor(gateCount: MachineGateCount): readonly MachineProgram[] {
  return gateCount === 3 ? MACHINE_PROGRAM_GRAMMAR : MACHINE_FOUR_GATE_GRAMMAR;
}

/** One program's gates, in the order the query strip shows them. */
function machineGates(program: MachineProgram): SceneUnaryOperation[] {
  const gates: SceneUnaryOperation[] = [program.gateA, program.gateB, program.gateC];
  if (program.gateD) gates.push(program.gateD);
  return gates;
}

function unaryExampleMatches(input: Scene, output: Scene, operation: SceneUnaryOperation): boolean {
  const predicted = applySceneUnary(input, operation);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

function runMachineInOrder(input: Scene, program: MachineProgram, order: readonly number[]): Scene | null {
  const gates = machineGates(program);
  let value: Scene | null = input;
  for (const index of order) value = value && applySceneUnary(value, gates[index]);
  return value;
}

/**
 * Every board the machine passes through, in order. Null means some gate could
 * not apply, which is a rejected draw rather than a silently shorter run.
 */
function runMachine(input: Scene, program: MachineProgram): readonly Scene[] | null {
  const stages: Scene[] = [];
  let value: Scene | null = input;
  for (const gate of machineGates(program)) {
    value = applySceneUnary(value, gate);
    if (!value) return null;
    stages.push(value);
  }
  return stages;
}

/** The board a finished run lands on, or null if the machine does not apply. */
function machineAnswer(input: Scene, program: MachineProgram): Scene | null {
  return runMachine(input, program)?.at(-1) ?? null;
}

/** The query board every transformation-machine item shows: two outline tokens. */
function machineQuery(shape: SceneToken["shape"], secondShape: SceneToken["shape"]): Scene {
  return scene([
    { row: 0, column: 0, object: token(shape) },
    { row: 1, column: 2, object: token(secondShape) },
  ]);
}

/**
 * The board servability and single-gate ablation are decided on.
 *
 * Geometry alone decides both — which slots hold a token, and whether two of
 * them hold the SAME token — and renaming the two shapes is a bijection on
 * scene signatures, so settling one shape order settles every shape order.
 */
export function canonicalTransformationMachineQuery(): Scene {
  return machineQuery("circle", "triangle");
}

/**
 * Is this program servable, and does every gate it displays actually matter?
 *
 * Two conditions, both on the canonical query:
 *
 *  1. the machine runs end to end — the swap gate has to find a token in BOTH
 *     the slots it names, and after the duplication gate only three of the nine
 *     slots hold one; and
 *  2. SINGLE-GATE ABLATION — deleting any one displayed gate changes the final
 *     board. An ablated run that does not apply at all counts as changed: it
 *     produces no board, so it cannot reproduce the answer.
 *
 * Condition 2 is what the fourth gate needs. The duplication gate leaves two
 * IDENTICAL tokens on the board, so a swap of exactly those two is invisible:
 * the item would display four gates and a solver could skip one and still be
 * right. That is a three-step item wearing a four-step label, so it is not
 * servable.
 *
 * The arithmetic, which `scene-families.test.ts` locks:
 *   288 four-gate programs = 8 three-gate machines x 36 slot pairs.
 *   264 name a slot pair the run never fills, so the swap cannot apply.
 *     8 swap the duplicate with its own source — the two identical tokens.
 *    16 servable.
 * All 8 three-gate programs are servable: without the board move the
 * duplication gate has no source, without the fill gate the tokens keep the
 * outline they came with, and without the duplication gate the board is one
 * token short.
 */
function machineProgramIsServable(program: MachineProgram): boolean {
  const query = canonicalTransformationMachineQuery();
  const answer = machineAnswer(query, program);
  if (!answer) return false;
  const answerKey = sceneSignature(answer);
  const gates = machineGates(program);
  for (let gate = 0; gate < gates.length; gate++) {
    let ablated: Scene | null = query;
    for (const [index, step] of gates.entries()) {
      if (index === gate) continue;
      ablated = ablated && applySceneUnary(ablated, step);
    }
    if (ablated && sceneSignature(ablated) === answerKey) return false;
  }
  return true;
}

const machineServablePrograms = new Map<MachineGateCount, readonly MachineProgram[]>();

/** Every program of one displayed depth that the generator may draw. */
export function servableTransformationMachinePrograms(
  gateCount: MachineGateCount,
): readonly MachineProgram[] {
  const cached = machineServablePrograms.get(gateCount);
  if (cached) return cached;
  const servable = machineGrammarFor(gateCount).filter(machineProgramIsServable);
  machineServablePrograms.set(gateCount, servable);
  return servable;
}

/** The complete grammar one displayed depth is drawn from, before any filter. */
export function transformationMachineGrammar(gateCount: MachineGateCount): readonly MachineProgram[] {
  return machineGrammarFor(gateCount);
}

/** The gates of one program, exposed so the ablation proof reads the real list. */
export function transformationMachineGates(program: MachineProgram): readonly SceneUnaryOperation[] {
  return machineGates(program);
}

function gateSymbolKey(value: Scene): string | null {
  const placement = value.objects[0];
  return value.objects.length === 1 && value.tiles.length === 0 && placement?.row === 1 && placement.column === 0
    ? JSON.stringify(placement.object)
    : null;
}

/**
 * The swap gate's worked row: one token in each slot the gate names.
 *
 * The two tokens are a different shape AND a different fill, so the exchange
 * is visible, and no other slot pair in the grammar can explain the row — a
 * swap whose slots are both empty does not apply at all.
 */
function machineSwapWorkedRow(
  gate: MachineSwapOperation,
  shape: SceneToken["shape"],
  secondShape: SceneToken["shape"],
): { input: Scene; output: Scene } {
  const input = scene([
    { ...gate.first, object: token(shape) },
    { ...gate.second, object: token(secondShape, "solid") },
  ]);
  const output = applySceneUnary(input, gate);
  if (!output) throw new Error("a swap gate must apply to its own worked row");
  return { input, output };
}

/**
 * Gate labels for the review-screen reasons, in displayed order.
 *
 * Index 1 and index 2 are named by the job the gate does rather than by its
 * letter: "stops before the duplication gate" says what a solver left out, and
 * that reads the same whether the item shows three gates or four.
 */
const MACHINE_STOP_REASONS = [
  "stops after the first gate",
  "stops before the duplication gate",
  "stops before the swapping gate",
] as const;

function transformationMachine(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = TRANSFORMATION_MACHINE_BUCKET_GATES[bucket.bucket] ?? 3;
  const gateWord = MACHINE_GATE_COUNT_WORDS[gateCount];
  // Three gates draw the whole grammar — every one of the 8 is servable — so
  // the d5 bucket picks from exactly the list it always picked from.
  const program = pick(rng, gateCount === 3 ? MACHINE_PROGRAM_GRAMMAR : servableTransformationMachinePrograms(4));
  const [shape, secondShape] = shuffled(rng, ["circle", "triangle", "diamond", "star"] as const);
  const inputA = scene([
    { row: 0, column: 0, object: token(shape) },
    { row: 1, column: 2, object: token(secondShape, "solid") },
  ]);
  const outputA = applySceneUnary(inputA, program.gateA)!;
  const inputB = scene([
    { row: 0, column: 1, object: token(shape) },
    { row: 2, column: 0, object: token(secondShape, "solid") },
  ]);
  const outputB = applySceneUnary(inputB, program.gateB)!;
  const inputC = one(shape, program.gateC.from.row, program.gateC.from.column, program.gateB.fill);
  const outputC = applySceneUnary(inputC, program.gateC)!;
  const rowD = program.gateD && machineSwapWorkedRow(program.gateD, shape, secondShape);
  const query = machineQuery(shape, secondShape);
  const stages = runMachine(query, program);
  if (!stages || stages.length !== gateCount) throw new Error("machine program must apply to its query");
  const answer = stages[stages.length - 1];
  const gateIds = COMPOSED_GATE_IDS.slice(0, gateCount) as ComposedGateId[];
  const wrongOrders = composedWrongGateOrders(gateCount);
  const cueIds = [...gateIds.map((gateId) => `gate-${gateId}`), "left-to-right-order"];
  const puzzle = makePuzzle(
    "prototype-transformation-machine",
    "matrix",
    "machineTable",
    "Follow the worked gate paths, then apply the query gates from left to right.",
    bucket.difficulty,
    [
      inputA, gateVisual("a"), outputA,
      inputB, gateVisual("b"), outputB,
      inputC, gateVisual("c"), outputC,
      ...(rowD ? [rowD.input, gateVisual("d"), rowD.output] : []),
      query, gateVisual(...gateIds), { blank: true },
    ],
    answer,
    selectDistractors(
      // Three kinds of mistake: stopping early, running the gates out of order,
      // and reading a gate wrongly so a different machine runs end to end.
      distinctOutputs([
        query,
        ...stages.slice(0, -1),
        ...wrongOrders.map((order) => runMachineInOrder(query, program, order)),
        ...machineGrammarFor(gateCount).flatMap((candidateProgram) =>
          JSON.stringify(candidateProgram) === JSON.stringify(program)
            ? []
            : [machineAnswer(query, candidateProgram)]),
      ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)),
      rng,
      "transformation machine",
      { answer, required: [stages[stages.length - 2]] },
    ),
    rng,
    `The ${gateWord} worked paths define the gates separately. The outline triangle ${spatialOperationDescription(program.gateA)}. The solid square changes every token to ${program.gateB.fill} without moving it. The half-filled diamond copies the token at the demonstrated source into the empty centre.${program.gateD ? " The outline star exchanges whatever stands in the two slots its own worked path shows." : ""} Applying those gates from left to right gives the highlighted board.${program.gateD ? " Every displayed gate is needed: dropping any one of them changes the result." : ""} The distractors stop early, run the same gates in another order, or run a machine whose gates disagree with a worked path.`,
  );
  const family = definition(
    "transformation-machine-v3",
    cueIds,
    JSON.stringify(program),
    (candidate) => {
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      if (candidate.stem.length !== gateCount * 3 + 3) return empty;
      const panels = candidate.stem.map(scenePanel);
      const worked: { input: Scene; output: Scene; gateKey: string }[] = [];
      for (let row = 0; row < gateCount; row++) {
        const input = panels[row * 3];
        const shownGate = panels[row * 3 + 1];
        const output = panels[row * 3 + 2];
        const gateKey = shownGate && gateSymbolKey(shownGate);
        if (!input || !output || !gateKey) return empty;
        worked.push({ input, output, gateKey });
      }
      const queryInput = panels[gateCount * 3];
      const queryGates = panels[gateCount * 3 + 1];
      if (!queryInput || !queryGates) return empty;

      // The query strip must show exactly the worked gates, once each, left to
      // right: three glyphs across the middle row of an ordinary board, or four
      // across the single row of the wide gate strip.
      const wideStrip = gateCount >= GATE_STRIP_COLUMNS;
      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const stripRow = wideStrip ? 0 : 1;
      const stripValid = queryGates.tiles.length === 0 &&
        queryGates.rows === (wideStrip ? GATE_STRIP_ROWS : 3) &&
        queryGates.columns === (wideStrip ? gateCount : 3) &&
        orderedQueryGates.length === gateCount &&
        orderedQueryGates.every((placement, index) => placement.row === stripRow && placement.column === index) &&
        orderedQueryGates.every((placement, index) => JSON.stringify(placement.object) === worked[index].gateKey);
      if (!stripValid) return empty;

      const survivors = machineGrammarFor(gateCount).filter((candidateProgram) =>
        machineGates(candidateProgram).every((gate, index) =>
          unaryExampleMatches(worked[index].input, worked[index].output, gate)));
      const executions = survivors.flatMap((candidateProgram) => {
        const outputs = runMachine(queryInput, candidateProgram);
        return outputs ? [{ program: candidateProgram, outputs }] : [];
      });
      const predictions = distinctOutputs(executions.map((execution) => execution.outputs[gateCount - 1]));
      const wrongExecutions = [
        { output: queryInput, reason: `omits all ${gateWord} demonstrated gates` },
        ...executions.flatMap((execution) => execution.outputs.slice(0, -1).map((stage, index) => ({
          output: stage,
          reason: MACHINE_STOP_REASONS[index],
        }))),
        ...executions.flatMap((execution) => wrongOrders.map((order) => ({
          output: runMachineInOrder(queryInput, execution.program, order),
          reason: "runs the demonstrated gates in another order",
        }))),
        // Listed last: a machine whose gates contradict a worked path loses on
        // the worked paths, so the more specific reasons above win when both fit.
        ...machineGrammarFor(gateCount).flatMap((candidateProgram) =>
          survivors.some((survivor) => JSON.stringify(survivor) === JSON.stringify(candidateProgram))
            ? []
            : [{
                output: machineAnswer(queryInput, candidateProgram),
                reason: "runs a gate that fails a worked path",
              }]),
      ];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output &&
            sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const RULE_SWITCH_OPERATION_GRAMMAR: readonly SceneUnaryOperation[] = [
  { kind: "rotate", quarterTurns: 1 },
  { kind: "rotate", quarterTurns: 2 },
  { kind: "rotate", quarterTurns: 3 },
  { kind: "reflect", axis: "horizontal" },
  { kind: "reflect", axis: "vertical" },
  { kind: "setFill", fill: "half" },
  { kind: "setFill", fill: "solid" },
  { kind: "translate", rowDelta: 1, columnDelta: 1, wrap: true },
] as const;

interface RuleSwitchProgram {
  gateA: SceneUnaryOperation;
  gateB: SceneUnaryOperation;
  queryGate: "a" | "b";
}

const RULE_SWITCH_PROGRAM_GRAMMAR: readonly RuleSwitchProgram[] = RULE_SWITCH_OPERATION_GRAMMAR.map(
  (selected, index) => {
    const other = RULE_SWITCH_OPERATION_GRAMMAR[(index + 3) % RULE_SWITCH_OPERATION_GRAMMAR.length];
    return index % 2 === 0
      ? { gateA: selected, gateB: other, queryGate: "a" }
      : { gateA: other, gateB: selected, queryGate: "b" };
  },
);

function selectedRuleSwitchOperation(program: RuleSwitchProgram): SceneUnaryOperation {
  return program.queryGate === "a" ? program.gateA : program.gateB;
}

function unselectedRuleSwitchOperation(program: RuleSwitchProgram): SceneUnaryOperation {
  return program.queryGate === "a" ? program.gateB : program.gateA;
}

function ruleSwitchOperationDescription(operation: SceneUnaryOperation): string {
  return operation.kind === "setFill"
    ? `changes every token to ${operation.fill}`
    : spatialOperationDescription(operation);
}

function ruleSwitching(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, RULE_SWITCH_PROGRAM_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const inputA = scene([
    { row: 0, column: 0, object: token(shapes[0]) },
    { row: 1, column: 2, object: token(shapes[1], "solid") },
  ]);
  const outputA = applySceneUnary(inputA, program.gateA)!;
  const inputB = scene([
    { row: 0, column: 1, object: token(shapes[2]) },
    { row: 2, column: 0, object: token(shapes[3], "solid") },
  ]);
  const outputB = applySceneUnary(inputB, program.gateB)!;
  const query = scene([
    { row: 0, column: 1, object: token(shapes[4]) },
    { row: 2, column: 0, object: token(shapes[0]) },
  ]);
  const selectedOperation = selectedRuleSwitchOperation(program);
  const unselectedOperation = unselectedRuleSwitchOperation(program);
  const answer = applySceneUnary(query, selectedOperation)!;
  const otherGateOutput = applySceneUnary(query, unselectedOperation)!;
  const bothOrders = [
    applySceneUnary(otherGateOutput, selectedOperation),
    applySceneUnary(answer, unselectedOperation),
  ];
  const nearMissPool = distinctOutputs([
    query,
    otherGateOutput,
    ...bothOrders,
    ...RULE_SWITCH_OPERATION_GRAMMAR.map((operation) => applySceneUnary(query, operation)),
    // The correct board with one more bounded operation run on top of it.
    //
    // Added 2026-08-27. Every option above either sits where the query sits or
    // where some single operation puts it, so when neither demonstrated gate was
    // a recolour the answer was the only board in its cells — and in 48% of
    // items, working out where the tokens land finished it. Running one more
    // operation on the correct board keeps those cells and changes the fill,
    // which is the near miss the pool was missing. It is the same mistake the
    // pool already names when the other gate happens to be a recolour: carrying
    // on past the gate the query actually shows.
    ...RULE_SWITCH_OPERATION_GRAMMAR.map((operation) => applySceneUnary(answer, operation)),
  ]).filter((output) => sceneSignature(output) !== sceneSignature(answer));
  const nearMisses = selectDistractors(nearMissPool, rng, "rule switching", { answer });
  const puzzle = makePuzzle(
    "prototype-rule-switching",
    "matrix",
    "machineTable",
    "Each gate has a demonstrated rule. Apply only the gate shown in the query path.",
    2,
    [
      inputA, gateVisual("a"), outputA,
      inputB, gateVisual("b"), outputB,
      query, gateVisual(program.queryGate), { blank: true },
    ],
    answer,
    nearMisses,
    rng,
    `The worked rows define two separate gates. Gate A ${ruleSwitchOperationDescription(program.gateA)}, while gate B ${ruleSwitchOperationDescription(program.gateB)}. The query displays only gate ${program.queryGate.toUpperCase()}, so applying that demonstrated operation gives the highlighted board. The distractors omit the selected gate, use the other gate, combine both gates, run the selected gate and then keep going, or follow another bounded operation that fails the selected gate's worked row.`,
  );
  const family = definition(
    "rule-switching-v2",
    ["two-worked-gates", "query-gate-cue", "gate-identity"],
    JSON.stringify(program),
    (candidate) => {
      const [workedInputA, shownGateA, workedOutputA, workedInputB, shownGateB, workedOutputB, queryInput, queryGate] =
        candidate.stem.map(scenePanel);
      if (!workedInputA || !shownGateA || !workedOutputA || !workedInputB || !shownGateB ||
          !workedOutputB || !queryInput || !queryGate) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const gateAKey = gateSymbolKey(shownGateA);
      const gateBKey = gateSymbolKey(shownGateB);
      const queryGateKey = gateSymbolKey(queryGate);
      const shownQueryGate = queryGateKey === gateAKey && queryGateKey !== gateBKey ? "a"
        : queryGateKey === gateBKey && queryGateKey !== gateAKey ? "b"
          : null;
      if (!shownQueryGate) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = RULE_SWITCH_PROGRAM_GRAMMAR.filter((candidateProgram) =>
        candidateProgram.queryGate === shownQueryGate &&
        unaryExampleMatches(workedInputA, workedOutputA, candidateProgram.gateA) &&
        unaryExampleMatches(workedInputB, workedOutputB, candidateProgram.gateB));
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applySceneUnary(queryInput, selectedRuleSwitchOperation(candidateProgram))));
      const wrongExecutions = [
        { output: queryInput, reason: "omits the selected gate" },
        ...survivors.flatMap((candidateProgram) => {
          const selected = selectedRuleSwitchOperation(candidateProgram);
          const unselected = unselectedRuleSwitchOperation(candidateProgram);
          const otherOutput = applySceneUnary(queryInput, unselected);
          const selectedOutput = applySceneUnary(queryInput, selected);
          return [
            { output: otherOutput, reason: "uses the other demonstrated gate" },
            {
              output: otherOutput && applySceneUnary(otherOutput, selected),
              reason: "applies both gates instead of the one shown",
            },
            {
              output: selectedOutput && applySceneUnary(selectedOutput, unselected),
              reason: "applies both gates instead of the one shown",
            },
          ];
        }),
        // Anything else the bounded operation set can produce from the query.
        // Listed last so the more specific reasons above win when both apply.
        ...RULE_SWITCH_OPERATION_GRAMMAR.flatMap((operation) => {
          const selectedByASurvivor = survivors.some((candidateProgram) =>
            JSON.stringify(selectedRuleSwitchOperation(candidateProgram)) === JSON.stringify(operation));
          return selectedByASurvivor
            ? []
            : [{
                output: applySceneUnary(queryInput, operation),
                reason: "follows an operation that fails the selected gate's worked row",
              }];
        }),
        // Widest of all, so it is listed last: the selected gate run correctly
        // and then carried one operation further.
        ...survivors.flatMap((candidateProgram) => {
          const selectedOutput = applySceneUnary(queryInput, selectedRuleSwitchOperation(candidateProgram));
          return selectedOutput
            ? RULE_SWITCH_OPERATION_GRAMMAR.map((operation) => ({
                output: applySceneUnary(selectedOutput, operation),
                reason: "runs the selected gate and then keeps going",
              }))
            : [];
        }),
      ];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["two-worked-gates", "query-gate-cue", "gate-identity"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output && sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/** How many worked gates a composed-transform item shows. */
export type ComposedGateCount = SceneComposedProgramLength;

const COMPOSED_TRANSFORM_D4_BUCKET = "composed-transform-d4";
const COMPOSED_TRANSFORM_D5_BUCKET = "composed-transform-d5";
const COMPOSED_TRANSFORM_D6_BUCKET = "composed-transform-d6";

/** The displayed gate count each named bucket draws at. */
const COMPOSED_TRANSFORM_BUCKET_GATES: Readonly<Record<string, ComposedGateCount>> = {
  [COMPOSED_TRANSFORM_D4_BUCKET]: 2,
  [COMPOSED_TRANSFORM_D5_BUCKET]: 3,
  [COMPOSED_TRANSFORM_D6_BUCKET]: 5,
};

/** d4 applies its two worked transformations in their demonstrated order. */
const COMPOSED_TRANSFORM_PAIR_ORDER = [0, 1] as const;

/** d5 always applies all three worked transformations, with varied order. */
const COMPOSED_TRANSFORM_HARD_ORDERS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Every ordered program a solver could posit at each displayed depth — the
 * oracle's search space. Servability, single-gate ablation, and the
 * public/held-out split are narrower views of these three lists.
 *
 * The lists are built lazily: enumerating the five-gate space is 8^5 walks and
 * only the d6 bucket ever needs it, so a run that never draws a five-gate item
 * never pays for it.
 */
const composedTransformGrammars = new Map<ComposedGateCount, readonly SceneComposedProgram[]>();

function composedTransformGrammarFor(gateCount: ComposedGateCount): readonly SceneComposedProgram[] {
  const cached = composedTransformGrammars.get(gateCount);
  if (cached) return cached;
  const grammar: readonly SceneComposedProgram[] = gateCount === 2
    ? enumerateSceneOrderedCompositions()
    : gateCount === 3
      ? enumerateSceneOrderedThreeStepCompositions()
      : gateCount === 4
        ? enumerateSceneOrderedFourStepCompositions()
        : enumerateSceneOrderedFiveStepCompositions();
  composedTransformGrammars.set(gateCount, grammar);
  return grammar;
}

/** Gate labels, in the order the query strip shows them. */
const COMPOSED_GATE_LETTERS = ["A", "B", "C", "D", "E"] as const;
const COMPOSED_GATE_COUNT_WORDS: Readonly<Record<ComposedGateCount, string>> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
};

/** Applies one gate to one board. The sweep below passes a memoizing version. */
type ComposedStepper = (input: Scene, step: SceneCompositionPrimitive) => Scene | null;

function runComposedGates(
  input: Scene,
  steps: readonly SceneCompositionPrimitive[],
  order: readonly number[],
  apply: ComposedStepper,
): Scene | null {
  let value: Scene | null = input;
  for (const index of order) value = value && apply(value, steps[index]);
  return value;
}

function composedGateIndexes(gateCount: number): number[] {
  return Array.from({ length: gateCount }, (_, index) => index);
}

/** Every ordered selection of `length` distinct gates. */
function composedGateRuns(gateCount: number, length: number): number[][] {
  const build = (available: readonly number[], remaining: number): number[][] => {
    if (remaining === 0) return [[]];
    return available.flatMap((head) =>
      build(available.filter((index) => index !== head), remaining - 1)
        .map((tail) => [head, ...tail]));
  };
  return build(composedGateIndexes(gateCount), length);
}

/** Every query-gate run except the one the strip shows. */
function composedWrongGateOrders(gateCount: number, runOrder?: readonly number[]): number[][] {
  const correctOrder = runOrder ?? composedGateIndexes(gateCount);
  const correct = correctOrder.join(",");
  return composedGateRuns(gateCount, correctOrder.length)
    .filter((order) => order.join(",") !== correct);
}

/**
 * Every proper, non-empty run of the gates in displayed order — that is, every
 * way to skip at least one gate but keep the rest in the order shown.
 */
function composedGateOmissions(
  gateCount: number,
  runOrder?: readonly number[],
): { kept: number[]; skipped: number[] }[] {
  const all = runOrder ?? composedGateIndexes(gateCount);
  const omissions: { kept: number[]; skipped: number[] }[] = [];
  for (let mask = 1; mask < (1 << all.length) - 1; mask++) {
    const kept = all.filter((_, position) => ((mask >> position) & 1) === 1);
    const skipped = all.filter((_, position) => ((mask >> position) & 1) === 0);
    omissions.push({ kept, skipped });
  }
  return omissions;
}

function composedGateList(indexes: readonly number[]): string {
  const letters = indexes.map((index) => COMPOSED_GATE_LETTERS[index]);
  return letters.length === 1
    ? letters[0]
    : `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`;
}

/**
 * Wrong ways to RUN the demonstrated gates: a wrong order, or a run that skips
 * at least one of them.
 *
 * These need no search through the grammar, which is what lets the servability
 * sweep enumerate the whole four-gate space without re-deriving every program.
 */
function composedRunErrors(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  const gateCount = steps.length;
  const queryGateCount = runOrder?.length ?? gateCount;
  return [
    ...composedWrongGateOrders(gateCount, runOrder).map((order) => ({
      output: runComposedGates(query, steps, order, apply),
      reason: `applies the ${queryGateCount} query gates in a different order`,
    })),
    ...composedGateOmissions(gateCount, runOrder).map(({ kept, skipped }) => ({
      output: runComposedGates(query, steps, kept, apply),
      reason: `skips demonstrated gate ${composedGateList(skipped)}`,
    })),
  ];
}

/**
 * Wrong READINGS of the worked rows: one gate replaced by another primitive
 * that does not reproduce that gate's own worked row.
 *
 * Enumerated from the primitive pool rather than by scanning the grammar for
 * near neighbours — the same set, at a fraction of the cost once the four-gate
 * grammar is over a thousand programs and the five-gate one over four thousand.
 */
function composedReadingErrors(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  const executions: Array<{ output: Scene | null; reason: string }> = [];
  const order = runOrder ?? composedGateIndexes(steps.length);
  for (const index of order) {
    for (const replacement of sceneComposedPrimitives()) {
      if (compositionPrimitiveKey(replacement) === compositionPrimitiveKey(steps[index])) continue;
      const misread = steps.map((step, position) => (position === index ? replacement : step));
      if (!isSceneComposedProgram(misread)) continue;
      executions.push({
        // A misread gate is still run the way this item runs its gates.
        output: runComposedGates(query, misread, order, apply),
        reason: "replaces one step with a primitive that fails its worked row",
      });
    }
  }
  return executions;
}

/**
 * Every wrong way to answer a composed item, with the reason the review screen
 * shows. Generation draws its near misses from exactly this list and the
 * validator witnesses options against it, so nothing can be served that the
 * oracle cannot explain.
 */
function composedWrongExecutions(
  query: Scene,
  steps: readonly SceneCompositionPrimitive[],
  apply: ComposedStepper = applySceneCompositionPrimitive,
  runOrder?: readonly number[],
): Array<{ output: Scene | null; reason: string }> {
  return [
    ...composedRunErrors(query, steps, apply, runOrder),
    ...composedReadingErrors(query, steps, apply, runOrder),
  ];
}

function compositionPrimitiveDescription(primitive: SceneCompositionPrimitive): string {
  if (primitive.kind === "spatial") return spatialOperationDescription(primitive.operation);
  if (primitive.kind === "turn") {
    return `turns each arrow on the spot, a quarter-turn ${primitive.quarterTurns === 1 ? "clockwise" : "anticlockwise"}, without moving it`;
  }
  return `changes only the token in the upper-left slot to ${primitive.fill}`;
}

function compositionPrimitiveMatches(input: Scene, output: Scene, primitive: SceneCompositionPrimitive): boolean {
  const predicted = applySceneCompositionPrimitive(input, primitive);
  return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
}

function compositionPrimitiveKey(primitive: SceneCompositionPrimitive): string {
  return JSON.stringify(primitive);
}

/**
 * The shapes a composed-transform board draws from, plus the one arrow every
 * board carries.
 *
 * The arrow is the only token on the board whose own direction can be read, so
 * it is what makes a token turn visible at all. It is present whether or not
 * the drawn program turns anything: a board with nothing orientable would make
 * `turn` a step that changes nothing, and the grammar rejects such a step
 * rather than serving it.
 */
const CANONICAL_COMPOSED_SHAPES = ["circle", "square", "triangle", "diamond", "star"] as const;
const COMPOSED_ORIENTABLE_SHAPE = "arrow" as const;

/** The query board every composed-transform item shows: two tokens and an arrow. */
function composedTransformQuery(shapes: readonly SceneToken["shape"][]): Scene {
  return scene([
    { row: 0, column: 0, object: token(shapes[4]) },
    { row: 2, column: 0, object: token(shapes[3]) },
    { row: 0, column: 2, object: token(COMPOSED_ORIENTABLE_SHAPE) },
  ]);
}

/**
 * The input board of one gate's worked row.
 *
 * A fill gate needs a token in the upper-left slot to repaint; every other gate
 * needs a board whose movement, or whose arrow, is easy to follow. Both layouts
 * carry the arrow, which is what lets one worked row show a board that moved
 * while its arrow kept pointing the same way, and another show an arrow that
 * turned while the board stood still.
 */
function composedWorkedInput(
  primitive: SceneCompositionPrimitive,
  shapes: readonly SceneToken["shape"][],
  offset: number,
): Scene {
  const partner = token(shapes[offset % shapes.length]);
  return primitive.kind === "setFillAt"
    ? scene([
        { row: 0, column: 0, object: partner },
        { row: 2, column: 2, object: token(COMPOSED_ORIENTABLE_SHAPE) },
      ])
    : scene([
        { row: 0, column: 0, object: partner },
        { row: 1, column: 2, object: token(COMPOSED_ORIENTABLE_SHAPE, "solid") },
      ]);
}

/**
 * Cache one gate application per (board, gate) pair.
 *
 * The servability sweep runs every ordering and every partial run of every
 * program on ONE canonical query, so the same board meets the same gate
 * thousands of times, and each application re-validates a scene. At five gates
 * that is 4,320 programs against 119 orderings and 30 partial runs each, which
 * is why the cache is not an optimisation but the difference between a sweep
 * that finishes and one that does not. The cache is
 * created per sweep and holds only the few thousand boards one query can reach,
 * and it changes nothing about the result: the same pair always had the same
 * answer.
 */
function memoizedComposedStepper(): ComposedStepper {
  // Keyed by object identity, not by scene contents: every board in a sweep
  // either is the one canonical query or came out of this cache, so identical
  // boards are the same object and hashing a reference costs nothing. A caller
  // that passes a structurally equal but different object simply misses.
  const byInput = new Map<Scene, Map<SceneCompositionPrimitive, Scene | null>>();
  return (input, step) => {
    let bySteps = byInput.get(input);
    if (!bySteps) {
      bySteps = new Map();
      byInput.set(input, bySteps);
    }
    if (bySteps.has(step)) return bySteps.get(step) ?? null;
    const output = applySceneCompositionPrimitive(input, step);
    bySteps.set(step, output);
    return output;
  };
}

/**
 * Is this program servable, and does every gate it displays actually matter?
 *
 * Four conditions, all on the fixed canonical query. Geometry alone decides
 * them, so checking one shape order is exact: renaming shapes is a bijection on
 * scene signatures.
 *
 *  1. the program runs end to end;
 *  2. the fully reversed order lands on a different board, so order is visibly
 *     part of the rule;
 *  3. SINGLE-GATE ABLATION — deleting any one displayed gate changes the final
 *     board. Before 2026-08-25, 16 of the 56 public three-step programs failed
 *     this: they painted the upper-left slot twice in a row, so the first paint
 *     was invisible and a nominally three-step item really needed two. A gate a
 *     solver can ignore is not a step; the program is not servable. An ablated
 *     run that does not apply at all counts as changed — it produces no board,
 *     so it cannot reproduce the answer; and
 *  4. running the gates wrongly leaves enough distinct boards to fill the
 *     option list.
 */
function composedProgramIsServable(program: SceneComposedProgram, apply: ComposedStepper): boolean {
  const steps = sceneComposedProgramSteps(program);
  const displayed = composedGateIndexes(steps.length);
  const query = composedTransformQuery(CANONICAL_COMPOSED_SHAPES);
  const answer = runComposedGates(query, steps, displayed, apply);
  if (!answer) return false;
  const answerKey = sceneSignature(answer);

  const reversed = runComposedGates(query, steps, [...displayed].reverse(), apply);
  if (!reversed || sceneSignature(reversed) === answerKey) return false;

  for (const gate of displayed) {
    const ablated = runComposedGates(query, steps, displayed.filter((index) => index !== gate), apply);
    if (ablated && sceneSignature(ablated) === answerKey) return false;
  }

  // Counted lazily, and only over the wrong RUNS: they are a subset of the near
  // misses generation actually draws from, so a program that clears the bar
  // here clears it there too, and the sweep never has to price the rest.
  const wrongBoards = new Set<string>();
  const collect = (order: readonly number[]) => {
    if (wrongBoards.size >= DISTRACTORS_PER_ITEM) return;
    const output = runComposedGates(query, steps, order, apply);
    if (!output) return;
    const key = sceneSignature(output);
    if (key !== answerKey) wrongBoards.add(key);
  };
  for (const order of composedWrongGateOrders(steps.length)) collect(order);
  for (const { kept } of composedGateOmissions(steps.length)) collect(kept);
  return wrongBoards.size >= DISTRACTORS_PER_ITEM;
}

/**
 * A held-out program moves the board twice and then only touches tokens.
 *
 * The committed split (raise-the-ceiling plan, Lever 2; widened for the
 * four-gate space by escalate-the-quiz, Phase 3): a program is HELD OUT when
 * its first two steps both move board positions and every remaining step is
 * token-local — a fill change or a turn. That is the one composition shape the
 * public pool never practises, while every primitive stays publicly visible.
 *
 * The rule is stated once and applied at every depth, which at five gates means
 * it reserves NOTHING. A five-gate program of this shape needs three distinct
 * token-local steps, and the pool holds only two fills and two turns with at
 * most one turn allowed, so the tail is forced to be both fills plus a turn —
 * and a turn never repaints the upper-left slot, so the earlier fill is always
 * invisible and single-gate ablation rejects the program. All 144 five-gate
 * programs of the reserved shape fail for exactly that reason; the proof is a
 * test in scene-families.test.ts. `composed-transform-d6` therefore has no
 * held-out twin, and the reserved-transfer probe stays a three- and four-gate
 * diagnostic.
 */
function composedProgramIsHeldOut(program: SceneComposedProgram): boolean {
  const steps = sceneComposedProgramSteps(program);
  return steps[0].kind === "spatial" && steps[1].kind === "spatial" &&
    steps.slice(2).every((step) => step.kind !== "spatial");
}

interface ComposedTransformPartition {
  publicPrograms: readonly SceneComposedProgram[];
  heldOutPrograms: readonly SceneComposedProgram[];
}

const composedPartitions = new Map<ComposedGateCount, ComposedTransformPartition>();

/**
 * Public/held-out split over the servable programs of one displayed depth.
 *
 * The held-out list is consumed only by evaluation harnesses, never by the
 * public assembler; the leakage test in scene-families.test.ts enforces the
 * boundary, and the partition test proves the two sides are disjoint and
 * together are the whole servable space.
 */
export function partitionComposedTransformPrograms(
  gateCount: ComposedGateCount = 3,
): ComposedTransformPartition {
  const cached = composedPartitions.get(gateCount);
  if (cached) return cached;
  const apply = memoizedComposedStepper();
  const servable = composedTransformGrammarFor(gateCount)
    .filter((program) => gateCount === 2
      ? composedRecombinedOrderIsServable(program, COMPOSED_TRANSFORM_PAIR_ORDER)
      : composedProgramIsServable(program, apply));
  const partition: ComposedTransformPartition = {
    publicPrograms: servable.filter((program) => !composedProgramIsHeldOut(program)),
    heldOutPrograms: servable.filter(composedProgramIsHeldOut),
  };
  composedPartitions.set(gateCount, partition);
  return partition;
}

/** Every servable program of one displayed depth, public and held out alike. */
export function servableComposedTransformPrograms(
  gateCount: ComposedGateCount,
): readonly SceneComposedProgram[] {
  const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
  return [...publicPrograms, ...heldOutPrograms];
}

/** The complete grammar one displayed depth is drawn from, before any filter. */
export function composedTransformGrammar(gateCount: ComposedGateCount): readonly SceneComposedProgram[] {
  return composedTransformGrammarFor(gateCount);
}

/**
 * The board servability and single-gate ablation are decided on.
 *
 * Exported so the ablation and partition proofs measure the same board the
 * filter used. A test that rebuilt this board from a copy of the template would
 * keep passing after the template changed, which is exactly the kind of proof
 * that proves nothing.
 */
export function canonicalComposedTransformQuery(): Scene {
  return composedTransformQuery(CANONICAL_COMPOSED_SHAPES);
}

/**
 * Every bucket that displays a gate strip, and how many gates it shows.
 *
 * The owner's standing rule of 2026-08-27 is that no item may display more than
 * three gates: a fourth is more procedure, not more reasoning. A rule kept only
 * in comments gets broken by the next batch, so a test walks this table against
 * the promotion registry and fails if anything a band can draw shows a fourth.
 * A new gate bucket has to be registered here to be covered — which is the
 * point: the table is the single place gate counts are declared.
 */
export function declaredGateCounts(): Readonly<Record<string, number>> {
  return {
    ...COMPOSED_TRANSFORM_BUCKET_GATES,
    ...TRANSFORMATION_MACHINE_BUCKET_GATES,
    ...COMBINING_MACHINE_BUCKET_GATES,
  };
}

interface ComposedProgramOrder {
  program: SceneComposedProgram;
  queryOrder: readonly number[];
}

/** Program/order eligibility depends only on the cached program population. */
const composedProgramOrderCache = new WeakMap<
  readonly SceneComposedProgram[],
  Map<string, ComposedProgramOrder[]>
>();

/** Whether an ordered query has a unique answer and a full near-miss set. */
function composedRecombinedOrderIsServable(
  program: SceneComposedProgram,
  queryOrder: readonly number[],
): boolean {
  const steps = sceneComposedProgramSteps(program);
  const query = composedTransformQuery(CANONICAL_COMPOSED_SHAPES);
  const answer = runComposedGates(query, steps, queryOrder, applySceneCompositionPrimitive);
  const reversed = runComposedGates(
    query, steps, [...queryOrder].reverse(), applySceneCompositionPrimitive);
  if (!answer || !reversed || sceneSignature(answer) === sceneSignature(reversed)) return false;
  const answerKey = sceneSignature(answer);
  for (const gate of queryOrder) {
    const ablated = runComposedGates(
      query, steps, queryOrder.filter((index) => index !== gate), applySceneCompositionPrimitive);
    if (ablated && sceneSignature(ablated) === answerKey) return false;
  }
  const wrongBoards = distinctOutputs(
    composedWrongExecutions(query, steps, applySceneCompositionPrimitive, queryOrder)
      .map((execution) => execution.output),
  ).filter((candidate) => sceneSignature(candidate) !== answerKey);
  return wrongBoards.length >= DISTRACTORS_PER_ITEM;
}

function composedProgramOrders(
  programs: readonly SceneComposedProgram[],
  bucketId: string,
): ComposedProgramOrder[] {
  const byBucket = composedProgramOrderCache.get(programs) ?? new Map<string, ComposedProgramOrder[]>();
  const cached = byBucket.get(bucketId);
  if (cached) return cached;
  const choices = bucketId !== COMPOSED_TRANSFORM_D5_BUCKET
    ? programs.map((program) => ({
      program,
      queryOrder: composedGateIndexes(sceneComposedProgramSteps(program).length),
    }))
    : programs
      .filter((program) => sceneComposedProgramSteps(program).length === 3)
      .flatMap((program) => COMPOSED_TRANSFORM_HARD_ORDERS
        .filter((queryOrder) => composedRecombinedOrderIsServable(program, queryOrder))
        .map((queryOrder) => ({ program, queryOrder })));
  byBucket.set(bucketId, choices);
  composedProgramOrderCache.set(programs, byBucket);
  return choices;
}

function composedTransform(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = COMPOSED_TRANSFORM_BUCKET_GATES[bucket.bucket] ?? 3;
  const choices = composedProgramOrders(
    partitionComposedTransformPrograms(gateCount).publicPrograms,
    bucket.bucket,
  );
  const choice = pick(rng, choices);
  return composedTransformForProgram(choice.program, rng, {
    bucketId: bucket.bucket,
    queryOrder: choice.queryOrder,
  });
}

function composedTransformForProgram(
  program: SceneComposedProgram,
  rng: Rng,
  options: { bucketId: string; queryOrder?: readonly number[] },
): SceneFamilyCandidate {
  const steps = sceneComposedProgramSteps(program);
  const gateCount = steps.length as ComposedGateCount;
  const displayed = composedGateIndexes(gateCount);
  const gateIds = displayed.map((index) => COMPOSED_GATE_IDS[index]);
  const queryOrder = options.queryOrder ?? displayed;
  if (queryOrder.length !== gateCount || new Set(queryOrder).size !== queryOrder.length ||
    queryOrder.some((index) => index < 0 || index >= gateCount)) {
    throw new Error("composed transform query must use every worked gate exactly once");
  }
  const queryGateIds = queryOrder.map((index) => gateIds[index]);
  const bucket = requireSceneFamilyBucket(
    "composed-transform-v2",
    options.bucketId,
  );
  const shapes = shuffled(rng, CANONICAL_COMPOSED_SHAPES);
  const worked = steps.map((step, index) => {
    const input = composedWorkedInput(step, shapes, index * 2);
    const output = applySceneCompositionPrimitive(input, step);
    if (!output) throw new Error("composed transform needs a worked row for every displayed gate");
    return { input, output };
  });
  const query = composedTransformQuery(shapes);
  const answer = runComposedGates(query, steps, queryOrder, applySceneCompositionPrimitive);
  const otherDirection = runComposedGates(
    query, steps, [...queryOrder].reverse(), applySceneCompositionPrimitive);
  if (!answer || !otherDirection || sceneSignature(otherDirection) === sceneSignature(answer)) {
    throw new Error(`composed transform needs a servable ${queryOrder.length}-gate query`);
  }
  const nearMissPool = distinctOutputs(
    composedWrongExecutions(query, steps, applySceneCompositionPrimitive, queryOrder)
      .map((execution) => execution.output))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  // Keep the other-direction board because it is the near miss that proves
  // order matters.
  const composedDistractors = selectDistractors(nearMissPool, rng, "composed transform", { answer, required: [otherDirection] });
  const gateWord = COMPOSED_GATE_COUNT_WORDS[gateCount];
  const cueIds = [
    ...gateIds.map((gateId) => `worked-gate-${gateId}`),
    "query-gate-order",
    ...(steps.some((step) => step.kind === "setFillAt") ? ["targeted-fill-slot"] : []),
    ...(steps.some((step) => step.kind === "turn") ? ["token-orientation"] : []),
  ];
  const instruction = `Infer each worked gate, then apply the ${gateWord} query gates from left to right.`;
  const queryInWorkedOrder = queryOrder.every((gate, index) => gate === displayed[index]);
  const explanation = queryInWorkedOrder
    ? `The ${gateWord} worked rows expose the primitives separately. ${steps
      .map((step, index) => `Gate ${COMPOSED_GATE_LETTERS[index]} ${compositionPrimitiveDescription(step)}`)
      .join("; ")}. The query strip shows ${composedGateList(displayed)} in that order, so the ${gateWord} effects must be applied left to right to obtain the highlighted board. Every displayed gate is needed: dropping any one of them changes the result. The distractors run the gates in another order, skip one, or replace a step with another bounded primitive that fails its worked row.`
    : `The ${gateWord} worked rows expose the primitives separately. ${steps
      .map((step, index) => `Gate ${COMPOSED_GATE_LETTERS[index]} ${compositionPrimitiveDescription(step)}`)
      .join("; ")}. The query strip shows ${composedGateList(queryOrder)} in that order, so every demonstrated effect must be applied left to right to obtain the highlighted board. Dropping a displayed gate changes the result. The distractors run the gates in another order, skip one, or replace a step with another bounded primitive that fails its worked row.`;
  const puzzle = makePuzzle(
    "prototype-composed-transform",
    "matrix",
    "machineTable",
    instruction,
    bucket.difficulty,
    [
      ...worked.flatMap((row, index) => [row.input, gateVisual(gateIds[index]), row.output]),
      query,
      gateVisual(...queryGateIds),
      { blank: true },
    ],
    answer,
    composedDistractors,
    rng,
    explanation,
  );
  const family = definition(
    "composed-transform-v2",
    cueIds,
    sceneComposedProgramKey(program),
    (candidate) => {
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      if (candidate.stem.length !== gateCount * 3 + 3) return empty;
      const panels = candidate.stem.map(scenePanel);
      const workedRows: { input: Scene; output: Scene; gateKey: string }[] = [];
      for (const index of displayed) {
        const input = panels[index * 3];
        const shownGate = panels[index * 3 + 1];
        const output = panels[index * 3 + 2];
        const gateKey = shownGate && gateSymbolKey(shownGate);
        if (!input || !output || !gateKey) return empty;
        workedRows.push({ input, output, gateKey });
      }
      const queryInput = panels[gateCount * 3];
      const queryGates = panels[gateCount * 3 + 1];
      if (!queryInput || !queryGates) return empty;

      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const visibleQueryOrder = orderedQueryGates.map((placement) =>
        workedRows.findIndex((row) => row.gateKey === JSON.stringify(placement.object)));
      const queryGateCount = visibleQueryOrder.length;
      const wideStrip = queryGateCount >= GATE_STRIP_COLUMNS;
      const stripRow = wideStrip ? 0 : 1;
      const stripValid = queryGates.tiles.length === 0 &&
        queryGates.rows === (wideStrip ? GATE_STRIP_ROWS : 3) &&
        queryGates.columns === (wideStrip ? queryGateCount : 3) &&
        queryGateCount === queryOrder.length &&
        orderedQueryGates.every((placement, index) => placement.row === stripRow && placement.column === index) &&
        visibleQueryOrder.every((index) => index >= 0) &&
        new Set(visibleQueryOrder).size === visibleQueryOrder.length;
      if (!stripValid) return empty;

      // Every program in the grammar whose i-th gate reproduces the i-th worked
      // row. Building it slot by slot from the primitive pool and then keeping
      // only the combinations the grammar contains is exactly the same set as
      // filtering the whole grammar, and the equivalence has its own test.
      const matchesByGate = workedRows.map((row) =>
        sceneComposedPrimitives().filter((primitive) =>
          compositionPrimitiveMatches(row.input, row.output, primitive)));
      const survivors: SceneComposedProgram[] = [];
      const build = (index: number, chosen: SceneCompositionPrimitive[]) => {
        if (index === gateCount) {
          if (isSceneComposedProgram(chosen)) survivors.push(sceneComposedProgramFromSteps(chosen));
          return;
        }
        for (const primitive of matchesByGate[index]) build(index + 1, [...chosen, primitive]);
      };
      build(0, []);

      const predictFor = (candidateProgram: SceneComposedProgram): Scene | null => {
        const candidateSteps = sceneComposedProgramSteps(candidateProgram);
        return runComposedGates(
          queryInput, candidateSteps, visibleQueryOrder, applySceneCompositionPrimitive);
      };
      const predictions = distinctOutputs(survivors.map(predictFor));
      const wrongExecutions = survivors.flatMap((survivor) =>
        composedWrongExecutions(
          queryInput, sceneComposedProgramSteps(survivor), applySceneCompositionPrimitive, visibleQueryOrder));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: cueIds,
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongExecutions.find((execution) => execution.output &&
            sceneSignature(execution.output) === sceneSignature(option))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

const RING_POSITIONS = [
  { row: 0, column: 0 },
  { row: 0, column: 1 },
  { row: 0, column: 2 },
  { row: 1, column: 2 },
  { row: 2, column: 2 },
  { row: 2, column: 1 },
  { row: 2, column: 0 },
  { row: 1, column: 0 },
] as const;

interface RingStepRule {
  direction: -1 | 1;
  startStep: 1 | 2 | 3;
  stepDelta: 0 | 1 | 2;
}

/**
 * Every bounded jump rule a solver could read off the shown landings, including
 * the constant-jump rules where the step never grows. Those cannot be the hidden
 * rule — a constant jump is a first-order sequence — but a solver who assumes
 * one lands somewhere specific, so they belong in the enumeration that finds
 * competing predictions and witnesses the wrong options.
 */
const RING_STEP_GRAMMAR: readonly RingStepRule[] = ([-1, 1] as const).flatMap((direction) =>
  ([1, 2, 3] as const).flatMap((startStep) =>
    ([0, 1, 2] as const).map((stepDelta) => ({ direction, startStep, stepDelta }))));

/** The rules this family may actually hide: the jump has to grow. */
const RING_SECOND_ORDER_RULES: readonly RingStepRule[] =
  RING_STEP_GRAMMAR.filter((rule) => rule.stepDelta > 0);

function ringRuleDescription(rule: RingStepRule): string {
  const direction = rule.direction === 1 ? "clockwise" : "counter-clockwise";
  return rule.stepDelta === 0
    ? `the ${direction} rule that jumps ${rule.startStep} slot${rule.startStep === 1 ? "" : "s"} every time`
    : `the ${direction} rule that starts at ${rule.startStep} and grows by ${rule.stepDelta}`;
}

function ringIndexes(rule: RingStepRule, length: number, startIndex = 0): number[] {
  const indexes = [startIndex];
  for (let transition = 0; transition < length - 1; transition++) {
    const step = rule.direction * (rule.startStep + transition * rule.stepDelta);
    indexes.push(((indexes[indexes.length - 1] + step) % RING_POSITIONS.length + RING_POSITIONS.length) % RING_POSITIONS.length);
  }
  return indexes;
}

/** Same contract as `selectDistractors`, for a family whose near misses are ring slots. */
function selectRingIndexes(pool: readonly number[], rng: Rng): number[] {
  const selected = shuffled(rng, pool).slice(0, DISTRACTORS_PER_ITEM);
  if (selected.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(
      `second-order sequence needs ${DISTRACTORS_PER_ITEM} competing predictions but found ${selected.length}`,
    );
  }
  return selected;
}

function secondOrderSequence(rng: Rng): SceneFamilyCandidate {
  const rule = pick(rng, RING_SECOND_ORDER_RULES);
  const [shape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const startIndex = pick(rng, RING_POSITIONS.map((_, index) => index));
  const indexes = ringIndexes(rule, 6, startIndex);
  const atIndex = (index: number) => one(shape, RING_POSITIONS[index].row, RING_POSITIONS[index].column, "solid");
  const shown = indexes.slice(0, 5).map(atIndex);
  const answer = atIndex(indexes[5]);
  const competingByPrediction = new Map<number, RingStepRule>();
  for (const candidateRule of RING_STEP_GRAMMAR) {
    const candidateIndexes = ringIndexes(candidateRule, 6, startIndex);
    const fits = candidateIndexes.slice(0, 5).every((index, position) => index === indexes[position]);
    const prediction = candidateIndexes[5];
    if (!fits && prediction !== indexes[5]) competingByPrediction.set(prediction, candidateRule);
  }
  const distractorIndexes = selectRingIndexes([...competingByPrediction.keys()], rng);
  const puzzle = makePuzzle(
    "prototype-second-order-sequence",
    "sequence",
    "row",
    "Track how the perimeter jump changes. Where does the token land next?",
    4,
    [...shown, { blank: true }],
    answer,
    distractorIndexes.map(atIndex),
    rng,
    `Read the eight outside slots as one ordered ring. The token moves ${rule.direction === 1 ? "clockwise" : "counter-clockwise"}, starting with a jump of ${rule.startStep} slot${rule.startStep === 1 ? "" : "s"}; each later jump grows by ${rule.stepDelta}. The next jump is therefore ${rule.startStep + 4 * rule.stepDelta} slots in the same direction, which lands at the highlighted position. Each distractor comes from another bounded direction, starting jump, or growth rule that fails a shown landing.`,
  );
  const family = definition(
    "second-order-sequence-v2",
    ["perimeter-order", "movement-direction", "growing-jump-size"],
    JSON.stringify(rule),
    (candidate) => {
      const scenes = candidate.stem.slice(0, -1).map(scenePanel);
      if (scenes.some((panel) => !panel)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const firstObject = scenes[0]!.objects[0]?.object;
      const observed = scenes.map((panel) => {
        if (!panel || panel.objects.length !== 1 || panel.tiles.length > 0 || !firstObject ||
            firstObject.kind !== "token" || JSON.stringify(panel.objects[0].object) !== JSON.stringify(firstObject)) return -1;
        return RING_POSITIONS.findIndex((position) =>
          position.row === panel.objects[0].row && position.column === panel.objects[0].column);
      });
      const observedStart = observed[0];
      const survivors = observedStart === -1 ? [] : RING_STEP_GRAMMAR.filter((candidateRule) =>
        ringIndexes(candidateRule, observed.length, observedStart)
          .every((index, position) => index === observed[position]));
      const predictedIndexes = new Set(survivors.map((candidateRule) =>
        ringIndexes(candidateRule, observed.length + 1, observedStart).at(-1)!));
      const predictions = firstObject?.kind === "token"
        ? [...predictedIndexes].map((index) => scene([{
            row: RING_POSITIONS[index].row,
            column: RING_POSITIONS[index].column,
            object: firstObject,
          }]))
        : [];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["perimeter-order", "movement-direction", "growing-jump-size"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const optionPlacement = option.objects[0];
          if (!optionPlacement || !firstObject || JSON.stringify(optionPlacement.object) !== JSON.stringify(firstObject)) return null;
          const optionIndex = RING_POSITIONS.findIndex((position) =>
            position.row === optionPlacement.row && position.column === optionPlacement.column);
          const failedRule = RING_STEP_GRAMMAR.find((candidateRule) => {
            const candidateIndexes = ringIndexes(candidateRule, observed.length + 1, observedStart);
            return candidateIndexes.at(-1) === optionIndex &&
              !candidateIndexes.slice(0, observed.length).every((index, position) => index === observed[position]);
          });
          return failedRule ? `${ringRuleDescription(failedRule)} fails a shown landing` : null;
        }),
      };
    },
  );
  // Single-strand row: all five shown landings belong to the answered strand,
  // and the blank is the sixth slot at the same stride of one.
  return asCandidate(family, puzzle, [0, 1, 2, 3, 4]);
}

function inverseAnalogy(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, ANALOGY_COMPOSITION_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const originalA = scene([
    { row: 0, column: 0, object: token(shapes[0], "outline") },
    { row: 1, column: 2, object: token(shapes[1], "half") },
  ]);
  const outputA = applyAnalogyComposition(originalA, program)!;
  const originalB = scene([
    { row: 0, column: 1, object: token(shapes[2], "solid") },
    { row: 2, column: 0, object: token(shapes[3], "half") },
  ]);
  const outputB = applyAnalogyComposition(originalB, program)!;
  const inverseProgram = (candidateProgram: AnalogyCompositionProgram): AnalogyCompositionProgram => ({
    spatial: candidateProgram.spatial.kind === "reflect"
      ? candidateProgram.spatial
      : {
          kind: "rotate",
          quarterTurns: (4 - candidateProgram.spatial.quarterTurns) as 1 | 2 | 3,
        },
    fillDelta: (3 - candidateProgram.fillDelta) as 1 | 2,
  });
  const distractors = distinctOutputs(ANALOGY_COMPOSITION_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyAnalogyComposition(outputB, inverseProgram(candidateProgram))))
    .filter((candidate) => {
      if (sceneSignature(candidate) === sceneSignature(originalB)) return false;
      const targetOutput = applyAnalogyComposition(candidate, program);
      return targetOutput === null || sceneSignature(targetOutput) !== sceneSignature(outputB);
    });
  const selectedDistractors = selectDistractors(distractors, rng, "inverse analogy", { answer: originalB });
  const puzzle = makePuzzle(
    "prototype-inverse-analogy",
    "analogy",
    "analogy",
    "The first pair undoes two changes. Which scene similarly precedes the third?",
    4,
    [outputA, originalA, outputB],
    originalB,
    selectedDistractors,
    rng,
    `The first pair is shown in reverse order: the second board becomes the first after the board ${analogySpatialDescription(program.spatial)} and every fill advances ${program.fillDelta} step${program.fillDelta === 1 ? "" : "s"}. Test each option as the missing input and apply both changes. Only the highlighted input produces the third board exactly. Each distractor would work under another bounded spatial-and-fill program, but that program fails the worked pair.`,
  );
  const family = definition(
    "inverse-analogy-v2",
    ["inverse-worked-pair", "ordered-board-slots", "fill-states"],
    `inverse:${JSON.stringify(program)}`,
    (candidate) => {
      const [workedOutput, workedInput, queryOutput] = candidate.stem.map(scenePanel);
      if (!workedOutput || !workedInput || !queryOutput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = ANALOGY_COMPOSITION_GRAMMAR.filter((candidateProgram) => {
        const predicted = applyAnalogyComposition(workedInput, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const selections = survivors.map((candidateProgram) => candidate.options.flatMap((option, optionIndex) => {
        const predicted = applyAnalogyComposition(option, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(queryOutput) ? [optionIndex] : [];
      }));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["inverse-worked-pair", "ordered-board-slots", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = ANALOGY_COMPOSITION_GRAMMAR.find((candidateProgram) => {
            const optionOutput = applyAnalogyComposition(option, candidateProgram);
            const worked = applyAnalogyComposition(workedInput, candidateProgram);
            return optionOutput !== null && sceneSignature(optionOutput) === sceneSignature(queryOutput) &&
              (worked === null || sceneSignature(worked) !== sceneSignature(workedOutput));
          });
          return failedProgram ? "this input works only under a program that fails the inverse worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * `parallel-evolution-v1` — three tokens on one board, three separate rules.
 *
 * Every other row family in the battery hides ONE rule and asks the solver to
 * continue it. This one hides three and runs them side by side: each of the
 * three distinct-shape tokens walks the eight perimeter slots by its own signed
 * step and cycles its own fill, and every strand is fully visible in every
 * shown board. Nothing is interleaved and nothing is encoded, so the extra work
 * is reading three relations rather than decoding a notation — which is what
 * the withdrawn interleaved family got wrong.
 */
interface ParallelEvolutionRule {
  /** Perimeter slots the token steps each panel; positive is clockwise. */
  positionDelta: -2 | -1 | 0 | 1 | 2;
  /** Places the token advances along outline, half, solid each panel. */
  fillDelta: 0 | 1 | 2;
}

/**
 * The signed perimeter steps. They are pairwise distinct modulo the eight ring
 * slots, and the three fill steps are pairwise distinct modulo the three fills,
 * which together are what make ONE observed transition name exactly one rule.
 */
const PARALLEL_EVOLUTION_POSITION_DELTAS = [-2, -1, 0, 1, 2] as const;
const PARALLEL_EVOLUTION_FILL_DELTAS = [0, 1, 2] as const;

/**
 * The complete declared grammar, and the only rules the oracle enumerates.
 *
 * Five perimeter steps x three fill steps = 15 rules. The count is locked by a
 * test: per-token survivor filtering only proves uniqueness against the grammar
 * it is told about, so quietly growing this list would weaken every item the
 * family has ever served.
 */
export const PARALLEL_EVOLUTION_GRAMMAR: readonly ParallelEvolutionRule[] =
  PARALLEL_EVOLUTION_POSITION_DELTAS.flatMap((positionDelta) =>
    PARALLEL_EVOLUTION_FILL_DELTAS.map((fillDelta) => ({ positionDelta, fillDelta })));

/** Rules that change exactly one aspect — ring XOR fill. 4 + 2 = 6. */
const PARALLEL_EVOLUTION_SINGLE_ASPECT_RULES = PARALLEL_EVOLUTION_GRAMMAR.filter(
  (rule) => (rule.positionDelta === 0) !== (rule.fillDelta === 0));

/** Rules that change both aspects at once. 4 x 2 = 8. */
const PARALLEL_EVOLUTION_BOTH_ASPECT_RULES = PARALLEL_EVOLUTION_GRAMMAR.filter(
  (rule) => rule.positionDelta !== 0 && rule.fillDelta !== 0);

/**
 * Every rule that changes something: 15 - 1 identity = 14.
 *
 * The identity rule stays in the DECLARED grammar because a solver may well
 * hypothesise "this token never changes" and the oracle has to be able to rule
 * that out. It is never DRAWN: a token that holds still shows no transition, so
 * its strand would be confirmed only by an absence of evidence and the item
 * would claim three worked relations while showing two.
 */
const PARALLEL_EVOLUTION_MOVING_RULES = PARALLEL_EVOLUTION_GRAMMAR.filter(
  (rule) => rule.positionDelta !== 0 || rule.fillDelta !== 0);

const PARALLEL_EVOLUTION_D4_BUCKET = "parallel-evolution-d4";
/** Boards in the row: five shown, plus the one behind the blank. */
const PARALLEL_EVOLUTION_PANELS = 6;
/** Strands per board, one token each. */
const PARALLEL_EVOLUTION_STRANDS = 3;
/** Rule triples a draw may try before the family refuses the seed. */
const PARALLEL_EVOLUTION_DRAW_ATTEMPTS = 12;

/** One token's visible state: which perimeter slot, and which fill. */
interface ParallelEvolutionState {
  shape: SceneToken["shape"];
  positionIndex: number;
  fillIndex: number;
}

function parallelEvolutionRuleKey(rule: ParallelEvolutionRule): string {
  return `${rule.positionDelta}:${rule.fillDelta}`;
}

function parallelEvolutionRuleDescription(rule: ParallelEvolutionRule): string {
  const steps = Math.abs(rule.positionDelta);
  const move = rule.positionDelta === 0
    ? "stays on its slot"
    : `moves ${steps} slot${steps === 1 ? "" : "s"} ${rule.positionDelta > 0 ? "clockwise" : "counter-clockwise"}`;
  const fill = rule.fillDelta === 0
    ? "keeps its fill"
    : rule.fillDelta === 1
      ? "cycles outline to half to solid"
      : "cycles outline to solid to half";
  return `${move} and ${fill}`;
}

function advanceParallelEvolutionState(
  state: ParallelEvolutionState,
  rule: ParallelEvolutionRule,
): ParallelEvolutionState {
  return {
    shape: state.shape,
    positionIndex:
      (state.positionIndex + rule.positionDelta + RING_POSITIONS.length) % RING_POSITIONS.length,
    fillIndex: (state.fillIndex + rule.fillDelta) % RELATIONAL_FILLS.length,
  };
}

function parallelEvolutionBoard(states: readonly ParallelEvolutionState[]): Scene {
  return scene(states.map((state) => ({
    ...RING_POSITIONS[state.positionIndex],
    object: token(state.shape, RELATIONAL_FILLS[state.fillIndex]),
  })));
}

/** Read one board back as its three token strands, in a canonical order. */
function parallelEvolutionStates(value: Scene): ParallelEvolutionState[] | null {
  if (value.rows !== 3 || value.columns !== 3) return null;
  if (value.objects.length !== PARALLEL_EVOLUTION_STRANDS) return null;
  if (value.tiles.length > 0 || (value.guides?.length ?? 0) > 0) return null;
  const states: ParallelEvolutionState[] = [];
  for (const placement of value.objects) {
    if (placement.object.kind !== "token") return null;
    const positionIndex = RING_POSITIONS.findIndex((position) =>
      position.row === placement.row && position.column === placement.column);
    const fillIndex = (RELATIONAL_FILLS as readonly string[]).indexOf(placement.object.fill);
    if (positionIndex === -1 || fillIndex === -1) return null;
    states.push({ shape: placement.object.shape, positionIndex, fillIndex });
  }
  // Distinct shapes are what identify a strand across panels; without them the
  // row could not be read at all.
  if (new Set(states.map((state) => state.shape)).size !== states.length) return null;
  return states.sort((left, right) => left.shape.localeCompare(right.shape));
}

/**
 * Per-token survivor filtering: which declared rules fit every shown transition.
 *
 * The family's whole correctness claim rests here. A draw is accepted only when
 * each strand has EXACTLY one surviving rule, so the solver is never asked to
 * choose between two readings the shown boards cannot separate. Returns the
 * canonical per-panel strand states alongside the survivors, since every later
 * step reads the same canonical order.
 */
function parallelEvolutionSurvivors(
  panels: readonly Scene[],
): { states: ParallelEvolutionState[][]; survivors: ParallelEvolutionRule[][] } | null {
  if (panels.length < 2) return null;
  const states: ParallelEvolutionState[][] = [];
  for (const panel of panels) {
    const reading = parallelEvolutionStates(panel);
    if (!reading) return null;
    states.push(reading);
  }
  const shapes = states[0].map((state) => state.shape).join("|");
  if (states.some((reading) => reading.map((state) => state.shape).join("|") !== shapes)) return null;
  const survivors = states[0].map((_, strand) =>
    PARALLEL_EVOLUTION_GRAMMAR.filter((rule) => states.every((reading, panelIndex) => {
      if (panelIndex === 0) return true;
      const advanced = advanceParallelEvolutionState(states[panelIndex - 1][strand], rule);
      return advanced.positionIndex === reading[strand].positionIndex &&
        advanced.fillIndex === reading[strand].fillIndex;
    })));
  return { states, survivors };
}

/** Every next board reachable by pairing one surviving rule with each strand. */
function parallelEvolutionPredictions(
  last: readonly ParallelEvolutionState[],
  survivors: readonly ParallelEvolutionRule[][],
): Scene[] {
  let combinations: ParallelEvolutionState[][] = [[]];
  for (const [strand, rules] of survivors.entries()) {
    combinations = combinations.flatMap((prefix) =>
      rules.map((rule) => [...prefix, advanceParallelEvolutionState(last[strand], rule)]));
  }
  return distinctOutputs(combinations.map(parallelEvolutionBoard));
}

/**
 * Start slots that keep the three tokens apart in every board of the row.
 *
 * Two tokens may cross paths, but they may never share a slot: a board holds
 * one visible primitive per position, and a strand that vanishes for a panel
 * cannot be read. All 336 ordered start triples are checked, so a rule triple
 * is only rejected when no arrangement of it works at all.
 */
function parallelEvolutionStartSlots(rules: readonly ParallelEvolutionRule[]): number[][] {
  const slots = RING_POSITIONS.map((_, index) => index);
  const valid: number[][] = [];
  for (const first of slots) {
    for (const second of slots) {
      if (second === first) continue;
      for (const third of slots) {
        if (third === first || third === second) continue;
        const start = [first, second, third];
        let clear = true;
        for (let panel = 1; panel < PARALLEL_EVOLUTION_PANELS && clear; panel++) {
          const positions = start.map((slot, strand) => {
            const raw = (slot + rules[strand].positionDelta * panel) % RING_POSITIONS.length;
            return (raw + RING_POSITIONS.length) % RING_POSITIONS.length;
          });
          clear = new Set(positions).size === positions.length;
        }
        if (clear) valid.push(start);
      }
    }
  }
  return valid;
}

/**
 * The rule triple one draw hides, always three DISTINCT rules.
 *
 * Distinctness is not decoration. Two boards of the row coincide only when
 * every strand's rule satisfies `k * positionDelta = 0 (mod 8)` and
 * `k * fillDelta = 0 (mod 3)` for the same gap `k` in 1..5, and each of those
 * five rule sets contains at most three rules, one of which is the identity
 * this family never draws. Three distinct non-identity rules therefore cannot
 * all sit in one of them, so no two of the six boards can ever look alike.
 */
function drawParallelEvolutionRules(rng: Rng, deeper: boolean): ParallelEvolutionRule[] {
  if (!deeper) {
    return shuffled(rng, PARALLEL_EVOLUTION_SINGLE_ASPECT_RULES).slice(0, PARALLEL_EVOLUTION_STRANDS);
  }
  // d4 has to SHOW the extra aspect rather than merely be allowed it: one
  // strand is drawn from the both-aspect rules first, so a d4 item is never a
  // d3 item wearing a deeper label.
  const both = pick(rng, PARALLEL_EVOLUTION_BOTH_ASPECT_RULES);
  const rest = shuffled(
    rng,
    PARALLEL_EVOLUTION_MOVING_RULES.filter((rule) =>
      parallelEvolutionRuleKey(rule) !== parallelEvolutionRuleKey(both)),
  ).slice(0, PARALLEL_EVOLUTION_STRANDS - 1);
  return shuffled(rng, [both, ...rest]);
}

/** Wrong boards: exactly one strand stepped by a wrong rule, the other two right. */
function parallelEvolutionWrongBoards(
  last: readonly ParallelEvolutionState[],
  rules: readonly ParallelEvolutionRule[],
): { scene: Scene; strand: number; rule: ParallelEvolutionRule }[] {
  const correct = last.map((state, strand) => advanceParallelEvolutionState(state, rules[strand]));
  return last.flatMap((state, strand) =>
    PARALLEL_EVOLUTION_GRAMMAR
      .filter((rule) => parallelEvolutionRuleKey(rule) !== parallelEvolutionRuleKey(rules[strand]))
      .flatMap((rule) => {
        const stepped = advanceParallelEvolutionState(state, rule);
        const next = correct.map((entry, index) => (index === strand ? stepped : entry));
        // A wrong step that lands on another token's slot is not a board, so it
        // cannot be offered as one.
        if (new Set(next.map((entry) => entry.positionIndex)).size !== next.length) return [];
        return [{ scene: parallelEvolutionBoard(next), strand, rule }];
      }));
}

function parallelEvolution(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const deeper = bucket.bucket === PARALLEL_EVOLUTION_D4_BUCKET;
  for (let attempt = 0; attempt < PARALLEL_EVOLUTION_DRAW_ATTEMPTS; attempt++) {
    const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const)
      .slice(0, PARALLEL_EVOLUTION_STRANDS);
    const rules = drawParallelEvolutionRules(rng, deeper);
    const startSlots = parallelEvolutionStartSlots(rules);
    if (startSlots.length === 0) continue;
    const start = pick(rng, startSlots);
    // Canonical strand order is by shape from here on, so the hidden rule triple
    // is reordered to match; otherwise the fingerprint would name a different
    // program from the one the boards show.
    const first = shapes
      .map((shape, strand) => ({
        shape,
        positionIndex: start[strand],
        fillIndex: pick(rng, [0, 1, 2]),
      }))
      .sort((left, right) => left.shape.localeCompare(right.shape));
    const orderedRules = first.map((state) => rules[shapes.indexOf(state.shape)]);

    const boards: ParallelEvolutionState[][] = [first];
    for (let panel = 1; panel < PARALLEL_EVOLUTION_PANELS; panel++) {
      boards.push(boards[panel - 1].map((state, strand) =>
        advanceParallelEvolutionState(state, orderedRules[strand])));
    }
    const shown = boards.slice(0, PARALLEL_EVOLUTION_PANELS - 1).map(parallelEvolutionBoard);
    const lastShown = boards[PARALLEL_EVOLUTION_PANELS - 2];
    const answer = parallelEvolutionBoard(boards[PARALLEL_EVOLUTION_PANELS - 1]);

    // The acceptance gate: every strand must already be pinned to one rule by
    // what the row shows, before anything is offered as an answer.
    const read = parallelEvolutionSurvivors(shown);
    if (!read || read.survivors.some((surviving) => surviving.length !== 1)) continue;

    const wrongBoards = parallelEvolutionWrongBoards(lastShown, orderedRules);
    // One required contrast per strand, each moving that token the wrong
    // distance around the ring while its fill stays right. Without them the
    // closest wrong boards are all fill-only, and a solver could reach the
    // answer without ever tracking a single token's movement.
    const required: Scene[] = [];
    for (const [strand, rule] of orderedRules.entries()) {
      const contrasts = wrongBoards.filter((entry) =>
        entry.strand === strand && entry.rule.positionDelta !== rule.positionDelta);
      const tightest = contrasts.filter((entry) => entry.rule.fillDelta === rule.fillDelta);
      const pool = tightest.length > 0 ? tightest : contrasts;
      if (pool.length === 0) break;
      required.push(pick(rng, pool).scene);
    }
    if (required.length !== orderedRules.length) continue;

    const distractors = selectDistractors(
      wrongBoards.map((entry) => entry.scene),
      rng,
      "parallel evolution",
      { answer, required },
    );
    const puzzle = makePuzzle(
      "prototype-parallel-evolution",
      "sequence",
      "row",
      "Each token follows its own rule. Which board comes next?",
      bucket.difficulty,
      [...shown, { blank: true }],
      answer,
      distractors,
      rng,
      "Read the eight outside slots as one ordered ring and follow each token separately. " +
        `${first.map((state, strand) =>
          `The ${state.shape} ${parallelEvolutionRuleDescription(orderedRules[strand])}`).join(". ")}. ` +
        "Each of those rules holds across all four shown transitions, so applying all three once more gives " +
        "the highlighted board. Every wrong option keeps two tokens right and steps the third by a rule that " +
        "fails a transition the row already shows.",
    );
    const family = definition(
      "parallel-evolution-v1",
      ["ordered-perimeter-slots", "per-token-step-rules", "fill-states"],
      // The fingerprint names the sorted rule TRIPLE, so it identifies the
      // program rather than which shape happened to carry which rule.
      JSON.stringify([...orderedRules].map(parallelEvolutionRuleKey).sort()),
      (candidate) => {
        const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
        const panels = candidate.stem.slice(0, -1).map(scenePanel);
        const visible = panels.filter((panel): panel is Scene => panel !== null);
        if (visible.length !== panels.length || visible.length !== PARALLEL_EVOLUTION_PANELS - 1) return empty;
        const solved = parallelEvolutionSurvivors(visible);
        if (!solved) return empty;
        const last = solved.states[solved.states.length - 1];
        const predictions = parallelEvolutionPredictions(last, solved.survivors);
        // Witnesses are only meaningful once every strand is pinned: with an
        // unpinned strand there is no "the other two are right" to compare to.
        const pinned = solved.survivors.every((surviving) => surviving.length === 1)
          ? solved.survivors.map((surviving) => surviving[0])
          : null;
        const wrong = pinned ? parallelEvolutionWrongBoards(last, pinned) : [];
        return {
          derivedAnswer: predictions.length === 1 ? predictions[0] : null,
          solutionCount: predictions.length,
          usedCueIds: ["ordered-perimeter-slots", "per-token-step-rules", "fill-states"],
          distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
            const match = wrong.find((entry) => sceneSignature(entry.scene) === sceneSignature(option));
            if (!match) return null;
            return `the ${last[match.strand].shape} ${parallelEvolutionRuleDescription(match.rule)} here, ` +
              "which fails a transition the row already shows";
          }),
        };
      },
    );
    // A single-strand row in the extrapolation sense: all five shown boards are
    // terms of the answered sequence, and the blank is the sixth at stride one.
    return asCandidate(family, puzzle, [0, 1, 2, 3, 4]);
  }
  throw new Error(
    `parallel evolution found no usable rule triple in ${PARALLEL_EVOLUTION_DRAW_ATTEMPTS} attempts`,
  );
}

/**
 * Build one candidate for a family at a NAMED difficulty bucket.
 *
 * The bucket is required and is checked before a single random number is drawn,
 * so an undeclared bucket costs nothing and reads as a rejected draw to the
 * assembler. Families with one declared bucket ignore it beyond that check:
 * their output for a given rng is exactly what it was before buckets existed.
 */
export function generateSceneFamilyCandidate(
  familyId: SceneFamilyId,
  rng: Rng,
  difficultyBucket: string,
): SceneFamilyCandidate {
  const bucket = requireSceneFamilyBucket(familyId, difficultyBucket);
  switch (familyId) {
    case "relational-sequence-v2": return relationalSequence(rng);
    case "attribute-pairing-v1": return attributePairing(rng);
    case "compositional-analogy-v2": return compositionalAnalogy(rng, bucket);
    case "composed-transform-v2": return composedTransform(rng, bucket);
    case "relational-matrix-v2": return relationalMatrix(rng);
    case "visual-set-algebra-v2": return setAlgebra(rng, { bucket });
    case "spatial-transform-v2": return spatialTransform(rng);
    case "transformation-machine-v3": return transformationMachine(rng, bucket);
    case "rule-switching-v2": return ruleSwitching(rng);
    case "second-order-sequence-v2": return secondOrderSequence(rng);
    case "inverse-analogy-v2": return inverseAnalogy(rng);
    case "parallel-evolution-v1": return parallelEvolution(rng, bucket);
    case "combining-machine-v1": return combiningMachine(rng, bucket);
  }
}

export function validateSceneFamilyCandidate(
  candidate: SceneFamilyCandidate,
  expectedReplayKey?: string,
): AcceptanceResult<Scene, string> {
  return acceptFamilyCandidate(candidate.definition, candidate.puzzle, { expectedReplayKey });
}

/**
 * Build one item for a RESERVED combination (raise-the-ceiling plan, Lever 2).
 * Evaluation harnesses only: the public assembler never calls this, and the
 * leakage test asserts the public pool cannot produce these programs.
 */
export function generateHeldOutComposedTransformCandidate(
  rng: Rng,
  gateCount: ComposedGateCount = 3,
  bucketId: string = COMPOSED_TRANSFORM_D5_BUCKET,
): SceneFamilyCandidate {
  const { heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
  if (heldOutPrograms.length === 0) {
    throw new Error(`no held-out composed-transform programs at ${gateCount} gates`);
  }
  const choices = composedProgramOrders(heldOutPrograms, bucketId);
  if (choices.length === 0) {
    throw new Error(`no held-out composed-transform programs support ${bucketId}`);
  }
  const choice = pick(rng, choices);
  return composedTransformForProgram(choice.program, rng, {
    bucketId,
    queryOrder: choice.queryOrder,
  });
}

/** Materialize the only currently supported LLM-proposed rule through pure code. */
export function generateProposedSetAlgebraCandidate(
  operation: SceneBinaryOperation,
  rng: Rng,
): SceneFamilyCandidate {
  return setAlgebra(rng, { forcedOperation: operation });
}
