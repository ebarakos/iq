import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, apiFetch } from "./relay-client";

function jsonResponse(payload: unknown, init: Omit<ResponseInit, "body">) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

function textResponse(body: string, init: Omit<ResponseInit, "body">) {
  return new Response(body, {
    headers: { "Content-Type": "text/plain", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws RateLimitError for 429 JSON responses", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          source: "relay",
          limitType: "minute",
          message: "Too many requests",
          retryAfter: "in 1 minute",
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(apiFetch("/api/generate", { fresh: false })).rejects.toMatchObject({
      info: {
        source: "relay",
        limitType: "minute",
        message: "Too many requests",
        retryAfter: "in 1 minute",
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to plain-text parsing for malformed 429 payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        textResponse("Rate limit hit by relay", {
          status: 429,
        }),
      ),
    );

    try {
      await apiFetch("/api/generate", { fresh: true });
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).info.message).toBe("Rate limit hit by relay");
      return;
    }

    throw new Error("expected a rate-limit error");
  });

  it("throws a readable message for non-JSON 500 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        textResponse("relay unavailable", {
          status: 500,
        }),
      ),
    );

    await expect(apiFetch("/api/generate", {})).rejects.toThrow("relay unavailable");
  });
});
