import { expect, test } from "bun:test";
import type { Client, Params } from "../src/client";
import { createLetterboxd, directorFrom, parseCursor, posterFrom, toFilm } from "../src/letterboxd";
import { filmSummary, filmsResponse, memberSearch, statistics } from "./fixtures/api";

type Handler = (path: string, params: Params) => unknown;

function fake(handler: Handler) {
  const calls: Array<{ path: string; params: Params }> = [];
  const client = {
    async get(path: string, params: Params = {}) {
      calls.push({ path, params });
      return handler(path, params);
    },
  } as Client;
  return { calls, client };
}

test("a next cursor is stripped of its prefix and decoded exactly once", () => {
  expect(parseCursor("cursor=DwcpBJZNYzgKm2gIDAw%3D%3D")).toBe("DwcpBJZNYzgKm2gIDAw==");
  expect(parseCursor("DwcpBJZNYzgKm2gIDAw%3D%3D")).toBe("DwcpBJZNYzgKm2gIDAw==");
  expect(parseCursor(undefined)).toBeUndefined();
  expect(parseCursor("")).toBeUndefined();
  expect(parseCursor(42)).toBeUndefined();
  // A malformed escape must not throw; the raw value is still a usable cursor.
  expect(parseCursor("cursor=%E0%A4%A")).toBe("%E0%A4%A");
});

test("the poster chosen is the first at or above 300px, else the largest", () => {
  expect(
    posterFrom([
      { width: 125, url: "small" },
      { width: 300, url: "mid" },
      { width: 600, url: "big" },
    ]),
  ).toBe("mid");
  expect(posterFrom([{ width: 125, url: "small" }])).toBe("small");
  expect(posterFrom([])).toBeNull();
  expect(posterFrom(undefined)).toBeNull();
  expect(posterFrom([{ width: "x", url: 3 }])).toBeNull();
});

test("every credited director is kept", () => {
  expect(directorFrom([{ name: "Joel Coen" }, { name: "Ethan Coen" }])).toBe(
    "Joel Coen, Ethan Coen",
  );
  expect(directorFrom([{ name: "Chantal Akerman" }])).toBe("Chantal Akerman");
  expect(directorFrom([])).toBeNull();
  expect(directorFrom(undefined)).toBeNull();
  expect(directorFrom([{ name: "  " }])).toBeNull();
});

test("a film summary maps onto every field the interface shows", () => {
  const film = toFilm(filmSummary("abc"));
  expect(film).toEqual({
    lid: "abc",
    name: "Film abc",
    year: 1994,
    runtime: 100,
    rating: 3.9,
    poster: "https://a.ltrbxd.com/abc-300.jpg",
    director: "A Director",
    url: "https://letterboxd.com/film/abc/",
  });
});

test("absent optional fields become null rather than undefined", () => {
  const film = toFilm(
    filmSummary("x", { runTime: null, rating: null, poster: null, releaseYear: null }),
  );
  expect(film?.runtime).toBeNull();
  expect(film?.rating).toBeNull();
  expect(film?.poster).toBeNull();
  expect(film?.year).toBeNull();
});

test("a summary without an id or a name is dropped, and a missing link falls back", () => {
  expect(toFilm({ name: "no id" })).toBeNull();
  expect(toFilm({ id: "no-name" })).toBeNull();
  expect(toFilm(filmSummary("q", { link: null }))?.url).toBe("https://boxd.it/q");
});

test("a member is resolved only on an exact, case-insensitive username", async () => {
  const { client, calls } = fake(() =>
    memberSearch([
      { id: "WRONG", username: "examplemember_fan" },
      { id: "RIGHT", username: "ExampleMember" },
    ]),
  );
  const lb = createLetterboxd(client, () => {});
  expect(await lb.resolveMember("examplemember")).toBe("RIGHT");
  expect(calls[0].path).toBe("/search");
  expect(calls[0].params.include).toEqual(["MemberSearchItem"]);
  expect(calls[0].params.searchMethod).toBe("Autocomplete");
});

test("a fuzzy hit that is not the username is not a match", async () => {
  const { client } = fake(() => memberSearch([{ id: "X", username: "cantwin" }]));
  const lb = createLetterboxd(client, () => {});
  expect(await lb.resolveMember("davidj")).toBeNull();
});

test("an empty result set resolves to no member", async () => {
  const { client } = fake(() => ({ items: [] }));
  const lb = createLetterboxd(client, () => {});
  expect(await lb.resolveMember("nobody")).toBeNull();
});

test("the watchlist count comes from the member's own statistics", async () => {
  const { client, calls } = fake(() => statistics(240));
  const lb = createLetterboxd(client, () => {});
  expect(await lb.watchlistCount("MEM01")).toBe(240);
  expect(calls[0].path).toBe("/member/MEM01/statistics");
});

test("a statistics body without a count is an error, not a zero", async () => {
  const { client } = fake(() => ({ counts: {} }));
  const lb = createLetterboxd(client, () => {});
  await expect(lb.watchlistCount("MEM01")).rejects.toThrow(/No watchlist count/);
});

test("a watchlist page is requested at the maximum size, without relationships", async () => {
  const { client, calls } = fake(() => filmsResponse(["a", "b"], "NEXT=="));
  const lb = createLetterboxd(client, () => {});
  const page = await lb.watchlistPage("MEM01");

  expect(calls[0].path).toBe("/member/MEM01/watchlist");
  expect(calls[0].params.perPage).toBe(100);
  expect(calls[0].params.excludeMemberFilmRelationships).toBe(true);
  expect(calls[0].params.cursor).toBeUndefined();
  expect(page.films.map((f) => f.lid)).toEqual(["a", "b"]);
  expect(page.next).toBe("NEXT==");
});

test("a cursor is passed through as a bare value", async () => {
  const { client, calls } = fake(() => filmsResponse(["c"]));
  const lb = createLetterboxd(client, () => {});
  const page = await lb.watchlistPage("MEM01", "NEXT==");
  expect(calls[0].params.cursor).toBe("NEXT==");
  expect(page.next).toBeUndefined();
});

test("the film shape is logged once per process, so the assumption stays tested", async () => {
  const lines: string[] = [];
  const { client } = fake(() => filmsResponse(["a"]));
  const lb = createLetterboxd(client, (l) => lines.push(l));
  await lb.watchlistPage("MEM01");
  await lb.watchlistPage("MEM01", "more");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).keys).toContain("runTime");
});
