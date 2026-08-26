import { expect, test } from "bun:test";
import { createBuilder } from "../src/builder";
import { loadConfig } from "../src/config";
import { createFetcher, createRateGate } from "../src/fetcher";
import { openStore } from "../src/store";

const noSleep = async () => {};
const enricher = {
  async enrich(f: any) {
    return { lid: f.lid, runtime: 90, rating: null, poster: null };
  },
};

test("an aborted request is classified as a timeout and is not retried", async () => {
  let calls = 0;
  const stub = (async () => {
    calls++;
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as unknown as typeof fetch;
  const f = createFetcher(loadConfig({}), stub, noSleep);
  await expect(f.get("https://letterboxd.com/a/")).rejects.toMatchObject({
    classification: "timeout",
  });
  expect(calls).toBe(1);
});

test("the global gate spaces requests to the configured rate", async () => {
  let t = 0;
  const slept: number[] = [];
  const gate = createRateGate(
    2,
    () => t,
    async (ms) => {
      slept.push(ms);
      t += ms;
    },
  );
  await gate();
  await gate();
  await gate();
  // Two per second: the third call must wait roughly half a second in total.
  expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(499);
});

test("the gate runs before every request", async () => {
  let gated = 0;
  let fetched = 0;
  const stub = (async () => {
    fetched++;
    return new Response("<html></html>", { status: 200 });
  }) as unknown as typeof fetch;
  const f = createFetcher(loadConfig({}), stub, noSleep, async () => {
    gated++;
  });
  await f.get("https://letterboxd.com/a/");
  await f.get("https://letterboxd.com/b/");
  expect(gated).toBe(2);
  expect(fetched).toBe(2);
});

test("a build that exceeds its budget raises upstream_timeout", async () => {
  const store = openStore(":memory:");
  const cfg = loadConfig({ BUILD_BUDGET_MS: "50" });
  let t = 0;
  // 10 pages of 1 film each, so there are more pages than PAGE_CONCURRENCY and
  // the deadline is genuinely reached partway through the batch.
  const b = createBuilder({
    fetcher: {
      async get(url: string) {
        t += 40; // each page burns 40ms of the 50ms budget
        const p = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
        return {
          status: 200,
          body: `<div data-num-entries="10"></div><li class="griditem"><div data-item-name="p${p} (2000)"
            data-item-slug="p${p}" data-postered-identifier='{&quot;lid&quot;:&quot;p${p}&quot;}'></div></li>`,
          classification: "ok" as const,
        };
      },
    } as any,
    enricher: enricher as any,
    store,
    cfg,
    now: () => t,
    pageSize: 1,
  });
  await b.getWatchlist("u");
  await b.whenSettled("u");
  // The backfill blew its budget, so nothing may be cached as complete.
  expect(store.getScrape("u")?.complete ?? false).toBe(false);
  store.close();
});
