import type { Config } from "./config";
import type { Enricher } from "./enricher";
import type { Fetcher } from "./fetcher";
import { parseTotal, parseWatchlistPage } from "./parser";
import type { Store } from "./store";
import type { Film } from "./types";

export type BuildReason =
  | "user_not_found"
  | "watchlist_empty"
  | "watchlist_too_large"
  | "upstream_blocked"
  | "incomplete";

export class BuildError extends Error {
  readonly reason: BuildReason;

  constructor(message: string, reason: BuildReason) {
    super(message);
    this.name = "BuildError";
    this.reason = reason;
  }
}

export const PAGE_SIZE = 28;
export const PAGE_CONCURRENCY = 4;
export const ENRICH_CONCURRENCY = 8;

export function pageUrl(username: string, page: number): string {
  return `https://letterboxd.com/${username}/watchlist/page/${page}/`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      // Index assignment, never concat: a read-modify-write here loses entries.
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

type Seed = { films: Film[]; total: number };

export function createBuilder(deps: {
  fetcher: Fetcher;
  enricher: Enricher;
  store: Store;
  cfg: Config;
  now?: () => number;
  // Injectable so tests can span multiple pages without 28-item fixtures.
  pageSize?: number;
}) {
  const { fetcher, enricher, store, cfg } = deps;
  const now = deps.now ?? (() => Date.now());
  const pageSize = deps.pageSize ?? PAGE_SIZE;
  const inFlight = new Map<string, Promise<{ films: Film[]; complete: boolean }>>();
  const backfills = new Map<string, Promise<void>>();

  // Fetch page 1 only: enough for a pick, and fast.
  async function firstPage(username: string): Promise<Seed> {
    const first = await fetcher.get(pageUrl(username, 1));
    if (first.classification === "notfound") {
      throw new BuildError(`No such member: ${username}`, "user_not_found");
    }
    const total = parseTotal(first.body);
    if (total === null) {
      throw new BuildError(`No entry count on page 1 for ${username}`, "upstream_blocked");
    }
    if (total === 0) throw new BuildError(`Watchlist is empty`, "watchlist_empty");
    if (total > cfg.maxWatchlist) {
      throw new BuildError(
        `Watchlist has ${total} films, above the ${cfg.maxWatchlist} cap`,
        "watchlist_too_large",
      );
    }
    return { films: parseWatchlistPage(first.body), total };
  }

  // `seed` is page 1 already in hand. Re-fetching it would spend an extra
  // upstream request per cold build for a page we just read.
  async function scrape(username: string, seed?: Seed): Promise<Film[]> {
    const head = seed ?? (await firstPage(username));
    const total = head.total;
    const films = [...head.films];
    const pages = Math.ceil(total / pageSize);
    const rest = await mapLimit(
      Array.from({ length: pages - 1 }, (_, i) => i + 2),
      PAGE_CONCURRENCY,
      async (p) => parseWatchlistPage((await fetcher.get(pageUrl(username, p))).body),
    );
    for (const chunk of rest) films.push(...chunk);

    const unique = new Map(films.map((f) => [f.lid, f]));
    const all = [...unique.values()];
    if (all.length !== total) {
      throw new BuildError(
        `Scrape incomplete: parsed ${all.length} of ${total}. Refusing to cache a partial watchlist.`,
        "incomplete",
      );
    }
    store.putWatchlist(username, all, total, now());
    return all;
  }

  async function runtimesFor(films: Film[]) {
    const metas = await mapLimit(films, ENRICH_CONCURRENCY, async (f) => {
      const cached = store.getFilm(f.lid, now(), cfg.filmTtlMs, cfg.negativeTtlMs);
      if (cached) return cached;
      try {
        const meta = await enricher.enrich(f);
        store.putFilm(meta, now());
        return meta;
      } catch {
        // An error is not a miss: return unknown without poisoning the cache.
        return { lid: f.lid, runtime: null, rating: null, poster: null };
      }
    });
    const byLid = new Map(metas.map((m) => [m.lid, m]));
    return films.map((f) => ({ ...f, runtime: byLid.get(f.lid)?.runtime ?? null }));
  }

  function startBackfill(username: string, seed: Seed) {
    if (backfills.has(username)) return;
    const p = scrape(username, seed)
      .then(() => undefined)
      .catch(() => undefined) // a failed backfill must not reject any caller
      .finally(() => backfills.delete(username));
    backfills.set(username, p);
  }

  return {
    inFlightCount: () => inFlight.size + backfills.size,

    whenSettled(rawUsername: string): Promise<void> {
      const username = rawUsername.trim().toLowerCase();
      return backfills.get(username) ?? Promise.resolve();
    },

    async getWatchlist(rawUsername: string) {
      const username = rawUsername.trim().toLowerCase();
      const sc = store.getScrape(username);
      if (sc?.complete && now() - sc.scrapedAt < cfg.scrapeTtlMs) {
        return {
          films: await runtimesFor(store.getWatchlist(username)),
          complete: true,
          partial: false,
        };
      }
      let p = inFlight.get(username);
      if (!p) {
        p = firstPage(username)
          .then((r) => {
            if (r.total > r.films.length) {
              startBackfill(username, r);
              return { films: r.films, complete: false };
            }
            // Page 1 already held the whole watchlist; cache it now rather
            // than re-scraping it on every later request.
            store.putWatchlist(username, r.films, r.total, now());
            return { films: r.films, complete: true };
          })
          .finally(() => inFlight.delete(username));
        inFlight.set(username, p);
      }
      const { films, complete } = await p;
      return { films: await runtimesFor(films), complete, partial: !complete };
    },
  };
}

export type Builder = ReturnType<typeof createBuilder>;
