import { expect, test } from "bun:test";
import { createBuilder, pageUrl } from "../src/builder";
import { loadConfig } from "../src/config";
import { openStore } from "../src/store";

const cfg = loadConfig({ MAX_WATCHLIST: "100" });

function page(total: number, lids: string[]) {
  const items = lids
    .map(
      (l) => `<li class="griditem"><div data-item-name="${l} (2000)" data-item-slug="${l}"
        data-postered-identifier='{&quot;lid&quot;:&quot;${l}&quot;}'></div></li>`,
    )
    .join("");
  return `<div data-num-entries="${total}"></div>${items}`;
}

const enricher = {
  async enrich(f: any) {
    return { lid: f.lid, runtime: 90, rating: null, poster: null };
  },
};

function fetcherFor(pages: Record<number, string>, onGet?: (u: string) => void) {
  return {
    async get(url: string) {
      onGet?.(url);
      const m = /\/page\/(\d+)\//.exec(url);
      const p = m ? Number(m[1]) : 1;
      if (pages[p] === undefined)
        return { status: 404, body: "", classification: "notfound" as const };
      return { status: 200, body: pages[p], classification: "ok" as const };
    },
  };
}

test("page URLs always carry a trailing slash", () => {
  expect(pageUrl("u", 3)).toBe("https://letterboxd.com/u/watchlist/page/3/");
});

test("a complete build stores every film", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: fetcherFor({ 1: page(2, ["a", "b"]) }) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  const r = await b.getWatchlist("u");
  expect(r.complete).toBe(true);
  expect(r.films.map((f) => f.lid)).toEqual(["a", "b"]);
  expect(store.getScrape("u")!.complete).toBe(true);
  store.close();
});

test("a short scrape is refused and never stored as complete", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    // claims 5 entries but only ever serves 2
    fetcher: fetcherFor({ 1: page(5, ["a", "b"]) }) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  // A cold call now serves page 1 and backfills; the short scrape fails in the
  // background, so nothing may be cached as complete.
  const r = await b.getWatchlist("u");
  expect(r.partial).toBe(true);
  await b.whenSettled("u");
  expect(store.getScrape("u")?.complete ?? false).toBe(false);
  store.close();
});

test("an unknown user is reported as user_not_found", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: fetcherFor({}) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await expect(b.getWatchlist("nobody")).rejects.toMatchObject({ reason: "user_not_found" });
  store.close();
});

test("an empty watchlist is reported as watchlist_empty", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: fetcherFor({ 1: page(0, []) }) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await expect(b.getWatchlist("u")).rejects.toMatchObject({ reason: "watchlist_empty" });
  store.close();
});

test("an oversized watchlist is refused before any further fetch", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const b = createBuilder({
    fetcher: fetcherFor({ 1: page(9999, ["a"]) }, () => calls++) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await expect(b.getWatchlist("u")).rejects.toMatchObject({ reason: "watchlist_too_large" });
  expect(calls).toBe(1);
  store.close();
});

test("usernames are lowercased so casings share one cache entry", async () => {
  const store = openStore(":memory:");
  const seen: string[] = [];
  const b = createBuilder({
    fetcher: fetcherFor({ 1: page(1, ["a"]) }, (u) => seen.push(u)) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await b.getWatchlist("ExampleMember");
  expect(seen[0]).toContain("/examplemember/");
  expect(store.getWatchlist("examplemember")).toHaveLength(1);
  store.close();
});

test("a fresh complete scrape is served from the store without refetching", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const b = createBuilder({
    fetcher: fetcherFor({ 1: page(1, ["a"]) }, () => calls++) as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await b.getWatchlist("u");
  const after = calls;
  await b.getWatchlist("u");
  expect(calls).toBe(after);
  store.close();
});

test("concurrent cold builds for one user are coalesced into a single build", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const b = createBuilder({
    fetcher: {
      async get() {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return { status: 200, body: page(1, ["a"]), classification: "ok" as const };
      },
    } as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  const rs = await Promise.all([b.getWatchlist("u"), b.getWatchlist("u"), b.getWatchlist("u")]);
  expect(calls).toBe(1);
  expect(rs.every((r) => r.films.length === 1)).toBe(true);
  expect(b.inFlightCount()).toBe(0);
  store.close();
});
