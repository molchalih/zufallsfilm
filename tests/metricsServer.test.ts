import { expect, test } from "bun:test";
import { createMetrics } from "../src/metrics";
import { createMetricsFetch } from "../src/metricsServer";
import { openStore } from "../src/store";
import type { Film } from "../src/types";

const f = (lid: string): Film => ({
  lid,
  name: lid,
  year: null,
  url: `https://letterboxd.com/film/${lid}/`,
});

function harness() {
  const store = openStore(":memory:");
  const metrics = createMetrics();
  return { store, metrics, fetch: createMetricsFetch({ metrics, store }) };
}

test("GET /metrics serves Prometheus text with the 0.0.4 content type", async () => {
  const { fetch } = harness();
  const res = await fetch(new Request("http://internal/metrics"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(res.headers.get("content-type")).toContain("version=0.0.4");
  expect(await res.text()).toContain("zufallsfilm_items_cached");
});

test("the gauges reflect the store's counts at scrape time", async () => {
  const { store, fetch } = harness();
  store.putFilm({ lid: "a", runtime: 90, rating: null, poster: null, director: null }, 1000);
  store.putWatchlist("u", [f("a")], 1, 1000);
  store.putWatchlist("v", [f("b")], 1, 1000);

  const text = await (await fetch(new Request("http://internal/metrics"))).text();
  expect(text).toContain("zufallsfilm_items_cached 1");
  expect(text).toContain("zufallsfilm_users 2");
});

test("a later scrape re-reads the store rather than a stale value", async () => {
  const { store, fetch } = harness();
  await fetch(new Request("http://internal/metrics"));
  store.putFilm({ lid: "a", runtime: 90, rating: null, poster: null, director: null }, 1000);
  const text = await (await fetch(new Request("http://internal/metrics"))).text();
  expect(text).toContain("zufallsfilm_items_cached 1");
});

test("any path other than /metrics is 404", async () => {
  const { fetch } = harness();
  expect((await fetch(new Request("http://internal/"))).status).toBe(404);
  expect((await fetch(new Request("http://internal/pick?user=x"))).status).toBe(404);
});

test("a non-GET request to /metrics is refused", async () => {
  const { fetch } = harness();
  const res = await fetch(new Request("http://internal/metrics", { method: "POST" }));
  expect(res.status).toBe(404);
});
