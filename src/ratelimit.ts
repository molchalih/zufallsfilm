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

  return {
    check(ip: string, username?: string): { ok: boolean; reason?: "rate" | "variety" } {
      const t = now();
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
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
