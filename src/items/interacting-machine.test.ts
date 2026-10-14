import { describe, expect, it } from "vitest";
import shortcutFixture from "../../data/fixtures/machine-gate-shortcut-v37.json";
import { seededRng } from "@/lib/rng";
import { everyAdjacentSwapMatters, gateOrderOutcome } from "./gate-order";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import {
  generateSceneFamilyCandidate,
  machineGateNecessity,
  sceneFamilyClueCheck,
  servableInteractingMachineDraws,
  validateSceneFamilyCandidate,
} from "./scene-families";
import { applySceneCompositionPrimitive, applySceneUnary } from "./scene-grammar";
import { OPTIONS_PER_ITEM, PuzzleSchema, shuffleOptions, type Scene, type SceneToken } from "./schema";
import { boardKey, machineWorkedRowReadings, secondReadings } from "./worked-row-readings";

/**
 * transformation-machine-v4, the interacting machine
 * (docs/plans/harden-reasoning.md, section 2).
 */

const BUCKET = "transformation-machine-v4-d5";

function board(...placements: [number, number, SceneToken["shape"], SceneToken["fill"]][]): Scene {
  return {
    kind: "scene",
    rows: 3,
    columns: 3,
    tiles: [],
    objects: placements.map(([row, column, shape, fill]) => ({
      row, column, object: { kind: "token", shape, fill, rotation: 0, size: "l" },
    })),
  };
}

function candidate(seed: number) {
  return generateSceneFamilyCandidate("transformation-machine-v4", seededRng("interacting-machine-test", String(seed)), BUCKET);
}

const panel = (value: unknown) => value as Scene;

describe("the interacting machine", () => {
  it.each([
    ["transformation-machine-v4", BUCKET],
    ["composed-transform-v2", "composed-transform-d4"],
    ["composed-transform-v2", "composed-transform-d5"],
  ] as const)("needs every worked transformation to choose among six options in %s / %s", (familyId, bucket) => {
    for (let seed = 0; seed < 8; seed++) {
      const item = generateSceneFamilyCandidate(familyId, seededRng("necessary-machine-test", String(seed)), bucket);
      for (const puzzle of [item.puzzle, shuffleOptions(item.puzzle)]) {
        expect(puzzle.options).toHaveLength(OPTIONS_PER_ITEM);
        const proof = machineGateNecessity(puzzle)!;
        expect(proof.valid, `${familyId} ${seed}`).toBe(true);
        expect(proof.remainingOptions).toHaveLength(item.queryGates!.order.length);
        for (const { optionIndexes } of proof.remainingOptions) {
          expect(optionIndexes).toContain(puzzle.answerIndex);
          expect(optionIndexes.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("rejects a v37 example that passes symbol checks but can be solved without its last transform", () => {
    const puzzle = PuzzleSchema.parse(shortcutFixture.puzzle);
    const clues = sceneFamilyClueCheck(puzzle);
    expect(clues.singleClueAnswerIds).toEqual([]);
    expect(clues.dispensableClueIds).toEqual([]);
    expect(clues.indistinguishableWrongOptionIndexes).toEqual([]);
    const proof = machineGateNecessity(puzzle)!;
    expect(proof.valid).toBe(false);
    expect(proof.remainingOptions.at(-1)!.optionIndexes).toEqual([puzzle.answerIndex]);
    const item = candidate(0);
    const result = validateSceneFamilyCandidate({ ...item, puzzle });
    expect(result.accepted).toBe(false);
    expect(result.issues.some(({ code, message }) => code === "clue-shortcut" && message.includes("transformations can be skipped"))).toBe(true);
  });

  it("binds the marked answer to the complete visible machine", () => {
    const { puzzle } = candidate(1);
    const wrong = puzzle.options.findIndex((_, index) => index !== puzzle.answerIndex);
    const proof = machineGateNecessity({ ...puzzle, answerIndex: wrong })!;
    expect(proof.valid).toBe(false);
    expect(proof.dispensableGateIds).toContain("invalid-machine-answer");
  });

  it("answers the plan's worked query, and every order of its gates gives another board", () => {
    // An outline circle top-left and an outline triangle bottom-left; turn the
    // board clockwise, colour the top-left shape grey, copy it into the centre.
    const query = board([0, 0, "circle", "outline"], [2, 0, "triangle", "outline"]);
    const gates = [
      (value: Scene) => applySceneUnary(value, { kind: "rotate", quarterTurns: 1 }),
      (value: Scene) => applySceneCompositionPrimitive(value, { kind: "setFillAt", at: { row: 0, column: 0 }, fill: "half" }),
      (value: Scene) => applySceneUnary(value, { kind: "duplicate", from: { row: 0, column: 0 }, to: { row: 1, column: 1 } }),
    ];
    const run = (order: readonly number[]) => {
      let value: Scene | null = query;
      for (const index of order) value = value && gates[index](value);
      return value;
    };
    expect(boardKey(run([0, 1, 2])!)).toBe(boardKey(board(
      [0, 0, "triangle", "half"], [0, 2, "circle", "outline"], [1, 1, "triangle", "half"],
    )));
    const outcome = gateOrderOutcome([0, 1, 2], run);
    expect(outcome).toMatchObject({ validOrders: 6, distinctValidOutputs: 6, adjacentSwaps: ["different", "different"] });
    expect(servableInteractingMachineDraws().some((draw) =>
      draw.program.gateA.kind === "rotate" && draw.program.gateA.quarterTurns === 1 &&
      draw.program.gateB.at.row === 0 && draw.program.gateB.at.column === 0 && draw.program.gateB.fill === "half" &&
      draw.queryCells[0].row === 2 && draw.queryCells[0].column === 0)).toBe(true);
  });

  it("poses 56 machines, every one needing every gate in the order shown", () => {
    // 4 board moves × 8 paint squares × 2 colours = 64, less the 8 where a
    // flip leaves the paint square where it is, so no other shape can arrive.
    const draws = servableInteractingMachineDraws();
    expect(draws).toHaveLength(56);
    for (const draw of draws) {
      expect(draw.program.gateC.from).toEqual(draw.program.gateB.at);
      expect(draw.queryCells[1]).toEqual(draw.program.gateB.at);
    }
  });

  it("builds accepted items with one reading whose gates all depend on their order", () => {
    for (let seed = 0; seed < 24; seed++) {
      const item = candidate(seed);
      expect(validateSceneFamilyCandidate(item).accepted, `seed ${seed}`).toBe(true);
      expect(secondReadings(item.familyId, item.puzzle), `seed ${seed}`).toEqual([]);
      const outcome = gateOrderOutcome(item.queryGates!.order, item.queryGates!.run);
      expect(everyAdjacentSwapMatters(outcome), `seed ${seed}`).toBe(true);
      expect(outcome.ablations, `seed ${seed}`).toEqual(["different", "different", "different"]);
    }
  });

  it("shows paint and copy rows whose visible readings agree on the query", () => {
    for (let seed = 0; seed < 24; seed++) {
      const item = candidate(seed);
      const { stem } = item.puzzle;
      const [paintIn, paintOut, copyIn, copyOut] = [stem[3], stem[5], stem[6], stem[8]].map(panel);
      const readings = (input: Scene, output: Scene) =>
        machineWorkedRowReadings("transformation-machine-v4", input, output);
      // The same shape stands twice and only one is coloured, so neither
      // "every <shape>" nor "every shape" reproduces the paint row.
      expect(new Set(paintIn.objects.map(({ object }) => object.kind === "token" && object.shape)).size).toBe(1);
      expect(readings(paintIn, paintOut).filter(({ name }) => /^every /.test(name)), `seed ${seed}`).toEqual([]);
      // The two copy-row shapes match but differ in colour, so "copy the
      // <shape>" does not say which one: only one square's copy fits.
      const copySources = new Set(readings(copyIn, copyOut).flatMap(({ name }) => name.match(/"from":\{[^}]*\}/g) ?? []));
      expect(copySources.size, `seed ${seed}`).toBe(1);
      expect(copyIn.objects).toHaveLength(3);
      const copied = copyOut.objects.find(({ row, column }) => row === 1 && column === 1)!.object as SceneToken;
      expect(copyIn.objects.filter(({ object }) => object.kind === "token" && object.shape === copied.shape)).toHaveLength(2);
      expect(copyIn.objects.filter(({ object }) => object.kind === "token" && object.fill === copied.fill)).toHaveLength(2);
      // Whatever reading a taker gives either row, it does what the gate does
      // to the board the question hands that gate.
      const { order, run } = item.queryGates!;
      const paintIndex = order.indexOf(1);
      const copyIndex = order.indexOf(2);
      const beforePaint = run(order.slice(0, paintIndex));
      const afterPaint = run(order.slice(0, paintIndex + 1));
      const beforeCopy = run(order.slice(0, copyIndex));
      const afterCopy = run(order.slice(0, copyIndex + 1));
      for (const reading of readings(paintIn, paintOut)) {
        expect(boardKey(reading.apply(beforePaint!)!), `seed ${seed}: ${reading.name}`).toBe(boardKey(afterPaint!));
      }
      for (const reading of readings(copyIn, copyOut)) {
        expect(boardKey(reading.apply(beforeCopy!)!), `seed ${seed}: ${reading.name}`).toBe(boardKey(afterCopy!));
      }
    }
  });

  it("detects the white-shape copy reading that the original prototype missed", () => {
    // Paint, copy, then move: the copy receives a coloured shape, and its
    // competing white-shape reading must also pass through the final move.
    const item = Array.from({ length: 24 }, (_, seed) => candidate(seed))
      .find((item) => item.queryGates!.order.join("") === "120")!;
    expect(item).toBeDefined();
    const stem = [...item.puzzle.stem];
    const copyIn = panel(stem[6]);
    const copied = panel(stem[8]).objects.find(({ row, column }) => row === 1 && column === 1)!.object as SceneToken;
    const legacyInput: Scene = { ...copyIn, objects: copyIn.objects
      .filter(({ object }) => object.shape === copied.shape)
      .map((placement) => ({ ...placement, object: { ...placement.object,
        fill: (placement.object as SceneToken).fill === copied.fill ? "outline" as const : "solid" as const } })) };
    stem[6] = legacyInput;
    stem[8] = { ...legacyInput, objects: [...legacyInput.objects,
      { row: 1, column: 1, object: { ...copied, fill: "outline" } }] };
    const received = item.queryGates!.run([1])!;
    const white = received.objects.find(({ object }) => object.kind === "token" && object.fill === "outline")!;
    const copiedWhite: Scene = { ...received, objects: [...received.objects, { ...white, row: 1, column: 1 }] };
    const move = machineWorkedRowReadings("transformation-machine-v4", panel(stem[0]), panel(stem[2]))[0];
    const alternative = move.apply(copiedWhite)!;
    const result = secondReadings(item.familyId, { ...item.puzzle, stem,
      options: [item.puzzle.options[item.puzzle.answerIndex], alternative] });
    expect(result.some(({ option, reading }) => option === 1 && reading.includes("only white"))).toBe(true);
  });

  it("refuses a missing gate runner or a runner whose swaps change nothing", () => {
    const item = candidate(1);
    const answer = item.puzzle.options[item.puzzle.answerIndex];
    for (const queryGates of [undefined, { order: [0, 1, 2], run: () => answer }]) {
      const result = validateSceneFamilyCandidate({ ...item, queryGates });
      expect(result.accepted).toBe(false);
      expect(result.issues.some(({ code }) => code === "gate-order")).toBe(true);
    }
  });

  it("asks the question about different shapes from the ones the paint and copy rows show", () => {
    for (let seed = 0; seed < 24; seed++) {
      const { stem } = candidate(seed).puzzle;
      const shapes = (value: unknown) => new Set(panel(value).objects.map(({ object }) => object.kind === "token" && object.shape));
      const query = shapes(stem[9]);
      for (const row of [stem[3], stem[6]]) {
        expect([...shapes(row)].filter((shape) => query.has(shape)), `seed ${seed}`).toEqual([]);
      }
    }
  });

  it("replaces the commuting machine in the served registry", () => {
    expect(CURRENT_FAMILY_PROMOTION_REGISTRY.some((entry) => entry.familyId === "transformation-machine-v4")).toBe(true);
    expect(CURRENT_FAMILY_PROMOTION_REGISTRY.some((entry) => entry.familyId === "transformation-machine-v3")).toBe(false);
  });
});
