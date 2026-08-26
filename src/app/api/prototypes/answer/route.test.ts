import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPrototypePilotPackets,
  enabledPrototypePilotKeys,
  openPrototypePilotSitting,
  orderPrototypePilotPacket,
  prototypePilotCandidate,
  prototypePilotItemId,
  resetPrototypePilotSittings,
} from "@/items/prototype-pilot";

const key = enabledPrototypePilotKeys()[0];
const itemId = prototypePilotItemId(key, 1);
const { puzzle } = prototypePilotCandidate(key, 1);
const packet = buildPrototypePilotPackets().find((entry) => entry.items.some((item) => item.itemId === itemId))!;
const START_MS = Date.UTC(2026, 7, 26, 9, 0, 0);

/**
 * Open a sitting exactly as the pilot page does, and hand back the three fields
 * the browser would then send with every request about its first item.
 */
function openSitting() {
  const { sittingId, items } = openPrototypePilotSitting(packet, orderPrototypePilotPacket(packet, "route-test"));
  return { sittingId, itemId, contentFingerprint: items.find((item) => item.itemId === itemId)!.contentFingerprint };
}

async function post(path: "start" | "answer", body: unknown) {
  const { POST } = path === "start" ? await import("../start/route") : await import("./route");
  return POST(new Request(`http://localhost/api/prototypes/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

/** Open a sitting, show the item, and return what the browser needs to answer. */
async function shownItem() {
  const sitting = openSitting();
  const started = await post("start", sitting);
  expect(started.status).toBe(200);
  return sitting;
}

describe("prototype answer route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
    resetPrototypePilotSittings();
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetPrototypePilotSittings();
  });

  it("grades a shown item and returns the server's own solve time, never the answer index", async () => {
    const sitting = await shownItem();
    vi.setSystemTime(START_MS + 12_000);
    const response = await post("answer", { ...sitting, selectedOption: puzzle.answerIndex, elapsedSeconds: 12 });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      correct: true,
      explanation: puzzle.explanation,
      late: false,
      timeBudgetSeconds: key.bandTimeBudgetSeconds,
      elapsedSeconds: 12,
      clientElapsedSeconds: 12,
      clientTimingDisagreementSeconds: 0,
      clientTimingDisagrees: false,
    });
    expect(body).not.toHaveProperty("answerIndex");
  });

  it("grades a wrong answer without saying which option was right", async () => {
    const sitting = await shownItem();
    const wrong = (puzzle.answerIndex + 1) % puzzle.options.length;
    const response = await post("answer", { ...sitting, selectedOption: wrong, elapsedSeconds: 12 });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.correct).toBe(false);
    expect(body).not.toHaveProperty("answerIndex");
    expect(JSON.stringify(body)).not.toContain(`"${puzzle.answerIndex}"`);
  });

  it("uses the server's clock for the late marker even when the body says otherwise", async () => {
    const late = await shownItem();
    vi.setSystemTime(START_MS + (key.bandTimeBudgetSeconds + 5) * 1000);
    // The browser claims one second on an answer that took five over budget.
    const lateBody = await (await post("answer", { ...late, selectedOption: 0, elapsedSeconds: 1 })).json();
    expect(lateBody.elapsedSeconds).toBe(key.bandTimeBudgetSeconds + 5);
    expect(lateBody.late).toBe(true);
    expect(lateBody.clientElapsedSeconds).toBe(1);
    expect(lateBody.clientTimingDisagrees).toBe(true);

    vi.setSystemTime(START_MS);
    const prompt = await shownItem();
    vi.setSystemTime(START_MS + 3_000);
    // And the reverse: a browser claiming a whole day cannot make it late.
    const promptBody = await (await post("answer", { ...prompt, selectedOption: 0, elapsedSeconds: 86_400 })).json();
    expect(promptBody.elapsedSeconds).toBe(3);
    expect(promptBody.late).toBe(false);
    expect(promptBody.timeBudgetSeconds).toBe(key.bandTimeBudgetSeconds);
  });

  it("measures from when the item was first shown, not from the last start call", async () => {
    const sitting = await shownItem();
    vi.setSystemTime(START_MS + 10_000);
    expect((await (await post("start", sitting)).json()).alreadyStarted).toBe(true);
    vi.setSystemTime(START_MS + 20_000);
    const body = await (await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 20 })).json();
    expect(body.elapsedSeconds).toBe(20);
  });

  it("grades one item once and refuses every later attempt without leaking correctness", async () => {
    const sitting = await shownItem();
    expect((await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 5 })).status).toBe(200);
    for (let option = 0; option < puzzle.options.length; option += 1) {
      const response = await post("answer", { ...sitting, selectedOption: option, elapsedSeconds: 5 });
      const body = await response.json();
      expect(response.status, `option ${option}`).toBe(409);
      expect(body.reason).toBe("already-recorded");
      expect(body).not.toHaveProperty("correct");
      expect(body).not.toHaveProperty("explanation");
      expect(body).not.toHaveProperty("late");
      expect(body).not.toHaveProperty("elapsedSeconds");
      expect(JSON.stringify(body)).not.toContain(puzzle.explanation);
    }
    // Nor may the clock be restarted to buy a second attempt.
    const restart = await post("start", sitting);
    expect(restart.status).toBe(409);
    expect((await restart.json()).reason).toBe("already-recorded");
  });

  it("cannot be walked through every option to read the answer out of the grader", async () => {
    const seen: unknown[] = [];
    for (let option = 0; option < puzzle.options.length; option += 1) {
      // A fresh sitting per probe is the only way left to try each option, and
      // even then no response ever names the answer.
      const sitting = await shownItem();
      const body = await (await post("answer", { ...sitting, selectedOption: option, elapsedSeconds: 5 })).json();
      seen.push(body);
      expect(body).not.toHaveProperty("answerIndex");
    }
    expect(JSON.stringify(seen)).not.toContain("answerIndex");
  });

  it("refuses to grade an item the server never recorded showing", async () => {
    const sitting = openSitting();
    const response = await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 5 });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("not-started");
  });

  it("refuses an unknown sitting and content that is not what the sitting served", async () => {
    const sitting = await shownItem();
    const unknown = await post("answer", { ...sitting, sittingId: "0".repeat(32), selectedOption: 0, elapsedSeconds: 5 });
    expect(unknown.status).toBe(409);
    expect((await unknown.json()).reason).toBe("unknown-sitting");

    const drifted = await post("answer", { ...sitting, contentFingerprint: "0".repeat(16), selectedOption: 0, elapsedSeconds: 5 });
    expect(drifted.status).toBe(409);
    expect((await drifted.json()).reason).toBe("content-drift");

    // Neither refusal consumed the item's one attempt.
    expect((await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 5 })).status).toBe(200);
  });

  it("rejects malformed submissions with a reason and no grade", async () => {
    const sitting = await shownItem();
    const cases: [string, unknown][] = [
      ["missing elapsed time", { ...sitting, selectedOption: 0 }],
      ["missing item", { sittingId: sitting.sittingId, contentFingerprint: sitting.contentFingerprint, selectedOption: 0, elapsedSeconds: 5 }],
      ["option out of range", { ...sitting, selectedOption: 9, elapsedSeconds: 5 }],
      ["negative option", { ...sitting, selectedOption: -1, elapsedSeconds: 5 }],
      ["negative elapsed time", { ...sitting, selectedOption: 0, elapsedSeconds: -5 }],
      ["fractional elapsed time", { ...sitting, selectedOption: 0, elapsedSeconds: 1.5 }],
      ["unknown item", { ...sitting, itemId: "made-up-v1:warmup:made-up-d2:r1", selectedOption: 0, elapsedSeconds: 5 }],
      // A pilot v2 id names a family but not which bucket was answered.
      ["a previous pilot's item id", { ...sitting, itemId: `${key.familyId}:r1`, selectedOption: 0, elapsedSeconds: 5 }],
      ["an unexpected field", { ...sitting, selectedOption: 0, elapsedSeconds: 5, session: "participant-01" }],
      ["missing sitting", { itemId, contentFingerprint: sitting.contentFingerprint, selectedOption: 0, elapsedSeconds: 5 }],
      ["a sitting id that is not one", { ...sitting, sittingId: "participant-01", selectedOption: 0, elapsedSeconds: 5 }],
      ["missing content fingerprint", { sittingId: sitting.sittingId, itemId, selectedOption: 0, elapsedSeconds: 5 }],
      ["a fingerprint that is not one", { ...sitting, contentFingerprint: "not-a-fingerprint", selectedOption: 0, elapsedSeconds: 5 }],
    ];
    for (const [label, body] of cases) {
      const response = await post("answer", body);
      expect(response.status, label).toBe(400);
      const parsed = await response.json();
      expect(parsed.error, label).toEqual(expect.any(String));
      expect(parsed, label).not.toHaveProperty("correct");
      expect(parsed, label).not.toHaveProperty("explanation");
    }
    // None of the thirteen burned the item's one grading attempt.
    expect((await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 5 })).status).toBe(200);
  });

  it("is unavailable in production unless the explicit prototype flag is set", async () => {
    const sitting = await shownItem();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_SCENE_PROTOTYPES", "0");
    const response = await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 5 });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });

    vi.stubEnv("ENABLE_SCENE_PROTOTYPES", "1");
    expect((await post("answer", { ...sitting, selectedOption: 0, elapsedSeconds: 5 })).status).toBe(200);
  });
});
