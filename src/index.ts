import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import index from "../index.html";
import { createApp } from "./app";
import { createBuilder } from "./builder";
import { loadConfig } from "./config";
import { createEnricher } from "./enricher";
import { createFetcher, createRateGate } from "./fetcher";
import { createMetrics } from "./metrics";
import { createLimiter } from "./ratelimit";
import { openStore } from "./store";

const cfg = loadConfig(process.env as Record<string, string | undefined>);

// Ensure the directory exists and let SQLite create the file itself. Writing
// an empty string here would truncate an existing database on every restart.
if (cfg.dbPath !== ":memory:") {
  await mkdir(dirname(cfg.dbPath), { recursive: true });
}
const store = openStore(cfg.dbPath);

// createFetcher's third parameter has a default; pass undefined to keep it.
const gate = createRateGate(Number(process.env.GLOBAL_REQ_PER_SEC ?? 8));
const fetcher = createFetcher(cfg, fetch, undefined, gate);
const enricher = createEnricher(fetcher);
const metrics = createMetrics();
const builder = createBuilder({ fetcher, enricher, store, cfg, metrics });
const limiter = createLimiter({
  ratePerMin: Number(process.env.RATE_PER_MIN ?? 20),
  burst: Number(process.env.RATE_BURST ?? 10),
  distinctUsersPerWindow: Number(process.env.DISTINCT_USERS_PER_WINDOW ?? 15),
  windowMs: 60_000,
});

// Bound the shared film table so it cannot grow without limit.
const filmCap = Number(process.env.FILM_CAP ?? 200_000);
const evictTimer = setInterval(
  () => {
    const n = store.evictFilms(filmCap);
    if (n > 0) console.log(JSON.stringify({ event: "film_evict", evicted: n }));
  },
  60 * 60 * 1000,
);

// A container gets SIGTERM on `docker compose down`. Without this the timer
// holds the loop open and the database is never closed, so its write-ahead log
// is never checkpointed back into the file the volume actually carries.
let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "shutdown", signal: sig }));
    clearInterval(evictTimer);
    store.close();
    process.exit(0);
  });
}

const app = createApp({ builder, store, cfg, limiter, metrics });

console.log(
  JSON.stringify({
    event: "start",
    port: cfg.port,
    egress: cfg.egressProxy ? "proxy" : "direct",
  }),
);

// Bun bundles `index.html` and every module it imports, and registers the
// resulting asset routes itself. Hono keeps the API and owns everything the
// bundler did not claim, including the 404 document.
export default {
  port: cfg.port,
  routes: { "/": index },
  fetch: app.fetch,
  // Bun closes an idle connection after 10 s by default, which silently drops
  // a cold read: a complete scrape enriches every film it has not cached yet,
  // and DESIGN.md measures that at 26 s for 350 films. 60 s is the nginx
  // timeout DESIGN.md § Build model already treats as the outer bound a
  // response must fit inside, so the server and the proxy agree on the limit.
  idleTimeout: 60,
  // Opt in, never opt out. `NODE_ENV` is unset in the container, so keying the
  // dev server off "not production" would ship HMR, an unminified bundle 3x the
  // size, and every visitor's browser console piped into server stdout.
  development: process.env.NODE_ENV === "development" ? { hmr: true, console: true } : false,
};
