/**
 * The watchlist builder for the official API.
 *
 * Kept separate from `builder.ts` rather than generalised over it: the two
 * pagination models have nothing in common. The HTML path knows the page count
 * up front from `data-num-entries` and fetches four pages at a time; here the
 * only way to the next page is the cursor the last one returned, so the walk is
 * sequential and its end is declared by the API, not computed. Page one is
 * served as soon as it lands and the rest is walked behind it.
 *
 * There is no enrichment on this path. `FilmSummary` already carries runtime,
 * rating, poster and directors, so a watchlist costs one request per hundred
 * films; `enrich` here is a read of what the walk already wrote.
 */

import type { Builder, EnrichedFilm } from "./build";
import { BuildError, type BuildReason } from "./build";
import { ApiError, type Classification } from "./client";
import type { Config } from "./config";
import type { Letterboxd } from "./letterboxd";
import { createMetrics, type Metrics } from "./metrics";
import type { Store } from "./store";
import type { Film } from "./types";

type ClassMap = Partial<Record<Classification, BuildReason>>;

function translate(e: unknown, map: ClassMap): never {
  if (e instanceof BuildError) throw e;
  if (e instanceof ApiError) {
    const fallback: BuildReason =
      e.classification === "timeout" ? "upstream_timeout" : "upstream_error";
    throw new BuildError(e.message, map[e.classification] ?? fallback);
  }
  throw new BuildError(e instanceof Error ? e.message : String(e), "upstream_error");
}

type Head = { lid: string; total: number; films: EnrichedFilm[]; next: string | undefined };

type Served = { films: EnrichedFilm[]; complete: boolean };

/** What the callers waiting on a username are collectively doing. The record survives
 *  until the last job clears, so one build cannot reset a count another is raising. */
type Progress = { done: number; total: number; jobs: number };

/** A build in flight. `finished` is checked synchronously, so a request never joins
 *  a build whose walk has ended and whose result belongs in the store instead. */
type Build = { head: Promise<Served>; done: Promise<void>; finished: () => boolean };

export function createApiBuilder(deps: {
  letterboxd: Letterboxd;
  store: Store;
  cfg: Config;
  now?: () => number;
  metrics?: Metrics;
  log?: (line: string) => void;
}): Builder {
  const { letterboxd, store, cfg } = deps;
  const now = deps.now ?? (() => Date.now());
  const metrics = deps.metrics ?? createMetrics();
  const log = deps.log ?? console.log;
  // Held until the walk finishes, not until page one lands: an entry that cleared
  // early would re-run the whole head against a store the walk has not written yet.
  const builds = new Map<string, Build>();
  const progress = new Map<string, Progress>();

  /** The cached watchlist, if the last read finished and has not aged out. */
  function fresh(username: string): Film[] | null {
    const at = store.getScrape(username);
    if (!at?.complete || now() - at.scrapedAt >= cfg.scrapeTtlMs) return null;
    return store.getWatchlist(username);
  }

  function beginJob(username: string) {
    const at = progress.get(username) ?? { done: 0, total: 0, jobs: 0 };
    at.jobs += 1;
    progress.set(username, at);
    let released = false;
    return {
      at,
      release() {
        if (released) return;
        released = true;
        at.jobs -= 1;
        if (at.jobs === 0) progress.delete(username);
      },
    };
  }

  /** Resolves the member, reads the expected count and fetches page one. */
  async function head(username: string, at: Progress): Promise<Head> {
    let lid: string | null;
    try {
      lid = await letterboxd.resolveMember(username);
    } catch (e) {
      translate(e, {});
    }
    if (!lid) throw new BuildError(`No such member: ${username}`, "user_not_found");

    let total: number;
    try {
      total = await letterboxd.watchlistCount(lid);
    } catch (e) {
      translate(e, { notfound: "user_not_found", forbidden: "watchlist_private" });
    }
    if (total === 0) throw new BuildError("Watchlist is empty", "watchlist_empty");
    if (total > cfg.maxWatchlist) {
      throw new BuildError(
        `Watchlist has ${total} films, above the ${cfg.maxWatchlist} cap`,
        "watchlist_too_large",
      );
    }

    try {
      const first = await letterboxd.watchlistPage(lid);
      at.total += total;
      at.done += first.films.length;
      return { lid, total, films: first.films, next: first.next };
    } catch (e) {
      translate(e, { notfound: "user_not_found", forbidden: "watchlist_private" });
    }
  }

  /**
   * Caches the films a finished walk produced. A completed walk is authoritative even
   * where it disagrees with `counts.watchlist`, which counts entries the watchlist
   * endpoint filters out; refusing the cache over that would re-walk on every request.
   *
   * Metadata goes into the shared `film` table alongside the entries, which is
   * what makes `enrich` on this path a pure store read.
   */
  function commit(username: string, films: EnrichedFilm[], expected: number) {
    const unique = [...new Map(films.map((f) => [f.lid, f])).values()];
    metrics.observe("watchlist_yield_ratio", expected === 0 ? 0 : unique.length / expected);
    metrics.inc(unique.length === expected ? "watchlist_complete" : "watchlist_short");
    if (unique.length !== expected) {
      log(
        JSON.stringify({
          event: "watchlist_count_mismatch",
          username,
          expected,
          actual: unique.length,
        }),
      );
    }
    const at = now();
    store.putWatchlist(username, unique, expected, at, true);
    for (const f of unique) store.putFilm(f, at);
  }

  /** Walks the cursor to the end of the list and caches what it read. */
  async function walk(username: string, start: Head, at: Progress, deadline: number) {
    const films = [...start.films];
    const seen = new Set<string>();
    let cursor = start.next;

    while (cursor) {
      if (now() > deadline) {
        throw new BuildError(
          `Build exceeded ${cfg.buildBudgetMs}ms budget after ${films.length} films`,
          "upstream_timeout",
        );
      }
      // Only the API can end the walk, so a cursor handed back twice would page
      // forever. An empty page ends it normally; a repeated cursor is a broken read.
      if (seen.has(cursor)) {
        throw new BuildError(
          `Cursor repeated after ${films.length} films; the walk cannot finish`,
          "incomplete",
        );
      }
      seen.add(cursor);

      let page: { films: EnrichedFilm[]; next: string | undefined };
      try {
        page = await letterboxd.watchlistPage(start.lid, cursor);
      } catch (e) {
        translate(e, { notfound: "user_not_found", forbidden: "watchlist_private" });
      }
      if (page.films.length === 0) break;
      films.push(...page.films);
      at.done += page.films.length;
      cursor = page.next;
    }

    commit(username, films, start.total);
  }

  /** Starts one build and registers it, so everything arriving for this username until
   *  the walk finishes joins it. The budget covers head and walk alike. */
  function startBuild(username: string): Build {
    const job = beginJob(username);
    const deadline = now() + cfg.buildBudgetMs;

    let resolveWalked: () => void = () => {};
    const walked = new Promise<void>((r) => {
      resolveWalked = r;
    });
    let finished = false;
    const finish = () => {
      finished = true;
      resolveWalked();
    };

    const served = (async (): Promise<Served> => {
      try {
        const h = await head(username, job.at);
        // A walk may have finished while this head was in flight. Its result is
        // the whole watchlist; page one would be a downgrade.
        const cached = fresh(username);
        if (cached) {
          finish();
          return { films: await hydrate(cached), complete: true };
        }
        if (h.next === undefined) {
          commit(username, h.films, h.total);
          finish();
          return { films: h.films, complete: true };
        }
        walk(username, h, job.at, deadline)
          .catch(() => undefined)
          .finally(finish);
        return { films: h.films, complete: false };
      } catch (e) {
        finish();
        throw e;
      }
    })();

    const done = (async () => {
      await served.catch(() => undefined);
      await walked;
    })().finally(() => {
      job.release();
      if (builds.get(username)?.head === served) builds.delete(username);
    });

    const build: Build = { head: served, done, finished: () => finished };
    builds.set(username, build);
    return build;
  }

  /**
   * Joins films to the metadata the walk stored for them. No request is made
   * and none can be: a film whose row has aged out reads as unknown, exactly as
   * an enrichment miss does, and the next walk rewrites it.
   *
   * Both TTLs are the film TTL. The short negative TTL exists so the HTML path
   * retries a miss soon; nothing on this path ever refetches one film, and a
   * null runtime here is what the API said rather than a failure to look.
   */
  async function hydrate(films: Film[]): Promise<EnrichedFilm[]> {
    const t = now();
    return films.map((f) => {
      const meta = store.getFilm(f.lid, t, cfg.filmTtlMs, cfg.filmTtlMs);
      return {
        ...f,
        runtime: meta?.runtime ?? null,
        rating: meta?.rating ?? null,
        poster: meta?.poster ?? null,
        director: meta?.director ?? null,
      };
    });
  }

  return {
    enrich: (_rawUsername: string, films: Film[]) => hydrate(films),

    /** How far the walk a caller is waiting on has got, if one is running. */
    progressFor(rawUsername: string): { done: number; total: number } | null {
      const at = progress.get(rawUsername.trim().toLowerCase());
      return at ? { done: at.done, total: at.total } : null;
    },

    /** How many builds are running, each counted once from head to walk. */
    inFlightCount: () => builds.size,

    /** Resolves once the build for this username has finished, if one is running. */
    whenSettled(rawUsername: string): Promise<void> {
      return builds.get(rawUsername.trim().toLowerCase())?.done ?? Promise.resolve();
    },

    /** The watchlist: complete where it is cached, partial where a walk is running. */
    async getWatchlist(rawUsername: string) {
      const username = rawUsername.trim().toLowerCase();
      const cached = fresh(username);
      if (cached) return { films: cached, complete: true, partial: false };

      const running = builds.get(username);
      const build = running && !running.finished() ? running : startBuild(username);
      const { films, complete } = await build.head;
      return { films, complete, partial: !complete };
    },
  };
}
