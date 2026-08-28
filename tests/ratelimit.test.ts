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

test("addresses that fell idle stop being remembered", () => {
  // The defect this guards: the bucket map grew one entry per address seen and
  // never shrank, so an unauthenticated caller could spend the process's memory
  // by varying its source address.
  let t = 0;
  const l = createLimiter({
    ratePerMin: 60,
    burst: 5,
    distinctUsersPerWindow: 100,
    windowMs: 60_000,
    now: () => t,
  });
  for (let i = 0; i < 500; i++) l.check(`10.0.0.${i}`, "u");
  expect(l.size()).toBe(500);

  // Long enough for every bucket to have refilled to its burst and cleared its
  // username window, which makes it indistinguishable from an unseen address.
  t = 600_000;
  l.check("10.0.0.0");
  expect(l.size()).toBe(1);
});

test("sweeping never forgets a bucket that is still spent", () => {
  let t = 0;
  // One token a minute against a burst of two: a window's idleness refills
  // half the bucket, so the address is quiet but not forgettable.
  const l = createLimiter({
    ratePerMin: 1,
    burst: 2,
    distinctUsersPerWindow: 100,
    windowMs: 60_000,
    now: () => t,
  });
  expect(l.check("a").ok).toBe(true);
  expect(l.check("a").ok).toBe(true);
  expect(l.check("a").ok).toBe(false);
  // Forgetting it here would hand the caller a full bucket instead of the one
  // token it actually earned back.
  t = 61_000;
  expect(l.size()).toBe(1);
  expect(l.check("a").ok).toBe(true);
  expect(l.size()).toBe(1);
  expect(l.check("a").ok).toBe(false);
});

test("the username window survives a sweep that keeps the bucket", () => {
  let t = 0;
  const l = createLimiter({
    ratePerMin: 6000,
    burst: 100,
    distinctUsersPerWindow: 2,
    windowMs: 60_000,
    now: () => t,
  });
  expect(l.check("ip", "u1").ok).toBe(true);
  expect(l.check("ip", "u2").ok).toBe(true);
  t = 100;
  expect(l.check("ip", "u3").reason).toBe("variety");
});
