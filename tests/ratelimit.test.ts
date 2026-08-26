import { expect, test } from "bun:test";
import { createLimiter } from "../src/ratelimit";

test("allows up to the burst then refuses", () => {
  const l = createLimiter({
    ratePerMin: 60,
    burst: 3,
    distinctUsersPerWindow: 100,
    windowMs: 60_000,
    now: () => 0,
  });
  expect(l.check("1.1.1.1").ok).toBe(true);
  expect(l.check("1.1.1.1").ok).toBe(true);
  expect(l.check("1.1.1.1").ok).toBe(true);
  const r = l.check("1.1.1.1");
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("rate");
});

test("refills over time", () => {
  let t = 0;
  const l = createLimiter({
    ratePerMin: 60,
    burst: 1,
    distinctUsersPerWindow: 100,
    windowMs: 60_000,
    now: () => t,
  });
  expect(l.check("a").ok).toBe(true);
  expect(l.check("a").ok).toBe(false);
  t = 1000; // one token per second at 60/min
  expect(l.check("a").ok).toBe(true);
});

test("buckets are per IP", () => {
  const l = createLimiter({
    ratePerMin: 60,
    burst: 1,
    distinctUsersPerWindow: 100,
    windowMs: 60_000,
    now: () => 0,
  });
  expect(l.check("a").ok).toBe(true);
  expect(l.check("b").ok).toBe(true);
});

test("caps distinct usernames per window", () => {
  const l = createLimiter({
    ratePerMin: 6000,
    burst: 100,
    distinctUsersPerWindow: 2,
    windowMs: 60_000,
    now: () => 0,
  });
  expect(l.check("ip", "u1").ok).toBe(true);
  expect(l.check("ip", "u2").ok).toBe(true);
  expect(l.check("ip", "u1").ok).toBe(true); // repeat is free
  const r = l.check("ip", "u3");
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("variety");
});
