import { expect, test } from "bun:test";
import type { Film } from "../src/web/api";
import {
  buildReel,
  clamp01,
  ELIM_CELLS,
  ELIM_COLS,
  ELIM_ROWS,
  easeOutCubic,
  easeOutQuint,
  eliminationOrder,
  formatRuntime,
  formatYear,
  frameAt,
  interiorCell,
  mulberry32,
  padIndex,
  SCRAPE_BAR_FLOOR,
  SCRAPE_BAR_HALFLIFE_MS,
  scrapeBar,
  smootherstep,
} from "../src/web/spin";

const film = (n: number): Film => ({
  lid: `l${n}`,
  name: `Film ${n}`,
  year: 2000 + n,
  runtime: 90 + n,
  rating: 3.5,
  poster: null,
  director: null,
  url: `https://letterboxd.com/film/s${n}/`,
});

const pool = Array.from({ length: 12 }, (_, i) => film(i));
const winner = film(99);

test("every easing spans exactly zero to one", () => {
  for (const e of [easeOutQuint, easeOutCubic, smootherstep]) {
    expect(e(0)).toBeCloseTo(0, 10);
    expect(e(1)).toBeCloseTo(1, 10);
    expect(e(0.5)).toBeGreaterThan(0);
    expect(e(0.5)).toBeLessThan(1);
  }
});

test("clamp01 pins values outside the unit range", () => {
  expect(clamp01(-3)).toBe(0);
  expect(clamp01(3)).toBe(1);
  expect(clamp01(0.4)).toBe(0.4);
});

test("a reel ends on the winner and never repeats a frame", () => {
  const { tease } = buildReel(pool, winner, 40, mulberry32(7));
  expect(tease).toHaveLength(40);
  expect(tease[39]).toBe(winner);
  for (let i = 1; i < tease.length; i++) {
    expect(tease[i]).not.toBe(tease[i - 1]);
  }
});

test("no frame repeats, at every pool size a watchlist can actually have", () => {
  // A stride only breaks a tie if it is coprime with the pool size. Seven films
  // is a real watchlist, and a stride of seven leaves every repeat in place.
  for (let size = 2; size <= 24; size++) {
    const p = Array.from({ length: size }, (_, i) => film(i));
    const { tease } = buildReel(p, winner, 60, mulberry32(size));
    for (let i = 1; i < tease.length; i++) {
      expect(`${size}:${i}:${tease[i].lid}`).not.toBe(`${size}:${i}:${tease[i - 1].lid}`);
    }
  }
});

test("a one-film pool repeats, because it has no alternative", () => {
  const { tease } = buildReel([film(0)], winner, 5, mulberry32(1));
  expect(tease).toHaveLength(5);
});

test("an empty pool still yields a reel of the requested length", () => {
  // A watchlist can be page-one-partial and enrichment can drop everything;
  // the animation must not divide by zero over it.
  const { tease } = buildReel([], winner, 5, mulberry32(1));
  expect(tease).toHaveLength(5);
  expect(tease.every((f) => f === winner)).toBe(true);
});

test("the reel is reproducible from its seed", () => {
  const a = buildReel(pool, winner, 20, mulberry32(42)).tease.map((f) => f.lid);
  const b = buildReel(pool, winner, 20, mulberry32(42)).tease.map((f) => f.lid);
  expect(a).toEqual(b);
});

test("frameAt stays inside the reel and finishes on its last frame", () => {
  expect(frameAt(40, 0, easeOutCubic)).toBe(0);
  expect(frameAt(40, 1, easeOutCubic)).toBe(39);
  expect(frameAt(40, 2, easeOutCubic)).toBe(39);
  expect(frameAt(40, -1, easeOutCubic)).toBe(0);
  expect(frameAt(0, 0.5, easeOutCubic)).toBe(0);
});

test("the elimination field ranks every cell but the winner", () => {
  const order = eliminationOrder(mulberry32(11));
  expect(order.rank).toHaveLength(ELIM_CELLS);
  expect(order.rank[order.winnerCell]).toBe(ELIM_CELLS - 1);
  const others = order.rank.filter((_, i) => i !== order.winnerCell).sort((a, b) => a - b);
  expect(others).toEqual(Array.from({ length: ELIM_CELLS - 1 }, (_, i) => i));
});

test("the winner never sits on an edge cell, where scaling up would clip", () => {
  // The reveal scales the winner well past its cell inside a grid that clips.
  for (let seed = 0; seed < 200; seed++) {
    const cell = eliminationOrder(mulberry32(seed)).winnerCell;
    const col = cell % ELIM_COLS;
    const row = Math.floor(cell / ELIM_COLS);
    expect(col).toBeGreaterThan(0);
    expect(col).toBeLessThan(ELIM_COLS - 1);
    expect(row).toBeGreaterThan(0);
    expect(row).toBeLessThan(ELIM_ROWS - 1);
  }
});

test("interiorCell moves any cell off both edges and stays in range", () => {
  for (const [count, cols] of [
    [80, 16],
    [70, 14],
    [112, 14],
    [75, 14], // a short last row
  ] as const) {
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const moved = interiorCell(i, count, cols);
      expect(moved).toBeGreaterThanOrEqual(0);
      expect(moved).toBeLessThan(count);
      expect(moved % cols).toBeGreaterThan(0);
      expect(moved % cols).toBeLessThan(cols - 1);
      expect(Math.floor(moved / cols)).toBeGreaterThan(0);
      expect(Math.floor(moved / cols)).toBeLessThan(rows - 1);
    }
  }
});

test("a grid with no interior is left alone rather than mangled", () => {
  expect(interiorCell(0, 4, 2)).toBe(0);
  expect(interiorCell(3, 6, 3)).toBe(3);
});

test("the elimination field is reproducible from its seed", () => {
  expect(eliminationOrder(mulberry32(5))).toEqual(eliminationOrder(mulberry32(5)));
});

test("the scrape bar never starts empty and never claims to be finished early", () => {
  // A zero-width bar reads as a bar that is not running; a full one reads as
  // work that is done, and the response has not landed yet.
  expect(scrapeBar(null, 0, false)).toBe(SCRAPE_BAR_FLOOR);
  expect(scrapeBar({ done: 0, total: 0 }, 0, false)).toBe(SCRAPE_BAR_FLOOR);
  expect(scrapeBar({ done: 0, total: 60 }, 0, false)).toBe(SCRAPE_BAR_FLOOR);
  expect(scrapeBar({ done: 60, total: 60 }, 0, false)).toBeLessThan(1);
  // However long the wait runs, time alone never reaches the end.
  expect(scrapeBar(null, 600_000, false)).toBeLessThan(1);
});

test("the scrape bar fills only once the response is in hand", () => {
  // The warm case: nothing to enrich, so no poll ever observes any work. The
  // bar used to sit at its floor for the whole hold and look broken.
  expect(scrapeBar(null, 5, true)).toBe(1);
  expect(scrapeBar({ done: 0, total: 0 }, 5, true)).toBe(1);
});

test("waiting moves the bar even when no work is ever reported", () => {
  const at = (ms: number) => scrapeBar(null, ms, false);
  expect(at(0)).toBeLessThan(at(200));
  expect(at(200)).toBeLessThan(at(800));
  expect(at(800)).toBeLessThan(at(3000));
  // Halfway down the track at the half-life, by construction.
  expect(at(SCRAPE_BAR_HALFLIFE_MS)).toBeCloseTo(
    SCRAPE_BAR_FLOOR + 0.5 * (0.97 - SCRAPE_BAR_FLOOR),
    6,
  );
});

test("real work overtakes the clock and the bar never goes backwards", () => {
  // Elapsed time is not evidence of progress, so it must not outrun what the
  // server reported; and neither term may ever pull the bar back.
  let prev = -1;
  for (let ms = 0; ms <= 12_000; ms += 100) {
    const done = Math.min(60, Math.floor(ms / 100));
    const w = scrapeBar({ done, total: 60 }, ms, false);
    expect(w).toBeGreaterThanOrEqual(prev);
    expect(w).toBeLessThanOrEqual(1);
    prev = w;
  }
  // A burst of work outruns a short wait.
  expect(scrapeBar({ done: 55, total: 60 }, 100, false)).toBeGreaterThan(
    scrapeBar(null, 100, false),
  );
});

test("the scrape bar rises monotonically with the work done", () => {
  let prev = -1;
  for (let done = 0; done <= 60; done++) {
    const w = scrapeBar({ done, total: 60 }, 0, false);
    expect(w).toBeGreaterThanOrEqual(prev);
    expect(w).toBeLessThanOrEqual(1);
    prev = w;
  }
  // A count past its total cannot push the bar off the end of the track.
  expect(scrapeBar({ done: 999, total: 60 }, 0, false)).toBe(
    scrapeBar({ done: 60, total: 60 }, 0, false),
  );
});

test("unknown facts read as unknown, not as zero", () => {
  expect(formatRuntime(null)).toBe("—");
  expect(formatRuntime(98)).toBe("98 min");
  expect(formatYear(null)).toBe("—");
  expect(formatYear(1979)).toBe("1979");
});

test("positions pad to the width of the largest one", () => {
  expect(padIndex(0, 412)).toBe("001");
  expect(padIndex(41, 412)).toBe("042");
  expect(padIndex(0, 0)).toBe("1");
});
