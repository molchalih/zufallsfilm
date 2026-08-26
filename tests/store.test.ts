import { expect, test } from "bun:test";
import { openStore } from "../src/store";
import type { Film } from "../src/types";

const f = (lid: string): Film => ({ lid, slug: lid, name: lid, year: null });
const fresh = () => openStore(":memory:");

test("a complete scrape round-trips", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a"), f("b")], 2, 1000);
  const sc = s.getScrape("u")!;
  expect(sc.complete).toBe(true);
  expect(sc.expectedCount).toBe(2);
  expect(sc.actualCount).toBe(2);
  expect(s.getWatchlist("u").map((x) => x.lid)).toEqual(["a", "b"]);
  s.close();
});

test("a short scrape is marked incomplete", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a")], 2, 1000);
  expect(s.getScrape("u")!.complete).toBe(false);
  s.close();
});

test("replacing a watchlist deletes films that are gone", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a"), f("b")], 2, 1000);
  s.putWatchlist("u", [f("a")], 1, 2000);
  expect(s.getWatchlist("u").map((x) => x.lid)).toEqual(["a"]);
  s.close();
});

test("watchlists of different users do not interfere", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a")], 1, 1000);
  s.putWatchlist("v", [f("b")], 1, 1000);
  s.putWatchlist("u", [f("c")], 1, 2000);
  expect(s.getWatchlist("v").map((x) => x.lid)).toEqual(["b"]);
  s.close();
});

test("watchlist order is preserved", () => {
  const s = fresh();
  s.putWatchlist("u", [f("c"), f("a"), f("b")], 3, 1000);
  expect(s.getWatchlist("u").map((x) => x.lid)).toEqual(["c", "a", "b"]);
  s.close();
});

test("a known runtime is served until the film TTL expires", () => {
  const s = fresh();
  s.putFilm({ lid: "a", runtime: 90, rating: 4, poster: null }, 1000);
  expect(s.getFilm("a", 1000 + 10, 100, 50)!.runtime).toBe(90);
  expect(s.getFilm("a", 1000 + 101, 100, 50)).toBeNull();
  s.close();
});

test("a null runtime expires on the short negative TTL", () => {
  const s = fresh();
  s.putFilm({ lid: "a", runtime: null, rating: null, poster: null }, 1000);
  expect(s.getFilm("a", 1000 + 10, 100, 50)).not.toBeNull();
  expect(s.getFilm("a", 1000 + 51, 100, 50)).toBeNull();
  s.close();
});

test("migrations are idempotent and stamp the schema version", () => {
  const path = `/tmp/picker-migrate-${Math.random().toString(36).slice(2)}.sqlite`;
  const a = openStore(path);
  a.putWatchlist("u", [f("a")], 1, 1000);
  a.close();
  // Reopening must not re-run migrations or lose data.
  const b = openStore(path);
  expect(b.getWatchlist("u").map((x) => x.lid)).toEqual(["a"]);
  expect(b.schemaVersion()).toBeGreaterThan(0);
  b.close();
});

test("eviction removes the least recently fetched films first", () => {
  const s = fresh();
  s.putFilm({ lid: "old", runtime: 1, rating: null, poster: null }, 1000);
  s.putFilm({ lid: "new", runtime: 2, rating: null, poster: null }, 5000);
  expect(s.evictFilms(1)).toBe(1);
  expect(s.getFilm("old", 5000, 1e9, 1e9)).toBeNull();
  expect(s.getFilm("new", 5000, 1e9, 1e9)).not.toBeNull();
  s.close();
});

test("posters and ratings are flagged stale before the film TTL expires", () => {
  const s = fresh();
  s.putFilm({ lid: "a", runtime: 90, rating: 4, poster: "p.jpg" }, 1000);
  // Fresh: inside the 7-day staleness window.
  expect(s.getFilm("a", 1000 + 10, 1e9, 1e9, 100)!.metaStale).toBe(false);
  // Stale metadata, but the row is still served rather than discarded.
  const stale = s.getFilm("a", 1000 + 101, 1e9, 1e9, 100)!;
  expect(stale.metaStale).toBe(true);
  expect(stale.runtime).toBe(90);
  s.close();
});
