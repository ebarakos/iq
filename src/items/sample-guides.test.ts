import { describe, expect, it } from "vitest";
import { sampleGuide } from "./sample-guides";

describe("sample notes", () => {
  it("say only what the question shows", () => {
    const blank = { blank: true };
    // A one-piece machine table: one worked row and the question row.
    const onePiece = sampleGuide({ layout: "machineTable", stem: Array(6).fill(blank) });
    expect(onePiece).toContain("The top row shows what it does");
    expect(onePiece).not.toMatch(/several pieces/);
    expect(sampleGuide({ layout: "machineTable", stem: Array(9).fill(blank) })).toMatch(/several pieces/);
    expect(sampleGuide({ layout: "grid3x3", gridFlow: "rows", stem: [] })).toMatch(/after the arrow/);
    expect(sampleGuide({ layout: "grid3x3", stem: [] })).toMatch(/row and its column/);
  });
});
