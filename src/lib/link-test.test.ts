import { describe, expect, it, vi } from "vitest";
import { loadBank } from "@/items/bank";
import { EXPANDED_GENERATOR_VERSION } from "@/items/expanded-quiz";
import { OPTIONS_PER_ITEM } from "@/items/schema";
import {
  clearBuiltLinkTests,
  createLinkTest,
  formatLinkAnswers,
  LinkTestError,
  loadLinkTest,
  OPTION_LETTERS,
  openLinkToken,
  parseLinkAnswers,
  sealLinkToken,
  withdrawnFamilyHash,
} from "./link-test";
import packageJson from "../../package.json";
import { createQuizDelivery, SECONDS_PER_QUESTION } from "./quiz-token";

const SECRET = "test-only-link-test-secret-with-at-least-32-characters";
const NO_WITHDRAWALS = new Set<string>();
const context = { secret: SECRET, withdrawnFamilyIds: NO_WITHDRAWALS };

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

  it("seals the starting app version and refuses cross-environment replay", () => {
    const created = createLinkTest("short-5", { ...context, seed: "link-scope" });
    expect(openLinkToken(created.token, context).appVersion).toBe(`v${packageJson.version}`);
    const older = sealLinkToken({ ...created.test, appVersion: "v0.1.1" }, SECRET);
    expect(openLinkToken(older, context).appVersion).toBe("v0.1.1");
    const foreign = sealLinkToken({ ...created.test, leaderboardScope: "aiq:another-environment" }, SECRET);
    expect(errorCode(() => loadLinkTest(foreign, context))).toBe("invalid");
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

    clearBuiltLinkTests();
    expect(loadLinkTest(created.token, { ...context, bank }).puzzles).toEqual(created.puzzles);
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

    // An in-page quiz token never opens as a link token.
    const { quizToken } = createQuizDelivery(created.puzzles, { secret: SECRET });
    expect(errorCode(() => openLinkToken(quizToken, context))).toBe("invalid");
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
