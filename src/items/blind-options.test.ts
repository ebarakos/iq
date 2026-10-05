import { describe, expect, it } from "vitest";
import { seededRng } from "../lib/rng";
import {
  BLIND_SOLVERS,
  blindCredits,
  blindStrategyCredits,
  bottomCredit,
  optionsAloneOnAClue,
  rankCredit,
  topCredit,
} from "./blind-options";
import { CURRENT_FAMILY_PROMOTION_REGISTRY, EXPANDED_PROFILE_BANDS } from "./family-promotion";
import { eligibleFamiliesForBand } from "./expanded-quiz";
import { generateSceneFamilyCandidate, type SceneFamilyId } from "./scene-families";
import { toPublicPuzzle, type Scene, type SceneToken } from "./schema";

function board(tokens: Array<[number, number, SceneToken["shape"], SceneToken["fill"]]>): Scene {
  return {
    kind: "scene",
    rows: 3,
    columns: 3,
    objects: tokens.map(([row, column, shape, fill]) => ({
      row, column, object: { kind: "token", shape, rotation: 0, fill, size: "l" },
    })),
    tiles: [],
  };
}

describe("options-only solvers", () => {
  it("splits the credit fairly on a tie and pays nothing below the top", () => {
    expect(topCredit([3, 1, 3, 2], 0)).toBe(0.5);
    expect(topCredit([3, 1, 3, 2], 1)).toBe(0);
    expect(topCredit([1, 1, 1, 1, 1, 1], 4)).toBeCloseTo(1 / 6);
    expect(bottomCredit([3, 1, 3, 2], 1)).toBe(1);
    // Every rank, not only the top: the answer tied with one other for ranks
    // 2 and 3 earns half of each, and the credits over all ranks sum to 1.
    expect([1, 2, 3, 4].map((rank) => rankCredit([5, 3, 3, 1], 1, rank))).toEqual([0, 0.5, 0.5, 0]);
  });

  it("finds the answer at the centre of a star, and nothing in a balanced grid", () => {
    // The flaw of 2026-09-28 in miniature: every wrong option is the answer
    // with ONE thing changed, so the answer is nearest to all of them and holds
    // the common value of every aspect.
    const star = [
      board([[0, 0, "circle", "solid"], [2, 2, "square", "outline"]]),
      board([[0, 0, "circle", "half"], [2, 2, "square", "outline"]]),
      board([[0, 0, "star", "solid"], [2, 2, "square", "outline"]]),
      board([[0, 1, "circle", "solid"], [2, 2, "square", "outline"]]),
      board([[0, 0, "circle", "solid"], [2, 1, "square", "outline"]]),
      board([[0, 0, "circle", "solid"], [2, 2, "diamond", "outline"]]),
    ];
    for (const solver of BLIND_SOLVERS) expect(blindCredits(star, 0)[solver], solver).toBe(1);

    // The same token at two places times three fills: every option shares its
    // place with two others and its fill with one, so no option stands out and
    // every solver is left with a blind guess.
    const grid = (["outline", "half", "solid"] as const).flatMap((fill) =>
      [[0, 0], [2, 2]].map(([row, column]) => board([[row, column, "circle", fill]])));
    for (let answer = 0; answer < grid.length; answer++) {
      for (const solver of BLIND_SOLVERS) expect(blindCredits(grid, answer)[solver], solver).toBeCloseTo(1 / 6);
      for (const [strategy, credit] of Object.entries(blindStrategyCredits(grid, answer))) {
        expect(credit, strategy).toBeCloseTo(1 / 6);
      }
    }
  });

  it("finds an answer kept in the middle ranks", () => {
    // The flaw of the first v19 gate in miniature (2026-09-29): an answer that
    // is never the most typical option nor the least sits in the middle, and
    // a strategy that reads the middle ranks picks it.
    const star = [
      board([[0, 0, "circle", "solid"], [2, 2, "square", "outline"]]),
      board([[0, 0, "circle", "half"], [2, 2, "square", "outline"]]),
      board([[0, 0, "star", "solid"], [2, 2, "square", "outline"]]),
      board([[0, 1, "circle", "solid"], [2, 2, "square", "outline"]]),
      board([[0, 0, "circle", "solid"], [2, 1, "square", "outline"]]),
      board([[0, 0, "circle", "solid"], [2, 2, "diamond", "outline"]]),
    ];
    // The centre of the star is rank 1 on every solver; every rank strategy
    // other than rank 1 earns nothing on it.
    const credits = blindStrategyCredits(star, 0);
    expect(credits["composite@1"]).toBe(1);
    expect(credits["most-typical@3"]).toBe(0);
    expect(Object.keys(credits)).toContain("middle-rank");
    expect(Object.keys(credits)).toContain("exclude-extremes");
    // The star is also what the agreement rule built: every wrong option is
    // alone in its value of the one aspect it changed, and the answer alone is
    // not. Ruling out the lone options leaves exactly the answer; picking one
    // of them never finds it.
    expect(credits["exclude-lone-aspect"]).toBe(1);
    expect(credits["lone-aspect"]).toBe(0);
    expect(Object.keys(credits)).toHaveLength(4 * 6 + 4);
  });

  it("cannot pick the answer out of any served bucket at the old rates", () => {
    // The fast guard for `npm test`. `npm run families:verify` holds every
    // served bucket to 30% on every strategy over 200 items; this reads 30
    // items per served bucket and fails only on a gross regression — the old
    // star served 58% to 92% per bucket, and the first v19 selection's middle
    // ranks up to 53%. Prototype buckets are not swept: they are not served.
    const LIMIT = 0.5;
    const ITEMS = 30;
    const served = new Map<string, { familyId: string; bucket: string }>();
    for (const band of EXPANDED_PROFILE_BANDS) {
      for (const family of eligibleFamiliesForBand(CURRENT_FAMILY_PROMOTION_REGISTRY, band)) {
        for (const { bucket } of family.bandBuckets) served.set(bucket, { familyId: family.familyId, bucket });
      }
    }
    expect(served.size).toBeGreaterThan(0);
    for (const { familyId, bucket } of served.values()) {
      const credit: Record<string, number> = {};
      for (let item = 0; item < ITEMS; item++) {
        const { puzzle } = generateSceneFamilyCandidate(
          familyId as SceneFamilyId, seededRng("blind-options-test-v2", `${bucket}:${item}`), bucket);
        const credits = blindStrategyCredits(toPublicPuzzle(puzzle).options as Scene[], puzzle.answerIndex);
        for (const [strategy, earned] of Object.entries(credits)) credit[strategy] = (credit[strategy] ?? 0) + earned;
      }
      for (const [strategy, earned] of Object.entries(credit)) {
        expect(earned / ITEMS, `${bucket}: ${strategy}`).toBeLessThanOrEqual(LIMIT);
      }
    }
  });
});

describe("one clue never narrows the options to one", () => {
  it("passes a grid of two clues, and names the option a missing twin leaves alone", () => {
    // Three squares times two fills: every square is on two options and every
    // fill on three, so knowing one of the two never leaves a single option.
    const squares: Array<[number, number]> = [[0, 0], [0, 2], [2, 2]];
    const grid = squares.flatMap(([row, column]) =>
      (["half", "solid"] as const).map((fill) => board([[row, column, "circle", fill]])));
    expect([...optionsAloneOnAClue(grid, "features")]).toEqual([]);
    // Replace the last option with a board on a square nobody else uses: it is
    // alone on where it stands, and the option it replaced leaves (2,2)-half
    // without a twin.
    const broken = [...grid.slice(0, 5), board([[1, 0, "circle", "solid"]])];
    expect([...optionsAloneOnAClue(broken, "features")].sort()).toEqual([4, 5]);
  });

  it("follows a shape by its square, fill and turn only when every option holds it once", () => {
    // Every whole-board aspect pairs up, but only option 0 has a solid
    // triangle and only option 1 a solid circle: "the triangle ends up solid"
    // picks out option 0 on its own.
    const pair = (triangle: SceneToken["fill"], circle: SceneToken["fill"], shape: SceneToken["shape"] = "triangle") =>
      board([[0, 0, shape, triangle], [2, 2, "circle", circle]]);
    const options = [
      pair("solid", "half"),
      pair("half", "solid"),
      pair("half", "outline"),
      pair("outline", "half"),
      pair("outline", "outline"),
      pair("outline", "outline"),
    ];
    expect([...optionsAloneOnAClue(options, "features")].sort()).toEqual([0, 1]);
    // When one option has a square where the others have the triangle, the
    // shape itself is part of what the rule decides: the triangle is no longer
    // followed, so option 0 stops being alone, and option 5 is alone on shapes.
    options[5] = pair("outline", "outline", "square");
    expect([...optionsAloneOnAClue(options, "features")].sort()).toEqual([1, 5]);
  });

  it("reads square by square under the squares model", () => {
    const options = [
      board([[0, 0, "circle", "outline"], [0, 2, "star", "outline"]]),
      board([[0, 0, "circle", "outline"], [2, 0, "star", "outline"]]),
      board([[0, 2, "star", "outline"], [2, 0, "star", "outline"]]),
      board([[0, 2, "star", "outline"], [2, 0, "star", "outline"]]),
      board([[0, 0, "circle", "outline"], [0, 2, "star", "outline"]]),
      board([[0, 0, "circle", "outline"], [2, 0, "star", "outline"]]),
    ];
    expect([...optionsAloneOnAClue(options, "squares")]).toEqual([]);
    // Option 0 is the only one with a triangle in the corner.
    options[0] = board([[0, 0, "triangle", "outline"], [0, 2, "star", "outline"]]);
    expect([...optionsAloneOnAClue(options, "squares")]).toContain(0);
  });
});
