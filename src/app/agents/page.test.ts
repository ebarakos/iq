import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startLinkTest } from "@/lib/link-start";
import { redisCommand } from "@/lib/redis";
import AgentAccessPage from "./page";
import { GET as previewImage } from "./preview.png/route";

vi.mock("@/lib/link-start", () => ({ startLinkTest: vi.fn(() => { throw new Error("must remain untimed"); }) }));
vi.mock("@/lib/redis", () => ({ redisCommand: vi.fn(() => { throw new Error("must work without Redis"); }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("agent access before a timed test", () => {
  it("puts the image check before explicit test starts and explains how to stop safely", async () => {
    const html = renderToStaticMarkup(AgentAccessPage());
    const preview = html.indexOf('href="/agents/preview.png"');
    expect(preview).toBeGreaterThan(-1);
    for (const path of ["/test", "/sample"]) expect(html.indexOf(`href="${path}?new=`)).toBeGreaterThan(preview);
    expect(html).toContain('src="/agents/preview.png"');
    expect(html).toContain("They do not start a test");
    expect(html).toContain("Never guess unseen answers");
    expect(html).toContain("The clock starts when question 1 opens");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("/t/");
    await previewImage().arrayBuffer();
    expect(startLinkTest).not.toHaveBeenCalled();
    expect(redisCommand).not.toHaveBeenCalled();
  });

  it("serves the same real PNG without a token, font files, or a test session", async () => {
    const response = previewImage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([header.getUint32(16), header.getUint32(20)]).toEqual([480, 160]);
    expect(new Uint8Array(await previewImage().arrayBuffer())).toEqual(bytes);
    expect(startLinkTest).not.toHaveBeenCalled();
    expect(redisCommand).not.toHaveBeenCalled();
  });

  it.each(["true", "false"])("offers publication only while the leaderboard is enabled (%s)", (flag) => {
    vi.stubEnv("LEADERBOARD_ENABLED", flag);
    const html = renderToStaticMarkup(AgentAccessPage());
    expect(html.includes("offers links to publish")).toBe(flag === "true");
  });
});
