import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { BuildError } from "../src/build";
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
  { lid: "a", name: "A", year: 2000, url: "https://letterboxd.com/film/a/", runtime: 80 },
  { lid: "b", name: "B", year: 2001, url: "https://letterboxd.com/film/b/", runtime: 200 },
];
const okBuilder = {
  async getWatchlist() {
    return { films, complete: true, partial: false };
  },
  enrich: async (_user: string, films: any[]) => films,
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
  // The film carries its own URL; the route never rebuilds one from an
  // identifier only the HTML path has.
  expect(body.film.url).toBe(`https://letterboxd.com/film/${body.film.lid}/`);
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
        enrich: async (_user: string, films: any[]) => films,
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

test("a film carries its poster and rating, and says so when it has neither", async () => {
  const app = createApp({
    builder: {
      async getWatchlist() {
        return {
          films: [{ ...films[0], rating: 4.54, poster: "https://a.ltrbxd.com/p.jpg" }, films[1]],
          complete: true,
          partial: false,
        };
      },
      enrich: async (_user: string, films: any[]) => films,
      whenSettled: async () => {},
      inFlightCount: () => 0,
    } as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  const body = await json(await app.request("/watchlist/u"));
  expect(body.films[0].poster).toBe("https://a.ltrbxd.com/p.jpg");
  expect(body.films[0].rating).toBe(4.54);
  // Absent, not omitted: a missing key cannot be told from an unknown value.
  expect(body.films[1]).toHaveProperty("poster", null);
  expect(body.films[1]).toHaveProperty("rating", null);
});

test("an unrouted request answers in the shape its caller asked for", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });

  const api = await app.request("/nope");
  expect(api.status).toBe(404);
  expect((await json(api)).reason).toBe("route_not_found");

  const page = await app.request("/nope", { headers: { accept: "text/html" } });
  expect(page.status).toBe(404);
  expect(page.headers.get("content-type")).toContain("text/html");
  expect(await page.text()).toContain("scene missing.");
});

test("an unhandled throw becomes a 500, not a hang", async () => {
  const metrics = createMetrics();
  const app = createApp({
    builder: {
      getWatchlist() {
        throw new TypeError("boom");
      },
      enrich: async (_user: string, films: any[]) => films,
      whenSettled: async () => {},
      inFlightCount() {
        throw new TypeError("boom");
      },
    } as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics,
  });
  const r = await app.request("/health", { headers: { accept: "text/html" } });
  expect(r.status).toBe(500);
  expect(await r.text()).toContain("projector failure.");
  expect(metrics.snapshot().unhandled_error).toBe(1);
});

test("an unfiltered pick enriches one film, not the whole watchlist", async () => {
  // Enriching a four-figure watchlist to answer a request that returns one film
  // takes longer than any proxy will hold the connection open.
  const pool = Array.from({ length: 500 }, (_, i) => ({
    lid: `l${i}`,
    name: `F${i}`,
    year: 2000,
    url: `https://letterboxd.com/film/s${i}/`,
  }));
  let enriched = 0;
  const builder = {
    async getWatchlist() {
      return { films: pool, complete: true, partial: false };
    },
    async enrich(_user: string, films: any[]) {
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
  // A client cannot derive this: it holds one page, the draw was from all 500.
  expect(r.position).toBe(pool.findIndex((f) => f.lid === r.film.lid) + 1);
  expect(r.position).toBeGreaterThan(0);

  // A runtime filter has to know every runtime, so it still pays for them.
  enriched = 0;
  expect((await app.request("/pick?user=u&maxRuntime=120")).status).toBe(200);
  expect(enriched).toBe(pool.length + 1);
});

test("a watchlist page enriches its page, not the watchlist behind it", async () => {
  const pool = Array.from({ length: 500 }, (_, i) => ({
    lid: `l${i}`,
    name: `F${i}`,
    year: 2000,
    url: `https://letterboxd.com/film/s${i}/`,
  }));
  let enriched = 0;
  const app = createApp({
    builder: {
      async getWatchlist() {
        return { films: pool, complete: true, partial: false };
      },
      async enrich(_user: string, films: any[]) {
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

test("progress is readable while a build runs and is not rate limited", async () => {
  let at: { done: number; total: number } | null = { done: 7, total: 60 };
  const app = createApp({
    builder: {
      ...okBuilder,
      progressFor: (u: string) => (u === "u" ? at : null),
    } as any,
    store: openStore(":memory:"),
    cfg,
    // A bucket of one: the poll must not spend it, or it throttles the very
    // request it is reporting on.
    limiter: createLimiter({
      ratePerMin: 60,
      burst: 1,
      distinctUsersPerWindow: 100,
      windowMs: 60_000,
    }),
    metrics: createMetrics(),
  });

  for (let i = 0; i < 5; i++) {
    const r = await app.request("/progress/u");
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ done: 7, total: 60 });
  }
  // The pick still has its token.
  expect((await app.request("/pick?user=u")).status).toBe(200);

  // Nothing in flight reads as zero, not as an error.
  at = null;
  expect(await json(await app.request("/progress/u"))).toEqual({ done: 0, total: 0 });
});

test("a forwarded-for header is ignored unless the deployment declares a proxy", async () => {
  // The defect this guards: honouring `X-Forwarded-For` unconditionally let any
  // caller mint a fresh bucket per request by varying the header, which walks
  // straight past the limiter that stops this service being an amplifier.
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
  const spoof = (ip: string) => app.request("/pick?user=u", { headers: { "x-forwarded-for": ip } });
  expect((await spoof("1.1.1.1")).status).toBe(200);
  expect((await spoof("2.2.2.2")).status).toBe(429);
  expect((await spoof("3.3.3.3")).status).toBe(429);
});

test("a declared proxy's forwarded-for header is the caller's address", async () => {
  // Behind a proxy the peer address is the proxy's, so without this every
  // visitor shares one bucket and the first of them throttles the rest.
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg: loadConfig({ TRUST_PROXY: "true" }),
    limiter: createLimiter({
      ratePerMin: 60,
      burst: 1,
      distinctUsersPerWindow: 100,
      windowMs: 60_000,
    }),
    metrics: createMetrics(),
  });
  const from = (ip: string) => app.request("/pick?user=u", { headers: { "x-forwarded-for": ip } });
  expect((await from("1.1.1.1")).status).toBe(200);
  expect((await from("2.2.2.2")).status).toBe(200);
  // The first visitor still has only its own bucket.
  expect((await from("1.1.1.1")).status).toBe(429);
  // A chain names the client first; the proxies behind it are not the caller.
  expect((await from("9.9.9.9, 10.0.0.1")).status).toBe(200);
});
