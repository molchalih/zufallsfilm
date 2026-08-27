import type { Config } from "./config";
import type { Enricher } from "./enricher";
import type { Fetcher } from "./fetcher";
import { createMetrics, type Metrics } from "./metrics";
import { parseTotal, parseWatchlistPage } from "./parser";
import type { Store } from "./store";
import type { Film } from "./types";

export type BuildReason =
  | "user_not_found"
  | "watchlist_empty"
  | "watchlist_too_large"
  | "upstream_blocked"
  | "upstream_timeout"
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
  metrics?: Metrics;
  // Injectable so tests can span multiple pages without 28-item fixtures.
  pageSize?: number;
}) {
  const { fetcher, enricher, store, cfg } = deps;
  const now = deps.now ?? (() => Date.now());
  const metrics = deps.metrics ?? createMetrics();
  const pageSize = deps.pageSize ?? PAGE_SIZE;
  const inFlight = new Map<string, Promise<{ films: Film[]; complete: boolean }>>();
  const backfills = new Map<string, Promise<void>>();
  // Live enrichment counts, so a caller waiting on a cold build can be shown
  // how far it has got. Accumulated rather than replaced: two requests for the
  // same user are in flight at once on a first visit, and the second must not
  // reset the first's count. Cleared when the last job for the user finishes.
  const progress = new Map<string, { done: number; total: number; jobs: number }>();

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
  async function scrapeOnce(username: string, seed?: Seed): Promise<Film[]> {
    const head = seed ?? (await firstPage(username));
    const total = head.total;
    const films = [...head.films];
    const pages = Math.ceil(total / pageSize);
    const deadline = now() + cfg.buildBudgetMs;
    const rest = await mapLimit(
      Array.from({ length: pages - 1 }, (_, i) => i + 2),
      PAGE_CONCURRENCY,
      async (p) => {
        if (now() > deadline) {
          throw new BuildError(
            `Build exceeded ${cfg.buildBudgetMs}ms budget at page ${p}`,
            "upstream_timeout",
          );
        }
        return parseWatchlistPage((await fetcher.get(pageUrl(username, p))).body);
      },
    );
    for (const chunk of rest) films.push(...chunk);

    const unique = new Map(films.map((f) => [f.lid, f]));
    const all = [...unique.values()];
    // The 44% silent-loss failure mode shows up here and nowhere else: every
    // page returns 200 and parses cleanly while the total quietly falls short.
    metrics.observe("scrape_yield_ratio", total === 0 ? 0 : all.length / total);
    metrics.inc(all.length === total ? "scrape_complete" : "scrape_incomplete");
    if (all.length !== total) {
      throw new BuildError(
        `Scrape incomplete: parsed ${all.length} of ${total}. Refusing to cache a partial watchlist.`,
        "incomplete",
      );
    }
    store.putWatchlist(username, all, total, now());
    return all;
  }

  // A film added or removed between page 1 and page N shifts every later
  // entry, so a count mismatch is expected occasionally. Retry once against a
  // fresh total before treating it as a genuine failure. The retry drops the
  // seed deliberately: the stale page 1 is what produced the bad total.
  async function scrape(username: string, seed?: Seed): Promise<Film[]> {
    try {
      return await scrapeOnce(username, seed);
    } catch (e) {
      if (e instanceof BuildError && e.reason === "incomplete") {
        return await scrapeOnce(username);
      }
      throw e;
    }
  }

  /**
   * Fills in runtime, rating and poster for exactly the films handed to it.
   *
   * Enrichment is the expensive half of a build — DESIGN.md measures 69 ms per
   * uncached film — so the caller decides its scope. Enriching a whole
   * watchlist to answer a request that returns one page of it costs 80 s on a
   * 1200-film watchlist, which no proxy will hold open.
   */
  async function enrich(rawUsername: string, films: Film[]) {
    // Normalised on both sides, or a caller that has not lowercased yet files
    // its progress under a key no reader will look up.
    const username = rawUsername.trim().toLowerCase();
    const at = progress.get(username) ?? { done: 0, total: 0, jobs: 0 };
    at.total += films.length;
    at.jobs += 1;
    progress.set(username, at);
    const step = () => {
      at.done += 1;
    };
    try {
      return await enrichEach(films, step);
    } finally {
      at.jobs -= 1;
      if (at.jobs === 0) progress.delete(username);
    }
  }

  async function enrichEach(films: Film[], step: () => void) {
    const metas = await mapLimit(films, ENRICH_CONCURRENCY, async (f) => {
      // Counted on the way out, whichever branch it takes: a cached hit is
      // progress too, and a miss that throws still finished being attempted.
      try {
        const cached = store.getFilm(f.lid, now(), cfg.filmTtlMs, cfg.negativeTtlMs);
        if (cached && !cached.metaStale) return cached;
        if (cached) {
          // Posters and ratings drift; runtimes do not. Refresh out of band so
          // staleness never gates a pick.
          enricher
            .enrich(f)
            .then((m) => store.putFilm(m, now()))
            .catch(() => {});
          return cached;
        }
        try {
          const meta = await enricher.enrich(f);
          store.putFilm(meta, now());
          metrics.inc(meta.runtime === null ? "enrich_miss" : "enrich_hit");
          return meta;
        } catch {
          // An error is not a miss: return unknown without poisoning the cache.
          metrics.inc("enrich_error");
          return { lid: f.lid, runtime: null, rating: null, poster: null, director: null };
        }
      } finally {
        step();
      }
    });
    const byLid = new Map(metas.map((m) => [m.lid, m]));
    return films.map((f) => {
      const m = byLid.get(f.lid);
      return {
        ...f,
        runtime: m?.runtime ?? null,
        rating: m?.rating ?? null,
        poster: m?.poster ?? null,
        director: m?.director ?? null,
      };
    });
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
    enrich,

    /** How far the enrichment a caller is waiting on has got, if any. */
    progressFor(rawUsername: string): { done: number; total: number } | null {
      const at = progress.get(rawUsername.trim().toLowerCase());
      return at ? { done: at.done, total: at.total } : null;
    },

    inFlightCount: () => inFlight.size + backfills.size,

    whenSettled(rawUsername: string): Promise<void> {
      const username = rawUsername.trim().toLowerCase();
      return backfills.get(username) ?? Promise.resolve();
    },

    /**
     * The watchlist itself. Films carry identity only; runtimes, ratings and
     * posters come from `enrich`, which the caller applies to the subset it
     * actually needs.
     */
    async getWatchlist(rawUsername: string) {
      const username = rawUsername.trim().toLowerCase();
      const sc = store.getScrape(username);
      if (sc?.complete && now() - sc.scrapedAt < cfg.scrapeTtlMs) {
        return { films: store.getWatchlist(username), complete: true, partial: false };
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
      return { films, complete, partial: !complete };
    },
  };
}

export type Builder = ReturnType<typeof createBuilder>;
