import { describe, expect, it } from "vitest";
import { seededRng, shuffled } from "../lib/rng";
import {
  OPTIONS_PER_ITEM,
  VisualPuzzleSchema,
  sceneSignature,
  type Scene,
} from "./schema";
import { puzzleToSvg } from "./compose-image";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { sceneEditDistance } from "./scene-distance";
import { createHash } from "node:crypto";
import {
  declaredGateCounts,
  MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND,
  SCENE_FAMILY_BUCKETS,
  SCENE_FAMILY_IDS,
  canonicalComposedTransformQuery,
  canonicalTransformationMachineQuery,
  checkAnsweredStrand,
  combiningGateOrderVerdict,
  combiningMachineCoveringChains,
  composedTransformGrammar,
  deriveCombiningMachineChains,
  entrySceneFamilyBucket,
  generateHeldOutComposedTransformCandidate,
  generateSceneFamilyCandidate,
  partitionComposedTransformPrograms,
  requireSceneFamilyBucket,
  resetExhaustedDistractorSearches,
  servableComposedTransformPrograms,
  servableTransformationMachineDraws,
  transformationMachineGates,
  transformationMachineGrammar,
  exhaustedDistractorSearches,
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

/** The easiest bucket a family declares — for checks that are not about depth. */
const entryBucket = (familyId: (typeof SCENE_FAMILY_IDS)[number]) =>
  entrySceneFamilyBucket(familyId).bucket;

describe("scene family prototypes", () => {
  it("serves a balanced option list in every bucket, found by a search that always finishes", () => {
    // CHANGED 2026-09-29 (docs/plans/blind-answer-leak.md). Until then this test
    // pinned a tight window: the five slots came from the closest `slots + 2`
    // candidates and the window never had to widen. That window was the star
    // the review measured — the answer at the centre of the option list, picked
    // about 60% of the time by solvers that never read the question — so the
    // behaviour it pinned was deliberately replaced. `selectDistractors` now
    // searches the nearest `DISTRACTOR_REACH` near misses for legible lists and
    // serves one drawn from the mix that spreads the answer's rank evenly on
    // every options-only measure (`blind-options.ts`).
    //
    // What this pins now: the search never runs out of its budget, so the list
    // served never depends on where a count stopped; and every near miss is
    // still measurable against the answer.
    //
    // Until the second 2026-09-29 change, "balanced" also meant the no-majority
    // and no-centre bans, and three buckets carried recorded exceptions
    // (combining-machine-d4 11 and d5 5 of 40, relational-matrix-d4 1): items
    // with no list that kept the answer off an aspect's outright majority. Those
    // bans are gone — a ban on any rank is itself a signal. Until 2026-09-30
    // agreement (some wrong option sharing each aspect of the answer) was the
    // one hard rule left and this test held every bucket to it; it fed a solver
    // of its own, so it is now one more strategy the mix balances, gated at 30%
    // by `npm run families:verify`.
    resetExhaustedDistractorSearches();
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
    expect(exhaustedDistractorSearches()).toBe(0);
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
      if (visibleIndexes.length >= 2) {
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

  it("makes every composition fingerprint change the query answer", () => {
    // composed-transform-v2's intermediate two-step space has 16 programs, and
    // distinct programs may legitimately land on
    // the same query answer — the worked rows, not the answer alone, identify
    // the program. So for it the gate is breadth (minimumPrograms) plus
    // fingerprint-to-answer consistency, not answer injectivity.
    //
    // transformation-machine-v3 left this table on 2026-09-28: its query now
    // stands in varying cells, so one program lands in different cells on
    // different items. Its fingerprint is checked against the gates recovered
    // from each served item's own worked rows instead (see "shows every gate of
    // a served machine item doing visible work"). rule-switching-v2 left it on
    // 2026-09-29, when the family was retired.
    const families = [
      { familyId: "composed-transform-v2", queryIndex: 6, expectedPrograms: 16 },
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
    // REISSUED 2026-09-29, deliberately, for both buckets: the options-only
    // leak (docs/plans/blind-answer-leak.md). Both families gained near misses
    // that skip one demonstrated change or step, and set algebra redraws a row
    // until its near misses can cover every aspect (the wider pool accepts some
    // draws sooner, so 4 of 50 stems moved). Re-taken a second time the same
    // day, before any release: distractor selection stopped banning the answer
    // from the top ranks, which had piled it into the middle ones, and now
    // draws the option list from the mix that spreads the answer's rank evenly
    // on every options-only measure. Stems and answers did not move on that
    // second re-take (checked against the first); only the options did.
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
    //
    // REISSUED 2026-09-30, deliberately: agreement (some wrong option sharing
    // each aspect of the answer) stopped being a hard rule and became two
    // balanced options-only strategies, with the one-inference solver kept in
    // the mix as a cost (docs/plans/blind-answer-leak.md). Stems and answers
    // are unchanged, the options are not.
    const goldens: Record<string, { familyId: SceneFamilyId; bucket: string; keys: string[] }> = {
      "compositional-analogy-d3-golden": {
        familyId: "compositional-analogy-v2",
        bucket: "compositional-analogy-d3",
        keys: [
          "0707d9975c1f18cdca150758",
          "88d9493369ceef2c85a2a12b",
          "409c3b9dfd3325a2bfff944d",
          "e899b997fd9bec0b9dff5493",
          "7e6ce529f05f4fca9e7b3152",
          "a17f4fe72f5ad3d3ccdfdc46",
          "629df3f3f94f12fcbcd03024",
          "ce9d4784b977fcf76eff2449",
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
          "1194eeb1d12a13aee1a7679d",
          "51c85c5a613a542ceab45416",
          "e0d31a083f660514e1ae78a8",
          "105c26067230b9899dcd6c25",
          "dd53caa602dc08e59dfdb1c5",
          "3a5f89e6566c71c5036c8fe2",
          "07c8591d168c9c97de579c26",
          "fcf918c89bc7b54bafefd732",
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

  it("rarely lets one inference pick the answer, in the families built on several rules", () => {
    // The owner's report of 2026-08-27: "the answers are so different from each
    // other, and using only one first inference you can select the right answer
    // without looking at the other rules." Measured, every item in four buckets
    // was solvable from the answer's footprint alone.
    //
    // Until 2026-09-30 the property pinned here was absolute: for each aspect a
    // solver can infer on its own, at least one WRONG option had to share the
    // answer's value of it. That rule fed a solver of its own — rule out every
    // option alone on some aspect and guess among the rest, 42.9% on
    // `relational-matrix-d4` — so by the owner's decision of 2026-09-29 being
    // alone on an aspect is now one more strategy the option mix balances, held
    // to 30% over 200 items by `npm run families:verify`. What this pins is the
    // gross form: over 40 items, one inference picks the answer in at most half.
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
      { familyId: "relational-matrix-v2", bucket: "relational-matrix-d4" },
      { familyId: "spatial-transform-v2", bucket: "spatial-transform-d2" },
    ];
    for (const { familyId, bucket } of MULTI_RULE) {
      let isolated = 0;
      for (let seed = 0; seed < 40; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          familyId, seededRng("single-inference", `${bucket}:${seed}`), bucket);
        const answer = puzzle.options[puzzle.answerIndex];
        if (Object.values(aspects).some((read) => {
          const target = read(answer);
          return puzzle.options.filter((option) => read(option) === target).length === 1;
        })) isolated += 1;
      }
      expect(isolated, `${bucket}: items where one aspect alone isolates the answer, of 40`)
        .toBeLessThanOrEqual(20);
    }
  });

  it("never displays more than three gates, in any bucket the family can generate", () => {
    // The owner's standing rule of 2026-08-27: a fourth gate is more procedure,
    // not more reasoning. It cost two buckets that day (`composed-transform-d6`
    // at five gates, `transformation-machine-d6` at four) and reshaped a third
    // (`composed-transform-d5`, from four gates forward to three in varied order).
    // Their generators were deleted on 2026-09-28, so the rule now holds for
    // every declared bucket, not only for the ones a band may draw.
    const declared = declaredGateCounts();
    const drawable = new Set(
      CURRENT_FAMILY_PROMOTION_REGISTRY.flatMap((entry) =>
        entry.bands.flatMap((band) => band.validatedDifficultyBuckets)));
    expect(Object.entries(declared).filter(([, gates]) => gates > 3)).toEqual([]);
    // Every declared gate bucket is a bucket some family declares, so the table
    // cannot quietly name a bucket nothing generates.
    const declaredBuckets = new Set(SCENE_FAMILY_IDS.flatMap((familyId) =>
      SCENE_FAMILY_BUCKETS[familyId].map((bucket) => bucket.bucket)));
    expect(Object.keys(declared).filter((bucket) => !declaredBuckets.has(bucket))).toEqual([]);
    // Guard the guard: a typo in the table names would make the filter vacuous.
    expect(Object.keys(declared).filter((bucket) => drawable.has(bucket)).sort())
      .toEqual([
        "combining-machine-d4", "combining-machine-d5",
        "composed-transform-d4", "composed-transform-d5", "transformation-machine-d5",
      ]);
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

  it("locks the composed-transform grammar and its servable population at both depths", () => {
    // The pool is eight primitives: four board moves (two rotations, two
    // reflections), two fill changes, and the two token turns added on
    // 2026-08-25. A program is an ordered list of DISTINCT primitives that is
    // not all board moves and holds at most one turn (the two turns compose to
    // a full circle, so a program with both leaves every direction as it found
    // it — see isSceneComposedProgram).
    //
    // Two gates: the 16 ordered pairs containing one board move and one fill.
    // Three gates: 8x7x6 = 336 ordered triples, less 4x3x2 = 24 all-spatial,
    // less the 6 x 3! = 36 that hold both turns, leaves 276.
    expect(composedTransformGrammar(2)).toHaveLength(16);
    expect(composedTransformGrammar(3)).toHaveLength(276);

    // What survives running end to end, ordering visibly mattering, single-gate
    // ablation, and having five distinct wrong runs to offer.
    expect(servableComposedTransformPrograms(2)).toHaveLength(16);
    expect(servableComposedTransformPrograms(3)).toHaveLength(192);
    for (const gateCount of [2, 3] as const) {
      const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
      expect(publicPrograms.length + heldOutPrograms.length, `${gateCount} gates`)
        .toBe(servableComposedTransformPrograms(gateCount).length);
    }
    expect(partitionComposedTransformPrograms(2).publicPrograms).toHaveLength(16);
    expect(partitionComposedTransformPrograms(2).heldOutPrograms).toHaveLength(0);
    expect(partitionComposedTransformPrograms(3).publicPrograms).toHaveLength(168);
    expect(partitionComposedTransformPrograms(3).heldOutPrograms).toHaveLength(24);

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
    // Exhaustive over both grammars, on the board the family itself decides
    // servability against. Removing any one gate has to change the answer, or
    // the item shows a step a solver could skip.
    const query = canonicalComposedTransformQuery();
    for (const gateCount of [2, 3] as const) {
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
    for (const gateCount of [2, 3] as const) {
      const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
      expect(publicPrograms.length, `${gateCount} gates`).toBeGreaterThan(0);
      // Three gates reserve a real population. Two cannot begin with two board
      // moves.
      if (gateCount === 3) {
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

  it("pins the v17 composed ladder byte for byte", () => {
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
    // The withdrawn five-gate d6 path and its digest were deleted on 2026-09-28.
    //
    // REISSUED 2026-09-28, deliberately and for wording only: explanations now
    // name "the correct answer" instead of "the highlighted board", because the
    // review screen labels its tiles "Correct answer" and "Your choice". Stems,
    // options and answers are unchanged — the structural goldens above
    // (replay keys, which exclude the explanation) did not move.
    //
    // REISSUED 2026-09-29, deliberately: the options-only leak
    // (docs/plans/blind-answer-leak.md). Both buckets draw on near misses with
    // two mistakes in one run, and — re-taken a second time that day, before
    // any release — distractor selection spreads the answer's rank evenly on
    // every options-only measure instead of banning it from the top ranks.
    // Stems and answers are unchanged, the options are not.
    //
    // REISSUED 2026-09-30, deliberately: agreement (some wrong option sharing
    // each aspect of the answer) stopped being a hard rule and became two
    // balanced options-only strategies, with the one-inference solver kept in
    // the mix as a cost (docs/plans/blind-answer-leak.md). Stems and answers
    // are unchanged, the options are not.
    const digests: Record<string, string> = {
      "composed-transform-d4": "18ac7832ecf87e1a784c0ef53cba5b1c8a44f3118927224445c30983849df38d",
      "composed-transform-d5": "b5a5708de9facd980d490bd58b835612e455f61035031c1e58b98dd941f62475",
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

  it("keeps held-out composed-transform combinations out of the public generator", () => {
    const fingerprintOf = (program: SceneComposedProgram) =>
      createHash("sha256").update(`composed-transform-v2:${sceneComposedProgramKey(program)}`)
        .digest("hex").slice(0, 16);
    const buckets = [
      { bucket: "composed-transform-d4", gateCount: 2, stemPanels: 9 },
      { bucket: "composed-transform-d5", gateCount: 3, stemPanels: 12 },
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
      // public. Two gates reserve nothing, so there is nothing to draw and the
      // generator says so instead of quietly serving a public program.
      if (heldOutPrograms.length === 0) {
        expect(() => generateHeldOutComposedTransformCandidate(
          seededRng("held-out-leakage", `eval:${bucket}`), gateCount, bucket)).toThrow();
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

  it("locks the transformation-machine grammar and its servable population", () => {
    // The oracle searches 4 board moves x 2 fills x 8 duplication sources = 64
    // machines. A draw also places the two query tokens — any ordered pair of
    // the 8 cells around the centre, 56 — and picks which of them the
    // duplication gate copies, which fixes the source: 4 x 2 x 56 x 2 = 896
    // draws. Single-gate ablation removes exactly the 16 whose query sits on
    // both off-centre cells of a reflection's own axis (2 reflections x 2 cell
    // orders x 2 fills x 2 tokens to copy), where the board move moves nothing.
    // 880 servable draws times 12 shape pairs is 10,560 questions; before
    // 2026-09-28 the family could ask 96.
    expect(transformationMachineGrammar()).toHaveLength(64);
    const draws = servableTransformationMachineDraws();
    expect(draws).toHaveLength(880);
    // Every machine in the grammar is reachable by some draw.
    expect(new Set(draws.map((draw) => JSON.stringify(draw.program))).size).toBe(64);
    // The duplication source is always where the board move carries the copied
    // token, so the third worked row and the query agree.
    for (const draw of draws) {
      const copied = draw.queryCells[draw.copies];
      const moved = applySceneUnary({
        kind: "scene", rows: 3, columns: 3, tiles: [],
        objects: [{ ...copied, object: { kind: "token", shape: "circle", rotation: 0, fill: "outline", size: "l" } }],
      }, draw.program.gateA)!.objects[0];
      expect({ row: moved.row, column: moved.column }).toEqual(draw.program.gateC.from);
    }
  });

  it("proves every servable transformation-machine draw needs every gate it displays", () => {
    // Exhaustive, on the board the family itself decides servability against.
    // Removing any one gate has to change the answer, or the item shows a step
    // a solver could skip.
    for (const draw of servableTransformationMachineDraws()) {
      const query = canonicalTransformationMachineQuery(draw);
      const gates = transformationMachineGates(draw.program);
      expect(gates, JSON.stringify(draw)).toHaveLength(3);
      let answer: Scene | null = query;
      for (const gate of gates) answer = answer && applySceneUnary(answer, gate);
      expect(answer, JSON.stringify(draw)).not.toBeNull();
      for (let gate = 0; gate < gates.length; gate++) {
        let ablated: Scene | null = query;
        for (const [index, step] of gates.entries()) {
          if (index === gate) continue;
          ablated = ablated && applySceneUnary(ablated, step);
        }
        if (ablated === null) continue; // a run that does not apply cannot reproduce the answer
        expect(sceneSignature(ablated), `gate ${gate} of ${JSON.stringify(draw)} is removable`)
          .not.toBe(sceneSignature(answer!));
      }
    }
  });

  it("shows every gate of a served machine item doing visible work", () => {
    // The end-to-end reading of the ablation rule: take the item a taker is
    // actually served, recover each gate from its own worked row, and check
    // that dropping any one of them changes the answer.
    //
    // The pool a row is matched against is the family's WHOLE gate vocabulary,
    // not just the operations that may stand in that row's slot. A worked row
    // that two different operations explain is an ambiguous item however tidy
    // the grammar is.
    const pool = [...new Map(transformationMachineGrammar()
      .flatMap((program) => transformationMachineGates(program))
      .map((gate) => [JSON.stringify(gate), gate])).values()];
    // 4 board moves, 2 fills, 8 duplication sources.
    expect(pool).toHaveLength(14);
    const spatialAndFill = new Set<string>();
    const sources = new Set<string>();
    const queries = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const candidate = generateSceneFamilyCandidate(
        "transformation-machine-v3",
        seededRng("machine-gate-necessity", `${seed}`),
        "transformation-machine-d5",
      );
      const { puzzle } = candidate;
      // 12 panels: three worked (input, gate, output) rows plus the query row.
      expect(puzzle.stem).toHaveLength(12);
      const panels = puzzle.stem.map((panel) => "blank" in panel ? null : panel);
      const gates = Array.from({ length: 3 }, (_, row) => {
        const input = panels[row * 3]!;
        const output = panels[row * 3 + 2]!;
        const matches = pool.filter((gate) => {
          const predicted = applySceneUnary(input, gate);
          return predicted !== null && sceneSignature(predicted) === sceneSignature(output);
        });
        expect(matches.length, `seed ${seed} row ${row}`).toBe(1);
        return matches[0];
      });
      // The fingerprint names exactly the machine the worked rows show.
      const [gateA, gateB, gateC] = gates;
      expect(candidate.definition.programFingerprint!(puzzle), `seed ${seed}`).toBe(createHash("sha256")
        .update(`transformation-machine-v3:${JSON.stringify({ gateA, gateB, gateC })}`).digest("hex").slice(0, 16));
      spatialAndFill.add(JSON.stringify([gateA, gateB]));
      sources.add(JSON.stringify(gateC));
      const query = panels[9]!;
      queries.add(sceneSignature(query));
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
    // Every board move, fill, and duplication source really is served, and the
    // query really moves: the widened space is the shipped one, not a list
    // nobody draws from.
    expect(spatialAndFill.size).toBe(8);
    expect(sources.size).toBe(8);
    expect(queries.size).toBeGreaterThan(100);
  });

  it("keeps transformation-machine d5 replaying byte for byte", () => {
    //
    // REISSUED 2026-09-28, deliberately: the family was widened past its 96
    // possible questions (the duplication source became a gate of its own and
    // the query tokens stand anywhere around the centre), and the explanations
    // now name "the correct answer" rather than a highlighted board. Anyone who
    // sees this digest change again without that kind of note in the commit
    // should treat it as an accident.
    //
    // REISSUED 2026-09-29, deliberately: the options-only leak
    // (docs/plans/blind-answer-leak.md). The family draws on a misread machine
    // that also stops early or runs out of order, and — re-taken a second time
    // that day, before any release — distractor selection spreads the answer's
    // rank evenly on every options-only measure instead of banning it from the
    // top ranks. Stems and answers are unchanged, the options are not.
    //
    // REISSUED 2026-09-30, deliberately: agreement (some wrong option sharing
    // each aspect of the answer) stopped being a hard rule and became two
    // balanced options-only strategies, with the one-inference solver kept in
    // the mix as a cost (docs/plans/blind-answer-leak.md). Stems and answers
    // are unchanged, the options are not.
    const digests: Record<string, { familyId: SceneFamilyId; digest: string }> = {
      "transformation-machine-d5": {
        familyId: "transformation-machine-v3",
        digest: "d6763f9e9d5e785de61ddc4b5f8ac005c3ae51f643979bf393b4f6ccf65f7659",
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

  it("rarely lets one inference decide a combining-machine item, at both depths", () => {
    // The regression gate for the aspect work of 2026-08-27, on fixed seeds so a
    // change in the family moves this number rather than passing silently.
    //
    // The near-miss pool holds the board that sits exactly where the answer sits
    // (the clash read the wrong way round) and the board that carries exactly
    // its shapes (the exclusive token kept from the wrong board). Until
    // 2026-09-28 d5 had a stated residual of up to 6 in 40: the live search for a
    // covering gate order was capped, and when the cap ran out it served a
    // merely sound chain. The family now draws only from the covering chains, so
    // d5 was held to zero like d4. Since 2026-09-30 agreement is a balanced
    // strategy rather than a hard rule (see "rarely lets one inference pick the
    // answer" above), so both depths are held to the same gross bound.
    const ms = (values: string[]) => [...values].sort().join("|");
    const aspects: Record<string, (scene: Scene) => string> = {
      positions: (scene) => ms(scene.objects.map((p) => `${p.row},${p.column}`)),
      shapes: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? p.object.shape : "-")),
      fills: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? p.object.fill : "-")),
      rotations: (scene) => ms(scene.objects.map((p) => p.object.kind === "token" ? String(p.object.rotation) : "-")),
      count: (scene) => String(scene.objects.length),
    };
    for (const bucket of ["combining-machine-d4", "combining-machine-d5"]) {
      let leaking = 0;
      for (let seed = 0; seed < 40; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          "combining-machine-v1", seededRng("single-inference", `${bucket}:${seed}`), bucket);
        const answer = puzzle.options[puzzle.answerIndex];
        const decided = Object.values(aspects).some((read) =>
          puzzle.options.filter((option) => read(option) === read(answer)).length === 1);
        if (decided) leaking += 1;
      }
      expect(leaking, `${bucket}: ${leaking} of 40 items decided by one aspect`).toBeLessThanOrEqual(20);
    }
  });

  it("draws the combining machine only from the chains the grammar proves can hide the answer", () => {
    // The chains are pinned in the source so no item pays for the search; this
    // re-derives them from every chain the grammar allows. If a change to the
    // near-miss pool, the aspect rule, or the soundness checks moves the list,
    // this fails and names the new one.
    //
    // The sound counts moved on 2026-09-29, from 26 and 48 to 28 and 53, when
    // the pool gained near misses with two mistakes in one run: a few more
    // chains now reach five distinct near misses. The covering chains did not
    // move — no chain gained a board agreeing with its answer on an aspect it
    // lacked.
    for (const [gateCount, sound] of [[2, 28], [3, 53]] as const) {
      const derived = deriveCombiningMachineChains(gateCount);
      expect(derived.covers, `${gateCount} gates`).toEqual(combiningMachineCoveringChains(gateCount).map((chain) => [...chain]));
      expect(derived.sound, `${gateCount} gates`).toHaveLength(sound);
      expect(derived.covers.length + derived.sound.length + derived.unusable.length)
        .toBe(gateCount === 2 ? 8 * 7 : 8 * 7 * 6);
    }
    // And the family really serves them, in run order, and nothing else.
    const COMBINING_OPERATIONS = [
      "union-left", "union-right", "intersection", "overlap-left",
      "overlap-right", "subtract", "mask-out", "exclusive",
    ] as const;
    for (const bucket of ["combining-machine-d4", "combining-machine-d5"]) {
      const gateCount = declaredGateCounts()[bucket];
      const chains = new Set(combiningMachineCoveringChains(gateCount).map((chain) => JSON.stringify(chain)));
      const served = new Set<string>();
      for (let seed = 0; seed < 60; seed++) {
        const candidate = generateSceneFamilyCandidate(
          "combining-machine-v1", seededRng("combining-chains", `${bucket}:${seed}`), bucket);
        const report = candidate.definition.validate(candidate.puzzle);
        expect(report.solutionCount, `${bucket} seed ${seed}`).toBe(1);
        // The chain the query runs is recovered from the visible item: each
        // worked row's single surviving rule, read in the query strip's order.
        const panels = candidate.puzzle.stem.map((panel) => "blank" in panel ? null : panel);
        const rows = Array.from({ length: gateCount }, (_, row) => panels.slice(row * 4, row * 4 + 4) as Scene[]);
        const byGlyph = new Map(rows.map(([left, glyph, right, output]) => [
          JSON.stringify(glyph.objects[0].object),
          COMBINING_OPERATIONS.find((operation) => {
            const produced = applySceneBinary(left, right, operation);
            return produced !== null && sceneSignature(produced) === sceneSignature(output);
          }),
        ]));
        const strip = panels[gateCount * 4 + 1]!;
        const chain = [...strip.objects]
          .sort((left, right) => left.column - right.column)
          .map((placement) => byGlyph.get(JSON.stringify(placement.object)));
        expect(chains.has(JSON.stringify(chain)), `${bucket} seed ${seed} runs ${JSON.stringify(chain)}`).toBe(true);
        served.add(JSON.stringify(chain));
      }
      expect(served.size, bucket).toBe(chains.size);
    }
  });

  it("judges a combining gate order the same on every draw of roles and shapes", () => {
    // Why the chains can be settled once instead of searched for per item: every
    // combining operation acts cell by cell, so moving the four role cells
    // anywhere moves every board of an item the same way, and renaming shapes
    // renames every token the same way. Proved here on random draws for every
    // three-gate chain, and for a run order other than the worked one: a verdict
    // depends only on the chain the query actually runs.
    const rng = seededRng("combining-invariance");
    const cells = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => ({ row, column })));
    const shapes = ["circle", "square", "triangle", "diamond", "star"] as const;
    const derived = deriveCombiningMachineChains(3);
    const cases = [
      ...derived.covers.map((chain) => [chain, "covers"] as const),
      ...derived.sound.map((chain) => [chain, "sound"] as const),
      ...derived.unusable.filter((_, index) => index % 8 === 0).map((chain) => [chain, "unusable"] as const),
    ];
    for (const [chain, verdict] of cases) {
      for (let draw = 0; draw < 2; draw++) {
        const [shared, clash, leftOnly, rightOnly] = shuffled(rng, cells);
        const runOrder = shuffled(rng, [0, 1, 2]);
        const gates: typeof chain = [];
        runOrder.forEach((gateIndex, step) => { gates[gateIndex] = chain[step]; });
        expect(combiningGateOrderVerdict(gates, runOrder, { shared, clash, leftOnly, rightOnly }, shuffled(rng, shapes)),
          JSON.stringify(chain)).toBe(verdict);
      }
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

describe("answered strand declarations", () => {
  // Which stem panels the strand containing the blank occupies. A row family
  // used to declare a bare count and the build gate had to believe it; these
  // indexes are checked against the puzzle instead.
  const ROW_FAMILIES = [
    { familyId: "relational-sequence-v2", panelIndexes: [0, 1, 2] },
    { familyId: "second-order-sequence-v2", panelIndexes: [0, 1, 2, 3, 4] },
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
