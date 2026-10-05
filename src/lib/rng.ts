/**
 * Seeded RNG (sfc32) — generation must be reproducible (`--seed` on the bank
 * CLI, deterministic tests). Not cryptographic.
 */

export type Rng = () => number; // uniform [0, 1)

export type Seed = string | number;

/**
 * Deterministic string hash used to expand an external seed into PRNG state.
 * Distinct domain prefixes produce four independently mixed 32-bit words for
 * sfc32, preserving more of a long external seed than a single-word PRNG.
 */
function xmur3(value: string): () => number {
  let hash = 1779033703 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

/** Small Fast Counter PRNG with four 32-bit state words. Not cryptographic. */
function sfc32(a: number, b: number, c: number, d: number): Rng {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const value = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) + value | 0;
    return (value >>> 0) / 4294967296;
  };
}

/**
 * Create a reproducible RNG from a user-safe seed and an optional independent
 * stream name. A cryptographically random seed must still be created by the
 * caller; this function only makes generation reproducible after that point.
 */
export function seededRng(seed: Seed, stream = ""): Rng {
  if ((typeof seed === "string" && seed.length === 0) || (typeof seed === "number" && !Number.isFinite(seed))) {
    throw new Error("seed must be a non-empty string or a finite number");
  }
  const canonical = `${typeof seed}:${String(seed)}\u0000${stream}`;
  const state = [0, 1, 2, 3].map((word) => xmur3(`${word}\u0000${canonical}`)());
  return sfc32(state[0], state[1], state[2], state[3]);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Fisher-Yates; returns a new array. */
export function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
