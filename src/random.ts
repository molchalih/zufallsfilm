/**
 * Seeded randomness, shared by the server and the browser bundle.
 *
 * Both ends need a generator they can drive from one integer: the interface so
 * that a re-render mid-spin reproduces the layout already on screen, and the
 * watchlist route so that the sample it draws is the same one on every read of
 * the same watchlist.
 */

export type Rng = () => number;

/**
 * mulberry32. Small, fast, and good enough for decor — nothing here is drawn
 * for a result anyone relies on.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the string, as a seed for `mulberry32`. */
export function seedFrom(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * `n` distinct indices below `count`, in random order.
 *
 * A partial Fisher-Yates: the first `n` swaps of a full shuffle already carry
 * a uniform sample, and stopping there costs `n` steps rather than `count`.
 * Taking a prefix of a sorted draw instead would produce a run, which is the
 * exact thing the sample exists to avoid.
 */
export function sampleIndices(count: number, n: number, rng: Rng): number[] {
  const take = Math.min(Math.max(0, n), Math.max(0, count));
  const order = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (count - i));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order.slice(0, take);
}
