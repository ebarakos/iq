import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import {
  FILL_LOOP,
  OPTIONS_PER_ITEM,
  PuzzleSchema,
  sceneSignature,
  type Scene,
  type SceneToken,
} from "./schema";
import { puzzleToSvg } from "./compose-image";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { sceneEditDistance } from "./scene-distance";
import { optionsAloneOnAClue } from "./blind-options";
import {
  boardKey,
  machineWorkedRowReadings,
  secondReadings,
} from "./worked-row-readings";
import { createHash } from "node:crypto";
import {
  declaredGateCounts,
  MINIMUM_OBSERVED_TERMS_IN_ANSWERED_STRAND,
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
  resetExhaustedDistractorSearches,
  servableComposedTransformPrograms,
  servableTransformationMachineDraws,
  transformationMachineGates,
  transformationMachineGrammar,
  exhaustedDistractorSearches,
  RELATIONAL_SEQUENCE_SHOWN_PICTURES,
  SCENE_FAMILY_CLUE_MODELS,
  validateSceneFamilyCandidate,
  type SceneFamilyId,
} from "./scene-families";
import {
  SCENE_BINARY_OPERATIONS,
  applySceneBinary,
  applySceneComposedProgram,
  applySceneCompositionPrimitive,
  applySceneUnary,
  sceneComposedPrimitives,
  sceneComposedProgramKey,
  sceneComposedProgramSteps,
  type SceneBinaryOperation,
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
        expect(PuzzleSchema.safeParse(first.puzzle).success, `${familyId} ${bucket}`).toBe(true);
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

  it("explains every answer in the taker's words, never in the generator's", () => {
    // The review screen shows the explanation to the person who just took the
    // test: what to look at and how to reach the answer. Owner's rule of
    // 2026-10-04, after an explanation ended "Distractors stop early, run the
    // gates in another order, misread a gate…" (CLAUDE.md, Hard rules).
    const generatorWords = /distractor|near.?miss|grammar|program|primitive|bounded|witness|candidate|generator|query|worked|\binputs?\b|\boutputs?\b|token|\bslots?\b|\bgates?\b|anchor|perimeter|\bfails?\b|\bhalf\b(?!-turn)|\bsolid\b|\boutline\b/i;
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      for (let seed = 0; seed < 30; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng(`taker-words:${seed}`, bucket), bucket);
        expect(puzzle.explanation, `${familyId} ${bucket} seed ${seed}`).not.toMatch(generatorWords);
      }
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
            : /mirrors|flips/.test(spatial.puzzle.explanation)
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
    // composed-transform-v2's intermediate two-step space has 12 servable
    // programs (16 until 2026-10-04, when the four that fill after carrying the
    // arrow into the fill square stopped being served), and
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
      { familyId: "composed-transform-v2", queryIndex: 6, expectedPrograms: 12 },
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
    // compositional-analogy's keys were re-taken on 2026-10-03 (see below).
    // visual-set-algebra's were re-taken on 2026-08-27 for the reason noted on
    // them: that family was rebuilt on purpose, and this test is what proved
    // the rebuild touched nothing else.
    //
    // REISSUED 2026-09-30, deliberately: agreement (some wrong option sharing
    // each aspect of the answer) stopped being a hard rule and became two
    // balanced options-only strategies, with the one-inference solver kept in
    // the mix as a cost (docs/plans/blind-answer-leak.md). Stems and answers
    // are unchanged, the options are not.
    //
    // REISSUED 2026-10-03 for compositional-analogy-d3 only, deliberately
    // (scene-families-v20, docs/plans/unambiguous-reading.md): the worked and
    // question boards now share two randomly drawn fills, so every fill change
    // the answer needs is shown, where the worked board used to be fixed at
    // white and gray and the question board at gray and black. Stems, answers
    // and options all moved; visual-set-algebra-d4 did not, which is what this
    // test proves about the shared builders.
    //
    // REISSUED 2026-10-03, deliberately (scene-families-v21,
    // docs/plans/blind-answer-leak.md, "One clue is never enough"): every clue
    // any option shows must now appear on two options, and the one-inference
    // cost left the option game. Stems and answers are unchanged, checked
    // against v20 on these very seeds; the options are not.
    const goldens: Record<string, { familyId: SceneFamilyId; bucket: string; keys: string[] }> = {
      "compositional-analogy-d3-golden": {
        familyId: "compositional-analogy-v2",
        bucket: "compositional-analogy-d3",
        keys: [
          "5af064e78e7acb6af8bd093d",
          "e436c9750831cac81896adb4",
          "1c7c2fcf8307f6638ce08f96",
          "94cfe2bc628bfd03e3746223",
          "d7e7579e40f9aa3783f374fc",
          "1b5e1132cbd97b3dbdd737bd",
          "05a9941fa7f631844055aef7",
          "bdfe8889966ea96fbc367f19",
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
        //
        // Re-taken on 2026-10-04 (scene-families-v23,
        // docs/plans/one-reading-per-worked-row.md): the family now redraws when
        // both worked results stand on the same squares or a step of its rule
        // never shows, and keeps any board another reading of the rows predicts
        // out of the options. Two of the eight keys moved; across 200 items, 13
        // stems and 14 option lists did.
        keys: [
          "a06a30cc6e06eb2db11a3652",
          "93ed401ad371cb3338c77360",
          "2e38f158c9020a80cbb0794e",
          "e46b1709bfdc5d17ccc4434c",
          "7013978c6e935e526f9e475b",
          "ea0e24cd6a6361d9da88896c",
          "532a6b8f1666ea9bc74b7694",
          "e43e7414704bde135bf5364d",
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

  it("never lets one clue pick out any option, in any bucket a family can generate", () => {
    // The owner's report of 2026-08-27: "using only one first inference you can
    // select the right answer without looking at the other rules". From then
    // until 2026-10-03 this test only asked that one inference pick the answer
    // in at most half of 40 items, because a hard rule had made the answer the
    // one option that always shared everything, which gave it away to a solver
    // who never read the question (docs/plans/blind-answer-leak.md). Measured on
    // 2026-10-03, one clue still picked the answer in up to 31% of items, and in
    // up to 66% when the clue was one shape's fill. The owner's rule that day:
    // "You should never be able to guess this answer through them or with 1 out
    // of x clues needed to solve a test." So the rule is now absolute, and it
    // holds for EVERY option, not only the answer: every clue any option shows
    // appears on at least two, under the clue model of the option's family
    // (`SCENE_FAMILY_CLUE_MODELS`).
    //
    // The second-order sequence is the one exception, by the owner's decision
    // the same day: its whole rule is one clue, where the token lands, so a
    // wrong option sharing it would be the answer.
    for (const { familyId, bucket } of FAMILY_BUCKETS) {
      const model = SCENE_FAMILY_CLUE_MODELS[familyId];
      if (model === "whole-rule") continue;
      for (let seed = 0; seed < 30; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          familyId, seededRng("one-clue", `${bucket}:${seed}`), bucket);
        expect([...optionsAloneOnAClue(puzzle.options as Scene[], model)], `${bucket} seed ${seed}: options alone on a clue`)
          .toEqual([]);
      }
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
    // ablation, having five distinct wrong runs to offer, and, since 2026-10-04,
    // never asking a fill gate to colour the arrow. That last rule took two
    // gates from 16 to 12 (a fill after the left-right mirror or the
    // anticlockwise turn, which both carry the arrow into the upper-left slot)
    // and three gates from 192 to 152.
    expect(servableComposedTransformPrograms(2)).toHaveLength(12);
    expect(servableComposedTransformPrograms(3)).toHaveLength(152);
    for (const gateCount of [2, 3] as const) {
      const { publicPrograms, heldOutPrograms } = partitionComposedTransformPrograms(gateCount);
      expect(publicPrograms.length + heldOutPrograms.length, `${gateCount} gates`)
        .toBe(servableComposedTransformPrograms(gateCount).length);
    }
    expect(partitionComposedTransformPrograms(2).publicPrograms).toHaveLength(12);
    expect(partitionComposedTransformPrograms(2).heldOutPrograms).toHaveLength(0);
    expect(partitionComposedTransformPrograms(3).publicPrograms).toHaveLength(128);
    expect(partitionComposedTransformPrograms(3).heldOutPrograms).toHaveLength(24);

    // The headline number from the plan's diagnosis. Before turns existed the
    // three-gate public pool was 56 programs, and 16 of them painted the
    // upper-left slot twice with nothing in between, so the first paint was
    // invisible and the "three-step" item really needed two. Those 16 are
    // exactly what single-gate ablation removes, which left 40. The arrow rule
    // of 2026-10-04 removes 16 more, leaving 24.
    const turnFree = (program: SceneComposedProgram) =>
      sceneComposedProgramSteps(program).every((step) => step.kind !== "turn");
    expect(partitionComposedTransformPrograms(3).publicPrograms.filter(turnFree)).toHaveLength(24);
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
    //
    // REISSUED 2026-10-03, deliberately (scene-families-v21,
    // docs/plans/blind-answer-leak.md, "One clue is never enough"): every clue
    // any option shows must now appear on two options, and the one-inference
    // cost left the option game. Stems and answers are unchanged, checked
    // against v20 on these very seeds; the options are not.
    //
    // REISSUED 2026-10-04, deliberately (scene-families-v22): gates are drawn
    // as jigsaw pieces, so the explanations name each gate by its piece ("the
    // dotted piece") instead of "Gate A" or "the outline triangle". The same day
    // the fill gate's worked arrow moved off the diagonal, from the lower-right
    // square to the one left of it (docs/plans/one-reading-per-worked-row.md).
    // Checked against v21 on 200 items: options, answers and every other panel
    // are unchanged; only the fill rows' arrow moved. Later that day every
    // explanation was rewritten for the person reading it (CLAUDE.md, Hard
    // rules); with explanations left out, 450 items across every bucket are
    // unchanged.
    //
    // REISSUED 2026-10-04, deliberately (scene-families-v23,
    // docs/plans/one-reading-per-worked-row.md): a program whose fill gate lands
    // on the arrow is no longer served (two gates went from 16 programs to 12,
    // public three-gate programs from 168 to 128), so these seeds draw other
    // programs, and the left-right mirror's worked arrow points sideways. On
    // these 50 seeds 35 d4 items and all 50 d5 items moved; the other 15 d4
    // items are unchanged.
    //
    // REISSUED 2026-10-04, deliberately (scene-families-v24): the fill gate's
    // worked row shows its shape twice and colours only the top-left one, so
    // "colour that kind of shape" no longer fits; both models took that reading
    // in the v23 re-run. Checked against v23 on 200 items per bucket: only the
    // fill rows' two panels moved; options, answers and explanations did not.
    const digests: Record<string, string> = {
      "composed-transform-d4": "315ddfc6c161f9b3cad1fd8d4c1158a7edb66e6c995687ce346492ed5a53fc96",
      "composed-transform-d5": "caa6e87c57f9e6be2ce4df7885db0d0c9ba1d2d856b99fddd97b207505f2472b",
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
    //
    // REISSUED 2026-10-03, deliberately (scene-families-v21,
    // docs/plans/blind-answer-leak.md, "One clue is never enough"): every clue
    // any option shows must now appear on two options, and the one-inference
    // cost left the option game. Stems and answers are unchanged, checked
    // against v20 on these very seeds; the options are not. The run that stops
    // before the duplication gate is no longer a required option.
    //
    // REISSUED 2026-10-04, deliberately (scene-families-v22): gates are drawn
    // as jigsaw pieces, so the explanations name each gate by its piece ("the
    // dotted piece") instead of "Gate A" or "the outline triangle". With the
    // explanation left out, every puzzle on these seeds is unchanged against v21.
    // The explanations were rewritten again the same day, for the person
    // reading them (CLAUDE.md, Hard rules); nothing else changed.
    //
    // REISSUED 2026-10-04, deliberately (scene-families-v23,
    // docs/plans/one-reading-per-worked-row.md): the copy row shows a second
    // token the gate leaves alone, so neither "flip the board, then copy" nor
    // "copy every shape" fits it. Its cell is drawn at random, so the option
    // lists come from a later point in the stream: on these 50 seeds every copy
    // row and every option list moved, and no answer did.
    const digests: Record<string, { familyId: SceneFamilyId; digest: string }> = {
      "transformation-machine-d5": {
        familyId: "transformation-machine-v3",
        digest: "3f87a3b9259fe7fe56ac70ae7ec82793a6f034ac64e114408da0ff6a06143aef",
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

});

describe("one reading per worked row", () => {
  // The eight flips and turns of a 3 x 3 board, moving squares only: the
  // composed grammar moves board slots and never turns a token with them.
  const SYMMETRIES: Record<string, (row: number, column: number) => [number, number]> = {
    "quarter turn": (row, column) => [column, 2 - row],
    "half turn": (row, column) => [2 - row, 2 - column],
    "three-quarter turn": (row, column) => [2 - column, row],
    "top-bottom flip": (row, column) => [2 - row, column],
    "left-right flip": (row, column) => [row, 2 - column],
    "diagonal flip": (row, column) => [column, row],
    "anti-diagonal flip": (row, column) => [2 - column, 2 - row],
  };
  const move = (board: Scene, name: string): Scene => ({
    ...board,
    objects: board.objects.map((placement) => {
      const [row, column] = SYMMETRIES[name](placement.row, placement.column);
      return { row, column, object: placement.object };
    }),
  });

  it("never lets a composed-transform worked row also fit a flip or turn it does not show", () => {
    // Opus 5.5 flagged it on 2026-10-04 and it was measured the same day: the
    // fill gate's worked board had both tokens on the diagonal, so "flip across
    // it, then repaint" fit the row, and in 131 of 200 d4 items a wrong option
    // followed (docs/plans/one-reading-per-worked-row.md).
    for (const bucket of ["composed-transform-d4", "composed-transform-d5"]) {
      for (let seed = 0; seed < 60; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(
          "composed-transform-v2", seededRng("one-reading", `${bucket}:${seed}`), bucket);
        const stem = puzzle.stem as Scene[];
        for (let row = 0; row < stem.length / 3 - 1; row++) {
          const [input, , output] = stem.slice(row * 3, row * 3 + 3);
          const target = sceneSignature(output);
          const fits = (board: Scene | null) => board !== null && sceneSignature(board) === target;
          const shown = sceneComposedPrimitives().filter((step) => fits(applySceneCompositionPrimitive(input, step)));
          expect(shown, `${bucket} seed ${seed} row ${row + 1}`).toHaveLength(1);
          for (const name of Object.keys(SYMMETRIES)) {
            const after = applySceneCompositionPrimitive(input, shown[0]);
            expect(fits(applySceneCompositionPrimitive(move(input, name), shown[0])), `${bucket} seed ${seed} row ${row + 1}: ${name}, then the gate`)
              .toBe(false);
            expect(fits(after && move(after, name)), `${bucket} seed ${seed} row ${row + 1}: the gate, then ${name}`)
              .toBe(false);
          }
        }
      }
    }
  });
});

describe("no second reading lands on a wrong option", () => {
  // The owner's rule: no hidden convention may decide an answer. The v22 tests
  // of 2026-10-04 found readings the worked rows allowed that cost answers; the
  // check in worked-row-readings.ts tries the readings a person reaches for, and
  // families:verify runs it on 200 items per bucket
  // (docs/plans/one-reading-per-worked-row.md).
  const CHECKED: readonly [SceneFamilyId, string][] = [
    ["composed-transform-v2", "composed-transform-d4"],
    ["composed-transform-v2", "composed-transform-d5"],
    ["transformation-machine-v3", "transformation-machine-d5"],
    ["visual-set-algebra-v2", "visual-set-algebra-d4"],
    ["visual-set-algebra-v2", "visual-set-algebra-d5"],
  ];

  it("holds in every checked bucket", () => {
    for (const [familyId, bucket] of CHECKED) {
      for (let seed = 0; seed < 60; seed++) {
        const { puzzle } = generateSceneFamilyCandidate(familyId, seededRng("second-reading", `${bucket}:${seed}`), bucket);
        expect(secondReadings(familyId, puzzle), `${bucket} seed ${seed}`).toEqual([]);
      }
    }
  });

  // Hand-built questions with the flaws the v22 tests found: the check has to
  // name each one.
  const board = (objects: [number, number, SceneToken["shape"], SceneToken["fill"]?, number?][]): Scene => ({
    kind: "scene",
    rows: 3,
    columns: 3,
    tiles: [],
    objects: objects.map(([row, column, shape, fill = "outline", rotation = 0]) => ({
      row,
      column,
      object: { kind: "token", shape, rotation, fill, size: "l" },
    })),
  });
  const glyph = (shape: SceneToken["shape"]) => board([[1, 0, shape, "solid"]]);
  const strip = (...shapes: SceneToken["shape"][]) =>
    board(shapes.map((shape, column) => [1, column, shape, "solid"] as [number, number, SceneToken["shape"], SceneToken["fill"]]));
  const filler = [board([[0, 1, "star"]]), board([[2, 2, "star"]]), board([[1, 1, "hexagon"]]), board([[2, 1, "circle"]])];

  it("names a mirror that turns arrows round too, when its row shows only an up arrow", () => {
    const answer = board([[0, 0, "arrow", "outline", 90], [0, 2, "square"], [2, 2, "circle"]]);
    const mirrorImage = board([[0, 0, "arrow", "outline", 270], [0, 2, "square"], [2, 2, "circle"]]);
    const puzzle = {
      stem: [
        board([[0, 0, "triangle"], [1, 2, "arrow", "solid"]]), glyph("square"), board([[0, 2, "triangle"], [1, 0, "arrow", "solid"]]),
        board([[0, 0, "square"], [1, 2, "arrow", "solid"]]), glyph("diamond"), board([[0, 0, "square"], [1, 2, "arrow", "solid", 90]]),
        board([[0, 0, "square"], [0, 2, "arrow"], [2, 0, "circle"]]), strip("diamond", "square"), { blank: true },
      ],
      options: [answer, mirrorImage, ...filler],
      answerIndex: 0,
    };
    const found = secondReadings("composed-transform-v2", puzzle);
    expect(found.map((reading) => reading.option)).toEqual([1]);
    expect(found[0].reading).toContain("of the whole picture");
  });

  it("names a fill that never colours an arrow, when the question carries the arrow into its square", () => {
    const answer = board([[0, 0, "arrow", "half"], [0, 2, "square"], [2, 2, "diamond"]]);
    const arrowSkipped = board([[0, 0, "arrow"], [0, 2, "square"], [2, 2, "diamond"]]);
    const puzzle = {
      stem: [
        board([[0, 0, "triangle"], [1, 2, "arrow", "solid", 90]]), glyph("square"), board([[0, 2, "triangle"], [1, 0, "arrow", "solid", 90]]),
        board([[0, 0, "circle"], [1, 2, "circle"], [2, 1, "arrow"]]), glyph("diamond"),
        board([[0, 0, "circle", "half"], [1, 2, "circle"], [2, 1, "arrow"]]),
        board([[0, 0, "square"], [0, 2, "arrow"], [2, 0, "diamond"]]), strip("square", "diamond"), { blank: true },
      ],
      options: [answer, arrowSkipped, ...filler],
      answerIndex: 0,
    };
    const found = secondReadings("composed-transform-v2", puzzle);
    expect(found.map((reading) => reading.option)).toEqual([1]);
    expect(found[0].reading).toContain("never an arrow");
  });

  it("names a fill that colours one kind of shape, when the example shows one shape of that kind", () => {
    // The v23 re-run's Q30: the example coloured a star in the top-left square,
    // the question started with a star there, and both models coloured the star
    // after the pieces had moved it.
    const answer = board([[0, 0, "triangle", "half"], [0, 2, "star"], [2, 2, "arrow"]]);
    const starColoured = board([[0, 0, "triangle"], [0, 2, "star", "half"], [2, 2, "arrow"]]);
    const puzzle = {
      stem: [
        board([[0, 0, "diamond"], [1, 2, "arrow", "solid"]]), glyph("square"), board([[0, 2, "diamond"], [2, 1, "arrow", "solid"]]),
        board([[0, 0, "star"], [2, 1, "arrow"]]), glyph("diamond"), board([[0, 0, "star", "half"], [2, 1, "arrow"]]),
        board([[0, 0, "star"], [0, 2, "arrow"], [2, 0, "triangle"]]), strip("square", "diamond"), { blank: true },
      ],
      options: [answer, starColoured, ...filler],
      answerIndex: 0,
    };
    const found = secondReadings("composed-transform-v2", puzzle);
    expect(found.map((reading) => reading.option)).toEqual([1]);
    expect(found[0].reading).toContain("every star turning grey");
  });

  it("names a flip the copy row cannot see, when it shows one token on a diagonal", () => {
    // The lone token at the bottom-left sits on the top-right diagonal, so a
    // flip across it changes nothing in the row, then the copy runs.
    const copyRow = [board([[2, 0, "diamond", "solid"]]), glyph("star"), board([[2, 0, "diamond", "solid"], [1, 1, "diamond", "solid"]])];
    const query = board([[2, 0, "diamond", "solid"], [0, 1, "triangle", "solid"]]);
    const answer = board([[2, 0, "diamond", "solid"], [0, 1, "triangle", "solid"], [1, 1, "diamond", "solid"]]);
    const flippedFirst = board([[2, 0, "diamond", "solid"], [1, 2, "triangle", "solid"], [1, 1, "diamond", "solid"]]);
    const puzzle = {
      stem: [
        board([[0, 0, "circle"], [1, 2, "square", "solid"]]), glyph("square"), board([[0, 0, "circle", "half"], [1, 2, "square", "half"]]),
        ...copyRow,
        query, strip("star"), { blank: true },
      ],
      options: [answer, flippedFirst, ...filler],
      answerIndex: 0,
    };
    const found = secondReadings("transformation-machine-v3", puzzle);
    expect(found.map((reading) => reading.option)).toEqual([1]);
    expect(found[0].reading).toContain("top-right diagonal");
  });

  it("names a set-algebra move that neither worked row shows", () => {
    // Intersection keeps one token per row, and the left-right mirror leaves
    // the centre and the middle column where they were, so "no move" fits both.
    const unmoved = board([[0, 0, "circle"]]);
    const puzzle = {
      stem: [
        board([[1, 1, "circle"], [0, 0, "square"]]), board([[1, 1, "circle"], [2, 2, "diamond"]]), board([[1, 1, "circle"]]),
        board([[0, 1, "star"], [2, 0, "square"]]), board([[0, 1, "star"], [1, 2, "diamond"]]), board([[0, 1, "star"]]),
        board([[0, 0, "circle"], [2, 2, "square"]]), board([[0, 0, "circle"], [1, 0, "diamond"]]), { blank: true },
      ],
      options: [board([[0, 2, "circle"]]), unmoved, ...filler],
      answerIndex: 0,
    };
    const found = secondReadings("visual-set-algebra-v2", puzzle);
    expect(found.map((reading) => reading.option)).toEqual([1]);
    expect(found[0].reading).toContain("no move");
  });

  it("reads set algebra with the right board first and a wrapped slide, and never offers that board", () => {
    // Codex's review of 2026-10-05: on this d5 seed both rows fit "keep the right
    // board's shapes where the left board is empty, slide them one square left,
    // wrapping, turn them a quarter clockwise", and the item offered that board.
    const { puzzle } = generateSceneFamilyCandidate(
      "visual-set-algebra-v2", seededRng("blind-gate-v2", "visual-set-algebra-d5:107"), "visual-set-algebra-d5");
    const stem = puzzle.stem as Scene[];
    const alternative = (left: Scene, right: Scene): Scene => {
      const onlyRight = applySceneBinary(right, left, "mask-out")!;
      return {
        ...onlyRight,
        objects: onlyRight.objects.map((placement) => ({
          ...placement,
          column: (placement.column + 2) % 3,
          object: placement.object.kind === "token"
            ? { ...placement.object, rotation: (placement.object.rotation + 90) % 360 }
            : placement.object,
        })),
      };
    };
    for (const row of [0, 3]) {
      expect(boardKey(alternative(stem[row], stem[row + 1])), `row ${row / 3 + 1}`).toBe(boardKey(stem[row + 2]));
    }
    const alternativeBoard = alternative(stem[6], stem[7]);
    const options = puzzle.options as Scene[];
    expect(options.map(boardKey)).not.toContain(boardKey(alternativeBoard));
    // Offered anyway, the check names it.
    const wrong = puzzle.answerIndex === 0 ? 1 : 0;
    const offering = { ...puzzle, options: options.map((option, index) => (index === wrong ? alternativeBoard : option)) };
    const found = secondReadings("visual-set-algebra-v2", offering);
    expect(found.map((reading) => reading.option)).toEqual([wrong]);
    expect(found[0].reading).toContain("with the right board first");
  });
});

describe("worked rows that pin their reading", () => {
  const machineRows = (puzzle: { stem: readonly unknown[] }) => {
    const stem = puzzle.stem as Scene[];
    return Array.from({ length: stem.length / 3 - 1 }, (_, row) => stem.slice(row * 3, row * 3 + 3));
  };

  it("never asks a composed-transform fill piece to colour the arrow", () => {
    // Every fill example colours a shape while an arrow stays uncoloured; in
    // the v22 tests both models lost 5 of 6 answers where the question then
    // carried the arrow into the fill square.
    for (const bucket of ["composed-transform-d4", "composed-transform-d5"]) {
      for (let seed = 0; seed < 100; seed++) {
        const { puzzle } = generateSceneFamilyCandidate("composed-transform-v2", seededRng("fill-on-arrow", `${bucket}:${seed}`), bucket);
        const rows = machineRows(puzzle);
        const steps = new Map(rows.map(([input, gate, output]) => [
          JSON.stringify(gate.objects[0].object),
          sceneComposedPrimitives().find((step) => {
            const shown = applySceneCompositionPrimitive(input, step);
            return shown !== null && sceneSignature(shown) === sceneSignature(output);
          })!,
        ]));
        const stem = puzzle.stem as Scene[];
        let current: Scene | null = stem.at(-3)!;
        for (const placement of [...stem.at(-2)!.objects].sort((left, right) => left.column - right.column)) {
          const step = steps.get(JSON.stringify(placement.object))!;
          if (step.kind === "setFillAt") {
            const target = current!.objects.find((held) => held.row === step.at.row && held.column === step.at.column);
            expect(target?.object.kind === "token" && target.object.shape, `${bucket} seed ${seed}`).not.toBe("arrow");
          }
          current = current && applySceneCompositionPrimitive(current, step);
        }
      }
    }
  });

  it("shows every fill change an attribute-pairing answer needs", () => {
    // The question starts in the worked pair's first fill and, when the fill
    // changes, ends in its second, so every reading of the shown change agrees:
    // "one step darker", "swap black and white" and "the fill changes" alike.
    // Before 2026-10-04 the question started in a third fill, and the step and
    // swap readings kept it, which was an option (both models took the swap in
    // the v25 re-run).
    let changes = 0;
    for (let seed = 0; seed < 300; seed++) {
      const { puzzle } = generateSceneFamilyCandidate("attribute-pairing-v1", seededRng("pairing-fill", String(seed)), "attribute-pairing-d2");
      const [worked, workedAfter, question] = (puzzle.stem as Scene[]).map((board) => (board.objects[0].object as SceneToken).fill);
      const answer = ((puzzle.options[puzzle.answerIndex] as Scene).objects[0].object as SceneToken).fill;
      expect(question, `seed ${seed}`).toBe(worked);
      expect(answer, `seed ${seed}`).toBe(workedAfter);
      if (worked !== workedAfter) changes += 1;
    }
    expect(changes).toBeGreaterThan(100);
  });

  it("shows a composed-transform fill piece on two shapes of one kind, colouring only the top-left one", () => {
    let fillRows = 0;
    for (const bucket of ["composed-transform-d4", "composed-transform-d5"]) {
      for (let seed = 0; seed < 100; seed++) {
        const { puzzle } = generateSceneFamilyCandidate("composed-transform-v2", seededRng("two-of-a-kind", `${bucket}:${seed}`), bucket);
        for (const [input, , output] of machineRows(puzzle)) {
          const changed = output.objects.filter((placement) => !input.objects.some((before) =>
            before.row === placement.row && before.column === placement.column && JSON.stringify(before.object) === JSON.stringify(placement.object)));
          if (changed.length !== 1 || changed[0].row !== 0 || changed[0].column !== 0 ||
            input.objects.length !== output.objects.length) continue;
          fillRows += 1;
          const kind = (changed[0].object as SceneToken).shape;
          const sameKind = input.objects.filter((placement) => (placement.object as SceneToken).shape === kind);
          expect(sameKind, `${bucket} seed ${seed}`).toHaveLength(2);
        }
      }
    }
    expect(fillRows).toBeGreaterThan(50);
  });

  it("shows a composed-transform left-right mirror on a sideways arrow", () => {
    let mirrors = 0;
    for (const bucket of ["composed-transform-d4", "composed-transform-d5"]) {
      for (let seed = 0; seed < 100; seed++) {
        const { puzzle } = generateSceneFamilyCandidate("composed-transform-v2", seededRng("sideways-arrow", `${bucket}:${seed}`), bucket);
        for (const [input, , output] of machineRows(puzzle)) {
          const mirrored = applySceneCompositionPrimitive(input, { kind: "spatial", operation: { kind: "reflect", axis: "horizontal" } });
          if (!mirrored || sceneSignature(mirrored) !== sceneSignature(output)) continue;
          mirrors += 1;
          const arrow = input.objects.find((placement) => placement.object.kind === "token" && placement.object.shape === "arrow")!;
          expect([90, 270], `${bucket} seed ${seed}`).toContain((arrow.object as SceneToken).rotation);
        }
      }
    }
    expect(mirrors).toBeGreaterThan(20);
  });

  it("gives the transformation machine's copy row a token that stays put, so the row has one reading", () => {
    for (let seed = 0; seed < 100; seed++) {
      const { puzzle } = generateSceneFamilyCandidate(
        "transformation-machine-v3", seededRng("copy-row", String(seed)), "transformation-machine-d5");
      const [input, , output] = machineRows(puzzle)[2];
      expect(input.objects, `seed ${seed}`).toHaveLength(2);
      expect(output.objects, `seed ${seed}`).toHaveLength(3);
      // Neither "flip the board, then copy" nor "copy every shape" fits it.
      expect(machineWorkedRowReadings("transformation-machine-v3", input, output), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("never shows set-algebra worked outputs on the same squares, and shows every step", () => {
    const squares = (scene: Scene) => scene.objects.map((placement) => `${placement.row},${placement.column}`).sort().join(" ");
    const moves = [
      { kind: "rotate", quarterTurns: 1 },
      { kind: "reflect", axis: "horizontal" },
      { kind: "reflect", axis: "vertical" },
    ] as const;
    const run = (left: Scene, right: Scene, operation: SceneBinaryOperation, move: typeof moves[number] | null, turn: 0 | 1 | 3) => {
      const combined = applySceneBinary(left, right, operation);
      const moved = combined && (move ? applySceneUnary(combined, move) : combined);
      return moved && (turn ? applySceneUnary(moved, { kind: "turn", quarterTurns: turn }) : moved);
    };
    let checked = 0;
    for (const [bucket, turns] of [["visual-set-algebra-d4", [0]], ["visual-set-algebra-d5", [1, 3]]] as const) {
      for (let seed = 0; seed < 100; seed++) {
        const { puzzle } = generateSceneFamilyCandidate("visual-set-algebra-v2", seededRng("set-algebra-rows", `${bucket}:${seed}`), bucket);
        const stem = puzzle.stem as Scene[];
        // Opus 5.5's one miss in the v21 test: both results on one square read
        // as "the result always stands there".
        expect(squares(stem[2]), `${bucket} seed ${seed}`).not.toBe(squares(stem[5]));
        const rows = [[stem[0], stem[1], stem[2]], [stem[3], stem[4], stem[5]]] as const;
        const reproduces = (operation: SceneBinaryOperation, move: typeof moves[number] | null, turn: 0 | 1 | 3) =>
          rows.every(([left, right, output]) => {
            const board = run(left, right, operation, move, turn);
            return board !== null && sceneSignature(board) === sceneSignature(output);
          });
        // Every rule of the family's own grammar that fits both rows shows its
        // move, and in d5 its turn: dropping either step breaks a row.
        for (const operation of SCENE_BINARY_OPERATIONS) {
          for (const move of moves) {
            for (const turn of turns) {
              if (!reproduces(operation, move, turn)) continue;
              checked += 1;
              expect(reproduces(operation, null, turn), `${bucket} seed ${seed}: the move never shows`).toBe(false);
              if (turn !== 0) expect(reproduces(operation, move, 0), `${bucket} seed ${seed}: the turn never shows`).toBe(false);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(200);
  });

  it("offers every d5 set-algebra answer's shapes on other squares too", () => {
    // In 134 of 200 d5 items the answer was the only option with its shapes,
    // so where the shapes stand never had to be worked out.
    const shapes = (scene: Scene) => scene.objects.map((placement) => boardKey({ ...scene, objects: [{ ...placement, row: 0, column: 0 }] })).sort().join("|");
    for (let seed = 0; seed < 100; seed++) {
      const { puzzle } = generateSceneFamilyCandidate(
        "visual-set-algebra-v2", seededRng("shapes-elsewhere", String(seed)), "visual-set-algebra-d5");
      const options = puzzle.options as Scene[];
      const answer = options[puzzle.answerIndex];
      expect(options.filter((option, index) => index !== puzzle.answerIndex && shapes(option) === shapes(answer)).length,
        `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

describe("fill changes are shown before they are needed", () => {
  const fillsOf = (board: Scene) => board.objects.flatMap((placement) =>
    placement.object.kind === "token" ? [placement.object.fill] : placement.object.contents.map((token) => token.fill));
  /** Black to white going forward, or white to black going back: the loop's seam. */
  const crossesSeam = (fill: SceneToken["fill"], delta: 1 | 2) =>
    (delta === 1 && fill === "solid") || (delta === 2 && fill === "outline");

  it("gives an analogy's worked board every fill its question board has", () => {
    // Every token on a board steps its fill by the same amount, so a question
    // token whose fill also sits on the worked board has its change shown.
    for (const [familyId, bucket] of [
      ["compositional-analogy-v2", "compositional-analogy-d3"],
      ["compositional-analogy-v2", "compositional-analogy-d4"],
      ["inverse-analogy-v2", "inverse-analogy-d4"],
    ] as const) {
      let seamQuestions = 0;
      for (let seed = 0; seed < 200; seed++) {
        const puzzle = generateSceneFamilyCandidate(familyId, seededRng("fill-shown", `${bucket}:${seed}`), bucket).puzzle;
        const [worked, workedAfter, question] = puzzle.stem as Scene[];
        const shown = new Set(fillsOf(worked));
        for (const fill of fillsOf(question)) expect(shown.has(fill), `${bucket} seed ${seed}`).toBe(true);
        // The shown step: the one shift that turns the worked board's fills
        // into the fills after it (two different fills make it unique).
        const after = [...fillsOf(workedAfter)].sort().join();
        const delta = ([1, 2] as const).find((step) =>
          fillsOf(worked).map((fill) => FILL_LOOP[(FILL_LOOP.indexOf(fill) + step) % 3]).sort().join() === after)!;
        if (fillsOf(question).some((fill) => crossesSeam(fill, delta))) seamQuestions += 1;
      }
      // The seam still comes up in most questions; it is shown, not avoided.
      expect(seamQuestions, bucket).toBeGreaterThan(100);
    }
  });

  it("shows a sequence's step into the missing picture before it is needed", () => {
    // Four pictures make three steps, a full lap of the three fills, so the
    // step into the missing picture repeats the first one shown — fill and
    // position alike. With three pictures it was always a step nobody had seen.
    expect(RELATIONAL_SEQUENCE_SHOWN_PICTURES).toBe(4);
    let fillsStep = 0;
    for (let seed = 0; seed < 300; seed++) {
      const puzzle = generateSceneFamilyCandidate(
        "relational-sequence-v2", seededRng("fill-shown", `relational-sequence-d2:${seed}`), "relational-sequence-d2",
      ).puzzle;
      expect(puzzle.stem).toHaveLength(RELATIONAL_SEQUENCE_SHOWN_PICTURES + 1);
      // The moving token is the one off the centre; read it picture by picture.
      const moving = (board: Scene) => board.objects.find((placement) => placement.row !== 1 || placement.column !== 1)!;
      const pictures = [...(puzzle.stem.slice(0, -1) as Scene[]), puzzle.options[puzzle.answerIndex] as Scene].map(moving);
      const step = (from: typeof pictures[number], to: typeof pictures[number]) =>
        `${(from.object as SceneToken).fill}>${(to.object as SceneToken).fill}`;
      const shownSteps = pictures.slice(1, -1).map((to, index) => step(pictures[index], to));
      expect(shownSteps, `seed ${seed}`).toContain(step(pictures.at(-2)!, pictures.at(-1)!));
      if (new Set(pictures.map((picture) => (picture.object as SceneToken).fill)).size > 1) {
        fillsStep += 1;
        // A full lap: all three fills appear among the shown pictures.
        expect(new Set(pictures.slice(0, -1).map((picture) => (picture.object as SceneToken).fill)).size).toBe(3);
      }
    }
    expect(fillsStep).toBeGreaterThan(150);
  });
});

describe("grid flow", () => {
  it("marks every grid with the directions its family's rule runs in", () => {
    const expected: Partial<Record<SceneFamilyId, string>> = {
      "relational-matrix-v2": "rowsAndColumns",
      "visual-set-algebra-v2": "rows",
    };
    for (const familyId of SCENE_FAMILY_IDS) {
      for (const { bucket } of SCENE_FAMILY_BUCKETS[familyId]) {
        for (let seed = 0; seed < 5; seed++) {
          let puzzle;
          try {
            puzzle = generateSceneFamilyCandidate(familyId, seededRng("grid-flow", `${bucket}:${seed}`), bucket).puzzle;
          } catch {
            continue;
          }
          // A grid always says where its rule runs; nothing else carries a flow.
          expect(puzzle.gridFlow, bucket).toBe(puzzle.layout === "grid3x3" ? expected[familyId] : undefined);
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
    // Four shown pictures since scene-families-v20: a full lap of the fills.
    { familyId: "relational-sequence-v2", panelIndexes: [0, 1, 2, 3] },
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
