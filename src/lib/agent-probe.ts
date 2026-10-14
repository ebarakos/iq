import {
  EXPANDED_PROFILE_BANDS,
  type FamilyPromotionRegistry,
} from "@/items/family-promotion";
import { eligibleFamiliesForBand } from "@/items/expanded-quiz";
import { requireSceneFamilyBucket, type SceneFamilyId } from "@/items/scene-families";
import type { GenerationMetadata, Puzzle } from "@/items/schema";

/**
 * Observations per family required by the standard probe.
 *
 * Raised from two to five on 2026-08-23. At two, a family reading "50%" had
 * missed one item, which is indistinguishable from noise — the first v7 probe
 * produced six such families and none of them supported a conclusion. Five is
 * the smallest count where a single miss (80%) and a real weakness (40%) look
 * different. It is still far too small for a confidence interval; it is enough
 * to decide which families are worth a longer look.
 */
export const STANDARD_PROBE_MINIMUM = 5;

export interface ProbeCoverageRequirements {
  families: readonly string[];
  programComplexities: readonly string[];
  /**
   * Every served `family:band:bucket`. A family can sit in two bands, and a band
   * can serve two of its buckets, so family coverage alone can leave one unseen.
   */
  keys: readonly string[];
  minimum: number;
}

export interface ProbeCoverageReport {
  missingFamilies: { key: string; have: number; need: number }[];
  missingProgramComplexities: { key: string; have: number; need: number }[];
  missingKeys: { key: string; have: number; need: number }[];
}

/** The served unit a probe reports on: `family:band:bucket`, as the assembler schedules it. */
export function probeKey(item: Puzzle): string | undefined {
  const family = item.generation?.familyId ?? item.familyId;
  const bucket = item.generation?.featureBucket;
  return family && item.band && bucket ? `${family}:${item.band}:${bucket}` : undefined;
}

/** Stable stratum used to keep shallow and deep generated programs represented. */
export function programComplexityBucket(generation: GenerationMetadata): string {
  return `complexity-${generation.features.ruleComplexity}-depth-${generation.features.programDepth}`;
}

export function standardProbeRequirements(
  registry: FamilyPromotionRegistry,
  withdrawnFamilyIds: ReadonlySet<string>,
  minimum = STANDARD_PROBE_MINIMUM,
): ProbeCoverageRequirements {
  const families = new Set<string>();
  const programComplexities = new Set<string>();
  const keys = new Set<string>();

  for (const band of EXPANDED_PROFILE_BANDS) {
    for (const family of eligibleFamiliesForBand(registry, band, withdrawnFamilyIds)) {
      families.add(family.familyId);
      // Depth belongs to the family's bucket, not to the band it sits in: a
      // three-gate composition and a one-transform analogy are both
      // "composition" but are not the same program to run.
      for (const { bucket: served, difficulty } of family.bandBuckets) {
        const bucket = requireSceneFamilyBucket(family.familyId as SceneFamilyId, served);
        programComplexities.add(`complexity-${difficulty}-depth-${bucket.programDepth}`);
        keys.add(`${family.familyId}:${band}:${served}`);
      }
    }
  }

  return {
    families: [...families].sort(),
    programComplexities: [...programComplexities].sort(),
    keys: [...keys].sort(),
    minimum,
  };
}

function counts(items: readonly Puzzle[], keyOf: (item: Puzzle) => string | undefined) {
  const result = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key) result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

export function probeCoverage(
  items: readonly Puzzle[],
  requirements: ProbeCoverageRequirements,
): ProbeCoverageReport {
  const familyCounts = counts(items, (item) => item.generation?.familyId ?? item.familyId);
  const complexityCounts = counts(items, (item) =>
    item.generation ? programComplexityBucket(item.generation) : undefined);
  const keyCounts = counts(items, probeKey);
  const missing = (keys: readonly string[], actual: ReadonlyMap<string, number>) => keys.flatMap((key) => {
    const have = actual.get(key) ?? 0;
    return have >= requirements.minimum ? [] : [{ key, have, need: requirements.minimum }];
  });

  return {
    missingFamilies: missing(requirements.families, familyCounts),
    missingProgramComplexities: missing(requirements.programComplexities, complexityCounts),
    missingKeys: missing(requirements.keys, keyCounts),
  };
}

export function coverageComplete(report: ProbeCoverageReport): boolean {
  return report.missingFamilies.length === 0 && report.missingProgramComplexities.length === 0 &&
    report.missingKeys.length === 0;
}

/**
 * Greedily keep only items that pay down a family, program-stratum or key deficit.
 * Input order is seeded by the generated tests, so the same run seed replays.
 */
export function selectCoverageItems(
  pool: readonly Puzzle[],
  requirements: ProbeCoverageRequirements,
): Puzzle[] {
  const selected: Puzzle[] = [];
  const familyCounts = new Map<string, number>();
  const complexityCounts = new Map<string, number>();
  const keyCounts = new Map<string, number>();

  for (const item of pool) {
    const family = item.generation?.familyId ?? item.familyId;
    const complexity = item.generation ? programComplexityBucket(item.generation) : undefined;
    const needsFamily = family !== undefined &&
      requirements.families.includes(family) &&
      (familyCounts.get(family) ?? 0) < requirements.minimum;
    const needsComplexity = complexity !== undefined &&
      requirements.programComplexities.includes(complexity) &&
      (complexityCounts.get(complexity) ?? 0) < requirements.minimum;
    const key = probeKey(item);
    const needsKey = key !== undefined &&
      requirements.keys.includes(key) &&
      (keyCounts.get(key) ?? 0) < requirements.minimum;
    if (!needsFamily && !needsComplexity && !needsKey) continue;

    selected.push(item);
    if (family) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    if (complexity) complexityCounts.set(complexity, (complexityCounts.get(complexity) ?? 0) + 1);
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  return selected;
}

export function formatMissingCoverage(report: ProbeCoverageReport): string {
  const lines = ["generated probe is missing required coverage:"];
  if (report.missingFamilies.length > 0) {
    lines.push("  families:");
    for (const row of report.missingFamilies) lines.push(`    ${row.key}: ${row.have}/${row.need}`);
  }
  if (report.missingProgramComplexities.length > 0) {
    lines.push("  program-complexity buckets:");
    for (const row of report.missingProgramComplexities) lines.push(`    ${row.key}: ${row.have}/${row.need}`);
  }
  if (report.missingKeys.length > 0) {
    lines.push("  family:band:bucket keys:");
    for (const row of report.missingKeys) lines.push(`    ${row.key}: ${row.have}/${row.need}`);
  }
  return lines.join("\n");
}
