import { expect, test } from "bun:test";
import { createBuilder } from "../src/builder";
import { loadConfig } from "../src/config";
import { openStore } from "../src/store";

const cfg = loadConfig({});
const enricher = {
  async enrich(f: any) {
    return { lid: f.lid, runtime: 90, rating: null, poster: null };
  },
};

function body(total: number, lids: string[]) {
  const items = lids
    .map(
      (l) => `<li class="griditem"><div data-item-name="${l} (2000)" data-item-slug="${l}"
    data-postered-identifier='{&quot;lid&quot;:&quot;${l}&quot;}'></div></li>`,
    )
    .join("");
  return `<div data-num-entries="${total}"></div>${items}`;
}

test("a watchlist that grows mid-scrape is retried against a fresh total", async () => {
  const store = openStore(":memory:");
  let pass = 0;
  const b = createBuilder({
    fetcher: {
      async get(url: string) {
        const p = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
        // First pass claims 2 but only ever yields 1; second pass is consistent.
        if (p === 1) {
          pass++;
          return {
            status: 200,
            body: body(pass === 1 ? 2 : 1, ["a"]),
            classification: "ok" as const,
          };
        }
        return { status: 200, body: body(1, []), classification: "ok" as const };
      },
    } as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await b.getWatchlist("u");
  await b.whenSettled("u");
  expect(pass).toBeGreaterThanOrEqual(2);
  expect(store.getScrape("u")!.complete).toBe(true);
  store.close();
});

test("a persistently short scrape still fails after the retry", async () => {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: {
      async get() {
        return { status: 200, body: body(5, ["a"]), classification: "ok" as const };
      },
    } as any,
    enricher: enricher as any,
    store,
    cfg,
  });
  await b.getWatchlist("u");
  await b.whenSettled("u");
  expect(store.getScrape("u")?.complete ?? false).toBe(false);
  store.close();
});

test("stale metadata is served immediately and refreshed out of band", async () => {
  const store = openStore(":memory:");
  let enrichCalls = 0;
  const b = createBuilder({
    fetcher: {
      async get() {
        return { status: 200, body: body(1, ["a"]), classification: "ok" as const };
      },
    } as any,
    enricher: {
      async enrich(f: any) {
        enrichCalls++;
        return { lid: f.lid, runtime: 120, rating: 4.5, poster: "fresh.jpg" };
      },
    } as any,
    store,
    cfg,
    now: () => 30 * 24 * 60 * 60 * 1000, // well past the 7-day staleness window
  });

  // Seed a row that is inside the 30-day film TTL but past the 7-day meta window.
  store.putFilm({ lid: "a", runtime: 90, rating: 1, poster: "old.jpg" }, 20 * 24 * 60 * 60 * 1000);

  const r = await b.enrich("u", (await b.getWatchlist("u")).films);
  // The cached runtime is served, not the refreshed one: staleness never gates a pick.
  expect(r[0].runtime).toBe(90);
  expect(enrichCalls).toBe(1);

  // The background refresh lands afterwards.
  await Bun.sleep(10);
  expect(store.getFilm("a", 30 * 24 * 60 * 60 * 1000, 1e9, 1e9)!.poster).toBe("fresh.jpg");
  store.close();
});
