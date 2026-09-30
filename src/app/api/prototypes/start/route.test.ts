import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPrototypePilotPackets,
  enabledPrototypePilotKeys,
  openPrototypePilotSitting,
  orderPrototypePilotPacket,
  prototypePilotItemId,
  resetPrototypePilotSittings,
} from "@/items/prototype-pilot";

const key = enabledPrototypePilotKeys()[0];
const itemId = prototypePilotItemId(key, 1);
const packet = buildPrototypePilotPackets().find((entry) => entry.items.some((item) => item.itemId === itemId))!;

function openSitting() {
  const { sittingId, items } = openPrototypePilotSitting(packet, orderPrototypePilotPacket(packet, "start-route-test"));
  return { sittingId, itemId, contentFingerprint: items.find((item) => item.itemId === itemId)!.contentFingerprint };
}

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/prototypes/start", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

describe("prototype start route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
    resetPrototypePilotSittings();
  });
  afterEach(() => resetPrototypePilotSittings());

  it("stamps an item and reports the band budget the answer will be judged against", async () => {
    const response = await post(openSitting());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      started: true,
      alreadyStarted: false,
      timeBudgetSeconds: key.bandTimeBudgetSeconds,
    });
  });

  it("serves items that carry no answer, which is the whole protection", async () => {
    // Since 2026-08-27 the GRADE names the answer, so the page can mark it —
    // every explanation refers to "the correct answer". That makes this the
    // only line of defence left: what a sitting hands the browser before an
    // answer is locked must be the answer-free public puzzle, with no key
    // anywhere in it, at any depth.
    const { items } = openPrototypePilotSitting(packet, orderPrototypePilotPacket(packet, "leak-check"));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const serialised = JSON.stringify(item);
      expect(serialised, item.itemId).not.toContain("answerIndex");
      expect(serialised, item.itemId).not.toContain("explanation");
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (value && typeof value === "object") {
          for (const [name, child] of Object.entries(value)) {
            expect(name, `${item.itemId} key`).not.toMatch(/answer|solution|correct/i);
            walk(child);
          }
        }
      };
      walk(item);
    }
  });

  it("says so rather than restarting the clock when an item is started twice", async () => {
    const sitting = openSitting();
    await post(sitting);
    expect((await (await post(sitting)).json()).alreadyStarted).toBe(true);
  });

  it("refuses a sitting the server no longer holds", async () => {
    const response = await post({ ...openSitting(), sittingId: "0".repeat(32) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.reason).toBe("unknown-sitting");
    expect(body.error).toEqual(expect.any(String));
  });

  it("refuses content the sitting did not serve", async () => {
    const response = await post({ ...openSitting(), contentFingerprint: "0".repeat(16) });
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("content-drift");
  });

  it("refuses an item this sitting is not serving", async () => {
    const response = await post({ ...openSitting(), itemId: "made-up-v1:warmup:made-up-d2:r1" });
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe("unknown-item");
  });

  it("rejects malformed bodies", async () => {
    const sitting = openSitting();
    const cases: [string, unknown][] = [
      ["missing sitting", { itemId, contentFingerprint: sitting.contentFingerprint }],
      ["missing item", { sittingId: sitting.sittingId, contentFingerprint: sitting.contentFingerprint }],
      ["missing fingerprint", { sittingId: sitting.sittingId, itemId }],
      ["a sitting id that is not one", { ...sitting, sittingId: "participant-01" }],
      ["a fingerprint that is not one", { ...sitting, contentFingerprint: "nope" }],
      ["an unexpected field", { ...sitting, selectedOption: 0 }],
    ];
    for (const [label, body] of cases) {
      const response = await post(body);
      expect(response.status, label).toBe(400);
      expect((await response.json()).error, label).toEqual(expect.any(String));
    }
  });

  it("is unavailable in production unless the explicit prototype flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_SCENE_PROTOTYPES", "0");
    const response = await post(openSitting());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
