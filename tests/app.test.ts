import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { BuildError } from "../src/builder";
import { loadConfig } from "../src/config";
import { createMetrics } from "../src/metrics";
import { createLimiter } from "../src/ratelimit";
import { openStore } from "../src/store";

// Hono types request().json() as unknown; tests assert on shapes they control.
const json = async (r: Response): Promise<any> => await r.json();

const cfg = loadConfig({});
const limiter = () =>
  createLimiter({
    ratePerMin: 6000,
    burst: 100,
    distinctUsersPerWindow: 100,
    windowMs: 60_000,
  });

const films = [
  { lid: "a", slug: "a", name: "A", year: 2000, runtime: 80 },
  { lid: "b", slug: "b", name: "B", year: 2001, runtime: 200 },
];
const okBuilder = {
  async getWatchlist() {
    return { films, complete: true, partial: false };
  },
  enrich: async (films: any[]) => films,
  whenSettled: async () => {},
  inFlightCount: () => 0,
};

test("health reports egress configuration", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const r = await app.request("/health");
  expect(r.status).toBe(200);
  expect((await json(r)).egress).toBe("direct");
});

test("pick requires a user parameter", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const r = await app.request("/pick");
  expect(r.status).toBe(400);
});

test("pick returns a film from the watchlist", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const body = await json(await app.request("/pick?user=u"));
  expect(["a", "b"]).toContain(body.film.lid);
  expect(body.film.url).toBe(`https://letterboxd.com/film/${body.film.slug}/`);
});

test("pick honours maxRuntime", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const body = await json(await app.request("/pick?user=u&maxRuntime=90"));
  expect(body.film.lid).toBe("a");
});

test("pick returns no_match when the filter excludes everything", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const r = await app.request("/pick?user=u&maxRuntime=10");
  expect(r.status).toBe(404);
  expect((await json(r)).reason).toBe("no_match");
});

test("build errors map to their documented status codes", async () => {
  const cases: Array<[string, number]> = [
    ["user_not_found", 404],
    ["watchlist_empty", 404],
    ["watchlist_too_large", 413],
    ["upstream_blocked", 502],
  ];
  for (const [reason, status] of cases) {
    const app = createApp({
      builder: {
        async getWatchlist() {
          throw new BuildError("x", reason as any);
        },
        enrich: async (films: any[]) => films,
        whenSettled: async () => {},
        inFlightCount: () => 0,
      } as any,
      store: openStore(":memory:"),
      cfg,
      limiter: limiter(),
      metrics: createMetrics(),
    });
    const r = await app.request("/pick?user=u");
    expect(r.status).toBe(status);
    expect((await json(r)).reason).toBe(reason);
  }
});

test("a throttled caller gets 429", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: createLimiter({
      ratePerMin: 60,
      burst: 1,
      distinctUsersPerWindow: 100,
      windowMs: 60_000,
    }),
    metrics: createMetrics(),
  });
  expect((await app.request("/pick?user=u")).status).toBe(200);
  expect((await app.request("/pick?user=u")).status).toBe(429);
});

test("watchlist responses are paginated", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const body = await json(await app.request("/watchlist/u?perPage=1&page=2"));
  expect(body.count).toBe(2);
  expect(body.films).toHaveLength(1);
  expect(body.films[0].lid).toBe("b");
});

test("an unfiltered pick enriches one film, not the whole watchlist", async () => {
  // Enriching a 1200-film watchlist to answer a request that returns one film
  // takes longer than any proxy will hold the connection open.
  const pool = Array.from({ length: 500 }, (_, i) => ({
    lid: `l${i}`,
    slug: `s${i}`,
    name: `F${i}`,
    year: 2000,
  }));
  let enriched = 0;
  const builder = {
    async getWatchlist() {
      return { films: pool, complete: true, partial: false };
    },
    async enrich(films: any[]) {
      enriched += films.length;
      return films.map((f) => ({ ...f, runtime: 90, rating: null, poster: null }));
    },
    whenSettled: async () => {},
    inFlightCount: () => 0,
  };
  const app = createApp({
    builder: builder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });

  const r = await json(await app.request("/pick?user=u"));
  expect(r.pool).toBe(500);
  expect(r.film.runtime).toBe(90);
  expect(enriched).toBe(1);

  // A runtime filter has to know every runtime, so it still pays for them.
  enriched = 0;
  expect((await app.request("/pick?user=u&maxRuntime=120")).status).toBe(200);
  expect(enriched).toBe(pool.length + 1);
});

test("a watchlist page enriches its page, not the watchlist behind it", async () => {
  const pool = Array.from({ length: 500 }, (_, i) => ({
    lid: `l${i}`,
    slug: `s${i}`,
    name: `F${i}`,
    year: 2000,
  }));
  let enriched = 0;
  const app = createApp({
    builder: {
      async getWatchlist() {
        return { films: pool, complete: true, partial: false };
      },
      async enrich(films: any[]) {
        enriched += films.length;
        return films.map((f) => ({ ...f, runtime: null, rating: null, poster: null }));
      },
      whenSettled: async () => {},
      inFlightCount: () => 0,
    } as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const body = await json(await app.request("/watchlist/u?perPage=25&page=3"));
  expect(body.count).toBe(500);
  expect(body.films).toHaveLength(25);
  expect(body.films[0].lid).toBe("l50");
  expect(enriched).toBe(25);
});
