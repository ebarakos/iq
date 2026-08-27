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
  applySceneComposedProgram,
  applySceneCompositionPrimitive,
  applySceneUnary,
  enumerateSceneConcepts,
  enumerateSceneOrderedFiveStepCompositions,
  enumerateSceneOrderedFourStepCompositions,
  enumerateSceneOrderedThreeStepCompositions,
  isSceneComposedProgram,
  sceneComposedPrimitives,
  sceneComposedProgramFromSteps,
  sceneComposedProgramKey,
  sceneComposedProgramSteps,
  sceneSatisfiesConcept,
  type SceneBinaryOperation,
  type SceneComposedProgram,
  type SceneComposedProgramLength,
  type SceneCompositionPrimitive,
  type SceneConcept,
  type ScenePosition,
  type SceneUnaryOperation,
} from "./scene-grammar";
import { rankByCloseness } from "./scene-distance";
import { topologyFailures, type TopologyGoal } from "./topology";

export const SCENE_FAMILY_IDS = [
  "relational-sequence-v2",
  "attribute-pairing-v1",
  "compositional-analogy-v2",
  "containment-analogy-v2",
  "composed-transform-v2",
  "relational-outlier-v2",
  "relational-outlier-v3",
  "relational-matrix-v2",
  "visual-set-algebra-v2",
  "constraint-mosaic-v2",
  "topology-path-v1",
  "spatial-transform-v2",
  "transformation-machine-v3",
  "rule-switching-v2",
  "concept-induction-v2",
  "fold-punch-v2",
  "inverse-fold-punch-v2",
  "interleaved-sequence-v3",
  "second-order-sequence-v2",
  "inverse-analogy-v2",
  "minimal-repair-v3",
  "parallel-evolution-v1",
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
   * family actually did. It is a floor, not an average: where a bucket's
   * grammar mixes program lengths — `fold-punch-d4` draws one- and two-crease
   * programs — the guaranteed number is declared, so a deeper bucket is a real,
   * checkable increase rather than a relabelling.
   */
  programDepth: number;
}

/**
 * Every bucket every family supports, easiest first.
 *
 * Withdrawn families keep a verifier-only bucket so the build sweep still
 * covers them; a bucket here is not a promise that anything is served, only
 * that the generator can produce it. What may be served is decided by
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
  // Containment change, then a move of the finished container.
  "containment-analogy-v2": [{ bucket: "containment-analogy-d4", difficulty: 4, programDepth: 2 }],
  // d4 shows three ordered gates, d5 four, and d6 five, each worked separately
  // in its own row and then applied left to right; the depth counts those
  // displayed gates — nothing else. Since 2026-08-25 every gate is provably
  // load-bearing: a program whose answer survives deleting any one gate is not
  // servable at any depth, so a five-gate item really costs five reading steps.
  "composed-transform-v2": [
    { bucket: "composed-transform-d4", difficulty: 4, programDepth: 3 },
    { bucket: "composed-transform-d5", difficulty: 5, programDepth: 3 },
    { bucket: "composed-transform-d6", difficulty: 6, programDepth: 5 },
  ],
  "relational-outlier-v2": [{ bucket: "relational-outlier-d2", difficulty: 2, programDepth: 1 }],
  "relational-outlier-v3": [{ bucket: "relational-outlier-v3-d2", difficulty: 2, programDepth: 1 }],
  // A row rule and a column rule, both needed for the missing corner.
  "relational-matrix-v2": [{ bucket: "relational-matrix-d4", difficulty: 4, programDepth: 2 }],
  // d4 combines the two boards and then transforms the combined result. d5 adds
  // a third visible step: every orientable token on that result turns in place.
  "visual-set-algebra-v2": [
    { bucket: "visual-set-algebra-d4", difficulty: 4, programDepth: 2 },
    { bucket: "visual-set-algebra-d5", difficulty: 5, programDepth: 3 },
  ],
  "constraint-mosaic-v2": [{ bucket: "constraint-mosaic-d4", difficulty: 4, programDepth: 1 }],
  "topology-path-v1": [{ bucket: "topology-path-d4", difficulty: 4, programDepth: 1 }],
  // One spatial transformation of the whole arrangement.
  "spatial-transform-v2": [{ bucket: "spatial-transform-d3", difficulty: 3, programDepth: 1 }],
  // Worked gates applied in the order the query path shows them: d5 shows
  // three, d6 four. The depth counts those displayed gates — nothing else.
  // Every gate is provably load-bearing: a program whose answer survives
  // deleting any one of them is not servable, so a four-gate item really costs
  // four reading steps.
  "transformation-machine-v3": [
    { bucket: "transformation-machine-d5", difficulty: 5, programDepth: 3 },
    { bucket: "transformation-machine-d6", difficulty: 6, programDepth: 4 },
  ],
  // Two gates are demonstrated, but the query selects exactly one to apply.
  "rule-switching-v2": [{ bucket: "rule-switching-d5", difficulty: 5, programDepth: 1 }],
  "concept-induction-v2": [{ bucket: "concept-induction-d5", difficulty: 5, programDepth: 1 }],
  // d4 draws the whole crease grammar, so only one unfold is guaranteed. d5
  // draws two-crease programs only: two unfolds, every time.
  "fold-punch-v2": [
    { bucket: "fold-punch-d4", difficulty: 4, programDepth: 1 },
    { bucket: "fold-punch-d5", difficulty: 5, programDepth: 2 },
  ],
  // Fold programs run backwards, so the depth counts the folds a solver has to
  // close to recover the missing input. d5 draws the whole mixed crease
  // grammar, so only one closed fold is guaranteed; d6 draws two-crease
  // programs only, so it is always two.
  //
  // Two is the deepest a crease program can go here, not a choice: a board is
  // at most 3x3 and `SceneSchema` allows at most two guides, and a second fold
  // on the same axis is a mirror about the same centre line, which either adds
  // no punch or leaves punches on both sides of the crease. So the plan's
  // "three creases" cannot be drawn at all — see the crease-ceiling test in
  // scene-families.test.ts, which proves the schema refuses a third guide.
  "inverse-fold-punch-v2": [
    { bucket: "inverse-fold-punch-d5", difficulty: 5, programDepth: 1 },
  ],
  "interleaved-sequence-v3": [{ bucket: "interleaved-sequence-d4", difficulty: 4, programDepth: 2 }],
  // A step rule plus the rule governing how that step grows.
  "second-order-sequence-v2": [{ bucket: "second-order-sequence-d4", difficulty: 4, programDepth: 2 }],
  // Two changes, run in reverse to recover the missing input.
  "inverse-analogy-v2": [{ bucket: "inverse-analogy-d4", difficulty: 4, programDepth: 2 }],
  "minimal-repair-v3": [{ bucket: "minimal-repair-d5", difficulty: 5, programDepth: 1 }],
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

interface ContainmentAnalogyProgram {
  containerShape: "circle" | "square" | "diamond" | "hexagon";
  movement: "right" | "down" | "diagonal";
}

const CONTAINMENT_ANALOGY_GRAMMAR: readonly ContainmentAnalogyProgram[] =
  (["circle", "square", "diamond", "hexagon"] as const).flatMap((containerShape) =>
    (["right", "down", "diagonal"] as const).map((movement) => ({ containerShape, movement })));

function applyContainmentAnalogy(input: Scene, program: ContainmentAnalogyProgram): Scene | null {
  const placement = singleTokenPlacement(input);
  if (!placement) return null;
  const contained = applySceneUnary(input, {
    kind: "contain",
    at: { row: placement.row, column: placement.column },
    containerShape: program.containerShape,
  });
  if (!contained) return null;
  const movement = program.movement === "right"
    ? { rowDelta: 0 as const, columnDelta: 1 as const }
    : program.movement === "down"
      ? { rowDelta: 1 as const, columnDelta: 0 as const }
      : { rowDelta: 1 as const, columnDelta: 1 as const };
  return applySceneUnary(contained, { kind: "translate", ...movement, wrap: false });
}

function containmentAnalogy(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, CONTAINMENT_ANALOGY_GRAMMAR);
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const input = one(firstShape, 0, 0);
  const output = applyContainmentAnalogy(input, program)!;
  const query = one(secondShape, 0, 0, "solid");
  const answer = applyContainmentAnalogy(query, program)!;
  const distractors = distinctOutputs(CONTAINMENT_ANALOGY_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applyContainmentAnalogy(query, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "containment analogy", { answer });
  const puzzle = makePuzzle(
    "prototype-containment-analogy",
    "analogy",
    "analogy",
    "Apply both demonstrated relationship changes.",
    4,
    [input, output, query],
    answer,
    selectedDistractors,
    rng,
    `The worked pair changes both relationship and position. First the loose token is placed inside a ${program.containerShape}; then the complete container moves ${program.movement === "right" ? "one slot right" : program.movement === "down" ? "one slot down" : "one slot down and right"}. Repeating both visible changes on the third board gives the highlighted option. Each distractor uses a different container or movement program that fails the worked pair.`,
  );
  const family = definition(
    "containment-analogy-v2",
    ["worked-containment-pair", "containment-and-movement", "board-slots"],
    JSON.stringify(program),
    (candidate) => {
      const [workedInput, workedOutput, queryInput] = candidate.stem.map(scenePanel);
      if (!workedInput || !workedOutput || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = CONTAINMENT_ANALOGY_GRAMMAR.filter((candidateProgram) => {
        const predicted = applyContainmentAnalogy(workedInput, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        applyContainmentAnalogy(queryInput, candidateProgram)));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["worked-containment-pair", "containment-and-movement", "board-slots"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedProgram = CONTAINMENT_ANALOGY_GRAMMAR.find((candidateProgram) => {
            const queryOutput = applyContainmentAnalogy(queryInput, candidateProgram);
            const worked = applyContainmentAnalogy(workedInput, candidateProgram);
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) &&
              (worked === null || sceneSignature(worked) !== sceneSignature(workedOutput));
          });
          return failedProgram ? "this containment or movement program fails the worked pair" : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * Size is deliberately absent as a relation. A scene token may only be medium or
 * large, and this project treats that difference as too small to read at answer
 * size — `isInstantlyDistinct` in domains.ts refuses to call two tokens distinct
 * on size alone. An item asking which pair differs in size would therefore be an
 * eyesight test, which is the one thing difficulty here may never come from.
 * Size is still held constant inside every option, so it cannot become the
 * discriminator by accident either.
 */
type OutlierRelationProgram =
  | { kind: "position"; relation: "same-row" | "same-column" | "adjacent" | "diagonal" | "opposite" }
  | { kind: "attribute"; attribute: "shape" | "fill"; relation: PairingRelation };

const OUTLIER_RELATION_GRAMMAR: readonly OutlierRelationProgram[] = [
  { kind: "position", relation: "same-row" },
  { kind: "position", relation: "same-column" },
  { kind: "position", relation: "adjacent" },
  { kind: "position", relation: "diagonal" },
  { kind: "position", relation: "opposite" },
  { kind: "attribute", attribute: "shape", relation: "same" },
  { kind: "attribute", attribute: "shape", relation: "different" },
  { kind: "attribute", attribute: "fill", relation: "same" },
  { kind: "attribute", attribute: "fill", relation: "different" },
] as const;

type PositionPair = readonly [
  { readonly row: number; readonly column: number },
  { readonly row: number; readonly column: number },
];

/** Every unordered pair of distinct board slots — the position vocabulary here. */
const OUTLIER_POSITION_PAIRS: readonly PositionPair[] = (() => {
  const slots = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
  return slots.flatMap((first, index) =>
    slots.slice(index + 1).map((second) => [first, second] as PositionPair));
})();

/** The two slots every attribute item uses, so only the attributes vary between options. */
const OUTLIER_ATTRIBUTE_POSITIONS: PositionPair = [{ row: 1, column: 0 }, { row: 1, column: 2 }];

/** The attributes an option may vary. Size is excluded on purpose — see above. */
const OUTLIER_ATTRIBUTES = ["shape", "fill"] as const;

function outlierScene(pair: PositionPair, first: SceneToken, second: SceneToken): Scene {
  return scene([
    { ...pair[0], object: first },
    { ...pair[1], object: second },
  ]);
}

/**
 * Every option this family may show for one relation, split into the ones that
 * keep it and the ones that break it.
 *
 * The construction is what makes the item well posed. For a position relation
 * both tokens in an option are identical, so every attribute relation holds
 * equally across the whole option list and none of them can single anything out.
 * For an attribute relation every option uses the same two slots, holds size
 * fixed, and shares the attribute the relation does not name, so only the named
 * attribute can.
 */
function outlierOptionUniverse(
  program: OutlierRelationProgram,
  shapes: readonly SceneToken["shape"][],
): { satisfying: Scene[]; breaking: Scene[] } {
  const all: Scene[] = [];
  if (program.kind === "position") {
    for (const pair of OUTLIER_POSITION_PAIRS) {
      for (const shape of shapes) all.push(outlierScene(pair, token(shape), token(shape)));
    }
  } else {
    for (const shape of shapes) {
      for (const otherShape of shapes) {
        for (const fill of RELATIONAL_FILLS) {
          for (const otherFill of RELATIONAL_FILLS) {
            const differs = { shape: shape !== otherShape, fill: fill !== otherFill };
            if (OUTLIER_ATTRIBUTES.some((attribute) =>
              attribute !== program.attribute && differs[attribute])) continue;
            all.push(outlierScene(
              OUTLIER_ATTRIBUTE_POSITIONS,
              token(shape, fill),
              token(otherShape, otherFill),
            ));
          }
        }
      }
    }
  }
  return {
    satisfying: all.filter((option) => sceneSatisfiesOutlierRelation(option, program)),
    breaking: all.filter((option) => !sceneSatisfiesOutlierRelation(option, program)),
  };
}

/**
 * Take options from the pool until `count` of them are held, skipping any that
 * a viewer could not tell apart from one already taken at a glance.
 */
function takeDistinctScenes(pool: readonly Scene[], count: number, held: readonly Scene[]): Scene[] {
  const chosen = [...held];
  for (const candidate of pool) {
    if (chosen.length >= count + held.length) break;
    if (chosen.every((other) => areScenesCategoricallyDistinct(candidate, other))) chosen.push(candidate);
  }
  return chosen.slice(held.length);
}

function outlierPair(value: Scene): readonly [
  Scene["objects"][number] & { object: SceneToken },
  Scene["objects"][number] & { object: SceneToken },
] | null {
  if (value.objects.length !== 2 || value.tiles.length > 0 ||
      value.objects[0].object.kind !== "token" || value.objects[1].object.kind !== "token") return null;
  return [
    { ...value.objects[0], object: value.objects[0].object },
    { ...value.objects[1], object: value.objects[1].object },
  ];
}

function sceneSatisfiesOutlierRelation(value: Scene, program: OutlierRelationProgram): boolean {
  const pair = outlierPair(value);
  if (!pair) return false;
  const [first, second] = pair;
  if (program.kind === "attribute") {
    const matches = first.object[program.attribute] === second.object[program.attribute];
    return matches === (program.relation === "same");
  }
  const rowDelta = Math.abs(first.row - second.row);
  const columnDelta = Math.abs(first.column - second.column);
  if (program.relation === "same-row") return rowDelta === 0;
  if (program.relation === "same-column") return columnDelta === 0;
  if (program.relation === "adjacent") return rowDelta + columnDelta === 1;
  if (program.relation === "diagonal") return rowDelta > 0 && rowDelta === columnDelta;
  return first.row + second.row === 2 && first.column + second.column === 2;
}

/** Draws tried per relation before this family moves on to the next relation. */
const OUTLIER_OPTION_ATTEMPTS = 40;

function relationalOutlier(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);

  /**
   * Draw one option list for a relation, or reject the draw.
   *
   * Rejected when any other relation in the grammar also singles out exactly one
   * option and it is not the same one: that is a second defensible answer, and
   * the item has to be thrown away rather than shipped ambiguous.
   */
  const draw = (program: OutlierRelationProgram): Scene[] | null => {
    const universe = outlierOptionUniverse(program, shapes);
    const breaker = shuffled(rng, universe.breaking)[0];
    if (!breaker) return null;
    const keepers = takeDistinctScenes(
      shuffled(rng, universe.satisfying),
      DISTRACTORS_PER_ITEM,
      [breaker],
    );
    if (keepers.length !== DISTRACTORS_PER_ITEM) return null;
    const options = [...keepers, breaker];
    const singledOut = OUTLIER_RELATION_GRAMMAR.flatMap((candidateProgram) => {
      const failures = options.flatMap((option, index) =>
        sceneSatisfiesOutlierRelation(option, candidateProgram) ? [] : [index]);
      return failures.length === 1 ? failures : [];
    });
    return singledOut.length > 0 && singledOut.every((index) => index === options.length - 1)
      ? options
      : null;
  };

  let program: OutlierRelationProgram | null = null;
  let options: Scene[] | null = null;
  for (const candidateProgram of shuffled(rng, OUTLIER_RELATION_GRAMMAR)) {
    for (let attempt = 0; attempt < OUTLIER_OPTION_ATTEMPTS && !options; attempt++) {
      options = draw(candidateProgram);
    }
    if (options) {
      program = candidateProgram;
      break;
    }
  }
  if (!options || !program) throw new Error("relational outlier found no well-posed option list");

  const breakerIndex = options.length - 1;
  const order = shuffled(rng, options.map((_, index) => index));
  const shuffledOptions = order.map((index) => options![index]);
  const answerIndex = order.indexOf(breakerIndex);
  const relationText = program.kind === "position"
    ? program.relation === "same-row" ? "sit in the same row"
      : program.relation === "same-column" ? "sit in the same column"
        : program.relation === "adjacent" ? "share a horizontal or vertical edge"
          : program.relation === "diagonal" ? "sit on one diagonal line"
            : "sit opposite each other across the board centre"
    : `have ${program.relation} ${program.attribute}`;
  const puzzle: Puzzle<Scene> = {
    id: "prototype-relational-outlier",
    type: "oddOneOut",
    layout: "row",
    instruction: "Which scene breaks the shared relationship?",
    difficulty: 2,
    stem: [],
    options: shuffledOptions,
    answerIndex,
    explanation: `Compare the relationship inside each two-token scene. In every option but one, the tokens ${relationText}; the clearly separated board positions, shapes, and fills provide the evidence. The highlighted option is the only one that breaks that shared relationship. Every other bounded relation in this family either agrees on the same outlier or does not isolate one option.`,
  };
  const family = definition(
    "relational-outlier-v2",
    ["two-token-scenes", "relative-token-relation"],
    JSON.stringify(program),
    (candidate) => {
      const matchingPrograms = OUTLIER_RELATION_GRAMMAR.filter((candidateProgram) => {
        const results = candidate.options.map((option) => sceneSatisfiesOutlierRelation(option, candidateProgram));
        return results.filter((result) => !result).length === 1;
      });
      const predicted = new Set(matchingPrograms.map((candidateProgram) =>
        candidate.options.findIndex((option) => !sceneSatisfiesOutlierRelation(option, candidateProgram)),
      ));
      return {
        derivedAnswer: predicted.size === 1 ? candidate.options[[...predicted][0]] : null,
        solutionCount: predicted.size,
        usedCueIds: ["two-token-scenes", "relative-token-relation"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const sharedProgram = matchingPrograms.find((candidateProgram) =>
            sceneSatisfiesOutlierRelation(option, candidateProgram));
          return sharedProgram ? `satisfies the shared relation ${JSON.stringify(sharedProgram)}` : null;
        }),
      };
    },
  );
  return asCandidate(family, puzzle);
}

/**
 * The sound odd-one-out (raise-the-ceiling plan, Lever 3). Its withdrawn
 * predecessor showed six options and nothing else, so there was no worked
 * evidence to infer the rule from. Here the stem DEMONSTRATES the shared
 * relation with three example boards that all satisfy it; the solver then
 * picks the one option that breaks what the examples showed. Well-posedness is
 * checked against the stem-consistent relations only: every relation the
 * examples still allow must either single out the same breaker or single out
 * nothing.
 */
function relationalOutlierDemonstrated(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);

  interface Draw {
    stemExamples: Scene[];
    options: Scene[];
    survivors: OutlierRelationProgram[];
  }

  const draw = (program: OutlierRelationProgram): Draw | null => {
    const universe = outlierOptionUniverse(program, shapes);
    const satisfying = shuffled(rng, universe.satisfying);
    const stemExamples = takeDistinctScenes(satisfying, 3, []);
    if (stemExamples.length !== 3) return null;
    const breaker = shuffled(rng, universe.breaking)[0];
    if (!breaker) return null;
    const keepers = takeDistinctScenes(satisfying, DISTRACTORS_PER_ITEM, [breaker, ...stemExamples]);
    if (keepers.length !== DISTRACTORS_PER_ITEM) return null;
    const options = [...keepers, breaker];
    const survivors = OUTLIER_RELATION_GRAMMAR.filter((candidateProgram) =>
      stemExamples.every((example) => sceneSatisfiesOutlierRelation(example, candidateProgram)));
    const singledOut = survivors.flatMap((candidateProgram) => {
      const failures = options.flatMap((option, index) =>
        sceneSatisfiesOutlierRelation(option, candidateProgram) ? [] : [index]);
      return failures.length === 1 ? failures : [];
    });
    return singledOut.length > 0 && singledOut.every((index) => index === options.length - 1)
      ? { stemExamples, options, survivors }
      : null;
  };

  let program: OutlierRelationProgram | null = null;
  let accepted: Draw | null = null;
  for (const candidateProgram of shuffled(rng, OUTLIER_RELATION_GRAMMAR)) {
    for (let attempt = 0; attempt < OUTLIER_OPTION_ATTEMPTS && !accepted; attempt++) {
      accepted = draw(candidateProgram);
    }
    if (accepted) {
      program = candidateProgram;
      break;
    }
  }
  if (!accepted || !program) throw new Error("demonstrated outlier found no well-posed draw");

  const breakerIndex = accepted.options.length - 1;
  const order = shuffled(rng, accepted.options.map((_, index) => index));
  const shuffledOptions = order.map((index) => accepted!.options[index]);
  const answerIndex = order.indexOf(breakerIndex);
  const relationText = program.kind === "position"
    ? program.relation === "same-row" ? "sit in the same row"
      : program.relation === "same-column" ? "sit in the same column"
        : program.relation === "adjacent" ? "share a horizontal or vertical edge"
          : program.relation === "diagonal" ? "sit on one diagonal line"
            : "sit opposite each other across the board centre"
    : `have ${program.relation} ${program.attribute}`;
  const puzzle: Puzzle<Scene> = {
    id: "prototype-relational-outlier-demonstrated",
    type: "oddOneOut",
    layout: "row",
    instruction: "The three example boards share one rule. Pick the option that breaks it.",
    difficulty: 2,
    stem: accepted.stemExamples,
    options: shuffledOptions,
    answerIndex,
    explanation: `In each of the three example boards, the tokens ${relationText} — that is the demonstrated rule. Five options keep it; the highlighted option is the only one that breaks it. Every other bounded relation the examples still allow either agrees on the same outlier or does not isolate one option.`,
  };
  const family = definition(
    "relational-outlier-v3",
    ["worked-example-boards", "two-token-scenes", "relative-token-relation"],
    JSON.stringify(program),
    (candidate) => {
      const stemScenes = candidate.stem.map(scenePanel);
      if (stemScenes.length !== 3 || stemScenes.some((panel) => !panel)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = OUTLIER_RELATION_GRAMMAR.filter((candidateProgram) =>
        stemScenes.every((example) => sceneSatisfiesOutlierRelation(example!, candidateProgram)));
      const matchingPrograms = survivors.filter((candidateProgram) => {
        const results = candidate.options.map((option) => sceneSatisfiesOutlierRelation(option, candidateProgram));
        return results.filter((result) => !result).length === 1;
      });
      const predicted = new Set(matchingPrograms.map((candidateProgram) =>
        candidate.options.findIndex((option) => !sceneSatisfiesOutlierRelation(option, candidateProgram)),
      ));
      return {
        derivedAnswer: predicted.size === 1 ? candidate.options[[...predicted][0]] : null,
        solutionCount: predicted.size,
        usedCueIds: ["worked-example-boards", "two-token-scenes", "relative-token-relation"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const sharedProgram = matchingPrograms.find((candidateProgram) =>
            sceneSatisfiesOutlierRelation(option, candidateProgram));
          return sharedProgram
            ? `keeps the demonstrated relation ${JSON.stringify(sharedProgram)}`
            : null;
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

/** Which of each corner's two tokens a board holds — one bit per corner. */
const RELATIONAL_MATRIX_VARIANTS: readonly number[] = Array.from({ length: 16 }, (_, index) => index);

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
  // Two tokens per corner, not one.
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
      (mask & (1 << index)) === 0 ? [] : [atomAt(index, (variants >> index) & 1)]));

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

    // Three kinds of near miss, each witnessed by a mistake a solver can
    // actually make: applying an operation that fails a worked row or column;
    // applying the right operation to the two boards in the wrong order (order
    // matters for subtract — for the commutative operations the swapped result
    // repeats the forward one and is deduplicated away); and copying one of the
    // two boards being combined instead of combining them.
    const distractors = distinctOutputs([
      ...SCENE_BINARY_GRAMMAR.flatMap((operation) => [
        applySceneBinary(bottomLeft, bottomMiddle, operation),
        applySceneBinary(topRight, middleRight, operation),
        applySceneBinary(bottomMiddle, bottomLeft, operation),
        applySceneBinary(middleRight, topRight, operation),
      ]),
      bottomLeft, bottomMiddle, topRight, middleRight,
    ]).filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
    if (distractors.length < DISTRACTORS_PER_ITEM) return null;

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
          const copied = [colA, colB, rowA, rowB].some((board) =>
            sceneSignature(board) === sceneSignature(option));
          return copied ? "copies one of the two boards instead of combining them" : null;
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
  const rows = (() => {
    let last: SetAlgebraRows | null = null;
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
      if (predicted.length === 1) return draw;
    }
    // Every attempt was ambiguous, which the measured rate says should not
    // happen. Hand back the last draw rather than throwing: acceptance rejects
    // it and the assembler retries the slot on a fresh seed, which is the
    // failure path every other family already uses.
    return last;
  })();
  if (rows === null) throw new Error("set algebra could not build a single valid row draw");
  const { leftA, rightA, outputA, leftB, rightB, outputB, queryLeft, queryRight, answer } = rows;
  const distractors = distinctOutputs(grammar
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram) => applySetAlgebraProgram(queryLeft, queryRight, candidateProgram)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
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

type MosaicProjection = "shape" | "fill";
type MosaicPattern = "rows" | "columns" | "diagonals" | "all-same";

interface MosaicProgram {
  projection: MosaicProjection;
  pattern: MosaicPattern;
}

const MOSAIC_GRAMMAR: readonly MosaicProgram[] = (["shape", "fill"] as const).flatMap((projection) =>
  (["rows", "columns", "diagonals", "all-same"] as const).map((pattern) => ({ projection, pattern })));

function mosaicGroups(pattern: MosaicPattern): readonly [number, number, number, number] {
  if (pattern === "rows") return [0, 0, 1, 1];
  if (pattern === "columns") return [0, 1, 0, 1];
  if (pattern === "diagonals") return [0, 1, 1, 0];
  return [0, 0, 0, 0];
}

function mosaicValues(value: Scene, projection: MosaicProjection): string[] | null {
  const byPosition = new Map(value.objects.map((placement) => [
    `${placement.row}:${placement.column}`,
    placement.object.kind === "token" ? placement.object[projection] : null,
  ]));
  const values = ["0:0", "0:1", "1:0", "1:1"].map((position) => byPosition.get(position));
  return values.some((entry) => typeof entry !== "string") ? null : values as string[];
}

function valuesMatchGroups(values: readonly string[], groups: readonly number[]): boolean {
  return values.every((value, left) => values.every((other, right) =>
    (value === other) === (groups[left] === groups[right])));
}

function mosaicVisibleFits(template: Scene, program: MosaicProgram): boolean {
  const byPosition = new Map(template.objects.map((placement) => [
    `${placement.row}:${placement.column}`,
    placement.object.kind === "token" ? placement.object[program.projection] : null,
  ]));
  const visibleValues = ["0:0", "0:1", "1:0"].map((position) => byPosition.get(position));
  if (visibleValues.some((value) => typeof value !== "string")) return false;
  const visibleGroups = mosaicGroups(program.pattern).slice(0, 3);
  return valuesMatchGroups(visibleValues as string[], visibleGroups);
}

function mosaicCompletedFits(value: Scene, program: MosaicProgram): boolean {
  const values = mosaicValues(value, program.projection);
  return values !== null && valuesMatchGroups(values, mosaicGroups(program.pattern));
}

function constraintMosaic(rng: Rng): SceneFamilyCandidate {
  const program = pick(rng, MOSAIC_GRAMMAR);
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const fills = shuffled(rng, RELATIONAL_FILLS);
  const groups = mosaicGroups(program.pattern);
  const shapeAt = (index: number): SceneToken["shape"] => program.projection === "shape"
    ? shapes[groups[index]]
    : shapes[index];
  const fillAt = (index: number): SceneToken["fill"] => program.projection === "fill"
    ? fills[groups[index]]
    : fills[index % 3];
  const placements = [
    { row: 0, column: 0, object: token(shapeAt(0), fillAt(0)) },
    { row: 0, column: 1, object: token(shapeAt(1), fillAt(1)) },
    { row: 1, column: 0, object: token(shapeAt(2), fillAt(2)) },
  ];
  const board = scene(placements, 2, 2);
  const answerToken = token(shapeAt(3), fillAt(3));
  const inserted = (object: SceneToken) => scene([
    ...placements,
    { row: 1, column: 1, object },
  ], 2, 2);
  const answerBoard = inserted(answerToken);
  // A wrong tile is any token that visibly breaks the grouping — under every
  // grouping the three shown tiles still allow, not just the sampled one, since
  // the solver can only rule out what the visible board rules out.
  const survivingPrograms = MOSAIC_GRAMMAR.filter((candidateProgram) =>
    mosaicVisibleFits(board, candidateProgram));
  const wrongBoards = shapes.flatMap((shape) => fills.map((fill) => inserted(token(shape, fill))))
    .filter((option) => survivingPrograms.every((candidateProgram) =>
      !mosaicCompletedFits(option, candidateProgram)));
  const nearMisses = takeDistinctScenes(shuffled(rng, wrongBoards), DISTRACTORS_PER_ITEM, [answerBoard]);
  if (!mosaicCompletedFits(answerBoard, program) || nearMisses.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(`constraint mosaic needs one completion and ${DISTRACTORS_PER_ITEM} near misses`);
  }
  const options = [answerBoard, ...nearMisses];
  const order = shuffled(rng, options.map((_, index) => index));
  const shuffledOptions = order.map((index) => options[index]);
  const answerIndex = order.indexOf(0);
  const patternText = program.pattern === "rows" ? "each row repeats one value"
    : program.pattern === "columns" ? "each column repeats one value"
      : program.pattern === "diagonals" ? "matching values sit on opposite diagonals"
        : "all four cells repeat one value";
  const puzzle: Puzzle<Scene> = {
    id: "prototype-constraint-mosaic",
    type: "matrix",
    layout: "singleScene",
    instruction: "Which completed board continues the visible grouping?",
    difficulty: 4,
    stem: [board],
    options: shuffledOptions,
    answerIndex,
    explanation: `Treat the four cells as one 2×2 board and compare their ${program.projection}. The three shown cells establish that ${patternText}, so the lower-right value is fixed by the same grouping. The highlighted completion preserves every shown cell and supplies that value. Each distractor changes only the missing tile but breaks at least one visible equality or difference in the grouping.`,
  };
  const family = definition(
    "constraint-mosaic-v2",
    ["upper-left-mosaic", "categorical-grouping", "missing-lower-right-tile"],
    JSON.stringify(program),
    (candidate) => {
      const template = scenePanel(candidate.stem[0]);
      if (!template) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const survivors = MOSAIC_GRAMMAR.filter((candidateProgram) => mosaicVisibleFits(template, candidateProgram));
      const evaluated = candidate.options.map((option) => {
        const fixed = new Map(template.objects.map((placement) => [
          `${placement.row}:${placement.column}`,
          JSON.stringify(placement.object),
        ]));
        const preservesTemplate = option.rows === template.rows && option.columns === template.columns &&
          option.objects.length === template.objects.length + 1 &&
          [...fixed].every(([position, object]) => option.objects.some((placement) =>
            `${placement.row}:${placement.column}` === position && JSON.stringify(placement.object) === object));
        const insertedAtTarget = option.objects.some((placement) => placement.row === 1 && placement.column === 1) &&
          !fixed.has("1:1");
        const matchingPrograms = survivors.filter((candidateProgram) => mosaicCompletedFits(option, candidateProgram));
        const failures = !preservesTemplate || !insertedAtTarget
          ? ["does not fill only the missing lower-right tile"]
          : matchingPrograms.length === 0
            ? ["breaks the grouping shown by the three fixed tiles"]
            : [];
        return { option, failures, matchingPrograms };
      });
      const selections = survivors.map((candidateProgram) => evaluated.flatMap((entry, optionIndex) =>
        entry.failures.length === 0 && entry.matchingPrograms.includes(candidateProgram) ? [optionIndex] : []));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["upper-left-mosaic", "categorical-grouping", "missing-lower-right-tile"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || !evaluated[optionIndex]?.failures[0]
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].failures[0] }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function topologyPath(rng: Rng): SceneFamilyCandidate {
  const fixedTiles: Scene["tiles"] = [
    { row: 0, column: 0, edges: ["east", "south"] },
    { row: 0, column: 1, edges: ["south", "west"] },
    { row: 1, column: 0, edges: ["north", "east"] },
  ];
  const baseIncomplete: Scene = { kind: "scene", rows: 2, columns: 2, objects: [], tiles: fixedTiles };
  // Every way two edges of the missing tile can be joined. Exactly one of them
  // meets both exposed ends; the rest leave an open end or a mismatched seam.
  const optionEdges: Scene["tiles"][number]["edges"][] = [
    ["north", "east"],
    ["north", "south"],
    ["north", "west"],
    ["east", "south"],
    ["east", "west"],
    ["south", "west"],
  ];
  const baseOptions = optionEdges.map((edges): Scene => ({
    kind: "scene",
    rows: 2,
    columns: 2,
    objects: [],
    tiles: [...fixedTiles, { row: 1, column: 1, edges }],
  }));
  const quarterTurns = pick(rng, [0, 1, 2, 3] as const);
  const rotateScene = (candidate: Scene) => quarterTurns === 0
    ? candidate
    : applySceneUnary(candidate, { kind: "rotate", quarterTurns })!;
  const incomplete = rotateScene(baseIncomplete);
  const options = baseOptions.map(rotateScene);
  const goal: TopologyGoal = "singleLoop";
  const valid = options.map((candidate) => topologyFailures(candidate, goal).length === 0);
  const validIndexes = valid.flatMap((isValid, index) => isValid ? [index] : []);
  const canonicalAnswer = validIndexes[0] ?? 0;
  const order = shuffled(rng, options.map((_, index) => index));
  const puzzle: Puzzle<Scene> = {
    id: "prototype-topology-path",
    type: "matrix",
    layout: "singleScene",
    instruction: "Which completed board makes one closed loop?",
    difficulty: 4,
    stem: [incomplete],
    options: order.map((index) => options[index]),
    answerIndex: order.indexOf(canonicalAnswer),
    explanation: "Follow each line through the completed 2×2 board. At every shared edge, a line must meet a line on the neighbouring tile; no line may stop at a seam or leave the outside boundary. The highlighted completion connects the two exposed ends and makes one closed loop. Each other tile leaves an open end, creates a mismatch, or fails to form a single loop.",
  };
  const family = definition(
    "topology-path-v1",
    ["edge-connections", "loop-goal"],
    goal,
    (candidate) => {
      const template = scenePanel(candidate.stem[0]);
      if (!template) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const fixed = new Map(template.tiles.map((tile) => [
        `${tile.row}:${tile.column}`,
        tile.edges.join(","),
      ]));
      const missingPositions = Array.from({ length: template.rows * template.columns }, (_, index) => ({
        row: Math.floor(index / template.columns),
        column: index % template.columns,
      })).filter((position) => !fixed.has(`${position.row}:${position.column}`));
      const evaluated = candidate.options.map((option) => {
        const preservesTemplate = option.rows === template.rows && option.columns === template.columns &&
          option.tiles.length === template.tiles.length + 1 &&
          [...fixed].every(([position, edges]) => option.tiles.some((tile) =>
            `${tile.row}:${tile.column}` === position && tile.edges.join(",") === edges));
        const target = missingPositions[0];
        const fillsTarget = missingPositions.length === 1 && target &&
          option.tiles.some((tile) => tile.row === target.row && tile.column === target.column);
        const failures = topologyFailures(option, goal).map((failure) => failure.message);
        if (!preservesTemplate || !fillsTarget) failures.unshift("changes a fixed tile instead of filling the one empty slot");
        return { option, failures };
      });
      const validOptions = evaluated.filter((entry) => entry.failures.length === 0);
      return {
        derivedAnswer: validOptions.length === 1 ? validOptions[0].option : null,
        solutionCount: validOptions.length,
        usedCueIds: ["edge-connections", "loop-goal"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || !evaluated[optionIndex]?.failures[0]
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].failures[0] }]),
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
  const distractors = [...new Map(SPATIAL_TRANSFORM_GRAMMAR
    .map((candidateOperation) => applySceneUnary(query, candidateOperation))
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
    3,
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
          return failedRule ? `${failedRule.kind} does not reproduce the worked spatial pair` : null;
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

/** Gate labels, in the order the query strip shows them. */
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
  ]).filter((output) => sceneSignature(output) !== sceneSignature(answer));
  const nearMisses = selectDistractors(nearMissPool, rng, "rule switching", { answer });
  const puzzle = makePuzzle(
    "prototype-rule-switching",
    "matrix",
    "machineTable",
    "Each gate has a demonstrated rule. Apply only the gate shown in the query path.",
    5,
    [
      inputA, gateVisual("a"), outputA,
      inputB, gateVisual("b"), outputB,
      query, gateVisual(program.queryGate), { blank: true },
    ],
    answer,
    nearMisses,
    rng,
    `The worked rows define two separate gates. Gate A ${ruleSwitchOperationDescription(program.gateA)}, while gate B ${ruleSwitchOperationDescription(program.gateB)}. The query displays only gate ${program.queryGate.toUpperCase()}, so applying that demonstrated operation gives the highlighted board. The distractors omit the selected gate, use the other gate, combine both gates, or follow another bounded operation that fails the selected gate's worked row.`,
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

/**
 * How many gates a composed-transform item shows. Three is the `-d4` bucket,
 * four the `-d5` bucket, five the `-d6` bucket; the number is also the
 * program's honest depth.
 */
export type ComposedGateCount = SceneComposedProgramLength;

const COMPOSED_TRANSFORM_D4_BUCKET = "composed-transform-d4";
const COMPOSED_TRANSFORM_D5_BUCKET = "composed-transform-d5";
const COMPOSED_TRANSFORM_D6_BUCKET = "composed-transform-d6";

/**
 * The displayed gate count each named bucket draws at.
 *
 * `composed-transform-d5` used to draw FOUR gates. On 2026-08-27 the owner
 * ruled that no item may ever display more than three — a fourth gate is more
 * procedure, not more reasoning — so d5 is now three gates too, and earns its
 * extra difficulty by running them BACKWARDS instead. See
 * `COMPOSED_TRANSFORM_REVERSED_BUCKETS`.
 */
const COMPOSED_TRANSFORM_BUCKET_GATES: Readonly<Record<string, ComposedGateCount>> = {
  [COMPOSED_TRANSFORM_D4_BUCKET]: 3,
  [COMPOSED_TRANSFORM_D5_BUCKET]: 3,
  [COMPOSED_TRANSFORM_D6_BUCKET]: 5,
};

/**
 * Buckets whose query gates are applied right to left.
 *
 * Reversal is only a fair question if the item SHOWS which direction it uses,
 * and per-gate worked rows cannot: a row demonstrating one gate alone says
 * nothing about order. So a reversed item carries one extra worked row — a
 * two-gate strip and the board it produces — and the solver reads the direction
 * off that before applying the query's three gates the same way. The two gates
 * in that row are always chosen so the two possible orders disagree; otherwise
 * the row would be evidence of nothing.
 *
 * This is the shape the owner asked for on 2026-08-27: "try to reverse the
 * gates, not only same sequence", under a hard cap of three gates.
 */
const COMPOSED_TRANSFORM_REVERSED_BUCKETS: ReadonlySet<string> = new Set([COMPOSED_TRANSFORM_D5_BUCKET]);

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
  const grammar: readonly SceneComposedProgram[] = gateCount === 3
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

/** Every ordering of `gateCount` gates, lexicographic, including the displayed one. */
function composedGateOrders(gateCount: number): number[][] {
  if (gateCount === 0) return [[]];
  const orders: number[][] = [];
  for (const head of composedGateIndexes(gateCount)) {
    for (const rest of composedGateOrders(gateCount - 1)) {
      orders.push([head, ...rest.map((index) => (index >= head ? index + 1 : index))]);
    }
  }
  return orders;
}

/** The orderings that are not the demonstrated left-to-right one. */
function composedWrongGateOrders(gateCount: number, runOrder?: readonly number[]): number[][] {
  // "Wrong" is relative to the order the item RUNS, not to the order it
  // displays. Those were the same thing until reversed buckets arrived on
  // 2026-08-27; passing the run order keeps the correct board out of the near
  // miss pool and puts the other direction into it, which is where a solver who
  // misread the direction would land.
  const correct = (runOrder ?? composedGateIndexes(gateCount)).join(",");
  return composedGateOrders(gateCount).filter((order) => order.join(",") !== correct);
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
  for (let mask = 1; mask < (1 << gateCount) - 1; mask++) {
    const kept = all.filter((index) => ((mask >> index) & 1) === 1);
    omissions.push({ kept, skipped: all.filter((index) => !kept.includes(index)) });
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
  return [
    ...composedWrongGateOrders(gateCount, runOrder).map((order) => ({
      output: runComposedGates(query, steps, order, apply),
      reason: `applies the ${COMPOSED_GATE_COUNT_WORDS[gateCount as ComposedGateCount]} demonstrated gates in a wrong order`,
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
  for (const index of composedGateIndexes(steps.length)) {
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
    .filter((program) => composedProgramIsServable(program, apply));
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
  return { ...COMPOSED_TRANSFORM_BUCKET_GATES, ...TRANSFORMATION_MACHINE_BUCKET_GATES };
}

function composedTransform(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const gateCount = COMPOSED_TRANSFORM_BUCKET_GATES[bucket.bucket] ?? 3;
  return composedTransformForProgram(
    pick(rng, partitionComposedTransformPrograms(gateCount).publicPrograms),
    rng,
    { bucketId: bucket.bucket, reversed: COMPOSED_TRANSFORM_REVERSED_BUCKETS.has(bucket.bucket) },
  );
}

/**
 * The worked row that reveals which direction a reversed item runs its gates.
 *
 * It shows two of the displayed gates as a strip and the board they produce
 * when applied right to left, the same way the query will be. The pair is only
 * usable if the two possible orders give DIFFERENT boards — a commuting pair
 * would leave the direction exactly as unknowable as the single-gate rows do.
 * The first usable pair in displayed order is taken, so the choice is
 * deterministic and replays with the seed.
 */
function composedOrderRow(
  steps: readonly SceneCompositionPrimitive[],
  displayed: readonly number[],
  shapes: readonly SceneToken["shape"][],
): { input: Scene; output: Scene; gates: number[] } | null {
  for (let first = 0; first < displayed.length; first++) {
    for (let second = first + 1; second < displayed.length; second++) {
      const pair = [displayed[first], displayed[second]];
      // A board distinct from both the per-gate worked inputs and the query,
      // so the row adds evidence rather than repeating a board already shown.
      const input = composedTransformQuery([...shapes].reverse());
      const rightToLeft = runComposedGates(input, steps, [...pair].reverse(), applySceneCompositionPrimitive);
      const leftToRight = runComposedGates(input, steps, pair, applySceneCompositionPrimitive);
      if (!rightToLeft || !leftToRight) continue;
      if (sceneSignature(rightToLeft) === sceneSignature(leftToRight)) continue;
      return { input, output: rightToLeft, gates: pair };
    }
  }
  return null;
}

function composedTransformForProgram(
  program: SceneComposedProgram,
  rng: Rng,
  options: { bucketId?: string; reversed?: boolean } = {},
): SceneFamilyCandidate {
  const steps = sceneComposedProgramSteps(program);
  const gateCount = steps.length as ComposedGateCount;
  const displayed = composedGateIndexes(gateCount);
  const gateIds = displayed.map((index) => COMPOSED_GATE_IDS[index]);
  const reversed = options.reversed ?? false;
  // The order the query gates actually run in. Displayed order is always left
  // to right; a reversed bucket applies them right to left, and the extra
  // worked row below is what tells the solver which of the two it is.
  const runOrder = reversed ? [...displayed].reverse() : displayed;
  const bucket = requireSceneFamilyBucket(
    "composed-transform-v2",
    options.bucketId ?? (gateCount === 5
      ? COMPOSED_TRANSFORM_D6_BUCKET
      : COMPOSED_TRANSFORM_D4_BUCKET),
  );
  const shapes = shuffled(rng, CANONICAL_COMPOSED_SHAPES);
  const worked = steps.map((step, index) => {
    const input = composedWorkedInput(step, shapes, index * 2);
    const output = applySceneCompositionPrimitive(input, step);
    if (!output) throw new Error("composed transform needs a worked row for every displayed gate");
    return { input, output };
  });
  const query = composedTransformQuery(shapes);
  const answer = runComposedGates(query, steps, runOrder, applySceneCompositionPrimitive);
  const otherDirection = runComposedGates(
    query, steps, [...runOrder].reverse(), applySceneCompositionPrimitive);
  if (!answer || !otherDirection || sceneSignature(otherDirection) === sceneSignature(answer)) {
    throw new Error(`composed transform needs a servable ${gateCount}-step program`);
  }
  // The order row: two of the displayed gates and the board they produce when
  // run in this item's direction. Its pair is chosen so the two orders
  // disagree — a pair that commutes would prove nothing about direction.
  const orderRow = reversed ? composedOrderRow(steps, displayed, shapes) : null;
  if (reversed && !orderRow) {
    throw new Error("a reversed composed transform needs a gate pair whose two orders disagree");
  }
  const nearMissPool = distinctOutputs(
    composedWrongExecutions(query, steps, applySceneCompositionPrimitive, runOrder)
      .map((execution) => execution.output))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  // Keep the other-direction board: it is the near miss that proves order
  // matters, and in a reversed item it is exactly what a solver who ignored the
  // order row and ran the strip left to right would choose.
  const composedDistractors = selectDistractors(nearMissPool, rng, "composed transform", { answer, required: [otherDirection] });
  const gateWord = COMPOSED_GATE_COUNT_WORDS[gateCount];
  const cueIds = [
    ...gateIds.map((gateId) => `worked-gate-${gateId}`),
    "left-to-right-order",
    ...(steps.some((step) => step.kind === "setFillAt") ? ["targeted-fill-slot"] : []),
    ...(steps.some((step) => step.kind === "turn") ? ["token-orientation"] : []),
  ];
  const puzzle = makePuzzle(
    "prototype-composed-transform",
    "matrix",
    "machineTable",
    reversed
      ? `Infer each worked gate, then work out from the two-gate row which way a strip runs before applying the ${gateWord} query gates.`
      : `Infer each worked gate, then apply the ${gateWord} query gates from left to right.`,
    bucket.difficulty,
    [
      ...worked.flatMap((row, index) => [row.input, gateVisual(gateIds[index]), row.output]),
      ...(orderRow
        ? [orderRow.input, gateVisual(...orderRow.gates.map((index) => gateIds[index])), orderRow.output]
        : []),
      query,
      gateVisual(...gateIds),
      { blank: true },
    ],
    answer,
    composedDistractors,
    rng,
    `The ${gateWord} worked rows expose the primitives separately. ${steps
      .map((step, index) => `Gate ${COMPOSED_GATE_LETTERS[index]} ${compositionPrimitiveDescription(step)}`)
      .join("; ")}. ${orderRow
      ? `The extra worked row shows ${composedGateList(orderRow.gates)} together, and its board is what those two produce applied RIGHT TO LEFT — left to right would give a different board, which is how the direction is known rather than guessed. The query strip shows ${composedGateList(displayed)}, so its effects run right to left too, to obtain the highlighted board.`
      : `The query strip shows ${composedGateList(displayed)} in that order, so the ${gateWord} effects must be applied left to right to obtain the highlighted board.`} Every displayed gate is needed: dropping any one of them changes the result. The distractors run the gates in another order, skip one, or replace a step with another bounded primitive that fails its worked row.`,
  );
  const family = definition(
    "composed-transform-v2",
    cueIds,
    sceneComposedProgramKey(program),
    (candidate) => {
      const empty = { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const orderRowPanels = orderRow ? 3 : 0;
      if (candidate.stem.length !== gateCount * 3 + orderRowPanels + 3) return empty;
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
      // The order row, read back off the board rather than trusted: its strip
      // names two of the displayed gates, and its output is what those two make
      // in one of the two possible orders. Which one is the direction evidence.
      let orderEvidence: { input: Scene; output: Scene; gates: number[] } | null = null;
      if (orderRow) {
        const input = panels[gateCount * 3];
        const strip = panels[gateCount * 3 + 1];
        const output = panels[gateCount * 3 + 2];
        if (!input || !strip || !output) return empty;
        const named = [...strip.objects]
          .sort((left, right) => left.column - right.column)
          .map((placement) => workedRows.findIndex((row) => row.gateKey === JSON.stringify(placement.object)));
        if (named.length !== 2 || named.some((index) => index < 0)) return empty;
        orderEvidence = { input, output, gates: named };
      }
      const queryInput = panels[gateCount * 3 + orderRowPanels];
      const queryGates = panels[gateCount * 3 + orderRowPanels + 1];
      if (!queryInput || !queryGates) return empty;

      // The query strip must show exactly the worked gates, once each, left to
      // right: three glyphs across the middle row of an ordinary board, or four
      // to five across the single row of the wide gate strip.
      const wideStrip = gateCount >= GATE_STRIP_COLUMNS;
      const orderedQueryGates = [...queryGates.objects].sort((left, right) => left.column - right.column);
      const stripRow = wideStrip ? 0 : 1;
      const stripValid = queryGates.tiles.length === 0 &&
        queryGates.rows === (wideStrip ? GATE_STRIP_ROWS : 3) &&
        queryGates.columns === (wideStrip ? gateCount : 3) &&
        orderedQueryGates.length === gateCount &&
        orderedQueryGates.every((placement, index) => placement.row === stripRow && placement.column === index) &&
        orderedQueryGates.every((placement, index) =>
          JSON.stringify(placement.object) === workedRows[index].gateKey);
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

      // A survivor predicts the query only through a direction the shown
      // evidence actually pins. Without an order row the convention is left to
      // right, as the instruction says. With one, the survivor must reproduce
      // that row in exactly one of the two orders, and the query then runs the
      // same way; a survivor whose pair commutes there proves no direction and
      // predicts nothing.
      const predictFor = (candidateProgram: SceneComposedProgram): Scene | null => {
        const candidateSteps = sceneComposedProgramSteps(candidateProgram);
        if (!orderEvidence) return applySceneComposedProgram(queryInput, candidateProgram);
        const forwardPair = orderEvidence.gates;
        const backwardPair = [...forwardPair].reverse();
        const asShown = runComposedGates(orderEvidence.input, candidateSteps, forwardPair, applySceneCompositionPrimitive);
        const asReversed = runComposedGates(orderEvidence.input, candidateSteps, backwardPair, applySceneCompositionPrimitive);
        const target = sceneSignature(orderEvidence.output);
        const fitsShown = asShown !== null && sceneSignature(asShown) === target;
        const fitsReversed = asReversed !== null && sceneSignature(asReversed) === target;
        if (fitsShown === fitsReversed) return null;
        const order = fitsReversed ? [...displayed].reverse() : displayed;
        return runComposedGates(queryInput, candidateSteps, order, applySceneCompositionPrimitive);
      };
      const predictions = distinctOutputs(survivors.map(predictFor));
      const wrongExecutions = survivors.flatMap((survivor) =>
        composedWrongExecutions(
          queryInput, sceneComposedProgramSteps(survivor), applySceneCompositionPrimitive, runOrder));
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

function contained(shape: SceneToken["shape"], inner: SceneToken["shape"], row: number, column: number): Scene {
  return scene([{
    row,
    column,
    object: {
      kind: "container",
      // Pointy shapes (now including the scene-only arrow) are never container outlines.
      shape: shape === "triangle" || shape === "star" || shape === "arrow" ? "circle" : shape,
      contents: [token(inner)],
    },
  }]);
}

/**
 * Simple boards this family can offer as extra wrong options: one token in each
 * slot, and two tokens in a spread of arrangements and attribute combinations.
 * Nothing here is wrong by construction — `conceptCandidate` keeps only the
 * boards that fail every concept the shown examples still allow.
 */
function conceptNearMissPool(shapes: readonly SceneToken["shape"][]): Scene[] {
  const slots = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
  const singles = slots.flatMap((slot, index) =>
    RELATIONAL_FILLS.map((fill) => scene([{ ...slot, object: token(shapes[index % shapes.length], fill) }])));
  const pairs = slots.flatMap((first, firstIndex) => slots.slice(firstIndex + 1).flatMap((second) =>
    shapes.flatMap((shape, shapeIndex) => [
      scene([
        { ...first, object: token(shape) },
        { ...second, object: token(shapes[(shapeIndex + 1) % shapes.length], "solid") },
      ]),
      scene([
        { ...first, object: token(shape) },
        { ...second, object: token(shape, "solid") },
      ]),
    ])));
  return [...singles, ...pairs];
}

function conceptCandidate(
  rng: Rng,
  shapes: readonly SceneToken["shape"][],
  ruleKey: string,
  relationCue: string,
  positives: readonly Scene[],
  negatives: readonly Scene[],
  answer: Scene,
  authoredDistractors: readonly Scene[],
  explanation: string,
): SceneFamilyCandidate {
  // A wrong option has to fail every concept still consistent with the shown
  // examples — exactly the test the validator applies — or the item would have a
  // second defensible answer. The hand-written near misses come first because
  // they are the ones chosen to look tempting; the pool only tops up the rest.
  const survivors = enumerateSceneConcepts().filter((concept) =>
    positives.every((example) => sceneSatisfiesConcept(example, concept)) &&
    negatives.every((example) => !sceneSatisfiesConcept(example, concept)));
  const failsEverySurvivor = (option: Scene) =>
    survivors.length > 0 && survivors.every((concept) => !sceneSatisfiesConcept(option, concept));
  const distractors = takeDistinctScenes(
    [
      ...authoredDistractors.filter(failsEverySurvivor),
      ...shuffled(rng, conceptNearMissPool(shapes).filter(failsEverySurvivor)),
    ],
    DISTRACTORS_PER_ITEM,
    [answer],
  );
  if (distractors.length !== DISTRACTORS_PER_ITEM) {
    throw new Error(`concept induction needs ${DISTRACTORS_PER_ITEM} boards that break the concept`);
  }
  const rawOptions = [answer, ...distractors];
  const order = shuffled(rng, rawOptions.map((_, index) => index));
  const options = order.map((index) => rawOptions[index]);
  const answerIndex = order.indexOf(0);
  const puzzle: Puzzle<Scene> = {
    id: "prototype-concept-induction",
    type: "oddOneOut",
    layout: "conceptGroups",
    instruction: "The top scenes belong; the lower scenes do not. Which option belongs?",
    difficulty: 5,
    stem: [...positives, ...negatives],
    options,
    answerIndex,
    explanation,
  };
  const family = definition(
    "concept-induction-v2",
    ["positive-group", "negative-group", relationCue],
    ruleKey,
    (candidate) => {
      const examples = candidate.stem.map(scenePanel);
      if (examples.some((example) => !example)) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const positiveExamples = examples.slice(0, 3) as Scene[];
      const negativeExamples = examples.slice(3, 6) as Scene[];
      const survivors = enumerateSceneConcepts().filter((concept) =>
        positiveExamples.every((example) => sceneSatisfiesConcept(example, concept)) &&
        negativeExamples.every((example) => !sceneSatisfiesConcept(example, concept)),
      );
      const classifications = survivors.map((concept) =>
        candidate.options.flatMap((option, optionIndex) =>
          sceneSatisfiesConcept(option, concept) ? [optionIndex] : []));
      const everyConceptSelectsOne = classifications.length > 0 &&
        classifications.every((matches) => matches.length === 1);
      const predictedAnswers = new Set(classifications.flat());
      const unique = everyConceptSelectsOne && predictedAnswers.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedAnswers][0]] : null,
        solutionCount: unique ? 1 : predictedAnswers.size,
        usedCueIds: ["positive-group", "negative-group", relationCue],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          survivors.length > 0 && survivors.every((concept) => !sceneSatisfiesConcept(option, concept))
            ? "fails every concept consistent with the positive and negative examples"
            : null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

type AttributeConceptRelation = "same" | "different";
type AttributeConceptAttribute = "shape" | "fill";

function attributeConceptScene(
  shapes: readonly SceneToken["shape"][],
  attribute: AttributeConceptAttribute,
  values: readonly string[],
  variant: 0 | 1 | 2,
): Scene {
  const positions = variant === 0
    ? [{ row: 0, column: 0 }, { row: 0, column: 1 }]
    : variant === 1
      ? [{ row: 0, column: 0 }, { row: 2, column: 2 }]
      : [{ row: 0, column: 0 }, { row: 0, column: 2 }, { row: 2, column: 1 }];
  const nuisanceShapes = variant === 0 ? [shapes[0], shapes[1]]
    : variant === 1 ? [shapes[2], shapes[2]]
      : [shapes[0], shapes[3], shapes[4]];
  const nuisanceFills = variant === 0 ? ["outline", "solid"] as const
    : variant === 1 ? ["half", "half"] as const
      : ["outline", "half", "solid"] as const;
  const sizes = variant === 0 ? ["m", "l"] as const
    : variant === 1 ? ["l", "l"] as const
      : ["l", "m", "l"] as const;
  return scene(positions.map((position, index) => ({
    ...position,
    object: token(
      attribute === "shape" ? values[index] as SceneToken["shape"] : nuisanceShapes[index],
      attribute === "fill" ? values[index] as SceneToken["fill"] : nuisanceFills[index],
      sizes[index],
    ),
  })));
}

function attributeConceptCandidate(
  rng: Rng,
  shapes: readonly SceneToken["shape"][],
  relation: AttributeConceptRelation,
  attribute: AttributeConceptAttribute,
): SceneFamilyCandidate {
  const domain: readonly string[] = attribute === "shape" ? shapes : RELATIONAL_FILLS;
  const positives = relation === "same"
    ? [
        attributeConceptScene(shapes, attribute, [domain[0], domain[0]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[1]], 1),
        attributeConceptScene(shapes, attribute, [domain[2], domain[2], domain[2]], 2),
      ]
    : [
        attributeConceptScene(shapes, attribute, [domain[0], domain[1]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[2]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[1], domain[2]], 2),
      ];
  const negatives = relation === "same"
    ? [
        attributeConceptScene(shapes, attribute, [domain[0], domain[1]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[2]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[0], domain[1]], 2),
      ]
    : [
        attributeConceptScene(shapes, attribute, [domain[0], domain[0]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[1]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[1], domain[0]], 2),
      ];
  const answerValues = relation === "same"
    ? [domain[2], domain[2]]
    : [domain[0], domain[1], domain[2]];
  const answerOption = relation === "same"
    ? attributeConceptScene(shapes, attribute, answerValues, 1)
    : attributeConceptScene(shapes, attribute, answerValues, 2);
  const authoredDistractors: readonly Scene[] = relation === "same"
    ? [
        attributeConceptScene(shapes, attribute, [domain[0], domain[1]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[2]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[0], domain[1]], 2),
      ]
    : [
        attributeConceptScene(shapes, attribute, [domain[0], domain[0]], 0),
        attributeConceptScene(shapes, attribute, [domain[1], domain[1]], 1),
        attributeConceptScene(shapes, attribute, [domain[0], domain[1], domain[0]], 2),
      ];
  const concept: SceneConcept = { all: [{ kind: relation, attribute }] };
  const relationText = relation === "same" ? "the same" : "a different";
  const failureText = relation === "same" ? "mixes at least two values" : "repeats at least one value";
  return conceptCandidate(
    rng,
    shapes,
    JSON.stringify({ concept }),
    `${relation}-${attribute}-relation`,
    positives,
    negatives,
    answerOption,
    authoredDistractors,
    `Compare only the ${attribute} of each top-level token. Every check-marked scene gives every token ${relationText} ${attribute}, while each crossed scene ${failureText}; position, the other token attributes, and token count vary to rule out shortcuts. The highlighted option follows that complete relation. Every distractor visibly breaks it even when another feature looks regular.`,
  );
}

function conceptInduction(rng: Rng): SceneFamilyCandidate {
  const shapes = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const variant = pick(rng, [
    "contains",
    "adjacent",
    "symmetry",
    "equal-row-counts",
    "same-shape",
    "same-fill",
    "different-shape",
    "different-fill",
  ] as const);

  if (variant === "same-shape") return attributeConceptCandidate(rng, shapes, "same", "shape");
  if (variant === "same-fill") return attributeConceptCandidate(rng, shapes, "same", "fill");
  if (variant === "different-shape") return attributeConceptCandidate(rng, shapes, "different", "shape");
  if (variant === "different-fill") return attributeConceptCandidate(rng, shapes, "different", "fill");

  if (variant === "adjacent") {
    const positives = [
      scene([{ row: 0, column: 0, object: token(shapes[0]) }, { row: 0, column: 1, object: token(shapes[1]) }]),
      scene([{ row: 0, column: 2, object: token(shapes[2]) }, { row: 1, column: 2, object: token(shapes[2], "solid") }]),
      scene([
        { row: 2, column: 0, object: token(shapes[3]) },
        { row: 2, column: 1, object: token(shapes[4], "solid") },
        { row: 0, column: 2, object: token(shapes[3]) },
      ]),
    ];
    const negatives = [
      scene([{ row: 0, column: 0, object: token(shapes[0]) }, { row: 2, column: 2, object: token(shapes[1]) }]),
      scene([{ row: 0, column: 2, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[2]) }]),
      one(shapes[4], 1, 1),
    ];
    return conceptCandidate(
      rng,
      shapes,
      JSON.stringify({ concept: { all: [{ kind: "adjacent" }] } satisfies SceneConcept }),
      "adjacency-relation",
      positives,
      negatives,
      scene([{ row: 1, column: 0, object: token(shapes[0]) }, { row: 1, column: 1, object: token(shapes[2], "solid") }]),
      [
        scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 2, column: 2, object: token(shapes[3]) }]),
        one(shapes[4], 0, 2),
        scene([
          { row: 0, column: 0, object: token(shapes[0]) },
          { row: 0, column: 2, object: token(shapes[1], "solid") },
        ]),
      ],
      "The check-marked examples all contain at least one pair of top-level tokens in neighbouring slots: the two tokens share a horizontal or vertical edge. The crossed examples have no such pair. The highlighted option has two adjacent tokens and therefore follows the concept; each distractor keeps its tokens separated or has only one token.",
    );
  }

  if (variant === "symmetry") {
    const mirrorPair = (row: number, shape: SceneToken["shape"]) => scene([
      { row, column: 0, object: token(shape) },
      { row, column: 2, object: token(shape) },
    ]);
    const positives = [mirrorPair(0, shapes[0]), mirrorPair(2, shapes[1]), one(shapes[2], 1, 1, "solid")];
    const negatives = [
      one(shapes[0], 0, 0),
      scene([{ row: 1, column: 0, object: token(shapes[1]) }, { row: 1, column: 2, object: token(shapes[2]) }]),
      scene([{ row: 0, column: 0, object: token(shapes[3]) }, { row: 1, column: 0, object: token(shapes[3]) }]),
    ];
    return conceptCandidate(
      rng,
      shapes,
      JSON.stringify({ concept: { all: [{ kind: "symmetry", axis: "horizontal" }] } satisfies SceneConcept }),
      "symmetry-relation",
      positives,
      negatives,
      mirrorPair(1, shapes[4]),
      [
        scene([{ row: 0, column: 0, object: token(shapes[4]) }, { row: 2, column: 0, object: token(shapes[4]) }]),
        one(shapes[2], 0, 0),
        scene([{ row: 2, column: 0, object: token(shapes[0]) }, { row: 2, column: 2, object: token(shapes[1]) }]),
      ],
      "The check-marked examples are unchanged when the board is reflected from left to right. A centred token reflects onto itself, while a matching pair at equal distances from the centre swaps into the same arrangement. The crossed examples lose that match. The highlighted option is the only candidate with the required left-right symmetry.",
    );
  }

  if (variant === "equal-row-counts") {
    const positives = [
      scene([
        { row: 0, column: 0, object: token(shapes[0]) },
        { row: 1, column: 1, object: token(shapes[1], "solid") },
        { row: 2, column: 2, object: token(shapes[2]) },
      ]),
      scene([
        { row: 0, column: 0, object: token(shapes[0]) }, { row: 0, column: 2, object: token(shapes[1]) },
        { row: 1, column: 0, object: token(shapes[2], "solid") }, { row: 1, column: 2, object: token(shapes[3]) },
        { row: 2, column: 0, object: token(shapes[4]) }, { row: 2, column: 2, object: token(shapes[0], "solid") },
      ]),
      scene([
        { row: 0, column: 2, object: token(shapes[3]) },
        { row: 1, column: 0, object: token(shapes[3]) },
        { row: 2, column: 1, object: token(shapes[3]) },
      ]),
    ];
    const negatives = [
      one(shapes[0], 0, 0),
      scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 1, column: 1, object: token(shapes[2]) }]),
      scene([
        { row: 1, column: 0, object: token(shapes[2]) },
        { row: 2, column: 0, object: token(shapes[3]) },
        { row: 2, column: 2, object: token(shapes[4]) },
      ]),
    ];
    return conceptCandidate(
      rng,
      shapes,
      JSON.stringify({ concept: { all: [{ kind: "count", comparison: "equal" }] } satisfies SceneConcept }),
      "row-count-relation",
      positives,
      negatives,
      scene([
          { row: 0, column: 1, object: token(shapes[4]) },
          { row: 1, column: 2, object: token(shapes[0]) },
          { row: 2, column: 0, object: token(shapes[2], "solid") },
        ]),
      [
        scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 1, column: 1, object: token(shapes[2]) }]),
        scene([
          { row: 1, column: 0, object: token(shapes[2]) },
          { row: 2, column: 0, object: token(shapes[3]) },
          { row: 2, column: 2, object: token(shapes[4]) },
        ]),
        scene([
          { row: 0, column: 0, object: token(shapes[0]) },
          { row: 0, column: 2, object: token(shapes[1], "solid") },
        ]),
      ],
      "Count only top-level tokens in each of the three rows. Every check-marked example has the same count in row one, row two, and row three; the crossed examples do not. The highlighted option places one token in each row, so its row counts are 1–1–1. Each distractor leaves at least one row with a different count.",
    );
  }

  const positives = [
    contained(shapes[0], shapes[1], 1, 1),
    contained(shapes[1], shapes[2], 0, 0),
    scene([
      { row: 2, column: 2, object: { kind: "container", shape: "hexagon", contents: [token(shapes[3])] } },
      { row: 0, column: 0, object: token(shapes[0], "solid") },
      { row: 0, column: 2, object: token(shapes[1]) },
    ]),
  ];
  const negatives = [
    one(shapes[0], 1, 1),
    scene([{ row: 0, column: 0, object: token(shapes[1]) }, { row: 0, column: 1, object: token(shapes[2]) }]),
    scene([{ row: 0, column: 0, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[3], "solid") }]),
  ];
  return conceptCandidate(
    rng,
      shapes,
    JSON.stringify({ concept: { all: [{ kind: "contains" }] } satisfies SceneConcept }),
    "containment-relation",
    positives,
    negatives,
      contained(shapes[3], shapes[4], 2, 1),
      [
        one(shapes[4], 2, 1),
        scene([{ row: 1, column: 0, object: token(shapes[0]) }, { row: 1, column: 1, object: token(shapes[1]) }]),
        scene([{ row: 0, column: 0, object: token(shapes[2]) }, { row: 2, column: 2, object: token(shapes[2]) }]),
      ],
    "The check-marked examples all show a true containment relationship: one outlined shape visibly encloses another token. None of the crossed examples contains a token, even when two shapes are near each other. The highlighted option includes an enclosing shape with a token inside it; the distractors show only separate, adjacent, or distant tokens.",
    );
}

type CreaseGuide = NonNullable<Scene["guides"]>[number];

interface FoldProgram {
  guides: readonly [CreaseGuide] | readonly [CreaseGuide, CreaseGuide];
}

const VERTICAL_FOLD_GUIDES: readonly CreaseGuide[] = [
  { kind: "crease", axis: "vertical", direction: "rightToLeft" },
  { kind: "crease", axis: "vertical", direction: "leftToRight" },
] as const;
const HORIZONTAL_FOLD_GUIDES: readonly CreaseGuide[] = [
  { kind: "crease", axis: "horizontal", direction: "bottomToTop" },
  { kind: "crease", axis: "horizontal", direction: "topToBottom" },
] as const;
const FOLD_PROGRAM_GRAMMAR: readonly FoldProgram[] = [
  ...VERTICAL_FOLD_GUIDES.map((guide): FoldProgram => ({ guides: [guide] })),
  ...HORIZONTAL_FOLD_GUIDES.map((guide): FoldProgram => ({ guides: [guide] })),
  ...VERTICAL_FOLD_GUIDES.flatMap((vertical) =>
    HORIZONTAL_FOLD_GUIDES.map((horizontal): FoldProgram => ({ guides: [vertical, horizontal] }))),
];

/**
 * The two-crease half of the grammar — one vertical fold and one horizontal
 * fold, so opening the paper turns one punch into four.
 *
 * `fold-punch-d4` draws the whole grammar, which means half its draws are a
 * single fold and a solver can sometimes stop after one unfold.
 * `fold-punch-d5` draws only from here, so two unfolds are guaranteed. The
 * uniqueness oracle still searches the FULL grammar: the bucket narrows what is
 * generated, never what a solver is allowed to consider.
 */
const TWO_CREASE_FOLD_PROGRAMS: readonly FoldProgram[] =
  FOLD_PROGRAM_GRAMMAR.filter((program) => program.guides.length === 2);

/** The bucket id whose draws are restricted to two-crease programs. */
const FOLD_PUNCH_TWO_CREASE_BUCKET = "fold-punch-d5";

function guideKey(guide: CreaseGuide): string {
  return `${guide.axis}:${guide.direction}`;
}

function foldedPosition(program: FoldProgram, variant: 0 | 1): { row: number; column: number } {
  const vertical = program.guides.find((guide) => guide.axis === "vertical");
  const horizontal = program.guides.find((guide) => guide.axis === "horizontal");
  return {
    row: horizontal?.direction === "bottomToTop" ? 0
      : horizontal?.direction === "topToBottom" ? 2
        : variant === 0 ? 0 : 2,
    column: vertical?.direction === "rightToLeft" ? 0
      : vertical?.direction === "leftToRight" ? 2
        : variant === 0 ? 0 : 2,
  };
}

function foldedPaper(shape: SceneToken["shape"], program: FoldProgram, variant: 0 | 1): Scene {
  const position = foldedPosition(program, variant);
  return {
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: [{ ...position, object: token(shape, "solid") }],
    tiles: [],
    guides: [...program.guides],
  };
}

function unfoldAcross(input: Scene, axis: "horizontal" | "vertical"): Scene | null {
  const guide = (input.guides ?? []).find((candidate) => candidate.kind === "crease" && candidate.axis === axis);
  if (!guide) return null;
  const onFoldedStack = input.objects.every((placement) =>
    guide.direction === "rightToLeft" ? placement.column <= Math.floor((input.columns - 1) / 2) :
    guide.direction === "leftToRight" ? placement.column >= Math.ceil((input.columns - 1) / 2) :
    guide.direction === "bottomToTop" ? placement.row <= Math.floor((input.rows - 1) / 2) :
    placement.row >= Math.ceil((input.rows - 1) / 2));
  if (!onFoldedStack) return null;
  const objects = input.objects.flatMap((placement) => [
    placement,
    axis === "vertical"
      ? { ...placement, column: input.columns - 1 - placement.column }
      : { ...placement, row: input.rows - 1 - placement.row },
  ]);
  const unique = new Map(objects.map((placement) => [`${placement.row}:${placement.column}:${JSON.stringify(placement.object)}`, placement]));
  const remainingGuides = (input.guides ?? []).filter((candidate) => candidate !== guide);
  const result: Scene = { ...input, objects: [...unique.values()], tiles: [], guides: remainingGuides };
  return result.objects.length > input.objects.length ? result : null;
}

function sceneUsesFoldProgram(input: Scene, program: FoldProgram): boolean {
  const shown = (input.guides ?? []).map(guideKey);
  const expected = program.guides.map(guideKey);
  return shown.length === expected.length && shown.every((key, index) => key === expected[index]);
}

function unfoldWithProgram(input: Scene, program: FoldProgram): Scene | null {
  if (!sceneUsesFoldProgram(input, program)) return null;
  let output: Scene | null = input;
  for (const guide of program.guides) output = output && unfoldAcross(output, guide.axis);
  return output;
}

function compatibleFoldPrograms(input: Scene): readonly [FoldProgram, FoldProgram, FoldProgram] | null {
  const placement = input.objects[0];
  if (!placement || input.objects.length !== 1) return null;
  const vertical = VERTICAL_FOLD_GUIDES.find((guide) =>
    guide.direction === (placement.column === 0 ? "rightToLeft" : placement.column === 2 ? "leftToRight" : ""));
  const horizontal = HORIZONTAL_FOLD_GUIDES.find((guide) =>
    guide.direction === (placement.row === 0 ? "bottomToTop" : placement.row === 2 ? "topToBottom" : ""));
  return vertical && horizontal
    ? [{ guides: [vertical] }, { guides: [horizontal] }, { guides: [vertical, horizontal] }]
    : null;
}

/** Move every punch across the program's creases instead of keeping both copies. */
function mirroredWithoutOriginal(input: Scene, program: FoldProgram): Scene | null {
  let objects = input.objects;
  for (const guide of program.guides) {
    objects = objects.map((placement) => guide.axis === "vertical"
      ? { ...placement, column: input.columns - 1 - placement.column }
      : { ...placement, row: input.rows - 1 - placement.row });
  }
  const moved: Scene = { ...input, objects, tiles: [], guides: [] };
  return sceneSignature(moved) === sceneSignature({ ...input, guides: [] }) ? null : moved;
}

function foldNearMissOutputs(input: Scene, answer: Scene): Array<{ output: Scene; reason: string }> {
  const withoutCrease: Scene = { ...input, guides: [] };
  const compatible = compatibleFoldPrograms(input) ?? [];
  return [
    { output: withoutCrease, reason: "leaves every fold closed" },
    ...compatible.flatMap((program) => {
      const folded: Scene = { ...input, guides: [...program.guides] };
      const output = unfoldWithProgram(folded, program);
      return output ? [{ output, reason: `uses the ${program.guides.map(guideKey).join(" then ")} fold program` }] : [];
    }),
    // Opening a fold keeps the punch and adds its mirror. Moving the punch to
    // the mirror instead is the other way to get the count wrong.
    ...compatible.flatMap((program) => {
      const output = mirroredWithoutOriginal(input, program);
      return output
        ? [{ output, reason: `moves the punch across the ${program.guides.map(guideKey).join(" then ")} crease instead of keeping both` }]
        : [];
    }),
  ].filter((entry, index, entries) =>
    sceneSignature(entry.output) !== sceneSignature(answer) &&
    entries.findIndex((candidate) => sceneSignature(candidate.output) === sceneSignature(entry.output)) === index);
}

function foldPunch(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  const grammar = bucket.bucket === FOLD_PUNCH_TWO_CREASE_BUCKET
    ? TWO_CREASE_FOLD_PROGRAMS
    : FOLD_PROGRAM_GRAMMAR;
  const program = pick(rng, grammar);
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const first = foldedPaper(firstShape, program, 0);
  const unfolded = unfoldWithProgram(first, program)!;
  const query = foldedPaper(secondShape, program, 1);
  const answer = unfoldWithProgram(query, program)!;
  const nearMisses = selectDistractors(
    foldNearMissOutputs(query, answer).map((entry) => entry.output),
    rng,
    "fold punch",
    { answer },
  );
  const puzzle = makePuzzle(
    "prototype-fold-punch",
    "analogy",
    "analogy",
    "The centre line is a fold. Apply the same unfolding to the new punch.",
    bucket.difficulty,
    [first, unfolded, query],
    answer,
    nearMisses,
    rng,
    `The worked pair establishes the visible crease program: ${program.guides.map(guideKey).join(", then ")}. Opening each fold preserves every existing punch and adds its mirror across that crease, so one crease makes two punches and two creases make four. Applying the same complete program to the query gives the highlighted board. The distractors leave a fold closed, omit one crease, unfold across the wrong axis, or move the punch to its mirror instead of keeping both.`,
  );
  const family = definition(
    "fold-punch-v2",
    ["visible-creases", "fold-directions", "worked-unfold"],
    JSON.stringify(program),
    (candidate) => {
      const [workedInput, workedOutput, queryInput] = candidate.stem.map(scenePanel);
      if (!workedInput || !workedOutput || !queryInput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = FOLD_PROGRAM_GRAMMAR.filter((candidateProgram) => {
        const predicted = unfoldWithProgram(workedInput, candidateProgram);
        return predicted !== null && sceneSignature(predicted) === sceneSignature(workedOutput);
      });
      const predictions = distinctOutputs(survivors.map((candidateProgram) =>
        unfoldWithProgram(queryInput, candidateProgram)));
      const wrongRules = predictions[0] ? foldNearMissOutputs(queryInput, predictions[0]) : [];
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["visible-creases", "fold-directions", "worked-unfold"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) =>
          wrongRules.find((rule) => rule.output && sceneSignature(rule.output) === sceneSignature(option) &&
            (!predictions[0] || sceneSignature(option) !== sceneSignature(predictions[0])))?.reason ?? null),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function inverseFoldPunch(rng: Rng, bucket: SceneFamilyBucket): SceneFamilyCandidate {
  // This family has no d6 bucket, and the reason is a ceiling rather than a
  // gap: `SceneSchema` allows a board at most two guides, so a three-crease
  // program cannot be drawn at all (proved in scene-families.test.ts). A
  // two-crease-only bucket was built and withdrawn on 2026-08-26 because d5
  // already draws those same programs, so it raised no ceiling — it only
  // dropped the easy half of an existing bucket. The d6 tail is carried by
  // `composed-transform-d6` and `transformation-machine-d6` instead.
  const program = pick(rng, FOLD_PROGRAM_GRAMMAR);
  const [firstShape, secondShape] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const firstFolded = foldedPaper(firstShape, program, 0);
  const firstUnfolded = unfoldWithProgram(firstFolded, program)!;
  const answer = foldedPaper(secondShape, program, 1);
  const queryUnfolded = unfoldWithProgram(answer, program)!;
  const distractors = FOLD_PROGRAM_GRAMMAR
    .filter((candidateProgram) => JSON.stringify(candidateProgram) !== JSON.stringify(program))
    .map((candidateProgram, index) => foldedPaper(secondShape, candidateProgram, index % 2 as 0 | 1))
    .filter((candidate, index, candidates) =>
      sceneSignature(candidate) !== sceneSignature(answer) &&
      candidates.findIndex((other) => sceneSignature(other) === sceneSignature(candidate)) === index);
  const selectedDistractors = selectDistractors(distractors, rng, "inverse fold punch", { answer });
  const puzzle = makePuzzle(
    "prototype-inverse-fold-punch",
    "analogy",
    "analogy",
    "Use the fold arrow and worked pair. Which folded punch produces the third board?",
    bucket.difficulty,
    [firstUnfolded, firstFolded, queryUnfolded],
    answer,
    selectedDistractors,
    rng,
    `Work backward from the open query board using the worked crease program: ${program.guides.map(guideKey).join(", then ")}. Mirrored punches overlap when each indicated side folds across its centre line, leaving the single punch shown by the highlighted folded board. Its punch position, crease axes, and arrows all match the worked pair. The other options use a different bounded fold program, so they either unfold to another pattern or contradict the demonstrated directions.`,
  );
  const family = definition(
    "inverse-fold-punch-v2",
    ["worked-inverse-fold", "fold-direction", "mirrored-punches"],
    `inverse:${JSON.stringify(program)}`,
    (candidate) => {
      const [workedOutput, workedFolded, queryOutput] = candidate.stem.map(scenePanel);
      if (!workedOutput || !workedFolded || !queryOutput) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const survivors = FOLD_PROGRAM_GRAMMAR.filter((candidateProgram) => {
        const prediction = unfoldWithProgram(workedFolded, candidateProgram);
        return prediction !== null && sceneSignature(prediction) === sceneSignature(workedOutput);
      });
      const evaluated = candidate.options.map((option) => {
        const matchingPrograms = survivors.filter((candidateProgram) => {
          const output = unfoldWithProgram(option, candidateProgram);
          return output !== null && sceneSignature(output) === sceneSignature(queryOutput);
        });
        return {
          option,
          matchingPrograms,
          witness: matchingPrograms.length === 0
            ? "its punch position, crease axes, or arrows do not reproduce the shown unfolding under the worked program"
            : "matches more than one surviving fold program",
        };
      });
      const selections = survivors.map((candidateProgram) => evaluated.flatMap((entry, optionIndex) =>
        entry.matchingPrograms.includes(candidateProgram) ? [optionIndex] : []));
      const everyProgramSelectsOne = selections.length > 0 && selections.every((matches) => matches.length === 1);
      const predictedIndexes = new Set(selections.flat());
      const unique = everyProgramSelectsOne && predictedIndexes.size === 1;
      return {
        derivedAnswer: unique ? candidate.options[[...predictedIndexes][0]] : null,
        solutionCount: unique ? 1 : predictedIndexes.size,
        usedCueIds: ["worked-inverse-fold", "fold-direction", "mirrored-punches"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || evaluated[optionIndex].matchingPrograms.length > 0
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].witness }]),
      };
    },
  );
  return asCandidate(family, puzzle);
}

function applySingleTokenStep(input: Scene, program: RelationalStepProgram): Scene | null {
  const placement = singleTokenPlacement(input);
  if (!placement) return null;
  const positionIndex = RELATIONAL_RING_POSITIONS.findIndex((position) =>
    position.row === placement.row && position.column === placement.column);
  const fillIndex = RELATIONAL_FILLS.indexOf(placement.object.fill);
  if (positionIndex === -1 || fillIndex === -1) return null;
  const position = RELATIONAL_RING_POSITIONS[
    (positionIndex + program.positionDelta + RELATIONAL_RING_POSITIONS.length) % RELATIONAL_RING_POSITIONS.length
  ];
  const fill = RELATIONAL_FILLS[(fillIndex + program.fillDelta) % RELATIONAL_FILLS.length];
  return scene([{ ...position, object: { ...placement.object, fill } }]);
}

function matchingSingleTokenSteps(
  examples: readonly { input: Scene; output: Scene }[],
): RelationalStepProgram[] {
  return RELATIONAL_STEP_GRAMMAR.filter((program) => examples.every((example) => {
    const output = applySingleTokenStep(example.input, program);
    return output !== null && sceneSignature(output) === sceneSignature(example.output);
  }));
}

function tokenStepDescription(program: RelationalStepProgram): string {
  const direction = program.positionDelta > 0 ? "clockwise" : "counter-clockwise";
  const distance = Math.abs(program.positionDelta);
  const fill = program.fillDelta === 0
    ? "keeps its fill"
    : program.fillDelta === 1
      ? "cycles outline to half to solid"
      : "cycles outline to solid to half";
  return `moves ${distance} perimeter slot${distance === 1 ? "" : "s"} ${direction} and ${fill}`;
}

function interleavedSequence(rng: Rng): SceneFamilyCandidate {
  // Redesigned as -v3 on 2026-08-24 (raise-the-ceiling plan, Lever 1). The -v2
  // row showed the answered strand only twice — one observed transition — so a
  // solver could only assume the step repeats. Both strands now show enough
  // terms that every rule is observed at least twice before it must be applied.
  const [a, b] = shuffled(rng, ["circle", "square", "triangle", "diamond", "star"] as const);
  const programA = pick(rng, RELATIONAL_STEP_GRAMMAR);
  const programB = pick(rng, RELATIONAL_STEP_GRAMMAR.filter((program) =>
    JSON.stringify(program) !== JSON.stringify(programA)));
  const startA = pick(rng, RELATIONAL_RING_POSITIONS);
  const startB = pick(rng, RELATIONAL_RING_POSITIONS);
  const strandA = [one(a, startA.row, startA.column, pick(rng, RELATIONAL_FILLS))];
  strandA.push(applySingleTokenStep(strandA[0], programA)!);
  strandA.push(applySingleTokenStep(strandA[1], programA)!);
  strandA.push(applySingleTokenStep(strandA[2], programA)!);
  const strandB = [one(b, startB.row, startB.column, pick(rng, RELATIONAL_FILLS))];
  strandB.push(applySingleTokenStep(strandB[0], programB)!);
  strandB.push(applySingleTokenStep(strandB[1], programB)!);
  strandB.push(applySingleTokenStep(strandB[2], programB)!);
  const answer = strandB[3];
  const shownBTransitions = [
    { input: strandB[0], output: strandB[1] },
    { input: strandB[1], output: strandB[2] },
  ];
  const distractors = distinctOutputs(RELATIONAL_STEP_GRAMMAR
    .filter((program) => !shownBTransitions.every((example) => {
      const predicted = applySingleTokenStep(example.input, program);
      return predicted !== null && sceneSignature(predicted) === sceneSignature(example.output);
    }))
    .map((program) => applySingleTokenStep(strandB[2], program)))
    .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer));
  const selectedDistractors = selectDistractors(distractors, rng, "interleaved sequence", { answer });
  const puzzle = makePuzzle(
    "prototype-interleaved-sequence",
    "sequence",
    "row",
    "Split the panels into two alternating rules. What comes next?",
    4,
    [
      strandA[0], strandB[0], strandA[1], strandB[1],
      strandA[2], strandB[2], strandA[3], { blank: true },
    ],
    answer,
    selectedDistractors,
    rng,
    `Split the row into odd and even panels. In the odd-panel strand, the ${a} token ${tokenStepDescription(programA)}, shown three times; in the even-panel strand, the ${b} token ${tokenStepDescription(programB)}, shown twice. The missing panel belongs to the even strand, so applying its rule once more gives the highlighted option. Each distractor is a prediction from another bounded step rule that fails one of the two shown even transitions.`,
  );
  const family = definition(
    "interleaved-sequence-v3",
    ["alternating-slots", "perimeter-order", "two-step-rules", "fill-states"],
    JSON.stringify({ strandA: programA, strandB: programB }),
    (candidate) => {
      const panels = candidate.stem.map(scenePanel);
      const [a0, b0, a1, b1, a2, b2, a3] = panels;
      if (!a0 || !b0 || !a1 || !b1 || !a2 || !b2 || !a3) {
        return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      }
      const strandAExamples = [
        { input: a0, output: a1 },
        { input: a1, output: a2 },
        { input: a2, output: a3 },
      ];
      const strandBExamples = [
        { input: b0, output: b1 },
        { input: b1, output: b2 },
      ];
      const strandASurvivors = matchingSingleTokenSteps(strandAExamples);
      const strandBSurvivors = matchingSingleTokenSteps(strandBExamples);
      const predictions = distinctOutputs(strandASurvivors.flatMap(() =>
        strandBSurvivors.map((program) => applySingleTokenStep(b2, program))));
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["alternating-slots", "perimeter-order", "two-step-rules", "fill-states"],
        distractorWitnesses: actualWitnesses(candidate.options, candidate.answerIndex, (option) => {
          const failedRule = RELATIONAL_STEP_GRAMMAR.find((program) => {
            const queryOutput = applySingleTokenStep(b2, program);
            const failsAShownTransition = strandBExamples.some((example) => {
              const predicted = applySingleTokenStep(example.input, program);
              return predicted === null || sceneSignature(predicted) !== sceneSignature(example.output);
            });
            return queryOutput !== null && sceneSignature(queryOutput) === sceneSignature(option) && failsAShownTransition;
          });
          return failedRule
            ? `the ${failedRule.positionDelta}, ${failedRule.fillDelta} step rule fails a shown even transition`
            : null;
        }),
      };
    },
  );
  // Two interleaved strands: the answered one takes every second panel from
  // index 1, so its stride of two lands the next term on the trailing blank.
  return asCandidate(family, puzzle, [1, 3, 5]);
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

type RepairProjection = "shape" | "fill";
type RepairRule = "latin" | "horizontal-stripes" | "vertical-stripes" | "checkerboard";

interface RepairProgram {
  projection: RepairProjection;
  rule: RepairRule;
}

const REPAIR_GRAMMAR: readonly RepairProgram[] = (["shape", "fill"] as const).flatMap((projection) =>
  (["latin", "horizontal-stripes", "vertical-stripes", "checkerboard"] as const)
    .map((rule) => ({ projection, rule })));

const REPAIR_SHAPE_DOMAIN: readonly SceneToken["shape"][] = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
] as const;

function repairTokenGrid(value: Scene): SceneToken[][] | null {
  if (value.rows !== 3 || value.columns !== 3 || value.objects.length !== 9 || value.tiles.length > 0) return null;
  const byPosition = new Map(value.objects.map((placement) => [
    `${placement.row}:${placement.column}`,
    placement.object.kind === "token" ? placement.object : null,
  ]));
  const grid = [0, 1, 2].map((row) => [0, 1, 2].map((column) => byPosition.get(`${row}:${column}`)));
  return grid.some((row) => row.some((entry) => !entry)) ? null : grid as SceneToken[][];
}

function repairProgramFailures(value: Scene, program: RepairProgram): string[] {
  const grid = repairTokenGrid(value);
  if (!grid) return ["board is not a complete 3 by 3 token grid"];
  const projected = grid.map((row) => row.map((entry) => entry[program.projection]));
  if (program.rule === "latin") {
    const failures: string[] = [];
    for (let index = 0; index < 3; index++) {
      if (new Set(projected[index]).size !== 3) {
        failures.push(`row ${index + 1} repeats a ${program.projection}`);
      }
      if (new Set(projected.map((row) => row[index])).size !== 3) {
        failures.push(`column ${index + 1} repeats a ${program.projection}`);
      }
    }
    const counts = new Map<string, number>();
    for (const entry of projected.flat()) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    if (counts.size !== 3 || [...counts.values()].some((count) => count !== 3)) {
      failures.push(`the Latin board does not use exactly three ${program.projection} values three times each`);
    }
    return failures;
  }
  if (program.rule === "horizontal-stripes") {
    const representatives = projected.map((row) => row[0]);
    const rowsAreUniform = projected.every((row) => row.every((entry) => entry === row[0]));
    return rowsAreUniform && new Set(representatives).size === 3
      ? []
      : [`${program.projection} values do not form three different horizontal stripes`];
  }
  if (program.rule === "vertical-stripes") {
    const representatives = projected[0];
    const columnsAreUniform = [0, 1, 2].every((column) =>
      projected.every((row) => row[column] === projected[0][column]));
    return columnsAreUniform && new Set(representatives).size === 3
      ? []
      : [`${program.projection} values do not form three different vertical stripes`];
  }
  const even = projected.flatMap((row, rowIndex) => row.filter((_, columnIndex) =>
    (rowIndex + columnIndex) % 2 === 0));
  const odd = projected.flatMap((row, rowIndex) => row.filter((_, columnIndex) =>
    (rowIndex + columnIndex) % 2 === 1));
  return new Set(even).size === 1 && new Set(odd).size === 1 && even[0] !== odd[0]
    ? []
    : [`${program.projection} values do not alternate as a two-value checkerboard`];
}

function repairProjectionDomain(projection: RepairProjection): readonly string[] {
  return projection === "shape" ? REPAIR_SHAPE_DOMAIN : RELATIONAL_FILLS;
}

function withRepairProjection(tokenValue: SceneToken, projection: RepairProjection, value: string): SceneToken {
  return projection === "shape"
    ? { ...tokenValue, shape: value as SceneToken["shape"] }
    : { ...tokenValue, fill: value as SceneToken["fill"] };
}

function oneTileRepairChanges(value: Scene, projection: RepairProjection): Scene[] {
  const grid = repairTokenGrid(value);
  if (!grid) return [];
  return grid.flatMap((row, rowIndex) => row.flatMap((entry, columnIndex) =>
    repairProjectionDomain(projection)
      .filter((replacement) => replacement !== entry[projection])
      .map((replacement) => scene(grid.flatMap((tokenRow, placedRow) =>
        tokenRow.map((cell, placedColumn) => ({
          row: placedRow,
          column: placedColumn,
          object: placedRow === rowIndex && placedColumn === columnIndex
            ? withRepairProjection(cell, projection, replacement)
            : cell,
        }))), 3, 3))));
}

function programRepairs(value: Scene, program: RepairProgram): Scene[] {
  return oneTileRepairChanges(value, program.projection)
    .filter((candidate) => repairProgramFailures(candidate, program).length === 0);
}

function repairRuleDescription(program: RepairProgram): string {
  if (program.rule === "latin") {
    return `every row and column contains three different ${program.projection} values`;
  }
  if (program.rule === "horizontal-stripes") {
    return `each row repeats one ${program.projection}, while the three rows use different values`;
  }
  if (program.rule === "vertical-stripes") {
    return `each column repeats one ${program.projection}, while the three columns use different values`;
  }
  return `${program.projection} values alternate between two values like a checkerboard`;
}

function minimalRepair(rng: Rng): SceneFamilyCandidate {
  // v3 keeps v2's visible 3x3 one-tile repair, but every sampled program now
  // changes the projected pattern that determines the repaired tile and value.
  const program = pick(rng, REPAIR_GRAMMAR);
  const shapes = shuffled(rng, REPAIR_SHAPE_DOMAIN);
  const fills = shuffled(rng, RELATIONAL_FILLS);
  const projectedValues: readonly string[] = program.projection === "shape" ? shapes : fills;
  const valueIndexAt = (row: number, column: number): number =>
    program.rule === "latin" ? (row + column) % 3
      : program.rule === "horizontal-stripes" ? row
        : program.rule === "vertical-stripes" ? column
          : (row + column) % 2;
  const validTokenAt = (row: number, column: number): SceneToken => {
    const projectedValue = projectedValues[valueIndexAt(row, column)];
    return program.projection === "shape"
      ? token(projectedValue as SceneToken["shape"], fills[0])
      : token(shapes[3], projectedValue as SceneToken["fill"]);
  };
  const faultRow = pick(rng, [0, 1, 2]);
  const faultColumn = pick(rng, [0, 1, 2]);
  const validGrid = [0, 1, 2].map((row) => [0, 1, 2].map((column) => validTokenAt(row, column)));
  const original = validGrid[faultRow][faultColumn][program.projection];
  const usedValueCount = program.rule === "checkerboard" ? 2 : 3;
  const wrong = pick(rng, projectedValues.slice(0, usedValueCount).filter((value) => value !== original));
  const faultyGrid = validGrid.map((row) => row.map((entry) => ({ ...entry })));
  faultyGrid[faultRow][faultColumn] = withRepairProjection(
    faultyGrid[faultRow][faultColumn],
    program.projection,
    wrong,
  );
  const faulty = scene(faultyGrid.flatMap((row, rowIndex) => row.map((cell, columnIndex) => ({
    row: rowIndex,
    column: columnIndex,
    object: cell,
  }))), 3, 3);
  const repairs = REPAIR_GRAMMAR.flatMap((candidateProgram) => programRepairs(faulty, candidateProgram));
  const distinctRepairs = distinctOutputs(repairs);
  const answer = scene(validGrid.flatMap((row, rowIndex) => row.map((cell, columnIndex) => ({
    row: rowIndex,
    column: columnIndex,
    object: cell,
  }))), 3, 3);
  if (distinctRepairs.length !== 1 || sceneSignature(distinctRepairs[0]) !== sceneSignature(answer)) {
    throw new Error("minimal-repair grammar must predict one visible repair");
  }
  const distractors = selectDistractors(
    oneTileRepairChanges(faulty, program.projection)
      .filter((candidate) => sceneSignature(candidate) !== sceneSignature(answer)),
    rng,
    "minimal repair",
    { answer },
  );
  const alternatives = [answer, ...distractors];
  const order = shuffled(rng, alternatives.map((_, index) => index));
  const puzzle: Puzzle<Scene> = {
    id: "prototype-minimal-repair",
    type: "oddOneOut",
    layout: "singleScene",
    instruction: "Each option changes exactly one tile. Which change repairs the faulty board?",
    difficulty: 5,
    stem: [faulty],
    options: order.map((index) => alternatives[index]),
    answerIndex: order.indexOf(0),
    explanation: `Read the board by its ${program.projection}: ${repairRuleDescription(program)}. One tile breaks that visible pattern. Restoring ${original} at its position repairs the complete board with exactly one change, which is the highlighted option. Every distractor also changes only one tile, but it changes the wrong position or inserts a value that leaves the sampled pattern visibly broken.`,
  };
  const family = definition(
    "minimal-repair-v3",
    ["faulty-board", "one-change-options", "projected-pattern"],
    JSON.stringify(program),
    (candidate) => {
      const faultyBoard = scenePanel(candidate.stem[0]);
      if (!faultyBoard) return { derivedAnswer: null, solutionCount: 0, usedCueIds: [], distractorWitnesses: [] };
      const faultyByPosition = new Map(faultyBoard.objects.map((placement) => [
        `${placement.row}:${placement.column}`,
        JSON.stringify(placement.object),
      ]));
      const survivors = REPAIR_GRAMMAR.map((candidateProgram) => ({
        program: candidateProgram,
        repairs: programRepairs(faultyBoard, candidateProgram),
      })).filter((entry) => entry.repairs.length > 0);
      const predictions = distinctOutputs(survivors.flatMap((entry) => entry.repairs));
      const evaluated = candidate.options.map((option) => {
        const optionByPosition = new Map(option.objects.map((placement) => [
          `${placement.row}:${placement.column}`,
          JSON.stringify(placement.object),
        ]));
        const positions = new Set([...faultyByPosition.keys(), ...optionByPosition.keys()]);
        const changedPositions = [...positions].filter((position) =>
          faultyByPosition.get(position) !== optionByPosition.get(position));
        const matchingPrograms = survivors.filter((entry) =>
          entry.repairs.some((repair) => sceneSignature(repair) === sceneSignature(option)));
        const failures = matchingPrograms.length > 0 ? []
          : survivors.flatMap((entry) => repairProgramFailures(option, entry.program)).slice(0, 1);
        if (option.rows !== faultyBoard.rows || option.columns !== faultyBoard.columns || changedPositions.length !== 1) {
          failures.unshift(`changes ${changedPositions.length} tiles instead of exactly one`);
        }
        return { option, failures, matchingPrograms };
      });
      return {
        derivedAnswer: predictions.length === 1 ? predictions[0] : null,
        solutionCount: predictions.length,
        usedCueIds: ["faulty-board", "one-change-options", "projected-pattern"],
        distractorWitnesses: candidate.options.flatMap((_, optionIndex) =>
          optionIndex === candidate.answerIndex || !evaluated[optionIndex]?.failures[0]
            ? []
            : [{ optionIndex, witness: evaluated[optionIndex].failures[0] }]),
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
    case "containment-analogy-v2": return containmentAnalogy(rng);
    case "composed-transform-v2": return composedTransform(rng, bucket);
    case "relational-outlier-v2": return relationalOutlier(rng);
    case "relational-outlier-v3": return relationalOutlierDemonstrated(rng);
    case "relational-matrix-v2": return relationalMatrix(rng);
    case "visual-set-algebra-v2": return setAlgebra(rng, { bucket });
    case "constraint-mosaic-v2": return constraintMosaic(rng);
    case "topology-path-v1": return topologyPath(rng);
    case "spatial-transform-v2": return spatialTransform(rng);
    case "transformation-machine-v3": return transformationMachine(rng, bucket);
    case "rule-switching-v2": return ruleSwitching(rng);
    case "concept-induction-v2": return conceptInduction(rng);
    case "fold-punch-v2": return foldPunch(rng, bucket);
    case "inverse-fold-punch-v2": return inverseFoldPunch(rng, bucket);
    case "interleaved-sequence-v3": return interleavedSequence(rng);
    case "second-order-sequence-v2": return secondOrderSequence(rng);
    case "inverse-analogy-v2": return inverseAnalogy(rng);
    case "minimal-repair-v3": return minimalRepair(rng);
    case "parallel-evolution-v1": return parallelEvolution(rng, bucket);
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
  bucketId: string = COMPOSED_TRANSFORM_D4_BUCKET,
): SceneFamilyCandidate {
  const { heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
  if (heldOutPrograms.length === 0) {
    throw new Error(`no held-out composed-transform programs at ${gateCount} gates`);
  }
  // The held-out item has to be the same KIND of item as the public bucket it
  // stands in for, direction included: a reserved program rendered left to
  // right would not measure the bucket a taker actually meets.
  return composedTransformForProgram(pick(rng, heldOutPrograms), rng, {
    bucketId,
    reversed: COMPOSED_TRANSFORM_REVERSED_BUCKETS.has(bucketId),
  });
}

/** Materialize the only currently supported LLM-proposed rule through pure code. */
export function generateProposedSetAlgebraCandidate(
  operation: SceneBinaryOperation,
  rng: Rng,
): SceneFamilyCandidate {
  return setAlgebra(rng, { forcedOperation: operation });
}
