import type { ConnectionEdge, ConnectionTile, Scene } from "./schema";

export type TopologyGoal = "singleRoute" | "singleLoop";

export interface TopologyFailure {
  kind: "mismatch" | "endpointCount" | "branch" | "deadEnd" | "disconnected" | "empty";
  message: string;
}

const DIRECTIONS: Record<ConnectionEdge, { row: number; column: number; opposite: ConnectionEdge }> = {
  north: { row: -1, column: 0, opposite: "south" },
  east: { row: 0, column: 1, opposite: "west" },
  south: { row: 1, column: 0, opposite: "north" },
  west: { row: 0, column: -1, opposite: "east" },
};

function key(row: number, column: number): string {
  return `${row}:${column}`;
}

function boundaryEdge(scene: Scene, tile: ConnectionTile, edge: ConnectionEdge): boolean {
  return (edge === "north" && tile.row === 0) ||
    (edge === "east" && tile.column === scene.columns - 1) ||
    (edge === "south" && tile.row === scene.rows - 1) ||
    (edge === "west" && tile.column === 0);
}

/** Validate global route/loop topology and retain concrete graph failures. */
export function topologyFailures(scene: Scene, goal: TopologyGoal): TopologyFailure[] {
  if (scene.tiles.length === 0) return [{ kind: "empty", message: "board has no connections" }];
  const failures: TopologyFailure[] = [];
  const byPosition = new Map(scene.tiles.map((tile) => [key(tile.row, tile.column), tile]));
  const adjacency = new Map<string, Set<string>>();
  const endpoints: string[] = [];

  for (const tile of scene.tiles) {
    const tileKey = key(tile.row, tile.column);
    adjacency.set(tileKey, new Set());
    for (const edge of tile.edges) {
      const direction = DIRECTIONS[edge];
      const nextRow = tile.row + direction.row;
      const nextColumn = tile.column + direction.column;
      const neighbor = byPosition.get(key(nextRow, nextColumn));
      if (!neighbor) {
        if (boundaryEdge(scene, tile, edge)) endpoints.push(`${tileKey}:${edge}`);
        else failures.push({ kind: "mismatch", message: `${tileKey} points ${edge} into an empty slot` });
        continue;
      }
      if (!neighbor.edges.includes(direction.opposite)) {
        failures.push({ kind: "mismatch", message: `${tileKey} ${edge} does not meet its neighbour` });
        continue;
      }
      adjacency.get(tileKey)!.add(key(nextRow, nextColumn));
    }
  }

  const expectedEndpoints = goal === "singleLoop" ? 0 : 2;
  if (endpoints.length !== expectedEndpoints) {
    failures.push({
      kind: "endpointCount",
      message: `${goal} needs ${expectedEndpoints} boundary endpoints, found ${endpoints.length}`,
    });
  }

  for (const [tileKey, neighbours] of adjacency) {
    if (neighbours.size > 2) {
      failures.push({ kind: "branch", message: `${tileKey} creates a branch` });
    }
  }
  for (const tile of scene.tiles) {
    if (tile.edges.length < 2) {
      failures.push({ kind: "deadEnd", message: `${key(tile.row, tile.column)} ends inside a tile` });
    }
    if (tile.edges.length > 2) {
      failures.push({ kind: "branch", message: `${key(tile.row, tile.column)} has more than two exits` });
    }
  }

  const first = scene.tiles[0] && key(scene.tiles[0].row, scene.tiles[0].column);
  const visited = new Set<string>();
  if (first) {
    const queue = [first];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
  }
  if (visited.size !== scene.tiles.length) {
    failures.push({ kind: "disconnected", message: "connections form more than one component" });
  }

  return failures.filter((failure, index, all) =>
    all.findIndex((candidate) => candidate.kind === failure.kind && candidate.message === failure.message) === index,
  );
}

export function topologySatisfies(scene: Scene, goal: TopologyGoal): boolean {
  return topologyFailures(scene, goal).length === 0;
}
