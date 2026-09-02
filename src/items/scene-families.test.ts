import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seededRng } from "../lib/rng";
import {
  OPTIONS_PER_ITEM,
  VisualPuzzleSchema,
  sceneSignature,
  type Scene,
  type SceneToken,
} from "./schema";
import { puzzleToSvg } from "./compose-image";
import {
  CELL_VIEWBOX,
  CellGraphic,
  NARROW_VIEWPORT_STEM_WIDTH,
  SceneGraphic,
  StemView,
  WIDE_GATE_GLYPH_WIDTH,
  gateGlyphs,
  gateStripWidth,
} from "./render";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { sceneEditDistance } from "./scene-distance";
import { createHash } from "node:crypto";
import {
  declaredGateCounts,
  MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND,
  PARALLEL_EVOLUTION_GRAMMAR,
  SCENE_FAMILY_BUCKETS,
  SCENE_FAMILY_IDS,
  canonicalComposedTransformQuery,
  canonicalTransformationMachineQuery,
  checkAnsweredStrand,
  composedTransformGrammar,
  entrySceneFamilyBucket,
  generateHeldOutComposedTransformCandidate,
  generateSceneFamilyCandidate,
  partitionComposedTransformPrograms,
  requireSceneFamilyBucket,
  resetWidenedDistractorSelections,
  servableComposedTransformPrograms,
  servableTransformationMachinePrograms,
  transformationMachineGates,
  transformationMachineGrammar,
  widenedDistractorSelections,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import {
  applySceneBinary,
  applySceneComposedProgram,
  applySceneCompositionPrimitive,
  applySceneUnary,
  sceneComposedPrimitives,
  sceneComposedProgramKey,
  sceneComposedProgramSteps,
  type SceneComposedProgram,
} from "./scene-grammar";

/**
 * Every (family, declared bucket) pair the generator supports.
 *
 * The sweeps below run over this rather than over family ids: a deeper bucket
 * is a different generator path, and a family whose d5 draws break its own
 * contract must fail here, not in a taker's test.
 */
const FAMILY_BUCKETS = SCENE_FAMILY_IDS.flatMap((familyId) =>
  SCENE_FAMILY_BUCKETS[familyId].map((declared) => ({ familyId, bucket: declared.bucket })));

/** One transformation-machine program, as the grammar hands it out. */
type MachineProgramForTest = ReturnType<typeof transformationMachineGrammar>[number];

/** The easiest bucket a family declares — for checks that are not about depth. */
const entryBucket = (familyId: (typeof SCENE_FAMILY_IDS)[number]) =>
  entrySceneFamilyBucket(familyId).bucket;

describe("scene family prototypes", () => {
  it("draws every near miss from the nearest window, never from a widened one", () => {
    // The owner chose a tight distractor window: the five slots are filled from
    // the closest `slots + 2` candidates. `selectDistractors` may widen that
    // window, but ONLY when the closest few are not categorically distinct from
    // each other, because legibility is the hard floor and a family that cannot
    // fill its slots legibly would otherwise fail to generate at all.
    //
    // This pins the property that matters: across every declared bucket, the
    // widening branch is never actually taken, so what ships is exactly the
    // tight window. If a future family makes this fail, the near misses it
    // serves are further from the answer than the design promises — decide
    // deliberately, do not just raise the number.
    resetWidenedDistractorSelections();
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      for (let seed = 0; seed < 40; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          familyId, seededRng(`window:${familyId}:${bucket}:${seed}`), bucket);
        const options = puzzle.options.filter((option): option is Scene => !("blank" in option));
        const answer = options[puzzle.answerIndex];
        if (!answer) continue;
        // A near miss must at least be measurable against the answer: an
        // incomparable one (different board dimensions) could not have been
        // ranked by closeness at all.
        for (const [index, near] of options.entries()) {
          if (index === puzzle.answerIndex) continue;
          expect(sceneEditDistance(answer, near), `${familyId}:${bucket}:${seed}`).not.toBe("incomparable");
        }
      }
    }
    expect(widenedDistractorSelections()).toBe(0);
  });

  it("generates deterministic schema-valid candidates", () => {
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      for (let seed = 0; seed < 10; seed++) {
        const stream = `scene:${familyId}:${bucket}:${seed}`;
        const first = generateSceneFamilyCandidate(familyId, seededRng(stream), bucket);
        const replay = generateSceneFamilyCandidate(familyId, seededRng(stream), bucket);
        expect(first.puzzle).toEqual(replay.puzzle);
        expect(first.definition.replayKey?.(first.puzzle)).toBe(replay.definition.replayKey?.(replay.puzzle));
        expect(VisualPuzzleSchema.safeParse(first.puzzle).success, `${familyId} ${bucket}`).toBe(true);
        // The bucket is a promise about what comes out, not a label pinned on
        // whatever came out.
        expect(first.puzzle.difficulty, `${familyId} ${bucket}`)
          .toBe(requireSceneFamilyBucket(familyId, bucket).difficulty);
      }
    }
  });

  it("accepts each prototype through the shared correctness contract", () => {
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      for (let seed = 0; seed < 10; seed++) {
        const candidate = generateSceneFamilyCandidate(familyId, seededRng(`accept:${familyId}:${bucket}:${seed}`), bucket);
        const first = validateSceneFamilyCandidate(candidate);
        expect(first.accepted, `${familyId} ${bucket} seed ${seed}: ${first.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
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
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      for (let seed = 0; seed < 10; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`count:${familyId}:${bucket}:${seed}`), bucket);
        expect(puzzle.options.length, `${familyId} ${bucket} seed ${seed}`).toBe(OPTIONS_PER_ITEM);
      }
    }
  });

  it("keeps every option visually unique", () => {
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`unique:${familyId}:${bucket}`), bucket);
      expect(new Set(puzzle.options.map(sceneSignature)).size).toBe(puzzle.options.length);
    }
  });

  it("provides rich final-review explanations for every family", () => {
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`explanation:${familyId}:${bucket}`), bucket);
      const sentenceCount = puzzle.explanation.match(/[.!?](?:\s|$)/g)?.length ?? 0;
      expect(puzzle.explanation.length, `${familyId} ${bucket}`).toBeGreaterThanOrEqual(180);
      expect(sentenceCount, `${familyId} ${bucket}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("re-solves visible evidence instead of trusting captured generator state", () => {
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      const candidate = generateSceneFamilyCandidate(familyId, seededRng(`tamper:${familyId}:${bucket}`), bucket);
      const tampered = structuredClone(candidate.puzzle);
      const wrongIndex = tampered.options.findIndex((_, index) => index !== tampered.answerIndex);
      const visibleIndexes = tampered.stem.flatMap((panel, panelIndex) => "blank" in panel ? [] : [panelIndex]);
      if (familyId === "rule-switching-v2") {
        tampered.stem[5] = tampered.stem[3];
      } else if (visibleIndexes.length >= 2) {
        tampered.stem[visibleIndexes[1]] = tampered.stem[visibleIndexes[0]];
      } else if (visibleIndexes.length === 1) {
        tampered.stem[visibleIndexes[0]] = tampered.options[tampered.answerIndex];
      } else {
        tampered.options[tampered.answerIndex] = tampered.options[wrongIndex];
      }

      const result = validateSceneFamilyCandidate({ ...candidate, puzzle: tampered });
      expect(result.accepted, `${familyId} ${bucket} accepted changed visible evidence`).toBe(false);
    }
  });

  it("renders every prototype through the same standalone image path used by agents", () => {
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`render:${familyId}:${bucket}`), bucket);
      const svg = puzzleToSvg(puzzle);
      expect(svg).toContain("<svg");
      expect(svg).toContain("data-scene-");
    }
  });

  it("samples every spatial transform class", () => {
    // The concept-induction half of this test went with that family on
    // 2026-08-27; the spatial half is unchanged.
    const spatialClasses = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const spatial = generateSceneFamilyCandidate(
        "spatial-transform-v2",
        seededRng(`spatial-variety:${seed}`),
        entryBucket("spatial-transform-v2"),
      );
      spatialClasses.add(
        spatial.puzzle.explanation.includes("turns each one")
          ? "token-turn"
          : spatial.puzzle.explanation.includes("rotates")
            ? "board-rotation"
            : spatial.puzzle.explanation.includes("reflects")
              ? "reflection"
              : "translation",
      );
      expect(validateSceneFamilyCandidate(spatial).accepted).toBe(true);
    }
    // Turning the board and turning the tokens are separate classes since
    // 2026-08-25; lumping them together is exactly the confusion this family
    // now exists to test.
    expect(spatialClasses).toEqual(new Set(["board-rotation", "token-turn", "reflection", "translation"]));
  });

  it("makes every machine, switching, and composition fingerprint change the query answer", () => {
    // composed-transform-v2's intermediate two-step space has 16 programs, and
    // distinct programs may legitimately land on
    // the same query answer — the worked rows, not the answer alone, identify
    // the program. So for it the gate is breadth (minimumPrograms) plus
    // fingerprint-to-answer consistency, not answer injectivity.
    const families = [
      { familyId: "transformation-machine-v3", queryIndex: 9, expectedPrograms: 8, injectiveEffects: true },
      { familyId: "rule-switching-v2", queryIndex: 6, expectedPrograms: 8, injectiveEffects: true },
      { familyId: "composed-transform-v2", queryIndex: 6, expectedPrograms: 16, injectiveEffects: false },
    ] as const;
    for (const family of families) {
      const { familyId, queryIndex } = family;
      const effectByFingerprint = new Map<string, string>();
      for (let seed = 0; seed < 200; seed++) {
        const candidate = generateSceneFamilyCandidate(
          familyId,
          seededRng("scene-family-verify-v1", `${familyId}:${seed}`),
          entryBucket(familyId),
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
      expect(effectByFingerprint.size, familyId).toBe(family.expectedPrograms);
      if (family.injectiveEffects) {
        expect(new Set(effectByFingerprint.values()).size, familyId).toBe(effectByFingerprint.size);
      }
    }
  });

  it("declares every bucket easiest first and refuses one it has not declared", () => {
    for (const familyId of SCENE_FAMILY_IDS) {
      const declared = SCENE_FAMILY_BUCKETS[familyId];
      expect(declared.length, familyId).toBeGreaterThan(0);
      // The assembler hands a family's i-th occurrence in a band its i-th
      // bucket, so the order in this table IS the ramp.
      const difficulties = declared.map((bucket) => bucket.difficulty);
      expect([...difficulties].sort((a, b) => a - b), familyId).toEqual(difficulties);
      for (const bucket of declared) {
        // The name carries the difficulty; a bucket whose name and declared
        // difficulty disagree would fail the assembler on every draw.
        expect(Number(/-d([1-6])$/.exec(bucket.bucket)![1]), bucket.bucket).toBe(bucket.difficulty);
        expect(bucket.programDepth, bucket.bucket).toBeGreaterThanOrEqual(1);
      }
      expect(() => generateSceneFamilyCandidate(familyId, seededRng(`undeclared:${familyId}`), "not-a-bucket-d1"))
        .toThrow(/does not declare difficulty bucket/);
    }
  });

  it("keeps compositional-analogy d3 and visual-set-algebra d4 replaying byte for byte", () => {
    //
    // REISSUED 2026-08-27. Every value below moved that day, deliberately and
    // across all families at once: distractor selection now has to make the
    // wrong options AGREE with the answer on each aspect a solver can infer
    // alone (footprint, shapes, fills, rotations, count), because the owner
    // reported that one inference was often enough to pick the answer without
    // reading the other rules. Different distractors mean different items. This
    // is the "deliberate decision to reissue" these goldens exist to force.
    // These two buckets are released populations. Their families each grew a
    // deeper bucket on 2026-08-25 — a token turn on top of what they already
    // did — and the shallower bucket had to come through untouched. A stray
    // edit to the shared board builders, grammars, or wording breaks this test
    // rather than quietly reshuffling items people have already answered.
    // compositional-analogy's keys still date from before that change.
    // visual-set-algebra's were re-taken on 2026-08-27 for the reason noted on
    // them: that family was rebuilt on purpose, and this test is what proved
    // the rebuild touched nothing else.
    const goldens: Record<string, { familyId: SceneFamilyId; bucket: string; keys: string[] }> = {
      "compositional-analogy-d3-golden": {
        familyId: "compositional-analogy-v2",
        bucket: "compositional-analogy-d3",
        keys: [
          "2a10b9396162915d454a0e2a",
          "3e0998bc460d62258121eb8c",
          "d0405b37c383b674c6523123",
          "8f50c86f94442275287ebdee",
          "3435ca628e113698a628895d",
          "5600e9d9d0166055c3ccae06",
          "e68a56948c849e8638232cf0",
          "b7a7d4e81c7581880b667054",
        ],
      },
      "visual-set-algebra-d4-golden": {
        familyId: "visual-set-algebra-v2",
        bucket: "visual-set-algebra-d4",
        // Re-taken twice on 2026-08-27, both times because the family was
        // deliberately changed and this population had to move with it.
        //
        // First the inputs: the old keys pinned a family whose two input boards
        // were a fixed diagonal of two tokens that could never disagree, the new
        // ones pin boards of three tokens built from four roles including a
        // clash. Then the draw: `-d4` now redraws its inputs until the near-miss
        // pool can cover every aspect a solver can infer alone, because without
        // that the answer was the only board in its cells in 45% of items. Four
        // of the eight keys moved on the second re-take; the four that did not
        // are draws that already covered.
        //
        // Anyone who sees this list change again without that kind of note in
        // the commit should treat it as an accident.
        keys: [
          "ab522ae20ba58ed4e27c9afa",
          "e7d55a391369d4f79526ff9d",
          "df085be2c6b543fd505b0fae",
          "2197f0e243e592a55be5327d",
          "002f0fd5a305522d85df8a8d",
          "9b4f9f72ba523944fc16f381",
          "b77b4b823266d00f0a753ae4",
          "d6d573c72b5d39a0e1987d9b",
        ],
      },
    };
    for (const [stream, { familyId, bucket, keys }] of Object.entries(goldens)) {
      expect(keys.map((_, seed) => {
        const candidate = generateSceneFamilyCandidate(familyId, seededRng(stream, `${seed}`), bucket);
        return candidate.definition.replayKey!(candidate.puzzle);
      }), stream).toEqual(keys);
    }
  });

  it("never lets one inference pick the answer, in the families built on several rules", () => {
    // The owner's report of 2026-08-27: "the answers are so different from each
    // other, and using only one first inference you can select the right answer
    // without looking at the other rules." Measured, every item in four buckets
    // was solvable from the answer's footprint alone.
    //
    // The property this pins: for each aspect a solver can infer on its own, at
    // least one WRONG option must share the answer's value of it, so knowing
    // that aspect never narrows six options to one.
    //
    // It is asserted only for families whose program really has several
    // independent parts. `second-order-sequence` is excluded on purpose and
    // not as a concession: every option is the same token at a different place,
    // so a wrong option sharing the answer's footprint would be the answer. A
    // family whose whole rule lands in one aspect is correct, not broken. The
    // way to tell the two apart is whether the option set varies in more than
    // one aspect at all — these three do not.
    //
    // The list below grew on 2026-08-27 by the four buckets that DID vary in
    // several aspects and still let one of them decide: `relational-matrix-d4`
    // (88% of items), `spatial-transform-d2` (64%), `rule-switching-d2` (48%)
    // and `visual-set-algebra-d4` (45%). Each was fixed at the source of its
    // near misses rather than by loosening anything here.
    const ms = (values: string[]) => [...values].sort().join("|");
    const aspects: Record<string, (scene: Scene) => string> = {
      positions: (scene) => ms(scene.objects.map((p) => `${p.row},${p.column}`)),
      shapes: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? p.object.shape : "-")),
      fills: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? p.object.fill : "-")),
      rotations: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? String(p.object.rotation) : "-")),
      count: (scene) => String(scene.objects.length),
    };
    const MULTI_RULE: readonly { familyId: SceneFamilyId; bucket: string }[] = [
      { familyId: "composed-transform-v2", bucket: "composed-transform-d4" },
      { familyId: "composed-transform-v2", bucket: "composed-transform-d5" },
      { familyId: "transformation-machine-v3", bucket: "transformation-machine-d5" },
      { familyId: "compositional-analogy-v2", bucket: "compositional-analogy-d3" },
      { familyId: "compositional-analogy-v2", bucket: "compositional-analogy-d4" },
      { familyId: "visual-set-algebra-v2", bucket: "visual-set-algebra-d5" },
      { familyId: "visual-set-algebra-v2", bucket: "visual-set-algebra-d4" },
      { familyId: "inverse-analogy-v2", bucket: "inverse-analogy-d4" },
      { familyId: "parallel-evolution-v1", bucket: "parallel-evolution-d3" },
      { familyId: "parallel-evolution-v1", bucket: "parallel-evolution-d4" },
      { familyId: "relational-matrix-v2", bucket: "relational-matrix-d4" },
      { familyId: "spatial-transform-v2", bucket: "spatial-transform-d2" },
      { familyId: "rule-switching-v2", bucket: "rule-switching-d2" },
    ];
    for (const { familyId, bucket } of MULTI_RULE) {
      for (let seed = 0; seed < 40; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          familyId, seededRng("single-inference", `${bucket}:${seed}`), bucket);
        const answer = puzzle.options[puzzle.answerIndex];
        for (const [name, read] of Object.entries(aspects)) {
          const target = read(answer);
          const sharing = puzzle.options.filter((option) => read(option) === target).length;
          expect(sharing, `${bucket} seed ${seed}: ${name} alone isolates the answer`)
            .toBeGreaterThan(1);
        }
      }
    }
  });

  it("never displays more than three gates, in any bucket the battery can serve", () => {
    // The owner's standing rule of 2026-08-27: a fourth gate is more procedure,
    // not more reasoning. It cost two buckets that day (`composed-transform-d6`
    // at five gates, `transformation-machine-d6` at four) and reshaped a third
    // (`composed-transform-d5`, from four gates forward to three in varied order).
    // Both withdrawn generators still exist in the code for a possible rework,
    // so the rule is checked where it can actually be broken: any bucket a band
    // is allowed to draw.
    const declared = declaredGateCounts();
    const drawable = new Set(
      CURRENT_FAMILY_PROMOTION_REGISTRY.flatMap((entry) =>
        entry.bands.flatMap((band) => band.validatedDifficultyBuckets)));
    const overCap = Object.entries(declared)
      .filter(([bucket, gates]) => drawable.has(bucket) && gates > 3);
    expect(overCap).toEqual([]);
    // The two that were withdrawn are still declared, still over the cap, and
    // still unreachable — which is exactly the state this test has to allow.
    expect(declared["composed-transform-d6"]).toBe(5);
    expect(declared["transformation-machine-d6"]).toBe(4);
    expect(drawable.has("composed-transform-d6")).toBe(false);
    expect(drawable.has("transformation-machine-d6")).toBe(false);
    // Guard the guard: a typo in the table names would make the filter vacuous.
    expect(Object.keys(declared).filter((bucket) => drawable.has(bucket)).sort())
      .toEqual(["composed-transform-d4", "composed-transform-d5", "transformation-machine-d5"]);
  });

  it("builds set-algebra rows that separate all eight combining rules", () => {
    // The owner called this family's items "too easy/toy" on 2026-08-27 and
    // asked for it to be expanded a lot. The fix was not more rules on top of
    // the old boards — it was the boards. They used to be a fixed diagonal of
    // two tokens whose shared slot always held the SAME token, so a clash could
    // never happen and the eight operations collapsed to four outputs of at
    // most two tokens each. Every row now carries all four roles, which is what
    // makes the eight genuinely different questions.
    const OPERATIONS = [
      "union-left", "union-right", "intersection", "overlap-left",
      "overlap-right", "subtract", "mask-out", "exclusive",
    ] as const;
    for (const bucket of ["visual-set-algebra-d4", "visual-set-algebra-d5"] as const) {
      let rowsChecked = 0;
      for (let seed = 0; seed < 60; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          "visual-set-algebra-v2", seededRng("set-algebra-roles", `${bucket}:${seed}`), bucket);
        // Stem layout is (left, right, output) x 2 worked rows, then the query
        // pair and the blank.
        const scenes = puzzle.stem.filter((panel): panel is Scene =>
          typeof panel === "object" && panel !== null && "objects" in panel);
        for (const [left, right] of [[scenes[0], scenes[1]], [scenes[3], scenes[4]], [scenes[6], scenes[7]]]) {
          if (!left || !right) continue;
          rowsChecked += 1;
          // Three tokens a board — the same density the machine families ship,
          // so this is depth, not clutter.
          expect(left.objects, `${bucket} seed ${seed}`).toHaveLength(3);
          expect(right.objects, `${bucket} seed ${seed}`).toHaveLength(3);
          // Exactly one position holds different tokens on the two boards. That
          // clash is the thing the old skeleton could not produce.
          const leftAt = new Map(left.objects.map((placement) =>
            [`${placement.row},${placement.column}`, JSON.stringify(placement.object)]));
          const clashes = right.objects.filter((placement) => {
            const key = `${placement.row},${placement.column}`;
            return leftAt.has(key) && leftAt.get(key) !== JSON.stringify(placement.object);
          });
          expect(clashes, `${bucket} seed ${seed} clash`).toHaveLength(1);
          // And with all four roles present the eight operations give eight
          // different boards, so the worked rows pin one rule and the query has
          // seven near misses to draw the five options from.
          const outputs = new Set(OPERATIONS.map((operation) => {
            const combined = applySceneBinary(left, right, operation);
            return combined === null ? "empty" : sceneSignature(combined);
          }));
          expect(outputs.size, `${bucket} seed ${seed} distinct outputs`).toBe(8);
        }
      }
      expect(rowsChecked).toBe(180);
    }
  });

  it("locks the composed-transform grammar and its servable population at all four depths", () => {
    // The pool is eight primitives: four board moves (two rotations, two
    // reflections), two fill changes, and the two token turns added on
    // 2026-08-25. A program is an ordered list of DISTINCT primitives that is
    // not all board moves and holds at most one turn (the two turns compose to
    // a full circle, so a program with both leaves every direction as it found
    // it — see isSceneComposedProgram). The five-gate grammar added on
    // 2026-08-26 carries exactly the same three rules.
    //
    // Two gates: the 16 ordered pairs containing one board move and one fill.
    // Three gates: 8x7x6 = 336 ordered triples, less 4x3x2 = 24 all-spatial,
    // less the 6 x 3! = 36 that hold both turns, leaves 276.
    // Four gates: 8x7x6x5 = 1680, less 4! = 24 all-spatial, less 15 x 4! = 360
    // holding both turns, leaves 1296.
    // Five gates: 8x7x6x5x4 = 6720. No all-spatial term at all — there are only
    // four board moves, so five distinct primitives can never all be spatial —
    // less the C(6,3) x 5! = 20 x 120 = 2400 that hold both turns, leaves 4320.
    expect(composedTransformGrammar(2)).toHaveLength(16);
    expect(composedTransformGrammar(3)).toHaveLength(276);
    expect(composedTransformGrammar(4)).toHaveLength(1296);
    expect(composedTransformGrammar(5)).toHaveLength(4320);

    // What survives running end to end, ordering visibly mattering, single-gate
    // ablation, and having five distinct wrong runs to offer.
    //
    // The five-gate arithmetic, cause by cause, over those 4320 programs:
    //   752 never run to the end on the canonical query,
    //  1024 land on the same board when the gates are fully reversed,
    //   696 have a gate whose deletion leaves the answer unchanged,
    //     0 run out of distinct wrong runs,
    //  1848 servable. 752 + 1024 + 696 + 0 + 1848 = 4320.
    expect(servableComposedTransformPrograms(2)).toHaveLength(16);
    expect(servableComposedTransformPrograms(3)).toHaveLength(192);
    expect(servableComposedTransformPrograms(4)).toHaveLength(552);
    expect(servableComposedTransformPrograms(5)).toHaveLength(1848);
    for (const gateCount of [2, 3, 4, 5] as const) {
      const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
      expect(publicPrograms.length + heldOutPrograms.length, `${gateCount} gates`)
        .toBe(servableComposedTransformPrograms(gateCount).length);
    }
    expect(partitionComposedTransformPrograms(2).publicPrograms).toHaveLength(16);
    expect(partitionComposedTransformPrograms(2).heldOutPrograms).toHaveLength(0);
    expect(partitionComposedTransformPrograms(3).publicPrograms).toHaveLength(168);
    expect(partitionComposedTransformPrograms(3).heldOutPrograms).toHaveLength(24);
    expect(partitionComposedTransformPrograms(4).publicPrograms).toHaveLength(520);
    expect(partitionComposedTransformPrograms(4).heldOutPrograms).toHaveLength(32);
    // Five gates reserve nothing: see the partition test below for the proof
    // that the held-out SHAPE and single-gate ablation cannot both hold at this
    // depth, so the whole servable population is public.
    expect(partitionComposedTransformPrograms(5).publicPrograms).toHaveLength(1848);
    expect(partitionComposedTransformPrograms(5).heldOutPrograms).toHaveLength(0);

    // The headline number from the plan's diagnosis. Before turns existed the
    // three-gate public pool was 56 programs, and 16 of them painted the
    // upper-left slot twice with nothing in between, so the first paint was
    // invisible and the "three-step" item really needed two. Those 16 are
    // exactly what single-gate ablation removes: the turn-free public pool is
    // now 40.
    const turnFree = (program: SceneComposedProgram) =>
      sceneComposedProgramSteps(program).every((step) => step.kind !== "turn");
    expect(partitionComposedTransformPrograms(3).publicPrograms.filter(turnFree)).toHaveLength(40);
  });

  it("proves every servable composed program needs every gate it displays", () => {
    // Exhaustive over all four grammars, on the board the family itself
    // decides servability against. Removing any one gate has to change the
    // answer, or the item shows a step a solver could skip.
    const query = canonicalComposedTransformQuery();
    for (const gateCount of [2, 3, 4, 5] as const) {
      for (const program of servableComposedTransformPrograms(gateCount)) {
        const steps = sceneComposedProgramSteps(program);
        const answer = applySceneComposedProgram(query, program);
        expect(answer, JSON.stringify(program)).not.toBeNull();
        for (let gate = 0; gate < steps.length; gate++) {
          const kept = steps.filter((_, index) => index !== gate);
          let ablated: Scene | null = query;
          for (const step of kept) ablated = ablated && applySceneCompositionPrimitive(ablated, step);
          if (ablated === null) continue; // a run that does not apply cannot reproduce the answer
          expect(sceneSignature(ablated), `gate ${gate} of ${JSON.stringify(program)} is removable`)
            .not.toBe(sceneSignature(answer!));
        }
      }
    }
  });

  it("partitions every composed grammar into disjoint, exhaustive public and held-out halves", () => {
    const primitiveKeys = sceneComposedPrimitives().map((primitive) => JSON.stringify(primitive));
    for (const gateCount of [2, 3, 4, 5] as const) {
      const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
      expect(publicPrograms.length, `${gateCount} gates`).toBeGreaterThan(0);
      // Three and four gates reserve a real population. Two cannot begin with
      // two board moves, and five reserves none for the reason proved below.
      if (gateCount === 3 || gateCount === 4) {
        expect(heldOutPrograms.length, `${gateCount} gates`).toBeGreaterThan(0);
      } else {
        expect(heldOutPrograms, `${gateCount} gates`).toEqual([]);
      }

      // Exhaustive and disjoint: together they are exactly the servable set.
      const publicKeys = new Set(publicPrograms.map(sceneComposedProgramKey));
      const heldOutKeys = new Set(heldOutPrograms.map(sceneComposedProgramKey));
      expect([...publicKeys].filter((key) => heldOutKeys.has(key)), `${gateCount} gates`).toEqual([]);
      expect(new Set([...publicKeys, ...heldOutKeys]).size, `${gateCount} gates`).toBe(
        new Set(servableComposedTransformPrograms(gateCount).map(sceneComposedProgramKey)).size,
      );

      // Every servable program is in the grammar it came from, and the split
      // rule is the committed one: held out means the first two gates move the
      // board and every later gate is token-local.
      const grammarKeys = new Set(composedTransformGrammar(gateCount).map(sceneComposedProgramKey));
      for (const program of [...publicPrograms, ...heldOutPrograms]) {
        expect(grammarKeys.has(sceneComposedProgramKey(program))).toBe(true);
      }
      for (const program of heldOutPrograms) {
        const steps = sceneComposedProgramSteps(program);
        expect(steps[0].kind).toBe("spatial");
        expect(steps[1].kind).toBe("spatial");
        expect(steps.slice(2).every((step) => step.kind !== "spatial")).toBe(true);
      }
      for (const program of publicPrograms) {
        const steps = sceneComposedProgramSteps(program);
        const heldOutShape = steps[0].kind === "spatial" && steps[1].kind === "spatial" &&
          steps.slice(2).every((step) => step.kind !== "spatial");
        expect(heldOutShape, sceneComposedProgramKey(program)).toBe(false);
      }

      // Every primitive stays practised on both sides: what is withheld is the
      // shape of the composition, never a step a solver has never seen. An
      // empty side has nothing to practise, so only non-empty sides are checked.
      const expectedPrimitiveKeys = gateCount === 2
        ? sceneComposedPrimitives()
          .filter((primitive) => primitive.kind !== "turn")
          .map((primitive) => JSON.stringify(primitive))
        : primitiveKeys;
      for (const side of [publicPrograms, heldOutPrograms]) {
        if (side.length === 0) continue;
        const used = new Set(side.flatMap((program) =>
          sceneComposedProgramSteps(program).map((step) => JSON.stringify(step))));
        expect(expectedPrimitiveKeys.filter((key) => !used.has(key)), `${gateCount} gates`).toEqual([]);
      }
    }
  });

  it("pins the v17 composed ladder and keeps the withdrawn d6 path byte-identical", () => {
    //
    // REISSUED 2026-08-27. Every value below moved that day, deliberately and
    // across all families at once: distractor selection now has to make the
    // wrong options AGREE with the answer on each aspect a solver can infer
    // alone (footprint, shapes, fills, rotations, count), because the owner
    // reported that one inference was often enough to pick the answer without
    // reading the other rules. Different distractors mean different items. This
    // is the "deliberate decision to reissue" these goldens exist to force.
    // A golden-seed digest per bucket, in the style of the legacy generator
    // goldens. Adding `composed-transform-d6` on 2026-08-26 touched the shared
    // grammar, the gate glyph table, the query-strip shape, and the puzzle
    // schema, so the two buckets that were already served had to be proved
    // unchanged rather than assumed unchanged.
    //
    // `composed-transform-d4` and d5 are deliberately reissued in v17. The
    // intermediate bucket now shows and applies two gates; the hard bucket
    // shows and applies three, with both worked and recombined orders sampled.
    //
    // `composed-transform-d6` is withdrawn and no band may draw it, but the
    // five-gate generator stays in the code for a possible rework, so its
    // digest stays here to keep that path honest.
    const digests: Record<string, string> = {
      "composed-transform-d4": "f0b074c9eb4859a4216a1a76bb0a4828f07e459437ee5a4d7c744a4048c5d883",
      "composed-transform-d5": "1889831dd1f341d43469d7a0d73a5e837d0ce8fe46a3ab752c376ac14fc42a76",
      "composed-transform-d6": "2f1c9e404730185dde8dc123f3b36a0adb2b14fc8f9293fe3043c03f7b1c3f5c",
    };
    for (const [bucket, digest] of Object.entries(digests)) {
      const rendered = Array.from({ length: 50 }, (_, seed) =>
        JSON.stringify(generateSceneFamilyCandidate(
          "composed-transform-v2",
          seededRng("byte-compat", `${bucket}:${seed}`),
          bucket,
        ).puzzle));
      expect(createHash("sha256").update(rendered.join("\n")).digest("hex"), bucket).toBe(digest);
    }
  });

  it("proves the five-gate grammar can reserve nothing, rather than merely finding none", () => {
    // The committed split reserves programs that move the board twice and then
    // only touch tokens. At five gates that shape needs three DISTINCT
    // token-local steps in the tail, and the pool offers only four: two fills
    // and two turns, of which a program may hold at most one turn. So the tail
    // is forced to be both fills plus one turn — and a turn never changes the
    // fill of the upper-left slot, so whichever fill comes first is painted
    // over with nothing in between that could move a different token into that
    // slot. Single-gate ablation deletes exactly such a gate, so every program
    // of the reserved shape is unservable at this depth.
    //
    // The consequence is recorded, not worked around: `composed-transform-d6`
    // has no held-out twin, and the reserved-transfer probe stays a three- and
    // four-gate diagnostic.
    const heldOutShape = (program: SceneComposedProgram) => {
      const steps = sceneComposedProgramSteps(program);
      return steps[0].kind === "spatial" && steps[1].kind === "spatial" &&
        steps.slice(2).every((step) => step.kind !== "spatial");
    };
    // 4x3 = 12 ordered pairs of distinct board moves, times the 12 orderings of
    // {fill half, fill solid, one of the two turns}: 144 programs of the shape.
    const shaped = composedTransformGrammar(5).filter(heldOutShape);
    expect(shaped).toHaveLength(144);

    const servableKeys = new Set(servableComposedTransformPrograms(5).map(sceneComposedProgramKey));
    expect(shaped.filter((program) => servableKeys.has(sceneComposedProgramKey(program)))).toEqual([]);

    // ...and every one of them fails for the stated reason: a removable gate.
    const query = canonicalComposedTransformQuery();
    for (const program of shaped) {
      const steps = sceneComposedProgramSteps(program);
      const fills = steps.flatMap((step, index) => step.kind === "setFillAt" ? [index] : []);
      expect(fills, sceneComposedProgramKey(program)).toHaveLength(2);
      // Nothing between the two fills moves the board, so the earlier one is
      // invisible: dropping it leaves the same final board.
      expect(steps.slice(fills[0] + 1, fills[1]).every((step) => step.kind !== "spatial")).toBe(true);
      const answer = applySceneComposedProgram(query, program);
      if (!answer) continue; // a program that never runs is unservable for a different reason
      let ablated: Scene | null = query;
      for (const [index, step] of steps.entries()) {
        if (index === fills[0]) continue;
        ablated = ablated && applySceneCompositionPrimitive(ablated, step);
      }
      expect(ablated, sceneComposedProgramKey(program)).not.toBeNull();
      expect(sceneSignature(ablated!), sceneComposedProgramKey(program)).toBe(sceneSignature(answer));
    }
  });

  it("keeps held-out composed-transform combinations out of the public generator", () => {
    const fingerprintOf = (program: SceneComposedProgram) =>
      createHash("sha256").update(`composed-transform-v2:${sceneComposedProgramKey(program)}`)
        .digest("hex").slice(0, 16);
    const buckets = [
      { bucket: "composed-transform-d4", gateCount: 2, stemPanels: 9 },
      { bucket: "composed-transform-d5", gateCount: 3, stemPanels: 12 },
      { bucket: "composed-transform-d6", gateCount: 5, stemPanels: 18 },
    ] as const;

    for (const { bucket, gateCount, stemPanels } of buckets) {
      const { heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
      const heldOutFingerprints = new Set(heldOutPrograms.map(fingerprintOf));

      // The public generator can never emit a reserved combination.
      for (let seed = 0; seed < 300; seed++) {
        const candidate = generateSceneFamilyCandidate(
          "composed-transform-v2",
          seededRng("held-out-leakage", `public:${bucket}:${seed}`),
          bucket,
        );
        expect(candidate.puzzle.stem, `${bucket} seed ${seed}`).toHaveLength(stemPanels);
        expect(heldOutFingerprints.has(candidate.definition.programFingerprint!(candidate.puzzle))).toBe(false);
      }

      // Held-out generation covers this bucket, serves only reserved
      // combinations, and passes the same correctness contract as anything
      // public. Five gates reserve nothing, so there is nothing to draw and the
      // generator says so instead of quietly serving a public program.
      if (heldOutPrograms.length === 0) {
        expect(heldOutPrograms).toHaveLength(0);
        expect(() => generateHeldOutComposedTransformCandidate(seededRng("held-out-leakage", "eval:d6"), gateCount))
          .toThrow();
        continue;
      }
      for (let seed = 0; seed < 20; seed++) {
        const reserved = generateHeldOutComposedTransformCandidate(
          seededRng("held-out-leakage", `eval:${bucket}:${seed}`),
          gateCount,
          bucket,
        );
        expect(reserved.puzzle.stem, `${bucket} seed ${seed}`).toHaveLength(stemPanels);
        expect(heldOutFingerprints.has(reserved.definition.programFingerprint!(reserved.puzzle))).toBe(true);
        expect(validateSceneFamilyCandidate(reserved).accepted).toBe(true);
      }
    }
  });

  it("shows every selected gate of a composed item doing visible work", () => {
    // The end-to-end reading of the ablation rule: take the item a taker is
    // actually served, recover each gate from its own worked row, and check
    // that dropping any one of them changes the answer.
    const pool = sceneComposedPrimitives();
    const demonstrated = new Set<string>();
    for (const { bucket, gateCount, queryGateCount } of [
      { bucket: "composed-transform-d4", gateCount: 2, queryGateCount: 2 },
      { bucket: "composed-transform-d5", gateCount: 3, queryGateCount: 3 },
      { bucket: "composed-transform-d6", gateCount: 5, queryGateCount: 5 },
    ] as const) {
      for (let seed = 0; seed < 60; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          "composed-transform-v2",
          seededRng("gate-necessity", `${bucket}:${seed}`),
          bucket,
        );
        const panels = puzzle.stem.map((panel) => "blank" in panel ? null : panel);
        const steps = Array.from({ length: gateCount }, (_, row) => {
          const input = panels[row * 3]!;
          const output = panels[row * 3 + 2]!;
          const matches = pool.filter((primitive) => {
            const predicted = applySceneCompositionPrimitive(input, primitive);
            return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
          });
          expect(matches.length, `${bucket} seed ${seed} row ${row}`).toBe(1);
          demonstrated.add(JSON.stringify(matches[0]));
          return matches[0];
        });
        const workedGlyphs = Array.from({ length: gateCount }, (_, row) =>
          JSON.stringify(panels[row * 3 + 1]!.objects[0].object));
        const query = panels[gateCount * 3]!;
        const strip = panels[gateCount * 3 + 1]!;
        const selectedIndexes = [...strip.objects]
          .sort((left, right) => left.column - right.column)
          .map((placement) => workedGlyphs.indexOf(JSON.stringify(placement.object)));
        expect(selectedIndexes, `${bucket} seed ${seed}`).toHaveLength(queryGateCount);
        expect(selectedIndexes.every((index) => index >= 0)).toBe(true);
        expect([...selectedIndexes].sort((left, right) => left - right), `${bucket} seed ${seed}`)
          .toEqual(Array.from({ length: gateCount }, (_, index) => index));
        const answer = puzzle.options[puzzle.answerIndex];
        const running = selectedIndexes.map((index) => steps[index]);
        let full: Scene | null = query;
        for (const step of running) full = full && applySceneCompositionPrimitive(full, step);
        expect(sceneSignature(full!), `${bucket} seed ${seed}`).toBe(sceneSignature(answer));
        for (let gate = 0; gate < running.length; gate++) {
          let ablated: Scene | null = query;
          for (const [index, step] of running.entries()) {
            if (index === gate) continue;
            ablated = ablated && applySceneCompositionPrimitive(ablated, step);
          }
          if (ablated === null) continue;
          expect(sceneSignature(ablated), `${bucket} seed ${seed} gate ${gate}`)
            .not.toBe(sceneSignature(answer));
        }
        if (queryGateCount === 2) {
          let reversed: Scene | null = query;
          for (const step of [...running].reverse()) {
            reversed = reversed && applySceneCompositionPrimitive(reversed, step);
          }
          expect(sceneSignature(reversed!), `${bucket} seed ${seed} reversed`)
            .not.toBe(sceneSignature(answer));
        }
      }
    }
    // Every primitive, the two turns included, really is taught by a worked row
    // — a gate vocabulary the items never demonstrate is a rule nobody can read.
    expect([...pool.map((primitive) => JSON.stringify(primitive))]
      .filter((key) => !demonstrated.has(key))).toEqual([]);
  });

  it("offers the other reading of a quarter-turn whenever a spatial item shows one", () => {
    // A board rotation and a token turn are the two readings of "turn a quarter
    // clockwise", and they produce completely different boards. An item that
    // demonstrates one has to offer the other as a wrong answer, or a solver who
    // confused them is never asked to notice.
    let boardRotations = 0;
    let tokenTurns = 0;
    for (let seed = 0; seed < 120; seed++) {
      const { puzzle } = generateSceneFamilyCandidate(
        "spatial-transform-v2",
        seededRng("spatial-turn-contrast", `${seed}`),
        "spatial-transform-d2",
      );
      const [first, transformed, query] = puzzle.stem.map((panel) => "blank" in panel ? null : panel);
      if (!first || !transformed || !query) throw new Error("a spatial item shows three boards");
      const optionKeys = new Set(puzzle.options.map(sceneSignature));
      for (const quarterTurns of [1, 2, 3] as const) {
        for (const [shown, twin] of [["rotate", "turn"], ["turn", "rotate"]] as const) {
          const worked = applySceneUnary(first, { kind: shown, quarterTurns });
          if (!worked || sceneSignature(worked) !== sceneSignature(transformed)) continue;
          const counterpart = applySceneUnary(query, { kind: twin, quarterTurns });
          expect(counterpart, `seed ${seed}`).not.toBeNull();
          expect(optionKeys.has(sceneSignature(counterpart!)), `seed ${seed} ${shown} ${quarterTurns}`).toBe(true);
          if (shown === "rotate") boardRotations++;
          else tokenTurns++;
        }
      }
    }
    expect(boardRotations).toBeGreaterThan(0);
    expect(tokenTurns).toBeGreaterThan(0);
  });

  it("lays out d5 as three worked gates and uses all three in varied query orders", () => {
    let inWorkedOrder = 0;
    let recombined = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { puzzle } = generateSceneFamilyCandidate(
        "composed-transform-v2",
        seededRng("gate-strip", `${seed}`),
        "composed-transform-d5",
      );
      // 12 panels: three worked (input, gate, output) rows and the query row.
      expect(puzzle.stem).toHaveLength(12);
      const panel = (index: number) => {
        const value = puzzle.stem[index];
        if ("blank" in value) throw new Error(`panel ${index} must be visible`);
        return value;
      };
      const workedGates = [0, 1, 2].map((row) => JSON.stringify(panel(row * 3 + 1).objects[0].object));
      expect(new Set(workedGates).size).toBe(3);

      const queryStrip = panel(10);
      const queryGlyphs = [...queryStrip.objects]
        .sort((left, right) => left.column - right.column)
        .map((placement) => JSON.stringify(placement.object));
      expect(queryGlyphs).toHaveLength(3);
      expect(queryGlyphs.every((glyph) => workedGates.includes(glyph))).toBe(true);
      expect(new Set(queryGlyphs).size).toBe(3);
      expect(new Set(queryGlyphs)).toEqual(new Set(workedGates));
      if (queryGlyphs.every((glyph, index) => glyph === workedGates[index])) inWorkedOrder++;
      else recombined++;
      expect({ rows: queryStrip.rows, columns: queryStrip.columns }).toEqual({ rows: 3, columns: 3 });
      // No option is ever wider than a board: a strip is a control, not an answer.
      expect(puzzle.options.every((option) => option.columns <= 3)).toBe(true);
    }
    expect(inWorkedOrder).toBeGreaterThan(0);
    expect(recombined).toBeGreaterThan(0);
  });

  it("locks the transformation-machine grammar and its servable population at both depths", () => {
    // Three gates: four board moves crossed with two fill changes, and the
    // duplication gate follows from the board move, so 4 x 2 = 8 machines.
    // Four gates: those 8 crossed with every unordered pair of the nine board
    // slots the swap gate could name, C(9, 2) = 36, so 8 x 36 = 288.
    expect(transformationMachineGrammar(3)).toHaveLength(8);
    expect(transformationMachineGrammar(4)).toHaveLength(288);

    // What survives running end to end and single-gate ablation, cause by
    // cause over those 288 four-gate programs:
    //   264 name a slot pair the run never fills — after the duplication gate
    //       only three of the nine slots hold a token, so only C(3, 2) = 3
    //       pairs per machine can apply, and 8 x (36 - 3) = 264 cannot;
    //     8 swap the duplicated token with its own source. Those two slots hold
    //       IDENTICAL tokens, so the exchange is invisible: deleting the gate
    //       leaves the answer unchanged and the item would show four gates a
    //       solver only needs three of. One per machine, so 8;
    //    16 servable. 264 + 8 + 16 = 288.
    // All 8 three-gate programs are servable, which is why the d5 bucket draws
    // the whole grammar and its released population is untouched by this gate.
    expect(servableTransformationMachinePrograms(3)).toHaveLength(8);
    expect(servableTransformationMachinePrograms(4)).toHaveLength(16);

    const query = canonicalTransformationMachineQuery();
    const runs = (program: MachineProgramForTest) => {
      let value: Scene | null = query;
      for (const gate of transformationMachineGates(program)) value = value && applySceneUnary(value, gate);
      return value;
    };
    expect(transformationMachineGrammar(4).filter((program) => runs(program) === null)).toHaveLength(264);
  });

  it("proves every servable transformation-machine program needs every gate it displays", () => {
    // Exhaustive over both grammars, on the board the family itself decides
    // servability against. Removing any one gate has to change the answer, or
    // the item shows a step a solver could skip.
    const query = canonicalTransformationMachineQuery();
    for (const gateCount of [3, 4] as const) {
      for (const program of servableTransformationMachinePrograms(gateCount)) {
        const gates = transformationMachineGates(program);
        expect(gates, JSON.stringify(program)).toHaveLength(gateCount);
        let answer: Scene | null = query;
        for (const gate of gates) answer = answer && applySceneUnary(answer, gate);
        expect(answer, JSON.stringify(program)).not.toBeNull();
        for (let gate = 0; gate < gates.length; gate++) {
          let ablated: Scene | null = query;
          for (const [index, step] of gates.entries()) {
            if (index === gate) continue;
            ablated = ablated && applySceneUnary(ablated, step);
          }
          if (ablated === null) continue; // a run that does not apply cannot reproduce the answer
          expect(sceneSignature(ablated), `gate ${gate} of ${JSON.stringify(program)} is removable`)
            .not.toBe(sceneSignature(answer!));
        }
      }
    }
  });

  it("shows every gate of a served four-gate machine item doing visible work", () => {
    // The end-to-end reading of the ablation rule: take the item a taker is
    // actually served, recover each gate from its own worked row, and check
    // that dropping any one of them changes the answer.
    //
    // The pool a row is matched against is the family's WHOLE gate vocabulary,
    // not just the operations that may stand in that row's slot. A worked row
    // that two different operations explain is an ambiguous item however tidy
    // the grammar is — a swap of two slots a reflection also exchanges, say,
    // would read as either.
    const pool = [...new Map(transformationMachineGrammar(4)
      .flatMap((program) => transformationMachineGates(program))
      .map((gate) => [JSON.stringify(gate), gate])).values()];
    // 4 board moves, 2 fill changes, 2 duplications (the two source slots a
    // board move can leave the upper-left token in), and 36 swaps.
    expect(pool).toHaveLength(44);

    const fingerprints = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const candidate = generateSceneFamilyCandidate(
        "transformation-machine-v3",
        seededRng("machine-gate-necessity", `${seed}`),
        "transformation-machine-d6",
      );
      const { puzzle } = candidate;
      fingerprints.add(candidate.definition.programFingerprint!(puzzle));
      // 15 panels: four worked (input, gate, output) rows plus the query row.
      expect(puzzle.stem).toHaveLength(15);
      const panels = puzzle.stem.map((panel) => "blank" in panel ? null : panel);
      const gates = Array.from({ length: 4 }, (_, row) => {
        const input = panels[row * 3]!;
        const output = panels[row * 3 + 2]!;
        const matches = pool.filter((gate) => {
          const predicted = applySceneUnary(input, gate);
          return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
        });
        expect(matches.length, `seed ${seed} row ${row}`).toBe(1);
        return matches[0];
      });
      const query = panels[12]!;
      const answer = puzzle.options[puzzle.answerIndex];
      let full: Scene | null = query;
      for (const gate of gates) full = full && applySceneUnary(full, gate);
      expect(sceneSignature(full!), `seed ${seed}`).toBe(sceneSignature(answer));
      for (let gate = 0; gate < gates.length; gate++) {
        let ablated: Scene | null = query;
        for (const [index, step] of gates.entries()) {
          if (index === gate) continue;
          ablated = ablated && applySceneUnary(ablated, step);
        }
        if (ablated === null) continue;
        expect(sceneSignature(ablated), `seed ${seed} gate ${gate}`).not.toBe(sceneSignature(answer));
      }
    }
    // Every servable program really is drawn and served, so the counts above
    // describe the shipped population rather than a filtered list nobody uses.
    expect(fingerprints.size).toBe(servableTransformationMachinePrograms(4).length);
  });

  it("fits the four-gate machine table in the agent canvas and the 375px browser strip", () => {
    // Difficulty comes from program depth, never from a smaller mark. The
    // fourth gate turns the twelve-panel table into a fifteen-panel one and the
    // three-glyph gate board into a wide 1x4 strip. Nothing else about the item
    // changes: the boards stay 3x3 and the answer keeps three tokens.
    for (let seed = 0; seed < 20; seed++) {
      const { puzzle } = generateSceneFamilyCandidate(
        "transformation-machine-v3",
        seededRng("machine-strip", `${seed}`),
        "transformation-machine-d6",
      );
      const strip = puzzle.stem[13];
      if ("blank" in strip) throw new Error("the query gate strip must be visible");
      expect({ rows: strip.rows, columns: strip.columns }).toEqual({ rows: 1, columns: 4 });
      expect(strip.objects.every((placement) => placement.row === 0)).toBe(true);
      // The four glyphs are the four worked gates, once each, in worked order.
      const workedGates = [0, 1, 2, 3].map((row) => {
        const gate = puzzle.stem[row * 3 + 1];
        if ("blank" in gate) throw new Error("a worked gate must be visible");
        return JSON.stringify(gate.objects[0].object);
      });
      expect(new Set(workedGates).size).toBe(4);
      expect([...strip.objects]
        .sort((left, right) => left.column - right.column)
        .map((placement) => JSON.stringify(placement.object))).toEqual(workedGates);
      // No option is ever four wide: the strip is a control, not a board.
      expect(puzzle.options.every((option) => option.columns <= 3)).toBe(true);
      // No board on the item carries more tokens than the d5 bucket's answer
      // already did, so the deeper item is not a busier one.
      const boards = [...puzzle.stem.flatMap((panel) => "blank" in panel ? [] : [panel]), ...puzzle.options]
        .filter((board) => board.columns === 3);
      expect(Math.max(...boards.map((board) => board.objects.length))).toBeLessThanOrEqual(3);

      // The agent sees a single image that cannot scroll, so every drawn panel
      // has to sit inside the canvas.
      const svg = puzzleToSvg(puzzle);
      const canvasWidth = Number(/<svg\b[^>]*\bwidth="([^"]*)"/.exec(svg)?.[1] ?? "0");
      expect(canvasWidth).toBeGreaterThan(0);
      const boxes = Array.from(svg.matchAll(/<rect\b([^>]*?)(?:\/>|>[\s\S]*?<\/rect>)/g))
        .map((match) => {
          const attrs: Record<string, string> = {};
          for (const pair of match[1].matchAll(/([a-zA-Z_:][^\s=]*)="([^"]*)"/g)) attrs[pair[1]] = pair[2];
          return attrs;
        })
        .filter((rect) => rect.fill === "#ffffff" && (rect.stroke === "#9ca3af" || Boolean(rect["stroke-dasharray"])))
        .map((rect) => ({ x: Number(rect.x), w: Number(rect.width) }));
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.x, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, `seed ${seed}`).toBeLessThanOrEqual(canvasWidth);
      }
    }

    // The browser strip: four glyphs in one unwrapped row, priced against the
    // 261px a machine row gets on a 375px phone. compose-image.test.ts prices
    // every width class; this checks the family really emits that strip.
    const { puzzle } = generateSceneFamilyCandidate(
      "transformation-machine-v3",
      seededRng("machine-strip", "0"),
      "transformation-machine-d6",
    );
    const browser = renderToStaticMarkup(createElement(StemView, { puzzle }));
    expect(browser).toContain("flex-nowrap");
    expect(browser).toContain("w-11 sm:w-16");
    expect(browser).toContain('aria-label="4 gates, applied left to right"');
    expect(gateStripWidth(4)).toBeLessThanOrEqual(NARROW_VIEWPORT_STEM_WIDTH);

    // The fourth glyph is bought out of the strip's own width, not out of the
    // mark: a four-glyph strip gives each glyph a 44px cell instead of 56px.
    // The shape drawn inside
    // that cell still clears this project's 24px legibility floor.
    const stripPanel = puzzle.stem[13];
    if ("blank" in stripPanel) throw new Error("the query gate strip must be visible");
    const glyphs = gateGlyphs(stripPanel);
    expect(glyphs).toHaveLength(4);
    for (const glyph of glyphs) {
      const nodes = Array.from(
        renderToStaticMarkup(createElement(CellGraphic, { cell: glyph as never }))
          .matchAll(/<(circle|rect|polygon)\b([^>]*?)\/?>/g),
      ).map((match) => {
        const attrs: Record<string, string> = {};
        for (const pair of match[2].matchAll(/([a-zA-Z_:][^\s=]*)="([^"]*)"/g)) attrs[pair[1]] = pair[2];
        return { tag: match[1], attrs };
      });
      const spans = nodes.flatMap((node) => {
        if (node.tag === "circle") return [Number(node.attrs.r) * 2];
        if (node.tag === "polygon") {
          const xs = (node.attrs.points ?? "").split(/\s+/).filter(Boolean)
            .map((point) => Number(point.split(",")[0]));
          return xs.length > 0 ? [Math.max(...xs) - Math.min(...xs)] : [];
        }
        const width = Number(node.attrs.width);
        return Number.isFinite(width) && width < CELL_VIEWBOX ? [width] : [];
      });
      expect(spans.length).toBeGreaterThan(0);
      expect(Math.max(...spans) * (WIDE_GATE_GLYPH_WIDTH / CELL_VIEWBOX)).toBeGreaterThan(24);
    }
  });

  it("keeps transformation-machine d5 replaying byte for byte", () => {
    //
    // REISSUED 2026-08-27. Every value below moved that day, deliberately and
    // across all families at once: distractor selection now has to make the
    // wrong options AGREE with the answer on each aspect a solver can infer
    // alone (footprint, shapes, fills, rotations, count), because the owner
    // reported that one inference was often enough to pick the answer without
    // reading the other rules. Different distractors mean different items. This
    // is the "deliberate decision to reissue" these goldens exist to force.
    // The digest below was computed from the generator as it stood BEFORE
    // that change, over the first 50 seeds of the same stream a 400-seed per
    // bucket before/after sweep used; the sweep compared 800 whole puzzles and
    // found none differing. A deliberate one-character perturbation of each d5
    // path moved 400 and 270 of those 800 puzzles, so the sweep detects change
    // rather than merely reporting none.
    const digests: Record<string, { familyId: SceneFamilyId; digest: string }> = {
      "transformation-machine-d5": {
        familyId: "transformation-machine-v3",
        digest: "3bd0edd26acbe7e3bac64a9dc2c5a67d55953e10347e6fd0f1a54dd44ac4b493",
      },
    };
    for (const [bucket, { familyId, digest }] of Object.entries(digests)) {
      const rendered = Array.from({ length: 50 }, (_, seed) =>
        JSON.stringify(generateSceneFamilyCandidate(
          familyId,
          seededRng("byte-compat-sweep", `${bucket}:${seed}`),
          bucket,
        ).puzzle));
      expect(createHash("sha256").update(rendered.join("\n")).digest("hex"), bucket).toBe(digest);
    }
  });

  it("holds the combining machine to zero single-inference d4 items and a stated d5 residual", () => {
    // The regression gate for the aspect work of 2026-08-27, on fixed seeds so a
    // change in the family moves this number rather than passing silently.
    //
    // d4 reaches zero: the near-miss pool holds the board that sits exactly
    // where the answer sits (the clash read the wrong way round) and the board
    // that carries exactly its shapes (the exclusive token kept from the wrong
    // board). d5 does NOT reach zero and is not expected to — a three-gate chain
    // more often lands on a board no other chain can sit beside, so the draw
    // search settles for a sound item instead. The residual is stated here as a
    // ceiling rather than left unmeasured: 4 of 40 at the time of writing, and
    // the gate fails if it grows.
    const RESIDUAL_CEILING = { "combining-machine-d4": 0, "combining-machine-d5": 6 } as const;
    const ms = (values: string[]) => [...values].sort().join("|");
    const aspects: Record<string, (scene: Scene) => string> = {
      positions: (scene) => ms(scene.objects.map((p) => `${p.row},${p.column}`)),
      shapes: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? p.object.shape : "-")),
      fills: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? p.object.fill : "-")),
      rotations: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? String(p.object.rotation) : "-")),
      count: (scene) => String(scene.objects.length),
    };
    for (const [bucket, ceiling] of Object.entries(RESIDUAL_CEILING)) {
      let leaking = 0;
      for (let seed = 0; seed < 40; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          "combining-machine-v1", seededRng("single-inference", `${bucket}:${seed}`), bucket);
        const answer = puzzle.options[puzzle.answerIndex];
        const decided = Object.values(aspects).some((read) =>
          puzzle.options.filter((option) => read(option) === read(answer)).length === 1);
        if (decided) leaking += 1;
      }
      expect(leaking, `${bucket}: ${leaking} of 40 items decided by one aspect`)
        .toBeLessThanOrEqual(ceiling);
    }
  });

  it("builds the combining machine as gates that take two boards, and proves each gate is readable", () => {
    // New family, 2026-08-27: the first item in the battery where a named,
    // reusable gate combines TWO boards. The row shape had to be new for it —
    // a machine row is (input, gate, output) and cannot show a second operand —
    // so this test pins the two things that make the row honest: every worked
    // row leaves exactly ONE combining rule standing, and the answer really is
    // the chain the query's gate strip spells out.
    for (const bucket of ["combining-machine-d4", "combining-machine-d5"]) {
      const gates = declaredGateCounts()[bucket];
      for (let seed = 0; seed < 25; seed++) {
        const candidate = generateSceneFamilyCandidate(
          "combining-machine-v1", seededRng("combining", `${bucket}:${seed}`), bucket);
        const { puzzle } = candidate;
        expect(puzzle.layout, bucket).toBe("combineTable");
        // One quad per worked gate, plus the query quad.
        expect(puzzle.stem.length, `${bucket} seed ${seed}`).toBe((gates + 1) * 4);
        expect(gates, "the three-gate ceiling of 2026-08-27").toBeLessThanOrEqual(3);

        const report = candidate.definition.validate(puzzle);
        // The oracle re-derives the answer from the finished puzzle alone. If a
        // worked row left two rules standing it returns nothing, so a single
        // solution here IS the proof that every gate is readable.
        expect(report.solutionCount, `${bucket} seed ${seed}`).toBe(1);
        expect(report.derivedAnswer, `${bucket} seed ${seed}`)
          .toEqual(puzzle.options[puzzle.answerIndex]);

        // Every wrong option names the mistake that produces it.
        const witnessed = new Set(report.distractorWitnesses.map((witness) => witness.optionIndex));
        for (let option = 0; option < puzzle.options.length; option++) {
          if (option === puzzle.answerIndex) continue;
          expect(witnessed.has(option), `${bucket} seed ${seed}: option ${option} has no witness`).toBe(true);
        }
      }
    }
  });
});

describe("parallel evolution", () => {
  const BUCKETS = ["parallel-evolution-d3", "parallel-evolution-d4"] as const;

  /** The eight perimeter slots, clockwise from the top-left corner. */
  const RING: readonly { row: number; column: number }[] = [
    { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }, { row: 1, column: 2 },
    { row: 2, column: 2 }, { row: 2, column: 1 }, { row: 2, column: 0 }, { row: 1, column: 0 },
  ];
  const FILLS = ["outline", "half", "solid"] as const;

  interface Strand { shape: string; positionIndex: number; fillIndex: number }

  /** Read a board back the way the family's own oracle does, but independently. */
  function strandsOf(board: Scene): Strand[] {
    expect(board.rows).toBe(3);
    expect(board.columns).toBe(3);
    expect(board.tiles).toHaveLength(0);
    expect(board.objects).toHaveLength(3);
    return board.objects
      .map((placement) => {
        const object = placement.object as SceneToken;
        expect(object.kind).toBe("token");
        const positionIndex = RING.findIndex((slot) =>
          slot.row === placement.row && slot.column === placement.column);
        expect(positionIndex, `token off the perimeter ring at ${placement.row},${placement.column}`)
          .toBeGreaterThanOrEqual(0);
        return { shape: object.shape, positionIndex, fillIndex: FILLS.indexOf(object.fill) };
      })
      .sort((left, right) => left.shape.localeCompare(right.shape));
  }

  /** The one rule in the declared grammar that fits a strand's whole history. */
  function survivingRules(history: readonly Strand[]) {
    return PARALLEL_EVOLUTION_GRAMMAR.filter((rule) =>
      history.every((state, index) => index === 0 || (
        state.positionIndex ===
          (history[index - 1].positionIndex + rule.positionDelta + RING.length) % RING.length &&
        state.fillIndex === (history[index - 1].fillIndex + rule.fillDelta) % FILLS.length)));
  }

  function itemAt(bucket: string, seed: number) {
    const candidate = generateSceneFamilyCandidate(
      "parallel-evolution-v1",
      seededRng("scene-family-verify-v1", `parallel-evolution-v1:${seed}`),
      bucket,
    );
    const boards = candidate.puzzle.stem
      .filter((panel): panel is Scene => !("blank" in panel))
      .map(strandsOf);
    return { candidate, boards };
  }

  it("declares a 15-rule grammar and draws each bucket from the documented part of it", () => {
    // 5 perimeter steps (-2, -1, 0, +1, +2) x 3 fill steps (0, +1, +2) = 15 rules.
    expect(PARALLEL_EVOLUTION_GRAMMAR).toHaveLength(15);
    expect(new Set(PARALLEL_EVOLUTION_GRAMMAR.map((rule) => rule.positionDelta)).size).toBe(5);
    expect(new Set(PARALLEL_EVOLUTION_GRAMMAR.map((rule) => rule.fillDelta)).size).toBe(3);
    // The split the two buckets draw from: 4 move-only + 2 fill-only = 6 single
    // aspect, 4 x 2 = 8 both-aspect, 15 - 1 identity = 14 that change anything.
    const singleAspect = PARALLEL_EVOLUTION_GRAMMAR
      .filter((rule) => (rule.positionDelta === 0) !== (rule.fillDelta === 0));
    const bothAspects = PARALLEL_EVOLUTION_GRAMMAR
      .filter((rule) => rule.positionDelta !== 0 && rule.fillDelta !== 0);
    const moving = PARALLEL_EVOLUTION_GRAMMAR
      .filter((rule) => rule.positionDelta !== 0 || rule.fillDelta !== 0);
    expect([singleAspect.length, bothAspects.length, moving.length]).toEqual([6, 8, 14]);

    // What each bucket actually draws, read off the boards rather than trusted.
    for (const bucket of BUCKETS) {
      const aspectCounts = new Set<number>();
      for (let seed = 0; seed < 60; seed++) {
        const { boards } = itemAt(bucket, seed);
        const rules = boards[0].map((_, strand) => {
          const surviving = survivingRules(boards.map((board) => board[strand]));
          expect(surviving, `${bucket} seed ${seed} strand ${strand}`).toHaveLength(1);
          return surviving[0];
        });
        // No strand ever holds still: a token that shows no transition cannot be
        // verified from the row, only assumed.
        for (const rule of rules) {
          expect(rule.positionDelta !== 0 || rule.fillDelta !== 0, `${bucket} seed ${seed}`).toBe(true);
        }
        // Three DISTINCT rules, which is what keeps all six boards different.
        expect(new Set(rules.map((rule) => `${rule.positionDelta}:${rule.fillDelta}`)).size).toBe(3);
        const changed = rules.map((rule) =>
          (rule.positionDelta === 0 ? 0 : 1) + (rule.fillDelta === 0 ? 0 : 1));
        for (const count of changed) aspectCounts.add(count);
        if (bucket === "parallel-evolution-d3") {
          // d3: every token changes exactly one aspect, ring XOR fill.
          expect(changed, `${bucket} seed ${seed}`).toEqual([1, 1, 1]);
        } else {
          // d4: the whole grammar, and at least one token changes both.
          expect(Math.max(...changed), `${bucket} seed ${seed}`).toBe(2);
        }
      }
      // d4 draws the FULL grammar, so single-aspect strands appear there too;
      // d3 has nothing else to draw.
      expect([...aspectCounts].sort(), bucket)
        .toEqual(bucket === "parallel-evolution-d3" ? [1] : [1, 2]);
    }
  });

  it("pins every strand to one rule and keeps all six boards apart", () => {
    for (const bucket of BUCKETS) {
      for (let seed = 0; seed < 200; seed++) {
        const { candidate, boards } = itemAt(bucket, seed);
        const { puzzle } = candidate;
        expect(puzzle.stem, `${bucket} seed ${seed}`).toHaveLength(6);
        expect(puzzle.stem.filter((panel) => "blank" in panel)).toHaveLength(1);
        expect(boards).toHaveLength(5);
        // Uniqueness by per-token survivor filtering, checked independently of
        // the family's own oracle.
        const rules = boards[0].map((_, strand) => {
          const surviving = survivingRules(boards.map((board) => board[strand]));
          expect(surviving, `${bucket} seed ${seed} strand ${strand}`).toHaveLength(1);
          return surviving[0];
        });
        // The answer is what those three rules predict, and nothing else is.
        const answer = strandsOf(puzzle.options[puzzle.answerIndex]);
        boards[4].forEach((state, strand) => {
          expect(answer[strand].shape).toBe(state.shape);
          expect(answer[strand].positionIndex)
            .toBe((state.positionIndex + rules[strand].positionDelta + RING.length) % RING.length);
          expect(answer[strand].fillIndex)
            .toBe((state.fillIndex + rules[strand].fillDelta) % FILLS.length);
        });
        // No two boards of the row look alike, so no panel is a free repeat.
        const boardKeys = [
          ...puzzle.stem.filter((panel): panel is Scene => !("blank" in panel)),
          puzzle.options[puzzle.answerIndex],
        ].map(sceneSignature);
        expect(new Set(boardKeys).size, `${bucket} seed ${seed}`).toBe(6);
      }
    }
  });

  it("makes every wrong option one token off, and contests all three tokens", () => {
    for (const bucket of BUCKETS) {
      for (let seed = 0; seed < 200; seed++) {
        const { candidate } = itemAt(bucket, seed);
        const { puzzle } = candidate;
        const answer = strandsOf(puzzle.options[puzzle.answerIndex]);
        const movedStrands = new Set<string>();
        let refilled = 0;
        for (const [index, option] of puzzle.options.entries()) {
          if (index === puzzle.answerIndex) continue;
          const wrong = strandsOf(option);
          const differing = wrong.filter((state, strand) =>
            state.positionIndex !== answer[strand].positionIndex ||
            state.fillIndex !== answer[strand].fillIndex);
          // Exactly one token off: the other two are the correct next states.
          expect(differing, `${bucket} seed ${seed} option ${index}`).toHaveLength(1);
          const strand = wrong.findIndex((state) => state.shape === differing[0].shape);
          if (differing[0].positionIndex !== answer[strand].positionIndex) {
            movedStrands.add(differing[0].shape);
          } else {
            refilled++;
          }
          // Distance 1 or 2 board positions by construction: a wrong fill leaves
          // the token where it belongs, a wrong step empties one slot and fills
          // another.
          const distance = sceneEditDistance(option, puzzle.options[puzzle.answerIndex]);
          expect(distance, `${bucket} seed ${seed} option ${index}`).not.toBe("incomparable");
          if (distance !== "incomparable") {
            expect(distance.positions, `${bucket} seed ${seed} option ${index}`)
              .toBeGreaterThanOrEqual(1);
            expect(distance.positions, `${bucket} seed ${seed} option ${index}`)
              .toBeLessThanOrEqual(2);
          }
        }
        // Every token's movement is contested at least once, so no strand's
        // perimeter rule can be skipped; and some option contests a fill, so the
        // fill rule cannot be skipped either.
        expect(movedStrands.size, `${bucket} seed ${seed}`).toBe(3);
        expect(refilled, `${bucket} seed ${seed}`).toBeGreaterThan(0);
        // Five wrong options, each with its own witness from the acceptance gate.
        const report = validateSceneFamilyCandidate(candidate);
        expect(report.accepted, `${bucket} seed ${seed}`).toBe(true);
        expect(report.report!.distractorWitnesses).toHaveLength(OPTIONS_PER_ITEM - 1);
      }
    }
  });

  it("fits a six-panel row in the agent canvas and in the browser strip", () => {
    // Mirrors the eight-panel row checks in compose-image.test.ts: an image
    // cannot scroll, so every drawn panel has to sit inside the canvas, and the
    // browser strip has to scroll from its first panel rather than clip it.
    for (const bucket of BUCKETS) {
      const { puzzle } = generateSceneFamilyCandidate(
        "parallel-evolution-v1",
        seededRng(`parallel-row:${bucket}`),
        bucket,
      );
      const svg = puzzleToSvg(puzzle);
      const canvasWidth = Number(/<svg\b[^>]*\bwidth="([^"]*)"/.exec(svg)?.[1] ?? "0");
      expect(canvasWidth).toBeGreaterThan(0);
      const boxes = Array.from(svg.matchAll(/<rect\b([^>]*?)(?:\/>|>[\s\S]*?<\/rect>)/g))
        .map((match) => {
          const attrs: Record<string, string> = {};
          for (const pair of match[1].matchAll(/([a-zA-Z_:][^\s=]*)="([^"]*)"/g)) attrs[pair[1]] = pair[2];
          return attrs;
        })
        .filter((rect) => rect.fill === "#ffffff" && rect.stroke === "#9ca3af")
        .map((rect) => ({ x: Number(rect.x), w: Number(rect.width) }));
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.x, bucket).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, bucket).toBeLessThanOrEqual(canvasWidth);
      }

      const browser = renderToStaticMarkup(createElement(StemView, { puzzle }));
      expect(browser).toContain("overflow-x-auto");
      // Its six panels are a plain left-to-right list, so they wrap rather than
      // scroll: every token's whole history stays visible while it is compared
      // against the other two tokens' histories.
      expect(browser).toContain("flex-wrap");
      // Six boards drawn, one per shown panel plus the blank's placeholder.
      expect((browser.match(/data-scene-position/g) ?? []).length).toBeGreaterThanOrEqual(15);
    }
  });

  it("keeps three tokens on a 3x3 board above the option-size legibility floor", () => {
    // Three tokens per board is what this family adds; the board is the same
    // 3x3 the rest of the battery already draws, and a token's drawn radius
    // depends on the SLOT, never on how many slots are occupied. So the floor
    // is checked at the smallest size a scene is ever displayed at — the 64px
    // review option — and it must clear the same span the arrow test uses.
    const { puzzle } = generateSceneFamilyCandidate(
      "parallel-evolution-v1",
      seededRng("parallel-legibility"),
      "parallel-evolution-d4",
    );
    const board = puzzle.options[puzzle.answerIndex];
    const svg = renderToStaticMarkup(createElement(SceneGraphic, { scene: board }));
    const drawn = Array.from(svg.matchAll(/<(circle|rect|polygon)\b([^>]*?)\/?>/g)).map((match) => {
      const attrs: Record<string, string> = {};
      for (const pair of match[2].matchAll(/([a-zA-Z_:][^\s=]*)="([^"]*)"/g)) attrs[pair[1]] = pair[2];
      return { tag: match[1], attrs };
    });
    const spans = drawn.flatMap((node) => {
      if (node.tag === "circle") return [Number(node.attrs.r) * 2];
      if (node.tag === "polygon") {
        const xs = (node.attrs.points ?? "").split(/\s+/).filter(Boolean)
          .map((point) => Number(point.split(",")[0]));
        return xs.length > 0 ? [Math.max(...xs) - Math.min(...xs)] : [];
      }
      // The board frame and the grid lines are rects too; only the square token
      // is smaller than the board itself.
      const width = Number(node.attrs.width);
      return Number.isFinite(width) && width < CELL_VIEWBOX / 2 ? [width] : [];
    });
    expect(spans.length).toBeGreaterThanOrEqual(3);
    for (const displayedSize of [80, 64]) {
      expect(Math.min(...spans) * (displayedSize / CELL_VIEWBOX), `at ${displayedSize}px`)
        .toBeGreaterThan(10);
    }
  });
});

describe("answered strand declarations", () => {
  // Which stem panels the strand containing the blank occupies. A row family
  // used to declare a bare count and the build gate had to believe it; these
  // indexes are checked against the puzzle instead.
  const ROW_FAMILIES = [
    { familyId: "relational-sequence-v2", panelIndexes: [0, 1, 2] },
    { familyId: "second-order-sequence-v2", panelIndexes: [0, 1, 2, 3, 4] },
    { familyId: "parallel-evolution-v1", panelIndexes: [0, 1, 2, 3, 4] },
  ] as const;

  it("proves every extrapolation row really shows the strand it declares", () => {
    for (const { familyId, panelIndexes } of ROW_FAMILIES) {
      for (let seed = 0; seed < 20; seed++) {
        const candidate = generateSceneFamilyCandidate(
          familyId,
          seededRng(`strand:${familyId}:${seed}`),
          entryBucket(familyId),
        );
        expect(candidate.answeredStrandPanelIndexes, familyId).toEqual(panelIndexes);
        const check = checkAnsweredStrand(candidate);
        expect(check.problem, `${familyId} seed ${seed}`).toBeNull();
        expect(check.observedTerms, familyId).toBe(panelIndexes.length);
        expect(check.observedTerms ?? 0, familyId)
          .toBeGreaterThanOrEqual(MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND);
      }
    }
  });

  it("asks nothing of a family that extrapolates no strand", () => {
    const matrix = generateSceneFamilyCandidate(
      "relational-matrix-v2",
      seededRng("strand:matrix"),
      entryBucket("relational-matrix-v2"),
    );
    expect(matrix.answeredStrandPanelIndexes).toBeUndefined();
    expect(checkAnsweredStrand(matrix)).toEqual({ observedTerms: null, problem: null });
    // ...but a stale declaration on such a family is still an error, not noise.
    expect(checkAnsweredStrand({ ...matrix, answeredStrandPanelIndexes: [0, 1, 2] }).problem)
      .toMatch(/not an extrapolation row/);
  });

  it("rejects a declaration the stem does not support", () => {
    // Retargeted on 2026-08-27 from `interleaved-sequence-v3`, withdrawn and
    // then deleted. `second-order-sequence-v2` shows five landings and then the
    // blank, so its answered strand is panels 0-4 at a stride of one and the
    // next stride lands on the blank at 5. Every error branch the checker has is
    // still exercised; only the shape of the row it is exercised on changed.
    const row = generateSceneFamilyCandidate(
      "second-order-sequence-v2",
      seededRng("strand:tampered"),
      entryBucket("second-order-sequence-v2"),
    );
    expect(checkAnsweredStrand(row).problem).toBeNull();

    const cases: { panelIndexes: number[] | undefined; problem: RegExp }[] = [
      { panelIndexes: [0, 1, 9], problem: /panel index 9 is outside the 6-panel stem/ },
      { panelIndexes: [4, 3, 2], problem: /must strictly increase, but 4 is followed by 3/ },
      { panelIndexes: [3, 4, 5], problem: /panel 5 is blank/ },
      { panelIndexes: [0, 1, 4], problem: /do not share one stride/ },
      { panelIndexes: [0, 1, 2], problem: /lands on 3, not on the blank at 5/ },
      { panelIndexes: [0, 1], problem: /only 2 observed terms/ },
      { panelIndexes: undefined, problem: /no answeredStrandPanelIndexes declared/ },
    ];
    for (const { panelIndexes, problem } of cases) {
      const check = checkAnsweredStrand({ ...row, answeredStrandPanelIndexes: panelIndexes });
      expect(check.problem ?? "", JSON.stringify(panelIndexes)).toMatch(problem);
    }
  });
});
