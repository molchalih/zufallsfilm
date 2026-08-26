import type { Fetcher } from "./fetcher";
import type { Film, FilmMeta } from "./types";

// perPage=20 because the correct film was measured as low as rank 7 with
// include=FilmSearchItem; 8 is at the limit, not above it.
const PER_PAGE = 20;

type PosterSize = { width: number; url: string };

// encodeURIComponent leaves ' ( ) ! * alone; RFC 3986 reserves them. Both
// forms were verified to return identical search results, so encode strictly.
function encodeStrict(s: string): string {
  return encodeURIComponent(s).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function searchUrl(name: string): string {
  return (
    `https://api.letterboxd.com/api/v0/search` +
    `?input=${encodeStrict(name)}` +
    `&include=FilmSearchItem&perPage=${PER_PAGE}`
  );
}

export function filmPageUrl(slug: string): string {
  return `https://letterboxd.com/film/${slug}/`;
}

export function parseIsoDuration(d: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(d.trim());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

function posterFrom(sizes: PosterSize[] | undefined): string | null {
  if (!sizes?.length) return null;
  const mid = sizes.find((s) => s.width >= 300) ?? sizes[sizes.length - 1];
  return mid.url;
}

export function createEnricher(fetcher: Fetcher) {
  async function fromSearch(film: Film): Promise<FilmMeta | null> {
    const { body } = await fetcher.get(searchUrl(film.name));
    let parsed: { items?: Array<{ film?: Record<string, unknown> }> };
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    const hit = (parsed.items ?? []).find((i) => i?.film?.id === film.lid)?.film;
    if (!hit || hit.runTime == null) return null;
    return {
      lid: film.lid,
      runtime: hit.runTime as number,
      rating: (hit.rating as number | undefined) ?? null,
      poster: posterFrom((hit.poster as { sizes?: PosterSize[] } | undefined)?.sizes),
    };
  }

  async function fromFilmPage(film: Film): Promise<FilmMeta> {
    const { body } = await fetcher.get(filmPageUrl(film.slug));
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body);
    let runtime: number | null = null;
    let rating: number | null = null;
    let poster: string | null = null;
    if (ld) {
      try {
        const j = JSON.parse(ld[1].replace(/\/\*[\s\S]*?\*\//g, "").trim());
        runtime = typeof j.duration === "string" ? parseIsoDuration(j.duration) : null;
        poster = typeof j.image === "string" ? j.image : null;
        const rv = j.aggregateRating?.ratingValue;
        rating = rv == null ? null : Number(rv);
      } catch {
        // Leave the fields null; a parse failure here is a miss, not an error.
      }
    }
    return { lid: film.lid, runtime, rating, poster };
  }

  return {
    async enrich(film: Film): Promise<FilmMeta> {
      const hit = await fromSearch(film);
      return hit ?? (await fromFilmPage(film));
    },
  };
}

export type Enricher = ReturnType<typeof createEnricher>;
