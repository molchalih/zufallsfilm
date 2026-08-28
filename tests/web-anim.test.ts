import { expect, test } from "bun:test";
import { elimCells } from "../src/web/anim/LastOne";
import {
  MONTAGE_COLS,
  MONTAGE_MAX_CELLS,
  MONTAGE_MIN_CELLS,
  montageFrame,
} from "../src/web/anim/Montage";
import { GATE_OFFSET, OVERSCROLL, ROW_HEIGHT, rollOffset, rollRows } from "../src/web/anim/Roll";
import type { AnimProps } from "../src/web/anim/shared";
import {
  animationFromSearch,
  cellFilm,
  hashUnit,
  positionLabel,
  posterBackground,
} from "../src/web/anim/shared";
import { voidFrame } from "../src/web/anim/Void";
import type { Film } from "../src/web/api";
import { buildReel, ELIM_CELLS, eliminationOrder, mulberry32 } from "../src/web/spin";

const film = (n: number, poster: string | null = null): Film => ({
  lid: `l${n}`,
  name: `Film ${n}`,
  year: 2000 + n,
  runtime: 90,
  rating: null,
  poster,
  director: null,
  url: `https://letterboxd.com/film/s${n}/`,
});

function props(t: number, poolSize = 40, winner = film(999)): AnimProps {
  const pool = Array.from({ length: poolSize }, (_, i) => film(i));
  return {
    reel: buildReel(pool, winner, 40, mulberry32(3)),
    pool,
    total: 350,
    poolIndex: new Map(pool.map((f, i) => [f.lid, i] as const)),
    winnerPosition: 207,
    seed: 12345,
    t,
  };
}

test("a poster is quoted and escaped into the background shorthand", () => {
  expect(posterBackground(null)).toBe("var(--paper-alt)");
  expect(posterBackground("https://a.ltrbxd.com/a b.jpg")).toContain("a%20b.jpg");
  expect(posterBackground("https://a.ltrbxd.com/x.jpg")).toStartWith("var(--paper) url(");
});

test("the id hash is stable and inside the unit range", () => {
  expect(hashUnit("abc", 3)).toBe(hashUnit("abc", 3));
  expect(hashUnit("abc", 3)).not.toBe(hashUnit("abc", 7));
  for (const id of ["", "a", "eCrQ", "l12"]) {
    const v = hashUnit(id, 1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
});

test("a grid cell shows the winner only at its reserved index", () => {
  const p = props(0.5);
  expect(cellFilm(p, 4, 4)).toBe(p.reel.winner);
  expect(cellFilm(p, 4, 5)).toBe(p.pool[5]);
});

test("a winner absent from the pool still shows its own watchlist position", () => {
  // The draw is from the whole watchlist and the pool is one page of it, so
  // the winner is usually not in `poolIndex`. It used to render as a bare dot.
  const p = props(0.5);
  expect(p.poolIndex.has(p.reel.winner.lid)).toBe(false);
  expect(positionLabel(p, p.reel.winner)).toBe("207");
  expect(positionLabel(p, p.pool[7])).toBe("008");
});

test("every row of the roll strip carries a number", () => {
  const p = props(1);
  for (const row of rollRows(p)) {
    expect(`${row.title}: ${row.num}`).toMatch(/: \d+$/);
  }
});

test("the roll strip lands the winner exactly on the gate", () => {
  const p = props(1);
  const rows = rollRows(p);
  const frames = p.reel.tease.length;
  expect(rows).toHaveLength(frames + OVERSCROLL);
  expect(rows[frames - 1].title).toBe(p.reel.winner.name);
  const top = (frames - 1) * ROW_HEIGHT + rollOffset(frames, 1);
  expect(top).toBeCloseTo(GATE_OFFSET, 6);
});

test("the roll strip keeps running past the gate", () => {
  // A strip that ends on the winner leaves the lower half of the window empty.
  const p = props(1);
  const rows = rollRows(p);
  const bottom = rows.length * ROW_HEIGHT + rollOffset(p.reel.tease.length, 1);
  expect(bottom).toBeGreaterThan(GATE_OFFSET + ROW_HEIGHT * 2);
});

test("the roll strip starts with its first row on the gate", () => {
  expect(rollOffset(88, 0)).toBe(GATE_OFFSET);
});

test("roll rows carry stable, distinct keys", () => {
  const ids = rollRows(props(0.3)).map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the montage grid is bounded above and below, whatever the pool", () => {
  expect(montageFrame(props(0.4, 400)).cells).toHaveLength(MONTAGE_MAX_CELLS);
  // A short watchlist tiles up to a full grid rather than stretching two rows.
  expect(montageFrame(props(0.4, 9)).cells).toHaveLength(MONTAGE_MIN_CELLS);
  expect(MONTAGE_MAX_CELLS % MONTAGE_COLS).toBe(0);
  expect(MONTAGE_MIN_CELLS % MONTAGE_COLS).toBe(0);
});

test("an empty pool still renders a montage", () => {
  const f = montageFrame(props(0.4, 0));
  expect(f.cells).toHaveLength(MONTAGE_MIN_CELLS);
  expect(f.title).toBeTruthy();
});

test("the montage locks onto the winner at the end of the spin", () => {
  const p = props(1);
  const f = montageFrame(p);
  expect(f.title).toBe(p.reel.winner.name.toUpperCase());
  expect(f.cells.filter((c) => c.style.zIndex === 3)).toHaveLength(1);
  // Everything else has faded out; only the winner is still opaque.
  const lit = f.cells.filter((c) => Number(c.style.opacity ?? 1) > 0.001);
  expect(lit).toHaveLength(1);
});

test("montage cells carry stable, distinct keys", () => {
  const ids = montageFrame(props(0.5)).cells.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the void settles on the winner and parks its dot", () => {
  const p = props(1);
  const f = voidFrame(p);
  expect(f.title).toBe(p.reel.winner.name);
  expect(f.dot.left).toBe("78%");
  expect(f.dot.top).toBe("50%");
  expect(f.index).toContain("350");
});

test("the void shows a pool film while it is still deciding", () => {
  const p = props(0.2);
  expect(p.pool.some((f) => f.name === voidFrame(p).title)).toBe(true);
});

test("elimination leaves exactly one cell standing", () => {
  const p = props(1);
  const order = eliminationOrder(mulberry32(p.seed));
  const cells = elimCells(p, order);
  expect(cells).toHaveLength(ELIM_CELLS);
  const alive = cells.filter((c) => c.style.background !== "var(--accent)");
  expect(alive).toHaveLength(1);
  expect(cells[order.winnerCell].style.transform).toBe("scale(1.6)");
});

test("elimination has taken nobody at the start", () => {
  const p = props(0);
  const cells = elimCells(p, eliminationOrder(mulberry32(p.seed)));
  expect(cells.filter((c) => c.style.background === "var(--accent)")).toHaveLength(0);
});

test("elimination cells carry stable, distinct keys", () => {
  const p = props(0.5);
  const ids = elimCells(p, eliminationOrder(mulberry32(p.seed))).map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the animation can be pinned from the query string", () => {
  expect(animationFromSearch("?anim=roll")).toBe("roll");
  expect(animationFromSearch("?x=1&anim=lastone")).toBe("lastone");
  expect(animationFromSearch("?anim=nonsense")).toBeNull();
  expect(animationFromSearch("")).toBeNull();
  // Not a lookup on a bare object: a prototype key must not resolve.
  expect(animationFromSearch("?anim=constructor")).toBeNull();
});

test("the montage winner is never on an edge cell either", () => {
  // It scales to 2.4x inside `.montage { overflow: hidden }`.
  for (let seed = 0; seed < 200; seed++) {
    const p = { ...props(1), seed };
    const f = montageFrame(p);
    const winner = f.cells.findIndex((c) => c.style.zIndex === 3);
    const rows = Math.ceil(f.cells.length / MONTAGE_COLS);
    expect(winner % MONTAGE_COLS).toBeGreaterThan(0);
    expect(winner % MONTAGE_COLS).toBeLessThan(MONTAGE_COLS - 1);
    expect(Math.floor(winner / MONTAGE_COLS)).toBeGreaterThan(0);
    expect(Math.floor(winner / MONTAGE_COLS)).toBeLessThan(rows - 1);
  }
});
