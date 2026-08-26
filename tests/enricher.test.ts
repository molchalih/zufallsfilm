import { expect, test } from "bun:test";
import { createEnricher, parseIsoDuration, searchUrl } from "../src/enricher";
import type { Film } from "../src/types";

const film: Film = { lid: "2abc", slug: "ivans-childhood", name: "Ivan's Childhood", year: 1962 };

const searchBody = (items: any[]) => JSON.stringify({ items });
const filmItem = (id: string, runTime: number | null) => ({
  type: "FilmSearchItem",
  film: {
    id,
    runTime,
    rating: 4.2,
    poster: {
      sizes: [
        { width: 150, url: "s.jpg" },
        { width: 300, url: "m.jpg" },
      ],
    },
  },
});

function stubFetcher(routes: Record<string, string>) {
  return {
    async get(url: string) {
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) throw new Error(`unexpected url ${url}`);
      return { status: 200, body: routes[key], classification: "ok" as const };
    },
  };
}

test("parses ISO 8601 durations", () => {
  expect(parseIsoDuration("PT1H32M")).toBe(92);
  expect(parseIsoDuration("PT13M")).toBe(13);
  expect(parseIsoDuration("PT4H48M")).toBe(288);
  expect(parseIsoDuration("PT2H")).toBe(120);
  expect(parseIsoDuration("nonsense")).toBeNull();
});

test("search URL always restricts to films", () => {
  const u = searchUrl("Ivan's Childhood");
  expect(u).toContain("include=FilmSearchItem");
  expect(u).toContain("input=Ivan%27s%20Childhood");
});

test("uses the search hit whose id equals the lid", async () => {
  const f = stubFetcher({
    "/search": searchBody([filmItem("wrong", 10), filmItem("2abc", 95)]),
  });
  const meta = await createEnricher(f as any).enrich(film);
  expect(meta.runtime).toBe(95);
  expect(meta.poster).toBe("m.jpg");
});

test("falls back to the film page when no search hit matches the lid", async () => {
  const f = stubFetcher({
    "/search": searchBody([filmItem("other", 10)]),
    "/film/ivans-childhood/": `
      <meta name="production:identifier" content='{"lid":"2abc"}'>
      <script type="application/ld+json">
      {"@type":"Movie","duration":"PT1H35M","image":"p.jpg","aggregateRating":{"ratingValue":4.3}}
      </script>`,
  });
  const meta = await createEnricher(f as any).enrich(film);
  expect(meta.runtime).toBe(95);
  expect(meta.poster).toBe("p.jpg");
});

test("falls back when the search hit matches but carries a null runtime", async () => {
  const f = stubFetcher({
    "/search": searchBody([filmItem("2abc", null)]),
    "/film/ivans-childhood/": `
      <meta name="production:identifier" content='{"lid":"2abc"}'>
      <script type="application/ld+json">{"@type":"Movie","duration":"PT1H40M"}</script>`,
  });
  expect((await createEnricher(f as any).enrich(film)).runtime).toBe(100);
});

test("returns a null runtime only after both sources genuinely miss", async () => {
  const f = stubFetcher({
    "/search": searchBody([]),
    "/film/ivans-childhood/": `<html>no json-ld here</html>`,
  });
  expect((await createEnricher(f as any).enrich(film)).runtime).toBeNull();
});

test("an upstream error propagates and is never recorded as a miss", async () => {
  const f = {
    async get() {
      throw new Error("upstream exploded");
    },
  };
  await expect(createEnricher(f as any).enrich(film)).rejects.toThrow("upstream exploded");
});
