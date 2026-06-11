/**
 * Unit tests for src/lib/calibrate.ts
 *
 * Fixtures are built inline — no fs, no fallback.ts imports. Real bank items
 * are loaded via loadBank() for two base puzzle fixtures (ids overridden); this
 * gives us schema-valid puzzles without duplicating the full puzzle DSL in tests.
 */

import { describe, expect, it, beforeAll } from "vitest";
import {
  agentTag,
  MIN_ATTEMPTS,
  buildReport,
  applyCalibration,
  type ItemRollup,
  type AgentTag,
} from "./calibrate";
import { loadBank, type BankItem } from "@/items/bank";
import type { AttemptFile } from "./attempts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Two real bank items, ids overridden so we can control them. */
let B_EASY: BankItem;
let B_HARD: BankItem;

beforeAll(() => {
  const items = loadBank();
  if (items.length < 2) throw new Error("bank must have at least 2 items for fixtures");
  B_EASY = { ...items[0], puzzle: { ...items[0].puzzle, id: "item-easy", difficulty: 2 }, tags: [], calibration: undefined };
  B_HARD = { ...items[1], puzzle: { ...items[1].puzzle, id: "item-hard", difficulty: 5 }, tags: [], calibration: undefined };
});

/** Create a minimal valid AttemptFile with the given attempts array. */
function makeFile(
  opts: {
    runId?: string;
    provider?: string;
    model?: string;
    channel?: "image" | "symbolic";
    promptVersion?: string;
  },
  attempts: Array<{ itemId: string; correct: boolean }>,
): AttemptFile {
  return {
    runId: opts.runId ?? "run-1",
    startedAt: "2026-06-10T00:00:00.000Z",
    provider: opts.provider ?? "openrouter",
    model: opts.model ?? "model-a",
    channel: opts.channel ?? "image",
    promptVersion: opts.promptVersion ?? "solver-v1",
    attempts: attempts.map(({ itemId, correct }, idx) => ({
      itemId,
      chosen: correct ? 0 : 1,
      correct,
      latencyMs: 100,
      ts: `2026-06-10T00:00:${String(idx).padStart(2, "0")}.000Z`,
    })),
  };
}

// ---------------------------------------------------------------------------
// agentTag thresholds
// ---------------------------------------------------------------------------

describe("agentTag", () => {
  it("returns agent-easy when solveRate >= 0.90", () => {
    expect(agentTag(0.90)).toBe("agent-easy");
    expect(agentTag(0.95)).toBe("agent-easy");
    expect(agentTag(1.0)).toBe("agent-easy");
  });

  it("returns agent-hard when solveRate <= 0.40", () => {
    expect(agentTag(0.40)).toBe("agent-hard");
    expect(agentTag(0.20)).toBe("agent-hard");
    expect(agentTag(0.0)).toBe("agent-hard");
  });

  it("returns agent-mid for rates between boundaries (exclusive)", () => {
    expect(agentTag(0.41)).toBe("agent-mid");
    expect(agentTag(0.50)).toBe("agent-mid");
    expect(agentTag(0.89)).toBe("agent-mid");
  });

  it("treats 0.90 and 0.40 as exact boundary values (inclusive)", () => {
    // 0.90 is inclusive easy, 0.40 is inclusive hard
    const easy: AgentTag = "agent-easy";
    const hard: AgentTag = "agent-hard";
    expect(agentTag(0.90)).toBe(easy);
    expect(agentTag(0.40)).toBe(hard);
  });
});

// ---------------------------------------------------------------------------
// MIN_ATTEMPTS gate
// ---------------------------------------------------------------------------

describe("MIN_ATTEMPTS gate", () => {
  it("returns tag === null when attempts === 4 (below threshold)", () => {
    const file = makeFile({}, [
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
    ]);
    const { imageRollups } = buildReport([file], [B_EASY, B_HARD]);
    const r = imageRollups.find((x) => x.itemId === "item-easy");
    expect(r).toBeDefined();
    expect(r!.attempts).toBe(4);
    expect(r!.tag).toBeNull();
  });

  it("returns tag !== null when attempts === 5 (at threshold)", () => {
    const file = makeFile({}, [
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
    ]);
    const { imageRollups } = buildReport([file], [B_EASY, B_HARD]);
    const r = imageRollups.find((x) => x.itemId === "item-easy");
    expect(r!.attempts).toBe(5);
    expect(r!.tag).toBe("agent-easy"); // 5/5 = 1.0 → easy
  });

  it("MIN_ATTEMPTS constant is 5", () => {
    expect(MIN_ATTEMPTS).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Image-only filtering
// ---------------------------------------------------------------------------

describe("image-only filtering", () => {
  it("symbolic attempts do NOT appear in imageRollups", () => {
    const symbolic = makeFile({ channel: "symbolic" }, [
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: false },
    ]);
    const { imageRollups, symbolicRollups } = buildReport([symbolic], [B_EASY, B_HARD]);
    expect(imageRollups.find((r) => r.itemId === "item-easy")).toBeUndefined();
    expect(symbolicRollups.find((r) => r.itemId === "item-easy")).toBeDefined();
  });

  it("image attempts do NOT appear in symbolicRollups", () => {
    const image = makeFile({ channel: "image" }, [
      { itemId: "item-easy", correct: true },
    ]);
    const { imageRollups, symbolicRollups } = buildReport([image], [B_EASY, B_HARD]);
    expect(imageRollups.find((r) => r.itemId === "item-easy")).toBeDefined();
    expect(symbolicRollups.find((r) => r.itemId === "item-easy")).toBeUndefined();
  });

  it("items with only symbolic attempts are excluded from imageRollups regardless of count", () => {
    const symbolic = makeFile({ channel: "symbolic" }, Array.from({ length: 10 }, () => ({ itemId: "item-easy", correct: true })));
    const { imageRollups } = buildReport([symbolic], [B_EASY, B_HARD]);
    expect(imageRollups.find((r) => r.itemId === "item-easy")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// byModel split
// ---------------------------------------------------------------------------

describe("byModel split", () => {
  it("records separate byModel entries for two different models", () => {
    const fileA = makeFile({ provider: "openrouter", model: "model-a" }, [
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: true },
      { itemId: "item-easy", correct: false },
    ]);
    const fileB = makeFile({ runId: "run-2", provider: "openai", model: "gpt-4o-mini" }, [
      { itemId: "item-easy", correct: false },
      { itemId: "item-easy", correct: false },
    ]);
    const { imageRollups } = buildReport([fileA, fileB], [B_EASY, B_HARD]);
    const r = imageRollups.find((x) => x.itemId === "item-easy");
    expect(r).toBeDefined();
    expect(r!.attempts).toBe(5);
    // Pooled rate: 2/5 = 0.40
    expect(r!.solveRate).toBeCloseTo(0.4);
    expect(r!.byModel["openrouter/model-a"]).toBeDefined();
    expect(r!.byModel["openrouter/model-a"].attempts).toBe(3);
    expect(r!.byModel["openrouter/model-a"].solveRate).toBeCloseTo(2 / 3);
    expect(r!.byModel["openai/gpt-4o-mini"]).toBeDefined();
    expect(r!.byModel["openai/gpt-4o-mini"].attempts).toBe(2);
    expect(r!.byModel["openai/gpt-4o-mini"].solveRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Divergence mismatch ordering
// ---------------------------------------------------------------------------

describe("divergence mismatch ordering", () => {
  it("places d5/high-rate mismatch above d1/low-rate if severity is higher", () => {
    // d5 item with 100% solve rate → severe upward mismatch (severity = 1.0 * 5 = 5)
    // d2 item with 0% solve rate → downward mismatch (severity = 1.0 * 4 = 4)
    // Expect d5 item first
    const fileEasy = makeFile({ runId: "run-easy" }, Array.from({ length: 5 }, () => ({ itemId: "item-hard", correct: true })));
    // item-hard has difficulty 5 in our fixture
    const fileHard = makeFile({ runId: "run-hard" }, Array.from({ length: 5 }, () => ({ itemId: "item-easy", correct: false })));
    // item-easy has difficulty 2 in our fixture

    const { divergence } = buildReport([fileEasy, fileHard], [B_EASY, B_HARD]);
    expect(divergence.mismatches.length).toBeGreaterThanOrEqual(2);
    // First mismatch should be the d5 item (higher severity) when severity(d5 + 1.0) = 5 > severity(d2 + 0%) = 4
    const first = divergence.mismatches[0];
    expect(first.itemId).toBe("item-hard"); // d5 but agents ace it
  });

  it("includes low-difficulty/low-solveRate in mismatches", () => {
    const file = makeFile({}, Array.from({ length: 5 }, () => ({ itemId: "item-easy", correct: false })));
    // item-easy has difficulty 2; 0% solve rate → should appear as mismatch
    const { divergence } = buildReport([file], [B_EASY, B_HARD]);
    const m = divergence.mismatches.find((x) => x.itemId === "item-easy");
    expect(m).toBeDefined();
    expect(m!.difficulty).toBe(2);
    expect(m!.solveRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyCalibration
// ---------------------------------------------------------------------------

describe("applyCalibration", () => {
  const FIXED_NOW = "2026-06-10T12:00:00.000Z";

  function makeRollup(itemId: string, attempts: number, solveRate: number): ItemRollup {
    return {
      itemId,
      attempts,
      solveRate,
      byModel: { "openrouter/model-a": { attempts, solveRate } },
      tag: attempts >= MIN_ATTEMPTS ? agentTag(solveRate) : null,
    };
  }

  it("sets calibration block and tag when attempts >= MIN_ATTEMPTS", () => {
    const rollup = makeRollup("item-easy", 5, 0.2); // 0.2 → agent-hard
    const result = applyCalibration([B_EASY, B_HARD], [rollup], FIXED_NOW);
    const item = result.find((i) => i.puzzle.id === "item-easy");
    expect(item).toBeDefined();
    expect(item!.calibration).toBeDefined();
    expect(item!.calibration!.attempts).toBe(5);
    expect(item!.calibration!.solveRate).toBeCloseTo(0.2);
    expect(item!.calibration!.updatedAt).toBe(FIXED_NOW);
    expect(item!.tags).toContain("agent-hard");
  });

  it("sets calibration block but removes stale agent-* tag when attempts < MIN_ATTEMPTS (>= 1)", () => {
    const staleItem: BankItem = { ...B_EASY, tags: ["agent-easy", "other-tag"], calibration: undefined };
    const rollup = makeRollup("item-easy", 3, 0.95); // 3 < MIN_ATTEMPTS → tag null
    const result = applyCalibration([staleItem, B_HARD], [rollup], FIXED_NOW);
    const item = result.find((i) => i.puzzle.id === "item-easy");
    expect(item!.calibration).toBeDefined();
    expect(item!.calibration!.attempts).toBe(3);
    expect(item!.tags).not.toContain("agent-easy");
    expect(item!.tags).toContain("other-tag"); // non-agent tag preserved
  });

  it("preserves non-agent tags when adding a new agent tag", () => {
    const withTags: BankItem = { ...B_EASY, tags: ["featured", "reviewed"], calibration: undefined };
    const rollup = makeRollup("item-easy", 10, 0.95); // agent-easy
    const result = applyCalibration([withTags, B_HARD], [rollup], FIXED_NOW);
    const item = result.find((i) => i.puzzle.id === "item-easy");
    expect(item!.tags).toContain("agent-easy");
    expect(item!.tags).toContain("featured");
    expect(item!.tags).toContain("reviewed");
  });

  it("replaces existing agent-* tag with new tag", () => {
    const oldTagItem: BankItem = { ...B_EASY, tags: ["agent-easy"], calibration: undefined };
    const rollup = makeRollup("item-easy", 5, 0.1); // now agent-hard
    const result = applyCalibration([oldTagItem, B_HARD], [rollup], FIXED_NOW);
    const item = result.find((i) => i.puzzle.id === "item-easy");
    expect(item!.tags).toContain("agent-hard");
    expect(item!.tags).not.toContain("agent-easy");
  });

  it("is idempotent: applying twice with same rollups and now yields identical output", () => {
    const rollup = makeRollup("item-easy", 7, 0.6); // agent-mid
    const once = applyCalibration([B_EASY, B_HARD], [rollup], FIXED_NOW);
    const twice = applyCalibration(once, [rollup], FIXED_NOW);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("leaves items with 0 image attempts unchanged", () => {
    const result = applyCalibration([B_EASY, B_HARD], [], FIXED_NOW);
    expect(result[0]).toEqual(B_EASY);
    expect(result[1]).toEqual(B_HARD);
  });
});

// ---------------------------------------------------------------------------
// Orphan itemIds
// ---------------------------------------------------------------------------

describe("orphan itemIds", () => {
  it("reports attempt itemIds not present in the bank", () => {
    const file = makeFile({}, [
      { itemId: "item-easy", correct: true },
      { itemId: "orphan-item-xyz", correct: false },
    ]);
    const { orphanItemIds } = buildReport([file], [B_EASY, B_HARD]);
    expect(orphanItemIds).toContain("orphan-item-xyz");
    expect(orphanItemIds).not.toContain("item-easy");
  });

  it("does not crash when all attempt itemIds are orphans", () => {
    const file = makeFile({}, [
      { itemId: "ghost-1", correct: true },
      { itemId: "ghost-2", correct: false },
    ]);
    expect(() => buildReport([file], [B_EASY, B_HARD])).not.toThrow();
    const { orphanItemIds } = buildReport([file], [B_EASY, B_HARD]);
    expect(orphanItemIds).toContain("ghost-1");
    expect(orphanItemIds).toContain("ghost-2");
  });
});

// ---------------------------------------------------------------------------
// promptVersions
// ---------------------------------------------------------------------------

describe("promptVersions", () => {
  it("lists a single version when all files share one promptVersion", () => {
    const file = makeFile({ promptVersion: "solver-v1" }, [{ itemId: "item-easy", correct: true }]);
    const { promptVersions } = buildReport([file], [B_EASY, B_HARD]);
    expect(promptVersions).toEqual(["solver-v1"]);
  });

  it("lists multiple versions when files differ", () => {
    const f1 = makeFile({ runId: "run-1", promptVersion: "solver-v1" }, [{ itemId: "item-easy", correct: true }]);
    const f2 = makeFile({ runId: "run-2", promptVersion: "solver-v2" }, [{ itemId: "item-hard", correct: false }]);
    const { promptVersions } = buildReport([f1, f2], [B_EASY, B_HARD]);
    expect(promptVersions).toContain("solver-v1");
    expect(promptVersions).toContain("solver-v2");
    expect(promptVersions).toHaveLength(2);
  });
});
