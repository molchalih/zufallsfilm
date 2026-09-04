import { type Copy, copyFor, OFFLINE } from "./copy";

export type Film = {
  lid: string;
  name: string;
  year: number | null;
  runtime: number | null;
  rating: number | null;
  poster: string | null;
  director: string | null;
  url: string;
};

export type Pick = {
  film: Film;
  partial: boolean;
  pool: number;
  /** The film's 1-based place in the watchlist it was drawn from. */
  position: number;
};

export type Pool = {
  films: Film[];
  /** `positions[i]` is `films[i]`'s 1-based place in the watchlist. */
  positions: number[];
  count: number;
  complete: boolean;
  partial: boolean;
};

// Carries the copy rather than the raw reason: every caller wants the words,
// and resolving them once here keeps the mapping off the render path.
export class ApiError extends Error {
  readonly copy: Copy;
  /** The API's machine-readable reason, where the response carried one. */
  readonly reason: string | undefined;

  constructor(copy: Copy, reason?: string) {
    super(`${copy.code} ${copy.headline}`);
    this.name = "ApiError";
    this.copy = copy;
    this.reason = reason;
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
    const raw = (body as { reason?: unknown } | null)?.reason;
    const reason = typeof raw === "string" ? raw : undefined;
    throw new ApiError(copyFor(res.status, reason), reason);
  }
  return body;
}

/**
 * Sixty films is enough: the pool is the animation's raw material, not the
 * source of the pick — the server draws from the whole watchlist regardless.
 * The size is a latency budget, not a display need. The server enriches exactly
 * the films it returns, at a measured 69 ms per uncached film, and the spin
 * cannot start until they land; the grid animations tile whatever they are
 * given.
 */
export const POOL_SIZE = 60;

/**
 * `sample=1`, never a page: a page is a run of a sorted watchlist, so page one
 * is the alphabetical head of it and the animation would riffle through the As
 * of every watchlist it is shown. The sample is spread across the whole list
 * and arrives already shuffled, so a grid that tiles it in order is not a
 * sorted grid.
 */
export async function fetchPool(user: string): Promise<Pool> {
  const body = (await getJson(
    `/watchlist/${encodeURIComponent(user)}?perPage=${POOL_SIZE}&sample=1`,
  )) as Pool;
  const films = body.films ?? [];
  return {
    films,
    // A server that did not answer with positions returned a page, and a page
    // knows its own: this is page one, so index and position agree.
    positions: body.positions ?? films.map((_, i) => i + 1),
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
