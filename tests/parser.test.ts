import { expect, test } from "bun:test";
import { decodeEntities, parseTotal, parseWatchlistPage } from "../src/parser";

const HANDMADE = `
<div data-num-entries="350"></div>
<li class="griditem">
  <div class="react-component" data-component-class="LazyPoster"
    data-item-name="Ivan&#039;s Childhood (1962)"
    data-item-slug="ivans-childhood"
    data-item-link="/film/ivans-childhood/"
    data-postered-identifier='{&quot;lid&quot;:&quot;2abc&quot;,&quot;uid&quot;:&quot;film:123&quot;}'></div>
</li>
<li class="griditem">
  <div class="react-component" data-component-class="LazyPoster"
    data-item-name="Le Fabuleux Destin d&#039;Am&eacute;lie Poulain"
    data-item-slug="amelie"
    data-item-link="/film/amelie/"
    data-postered-identifier='{&quot;lid&quot;:&quot;9xyz&quot;,&quot;uid&quot;:&quot;film:456&quot;}'></div>
</li>`;

test("decodes numeric and named HTML entities", () => {
  expect(decodeEntities("Ivan&#039;s")).toBe("Ivan's");
  expect(decodeEntities("Am&eacute;lie")).toBe("Amélie");
  expect(decodeEntities("A &amp; B")).toBe("A & B");
  expect(decodeEntities("&quot;x&quot;")).toBe('"x"');
});

test("extracts lid from the single-quoted, quot-escaped identifier", () => {
  const films = parseWatchlistPage(HANDMADE);
  expect(films.map((f) => f.lid)).toEqual(["2abc", "9xyz"]);
});

test("splits the trailing year out of the item name", () => {
  const films = parseWatchlistPage(HANDMADE);
  expect(films[0].name).toBe("Ivan's Childhood");
  expect(films[0].year).toBe(1962);
});

test("leaves year null when the name carries none", () => {
  const films = parseWatchlistPage(HANDMADE);
  expect(films[1].name).toBe("Le Fabuleux Destin d'Amélie Poulain");
  expect(films[1].year).toBeNull();
});

test("parseTotal reads data-num-entries", () => {
  expect(parseTotal(HANDMADE)).toBe(350);
  expect(parseTotal("<div></div>")).toBeNull();
});

test("captured page yields 28 films with well-formed fields", async () => {
  const html = await Bun.file("tests/fixtures/page-normal.html").text();
  const films = parseWatchlistPage(html);
  expect(films).toHaveLength(28);
  for (const f of films) {
    expect(f.lid).toMatch(/^[A-Za-z0-9]+$/);
    expect(f.slug).toMatch(/^[a-z0-9-]+$/);
    expect(f.name.length).toBeGreaterThan(0);
    expect(f.name).not.toContain("&#");
    expect(f.name).not.toMatch(/\(\d{4}\)$/);
  }
  expect(new Set(films.map((f) => f.lid)).size).toBe(28);
});

test("over-range page parses to zero films but still reports a total", async () => {
  const html = await Bun.file("tests/fixtures/page-overrange.html").text();
  expect(parseWatchlistPage(html)).toHaveLength(0);
  expect(parseTotal(html)).toBeGreaterThan(0);
});
