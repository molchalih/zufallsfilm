import { expect, test } from "bun:test";
import { mulberry32, sampleIndices, seedFrom } from "../src/random";

test("the generator is a pure function of its seed", () => {
  const a = Array.from({ length: 8 }, mulberry32(9));
  const b = Array.from({ length: 8 }, mulberry32(9));
  expect(a).toEqual(b);
  expect(a).not.toEqual(Array.from({ length: 8 }, mulberry32(10)));
  for (const v of a) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test("the string seed separates the strings a route actually forms", () => {
  expect(seedFrom("someone:412")).toBe(seedFrom("someone:412"));
  expect(seedFrom("someone:412")).not.toBe(seedFrom("someone:413"));
  expect(seedFrom("someone:412")).not.toBe(seedFrom("someoneelse:412"));
});

test("a sample is distinct, in range, and the right size", () => {
  const got = sampleIndices(500, 60, mulberry32(3));
  expect(got).toHaveLength(60);
  expect(new Set(got).size).toBe(60);
  for (const i of got) {
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(500);
  }
});

test("a sample is spread across the whole range, not a run of its head", () => {
  // The bug this exists for: a page of a sorted watchlist is the alphabetical
  // head of it. A sample that only ever reached the first sixtieth would be
  // the same defect with a different name.
  const got = sampleIndices(500, 60, mulberry32(3));
  expect(Math.max(...got)).toBeGreaterThan(400);
  expect(got.filter((i) => i >= 250).length).toBeGreaterThan(15);
});

test("a sample is shuffled, not sorted", () => {
  const got = sampleIndices(500, 60, mulberry32(3));
  expect(got).not.toEqual([...got].sort((a, b) => a - b));
});

test("a sample larger than the range is the whole range", () => {
  const got = sampleIndices(5, 60, mulberry32(1));
  expect([...got].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
});

test("an empty range samples nothing", () => {
  expect(sampleIndices(0, 60, mulberry32(1))).toEqual([]);
});

test("the same seed draws the same sample", () => {
  expect(sampleIndices(500, 60, mulberry32(7))).toEqual(sampleIndices(500, 60, mulberry32(7)));
  expect(sampleIndices(500, 60, mulberry32(7))).not.toEqual(sampleIndices(500, 60, mulberry32(8)));
});
