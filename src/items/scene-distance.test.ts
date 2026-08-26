import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import { SceneSchema, sceneSignature, type Scene, type SceneContainer, type SceneToken } from "./schema";
import { SCENE_FAMILY_BUCKETS, SCENE_FAMILY_IDS, generateSceneFamilyCandidate } from "./scene-families";
import { compareCloseness, rankByCloseness, sceneEditDistance, type SceneDistance } from "./scene-distance";

function token(overrides: Partial<Omit<SceneToken, "kind">> = {}): SceneToken {
  return { kind: "token", shape: "circle", rotation: 0, fill: "solid", size: "m", ...overrides };
}

function container(shape: SceneContainer["shape"], contents: SceneToken[]): SceneContainer {
  return { kind: "container", shape, contents };
}

function board(partial: Partial<Scene> = {}): Scene {
  return { kind: "scene", rows: 2, columns: 2, objects: [], tiles: [], ...partial };
}

/** One token at (0,0), so single-field edits are easy to state exactly. */
function single(overrides: Partial<Omit<SceneToken, "kind">> = {}): Scene {
  return board({ objects: [{ row: 0, column: 0, object: token(overrides) }] });
}

const ZERO: SceneDistance = { positions: 0, atoms: 0 };

/**
 * A spread of legal boards used for the property checks. Two entries are
 * deliberately identical (`solidCircle` and its clone) so the "zero iff same
 * signature" check tests both directions rather than passing vacuously.
 */
const catalogue: Record<string, Scene> = {
  solidCircle: single(),
  solidCircleClone: single(),
  outlineCircle: single({ fill: "outline" }),
  largeCircle: single({ size: "l" }),
  movedCircle: board({ objects: [{ row: 1, column: 1, object: token() }] }),
  twoTokens: board({
    objects: [
      { row: 0, column: 0, object: token() },
      { row: 1, column: 1, object: token({ shape: "square" }) },
    ],
  }),
  containedCircle: board({ objects: [{ row: 0, column: 0, object: container("square", [token()]) }] }),
  containedPair: board({
    objects: [{ row: 0, column: 0, object: container("square", [token(), token({ shape: "star", fill: "outline" })]) }],
  }),
  tile: board({ tiles: [{ row: 0, column: 0, edges: ["north", "east"] }] }),
  otherTile: board({ tiles: [{ row: 0, column: 0, edges: ["south", "west"] }] }),
  creased: board({ objects: [{ row: 0, column: 0, object: token() }], guides: [{ kind: "crease", axis: "vertical", direction: "leftToRight" }] }),
  creasedBothWays: board({
    objects: [{ row: 0, column: 0, object: token() }],
    guides: [
      { kind: "crease", axis: "vertical", direction: "leftToRight" },
      { kind: "crease", axis: "vertical", direction: "rightToLeft" },
    ],
  }),
  creasedBothWaysReversed: board({
    objects: [{ row: 0, column: 0, object: token() }],
    guides: [
      { kind: "crease", axis: "vertical", direction: "rightToLeft" },
      { kind: "crease", axis: "vertical", direction: "leftToRight" },
    ],
  }),
  biggerBoard: { kind: "scene", rows: 3, columns: 3, objects: [{ row: 0, column: 0, object: token() }], tiles: [] },
};

const catalogueEntries = Object.entries(catalogue);

describe("scene edit distance", () => {
  it("uses only boards the scene schema accepts", () => {
    for (const [name, scene] of catalogueEntries) {
      expect(() => SceneSchema.parse(scene), name).not.toThrow();
    }
  });

  it("is zero exactly when the two scenes share a signature", () => {
    for (const [leftName, left] of catalogueEntries) {
      for (const [rightName, right] of catalogueEntries) {
        const distance = sceneEditDistance(left, right);
        const isZero = distance !== "incomparable" && distance.positions === 0 && distance.atoms === 0;
        expect(isZero, `${leftName} vs ${rightName}`).toBe(sceneSignature(left) === sceneSignature(right));
      }
    }
  });

  it("is zero exactly when two generated scenes share a signature", () => {
    // The hand-written catalogue above proves the rule on boards chosen to test
    // it. This proves the same rule on boards the battery actually serves —
    // containers, connection tiles, creases and gate strips included. Each draw
    // is generated twice from one seed, so the pool holds genuinely distinct
    // scenes that must measure zero as well as distinct ones that must not.
    for (const familyId of SCENE_FAMILY_IDS) {
      const bucket = SCENE_FAMILY_BUCKETS[familyId][0].bucket;
      const scenes: Scene[] = [];
      for (const pass of [0, 1]) {
        const { puzzle } = generateSceneFamilyCandidate(
          familyId,
          seededRng("scene-distance-property", `${familyId}:${bucket}`),
          bucket,
        );
        for (const panel of puzzle.stem) if (!("blank" in panel)) scenes.push(panel);
        scenes.push(...puzzle.options);
        expect(scenes.length, `${familyId} pass ${pass}`).toBeGreaterThan(0);
      }
      for (const [leftIndex, left] of scenes.entries()) {
        for (const [rightIndex, right] of scenes.entries()) {
          const distance = sceneEditDistance(left, right);
          const isZero = distance !== "incomparable" && distance.positions === 0 && distance.atoms === 0;
          expect(isZero, `${familyId} scene ${leftIndex} vs ${rightIndex}`)
            .toBe(sceneSignature(left) === sceneSignature(right));
        }
      }
    }
  });

  it("is symmetric for every pair", () => {
    for (const [leftName, left] of catalogueEntries) {
      for (const [rightName, right] of catalogueEntries) {
        expect(sceneEditDistance(left, right), `${leftName} vs ${rightName}`)
          .toEqual(sceneEditDistance(right, left));
      }
    }
  });

  it("returns integers only, never a fraction", () => {
    for (const [, left] of catalogueEntries) {
      for (const [, right] of catalogueEntries) {
        const distance = sceneEditDistance(left, right);
        if (distance === "incomparable") continue;
        expect(Number.isInteger(distance.positions)).toBe(true);
        expect(Number.isInteger(distance.atoms)).toBe(true);
      }
    }
  });

  it("charges one atom for a fill-only change", () => {
    expect(sceneEditDistance(single(), single({ fill: "outline" }))).toEqual({ positions: 1, atoms: 1 });
  });

  it("charges one position per changed coordinate, not per changed field", () => {
    const rebuilt = single({ shape: "triangle", fill: "outline", size: "l", rotation: 90 });
    expect(sceneEditDistance(single(), rebuilt)).toEqual({ positions: 1, atoms: 4 });
  });

  it("charges the tag and a full token for a coordinate occupied in only one scene", () => {
    // Five atoms, not four: the tag itself (empty against token) is one of the
    // padded fields, so gaining a token costs more than rebuilding one.
    const empty = board({ tiles: [{ row: 1, column: 1, edges: ["north"] }] });
    const occupied = board({
      objects: [{ row: 0, column: 0, object: token() }],
      tiles: [{ row: 1, column: 1, edges: ["north"] }],
    });
    expect(sceneEditDistance(empty, occupied)).toEqual({ positions: 1, atoms: 5 });
  });

  it("prices a move as two coordinates and the token's atoms once per coordinate", () => {
    // The chosen rule: a coordinate occupied in only one scene contributes its
    // occupant's atom count plus the tag, ONCE. So a token that leaves (0,0) and
    // reappears at (1,1) costs {2, 10} — strictly farther than any in-place edit
    // of that same token, which tops out at {1, 4}. That ordering is intended: a
    // relocated token is rejected on layout alone, while a recoloured one has to
    // be read.
    expect(sceneEditDistance(single(), catalogue.movedCircle)).toEqual({ positions: 2, atoms: 10 });
    expect(compareCloseness(
      sceneEditDistance(single(), single({ fill: "outline" })),
      sceneEditDistance(single(), catalogue.movedCircle),
    )).toBeLessThan(0);
  });

  it("treats a token facing a container as a whole rebuilt cell", () => {
    // Different tags, so no field lines up: the cost is the tag plus every field
    // on both sides. Token (4) against outline-plus-one-token (5) is 1+4+5 = 10.
    expect(sceneEditDistance(single(), catalogue.containedCircle)).toEqual({ positions: 1, atoms: 10 });
    // Outline plus two tokens is nine fields: 1+4+9 = 14.
    expect(sceneEditDistance(single(), catalogue.containedPair)).toEqual({ positions: 1, atoms: 14 });
  });

  it("compares containers field by field and slot by slot", () => {
    const base = board({ objects: [{ row: 0, column: 0, object: container("square", [token()]) }] });
    const recoloured = board({ objects: [{ row: 0, column: 0, object: container("square", [token({ fill: "half" })]) }] });
    const reshaped = board({ objects: [{ row: 0, column: 0, object: container("circle", [token()]) }] });
    const widened = board({ objects: [{ row: 0, column: 0, object: container("square", [token(), token({ shape: "star" })]) }] });

    expect(sceneEditDistance(base, recoloured)).toEqual({ positions: 1, atoms: 1 });
    expect(sceneEditDistance(base, reshaped)).toEqual({ positions: 1, atoms: 1 });
    // Same tag, so only the second content slot is padded: four fields.
    expect(sceneEditDistance(base, widened)).toEqual({ positions: 1, atoms: 4 });
  });

  it("sees a swap inside a container, because the renderer draws contents in order", () => {
    const left = board({ objects: [{ row: 0, column: 0, object: container("square", [token(), token({ shape: "star", fill: "outline" })]) }] });
    const right = board({ objects: [{ row: 0, column: 0, object: container("square", [token({ shape: "star", fill: "outline" }), token()]) }] });
    expect(sceneEditDistance(left, right)).toEqual({ positions: 1, atoms: 4 });
    expect(sceneSignature(left)).not.toBe(sceneSignature(right));
  });

  it("prices connection tiles by the edges that differ", () => {
    const northEast = board({ tiles: [{ row: 0, column: 0, edges: ["north", "east"] }] });
    const northSouth = board({ tiles: [{ row: 0, column: 0, edges: ["north", "south"] }] });
    const northOnly = board({ tiles: [{ row: 0, column: 0, edges: ["north"] }] });

    expect(sceneEditDistance(northEast, northSouth)).toEqual({ positions: 1, atoms: 2 });
    expect(sceneEditDistance(northEast, northOnly)).toEqual({ positions: 1, atoms: 1 });
    // Same edge count, no shared edge: a full redraw, not a match.
    expect(sceneEditDistance(catalogue.tile, catalogue.otherTile)).toEqual({ positions: 1, atoms: 4 });
    // A tile present in only one scene costs the tag plus its own edges.
    expect(sceneEditDistance(board({ objects: [{ row: 1, column: 1, object: token() }] }), board({
      objects: [{ row: 1, column: 1, object: token() }],
      tiles: [{ row: 0, column: 0, edges: ["north", "east", "south"] }],
    }))).toEqual({ positions: 1, atoms: 4 });
  });

  it("counts an object replaced by a tile at one coordinate as ONE changed slot", () => {
    // The case the coordinate rule decides, and the one that changed on
    // 2026-08-26. A token at (0,0) against a north/east tile at (0,0) is one
    // board slot whose content differs: {1, 7} — the tag, the token's four
    // fields, and the tile's two edges. Keying objects and tiles as separate
    // spaces used to charge this same cell twice and report {2, 6}, which
    // contradicts the definition of `positions`.
    const objectAt = board({ objects: [{ row: 0, column: 0, object: token() }] });
    const tileAt = board({ tiles: [{ row: 0, column: 0, edges: ["north", "east"] }] });
    expect(sceneEditDistance(objectAt, tileAt)).toEqual({ positions: 1, atoms: 7 });
    // And so it now ranks nearer than a move, which really does change two slots.
    expect(compareCloseness(
      sceneEditDistance(objectAt, tileAt),
      sceneEditDistance(objectAt, catalogue.movedCircle),
    )).toBeLessThan(0);
  });

  it("charges exactly one position wherever the two tags differ", () => {
    const empty = board({ objects: [{ row: 1, column: 1, object: token() }] });
    const tokenAt = board({
      objects: [{ row: 1, column: 1, object: token() }, { row: 0, column: 0, object: token() }],
    });
    const containerAt = board({
      objects: [{ row: 1, column: 1, object: token() }, { row: 0, column: 0, object: container("square", [token()]) }],
    });
    const tileAt = board({
      objects: [{ row: 1, column: 1, object: token() }],
      tiles: [{ row: 0, column: 0, edges: ["north", "east"] }],
    });

    // Every pair below differs at exactly one coordinate, (0,0), and each of
    // them holds a different kind of mark there. However far apart the marks
    // look, one coordinate contributes one position and never two.
    const pairs: [string, Scene, Scene][] = [
      ["empty against token", empty, tokenAt],
      ["empty against container", empty, containerAt],
      ["empty against tile", empty, tileAt],
      ["token against container", tokenAt, containerAt],
      ["token against tile", tokenAt, tileAt],
      ["container against tile", containerAt, tileAt],
    ];
    for (const [name, left, right] of pairs) {
      const distance = sceneEditDistance(left, right);
      expect(distance, name).not.toBe("incomparable");
      if (distance === "incomparable") continue;
      expect(distance.positions, name).toBe(1);
      expect(distance.atoms, name).toBeGreaterThan(1);
    }
  });

  it("prices crease guides as atoms only, never as positions", () => {
    const plain = single();
    const vertical = catalogue.creased;
    const verticalBack = board({
      objects: [{ row: 0, column: 0, object: token() }],
      guides: [{ kind: "crease", axis: "vertical", direction: "rightToLeft" }],
    });
    const horizontal = board({
      objects: [{ row: 0, column: 0, object: token() }],
      guides: [{ kind: "crease", axis: "horizontal", direction: "topToBottom" }],
    });

    // A crease is drawn across the whole board, so it occupies no coordinate and
    // charges no position. Every board below holds the same token in the same
    // place, so all three distances are pure atoms.
    expect(sceneEditDistance(plain, vertical)).toEqual({ positions: 0, atoms: 2 });
    expect(sceneEditDistance(vertical, verticalBack)).toEqual({ positions: 0, atoms: 1 });
    // Different axes are different guides: one crease vanished and another
    // appeared, so both fields of each are padded — four atoms, still no position.
    expect(sceneEditDistance(vertical, horizontal)).toEqual({ positions: 0, atoms: 4 });
    // A fold difference therefore ranks nearer than any change to a single cell.
    expect(compareCloseness(
      sceneEditDistance(plain, vertical),
      sceneEditDistance(single(), single({ fill: "outline" })),
    )).toBeLessThan(0);
  });

  it("adds crease atoms on top of the coordinates that changed", () => {
    const moved = board({
      objects: [{ row: 1, column: 1, object: token() }],
      guides: [{ kind: "crease", axis: "vertical", direction: "leftToRight" }],
    });
    // Two changed coordinates (10 atoms) plus one crease the other board lacks
    // (2 atoms). The crease moves atoms only, leaving the position count alone.
    expect(sceneEditDistance(single(), moved)).toEqual({ positions: 2, atoms: 12 });
  });

  it("keys same-axis creases the way sceneSignature orders them", () => {
    // Schema-legal but unused by any family. Keeping the ordinal in the key is
    // what makes "distance zero" and "same signature" the same statement: the
    // two boards below show the same two creases in the opposite declared order,
    // so each key's fold direction differs — two atoms, no positions.
    expect(sceneEditDistance(catalogue.creasedBothWays, catalogue.creasedBothWaysReversed))
      .toEqual({ positions: 0, atoms: 2 });
    expect(sceneSignature(catalogue.creasedBothWays))
      .not.toBe(sceneSignature(catalogue.creasedBothWaysReversed));
  });

  it("calls boards of different dimensions incomparable, both ways round", () => {
    expect(sceneEditDistance(single(), catalogue.biggerBoard)).toBe("incomparable");
    expect(sceneEditDistance(catalogue.biggerBoard, single())).toBe("incomparable");
    const wide: Scene = { kind: "scene", rows: 2, columns: 3, objects: [{ row: 0, column: 0, object: token() }], tiles: [] };
    expect(sceneEditDistance(single(), wide)).toBe("incomparable");
  });
});

describe("compareCloseness", () => {
  const ordered: SceneDistance[] = [
    { positions: 0, atoms: 0 },
    { positions: 1, atoms: 1 },
    { positions: 1, atoms: 4 },
    { positions: 2, atoms: 2 },
    { positions: 2, atoms: 8 },
    { positions: 9, atoms: 0 },
    "incomparable",
  ];

  it("orders positions before atoms and incomparable last", () => {
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = 0; j < ordered.length; j += 1) {
        const sign = Math.sign(compareCloseness(ordered[i], ordered[j]));
        expect(sign, `${i} vs ${j}`).toBe(Math.sign(i - j));
      }
    }
  });

  it("is antisymmetric and reflexive", () => {
    for (const left of ordered) {
      expect(compareCloseness(left, left)).toBe(0);
      for (const right of ordered) {
        // The two directions must cancel: 1 + -1, or 0 + 0. Summing avoids the
        // -0 vs +0 trap that Object.is (and so `toBe`) treats as a difference.
        expect(Math.sign(compareCloseness(left, right)) + Math.sign(compareCloseness(right, left))).toBe(0);
      }
    }
  });

  it("is transitive across the whole set", () => {
    for (const a of ordered) {
      for (const b of ordered) {
        for (const c of ordered) {
          if (compareCloseness(a, b) <= 0 && compareCloseness(b, c) <= 0) {
            expect(compareCloseness(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it("treats two incomparable distances as tied", () => {
    expect(compareCloseness("incomparable", "incomparable")).toBe(0);
    expect(compareCloseness("incomparable", ZERO)).toBeGreaterThan(0);
    expect(compareCloseness(ZERO, "incomparable")).toBeLessThan(0);
  });
});

describe("rankByCloseness", () => {
  interface Candidate {
    label: string;
    scene: Scene;
  }

  const sceneOf = (candidate: Candidate) => candidate.scene;
  const answer = single();

  it("puts the nearest candidate first and the wrong-sized board last", () => {
    const pool: Candidate[] = [
      { label: "moved", scene: catalogue.movedCircle },
      { label: "bigger board", scene: catalogue.biggerBoard },
      { label: "recoloured", scene: single({ fill: "outline" }) },
      { label: "contained", scene: catalogue.containedCircle },
    ];
    expect(rankByCloseness(pool, answer, sceneOf).map((candidate) => candidate.label))
      .toEqual(["recoloured", "contained", "moved", "bigger board"]);
  });

  it("keeps equally distant candidates in their input order", () => {
    // Every candidate below is exactly one changed field away from the answer,
    // so the whole pool ties. A seeded selector shuffles the nearest window, and
    // that replay is only reproducible if ties come out in a fixed order.
    const tied: Candidate[] = [
      { label: "outline", scene: single({ fill: "outline" }) },
      { label: "half", scene: single({ fill: "half" }) },
      { label: "large", scene: single({ size: "l" }) },
      { label: "square", scene: single({ shape: "square" }) },
      { label: "star", scene: single({ shape: "star" }) },
    ];
    const labels = tied.map((candidate) => candidate.label);
    expect(rankByCloseness(tied, answer, sceneOf).map((candidate) => candidate.label)).toEqual(labels);
    expect(rankByCloseness([...tied].reverse(), answer, sceneOf).map((candidate) => candidate.label))
      .toEqual([...labels].reverse());
  });

  it("does not mutate or alias the pool it was given", () => {
    const pool: Candidate[] = [
      { label: "moved", scene: catalogue.movedCircle },
      { label: "recoloured", scene: single({ fill: "outline" }) },
    ];
    const before = [...pool];
    const ranked = rankByCloseness(pool, answer, sceneOf);
    expect(pool).toEqual(before);
    expect(pool.map((candidate) => candidate.label)).toEqual(["moved", "recoloured"]);
    expect(ranked).not.toBe(pool);
  });

  it("handles an empty pool", () => {
    expect(rankByCloseness([], answer, sceneOf)).toEqual([]);
  });
});
