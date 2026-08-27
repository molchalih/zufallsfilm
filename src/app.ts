import type { Context } from "hono";
import { Hono } from "hono";
import type { Builder } from "./builder";
import { BuildError } from "./builder";
import type { Config } from "./config";
import type { Metrics } from "./metrics";
import { pick } from "./picker";
import type { Limiter } from "./ratelimit";
import type { Store } from "./store";
import { errorPage } from "./web/errorPage";

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
  rating?: number | null;
  poster?: string | null;
};

// The shape DESIGN.md § API contract specifies. `rating` and `poster` are
// optional on the input because the picker only ever reads `runtime`; they are
// never optional on the output, or a client cannot tell absent from unknown.
const shape = (f: Shaped) => ({
  lid: f.lid,
  slug: f.slug,
  name: f.name,
  year: f.year,
  runtime: f.runtime,
  rating: f.rating ?? null,
  poster: f.poster ?? null,
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

  // Deliberately outside the rate limiter: it reads a counter, performs no
  // upstream work, and the interface polls it several times a second while a
  // cold build runs. Metering it would throttle the request it is reporting on.
  app.get("/progress/:user", (c) => {
    const at = builder.progressFor(c.req.param("user"));
    return c.json(at ?? { done: 0, total: 0 });
  });

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
      // A runtime filter has to know every runtime, so it pays for all of them.
      // An unfiltered pick does not: draw first, then enrich the one film the
      // response carries. On a 1200-film watchlist that is one upstream call
      // instead of 1200.
      const pool =
        maxRuntime === undefined
          ? films.map((f) => ({ ...f, runtime: null }))
          : await builder.enrich(user, films);
      const chosen = pick(pool, { maxRuntime });
      if (!chosen) return c.json({ error: true, reason: "no_match" }, 404);
      const [film] = await builder.enrich(user, [chosen]);
      return c.json({
        film: shape({ ...chosen, ...film }),
        partial,
        pool: films.length,
        // Where the film sits in the watchlist, 1-based. A client that shows a
        // position cannot derive it: the draw is from the whole watchlist and
        // the page it holds is only part of it.
        position: films.findIndex((f) => f.lid === chosen.lid) + 1,
      });
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
      // Enrich the page, not the watchlist behind it.
      const window = await builder.enrich(user, films.slice(start, start + perPage));
      return c.json({
        count: films.length,
        complete,
        partial,
        page,
        perPage,
        films: window.map(shape),
      });
    } catch (e) {
      if (e instanceof BuildError) {
        return c.json({ error: true, reason: e.reason }, STATUS[e.reason] ?? 502);
      }
      return c.json({ error: true, reason: "upstream_blocked" }, 502);
    }
  });

  // A browser that wandered off the routes gets the design's error page; an
  // API client gets the same failure as JSON. One `Accept` header decides.
  const wantsHtml = (c: Context) => (c.req.header("accept") ?? "").includes("text/html");

  app.notFound((c) =>
    wantsHtml(c)
      ? c.html(errorPage(404, "route_not_found"), 404)
      : c.json({ error: true, reason: "route_not_found" }, 404),
  );

  app.onError((err, c) => {
    metrics.inc("unhandled_error");
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        path: new URL(c.req.url).pathname,
        message: err.message,
      }),
    );
    return wantsHtml(c)
      ? c.html(errorPage(500, "internal"), 500)
      : c.json({ error: true, reason: "internal" }, 500);
  });

  return app;
}
