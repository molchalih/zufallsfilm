/**
 * The Letterboxd endpoints this service uses, mapped onto its own types.
 *
 * Every film field the picker and the interface need arrives on the watchlist
 * response itself, so reading a watchlist costs one request per hundred films
 * and nothing else. Nothing here goes through `enricher`.
 */

import type { EnrichedFilm } from "./build";
import type { Client } from "./client";

/** The endpoint's documented maximum; larger values are silently clamped. */
export const PER_PAGE = 100;

type Sized = { width?: unknown; url?: unknown };
type Named = { name?: unknown };

type FilmSummary = {
  id?: unknown;
  name?: unknown;
  releaseYear?: unknown;
  runTime?: unknown;
  rating?: unknown;
  link?: unknown;
  poster?: { sizes?: Sized[] };
  directors?: unknown;
};

type FilmsResponse = { items?: FilmSummary[]; next?: unknown; itemCount?: unknown };

/**
 * Strips the `cursor=` prefix the API returns on `next` and decodes it, so the
 * caller can pass a bare value that the URL builder encodes exactly once.
 */
export function parseCursor(next: unknown): string | undefined {
  if (typeof next !== "string" || next === "") return undefined;
  const raw = next.startsWith("cursor=") ? next.slice("cursor=".length) : next;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The mid-range poster, falling back to the largest offered. */
export function posterFrom(sizes: Sized[] | undefined): string | null {
  const usable = (sizes ?? []).filter((s): s is { width: number; url: string } => {
    return typeof s.url === "string" && typeof s.width === "number";
  });
  if (usable.length === 0) return null;
  return (usable.find((s) => s.width >= 300) ?? usable[usable.length - 1]).url;
}

/** Every credited director, joined, because co-directed films are common. */
export function directorFrom(value: unknown): string | null {
  const names = (Array.isArray(value) ? (value as Named[]) : [])
    .map((d) => (d && typeof d === "object" ? d.name : undefined))
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  return names.length > 0 ? names.join(", ") : null;
}

/** One `FilmSummary` as a film, or null when it carries no usable identity. */
export function toFilm(item: FilmSummary): EnrichedFilm | null {
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    lid: item.id,
    name: item.name,
    year: typeof item.releaseYear === "number" ? item.releaseYear : null,
    runtime: typeof item.runTime === "number" ? item.runTime : null,
    rating: typeof item.rating === "number" ? item.rating : null,
    poster: posterFrom(item.poster?.sizes),
    director: directorFrom(item.directors),
    // boxd.it resolves any LID to its canonical page, so a missing `link`
    // still yields something a visitor can open.
    url: typeof item.link === "string" ? item.link : `https://boxd.it/${item.id}`,
  };
}

/** The endpoints this service reads, each returning the service's own types. */
export function createLetterboxd(client: Client, log: (line: string) => void = console.log) {
  let shapeLogged = false;

  // Confirms once per process that the watchlist response really does carry
  // runtime, rather than leaving the assumption untested against the live API.
  function logShape(item: FilmSummary | undefined) {
    if (shapeLogged || !item) return;
    shapeLogged = true;
    log(JSON.stringify({ event: "film_summary_shape", keys: Object.keys(item).sort() }));
  }

  return {
    /**
     * The member LID for a username.
     *
     * Search is fuzzy and ranks display names alongside usernames, so a result
     * counts only on an exact, case-insensitive username match.
     */
    async resolveMember(username: string): Promise<string | null> {
      const body = (await client.get("/search", {
        input: username,
        include: ["MemberSearchItem"],
        searchMethod: "Autocomplete",
        perPage: PER_PAGE,
      })) as { items?: Array<{ member?: { id?: unknown; username?: unknown } }> };

      const wanted = username.trim().toLowerCase();
      for (const item of body.items ?? []) {
        const member = item?.member;
        if (typeof member?.username !== "string" || typeof member.id !== "string") continue;
        if (member.username.toLowerCase() === wanted) return member.id;
      }
      return null;
    },

    /** The member's own count of watchlist films, used to verify a full walk. */
    async watchlistCount(lid: string): Promise<number> {
      const body = (await client.get(`/member/${encodeURIComponent(lid)}/statistics`)) as {
        counts?: { watchlist?: unknown };
      };
      const n = body.counts?.watchlist;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        throw new Error(`No watchlist count for member ${lid}`);
      }
      return n;
    },

    /** One page of the watchlist, plus the cursor for the next if there is one. */
    async watchlistPage(
      lid: string,
      cursor?: string,
    ): Promise<{ films: EnrichedFilm[]; next: string | undefined }> {
      const body = (await client.get(`/member/${encodeURIComponent(lid)}/watchlist`, {
        perPage: PER_PAGE,
        excludeMemberFilmRelationships: true,
        cursor,
      })) as FilmsResponse;

      const items = body.items ?? [];
      logShape(items[0]);
      const films = items.map(toFilm).filter((f): f is EnrichedFilm => f !== null);
      return { films, next: parseCursor(body.next) };
    },
  };
}

export type Letterboxd = ReturnType<typeof createLetterboxd>;
