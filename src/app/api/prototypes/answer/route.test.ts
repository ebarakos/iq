import { beforeEach, describe, expect, it, vi } from "vitest";

describe("prototype answer route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("grades a fixed item without returning its answer index", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/prototypes/answer", {
      method: "POST",
      body: JSON.stringify({ itemId: "relational-sequence-v1:r1", selectedOption: 0 }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ correct: expect.any(Boolean), explanation: expect.any(String) });
    expect(body).not.toHaveProperty("answerIndex");
  });

  it("is unavailable in production unless the explicit prototype flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_SCENE_PROTOTYPES", "0");
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/prototypes/answer", {
      method: "POST",
      body: JSON.stringify({ itemId: "relational-sequence-v1:r1", selectedOption: 0 }),
    }));
    expect(response.status).toBe(404);
  });
});
