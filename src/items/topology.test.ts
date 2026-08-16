import { describe, expect, it } from "vitest";
import type { Scene } from "./schema";
import { topologyFailures, topologySatisfies } from "./topology";

describe("topology solver", () => {
  it("accepts one connected boundary-to-boundary route", () => {
    const route: Scene = {
      kind: "scene",
      rows: 2,
      columns: 2,
      objects: [],
      tiles: [
        { row: 0, column: 0, edges: ["east", "west"] },
        { row: 0, column: 1, edges: ["east", "west"] },
      ],
    };
    expect(topologyFailures(route, "singleRoute")).toEqual([]);
    expect(topologySatisfies(route, "singleRoute")).toBe(true);
  });

  it("rejects mismatches and disconnected components with witnesses", () => {
    const broken: Scene = {
      kind: "scene",
      rows: 3,
      columns: 3,
      objects: [],
      tiles: [
        { row: 0, column: 0, edges: ["north", "east"] },
        { row: 0, column: 1, edges: ["east", "south"] },
        { row: 2, column: 2, edges: ["south"] },
      ],
    };
    const kinds = topologyFailures(broken, "singleRoute").map((failure) => failure.kind);
    expect(kinds).toContain("mismatch");
    expect(kinds).toContain("disconnected");
    expect(topologySatisfies(broken, "singleRoute")).toBe(false);
  });
});
