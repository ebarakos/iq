import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaderboardEnabled, leaderboardEnvironment, leaderboardLabel, leaderboardNamespace, quizNamespace } from "./leaderboard-config";

beforeEach(() => vi.stubEnv("LEADERBOARD_ENV", undefined));
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

  it.each([undefined, "development", "preview", "staging", "production"])(
    "shares the existing dev board in %s until production is explicitly selected", (environment) => {
      vi.stubEnv("VERCEL_ENV", environment);
      expect(leaderboardEnvironment()).toBe("dev");
      expect(leaderboardNamespace()).toBe("aiq:local");
      expect(leaderboardLabel()).toBe("Dev leaderboard");
    },
  );

  it("requires production selection on an actual production deployment", () => {
    vi.stubEnv("LEADERBOARD_ENV", "production");
    for (const environment of [undefined, "development", "preview", "staging"]) {
      vi.stubEnv("VERCEL_ENV", environment);
      expect(leaderboardEnvironment()).toBe("dev");
      expect(leaderboardNamespace()).toBe("aiq:local");
    }
    vi.stubEnv("VERCEL_ENV", "production");
    expect(leaderboardEnvironment()).toBe("production");
    expect(leaderboardNamespace()).toBe("aiq:production");
    expect(leaderboardLabel()).toBe("Leaderboard");
  });

  it("can keep or restore the dev board on a production deployment", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LEADERBOARD_ENV", "dev");
    expect(leaderboardNamespace()).toBe("aiq:local");
    for (const value of ["prod", "PRODUCTION", ""]) {
      vi.stubEnv("LEADERBOARD_ENV", value);
      expect(leaderboardNamespace()).toBe("aiq:local");
    }
  });

  it("keeps token and receipt scope stable across leaderboard selections", () => {
    for (const environment of [undefined, "development", "preview", "staging", "production"]) {
      vi.stubEnv("VERCEL_ENV", environment);
      for (const board of [undefined, "dev", "production"]) {
        vi.stubEnv("LEADERBOARD_ENV", board);
        expect(quizNamespace()).toBe(environment === "production" ? "aiq:production" : "aiq:local");
      }
    }
  });
});
