/** Environment-derived configuration, validated once at startup. */

/** Where watchlists are read from. Credentials decide: with a key the official
 *  API is used, without one the site is read. `WATCHLIST_SOURCE` overrides. */
export type WatchlistSource = "html" | "api";

export type Config = Readonly<{
  port: number;
  dbPath: string;
  source: WatchlistSource;
  egressProxy: string | undefined;
  apiKey: string;
  apiSecret: string;
  apiBase: string;
  apiReqPerSec: number;
  maxWatchlist: number;
  requestTimeoutMs: number;
  buildBudgetMs: number;
  filmTtlMs: number;
  scrapeTtlMs: number;
  negativeTtlMs: number;
  trustProxy: boolean;
  globalReqPerSec: number;
  ratePerMin: number;
  rateBurst: number;
  distinctUsersPerWindow: number;
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

function source(env: Env, credentialed: boolean): WatchlistSource {
  const raw = env.WATCHLIST_SOURCE;
  if (raw === "html" || raw === "api") return raw;
  if (raw !== undefined && raw !== "") {
    throw new Error(`WATCHLIST_SOURCE must be "html" or "api", got "${raw}"`);
  }
  // The API is the source this service prefers; reading the site is what it
  // falls back to while no key exists.
  return credentialed ? "api" : "html";
}

export function loadConfig(env: Env): Config {
  const proxy = env.EGRESS_PROXY;
  if (proxy && !proxy.startsWith("http://") && !proxy.startsWith("https://")) {
    throw new Error(
      `EGRESS_PROXY must be an http:// URL. Bun's fetch cannot use SOCKS proxies; ` +
        `so the outbound proxy must expose an HTTP inbound. Got "${proxy}"`,
    );
  }
  const apiKey = env.LETTERBOXD_API_KEY ?? "";
  const apiSecret = env.LETTERBOXD_API_SECRET ?? "";
  const cfg = Object.freeze({
    port: num(env, "PORT", 3000),
    dbPath: env.DB_PATH ?? "data/picker.sqlite",
    source: source(env, apiKey !== "" && apiSecret !== ""),
    egressProxy: proxy,
    apiKey,
    apiSecret,
    apiBase: env.LETTERBOXD_API_BASE ?? "https://api.letterboxd.com/api/v0",
    apiReqPerSec: num(env, "API_REQ_PER_SEC", 8),
    maxWatchlist: num(env, "MAX_WATCHLIST", 6000),
    requestTimeoutMs: num(env, "REQUEST_TIMEOUT_MS", 20_000),
    buildBudgetMs: num(env, "BUILD_BUDGET_MS", 300_000),
    filmTtlMs: num(env, "FILM_TTL_MS", 30 * 24 * 60 * 60 * 1000),
    scrapeTtlMs: num(env, "SCRAPE_TTL_MS", 7 * 24 * 60 * 60 * 1000),
    negativeTtlMs: num(env, "NEGATIVE_TTL_MS", 60 * 60 * 1000),
    trustProxy: bool(env, "TRUST_PROXY", false),
    globalReqPerSec: num(env, "GLOBAL_REQ_PER_SEC", 8),
    ratePerMin: num(env, "RATE_PER_MIN", 20),
    rateBurst: num(env, "RATE_BURST", 10),
    distinctUsersPerWindow: num(env, "DISTINCT_USERS_PER_WINDOW", 15),
  });
  // Refused here rather than on the first request: a server that answers
  // /health and fails every pick is harder to diagnose than one that will not
  // start, and the credentials are knowable at boot.
  if (cfg.source === "api" && (cfg.apiKey === "" || cfg.apiSecret === "")) {
    throw new Error(
      `WATCHLIST_SOURCE=api needs LETTERBOXD_API_KEY and LETTERBOXD_API_SECRET. ` +
        `Unset it to read watchlists from the site instead.`,
    );
  }
  return cfg;
}
