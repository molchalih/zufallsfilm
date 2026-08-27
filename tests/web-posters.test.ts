import { beforeEach, expect, test } from "bun:test";
import { prefetchPosters, resetPrefetchCache } from "../src/web/posters";

type FakeImage = { src: string; decoding: string };

function collector() {
  const made: FakeImage[] = [];
  return {
    made,
    factory: () => {
      const img = { src: "", decoding: "" };
      made.push(img);
      return img;
    },
  };
}

beforeEach(resetPrefetchCache);

test("every poster is requested, in the order given", () => {
  // Order is the caller's priority: the winner is referenced last by the reel
  // but is the one image the visitor is guaranteed to look at.
  const c = collector();
  const started = prefetchPosters(["winner.jpg", "a.jpg", "b.jpg"], c.factory);
  expect(started).toBe(3);
  expect(c.made.map((i) => i.src)).toEqual(["winner.jpg", "a.jpg", "b.jpg"]);
  expect(c.made.every((i) => i.decoding === "async")).toBe(true);
});

test("films without a poster are skipped rather than requested as empty", () => {
  const c = collector();
  expect(prefetchPosters([null, undefined, "", "a.jpg"], c.factory)).toBe(1);
  expect(c.made.map((i) => i.src)).toEqual(["a.jpg"]);
});

test("a poster already requested is not requested again", () => {
  // A reroll shares its pool with the spin before it, and the same film
  // appears many times across a reel; without this every frame re-requests.
  const c = collector();
  expect(prefetchPosters(["a.jpg", "b.jpg"], c.factory)).toBe(2);
  expect(prefetchPosters(["a.jpg", "b.jpg", "c.jpg"], c.factory)).toBe(1);
  expect(c.made.map((i) => i.src)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  // Duplicates inside a single call collapse too.
  expect(prefetchPosters(["d.jpg", "d.jpg", "d.jpg"], c.factory)).toBe(1);
});

test("nothing to prefetch is not an error", () => {
  const c = collector();
  expect(prefetchPosters([], c.factory)).toBe(0);
  expect(prefetchPosters([null, null], c.factory)).toBe(0);
  expect(c.made).toHaveLength(0);
});
