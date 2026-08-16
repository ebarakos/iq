import { createHash } from "node:crypto";
import { seededRng, shuffled, type Seed } from "../lib/rng";
import {
  EXPANDED_PROFILE_BANDS,
  selectEnabledFamilyBands,
  type EnabledFamilyBand,
  type ExpandedProfileBand,
  type FamilyPromotionRegistry,
} from "./family-promotion";
import {
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import {
  VisualPuzzleSetSchema,
  type Puzzle,
  type PuzzleSet,
  type Scene,
  type Visual,
} from "./schema";

export interface ExpandedQuizSlot {
  band: ExpandedProfileBand;
  ordinalWithinBand: number;
}

/** The product-level 2 / 4 / 4 / 2 reasoning curve. */
export const EXPANDED_QUIZ_SLOTS: readonly ExpandedQuizSlot[] = [
  { band: "warmup", ordinalWithinBand: 0 },
  { band: "warmup", ordinalWithinBand: 1 },
  { band: "composition", ordinalWithinBand: 0 },
  { band: "composition", ordinalWithinBand: 1 },
  { band: "composition", ordinalWithinBand: 2 },
  { band: "composition", ordinalWithinBand: 3 },
  { band: "constraint-spatial", ordinalWithinBand: 0 },
  { band: "constraint-spatial", ordinalWithinBand: 1 },
  { band: "constraint-spatial", ordinalWithinBand: 2 },
  { band: "constraint-spatial", ordinalWithinBand: 3 },
  { band: "induction-transfer", ordinalWithinBand: 0 },
  { band: "induction-transfer", ordinalWithinBand: 1 },
] as const;

const MAX_ITEMS_PER_FAMILY = 2;
const MIN_DISTINCT_FAMILIES = 6;

function enabledFamiliesForBand(
  registry: FamilyPromotionRegistry,
  band: ExpandedProfileBand,
): EnabledFamilyBand[] {
  const selections = registry.flatMap((family) => {
    const promotion = family.bands.find((entry) => entry.band === band);
    if (!promotion) return [];
    return promotion.validatedDifficultyBuckets.flatMap((bucket) =>
      selectEnabledFamilyBands(registry, band, bucket)
        .filter((selection) => selection.familyId === family.familyId),
    );
  });
  const unique = new Map(selections.map((selection) => [selection.familyId, selection]));
  return [...unique.values()];
}

const PREVIEW_FAMILY_IDS: Readonly<Record<ExpandedProfileBand, readonly string[]>> = {
  warmup: ["relational-sequence-v1", "spatial-transform-v1"],
  composition: [
    "compositional-analogy-v1",
    "containment-analogy-v1",
    "interleaved-sequence-v1",
    "second-order-sequence-v1",
    "inverse-analogy-v1",
  ],
  "constraint-spatial": [
    "relational-matrix-v1",
    "visual-set-algebra-v1",
    "fold-punch-v1",
    "inverse-fold-punch-v1",
  ],
  "induction-transfer": ["rule-switching-v1", "transformation-machine-v2"],
};

const PREVIEW_FIXED_FAMILY_BY_SLOT: ReadonlyMap<number, string> = new Map([
  [0, "relational-sequence-v1"],
  [1, "spatial-transform-v1"],
  [2, "compositional-analogy-v1"],
  [9, "inverse-fold-punch-v1"],
  [10, "rule-switching-v1"],
  [11, "transformation-machine-v2"],
]);

/** Resolve a code-valid family into a preview band without changing its real promotion record. */
function codeValidFamilyForPreview(
  registry: FamilyPromotionRegistry,
  familyId: string,
  band: ExpandedProfileBand,
): EnabledFamilyBand {
  const family = registry.find((entry) => entry.familyId === familyId);
  const promotion = family?.bands.find((entry) =>
    entry.state !== "prototype" && entry.validatedDifficultyBuckets.length > 0);
  if (!family || !promotion) throw new Error(`${familyId} is not code-valid for the expanded preview`);
  return {
    familyId,
    primaryReasoningFamily: family.primaryReasoningFamily,
    band,
    difficultyBucket: promotion.validatedDifficultyBuckets[0],
    fallbackAvailable: promotion.fallbackAvailable,
  };
}

function chooseFamily(
  candidates: readonly EnabledFamilyBand[],
  counts: ReadonlyMap<string, number>,
  previousFamilyId: string | undefined,
  seed: Seed,
  slotIndex: number,
  requireFallback: boolean,
): EnabledFamilyBand {
  const eligible = candidates.filter((candidate) =>
    (!requireFallback || candidate.fallbackAvailable) &&
    (counts.get(candidate.familyId) ?? 0) < MAX_ITEMS_PER_FAMILY &&
    candidate.familyId !== previousFamilyId,
  );
  if (eligible.length === 0) {
    const fallbackRequirement = requireFallback ? " with a verified fallback" : "";
    throw new Error(`expanded quiz has no eligible non-repeating family${fallbackRequirement}`);
  }

  const leastUsed = Math.min(...eligible.map((candidate) => counts.get(candidate.familyId) ?? 0));
  const balanced = eligible.filter((candidate) => (counts.get(candidate.familyId) ?? 0) === leastUsed);
  return shuffled(seededRng(seed, `expanded-family-slot:${slotIndex}`), balanced)[0];
}

function runtimePuzzleId(seed: Seed, slotIndex: number, familyId: string): string {
  const normalizedSeed = String(seed).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 28) || "seed";
  return `expanded-${normalizedSeed}-${slotIndex + 1}-${familyId}`;
}

/**
 * Assemble the expanded profile only from fully promoted families.
 *
 * Candidate rejection never changes family frequency: a selected generator
 * must produce an accepted item or the whole assembly fails visibly.
 */
export function assembleExpandedQuiz(
  seed: Seed,
  registry: FamilyPromotionRegistry,
): PuzzleSet<Visual> {
  const pools = new Map(EXPANDED_PROFILE_BANDS.map((band) => [
    band,
    enabledFamiliesForBand(registry, band),
  ]));
  return assembleFromPools(seed, pools, true);
}

/**
 * Assemble a 12-question preview from code-valid scene families.
 *
 * This deliberately does not weaken `assembleExpandedQuiz`: callers must opt
 * into the preview, and the API exposes it only in development (or behind the
 * explicit prototype flag). These items are varied enough to inspect, but are
 * still waiting for human clarity and difficulty evidence.
 */
export function assembleExpandedPreviewQuiz(
  seed: Seed,
  registry: FamilyPromotionRegistry,
): PuzzleSet<Visual> {
  const pools = new Map(EXPANDED_PROFILE_BANDS.map((band) => [
    band,
    PREVIEW_FAMILY_IDS[band].map((familyId) => codeValidFamilyForPreview(registry, familyId, band)),
  ]));
  return assembleFromPools(seed, pools, false, PREVIEW_FIXED_FAMILY_BY_SLOT, 2);
}

function assembleFromPools(
  seed: Seed,
  pools: ReadonlyMap<ExpandedProfileBand, readonly EnabledFamilyBand[]>,
  requireFallback: boolean,
  fixedFamilyBySlot: ReadonlyMap<number, string> = new Map(),
  minimumVisibleStemPanels = 0,
): PuzzleSet<Visual> {
  if (String(seed).length === 0) throw new Error("seed must not be empty");
  const counts = new Map<string, number>();
  const schedule: EnabledFamilyBand[] = [];

  for (const [slotIndex, slot] of EXPANDED_QUIZ_SLOTS.entries()) {
    const fixedFamilyId = fixedFamilyBySlot.get(slotIndex);
    const reservedForLater = new Set([...fixedFamilyBySlot.entries()]
      .filter(([futureSlot]) => futureSlot > slotIndex)
      .map(([, familyId]) => familyId));
    const candidates = (pools.get(slot.band) ?? []).filter((candidate) =>
      fixedFamilyId === undefined
        ? !reservedForLater.has(candidate.familyId)
        : candidate.familyId === fixedFamilyId);
    const selected = chooseFamily(
      candidates,
      counts,
      schedule.at(-1)?.familyId,
      seed,
      slotIndex,
      requireFallback,
    );
    schedule.push(selected);
    counts.set(selected.familyId, (counts.get(selected.familyId) ?? 0) + 1);
  }

  if (new Set(schedule.map((selection) => selection.familyId)).size < MIN_DISTINCT_FAMILIES) {
    throw new Error(`expanded quiz needs at least ${MIN_DISTINCT_FAMILIES} distinct families`);
  }
  const puzzles: Puzzle<Scene>[] = [];
  for (const [slotIndex, selected] of schedule.entries()) {
    const slot = EXPANDED_QUIZ_SLOTS[slotIndex];
    const familyId = selected.familyId as SceneFamilyId;
    const generated = generateSceneFamilyCandidate(
      familyId,
      seededRng(seed, `expanded-scene-slot:${slotIndex}:${familyId}`),
    );
    const puzzle: Puzzle<Scene> = {
      ...generated.puzzle,
      id: runtimePuzzleId(seed, slotIndex, familyId),
      band: slot.band,
      generation: {
        generatorVersion: "scene-families-v2",
        familyId,
        programFingerprint: generated.definition.programFingerprint!(generated.puzzle),
        featureBucket: selected.difficultyBucket,
        features: {
          difficulty: generated.puzzle.difficulty,
          ruleComplexity: generated.puzzle.difficulty,
          programDepth: slot.band === "warmup" ? 1 : slot.band === "composition" ? 2 : 3,
          activeDimensions: [],
          usesWrap: false,
          distractorStrategy: "near-miss",
        },
      },
    };
    const accepted = validateSceneFamilyCandidate({ ...generated, puzzle });
    if (!accepted.accepted) {
      throw new Error(
        `${familyId} failed expanded assembly: ${accepted.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
    const visibleStemPanels = puzzle.stem.filter((panel) => !("blank" in panel)).length;
    if (visibleStemPanels < minimumVisibleStemPanels) {
      throw new Error(`${familyId} has ${visibleStemPanels} visible stem panels; preview needs at least ${minimumVisibleStemPanels}`);
    }
    puzzles.push(puzzle);
  }

  const programFingerprints = puzzles.map((puzzle) => puzzle.generation!.programFingerprint);
  if (new Set(programFingerprints).size !== programFingerprints.length) {
    throw new Error("expanded quiz contains a duplicate hidden program");
  }
  const visibleFingerprints = puzzles.map((puzzle) => createHash("sha256").update(JSON.stringify({
    type: puzzle.type,
    layout: puzzle.layout,
    stem: puzzle.stem,
    options: puzzle.options,
  })).digest("hex"));
  if (new Set(visibleFingerprints).size !== visibleFingerprints.length) {
    throw new Error("expanded quiz contains duplicate visible puzzles");
  }
  return VisualPuzzleSetSchema.parse(puzzles) as PuzzleSet<Visual>;
}
