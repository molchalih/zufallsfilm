import { expect, test } from "bun:test";
import { createMetrics } from "../src/metrics";

test("http requests increment http_requests_total, labelled by route and status", async () => {
  const m = createMetrics();
  m.recordHttp("/pick", 200, 0.012);
  m.recordHttp("/pick", 200, 0.008);
  expect(await m.expose()).toContain('http_requests_total{route="/pick",status="200"} 2');
});

test("http durations land in the request duration histogram", async () => {
  const m = createMetrics();
  m.recordHttp("/watchlist/:user", 404, 0.03);
  const text = await m.expose();
  expect(text).toContain("# TYPE http_request_duration_seconds histogram");
  expect(text).toContain(
    'http_request_duration_seconds_count{route="/watchlist/:user",status="404"} 1',
  );
});

test("a complete scrape increments scrapes_total with outcome=complete", async () => {
  const m = createMetrics();
  m.recordScrape(true, 1);
  expect(await m.expose()).toContain('zufallsfilm_scrapes_total{outcome="complete"} 1');
});

test("a short scrape increments scrapes_total with outcome=incomplete", async () => {
  const m = createMetrics();
  m.recordScrape(false, 0.5);
  expect(await m.expose()).toContain('zufallsfilm_scrapes_total{outcome="incomplete"} 1');
});

test("watchlist completeness is labelled complete or short", async () => {
  const m = createMetrics();
  m.recordWatchlist(true, 1);
  m.recordWatchlist(false, 0.3);
  const text = await m.expose();
  expect(text).toContain('zufallsfilm_watchlist_total{outcome="complete"} 1');
  expect(text).toContain('zufallsfilm_watchlist_total{outcome="short"} 1');
});

test("enrich outcomes are counted per hit, miss and error", async () => {
  const m = createMetrics();
  m.recordEnrich("hit");
  m.recordEnrich("hit");
  m.recordEnrich("miss");
  m.recordEnrich("error");
  const text = await m.expose();
  expect(text).toContain('zufallsfilm_enrich_total{outcome="hit"} 2');
  expect(text).toContain('zufallsfilm_enrich_total{outcome="miss"} 1');
  expect(text).toContain('zufallsfilm_enrich_total{outcome="error"} 1');
});

test("unhandled errors accumulate on a dedicated counter", async () => {
  const m = createMetrics();
  m.recordUnhandledError();
  expect(await m.expose()).toContain("zufallsfilm_unhandled_errors_total 1");
});

test("the cache-size gauges reflect the last value set", async () => {
  const m = createMetrics();
  m.setItemsCached(4211);
  m.setUsers(37);
  const text = await m.expose();
  expect(text).toContain("zufallsfilm_items_cached 4211");
  expect(text).toContain("zufallsfilm_users 37");
});

test("instances do not share state", async () => {
  const a = createMetrics();
  const b = createMetrics();
  a.recordScrape(true, 1);
  expect(await a.expose()).toContain('zufallsfilm_scrapes_total{outcome="complete"} 1');
  expect(await b.expose()).not.toContain('zufallsfilm_scrapes_total{outcome="complete"}');
});

test("the registry advertises the Prometheus 0.0.4 text content type", () => {
  const m = createMetrics();
  expect(m.registry.contentType).toContain("text/plain");
  expect(m.registry.contentType).toContain("version=0.0.4");
});
