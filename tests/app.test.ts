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
  const body = await json(r);
  expect(body.egress).toBe("direct");
  // The stamp identifies the running deployment; unset, it says so rather than
  // reporting a version the container cannot vouch for.
  expect(body.version).toBe("dev");
});

test("health carries the version the deployment stamped", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg: loadConfig({ APP_VERSION: "2026.08.31-abc1234" }),
    limiter: limiter(),
    metrics: createMetrics(),
  });
  expect((await json(await app.request("/health"))).version).toBe("2026.08.31-abc1234");
});

test("robots keeps crawlers off every route that reaches Letterboxd", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });

  const res = await app.request("/robots.txt");
  expect(res.status).toBe(200);
  const body = await res.text();
  for (const path of ["/pick", "/watchlist/", "/progress/"]) {
    expect(body).toContain(`Disallow: ${path}`);
  }
  // The interface and the preview card are what a shared link resolves to, so
  // a blanket disallow here would cost the site its own listing and its card.
  expect(body).not.toContain("Disallow: /\n");
  expect(body).not.toContain("Disallow: /og-red.png");
});

test("responses carry a policy, and none that blocks the card cross-origin", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });

  const res = await app.request("/og-red.png");
  expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  // Hono defaults this to same-origin, which stops a messenger's own client
  // from rendering the card it was handed.
  expect(res.headers.get("cross-origin-resource-policy")).toBeNull();

  // The error document styles itself inline, having no bundle to link.
  const page = await app.request("/nope", { headers: { accept: "text/html" } });
  expect(page.headers.get("content-security-policy")).toContain("style-src 'unsafe-inline'");
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

const bigWatchlist = Array.from({ length: 500 }, (_, i) => ({
  lid: `l${i}`,
  name: `F${i}`,
  year: 2000,
  url: `https://letterboxd.com/film/s${i}/`,
}));

const bigBuilder = {
  async getWatchlist() {
    return { films: bigWatchlist, complete: true, partial: false };
  },
  enrich: async (_user: string, films: any[]) => films,
  whenSettled: async () => {},
  inFlightCount: () => 0,
};

const bigApp = () =>
  createApp({
    builder: bigBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });

test("a sampled watchlist read is spread across the list, not a run of its head", async () => {
  // A page of a sorted watchlist is its alphabetical head, and an animation
  // riffling through that is visibly not riffling through the watchlist.
  const body = await json(await bigApp().request("/watchlist/u?perPage=60&sample=1"));
  expect(body.sampled).toBe(true);
  expect(body.films).toHaveLength(60);
  const positions = body.positions as number[];
  expect(positions).toHaveLength(60);
  expect(new Set(positions).size).toBe(60);
  expect(Math.max(...positions)).toBeGreaterThan(400);
  expect(positions).not.toEqual([...positions].sort((a, b) => a - b));
});

test("a sampled film carries the position it holds in the watchlist", async () => {
  const body = await json(await bigApp().request("/watchlist/u?perPage=60&sample=1"));
  for (const [i, film] of body.films.entries()) {
    expect(film.lid).toBe(`l${body.positions[i] - 1}`);
  }
});

test("the same watchlist samples the same films on every read", async () => {
  // A fresh draw per request is a fresh set of uncached films to enrich per
  // request: measured at 7.6 s for sixty of them, against under a ms warm.
  const one = await json(await bigApp().request("/watchlist/u?perPage=60&sample=1"));
  const two = await json(await bigApp().request("/watchlist/u?perPage=60&sample=1"));
  expect(two.positions).toEqual(one.positions);
  const other = await json(await bigApp().request("/watchlist/someoneelse?perPage=60&sample=1"));
  expect(other.positions).not.toEqual(one.positions);
});

test("a sample enriches only the films it returns", async () => {
  let enriched = 0;
  const app = createApp({
    builder: {
      ...bigBuilder,
      async enrich(_user: string, films: any[]) {
        enriched += films.length;
        return films;
      },
    } as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  await app.request("/watchlist/u?perPage=60&sample=1");
  expect(enriched).toBe(60);
});

test("a fractional page is floored, not used to index the watchlist", async () => {
  // `start` indexes `films` directly now. A fractional `page` or `perPage`
  // made every index a miss, and the TypeError surfaced as a fabricated
  // `502 upstream_blocked`.
  for (const query of ["perPage=1.5&page=2", "page=1.05&perPage=10"]) {
    const res = await bigApp().request(`/watchlist/u?${query}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.films.length).toBeGreaterThan(0);
    for (const p of body.positions) expect(Number.isInteger(p)).toBe(true);
    expect(body.films.map((f: any) => f.lid)).toEqual(
      body.positions.map((p: number) => `l${p - 1}`),
    );
  }
});

test("a page read stays a page, and says where its films sit", async () => {
  const body = await json(await bigApp().request("/watchlist/u?perPage=25&page=3"));
  expect(body.sampled).toBe(false);
  expect(body.films[0].lid).toBe("l50");
  expect(body.positions[0]).toBe(51);
  expect(body.positions.at(-1)).toBe(75);
});

test("an oversized perPage is clamped to the enrich cap, not honoured", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });
  // 500 uncached films behind one 8/s gate is >60 s of unbudgeted queueing.
  const body = await json(await app.request("/watchlist/u?perPage=500"));
  expect(body.perPage).toBe(100);
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

test("the preview card is served as a real PNG at the path the meta tag names", async () => {
  const app = createApp({
    builder: okBuilder as any,
    store: openStore(":memory:"),
    cfg,
    limiter: limiter(),
    metrics: createMetrics(),
  });

  const res = await app.request("/og-red.png");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");

  // A crawler that gets HTML here shows no card at all, so assert the bytes are
  // a PNG rather than the 404 document this route would otherwise fall through
  // to, and that `index.html` still points at this exact path.
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

  const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
  expect(html).toContain('content="https://zufalls.film/og-red.png"');
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
