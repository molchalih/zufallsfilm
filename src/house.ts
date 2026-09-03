/**
 * The house pool behind the interface's "go completely random" button.
 *
 * Everywhere else this service reads a member's watchlist, because that is what
 * a member asked for. Nobody asked for this one: it is the answer to a visitor
 * who has not named anyone, so it should be a good film rather than whichever
 * member's list happened to be wired in. It is therefore not a watchlist at
 * all but a catalogue this repository owns, scraped once from two published
 * all-time lists by `scripts/build-house-pool.ts` and committed with its
 * runtimes, ratings, posters and directors already resolved. DR-006 names the
 * lists and records why the metadata ships with them.
 *
 * Two things follow from that. The button costs no upstream request, so it
 * answers instantly instead of paying for a cold build. And it answers the
 * same way on both read paths: the API path enriches only what its own walk
 * wrote, and a film it never walked would come back with every field null.
 */

import type { Builder, EnrichedFilm, Watchlist } from "./build";

/**
 * The name the interface asks for. Letterboxd usernames are alphanumeric with
 * underscores, so the leading dot cannot collide with a real member.
 */
export const HOUSE_USER = ".house";

const CATALOGUE = (await Bun.file(
  new URL("./house.json", import.meta.url),
).json()) as EnrichedFilm[];

export function houseCatalogue(): EnrichedFilm[] {
  return CATALOGUE;
}

function isHouse(rawUsername: string): boolean {
  return rawUsername.trim().toLowerCase() === HOUSE_USER;
}

/**
 * Answers for the house name and delegates everything else, so whichever
 * builder `index.ts` wired keeps the routes it already owns.
 */
export function withHousePool(base: Builder, catalogue: EnrichedFilm[] = CATALOGUE): Builder {
  const byLid = new Map(catalogue.map((f) => [f.lid, f]));
  return {
    ...base,
    enrich(rawUsername, films) {
      if (!isHouse(rawUsername)) return base.enrich(rawUsername, films);
      // Already resolved at build time; a film outside the catalogue cannot
      // reach here, but reading through the map keeps that a fact rather than
      // an assumption.
      return Promise.resolve(
        films.map(
          (f) =>
            byLid.get(f.lid) ?? { ...f, runtime: null, rating: null, poster: null, director: null },
        ),
      );
    },
    progressFor(rawUsername) {
      return isHouse(rawUsername) ? null : base.progressFor(rawUsername);
    },
    whenSettled(rawUsername) {
      return isHouse(rawUsername) ? Promise.resolve() : base.whenSettled(rawUsername);
    },
    getWatchlist(rawUsername): Promise<Watchlist> {
      if (!isHouse(rawUsername)) return base.getWatchlist(rawUsername);
      return Promise.resolve({ films: catalogue, complete: true, partial: false });
    },
  };
}
