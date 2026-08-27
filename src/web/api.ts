import { type Copy, copyFor, OFFLINE } from "./copy";

export type Film = {
  lid: string;
  slug: string;
  name: string;
  year: number | null;
  runtime: number | null;
  rating: number | null;
  poster: string | null;
  url: string;
};

export type Pick = {
  film: Film;
  partial: boolean;
  pool: number;
  /** The film's 1-based place in the watchlist it was drawn from. */
  position: number;
};

export type Pool = { films: Film[]; count: number; complete: boolean; partial: boolean };

// Carries the copy rather than the raw reason: every caller wants the words,
// and resolving them once here keeps the mapping off the render path.
export class ApiError extends Error {
  readonly copy: Copy;

  constructor(copy: Copy) {
    super(`${copy.code} ${copy.headline}`);
    this.name = "ApiError";
    this.copy = copy;
  }
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    // fetch rejects before a response exists: no status to map.
    throw new ApiError(OFFLINE);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(copyFor(res.ok ? 502 : res.status));
  }
  if (!res.ok) {
    const reason = (body as { reason?: unknown } | null)?.reason;
    throw new ApiError(copyFor(res.status, typeof reason === "string" ? reason : undefined));
  }
  return body;
}

/**
 * One page is enough: the pool is the animation's raw material, not the source
 * of the pick — the server draws from the whole watchlist regardless. The size
 * is a latency budget, not a display need. The server enriches exactly the page
 * it returns, at a measured 69 ms per uncached film, and the spin cannot start
 * until the page lands; the grid animations tile whatever they are given.
 */
export const POOL_PAGE_SIZE = 60;

export async function fetchPool(user: string): Promise<Pool> {
  const body = (await getJson(
    `/watchlist/${encodeURIComponent(user)}?perPage=${POOL_PAGE_SIZE}`,
  )) as Pool;
  return {
    films: body.films ?? [],
    count: body.count ?? 0,
    complete: Boolean(body.complete),
    partial: Boolean(body.partial),
  };
}

export async function fetchPick(user: string): Promise<Pick> {
  return (await getJson(`/pick?user=${encodeURIComponent(user)}`)) as Pick;
}

export type Progress = { done: number; total: number };

/**
 * How far the enrichment behind a pending request has got. Polled while a
 * build runs, so it fails quietly: a progress read that errors must never
 * disturb the request it is reporting on.
 */
export async function fetchProgress(user: string): Promise<Progress | null> {
  try {
    const res = await fetch(`/progress/${encodeURIComponent(user)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Progress;
    return typeof body?.total === "number" && typeof body.done === "number" ? body : null;
  } catch {
    return null;
  }
}
