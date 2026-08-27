import { expect, test } from "bun:test";
import { createBuilder } from "../src/builder";
import { loadConfig } from "../src/config";
import { openStore } from "../src/store";

const cfg = loadConfig({});
const enricher = {
  async enrich(f: any) {
    return { lid: f.lid, runtime: 90, rating: null, poster: null, director: null };
  },
};

function page(total: number, lids: string[]) {
  const items = lids
    .map(
      (l) => `<li class="griditem"><div data-item-name="${l} (2000)" data-item-slug="${l}"
    data-postered-identifier='{&quot;lid&quot;:&quot;${l}&quot;}'></div></li>`,
    )
    .join("");
  return `<div data-num-entries="${total}"></div>${items}`;
}

// 3 pages' worth: page 1 fast, later pages slow. pageSize 1 so each fixture
// page is a whole page.
function slowFetcher() {
  const pages: Record<number, string> = {
    1: page(3, ["a"]),
    2: page(3, ["b"]),
    3: page(3, ["c"]),
  };
  return {
    async get(url: string) {
      const p = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
      if (p > 1) await new Promise((r) => setTimeout(r, 60));
      return { status: 200, body: pages[p], classification: "ok" as const };
    },
  };
}

test("a cold request returns page 1 as a partial result quickly", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: slowFetcher() as any,
    enricher: enricher as any,
    store,
    cfg,
    pageSize: 1,
  });
  const t0 = Date.now();
  const r = await b.getWatchlist("u");
  expect(Date.now() - t0).toBeLessThan(50);
  expect(r.partial).toBe(true);
  expect(r.films.map((f) => f.lid)).toEqual(["a"]);
  await b.whenSettled("u");
  store.close();
});

test("the background backfill completes and stores the full watchlist", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: slowFetcher() as any,
    enricher: enricher as any,
    store,
    cfg,
    pageSize: 1,
  });
  await b.getWatchlist("u");
  await b.whenSettled("u");
  expect(store.getScrape("u")!.complete).toBe(true);
  expect(store.getWatchlist("u").map((f) => f.lid)).toEqual(["a", "b", "c"]);
  store.close();
});

test("once backfilled, the next request is complete and not partial", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: slowFetcher() as any,
    enricher: enricher as any,
    store,
    cfg,
    pageSize: 1,
  });
  await b.getWatchlist("u");
  await b.whenSettled("u");
  const r = await b.getWatchlist("u");
  expect(r.partial).toBe(false);
  expect(r.complete).toBe(true);
  expect(r.films).toHaveLength(3);
  store.close();
});

test("a failing backfill does not reject the caller and does not cache", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: {
      async get(url: string) {
        const p = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
        if (p > 1) throw new Error("page 2 exploded");
        return { status: 200, body: page(3, ["a"]), classification: "ok" as const };
      },
    } as any,
    enricher: enricher as any,
    store,
    cfg,
    pageSize: 1,
  });
  const r = await b.getWatchlist("u");
  expect(r.partial).toBe(true);
  await b.whenSettled("u");
  expect(store.getScrape("u")?.complete ?? false).toBe(false);
  store.close();
});

test("concurrent cold requests share one backfill", async () => {
  const store = openStore(":memory:");
  let pageOneCalls = 0;
  const b = createBuilder({
    fetcher: {
      async get(url: string) {
        const p = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
        if (p === 1) pageOneCalls++;
        else await new Promise((r) => setTimeout(r, 30));
        return {
          status: 200,
          body: page(3, [["a", "b", "c"][p - 1]]),
          classification: "ok" as const,
        };
      },
    } as any,
    enricher: enricher as any,
    store,
    cfg,
    pageSize: 1,
  });
  await Promise.all([b.getWatchlist("u"), b.getWatchlist("u"), b.getWatchlist("u")]);
  expect(pageOneCalls).toBe(1);
  await b.whenSettled("u");
  store.close();
});
