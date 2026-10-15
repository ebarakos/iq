import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientAddress, RATE_LIMITS, startAllowed, withinRateLimit } from "./rate-limit";

const store = vi.hoisted(() => ({ counts: new Map<string, number>(), expiries: new Map<string, number>() }));
vi.mock("./redis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redis")>()),
  redisCommand: vi.fn(async (command: (string | number)[]) => {
    const key = String(command[1]);
    if (command[0] === "INCR") {
      const count = (store.counts.get(key) ?? 0) + 1;
      store.counts.set(key, count);
      return count;
    }
    if (command[0] === "EXPIRE") {
      store.expiries.set(key, Number(command[2]));
      return 1;
    }
    throw new Error("Unexpected Redis command");
  }),
}));

beforeEach(() => {
  store.counts.clear();
  store.expiries.clear();
  vi.clearAllMocks();
});

describe("rate limits", () => {
  it("allows the limit in one window, refuses the next request, and resets in the next hour", async () => {
    const now = 7_200_000;
    for (let i = 0; i < RATE_LIMITS.publish; i++) {
      expect(await withinRateLimit("publish", "203.0.113.7", now)).toBe(true);
    }
    expect(await withinRateLimit("publish", "203.0.113.7", now + 10)).toBe(false);
    expect(await withinRateLimit("publish", "198.51.100.1", now)).toBe(true);
    expect(await withinRateLimit("publish", "203.0.113.7", now + 3600)).toBe(true);
    expect([...store.expiries.values()].every((seconds) => seconds === 3600)).toBe(true);
  });

  it("keeps each bucket separate and never stores the address itself", async () => {
    await withinRateLimit("start", "203.0.113.7", 100);
    await withinRateLimit("publish", "203.0.113.7", 100);
    expect(store.counts.size).toBe(2);
    expect([...store.counts.keys()].join(" ")).not.toContain("203.0.113.7");
  });

  it("reads the first forwarded address", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientAddress(new Headers())).toBe("unknown");
  });

  it("lets a test start when Redis is down", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    const { redisCommand } = await import("./redis");
    vi.mocked(redisCommand).mockRejectedValueOnce(new Error("Connection failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startAllowed(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe(true);
    error.mockRestore();
    vi.unstubAllEnvs();
  });
});
