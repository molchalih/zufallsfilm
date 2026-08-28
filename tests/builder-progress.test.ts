import { expect, test } from "bun:test";
import { createBuilder } from "../src/builder";
import { loadConfig } from "../src/config";
import { openStore } from "../src/store";

const cfg = loadConfig({});
const films = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    lid: `l${i}`,
    name: `F${i}`,
    year: 2000,
    url: `https://letterboxd.com/film/s${i}/`,
  }));

function build(onEnrich: (lid: string) => Promise<void> | void = () => {}) {
  const store = openStore(":memory:");
  const b = createBuilder({
    fetcher: {} as any,
    enricher: {
      async enrich(f: any) {
        await onEnrich(f.lid);
        return { lid: f.lid, runtime: 90, rating: null, poster: null };
      },
    } as any,
    store,
    cfg,
  });
  return { b, store };
}

test("no build in flight reports no progress", () => {
  const { b } = build();
  expect(b.progressFor("u")).toBeNull();
});

test("progress counts films as they finish and clears at the end", async () => {
  // Gated one at a time: enrichment runs at concurrency 8, so without a gate
  // all three start before any of them finishes and the count never moves.
  const gates: Array<() => void> = [];
  const { b } = build(() => new Promise<void>((r) => gates.push(r)));
  const done = b.enrich("u", films(3));
  await Bun.sleep(5);
  expect(b.progressFor("u")).toEqual({ done: 0, total: 3 });
  gates[0]();
  await Bun.sleep(5);
  expect(b.progressFor("u")).toEqual({ done: 1, total: 3 });
  gates[1]();
  gates[2]();
  await done;
  // Torn down, so a later poll cannot report a build that already finished.
  expect(b.progressFor("u")).toBeNull();
});

test("two jobs for one user accumulate rather than reset each other", async () => {
  // A first visit issues /watchlist and /pick at once. The second job used to
  // replace the first's total, sending the bar backwards mid-build.
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { b } = build(async (lid) => {
    if (lid === "l0") await gate;
  });
  const slow = b.enrich("u", films(10));
  await Bun.sleep(5);
  const fast = b.enrich("u", films(1));
  await Bun.sleep(5);
  const at = b.progressFor("u");
  expect(at?.total).toBe(11);
  release?.();
  await Promise.all([slow, fast]);
  expect(b.progressFor("u")).toBeNull();
});

test("progress is keyed on the lowercased username the API uses", async () => {
  const { b } = build(async () => {
    expect(b.progressFor("MiXeD")).toEqual({ done: 0, total: 1 });
  });
  await b.enrich("mixed", films(1));
});

test("a film that fails to enrich still counts as progress", async () => {
  // Otherwise one unreachable film leaves the bar short of the end forever.
  const gates: Array<() => void> = [];
  const b = createBuilder({
    fetcher: {} as any,
    enricher: {
      async enrich() {
        await new Promise<void>((r) => gates.push(r));
        throw new Error("upstream");
      },
    } as any,
    store: openStore(":memory:"),
    cfg,
  });
  const done = b.enrich("u", films(3));
  await Bun.sleep(5);
  expect(b.progressFor("u")).toEqual({ done: 0, total: 3 });
  gates[0]();
  await Bun.sleep(5);
  expect(b.progressFor("u")).toEqual({ done: 1, total: 3 });
  gates[1]();
  gates[2]();
  const out = await done;
  expect(out).toHaveLength(3);
  expect(out.every((f) => f.runtime === null)).toBe(true);
  expect(b.progressFor("u")).toBeNull();
});
