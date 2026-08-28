type Bucket = { tokens: number; last: number; windowStart: number; users: Set<string> };

export function createLimiter(opts: {
  ratePerMin: number;
  burst: number;
  distinctUsersPerWindow: number;
  windowMs: number;
  now?: () => number;
}) {
  const now = opts.now ?? (() => Date.now());
  const perMs = opts.ratePerMin / 60_000;
  const buckets = new Map<string, Bucket>();
  let sweptAt = Number.NEGATIVE_INFINITY;

  // A bucket idle long enough to have refilled to its burst and cleared its
  // username window is indistinguishable from one never seen, so forgetting it
  // changes no verdict. Without this the map holds one entry per address
  // forever, which is unbounded memory an unauthenticated caller controls.
  const spent = (b: Bucket, t: number) =>
    t - b.last >= opts.windowMs && b.tokens + (t - b.last) * perMs >= opts.burst;

  // At most once per window: the sweep is O(buckets), and running it on every
  // request would make the limiter quadratic in the traffic it is metering.
  function sweep(t: number) {
    if (t - sweptAt < opts.windowMs) return;
    sweptAt = t;
    for (const [ip, b] of buckets) if (spent(b, t)) buckets.delete(ip);
  }

  return {
    check(ip: string, username?: string): { ok: boolean; reason?: "rate" | "variety" } {
      const t = now();
      sweep(t);
      let b = buckets.get(ip);
      if (!b) {
        b = { tokens: opts.burst, last: t, windowStart: t, users: new Set() };
        buckets.set(ip, b);
      }
      b.tokens = Math.min(opts.burst, b.tokens + (t - b.last) * perMs);
      b.last = t;
      if (t - b.windowStart >= opts.windowMs) {
        b.windowStart = t;
        b.users.clear();
      }
      if (b.tokens < 1) return { ok: false, reason: "rate" };
      if (username && !b.users.has(username)) {
        if (b.users.size >= opts.distinctUsersPerWindow) return { ok: false, reason: "variety" };
        b.users.add(username);
      }
      b.tokens -= 1;
      return { ok: true };
    },

    /** How many addresses are currently remembered. */
    size: () => buckets.size,
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
