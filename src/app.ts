import type { Context } from "hono";
import { Hono } from "hono";
import type { Builder } from "./builder";
import { BuildError } from "./builder";
import type { Config } from "./config";
import type { Metrics } from "./metrics";
import { pick } from "./picker";
import type { Limiter } from "./ratelimit";
import type { Store } from "./store";

type ErrorStatus = 400 | 403 | 404 | 413 | 429 | 502 | 504;

const STATUS: Record<string, ErrorStatus> = {
  user_not_found: 404,
  watchlist_empty: 404,
  watchlist_private: 403,
  watchlist_too_large: 413,
  no_match: 404,
  upstream_blocked: 502,
  upstream_timeout: 504,
  incomplete: 502,
};

type Shaped = {
  lid: string;
  slug: string;
  name: string;
  year: number | null;
  runtime: number | null;
};

const shape = (f: Shaped) => ({
  lid: f.lid,
  slug: f.slug,
  name: f.name,
  year: f.year,
  runtime: f.runtime,
  url: `https://letterboxd.com/film/${f.slug}/`,
});

export function createApp(deps: {
  builder: Builder;
  store: Store;
  cfg: Config;
  limiter: Limiter;
  metrics: Metrics;
}) {
  const { builder, cfg, limiter, metrics } = deps;
  const app = new Hono();

  app.use("*", async (c, next) => {
    const t0 = Date.now();
    await next();
    const ms = Date.now() - t0;
    metrics.inc(`http_${c.res.status}`);
    metrics.observe("http_ms", ms);
    console.log(
      JSON.stringify({
        event: "request",
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        ms,
      }),
    );
  });

  app.get("/metrics", (c) => c.json(metrics.snapshot()));

  const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      egress: cfg.egressProxy ? "proxy" : "direct",
      inFlight: builder.inFlightCount(),
    }),
  );

  app.get("/pick", async (c) => {
    const user = c.req.query("user")?.trim().toLowerCase();
    if (!user) return c.json({ error: true, reason: "missing_user" }, 400);

    const gate = limiter.check(clientIp(c), user);
    if (!gate.ok) return c.json({ error: true, reason: `throttled_${gate.reason}` }, 429);

    const raw = c.req.query("maxRuntime");
    const maxRuntime = raw === undefined ? undefined : Number(raw);
    if (maxRuntime !== undefined && (!Number.isFinite(maxRuntime) || maxRuntime <= 0)) {
      return c.json({ error: true, reason: "bad_max_runtime" }, 400);
    }

    try {
      const { films, partial } = await builder.getWatchlist(user);
      const chosen = pick(films, { maxRuntime });
      if (!chosen) return c.json({ error: true, reason: "no_match" }, 404);
      return c.json({ film: shape(chosen), partial, pool: films.length });
    } catch (e) {
      if (e instanceof BuildError) {
        return c.json({ error: true, reason: e.reason }, STATUS[e.reason] ?? 502);
      }
      return c.json({ error: true, reason: "upstream_blocked" }, 502);
    }
  });

  app.get("/watchlist/:user", async (c) => {
    const user = c.req.param("user").trim().toLowerCase();
    const gate = limiter.check(clientIp(c), user);
    if (!gate.ok) return c.json({ error: true, reason: `throttled_${gate.reason}` }, 429);

    const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
    const perPage = Math.min(500, Math.max(1, Number(c.req.query("perPage") ?? 100) || 100));
    try {
      const { films, complete, partial } = await builder.getWatchlist(user);
      const start = (page - 1) * perPage;
      return c.json({
        count: films.length,
        complete,
        partial,
        page,
        perPage,
        films: films.slice(start, start + perPage).map(shape),
      });
    } catch (e) {
      if (e instanceof BuildError) {
        return c.json({ error: true, reason: e.reason }, STATUS[e.reason] ?? 502);
      }
      return c.json({ error: true, reason: "upstream_blocked" }, 502);
    }
  });

  return app;
}
