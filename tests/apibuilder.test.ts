import { expect, test } from "bun:test";
import { createApiBuilder } from "../src/apiBuilder";
import { BuildError, type EnrichedFilm } from "../src/build";
import { ApiError } from "../src/client";
import { loadConfig } from "../src/config";
import type { Letterboxd } from "../src/letterboxd";
import { toFilm } from "../src/letterboxd";
import { openStore } from "../src/store";
import { filmSummary } from "./fixtures/api";

const cfg = loadConfig({});
const mk = (id: string): EnrichedFilm => toFilm(filmSummary(id)) as EnrichedFilm;

type Stub = {
  resolve?: () => Promise<string | null>;
  count?: () => Promise<number>;
  pages?: string[][];
  page?: (
    lid: string,
    cursor?: string,
  ) => Promise<{ films: EnrichedFilm[]; next: string | undefined }>;
};

/** A Letterboxd whose pages are addressed by their index, used as the cursor. */
function stub(s: Stub) {
  const calls = { resolve: 0, count: 0, page: 0 };
  const lb = {
    async resolveMember() {
      calls.resolve += 1;
      return s.resolve ? await s.resolve() : "LID";
    },
    async watchlistCount() {
      calls.count += 1;
      return s.count ? await s.count() : (s.pages ?? []).flat().length;
    },
    async watchlistPage(lid: string, cursor?: string) {
      calls.page += 1;
      if (s.page) return await s.page(lid, cursor);
      const pages = s.pages ?? [];
      const i = cursor === undefined ? 0 : Number(cursor);
      const next = i + 1 < pages.length ? String(i + 1) : undefined;
      return { films: (pages[i] ?? []).map(mk), next };
    },
  } as Letterboxd;
  return { lb, calls };
}

function make(s: Stub, over: { now?: () => number } = {}) {
  const store = openStore(":memory:");
  const { lb, calls } = stub(s);
  const logged: string[] = [];
  const builder = createApiBuilder({
    letterboxd: lb,
    store,
    cfg,
    now: over.now,
    log: (line) => logged.push(line),
  });
  return { builder, store, calls, logged, pageCalls: () => calls.page };
}

test("a watchlist that fits on one page is complete immediately", async () => {
  const { builder, store, pageCalls } = make({ pages: [["a", "b"]] });
  const r = await builder.getWatchlist("examplemember");
  expect(r.films.map((f) => f.lid)).toEqual(["a", "b"]);
  expect(r.complete).toBe(true);
  expect(r.partial).toBe(false);
  expect(pageCalls()).toBe(1);
  expect(store.getScrape("examplemember")?.complete).toBe(true);
  store.close();
});

test("page one is served partial while the rest is walked behind it", async () => {
  const { builder, store } = make({ pages: [["a", "b"], ["c"], ["d"]] });
  const first = await builder.getWatchlist("examplemember");
  expect(first.films.map((f) => f.lid)).toEqual(["a", "b"]);
  expect(first.partial).toBe(true);
  expect(first.complete).toBe(false);

  await builder.whenSettled("examplemember");
  const second = await builder.getWatchlist("examplemember");
  expect(second.films.map((f) => f.lid)).toEqual(["a", "b", "c", "d"]);
  expect(second.complete).toBe(true);
  expect(store.getScrape("examplemember")?.complete).toBe(true);
  store.close();
});

test("the username is normalised on the way in", async () => {
  const { builder, store } = make({ pages: [["a"]] });
  await builder.getWatchlist("  ExampleMember  ");
  expect(store.getWatchlist("examplemember").map((f) => f.lid)).toEqual(["a"]);
  store.close();
});

test("a cached, complete watchlist is served without touching the API", async () => {
  const { builder, store, pageCalls } = make({ pages: [["a"]] });
  await builder.getWatchlist("examplemember");
  const before = pageCalls();
  const again = await builder.getWatchlist("examplemember");
  expect(again.complete).toBe(true);
  expect(pageCalls()).toBe(before);
  store.close();
});

test("a stale cache is read again", async () => {
  let t = 0;
  const { builder, store, pageCalls } = make({ pages: [["a"]] }, { now: () => t });
  await builder.getWatchlist("examplemember");
  const before = pageCalls();
  t += cfg.scrapeTtlMs + 1;
  await builder.getWatchlist("examplemember");
  expect(pageCalls()).toBeGreaterThan(before);
  store.close();
});

test("concurrent cold reads for one member are coalesced", async () => {
  const { builder, store, pageCalls } = make({ pages: [["a"]] });
  await Promise.all([
    builder.getWatchlist("examplemember"),
    builder.getWatchlist("examplemember"),
    builder.getWatchlist("EXAMPLEMEMBER"),
  ]);
  expect(pageCalls()).toBe(1);
  store.close();
});

test("an unresolvable username is a named failure", async () => {
  const { builder, store } = make({ resolve: async () => null });
  const err = await builder.getWatchlist("nobody").catch((e) => e);
  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).reason).toBe("user_not_found");
  store.close();
});

test("an empty watchlist is a named failure", async () => {
  const { builder, store } = make({ count: async () => 0, pages: [[]] });
  const err = await builder.getWatchlist("u").catch((e) => e);
  expect((err as BuildError).reason).toBe("watchlist_empty");
  store.close();
});

test("a watchlist above the cap is refused before it is read", async () => {
  const { builder, store, pageCalls } = make({ count: async () => cfg.maxWatchlist + 1 });
  const err = await builder.getWatchlist("u").catch((e) => e);
  expect((err as BuildError).reason).toBe("watchlist_too_large");
  expect(pageCalls()).toBe(0);
  store.close();
});

test("a private watchlist is reported as private, not as a generic failure", async () => {
  const { builder, store } = make({
    count: async () => {
      throw new ApiError("403 for /member/LID/statistics", "forbidden", 403);
    },
  });
  const err = await builder.getWatchlist("u").catch((e) => e);
  expect((err as BuildError).reason).toBe("watchlist_private");
  store.close();
});

test("a member the API does not know is user_not_found, not upstream_error", async () => {
  const { builder, store } = make({
    count: async () => {
      throw new ApiError("404", "notfound", 404);
    },
  });
  const err = await builder.getWatchlist("u").catch((e) => e);
  expect((err as BuildError).reason).toBe("user_not_found");
  store.close();
});

test("an upstream timeout keeps its own reason", async () => {
  const { builder, store } = make({
    count: async () => {
      throw new ApiError("timed out", "timeout");
    },
  });
  const err = await builder.getWatchlist("u").catch((e) => e);
  expect((err as BuildError).reason).toBe("upstream_timeout");
  store.close();
});

test("a walk the cursor ended is cached even when the count disagrees", async () => {
  // The count promises four films; the cursor ends after two. The API is the
  // authority on what it will hand over, so this is cached and served.
  const { builder, store, logged } = make({ count: async () => 4, pages: [["a", "b"]] });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  const fetched = store.getScrape("u");
  expect(fetched?.complete).toBe(true);
  expect(fetched?.expectedCount).toBe(4);
  expect(fetched?.actualCount).toBe(2);
  expect(store.getWatchlist("u").map((f) => f.lid)).toEqual(["a", "b"]);
  // Both numbers are on the record, so the discrepancy is visible.
  expect(JSON.parse(logged[0])).toEqual({
    event: "watchlist_count_mismatch",
    username: "u",
    expected: 4,
    actual: 2,
  });
  store.close();
});

test("a short walk is read once, not re-walked on every later request", async () => {
  // The defect this guards: refusing to cache a count mismatch made every
  // later request repeat the whole walk, forever.
  const { builder, store, calls } = make({ count: async () => 9, pages: [["a"], ["b"]] });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  const before = calls.page;
  const again = await builder.getWatchlist("u");
  expect(again.complete).toBe(true);
  expect(again.films.map((f) => f.lid)).toEqual(["a", "b"]);
  expect(calls.page).toBe(before);
  expect(calls.resolve).toBe(1);
  store.close();
});

test("a count that drifted mid-walk is cached from what the walk actually read", async () => {
  const { builder, store, calls } = make({ count: async () => 3, pages: [["a"], ["b"]] });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  expect(store.getWatchlist("u").map((f) => f.lid)).toEqual(["a", "b"]);
  // One walk, not two: the count is not re-read to argue with itself.
  expect(calls.count).toBe(1);
  expect(calls.page).toBe(2);
  store.close();
});

test("a cursor that repeats fails the walk instead of paging forever", async () => {
  // A non-empty page behind a fixed cursor: the empty-page check never fires.
  const { builder, store, calls } = make({
    count: async () => 500,
    page: async () => ({ films: [mk("a")], next: "stuck" }),
  });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  // Page one, the first cursor page, and then the repeat is refused.
  expect(calls.page).toBe(2);
  expect(store.getScrape("u")).toBeNull();
  store.close();
});

test("a repeated cursor is reported as an incomplete read", async () => {
  const { builder, store } = make({
    count: async () => 500,
    page: async (_lid, cursor) => ({
      films: [mk(cursor ?? "a")],
      next: cursor === undefined ? "one" : "stuck",
    }),
  });
  const { films } = await builder.getWatchlist("u");
  expect(films.map((f) => f.lid)).toEqual(["a"]);
  await builder.whenSettled("u");
  // The walk raised BuildError("incomplete"); the caller that started it is
  // never rejected, and nothing was cached.
  expect(store.getScrape("u")).toBeNull();
  store.close();
});

test("duplicate films across pages are collapsed by identity", async () => {
  const { builder, store } = make({ count: async () => 2, pages: [["a", "b"], ["b"]] });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  expect(store.getWatchlist("u").map((f) => f.lid)).toEqual(["a", "b"]);
  store.close();
});

test("a page that returns nothing ends the walk instead of spinning", async () => {
  // A cursor that never clears would otherwise loop forever.
  const { builder, store } = make({
    count: async () => 1,
    page: async (_lid, cursor) => ({
      films: cursor === undefined ? [mk("a")] : [],
      next: "always",
    }),
  });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  expect(store.getWatchlist("u").map((f) => f.lid)).toEqual(["a"]);
  store.close();
});

test("the build budget bounds a long walk", async () => {
  let t = 0;
  const { builder, store } = make(
    {
      count: async () => 100,
      page: async (_lid, cursor) => {
        t += cfg.buildBudgetMs / 2;
        return { films: [mk(cursor ?? "a")], next: `${Number(cursor ?? 0) + 1}` };
      },
    },
    { now: () => t },
  );
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  expect(store.getScrape("u")).toBeNull();
  store.close();
});

test("progress reports films read against the member's own count", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { builder, store } = make({
    count: async () => 3,
    page: async (_lid, cursor) => {
      if (cursor === undefined) return { films: [mk("a")], next: "1" };
      await gate;
      return { films: [mk("b"), mk("c")], next: undefined };
    },
  });

  await builder.getWatchlist("u");
  expect(builder.progressFor("u")).toEqual({ done: 1, total: 3 });
  release();
  await builder.whenSettled("u");
  // Cleared once nothing is waiting on it.
  expect(builder.progressFor("u")).toBeNull();
  store.close();
});

test("a failed walk never rejects the caller that started it", async () => {
  const { builder, store } = make({
    count: async () => 3,
    page: async (_lid, cursor) => {
      if (cursor === undefined) return { films: [mk("a")], next: "1" };
      throw new ApiError("boom", "error", 500);
    },
  });
  const r = await builder.getWatchlist("u");
  expect(r.partial).toBe(true);
  await expect(builder.whenSettled("u")).resolves.toBeUndefined();
  expect(store.getScrape("u")).toBeNull();
  store.close();
});

test("a request arriving mid-walk joins it instead of starting a second", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { builder, store, calls } = make({
    count: async () => 5,
    page: async (_lid, cursor) => {
      const i = cursor === undefined ? 0 : Number(cursor);
      if (i === 3) await gate;
      return { films: [mk(`f${i}`)], next: i < 4 ? String(i + 1) : undefined };
    },
  });

  const first = await builder.getWatchlist("u");
  expect(first.partial).toBe(true);
  // Let the walk reach the page that blocks.
  await Bun.sleep(1);
  const midway = builder.progressFor("u");
  expect(midway).toEqual({ done: 3, total: 5 });
  const callsAtMidpoint = { ...calls };

  const second = await builder.getWatchlist("u");
  expect(second.films.map((f) => f.lid)).toEqual(["f0"]);
  expect(second.partial).toBe(true);
  // No second /search, no second /statistics, no re-read of page one.
  expect(calls.resolve).toBe(callsAtMidpoint.resolve);
  expect(calls.count).toBe(callsAtMidpoint.count);
  expect(calls.page).toBe(callsAtMidpoint.page);
  // And the running walk's progress is not reset under it.
  expect(builder.progressFor("u")).toEqual(midway as { done: number; total: number });

  release();
  await builder.whenSettled("u");
  expect(store.getWatchlist("u")).toHaveLength(5);
  expect(builder.progressFor("u")).toBeNull();
  store.close();
});

test("a request arriving after the walk finished reads the cache, not the API", async () => {
  const { builder, store, calls } = make({ count: async () => 3, pages: [["a"], ["b"], ["c"]] });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  const before = { ...calls };
  const again = await builder.getWatchlist("u");
  expect(again.complete).toBe(true);
  expect(again.films.map((f) => f.lid)).toEqual(["a", "b", "c"]);
  expect(calls).toEqual(before);
  store.close();
});

test("the build budget covers the head as well as the walk", async () => {
  let t = 0;
  const { builder, store } = make(
    {
      count: async () => 100,
      page: async (_lid, cursor) => {
        // Page one alone spends the whole budget.
        if (cursor === undefined) {
          t += cfg.buildBudgetMs + 1;
          return { films: [mk("a")], next: "1" };
        }
        return { films: [mk(cursor)], next: `${Number(cursor) + 1}` };
      },
    },
    { now: () => t },
  );
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  expect(store.getScrape("u")).toBeNull();
  store.close();
});

test("in-flight work is counted while it runs", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { builder, store } = make({
    count: async () => 2,
    page: async (_lid, cursor) => {
      if (cursor === undefined) return { films: [mk("a")], next: "1" };
      await gate;
      return { films: [mk("b")], next: undefined };
    },
  });
  await builder.getWatchlist("u");
  expect(builder.inFlightCount()).toBe(1);
  release();
  await builder.whenSettled("u");
  expect(builder.inFlightCount()).toBe(0);
  store.close();
});

test("a film arrives complete, so nothing on this path enriches it", async () => {
  const { builder, store, calls } = make({ pages: [["a", "b"]] });
  const { films } = await builder.getWatchlist("u");
  const before = { ...calls };

  const enriched = await builder.enrich("u", films);
  expect(enriched[0]).toEqual({
    lid: "a",
    name: "Film a",
    year: 1994,
    url: "https://letterboxd.com/film/a/",
    runtime: 100,
    rating: 3.9,
    poster: "https://a.ltrbxd.com/a-300.jpg",
    director: "A Director",
  });
  // No search, no statistics, no page: `enrich` reads what the walk wrote.
  expect(calls).toEqual(before);
  store.close();
});

test("metadata survives the cache, so a warm read is still a complete film", async () => {
  const { builder, store, calls } = make({ pages: [["a"], ["b"]] });
  await builder.getWatchlist("u");
  await builder.whenSettled("u");
  const before = { ...calls };

  const { films, complete } = await builder.getWatchlist("u");
  expect(complete).toBe(true);
  const enriched = await builder.enrich("u", films);
  expect(enriched.map((f) => f.runtime)).toEqual([100, 100]);
  expect(enriched.map((f) => f.director)).toEqual(["A Director", "A Director"]);
  expect(enriched.map((f) => f.url)).toEqual([
    "https://letterboxd.com/film/a/",
    "https://letterboxd.com/film/b/",
  ]);
  expect(calls).toEqual(before);
  store.close();
});
