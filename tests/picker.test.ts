import { expect, test } from "bun:test";
import { pick } from "../src/picker";

type P = Parameters<typeof pick>[0][number];
const f = (lid: string, runtime: number | null): P => ({
  lid,
  name: lid,
  year: null,
  url: `https://letterboxd.com/film/${lid}/`,
  runtime,
});

test("returns null for an empty list", () => {
  expect(pick([], {})).toBeNull();
});

test("returns a member of the input", () => {
  const films = [f("a", 90), f("b", 100)];
  for (let i = 0; i < 50; i++) {
    expect(films).toContain(pick(films, {})!);
  }
});

test("respects maxRuntime", () => {
  const films = [f("a", 80), f("b", 200), f("c", 89)];
  for (let i = 0; i < 50; i++) {
    const r = pick(films, { maxRuntime: 90 })!;
    expect(r.runtime).toBeLessThanOrEqual(90);
  }
});

test("excludes unknown runtimes when filtering, includes them otherwise", () => {
  const films = [f("a", null), f("b", 200)];
  expect(pick(films, { maxRuntime: 90 })).toBeNull();
  expect(pick(films, {})).not.toBeNull();
});

test("returns null when the filter excludes everything", () => {
  expect(pick([f("a", 200)], { maxRuntime: 90 })).toBeNull();
});

test("uses the injected rng deterministically", () => {
  const films = [f("a", 90), f("b", 91), f("c", 92)];
  expect(pick(films, {}, () => 0)!.lid).toBe("a");
  expect(pick(films, {}, () => 0.99)!.lid).toBe("c");
});
