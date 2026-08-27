import type { Film } from "./api";

export type Rng = () => number;

// ── Easing ──────────────────────────────────────────────────────────────────

export const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// Slow start, fast middle, tense finish. Steeper than smoothstep at both ends.
export const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// ── The reel ────────────────────────────────────────────────────────────────

/**
 * What an animation draws. `tease` is decor — films the machine flicks past
 * while it pretends to decide — and `winner` is the film the server actually
 * chose. They are separate because the server draws from the whole watchlist
 * while the pool is only its first page: the winner is frequently not in it.
 */
export type Reel = {
  tease: Film[];
  winner: Film;
};

/**
 * `length` frames of decor ending on the winner, with no frame equal to its
 * predecessor whenever the pool holds two or more films. A pool of one cannot
 * satisfy that and does not pretend to.
 *
 * The nudge is one step, not seven: a stride only breaks a tie if it is
 * coprime with the pool size, and `(k + 7) % 7` is `k`. A seven-film watchlist
 * is entirely reachable — `POOL_PAGE_SIZE` is a ceiling, not a floor — and the
 * reel would visibly stall on repeated frames.
 */
export function buildReel(pool: Film[], winner: Film, length: number, rng: Rng): Reel {
  if (pool.length === 0) return { tease: Array.from({ length }, () => winner), winner };
  const tease: Film[] = [];
  let prev = -1;
  for (let i = 0; i < length; i++) {
    let k = Math.floor(rng() * pool.length);
    if (k === prev) k = (k + 1) % pool.length;
    prev = k;
    tease.push(pool[k]);
  }
  tease[length - 1] = winner;
  return { tease, winner };
}

/** The frame `t` lands on, given a reel of `length` frames under easing `e`. */
export function frameAt(length: number, t: number, e: (x: number) => number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.floor(e(clamp01(t)) * length));
}

// ── Elimination field (the `lastone` animation) ─────────────────────────────

export const ELIM_CELLS = 80;
export const ELIM_COLS = 16;
export const ELIM_ROWS = 5;

/**
 * Moves a cell off the edge of its grid, in both axes.
 *
 * Every grid animation ends by scaling the winner up — 1.6x for the
 * elimination field, 2.4x for the montage — inside a container that clips.
 * A winner in the first or last row or column has its reveal, which is the
 * only frame that matters, cut off by that clip.
 *
 * Grids narrower or shorter than three cells have no interior; those are
 * returned unchanged rather than pretending otherwise. A short last row needs
 * no special case: the clamp already excludes it, and the highest index it can
 * produce is `(rows - 2) * cols + cols - 2`, which is below `count` by the
 * definition of `ceil`.
 */
export function interiorCell(cell: number, count: number, cols: number): number {
  const rows = Math.ceil(count / cols);
  if (cols < 3 || rows < 3) return cell;
  let col = cell % cols;
  let row = Math.floor(cell / cols);
  if (col === 0) col = 1;
  else if (col >= cols - 1) col = cols - 2;
  if (row === 0) row = 1;
  else if (row >= rows - 1) row = rows - 2;
  return row * cols + col;
}

// Integer hash, then bilinear-smooth interpolation between lattice points:
// value noise. Cheap, and unlike white noise it eliminates in blobs and waves
// rather than as static.
function lattice(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 69069)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export type Elimination = {
  /** Cell index the winner occupies. Never on an edge column. */
  winnerCell: number;
  /** `rank[i]` is the position at which cell `i` is eliminated. */
  rank: number[];
};

/**
 * Ranks every cell but the winner's by a field mixing a radial term, a
 * directional sweep and value noise, all randomly weighted per spin. The
 * winner is held back to a rank no elimination count can reach.
 */
export function eliminationOrder(rng: Rng, cells = ELIM_CELLS, cols = ELIM_COLS): Elimination {
  const rows = Math.ceil(cells / cols);
  const winnerCell = interiorCell(Math.floor(rng() * cells), cells, cols);

  const seed = (rng() * 1e9) | 0;
  const ox = rng();
  const oy = rng();
  const angle = rng() * Math.PI * 2;
  const wRadial = 0.5 + rng() * 1.3;
  const wSweep = rng() * 1.1;
  const wNoise = 0.8 + rng() * 1.2;

  const scored: Array<[number, number]> = [];
  for (let i = 0; i < cells; i++) {
    if (i === winnerCell) continue;
    const cx = ((i % cols) + 0.5) / cols;
    const cy = (Math.floor(i / cols) + 0.5) / rows;
    scored.push([
      wRadial * Math.hypot(cx - ox, cy - oy) +
        wSweep * (cx * Math.cos(angle) + cy * Math.sin(angle)) +
        wNoise * noise(cx * 3.2, cy * 2.4, seed) +
        0.14 * rng(),
      i,
    ]);
  }
  scored.sort((a, b) => a[0] - b[0]);

  const rank = new Array<number>(cells).fill(cells - 1);
  scored.forEach(([, i], r) => {
    rank[i] = r;
  });
  return { winnerCell, rank };
}

// ── The intro bar ───────────────────────────────────────────────────────────

/**
 * An inchworm: the leading edge shoots ahead on an ease-out, the trailing edge
 * starts late and catches up. Returned as fractions of the track.
 */
export function introBar(t: number): { left: number; width: number } {
  const lead = easeOutCubic(clamp01(t / 0.6));
  const trail = easeInOutCubic(clamp01((t - 0.25) / 0.75));
  return { left: trail, width: Math.max(0, lead - trail) };
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatRuntime(minutes: number | null): string {
  return minutes === null ? "—" : `${minutes} min`;
}

export function formatRating(rating: number | null): string {
  return rating === null ? "—" : rating.toFixed(2);
}

export function formatYear(year: number | null): string {
  return year === null ? "—" : String(year);
}

/** Zero-padded ordinal, wide enough for the largest index in the set. */
export function padIndex(i: number, total: number): string {
  return String(i + 1).padStart(String(Math.max(total, 1)).length, "0");
}

// ── Seeded randomness ───────────────────────────────────────────────────────

/**
 * mulberry32. A spin's layout is derived from one integer so that a re-render
 * mid-spin — React's strict mode double-invokes, and so does a state change —
 * reproduces exactly what is already on screen instead of reshuffling it.
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
