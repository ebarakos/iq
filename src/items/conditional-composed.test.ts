import { beforeAll, describe, expect, it } from "vitest";
import { seededRng } from "@/lib/rng";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "./family-promotion";
import { gateOrderOutcome } from "./gate-order";
import {
  generateSceneFamilyCandidate,
  exhaustedDistractorSearches,
  resetExhaustedDistractorSearches,
  sceneFamilyClueCheck,
  servableConditionalComposedDraws,
  validateSceneFamilyCandidate,
  type SceneFamilyCandidate,
} from "./scene-families";
import { applySceneCompositionPrimitive } from "./scene-grammar";
import type { Puzzle, Scene, SceneToken } from "./schema";
import { boardKey, machineWorkedRowReadings, machineWorkedRowsAgreeOnQuery, secondReadings } from "./worked-row-readings";

const FAMILY = "composed-transform-v3";
const BUCKET = "composed-transform-v3-d5";
const candidate = (seed: number) => generateSceneFamilyCandidate(FAMILY, seededRng("conditional-composed-test", String(seed)), BUCKET);
const panel = (value: unknown) => value as Scene;
const solids = (board: Scene) => board.objects.filter(({ object }) => object.kind === "token" && object.fill === "solid");
const key = (row: number, column: number) => `${row},${column}`;

describe("the unserved conditional composed prototype", () => {
  let items: SceneFamilyCandidate[];
  beforeAll(() => { resetExhaustedDistractorSearches(); items = Array.from({ length: 16 }, (_, seed) => candidate(seed)); }, 120_000);

  it("enumerates geometries where both adjacent swaps and all omissions yield valid different boards", () => {
    const draws = servableConditionalComposedDraws();
    expect(draws.length).toBeGreaterThan(0);
    const directions = new Set<string>();
    for (const draw of draws) {
      const query: Scene = { kind: "scene", rows: 3, columns: 3, tiles: [], objects: draw.queryCells.map((at, index) => ({
        ...at, object: { kind: "token", shape: (["circle", "square", "diamond"] as const)[index],
          fill: index === 2 ? "solid" : "outline", rotation: 0, size: "l" },
      })) };
      const run = (order: readonly number[]) => order.reduce<Scene | null>((board, index) =>
        board && applySceneCompositionPrimitive(board, draw.steps[index]), query);
      expect(draw.steps.map(({ kind }) => kind)).toEqual(["spatial", "setFillAt", "moveSolid"]);
      if (draw.steps[2].kind === "moveSolid") directions.add(draw.steps[2].direction);
      expect(gateOrderOutcome([0, 1, 2], run)).toMatchObject({
        gateCount: 3, adjacentSwaps: ["different", "different"], ablations: ["different", "different", "different"],
      });
    }
    expect([...directions].sort()).toEqual(["down", "left", "right", "up"]);
  });

  it("accepts varied six-option items with necessary clues and a mechanical witness for every wrong option", () => {
    expect(exhaustedDistractorSearches()).toBe(0);
    for (const [seed, item] of items.entries()) {
      const result = validateSceneFamilyCandidate(item);
      expect(result.issues, `seed ${seed}`).toEqual([]);
      expect(result.accepted).toBe(true);
      expect(item.puzzle.stem).toHaveLength(12);
      expect(item.puzzle.options).toHaveLength(6);
      expect(result.report!.distractorWitnesses.map(({ optionIndex }) => optionIndex).sort()).toEqual(
        item.puzzle.options.flatMap((_, index) => index === item.puzzle.answerIndex ? [] : [index]));
      expect(result.report!.distractorWitnesses.every(({ witness }) => witness.length > 0)).toBe(true);
      expect(sceneFamilyClueCheck(item.puzzle).singleClueAnswerIds).toEqual([]);
      expect(secondReadings(FAMILY, item.puzzle)).toEqual([]);
      expect(gateOrderOutcome(item.queryGates!.order, item.queryGates!.run)).toMatchObject({
        adjacentSwaps: ["different", "different"], ablations: ["different", "different", "different"],
      });
    }
  });

  it("teaches every gate on the board actually received, with repaint changing the moved set from one to two", () => {
    for (const [seed, item] of items.entries()) {
      const { stem, options, answerIndex } = item.puzzle;
      const run = item.queryGates!.run;
      expect(solids(run([0])!)).toHaveLength(1);
      expect(solids(run([0, 1])!)).toHaveLength(2);
      for (let index = 0; index < 3; index++) {
        const received = index === 0 ? panel(stem[9]) : run(Array.from({ length: index }, (_, gate) => gate))!;
        const expected = run(Array.from({ length: index + 1 }, (_, gate) => gate))!;
        const readings = machineWorkedRowReadings(FAMILY, panel(stem[index * 3]), panel(stem[index * 3 + 2]));
        expect(readings.length).toBeGreaterThan(0);
        for (const reading of readings) {
          const predicted = reading.apply(received);
          expect(predicted, `seed ${seed}, gate ${index}, ${reading.name}`).not.toBeNull();
          expect(boardKey(predicted!)).toBe(boardKey(expected));
        }
      }
      expect(machineWorkedRowsAgreeOnQuery(FAMILY, stem, options[answerIndex])).toBe(true);
      const received = run([0, 1])!;
      const shown = panel(stem[6]);
      expect(shown.objects).toHaveLength(4);
      expect(solids(shown)).toHaveLength(2);
      expect(new Set(solids(shown).map(({ object }) => object.shape)).size).toBe(2);
      for (const placement of received.objects) {
        const contrast = shown.objects.find(({ row, column }) => key(row, column) === key(placement.row, placement.column))!;
        expect((contrast.object as SceneToken).fill).toBe((placement.object as SceneToken).fill);
      }
      expect(shown.objects.some(({ object }) => object.kind === "token" && object.fill === "half")).toBe(true);
      const answer = options[answerIndex];
      const white = received.objects.find(({ object }) => object.kind === "token" && object.fill === "outline")!;
      expect(answer.objects).toContainEqual(white);
    }
  });

  it("offers the board before conditional movement, so fills alone cannot identify the answer", () => {
    for (const [seed, item] of items.entries()) {
      const answer = item.puzzle.options[item.puzzle.answerIndex];
      const beforeMovement = item.queryGates!.run([0, 1])!;
      const wrongIndex = item.puzzle.options.findIndex((option) => boardKey(option) === boardKey(beforeMovement));
      expect(wrongIndex, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(wrongIndex, `seed ${seed}`).not.toBe(item.puzzle.answerIndex);
      const fills = (board: Scene) => board.objects.map(({ object }) =>
        `${object.shape}:${(object as SceneToken).fill}`).sort();
      const positions = (board: Scene) => board.objects.map(({ row, column, object }) =>
        `${object.shape}:${row},${column}`).sort();
      expect(fills(beforeMovement)).toEqual(fills(answer));
      expect(positions(beforeMovement)).not.toEqual(positions(answer));
    }
  });

  it("derives the answer from every visible worked row and the visible query", () => {
    const item = items[0];
    for (const index of [2, 5, 8, 9]) {
      const puzzle = structuredClone(item.puzzle);
      const board = panel(puzzle.stem[index]);
      // No gate changes size. All are schema-valid tokens of the other visible size.
      board.objects = board.objects.map((placement) => ({ ...placement,
        object: { ...placement.object, size: "m" } as SceneToken }));
      expect(validateSceneFamilyCandidate({ ...item, puzzle }).accepted, `panel ${index}`).toBe(false);
    }
  });

  it("rejects duplicated and unknown query gates or duplicated worked gate labels", () => {
    const item = items[1];
    const mutations: ((puzzle: Puzzle) => void)[] = [
      (puzzle) => { panel(puzzle.stem[10]).objects[1].object = structuredClone(panel(puzzle.stem[10]).objects[0].object); },
      (puzzle) => { panel(puzzle.stem[10]).objects[1].object = { kind: "token", shape: "arrow", size: "l", rotation: 0, fill: "outline" }; },
      (puzzle) => { puzzle.stem[4] = structuredClone(puzzle.stem[1]); },
      (puzzle) => { panel(puzzle.stem[10]).objects.reverse(); panel(puzzle.stem[10]).objects.forEach((placement, index) => { placement.column = index; }); },
    ];
    for (const mutate of mutations) {
      const puzzle = structuredClone(item.puzzle);
      mutate(puzzle);
      expect(validateSceneFamilyCandidate({ ...item, puzzle }).accepted).toBe(false);
    }
  });

  it("does not invent a witness for an arbitrary wrong option", () => {
    const item = items[2];
    const puzzle = structuredClone(item.puzzle);
    const wrong = puzzle.options.findIndex((_, index) => index !== puzzle.answerIndex);
    puzzle.options[wrong].objects[0].object = { kind: "token", shape: "arrow", size: "l", rotation: 0, fill: "outline" };
    const report = item.definition.validate(puzzle);
    expect(report.distractorWitnesses.some(({ optionIndex }) => optionIndex === wrong)).toBe(false);
    expect(validateSceneFamilyCandidate({ ...item, puzzle }).accepted).toBe(false);
  });

  it("rejects a movement row that no longer distinguishes moving every shape", () => {
    const item = items[2];
    const puzzle = structuredClone(item.puzzle);
    // Keep both moved tokens but remove the stationary contrast from both panels.
    // The intended operation still fits exactly; a global slide now also fits.
    for (const index of [6, 8]) panel(puzzle.stem[index]).objects = solids(panel(puzzle.stem[index]));
    expect(machineWorkedRowReadings(FAMILY, panel(puzzle.stem[6]), panel(puzzle.stem[8]))
      .some(({ name }) => /^every shape sliding/.test(name))).toBe(true);
    expect(machineWorkedRowsAgreeOnQuery(FAMILY, puzzle.stem, puzzle.options[puzzle.answerIndex])).toBe(false);
    expect(item.definition.validate(puzzle).solutionCount).toBe(0);
    expect(validateSceneFamilyCandidate({ ...item, puzzle }).accepted).toBe(false);
  });

  it("rejects absent or noninteracting gate runners", () => {
    const item = items[3];
    const answer = item.puzzle.options[item.puzzle.answerIndex];
    for (const queryGates of [
      undefined,
      { order: [0, 1, 2], run: () => answer },
      { order: [0, 1, 2], run: (order: readonly number[]) => order.length === 2 ? null : item.queryGates!.run(order) },
    ]) {
      const result = validateSceneFamilyCandidate({ ...item, queryGates });
      expect(result.accepted).toBe(false);
      expect(result.issues.some(({ code }) => code === "gate-order")).toBe(true);
    }
  });

  it("replays deterministically while remaining outside the served promotion registry", () => {
    expect(candidate(0).puzzle).toEqual(items[0].puzzle);
    expect(CURRENT_FAMILY_PROMOTION_REGISTRY.some(({ familyId }) => familyId === FAMILY)).toBe(false);
  });
});
