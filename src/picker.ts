import type { Film, PickFilter } from "./types";

type Candidate = Film & { runtime: number | null };

export function pick(
  films: Candidate[],
  filter: PickFilter,
  rng: () => number = Math.random,
): Candidate | null {
  const max = filter.maxRuntime;
  const eligible =
    max === undefined ? films : films.filter((f) => f.runtime !== null && f.runtime <= max);
  if (eligible.length === 0) return null;
  const i = Math.min(eligible.length - 1, Math.floor(rng() * eligible.length));
  return eligible[i];
}
