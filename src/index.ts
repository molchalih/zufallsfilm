import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createApp } from "./app";
import { createBuilder } from "./builder";
import { loadConfig } from "./config";
import { createEnricher } from "./enricher";
import { createFetcher } from "./fetcher";
import { createLimiter } from "./ratelimit";
import { openStore } from "./store";

const cfg = loadConfig(process.env as Record<string, string | undefined>);

// Ensure the directory exists and let SQLite create the file itself. Writing
// an empty string here would truncate an existing database on every restart.
if (cfg.dbPath !== ":memory:") {
  await mkdir(dirname(cfg.dbPath), { recursive: true });
}
const store = openStore(cfg.dbPath);

const fetcher = createFetcher(cfg);
const enricher = createEnricher(fetcher);
const builder = createBuilder({ fetcher, enricher, store, cfg });
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
// holds the loop open and SQLite closes without checkpointing its WAL.
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

const app = createApp({ builder, store, cfg, limiter });

console.log(
  JSON.stringify({
    event: "start",
    port: cfg.port,
    egress: cfg.egressProxy ? "proxy" : "direct",
  }),
);

export default { port: cfg.port, fetch: app.fetch };
