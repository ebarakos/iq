import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import { OPTIONS_PER_ITEM, VisualPuzzleSchema, sceneSignature, type SceneToken } from "./schema";
import { puzzleToSvg } from "./compose-image";
import {
  SCENE_FAMILY_IDS,
  generateSceneFamilyCandidate,
  validateSceneFamilyCandidate,
} from "./scene-families";

describe("scene family prototypes", () => {
  it("generates deterministic schema-valid candidates", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const first = generateSceneFamilyCandidate(familyId, seededRng(`scene:${familyId}:${seed}`));
        const replay = generateSceneFamilyCandidate(familyId, seededRng(`scene:${familyId}:${seed}`));
        expect(first.puzzle).toEqual(replay.puzzle);
        expect(first.definition.replayKey?.(first.puzzle)).toBe(replay.definition.replayKey?.(replay.puzzle));
        expect(VisualPuzzleSchema.safeParse(first.puzzle).success, familyId).toBe(true);
      }
    }
  });

  it("accepts each prototype through the shared correctness contract", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const candidate = generateSceneFamilyCandidate(familyId, seededRng(`accept:${familyId}:${seed}`));
        const first = validateSceneFamilyCandidate(candidate);
        expect(first.accepted, `${familyId} seed ${seed}: ${first.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
        const replayKey = candidate.definition.replayKey?.(candidate.puzzle);
        expect(replayKey).toBeTruthy();
        expect(validateSceneFamilyCandidate(candidate, replayKey).accepted).toBe(true);
      }
    }
  });

  it("offers the configured number of options in every family", () => {
    // The option count lives in one constant. This is the check that it really
    // governs the whole battery: a family that quietly keeps its own count would
    // hand repeat takers an easier guess on some questions and not others.
    for (const familyId of SCENE_FAMILY_IDS) {
      for (let seed = 0; seed < 10; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`count:${familyId}:${seed}`));
        expect(puzzle.options.length, `${familyId} seed ${seed}`).toBe(OPTIONS_PER_ITEM);
      }
    }
  });

  it("never asks a relational outlier to be judged on token size", () => {
    // Medium versus large is the one difference this project refuses to call
    // visible (isInstantlyDistinct in domains.ts). A size relation would turn
    // this family into an eyesight test, so both tokens in every option must
    // always share a size and no size relation may be sampled.
    for (let seed = 0; seed < 200; seed++) {
      const { puzzle } = generateSceneFamilyCandidate(
        "relational-outlier-v2",
        seededRng(`outlier-size:${seed}`),
      );
      for (const option of puzzle.options) {
        const sizes = new Set(option.objects.map((placement) => (placement.object as SceneToken).size));
        expect(sizes.size, `seed ${seed}`).toBe(1);
      }
    }
  });

  it("keeps every option visually unique", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`unique:${familyId}`));
      expect(new Set(puzzle.options.map(sceneSignature)).size).toBe(puzzle.options.length);
    }
  });

  it("provides rich final-review explanations for every family", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`explanation:${familyId}`));
      const sentenceCount = puzzle.explanation.match(/[.!?](?:\s|$)/g)?.length ?? 0;
      expect(puzzle.explanation.length, familyId).toBeGreaterThanOrEqual(180);
      expect(sentenceCount, familyId).toBeGreaterThanOrEqual(3);
    }
  });

  it("re-solves visible evidence instead of trusting captured generator state", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const candidate = generateSceneFamilyCandidate(familyId, seededRng(`tamper:${familyId}`));
      const tampered = structuredClone(candidate.puzzle);
      const wrongIndex = tampered.options.findIndex((_, index) => index !== tampered.answerIndex);
      const visibleIndexes = tampered.stem.flatMap((panel, panelIndex) => "blank" in panel ? [] : [panelIndex]);
      if (familyId === "rule-switching-v2") {
        tampered.stem[5] = tampered.stem[3];
      } else if (tampered.layout === "conceptGroups") {
        tampered.stem[0] = tampered.options[wrongIndex];
      } else if (visibleIndexes.length >= 2) {
        tampered.stem[visibleIndexes[1]] = tampered.stem[visibleIndexes[0]];
      } else if (visibleIndexes.length === 1) {
        tampered.stem[visibleIndexes[0]] = tampered.options[tampered.answerIndex];
      } else {
        tampered.options[tampered.answerIndex] = tampered.options[wrongIndex];
      }

      const result = validateSceneFamilyCandidate({ ...candidate, puzzle: tampered });
      expect(result.accepted, `${familyId} accepted changed visible evidence`).toBe(false);
    }
  });

  it("renders every prototype through the same standalone image path used by agents", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`render:${familyId}`));
      const svg = puzzleToSvg(puzzle);
      expect(svg).toContain("<svg");
      expect(svg).toContain("data-scene-");
    }
  });

  it("samples all bounded concept relations and spatial transform classes", () => {
    const conceptExplanations = new Set<string>();
    const spatialClasses = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const concept = generateSceneFamilyCandidate("concept-induction-v2", seededRng(`concept-variety:${seed}`));
      conceptExplanations.add(concept.puzzle.explanation);
      expect(validateSceneFamilyCandidate(concept).accepted).toBe(true);

      const spatial = generateSceneFamilyCandidate("spatial-transform-v2", seededRng(`spatial-variety:${seed}`));
      spatialClasses.add(
        spatial.puzzle.explanation.includes("rotates")
          ? "rotation"
          : spatial.puzzle.explanation.includes("reflects")
            ? "reflection"
            : "translation",
      );
      expect(validateSceneFamilyCandidate(spatial).accepted).toBe(true);
    }
    expect(conceptExplanations.size).toBe(8);
    expect(spatialClasses).toEqual(new Set(["rotation", "reflection", "translation"]));
  });

  it("makes every minimal-repair fingerprint a distinct visible repair pattern", () => {
    const mechanismByFingerprint = new Map<string, string>();
    for (let seed = 0; seed < 200; seed++) {
      const candidate = generateSceneFamilyCandidate(
        "minimal-repair-v3",
        seededRng("scene-family-verify-v1", `minimal-repair-v3:${seed}`),
      );
      const { puzzle } = candidate;
      const faulty = puzzle.stem[0];
      const answer = puzzle.options[puzzle.answerIndex];
      if ("blank" in faulty) throw new Error("minimal repair needs a visible faulty board");
      const faultyByPosition = new Map(faulty.objects.map((placement) => [
        `${placement.row}:${placement.column}`,
        placement.object,
      ]));
      const changed = answer.objects.filter((placement) =>
        JSON.stringify(placement.object) !== JSON.stringify(faultyByPosition.get(`${placement.row}:${placement.column}`)));
      expect(changed).toHaveLength(1);
      const before = faultyByPosition.get(`${changed[0].row}:${changed[0].column}`);
      const after = changed[0].object;
      if (!before || before.kind !== "token" || after.kind !== "token") {
        throw new Error("minimal repair must change one token");
      }
      const projection = before.shape !== after.shape ? "shape" : "fill";
      expect(projection === "shape" ? before.fill : before.shape)
        .toBe(projection === "shape" ? after.fill : after.shape);
      const labels = new Map<string, number>();
      const pattern = [...answer.objects]
        .sort((left, right) => left.row - right.row || left.column - right.column)
        .map((placement) => {
          if (placement.object.kind !== "token") throw new Error("minimal repair boards must contain only tokens");
          const value = placement.object[projection];
          if (!labels.has(value)) labels.set(value, labels.size);
          return labels.get(value);
        })
        .join("");
      const fingerprint = candidate.definition.programFingerprint?.(puzzle);
      expect(fingerprint).toBeTruthy();
      const mechanism = `${projection}:${pattern}`;
      expect(mechanismByFingerprint.get(fingerprint!) ?? mechanism).toBe(mechanism);
      mechanismByFingerprint.set(fingerprint!, mechanism);
    }
    expect(mechanismByFingerprint.size).toBe(8);
    expect(new Set(mechanismByFingerprint.values()).size).toBe(8);
  });

  it("makes every machine, switching, and composition fingerprint change the query answer", () => {
    const families = [
      { familyId: "transformation-machine-v3", queryIndex: 9, expectedPrograms: 8 },
      { familyId: "rule-switching-v2", queryIndex: 6, expectedPrograms: 8 },
      { familyId: "composed-transform-v1", queryIndex: 6, expectedPrograms: 16 },
    ] as const;
    for (const { familyId, queryIndex, expectedPrograms } of families) {
      const effectByFingerprint = new Map<string, string>();
      for (let seed = 0; seed < 200; seed++) {
        const candidate = generateSceneFamilyCandidate(
          familyId,
          seededRng("scene-family-verify-v1", `${familyId}:${seed}`),
        );
        const query = candidate.puzzle.stem[queryIndex];
        if ("blank" in query) throw new Error(`${familyId} needs a visible query`);
        const sourceLabels = new Map([...query.objects]
          .sort((left, right) => left.row - right.row || left.column - right.column)
          .flatMap((placement, index) => placement.object.kind === "token"
            ? [[placement.object.shape, String.fromCharCode(65 + index)] as const]
            : []));
        const answer = candidate.puzzle.options[candidate.puzzle.answerIndex];
        const effect = [...answer.objects]
          .sort((left, right) => left.row - right.row || left.column - right.column)
          .map((placement) => placement.object.kind === "token"
            ? `${sourceLabels.get(placement.object.shape)}:${placement.row}:${placement.column}:${placement.object.fill}`
            : "container")
          .join("|");
        const fingerprint = candidate.definition.programFingerprint?.(candidate.puzzle);
        expect(fingerprint).toBeTruthy();
        expect(effectByFingerprint.get(fingerprint!) ?? effect).toBe(effect);
        effectByFingerprint.set(fingerprint!, effect);
      }
      expect(effectByFingerprint.size, familyId).toBe(expectedPrograms);
      expect(new Set(effectByFingerprint.values()).size, familyId).toBe(expectedPrograms);
    }
  });
});
