import { expect, test } from "bun:test";
import type { Builder, EnrichedFilm } from "../src/build";
import { HOUSE_USER, houseCatalogue, withHousePool } from "../src/house";

const film = (lid: string): EnrichedFilm => ({
  lid,
  name: `Film ${lid}`,
  year: 1970,
  url: `https://letterboxd.com/film/${lid}/`,
  runtime: 100,
  rating: 4,
  poster: "https://a.ltrbxd.com/x.jpg",
  director: "A Director",
});

function stubBase(): Builder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    enrich: async (u, films) => {
      calls.push(`enrich:${u}`);
      return films.map((f) => ({
        ...f,
        runtime: null,
        rating: null,
        poster: null,
        director: null,
      }));
    },
    progressFor: (u) => {
      calls.push(`progress:${u}`);
      return { done: 1, total: 2 };
    },
    inFlightCount: () => 0,
    whenSettled: async (u) => {
      calls.push(`settled:${u}`);
    },
    getWatchlist: async (u) => {
      calls.push(`watchlist:${u}`);
      return { films: [], complete: true, partial: false };
    },
  };
}

test("the house name is answered from the catalogue, without touching the base builder", async () => {
  const base = stubBase();
  const catalogue = [film("a"), film("b")];
  const b = withHousePool(base, catalogue);

  expect(await b.getWatchlist(HOUSE_USER)).toEqual({
    films: catalogue,
    complete: true,
    partial: false,
  });
  // Metadata is resolved at build time, so enrichment is a lookup, not a fetch.
  expect(await b.enrich(HOUSE_USER, [film("b")])).toEqual([catalogue[1]]);
  expect(b.progressFor(HOUSE_USER)).toBeNull();
  await b.whenSettled(HOUSE_USER);
  expect(base.calls).toEqual([]);
});

test("every other name is delegated unchanged", async () => {
  const base = stubBase();
  const b = withHousePool(base, [film("a")]);

  await b.getWatchlist("someone");
  await b.enrich("someone", [film("a")]);
  b.progressFor("someone");
  await b.whenSettled("someone");

  expect(base.calls).toEqual([
    "watchlist:someone",
    "enrich:someone",
    "progress:someone",
    "settled:someone",
  ]);
});

test("the shipped catalogue is large and fully resolved", () => {
  const films = houseCatalogue();
  // The button it backs is the site's answer to "surprise me"; a pool small
  // enough to repeat itself is the failure this catalogue replaced.
  expect(films.length).toBeGreaterThan(500);
  expect(new Set(films.map((f) => f.lid)).size).toBe(films.length);
  for (const f of films) {
    expect(f.runtime).toBeGreaterThan(0);
    expect(f.url).toStartWith("https://letterboxd.com/film/");
    expect(f.name.length).toBeGreaterThan(0);
  }
});
