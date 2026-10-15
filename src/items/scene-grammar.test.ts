import { describe, expect, it } from "vitest";
import { sceneSignature, type Scene, type SceneToken } from "./schema";
import {
  applySceneBinary,
  applySceneComposedProgram,
  applySceneCompositionPrimitive,
  applySceneUnary,
  enumerateSceneOrderedCompositions,
  enumerateSceneSingleStepCompositions,
  enumerateSceneOrderedThreeStepCompositions,
  enumerateSceneUnaryOperations,
  isSceneComposedProgram,
  partialSceneExecutions,
  sceneComposedPrimitives,
  sceneComposedProgramFromSteps,
  sceneComposedProgramSteps,
} from "./scene-grammar";

const token = (shape: SceneToken["shape"], fill: SceneToken["fill"] = "outline"): SceneToken => ({
  kind: "token",
  shape,
  rotation: 0,
  fill,
  size: "l",
});

function scene(objects: Scene["objects"], rows = 3, columns = 3): Scene {
  return { kind: "scene", rows, columns, objects, tiles: [] };
}

describe("partial scene executions", () => {
  it("provides either symbol's rotation mistake while the other moves correctly", () => {
    const input = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 2, column: 1, object: token("arrow") },
    ]);
    const answer = applySceneUnary(input, { kind: "rotate", quarterTurns: 1 })!;
    const executions = [{ output: input, reason: "omits the board rotation" }];
    const snapshot = JSON.stringify({ answer, executions });
    const partial = partialSceneExecutions(answer, executions, "features");
    // Either symbol can be wrong alone, or both can make the witnessed mistake.
    expect(partial).toHaveLength(3);
    for (const shape of ["circle", "arrow"]) {
      const mixed = partial.find(({ reason }) => reason.includes(`${shape} group`))!.output!;
      expect(mixed.objects.find((entry) => entry.object.shape === shape))
        .toEqual(input.objects.find((entry) => entry.object.shape === shape));
      expect(mixed.objects.find((entry) => entry.object.shape !== shape))
        .toEqual(answer.objects.find((entry) => entry.object.shape !== shape));
    }
    expect(partialSceneExecutions(answer, [...executions, ...executions], "features")).toEqual(partial);
    expect(partialSceneExecutions(answer, [...executions,
      { output: structuredClone(input), reason: "later explanation for the same mistake" },
    ], "features")).toEqual(partial);
    expect(JSON.stringify({ answer, executions })).toBe(snapshot);
  });

  it("includes all copies of a shape, absent shapes and newly introduced shapes", () => {
    const answer = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 1, column: 1, object: token("circle") },
      { row: 2, column: 2, object: token("arrow") },
    ]);
    const wrong = scene([
      { row: 0, column: 1, object: token("circle", "solid") },
      { row: 1, column: 0, object: token("star") },
    ]);
    const partial = partialSceneExecutions(answer, [{ output: wrong, reason: "copies the wrong shape" }], "features");
    const circles = partial.find(({ reason }) => reason.includes("circle group"))!.output!;
    expect(circles.objects.filter((entry) => entry.object.shape === "circle")).toEqual([wrong.objects[0]]);
    expect(circles.objects.find((entry) => entry.object.shape === "arrow")).toEqual(answer.objects[2]);
    expect(partial.some(({ output }) => output!.objects.every((entry) => entry.object.shape !== "arrow"))).toBe(true);
    expect(partial.some(({ output }) => output!.objects.some((entry) => entry.object.shape === "star"))).toBe(true);
    expect(partial.some(({ reason }) => /circle (positions|fills|directions)$/.test(reason))).toBe(false);
  });

  it("isolates fills, directions and positions without copying the other properties", () => {
    const answer = scene([
      { row: 0, column: 0, object: token("arrow") },
      { row: 2, column: 2, object: token("circle") },
    ]);
    const wrong = scene([
      { row: 0, column: 1, object: { ...token("arrow", "solid"), rotation: 90 } },
      { row: 2, column: 2, object: token("circle") },
    ]);
    const partial = partialSceneExecutions(answer, [{ output: wrong, reason: "misreads the arrow change" }], "features");
    expect(partial).toHaveLength(4);
    const arrow = (property: string) => partial.find(({ reason }) => reason.endsWith(`arrow ${property}`))!.output!.objects[0];
    expect(arrow("positions")).toEqual({ ...answer.objects[0], column: 1 });
    expect(arrow("fills")).toEqual({ ...answer.objects[0], object: token("arrow", "solid") });
    expect(arrow("directions")).toEqual({ ...answer.objects[0], object: { ...token("arrow"), rotation: 90 } });
    for (const { output } of partial) {
      expect(output.objects).toHaveLength(2);
      expect(output.objects[1]).toEqual(answer.objects[1]);
    }
  });

  it("rejects object and tile collisions, invalid boards and mismatched board sizes", () => {
    const answer = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 0, column: 1, object: token("arrow") },
    ]);
    const swapped = scene([
      { ...answer.objects[0], column: 1 },
      { ...answer.objects[1], column: 0 },
    ]);
    const swappedPartial = partialSceneExecutions(answer, [{ output: swapped, reason: "swaps the shapes" }], "features");
    // Neither colliding single-shape move ships. Together they free both cells.
    expect(swappedPartial.map(({ output }) => sceneSignature(output))).toEqual([sceneSignature(swapped)]);
    const tiledAnswer = { ...scene([answer.objects[0]]), tiles: [{ row: 0, column: 1, edges: ["north" as const] }] };
    const tiledWrong = { ...scene([{ ...answer.objects[0], column: 1 }]), tiles: [{ row: 2, column: 2, edges: ["north" as const] }] };
    expect(partialSceneExecutions(tiledAnswer, [{ output: tiledWrong, reason: "moves the shape" }], "features")).toEqual([]);
    expect(partialSceneExecutions(answer, [
      { output: null, reason: "does not execute" },
      { output: answer, reason: "   " },
      { output: scene([{ ...answer.objects[0], row: 3 }]), reason: "leaves the board" },
      { output: scene([answer.objects[0]], 2, 2), reason: "changes board size" },
    ], "features")).toEqual([]);
  });

  it("rejects symmetric rotations and size-only differences that are not readable", () => {
    const answer = scene([{ row: 0, column: 0, object: token("circle") }]);
    expect(partialSceneExecutions(answer, [
      { output: scene([{ ...answer.objects[0], object: { ...token("circle"), rotation: 90 } }]), reason: "turns a circle" },
      { output: scene([{ ...answer.objects[0], object: { ...token("circle"), size: "m" } }]), reason: "shrinks a circle slightly" },
    ], "features")).toEqual([]);
  });

  it("combines two separately witnessed fill mistakes instead of cycling every symbol together", () => {
    const answer = scene([
      { row: 0, column: 0, object: token("diamond", "half") },
      { row: 2, column: 2, object: token("star", "outline") },
    ]);
    const oneStep = scene([
      { ...answer.objects[0], object: token("diamond", "solid") },
      { ...answer.objects[1], object: token("star", "half") },
    ]);
    const twoSteps = scene([
      { ...answer.objects[0], object: token("diamond", "outline") },
      { ...answer.objects[1], object: token("star", "solid") },
    ]);
    const executions = [
      { output: oneStep, reason: "takes the fill cycle one step too far" },
      { output: twoSteps, reason: "takes the fill cycle two steps too far" },
    ];
    const snapshot = JSON.stringify({ answer, executions });
    const partial = partialSceneExecutions(answer, executions, "features");
    for (const [diamondFill, starFill] of [["outline", "half"], ["solid", "solid"]]) {
      const combined = partial.find(({ output }) => {
        const diamond = output.objects.find((entry) => entry.object.shape === "diamond")!.object;
        const star = output.objects.find((entry) => entry.object.shape === "star")!.object;
        return diamond.kind === "token" && diamond.fill === diamondFill && star.kind === "token" && star.fill === starFill;
      });
      expect(combined).toBeDefined();
      expect(combined!.reason).toContain(executions[0].reason);
      expect(combined!.reason).toContain(executions[1].reason);
    }
    expect(partial.every(({ reason }) => reason.trim().length > 0)).toBe(true);
    expect(new Set(partial.map(({ output }) => sceneSignature(output))).size).toBe(partial.length);
    expect(partialSceneExecutions(answer, [...executions, ...executions], "features")).toEqual(partial);
    expect(JSON.stringify({ answer, executions })).toBe(snapshot);
  });

  it("combines at most two shape groups and leaves every other shape correct", () => {
    const answer = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 1, column: 1, object: token("triangle") },
      { row: 2, column: 2, object: token("arrow") },
    ]);
    const wrong = applySceneUnary(answer, { kind: "setFill", fill: "solid" })!;
    const partial = partialSceneExecutions(answer, [{ output: wrong, reason: "colours the shapes incorrectly" }], "features");
    expect(partial).toHaveLength(6);
    for (const { output } of partial) {
      const changed = output.objects.filter((entry) => entry.object.kind === "token" && entry.object.fill === "solid");
      expect(changed.length).toBeGreaterThan(0);
      expect(changed.length).toBeLessThanOrEqual(2);
    }
  });

  it("lets repeated symbols make different fill and direction mistakes while other shapes stay correct", () => {
    const answer = scene([
      { row: 0, column: 0, object: token("arrow") },
      { row: 1, column: 1, object: token("arrow") },
      { row: 2, column: 2, object: token("star") },
    ]);
    const executions = [
      { output: applySceneUnary(answer, { kind: "setFill", fill: "solid" }), reason: "colours every symbol black" },
      { output: applySceneUnary(answer, { kind: "setFill", fill: "half" }), reason: "colours every symbol grey" },
      { output: applySceneUnary(answer, { kind: "turn", quarterTurns: 1 }), reason: "turns the arrows clockwise" },
      { output: applySceneUnary(answer, { kind: "turn", quarterTurns: 3 }), reason: "turns the arrows anticlockwise" },
    ];
    const snapshot = JSON.stringify({ answer, executions });
    const partial = partialSceneExecutions(answer, executions, "features");
    const find = (firstFill: string, secondFill: string, firstTurn = 0, secondTurn = 0) => partial.find(({ output }) => {
      const first = output.objects[0].object;
      const second = output.objects[1].object;
      return first.kind === "token" && second.kind === "token" &&
        first.fill === firstFill && second.fill === secondFill &&
        first.rotation === firstTurn && second.rotation === secondTurn &&
        sceneSignature(scene([output.objects[2]])) === sceneSignature(scene([answer.objects[2]]));
    });
    expect(find("solid", "outline")).toBeDefined();
    expect(find("outline", "solid")).toBeDefined();
    const mixedFills = find("half", "solid")!;
    expect(mixedFills).toBeDefined();
    expect(mixedFills.reason).toContain(executions[0].reason);
    expect(mixedFills.reason).toContain(executions[1].reason);
    expect(find("solid", "half")).toBeDefined();
    expect(find("outline", "outline", 90, 270)).toBeDefined();
    expect(find("outline", "outline", 270, 90)).toBeDefined();
    expect(new Set(partial.map(({ output }) => sceneSignature(output))).size).toBe(partial.length);
    expect(JSON.stringify({ answer, executions })).toBe(snapshot);
  });

  it("keeps an unchanged copy anchored when another copy moves, and can omit a witnessed missing copy", () => {
    const answer = scene([
      { row: 0, column: 0, object: { ...token("arrow"), rotation: 90 } },
      { row: 1, column: 1, object: token("arrow") },
      { row: 2, column: 2, object: token("star") },
    ]);
    const moved = scene([
      { ...answer.objects[1], object: { ...token("arrow"), rotation: 180 } },
      { ...answer.objects[0], row: 2 },
      answer.objects[2],
    ]);
    const omitted = scene([answer.objects[0], answer.objects[2]]);
    const partial = partialSceneExecutions(answer, [
      { output: moved, reason: "moves the outer arrow to the wrong cell and turns the centre copy" },
      { output: omitted, reason: "stops before copying the arrow" },
    ], "features");
    expect(partial.some(({ output, reason }) => reason.includes("at square (1, 1)") &&
      output.objects.some((entry) => entry.row === 2 && entry.column === 0 && entry.object.kind === "token" && entry.object.rotation === 90) &&
      output.objects.some((entry) => entry.row === 1 && entry.column === 1 && entry.object.kind === "token" && entry.object.rotation === 0))).toBe(true);
    expect(partial.some(({ output }) => sceneSignature(output) === sceneSignature(omitted))).toBe(true);
  });

  it("changes exactly one square's content, including tiles and empty squares, while preserving guides", () => {
    const answer: Scene = {
      ...scene([
        { row: 0, column: 0, object: token("circle") },
        { row: 0, column: 1, object: token("arrow") },
      ]),
      guides: [{ kind: "crease", axis: "vertical", direction: "leftToRight" }],
    };
    const wrong: Scene = {
      ...scene([{ row: 2, column: 2, object: token("arrow") }]),
      tiles: [{ row: 0, column: 0, edges: ["west", "north"] }],
    };
    const partial = partialSceneExecutions(answer, [{ output: wrong, reason: "combines the wrong squares" }], "squares");
    expect(partial).toHaveLength(3);
    expect(partial.map(({ reason }) => reason)).toEqual([
      "combines the wrong squares; applies that mistake only at square (1, 1)",
      "combines the wrong squares; applies that mistake only at square (1, 2)",
      "combines the wrong squares; applies that mistake only at square (3, 3)",
    ]);
    expect(partial[0].output!.tiles).toEqual([{ row: 0, column: 0, edges: ["north", "west"] }]);
    expect(partial[1].output!.objects).toEqual([answer.objects[0]]);
    expect(partial[2].output!.objects).toHaveLength(3);
    expect(partial.every(({ output }) => JSON.stringify(output!.guides) === JSON.stringify(answer.guides))).toBe(true);
  });
});

describe("scene grammar", () => {
  it("enumerates every bounded unary operation deterministically", () => {
    const operations = enumerateSceneUnaryOperations(2, 2);
    expect(operations).toEqual(enumerateSceneUnaryOperations(2, 2));
    expect(operations).toContainEqual({ kind: "reflect", axis: "horizontal" });
    expect(operations).toContainEqual({ kind: "turn", quarterTurns: 1 });
    expect(operations).toContainEqual({ kind: "turn", quarterTurns: 2 });
    expect(operations).toContainEqual({ kind: "turn", quarterTurns: 3 });
    expect(operations).toContainEqual({ kind: "duplicate", from: { row: 0, column: 0 }, to: { row: 1, column: 1 } });
    expect(operations).toContainEqual({ kind: "contain", at: { row: 0, column: 0 }, containerShape: "square" });
    expect(new Set(operations.map((operation) => JSON.stringify(operation))).size).toBe(operations.length);
  });

  it("contains and uncontains one visible token without changing its identity", () => {
    const input = scene([{ row: 0, column: 0, object: token("star") }]);
    const contained = applySceneUnary(input, {
      kind: "contain",
      at: { row: 0, column: 0 },
      containerShape: "square",
    });
    expect(contained?.objects[0].object).toMatchObject({ kind: "container", shape: "square" });
    expect(applySceneUnary(contained!, { kind: "uncontain", at: { row: 0, column: 0 } }))
      .toEqual(input);
  });
  it("applies visible position transforms without hidden identities", () => {
    const input = scene([{ row: 0, column: 0, object: token("circle") }]);
    const moved = applySceneUnary(input, {
      kind: "translate",
      rowDelta: 1,
      columnDelta: 2,
      wrap: false,
    });
    expect(moved?.objects[0]).toMatchObject({ row: 1, column: 2 });
    expect(applySceneUnary(input, {
      kind: "translate",
      rowDelta: -1,
      columnDelta: 0,
      wrap: false,
    })).toBeNull();

    const reflected = applySceneUnary(input, { kind: "reflect", axis: "horizontal" });
    expect(reflected?.objects[0]).toMatchObject({ row: 0, column: 2 });
  });

  it("gives every one of the eight set operations a defined result on a clash", () => {
    const left = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 1, column: 1, object: token("square") },
    ]);
    const right = scene([
      { row: 1, column: 1, object: token("square") },
      { row: 2, column: 2, object: token("triangle") },
    ]);

    // The two boards agree wherever they overlap, so identity makes no
    // difference here and the counts are the plain set-algebra ones.
    expect(applySceneBinary(left, right, "union-left")?.objects).toHaveLength(3);
    expect(applySceneBinary(left, right, "union-right")?.objects).toHaveLength(3);
    expect(applySceneBinary(left, right, "intersection")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "overlap-left")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "subtract")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "mask-out")?.objects).toHaveLength(1);
    expect(applySceneBinary(left, right, "exclusive")?.objects).toHaveLength(2);

    // A clash — both boards occupy (0,0) with different tokens — is where the
    // eight operations separate. Until 2026-08-27 union simply refused this
    // draw, which is why the family could only ever use inputs that agreed and
    // the owner called the results toys. Every operation now answers.
    const conflict = scene([
      { row: 0, column: 0, object: token("star") },
      { row: 1, column: 1, object: token("square") },
    ]);
    const shapesAt = (operation: Parameters<typeof applySceneBinary>[2], row: number, column: number) =>
      applySceneBinary(left, conflict, operation)?.objects
        .filter((placement) => placement.row === row && placement.column === column)
        .map((placement) => (placement.object as { shape?: string }).shape ?? "?") ?? [];

    // Clash resolution: the same position, two different answers.
    expect(shapesAt("union-left", 0, 0)).toEqual(["circle"]);
    expect(shapesAt("union-right", 0, 0)).toEqual(["star"]);
    expect(shapesAt("overlap-left", 0, 0)).toEqual(["circle"]);
    expect(shapesAt("overlap-right", 0, 0)).toEqual(["star"]);
    // Identity: `intersection` and `subtract` compare whole tokens, so the
    // clashing position is not shared and not removed; `overlap-*` and
    // `mask-out` care only that something is there.
    expect(shapesAt("intersection", 0, 0)).toEqual([]);
    expect(shapesAt("intersection", 1, 1)).toEqual(["square"]);
    expect(shapesAt("subtract", 0, 0)).toEqual(["circle"]);
    expect(shapesAt("subtract", 1, 1)).toEqual([]);
    expect(shapesAt("mask-out", 0, 0)).toEqual([]);
    expect(shapesAt("exclusive", 0, 0)).toEqual([]);
  });

  it("enumerates and applies visible ordered compositions", () => {
    const programs = enumerateSceneOrderedCompositions();
    expect(programs).toHaveLength(16);
    expect(new Set(programs.map((program) => JSON.stringify(program))).size).toBe(16);
    const input = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 2, column: 0, object: token("square") },
    ]);
    const program = programs[0];
    const answer = applySceneComposedProgram(input, program);
    const reversed = applySceneComposedProgram(input, { first: program.second, second: program.first });
    expect(answer).not.toBeNull();
    expect(reversed).not.toBeNull();
    expect(sceneSignature(answer!)).not.toBe(sceneSignature(reversed!));
    expect(applySceneCompositionPrimitive(input, {
      kind: "setFillAt",
      at: { row: 0, column: 0 },
      fill: "half",
    })?.objects[0].object).toMatchObject({ fill: "half" });
  });

  it("uses canonical scene ordering for semantic comparisons", () => {
    const first = scene([
      { row: 2, column: 2, object: token("star") },
      { row: 0, column: 0, object: token("circle") },
    ]);
    const second = scene([...first.objects].reverse());
    const normalized = applySceneUnary(first, { kind: "setFill", fill: "outline" });
    expect(sceneSignature(normalized!)).toBe(sceneSignature(applySceneUnary(second, { kind: "setFill", fill: "outline" })!));
  });
});

describe("conditional solid-token move", () => {
  it.each([
    ["up", 0, 1], ["right", 1, 2], ["down", 2, 1], ["left", 1, 0],
  ] as const)("moves solid tokens one square %s and preserves their appearance", (direction, row, column) => {
    const solidArrow: SceneToken = { ...token("arrow", "solid"), rotation: 90 };
    const input: Scene = {
      ...scene([
        { row: 1, column: 1, object: solidArrow },
        { row: 0, column: 0, object: token("circle", "half") },
        { row: 2, column: 2, object: token("triangle") },
      ]),
      guides: [{ kind: "crease", axis: "vertical", direction: "leftToRight" }],
    };
    const snapshot = JSON.stringify(input);
    const output = applySceneCompositionPrimitive(input, { kind: "moveSolid", direction });
    expect(output?.objects.find(({ object }) => object.shape === "arrow"))
      .toEqual({ row, column, object: solidArrow });
    for (const stationary of input.objects.slice(1)) expect(output?.objects).toContainEqual(stationary);
    expect(output?.guides).toEqual(input.guides);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("moves into another solid token's vacated square regardless of object order", () => {
    const input = scene([
      { row: 1, column: 0, object: token("circle", "solid") },
      { row: 1, column: 1, object: token("arrow", "solid") },
    ]);
    const expected = scene([
      { row: 1, column: 1, object: token("circle", "solid") },
      { row: 1, column: 2, object: token("arrow", "solid") },
    ]);
    expect(applySceneCompositionPrimitive(input, { kind: "moveSolid", direction: "right" })).toEqual(expected);
    expect(applySceneCompositionPrimitive(scene([...input.objects].reverse()), {
      kind: "moveSolid", direction: "right",
    })).toEqual(expected);
  });

  it.each(["outline", "half"] as const)("rejects a collision with a stationary %s token", (fill) => {
    const input = scene([
      { row: 1, column: 0, object: token("circle", "solid") },
      { row: 1, column: 1, object: token("arrow", fill) },
    ]);
    const snapshot = JSON.stringify(input);
    expect(applySceneCompositionPrimitive(input, { kind: "moveSolid", direction: "right" })).toBeNull();
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it.each([
    ["up", 0, 1], ["right", 1, 2], ["down", 2, 1], ["left", 1, 0],
  ] as const)("rejects the entire move when a token leaves the board %s", (direction, row, column) => {
    const input = scene([
      { row, column, object: token("circle", "solid") },
      { row: 1, column: 1, object: token("arrow", "solid") },
    ]);
    const snapshot = JSON.stringify(input);
    expect(applySceneCompositionPrimitive(input, { kind: "moveSolid", direction })).toBeNull();
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("returns a valid no-op when no token is solid, even at the boundary", () => {
    const input = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 0, column: 1, object: token("arrow", "half") },
    ]);
    expect(applySceneCompositionPrimitive(input, { kind: "moveSolid", direction: "up" })).toEqual(input);
    expect(applySceneCompositionPrimitive(scene([]), { kind: "moveSolid", direction: "up" })).toBeNull();
    expect(applySceneCompositionPrimitive(scene([{ ...input.objects[0], row: 3 }]), {
      kind: "moveSolid", direction: "up",
    })).toBeNull();
    // A move cannot repair an invalid starting coordinate.
    expect(applySceneCompositionPrimitive(scene([{
      row: 3, column: 0, object: token("circle", "solid"),
    }]), { kind: "moveSolid", direction: "up" })).toBeNull();
  });

  it("rejects tiles and containers even when no token would move", () => {
    const tiled: Scene = {
      ...scene([{ row: 0, column: 0, object: token("circle") }]),
      tiles: [{ row: 1, column: 1, edges: ["north"] }],
    };
    const contained = scene([{
      row: 1, column: 1,
      object: { kind: "container", shape: "circle", contents: [token("arrow", "solid")] },
    }]);
    for (const input of [tiled, contained]) {
      expect(applySceneCompositionPrimitive(input, { kind: "moveSolid", direction: "up" })).toBeNull();
    }
  });

  it("selects tokens from the current fill state so painting and moving can interact", () => {
    const input = scene([
      { row: 0, column: 0, object: token("circle") },
      { row: 2, column: 1, object: token("arrow", "solid") },
    ]);
    const paint = { kind: "setFillAt", at: { row: 0, column: 0 }, fill: "solid" } as const;
    const move = { kind: "moveSolid", direction: "right" } as const;
    const paintThenMove = applySceneComposedProgram(input, { first: paint, second: move });
    const moveThenPaint = applySceneComposedProgram(input, { first: move, second: paint });
    expect(paintThenMove?.objects).toEqual([
      { row: 0, column: 1, object: token("circle", "solid") },
      { row: 2, column: 2, object: token("arrow", "solid") },
    ]);
    expect(moveThenPaint?.objects).toEqual([
      { row: 0, column: 0, object: token("circle", "solid") },
      { row: 2, column: 2, object: token("arrow", "solid") },
    ]);
  });

  it("keeps the conditional gate out of every legacy primitive and program pool", () => {
    expect(sceneComposedPrimitives().map(({ kind }) => kind)).toEqual([
      "spatial", "spatial", "spatial", "spatial", "setFillAt", "setFillAt", "turn", "turn",
    ]);
    const programs = [...enumerateSceneOrderedCompositions(), ...enumerateSceneOrderedThreeStepCompositions()];
    expect(programs).toHaveLength(16 + 276);
    expect(programs.every((program) => sceneComposedProgramSteps(program)
      .every(({ kind }) => kind !== "moveSolid"))).toBe(true);
  });
});

describe("token turn", () => {
  const spinner = (
    shape: SceneToken["shape"],
    rotation = 0,
  ): SceneToken => ({ kind: "token", shape, rotation, fill: "outline", size: "l" });

  it("turns every orientable token in place and leaves the board alone", () => {
    const input: Scene = {
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: [
        { row: 0, column: 2, object: spinner("arrow", 90) },
        { row: 2, column: 0, object: spinner("triangle") },
      ],
      tiles: [{ row: 1, column: 1, edges: ["north", "west"] }],
    };

    const turned = applySceneUnary(input, { kind: "turn", quarterTurns: 1 });
    expect(turned?.objects).toEqual([
      { row: 0, column: 2, object: spinner("arrow", 180) },
      { row: 2, column: 0, object: spinner("triangle", 90) },
    ]);
    expect(turned?.tiles).toEqual(input.tiles);
  });

  it("wraps past a full circle", () => {
    const input = scene([{ row: 0, column: 0, object: spinner("arrow", 270) }]);
    expect(applySceneUnary(input, { kind: "turn", quarterTurns: 1 })?.objects[0].object)
      .toMatchObject({ rotation: 0 });
    expect(applySceneUnary(input, { kind: "turn", quarterTurns: 3 })?.objects[0].object)
      .toMatchObject({ rotation: 180 });
  });

  it("composes: two single turns equal one double turn", () => {
    const input = scene([
      { row: 0, column: 0, object: spinner("arrow", 90) },
      { row: 1, column: 1, object: spinner("triangle", 180) },
    ]);
    const once = applySceneUnary(input, { kind: "turn", quarterTurns: 1 })!;
    const twice = applySceneUnary(once, { kind: "turn", quarterTurns: 1 })!;
    const doubled = applySceneUnary(input, { kind: "turn", quarterTurns: 2 })!;
    expect(sceneSignature(twice)).toBe(sceneSignature(doubled));
    expect(sceneSignature(once)).not.toBe(sceneSignature(doubled));
  });

  it("leaves shapes with no readable orientation exactly as they were", () => {
    const input = scene([
      { row: 0, column: 0, object: spinner("arrow") },
      { row: 1, column: 1, object: spinner("circle") },
      { row: 2, column: 2, object: spinner("star") },
    ]);
    const turned = applySceneUnary(input, { kind: "turn", quarterTurns: 2 });
    expect(turned?.objects[0].object).toMatchObject({ shape: "arrow", rotation: 180 });
    expect(turned?.objects[1].object).toEqual(spinner("circle"));
    expect(turned?.objects[2].object).toEqual(spinner("star"));
  });

  it("turns orientable tokens inside containers too", () => {
    const input = scene([{
      row: 1,
      column: 1,
      object: { kind: "container", shape: "circle", contents: [spinner("arrow"), spinner("square")] },
    }]);
    expect(applySceneUnary(input, { kind: "turn", quarterTurns: 3 })?.objects[0].object).toEqual({
      kind: "container",
      shape: "circle",
      contents: [spinner("arrow", 270), spinner("square")],
    });
  });

  it("rejects a scene with nothing to turn instead of returning it unchanged", () => {
    expect(applySceneUnary(
      scene([{ row: 0, column: 0, object: spinner("circle") }]),
      { kind: "turn", quarterTurns: 1 },
    )).toBeNull();
    expect(applySceneUnary(
      scene([{
        row: 0,
        column: 0,
        object: { kind: "container", shape: "square", contents: [spinner("hexagon")] },
      }]),
      { kind: "turn", quarterTurns: 2 },
    )).toBeNull();
    expect(applySceneUnary(
      { kind: "scene", rows: 2, columns: 2, objects: [], tiles: [{ row: 0, column: 0, edges: ["north"] }] },
      { kind: "turn", quarterTurns: 1 },
    )).toBeNull();
  });
});

describe("composed program lengths", () => {
  it("holds every three-gate program to the grammar's three rules", () => {
    const programs = enumerateSceneOrderedThreeStepCompositions();
    // 8x7x6 = 336 ordered triples of distinct primitives, less 4x3x2 = 24 that
    // are all board moves, less the 6 x 3! = 36 that hold both turns.
    expect(programs).toHaveLength(276);
    for (const program of programs) {
      const steps = sceneComposedProgramSteps(program);
      expect(steps).toHaveLength(3);
      // Distinct primitives.
      expect(new Set(steps.map((step) => JSON.stringify(step))).size).toBe(3);
      // Not all board moves, and at most one turn.
      expect(steps.some((step) => step.kind !== "spatial")).toBe(true);
      expect(steps.filter((step) => step.kind === "turn").length).toBeLessThanOrEqual(1);
      expect(isSceneComposedProgram(steps)).toBe(true);
    }
  });

  it("round-trips one, two and three gates and refuses a fourth", () => {
    // The owner's three-gate ceiling of 2026-08-27, held in the grammar itself
    // since the four- and five-gate programs were deleted on 2026-09-28.
    const pool = sceneComposedPrimitives();
    const steps = [pool[0], pool[4], pool[6]];
    const program = sceneComposedProgramFromSteps(steps);
    expect(sceneComposedProgramSteps(program)).toEqual(steps);
    expect(Object.keys(program)).toEqual(["first", "second", "third"]);
    expect(sceneComposedProgramSteps(sceneComposedProgramFromSteps(steps.slice(0, 2)))).toHaveLength(2);
    expect(() => sceneComposedProgramFromSteps([...steps, pool[5]])).toThrow(/one, two or three gates/);
    expect(isSceneComposedProgram([...steps, pool[5]])).toBe(false);
    const pair = enumerateSceneOrderedCompositions()[0];
    expect(isSceneComposedProgram([pair.first, pair.second])).toBe(true);
    expect(isSceneComposedProgram([pool[0], pool[1]])).toBe(false);
    // One gate (owner, 2026-10-15): any primitive alone, and nothing shorter.
    expect(sceneComposedProgramSteps(sceneComposedProgramFromSteps([pool[2]]))).toEqual([pool[2]]);
    expect(enumerateSceneSingleStepCompositions().map((program) => program.first)).toEqual(pool);
    expect(isSceneComposedProgram([])).toBe(false);
  });
});
