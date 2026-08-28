/**
 * The contract a watchlist builder satisfies, shared by both read paths.
 *
 * There are two builders — `builder.ts` reads the site's HTML, `apiBuilder.ts`
 * reads the official API — and `app.ts` consumes whichever one `index.ts` wired
 * up. Their pagination models are genuinely different (numbered pages against a
 * declared total, versus a sequential cursor with no reliable total), so they
 * share this interface and nothing else.
 */

import type { Film, FilmMeta } from "./types";

/** A film with its metadata resolved, which is what a route serves. */
export type EnrichedFilm = Film & FilmMeta;

export type BuildReason =
  | "user_not_found"
  | "watchlist_empty"
  | "watchlist_private"
  | "watchlist_too_large"
  | "upstream_blocked"
  | "upstream_error"
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

export type Watchlist = { films: Film[]; complete: boolean; partial: boolean };

export type Builder = {
  /**
   * Fills in runtime, rating, poster and director for exactly the films handed
   * to it. The HTML path pays an upstream request per uncached film here; the
   * API path pays nothing, because a watchlist read already carried all four.
   */
  enrich(rawUsername: string, films: Film[]): Promise<EnrichedFilm[]>;

  /** How far the work a caller is waiting on has got, if any is running. */
  progressFor(rawUsername: string): { done: number; total: number } | null;

  /** How many builds are running. */
  inFlightCount(): number;

  /** Resolves once the build for this username has finished, if one is running. */
  whenSettled(rawUsername: string): Promise<void>;

  /** The watchlist: complete where it is cached, partial while a read runs. */
  getWatchlist(rawUsername: string): Promise<Watchlist>;
};
