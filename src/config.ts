export type Config = Readonly<{
  port: number;
  dbPath: string;
  egressProxy: string | undefined;
  maxWatchlist: number;
  requestTimeoutMs: number;
  buildBudgetMs: number;
  filmTtlMs: number;
  scrapeTtlMs: number;
  negativeTtlMs: number;
  trustProxy: boolean;
}>;

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`);
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new Error(`${key} must be true or false, got "${raw}"`);
}

export function loadConfig(env: Env): Config {
  const proxy = env.EGRESS_PROXY;
  if (proxy && !proxy.startsWith("http://") && !proxy.startsWith("https://")) {
    throw new Error(
      `EGRESS_PROXY must be an http:// URL. Bun's fetch cannot use SOCKS proxies; ` +
        `so the outbound proxy must expose an HTTP inbound. Got "${proxy}"`,
    );
  }
  return Object.freeze({
    port: num(env, "PORT", 3000),
    dbPath: env.DB_PATH ?? "data/picker.sqlite",
    egressProxy: proxy,
    maxWatchlist: num(env, "MAX_WATCHLIST", 6000),
    requestTimeoutMs: num(env, "REQUEST_TIMEOUT_MS", 20_000),
    buildBudgetMs: num(env, "BUILD_BUDGET_MS", 300_000),
    filmTtlMs: num(env, "FILM_TTL_MS", 30 * 24 * 60 * 60 * 1000),
    scrapeTtlMs: num(env, "SCRAPE_TTL_MS", 7 * 24 * 60 * 60 * 1000),
    negativeTtlMs: num(env, "NEGATIVE_TTL_MS", 60 * 60 * 1000),
    trustProxy: bool(env, "TRUST_PROXY", false),
  });
}
