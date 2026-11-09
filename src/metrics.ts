import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

export type EnrichOutcome = "hit" | "miss" | "error";

/**
 * A self-contained Prometheus metric set. Each call owns its own `Registry`
 * rather than the library's process-global default, so the app can be
 * instantiated more than once — every test builds its own, and two of them
 * sharing a registry would throw on the second registration and bleed counts
 * across cases.
 *
 * `collectDefault` adds Node's process metrics (memory, CPU, event-loop lag).
 * It is off by default because those collectors attach GC observers to the
 * process, which a test that spins up dozens of instances neither wants nor
 * cleans up; the one long-lived production registry turns it on.
 */
export function createMetrics(opts: { collectDefault?: boolean } = {}) {
  const registry = new Registry();
  if (opts.collectDefault) collectDefaultMetrics({ register: registry });

  // RED. The route label is the matched Hono pattern, never the raw path, so
  // `/watchlist/alice` and `/watchlist/bob` share one series instead of minting
  // a new one per visitor.
  const httpRequests = new Counter({
    name: "http_requests_total",
    help: "HTTP requests handled, by matched route and response status.",
    labelNames: ["route", "status"],
    registers: [registry],
  });
  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds, by matched route and response status.",
    labelNames: ["route", "status"],
    // A cold read enriches an uncached watchlist and is measured in tens of
    // seconds (DESIGN.md), so the buckets run well past the sub-second default.
    buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 15, 30, 60],
    registers: [registry],
  });

  // Business. Counters carry an `outcome` label and the `_total` suffix;
  // gauges, which can fall as well as rise, carry neither.
  const scrapes = new Counter({
    name: "zufallsfilm_scrapes_total",
    help: "Whole-watchlist scrapes on the html path, by completeness.",
    labelNames: ["outcome"],
    registers: [registry],
  });
  const watchlists = new Counter({
    name: "zufallsfilm_watchlist_total",
    help: "Watchlist builds on the api path, by completeness.",
    labelNames: ["outcome"],
    registers: [registry],
  });
  const enrich = new Counter({
    name: "zufallsfilm_enrich_total",
    help: "Per-film enrichment lookups, by cache outcome.",
    labelNames: ["outcome"],
    registers: [registry],
  });
  const unhandledErrors = new Counter({
    name: "zufallsfilm_unhandled_errors_total",
    help: "Requests that reached the app's error boundary.",
    registers: [registry],
  });
  const scrapeYield = new Histogram({
    name: "zufallsfilm_scrape_yield_ratio",
    help: "Fraction of a scrape's expected films that were parsed.",
    buckets: [0.5, 0.8, 0.9, 0.95, 0.99, 1],
    registers: [registry],
  });
  const watchlistYield = new Histogram({
    name: "zufallsfilm_watchlist_yield_ratio",
    help: "Fraction of a member's expected films the api returned.",
    buckets: [0.5, 0.8, 0.9, 0.95, 0.99, 1],
    registers: [registry],
  });
  const itemsCached = new Gauge({
    name: "zufallsfilm_items_cached",
    help: "Films currently held in the shared cache.",
    registers: [registry],
  });
  const users = new Gauge({
    name: "zufallsfilm_users",
    help: "Members with a stored watchlist scrape.",
    registers: [registry],
  });

  return {
    registry,
    recordHttp(route: string, status: number, seconds: number) {
      const labels = { route, status: String(status) };
      httpRequests.inc(labels);
      httpDuration.observe(labels, seconds);
    },
    recordScrape(complete: boolean, yieldRatio: number) {
      scrapes.inc({ outcome: complete ? "complete" : "incomplete" });
      scrapeYield.observe(yieldRatio);
    },
    recordWatchlist(complete: boolean, yieldRatio: number) {
      watchlists.inc({ outcome: complete ? "complete" : "short" });
      watchlistYield.observe(yieldRatio);
    },
    recordEnrich(outcome: EnrichOutcome) {
      enrich.inc({ outcome });
    },
    recordUnhandledError() {
      unhandledErrors.inc();
    },
    setItemsCached(n: number) {
      itemsCached.set(n);
    },
    setUsers(n: number) {
      users.set(n);
    },
    expose(): Promise<string> {
      return registry.metrics();
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
