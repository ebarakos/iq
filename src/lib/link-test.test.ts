import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBank } from "@/items/bank";
import { drawExpandedSlot, EXPANDED_GENERATOR_VERSION, planExpandedSchedule } from "@/items/expanded-quiz";
import { CURRENT_FAMILY_PROMOTION_REGISTRY } from "@/items/family-promotion";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import {
  clearBuiltLinkTests,
  beginLinkTest,
  continueLinkTest,
  createLinkTest,
  formatLinkAnswers,
  issueLinkTest,
  LinkTestError,
  linkTestQuestion,
  LinkTestProgressSchema,
  loadLinkTest,
  OPTION_LETTERS,
  openLinkToken,
  parseLinkAnswers,
  sealLinkToken,
  withdrawnFamilyHash,
} from "./link-test";
import packageJson from "../../package.json";
import { SECONDS_PER_QUESTION, sealTokenJson } from "./quiz-token";

const SECRET = "test-only-link-test-secret-with-at-least-32-characters";
const NO_WITHDRAWALS = new Set<string>();
const context = { secret: SECRET, withdrawnFamilyIds: NO_WITHDRAWALS };

afterEach(() => vi.unstubAllEnvs());

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LinkTestError ? error.code : `not a LinkTestError: ${String(error)}`;
  }
  return undefined;
}

describe("link test token", () => {
  it.each(["short-5", "long-30"] as const)("rebuilds the identical %s test from a short token", (profile) => {
    const created = createLinkTest(profile, { ...context, seed: `link-rebuild-${profile}` });
    expect(created.test.source).toBe("generated");
    expect(created.puzzles).toHaveLength(profile === "short-5" ? 5 : 30);
    expect(created.test.answerDeadline - created.test.issuedAt).toBe(SECONDS_PER_QUESTION * created.puzzles.length);
    // Short enough for a link, at either length.
    expect(created.token.length).toBeLessThan(300);
    expect(created.token).toMatch(/^[A-Za-z0-9_.-]+$/);

    clearBuiltLinkTests();
    const rebuilt = loadLinkTest(created.token, context);
    expect(rebuilt.test).toEqual(created.test);
    expect(rebuilt.puzzles).toEqual(created.puzzles);
  });

  it("builds the same test over many requests, one question at a time", () => {
    const seed = "link-built-in-parts";
    const created = createLinkTest("long-30", { ...context, seed });
    clearBuiltLinkTests();

    // A zero budget still builds one question per request; the progress goes
    // through storage as text between requests.
    let step = continueLinkTest(beginLinkTest("long-30", { ...context, seed }), 0, context);
    let requests = 1;
    while ("progress" in step) {
      expect(step.progress.attempts).toHaveLength(requests);
      const stored = LinkTestProgressSchema.parse(JSON.parse(JSON.stringify(step.progress)));
      step = continueLinkTest(stored, 0, context);
      requests += 1;
    }
    expect(requests).toBe(30);

    const { issuedAt, answerDeadline, expiresAt, ...unclocked } = created.test;
    expect(step.draft).toEqual(unclocked);
    // The clock starts when the test is issued, not when it was built.
    const now = issuedAt + 120;
    const issued = issueLinkTest(step.draft, { ...context, nowSeconds: now });
    expect(issued.test).toEqual({ ...created.test, issuedAt: now, answerDeadline: answerDeadline + 120, expiresAt: expiresAt + 120 });
    clearBuiltLinkTests();
    expect(loadLinkTest(issued.token, { ...context, nowSeconds: now }).puzzles).toEqual(created.puzzles);

    // Finished in one request when the budget allows.
    expect(continueLinkTest(beginLinkTest("short-5", context), 60_000, context)).toHaveProperty("draft");
    // Progress made before the site changed what it builds cannot be finished.
    const started = beginLinkTest("short-5", context);
    expect(errorCode(() => continueLinkTest(started, 0, { ...context, withdrawnFamilyIds: new Set(["some-family"]) })))
      .toBe("changed");
  }, 60_000);

  it("builds one question alone on a server that does not hold the test", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-one-question" });
    expect(created.test.attempts).toEqual([0, 0, 0, 0, 0]);
    clearBuiltLinkTests();
    const test = openLinkToken(created.token, context);
    created.puzzles.forEach((puzzle, index) => {
      expect(linkTestQuestion(test, index + 1, context)).toEqual(puzzle);
    });
    for (const outside of [0, 6, 1.5]) expect(linkTestQuestion(test, outside, context)).toBeUndefined();

    // The token's kept attempt decides what is built alone; the whole test is
    // never consulted. Claim a later attempt that also passes, and that draw comes back.
    const schedule = planExpandedSchedule(created.test.seed, "short-5", CURRENT_FAMILY_PROMOTION_REGISTRY, NO_WITHDRAWALS);
    const slot = schedule.findIndex((selected, index) =>
      drawExpandedSlot(created.test.seed, "short-5", index, 1, selected).accepted);
    expect(slot).toBeGreaterThanOrEqual(0);
    const claimed = created.test.attempts!.map((attempt, index) => index === slot ? 1 : attempt);
    const later = openLinkToken(sealLinkToken({ ...created.test, attempts: claimed }, SECRET), context);
    expect(later.attempts).toEqual(claimed);
    clearBuiltLinkTests();
    expect(linkTestQuestion(later, slot + 1, context)).not.toEqual(created.puzzles[slot]);

    // A token made before kept attempts were sealed rebuilds the whole test instead.
    const legacy = openLinkToken(sealLinkToken({ ...created.test, attempts: undefined }, SECRET), context);
    expect(legacy.attempts).toBeUndefined();
    clearBuiltLinkTests();
    expect(linkTestQuestion(legacy, 3, context)).toEqual(created.puzzles[2]);
  }, 30_000);

  it("seals the starting app version and refuses cross-environment replay", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-scope" });
    expect(openLinkToken(created.token, context).appVersion).toBe(`v${packageJson.version}`);
    const older = sealLinkToken({ ...created.test, appVersion: "v0.1.1" }, SECRET);
    expect(openLinkToken(older, context).appVersion).toBe("v0.1.1");
    const foreign = sealLinkToken({ ...created.test, leaderboardScope: "aiq:another-environment" }, SECRET);
    expect(errorCode(() => loadLinkTest(foreign, context))).toBe("invalid");
  });

  it("shares dev links with preview and staging while refusing them in production", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("LEADERBOARD_ENV", "dev");
    const created = createLinkTest("short-5", { ...context, seed: "link-leaderboard-scope" });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(openLinkToken(created.token, context)).toEqual(created.test);
    vi.stubEnv("VERCEL_ENV", "staging");
    expect(openLinkToken(created.token, context)).toEqual(created.test);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(errorCode(() => openLinkToken(created.token, context))).toBe("invalid");
    vi.stubEnv("LEADERBOARD_ENV", "production");
    expect(errorCode(() => openLinkToken(created.token, context))).toBe("invalid");
  });

  it("keeps production links valid across leaderboard switches and a cold rebuild", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("LEADERBOARD_ENV", "dev");
    const created = createLinkTest("short-5", { ...context, seed: "production-link-scope" });
    expect(created.test.leaderboardScope).toBe("aiq:production");
    const deployed = sealLinkToken({ ...created.test, leaderboardScope: "aiq:production" }, SECRET);
    for (const board of [undefined, "production", "dev"]) {
      vi.stubEnv("LEADERBOARD_ENV", board);
      expect(openLinkToken(deployed, context)).toEqual(created.test);
      expect(openLinkToken(created.token, context)).toEqual(created.test);
    }
    clearBuiltLinkTests();
    expect(loadLinkTest(created.token, context).puzzles).toEqual(created.puzzles);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(errorCode(() => openLinkToken(created.token, context))).toBe("invalid");
  });

  it("seals nothing a reader could use: no seed, no answer", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-opaque-seed" });
    expect(created.token).not.toContain("link-opaque-seed");
    expect(created.token).not.toContain(EXPANDED_GENERATOR_VERSION);
  });

  it("refuses a token from another generator version", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-version" });
    const stale = sealLinkToken({ ...created.test, generatorVersion: "scene-families-v0" }, SECRET);
    expect(errorCode(() => openLinkToken(stale, context))).toBe("changed");
    expect(errorCode(() => loadLinkTest(stale, context))).toBe("changed");
  });

  it("refuses a token made under another withdrawal list", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-withdrawn" });
    const withdrawn = new Set(["some-withdrawn-family"]);
    expect(withdrawnFamilyHash(withdrawn)).not.toBe(withdrawnFamilyHash(NO_WITHDRAWALS));
    // The order a list is written in does not matter; its contents do.
    expect(withdrawnFamilyHash(["b", "a"])).toBe(withdrawnFamilyHash(["a", "b", "a"]));
    expect(errorCode(() => openLinkToken(created.token, { ...context, withdrawnFamilyIds: withdrawn }))).toBe("changed");
    expect(errorCode(() => openLinkToken(created.token, context))).toBeUndefined();
  });

  it("falls back to the reference bank when generation fails, and rebuilds that test too", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = loadBank();
    const created = createLinkTest("short-5", {
      ...context,
      bank,
      seed: "link-fallback",
      assemble: () => { throw new Error("generation is down"); },
    });
    error.mockRestore();
    expect(created.test.source).toBe("fallback");
    expect(created.test.bankHash).toBeDefined();

    expect(created.test.attempts).toBeUndefined();

    clearBuiltLinkTests();
    expect(loadLinkTest(created.token, { ...context, bank }).puzzles).toEqual(created.puzzles);
    clearBuiltLinkTests();
    expect(linkTestQuestion(openLinkToken(created.token, { ...context, bank }), 2, { ...context, bank }))
      .toEqual(created.puzzles[1]);
    // A different reference bank would draw other questions from the same seed.
    expect(errorCode(() => openLinkToken(created.token, { ...context, bank: [...bank].reverse() }))).toBe("changed");
  });

  it("refuses an expired, tampered or foreign token", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-refusals" });
    const expired = errorCode(() => openLinkToken(created.token, { ...context, nowSeconds: created.test.expiresAt }));
    expect(expired).toBe("expired");

    const [version, iv, ciphertext, tag] = created.token.split(".");
    const flipped = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    expect(errorCode(() => openLinkToken([version, iv, flipped, tag].join("."), context))).toBe("invalid");
    expect(errorCode(() => openLinkToken(created.token, { ...context, secret: `${SECRET}-other` }))).toBe("invalid");
    expect(errorCode(() => openLinkToken("not-a-token", context))).toBe("invalid");

    // A token sealed for another kind never opens as a test token, even under the same secret.
    const other = sealTokenJson(openLinkToken(created.token, context), { version: "v1", aad: "aiq.quiz-token.v1" }, SECRET);
    expect(errorCode(() => openLinkToken(other, context))).toBe("invalid");
  });

  it("uses a fresh nonce, so the same test never gives the same token twice", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-nonce" });
    expect(sealLinkToken(created.test, SECRET)).not.toBe(sealLinkToken(created.test, SECRET));
  });

  it("seals whether ranking was on when the test started, and nothing else turns it on", () => {
    vi.stubEnv("LEADERBOARD_ENABLED", "true");
    const ranked = createLinkTest("short-5", { ...context, seed: "link-rank" });
    expect(openLinkToken(ranked.token, context).rankAllowed).toBe(true);
    vi.stubEnv("LEADERBOARD_ENABLED", "false");
    const unranked = createLinkTest("short-5", { ...context, seed: "link-rank" });
    expect(openLinkToken(unranked.token, context).rankAllowed).toBe(false);
    vi.stubEnv("LEADERBOARD_ENABLED", "true");
    expect(openLinkToken(unranked.token, context).rankAllowed).toBe(false);
    const legacy = { ...ranked.test, rankAllowed: undefined };
    expect(openLinkToken(sealLinkToken(legacy, SECRET), context).rankAllowed).toBeUndefined();
  });
});

describe("link answers", () => {
  it("has one letter per option", () => {
    expect(OPTION_LETTERS).toHaveLength(OPTIONS_PER_ITEM);
    expect(OPTION_LETTERS[0]).toBe("A");
  });

  it("reads and writes letters and skips", () => {
    expect(parseLinkAnswers("BC-A")).toEqual([1, 2, null, 0]);
    expect(parseLinkAnswers(undefined)).toEqual([]);
    expect(parseLinkAnswers("")).toEqual([]);
    expect(formatLinkAnswers([1, 2, null, 0])).toBe("BC-A");
    expect(parseLinkAnswers(formatLinkAnswers([5, null]))).toEqual([5, null]);
  });

  it("refuses anything that is not an option letter or a skip", () => {
    const pastTheLast = String.fromCharCode(65 + OPTIONS_PER_ITEM);
    expect(parseLinkAnswers(`A${pastTheLast}`)).toBeNull();
    expect(parseLinkAnswers("A1")).toBeNull();
    expect(parseLinkAnswers(["A", "B"])).toBeNull();
  });
});
