import type { ConnectionTile, Scene, SceneObject, SceneToken } from "./schema";

/**
 * Scene edit distance — how *close* two board scenes look.
 *
 * Wrong options used to be sampled uniformly from a family's grammar, so a
 * distractor that moves three tokens shipped as readily as one that recolours a
 * single token. Uniform sampling makes the easy elimination the common case. To
 * rank near misses we need one ordering answer: given the correct scene and a
 * pool of candidate wrong scenes, which candidates are hardest to reject at a
 * glance? This module answers exactly that and nothing else — it selects
 * nothing, and it never decides whether a pair is *legible* (that stays with
 * `areScenesCategoricallyDistinct` in schema.ts, which the selector still
 * applies after ranking).
 *
 * The metric is the one the design fixes — see the "Distance contract" section
 * of `docs/plans/escalate-the-quiz.md`. It is a two-level integer tuple, coarse
 * before fine, built in ONE pass over the union of the two boards' coordinates.
 *
 * Each coordinate is first canonicalized into a **tagged value**: `empty`,
 * `token`, `container` (its outline plus its contents in drawing order), or
 * `tile` (the edges it draws, as a set). The tagged value is then spread into
 * named fields:
 *
 *     empty      no fields at all
 *     token      token:shape, token:rotation, token:fill, token:size
 *     container  container:shape, then container:<slot>:{shape,rotation,fill,size}
 *     tile       one field per cardinal edge the tile draws
 *
 * Field names carry their own tag, so no field lines up across two different
 * tags: a container's outline shape is not a token's shape, and matching them
 * would be matching two unrelated marks.
 *
 *  - `positions` — coordinates whose tagged value differs, **one each**. This
 *    term dominates because a cell that gained, lost, or swapped its content is
 *    visible from across the room; it is the difference a solver spots without
 *    reading anything. One coordinate can never contribute more than one.
 *  - `atoms` — the padded Hamming distance over those fields, plus one for the
 *    tag itself when the two tags differ. "Padded" means a field carried by only
 *    one of the two sides still counts as a difference, which is what makes
 *    rebuilding a cell cost more than recolouring whatever already stands in it.
 *
 * Crease guides are **atoms only, never positions**. A crease is drawn across
 * the whole board rather than inside one cell, so there is no coordinate to
 * charge it to, and `positions` is defined as changed board cells. Two boards
 * that differ only in their fold line therefore measure `{positions: 0, atoms:
 * 2}` — nearer than any cell edit, which is the honest reading: every mark is
 * still the same mark in the same place.
 *
 * Everything is integer arithmetic: no floating point appears anywhere, so the
 * ordering is exactly reproducible across machines and across runs, which is
 * what lets a seeded selector replay.
 */

/** A finite distance. Read it as the tuple `[positions, atoms]`, compared in that order. */
export interface SceneGap {
  /** Board coordinates whose content differs — at most one per coordinate. */
  positions: number;
  /** Visible fields that differ, over every coordinate plus the crease guides. */
  atoms: number;
}

/**
 * A distance, or `"incomparable"` for boards of different dimensions.
 *
 * Different board sizes are semantically infinitely far apart: there is no cell
 * correspondence to measure, and such a candidate is rejected as an option
 * anyway. We tag the case instead of using `Infinity` because `JSON.stringify`
 * turns `Infinity` into `null`, and these tuples get written to baseline
 * fixtures. The comparator always ranks the tag last.
 */
export type SceneDistance = SceneGap | "incomparable";

/** One coordinate's canonical value: which mark stands there, and the fields that mark draws. */
interface CanonicalCell {
  /** `empty`, `token`, `container`, or `tile`. */
  tag: string;
  /** Field name to value. Names are tag-prefixed, so nothing matches across two tags. */
  fields: Map<string, string>;
}

/** The value of every coordinate neither board uses. Never mutated. */
const EMPTY_CELL: CanonicalCell = { tag: "empty", fields: new Map() };

function positionKey(entry: { row: number; column: number }): string {
  return `${entry.row}:${entry.column}`;
}

function addTokenFields(fields: Map<string, string>, prefix: string, token: SceneToken): void {
  fields.set(`${prefix}shape`, token.shape);
  fields.set(`${prefix}rotation`, String(token.rotation));
  fields.set(`${prefix}fill`, token.fill);
  fields.set(`${prefix}size`, token.size);
}

/**
 * A container's fields are its own outline plus one numbered group per content
 * slot. The slots are numbered in declared order because the renderer draws them
 * in that order: swapping the two tokens inside one outline changes the picture,
 * so it has to change the distance.
 */
function addObjectFields(fields: Map<string, string>, object: SceneObject): void {
  if (object.kind === "token") {
    addTokenFields(fields, "token:", object);
    return;
  }
  fields.set("container:shape", object.shape);
  object.contents.forEach((content, slot) => addTokenFields(fields, `container:${slot}:`, content));
}

/**
 * A tile's fields are the edges it draws, one field per cardinal direction, so
 * the declared order never matters — this is the "sorted edges" canonical form.
 * The padded Hamming distance over these fields is exactly the symmetric
 * difference of the two edge sets: two tiles drawing the same number of edges
 * and sharing none of them are a full redraw, not a match.
 */
function addTileFields(fields: Map<string, string>, tile: ConnectionTile): void {
  for (const edge of tile.edges) fields.set(`tile:${edge}`, "drawn");
}

/**
 * Canonicalize every occupied coordinate of one scene. Coordinates empty on both
 * boards are simply absent: they are `EMPTY_CELL` on demand and change nothing.
 *
 * The schema allows one visible primitive per coordinate, so a tag is a single
 * word in practice. If a scene ever breaks that rule the tags concatenate rather
 * than one mark overwriting the other, so the collision still reads as a
 * difference instead of vanishing.
 */
function canonicalCells(scene: Scene): Map<string, CanonicalCell> {
  const cells = new Map<string, CanonicalCell>();
  const fieldsFor = (key: string, tag: string): Map<string, string> => {
    const known = cells.get(key);
    if (known !== undefined) {
      known.tag = `${known.tag}+${tag}`;
      return known.fields;
    }
    const created: CanonicalCell = { tag, fields: new Map() };
    cells.set(key, created);
    return created.fields;
  };

  for (const placement of scene.objects) {
    addObjectFields(fieldsFor(positionKey(placement), placement.object.kind), placement.object);
  }
  for (const tile of scene.tiles) {
    addTileFields(fieldsFor(positionKey(tile), "tile"), tile);
  }
  return cells;
}

/**
 * The crease guides of one scene as a flat field map.
 *
 * Guides are keyed the way `sceneSignature` orders them — the same axis sort and
 * the same stable tie-break — so that "distance is zero" and "signatures are
 * equal" stay the same statement even for the schema-legal but unused case of
 * two creases sharing one axis. Each guide contributes its axis and its fold
 * direction, so a crease present on one board only costs two atoms (both fields
 * are padded against nothing), while two creases on the same axis folding
 * opposite ways cost one.
 */
function guideFields(scene: Scene): Map<string, string> {
  const sorted = [...(scene.guides ?? [])].sort((a, b) => a.axis.localeCompare(b.axis));
  const seenPerAxis = new Map<string, number>();
  const fields = new Map<string, string>();
  for (const guide of sorted) {
    const axisKey = `${guide.kind}:${guide.axis}`;
    const ordinal = seenPerAxis.get(axisKey) ?? 0;
    seenPerAxis.set(axisKey, ordinal + 1);
    fields.set(`${axisKey}:${ordinal}:axis`, guide.axis);
    fields.set(`${axisKey}:${ordinal}:direction`, guide.direction);
  }
  return fields;
}

/**
 * Padded Hamming distance between two field maps: every name whose values
 * disagree, plus every name only one side carries. Symmetric by construction.
 */
function paddedHamming(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): number {
  let differing = 0;
  for (const [name, value] of left) if (right.get(name) !== value) differing += 1;
  for (const name of right.keys()) if (!left.has(name)) differing += 1;
  return differing;
}

/**
 * How far apart two scenes look. Symmetric, deterministic, integer-only, and
 * zero exactly when the two scenes carry the same picture — that is, exactly
 * when their `sceneSignature` values agree for scenes built through the schema.
 *
 * **Worked example, a token against a tile.** One board holds a medium solid
 * circle at (0,0); the other draws a north/east connection tile at (0,0) and
 * nothing else. That is ONE changed coordinate: `{positions: 1, atoms: 7}`. The
 * seven atoms are the tag (`token` against `tile`), the token's four fields, and
 * the tile's two edges — nothing on either side has a counterpart. Until
 * 2026-08-26 this module keyed objects and tiles as two independent spaces and
 * summed them, reporting `{positions: 2, atoms: 6}` for that same cell: it
 * charged one board slot twice, which contradicts what `positions` means.
 *
 * **Worked example, a crease.** Two boards holding the same token at (0,0),
 * where only one of them shows a vertical fold line, are `{positions: 0, atoms:
 * 2}` — the axis and the fold direction, padded against a board that carries
 * neither. The old code called that one changed position; a crease occupies no
 * cell, so there was no cell to charge, and the fold is now a fine difference
 * that only separates candidates already tied on layout.
 *
 * A move stays deliberately expensive. A token that leaves (0,0) and appears at
 * (1,1) changes two coordinates and pays the tag plus the token's four fields at
 * each of them, so a pure move is `{positions: 2, atoms: 10}` while recolouring
 * that token in place is `{positions: 1, atoms: 1}`. That ordering is the point:
 * a relocated token is rejected on layout alone, a recoloured one has to be
 * read. The nearest misses should be the ones you have to read.
 */
export function sceneEditDistance(a: Scene, b: Scene): SceneDistance {
  if (a.rows !== b.rows || a.columns !== b.columns) return "incomparable";

  const left = canonicalCells(a);
  const right = canonicalCells(b);
  let positions = 0;
  let atoms = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const leftCell = left.get(key) ?? EMPTY_CELL;
    const rightCell = right.get(key) ?? EMPTY_CELL;
    const changed = paddedHamming(leftCell.fields, rightCell.fields) +
      (leftCell.tag === rightCell.tag ? 0 : 1);
    if (changed > 0) positions += 1;
    atoms += changed;
  }
  return { positions, atoms: atoms + paddedHamming(guideFields(a), guideFields(b)) };
}

/**
 * Order two distances, closest first: fewer changed positions wins, then fewer
 * changed atoms, and `"incomparable"` always sorts last. Returns a negative
 * number, zero, or a positive number, so it drops straight into `Array.sort`.
 */
export function compareCloseness(x: SceneDistance, y: SceneDistance): number {
  if (x === "incomparable") return y === "incomparable" ? 0 : 1;
  if (y === "incomparable") return -1;
  if (x.positions !== y.positions) return x.positions - y.positions;
  return x.atoms - y.atoms;
}

/**
 * Sort a candidate pool by closeness to `answer`, nearest first, without
 * touching the input array.
 *
 * The sort is explicitly stable: equally distant candidates keep the order they
 * arrived in. Downstream selection shuffles a window of the nearest candidates
 * with a seeded generator, so a tie broken by the engine's sort would make the
 * same seed produce different options — stability is what keeps a seeded test
 * replayable. Each candidate's distance is computed once, not once per
 * comparison.
 */
export function rankByCloseness<T>(pool: readonly T[], answer: Scene, sceneOf: (item: T) => Scene): T[] {
  const measured = pool.map((item, index) => ({
    item,
    index,
    distance: sceneEditDistance(sceneOf(item), answer),
  }));
  measured.sort((left, right) => compareCloseness(left.distance, right.distance) || left.index - right.index);
  return measured.map((entry) => entry.item);
}
