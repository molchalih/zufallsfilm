import { expect, test } from "bun:test";
import { createMetrics } from "../src/metrics";

test("counters accumulate", () => {
  const m = createMetrics();
  m.inc("picks");
  m.inc("picks", 2);
  expect(m.snapshot().picks).toBe(3);
});

test("observations record count, sum, min and max", () => {
  const m = createMetrics();
  m.observe("yield", 10);
  m.observe("yield", 30);
  const s = m.snapshot();
  expect(s.yield_count).toBe(2);
  expect(s.yield_sum).toBe(40);
  expect(s.yield_min).toBe(10);
  expect(s.yield_max).toBe(30);
});

test("an unseen counter is absent rather than zero", () => {
  expect(createMetrics().snapshot().nothing).toBeUndefined();
});
