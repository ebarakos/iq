import { afterEach, describe, expect, it, vi } from "vitest";
import { leaderboardEnabled, leaderboardNamespace } from "./leaderboard-config";

afterEach(() => vi.unstubAllEnvs());

describe("leaderboard deployment gate", () => {
  it("defaults to local development only, even when deployed with development NODE_ENV", () => {
    vi.stubEnv("LEADERBOARD_ENABLED", undefined);
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("NODE_ENV", "development");
    expect(leaderboardEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(leaderboardEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(leaderboardEnabled()).toBe(false);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("VERCEL", "1");
    expect(leaderboardEnabled()).toBe(false);
  });

  it("requires exactly true for deployment opt-in and supports disabling locally", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("LEADERBOARD_ENABLED", "true");
    expect(leaderboardEnabled()).toBe(true);
    for (const value of ["false", "1", "", "TRUE"]) {
      vi.stubEnv("LEADERBOARD_ENABLED", value);
      expect(leaderboardEnabled()).toBe(false);
    }
  });

  it("separates local, preview and production data", () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(leaderboardNamespace()).toBe("aiq:local");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(leaderboardNamespace()).toBe("aiq:preview");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(leaderboardNamespace()).toBe("aiq:production");
  });
});
