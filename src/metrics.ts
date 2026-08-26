export function createMetrics() {
  const counters = new Map<string, number>();
  const obs = new Map<string, { count: number; sum: number; min: number; max: number }>();
  return {
    inc(name: string, n = 1) {
      counters.set(name, (counters.get(name) ?? 0) + n);
    },
    observe(name: string, v: number) {
      const o = obs.get(name) ?? { count: 0, sum: 0, min: Infinity, max: -Infinity };
      o.count++;
      o.sum += v;
      o.min = Math.min(o.min, v);
      o.max = Math.max(o.max, v);
      obs.set(name, o);
    },
    snapshot(): Record<string, number> {
      const out: Record<string, number> = {};
      for (const [k, v] of counters) out[k] = v;
      for (const [k, o] of obs) {
        out[`${k}_count`] = o.count;
        out[`${k}_sum`] = o.sum;
        out[`${k}_min`] = o.min;
        out[`${k}_max`] = o.max;
      }
      return out;
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
