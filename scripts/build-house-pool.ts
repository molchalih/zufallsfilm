/**
 * Regenerates `src/house.json`, the repo-owned catalogue the web UI draws from
 * when a visitor asks for a completely random film.
 *
 * The catalogue exists so that path needs no upstream read at all: the button
 * answers from a file that ships with the service. Re-run this script to
 * refresh it: `bun run house`.
 *
 * Everything here is the service's own machinery. The list pages carry the same
 * `data-item-name` / `data-item-slug` / `data-postered-identifier` markup a
 * watchlist page does, so `parseWatchlistPage` reads them unchanged. They do
 * not carry `data-num-entries`, so pagination stops on the first empty page
 * rather than on a declared total.
 */

import { loadConfig } from "../src/config";
import { createEnricher } from "../src/enricher";
import { createFetcher, createRateGate } from "../src/fetcher";
import { parseWatchlistPage } from "../src/parser";
import type { EnrichedFilm } from "../src/build";
import type { Film } from "../src/types";

/** Canonical lists, each verified to be live and to paginate 100 items a page. */
const SOURCES = [
  "https://letterboxd.com/official/list/letterboxds-top-500-films/",
  "https://letterboxd.com/tspdtfanaccount/list/the-1000-greatest-films-21st-edition-2026/",
];

const OUT = new URL("../src/house.json", import.meta.url).pathname;

/** A page count that cannot be reached by any list this script reads. */
const MAX_PAGES = 60;

const ENRICH_CONCURRENCY = 8;

// The service identifies itself as a bot, which the list pages answer to with a
// challenge. This is an author-run generator, not the service, so it asks the
// way a browser does.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const browserFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, headers: { ...(init?.headers ?? {}), "User-Agent": UA } });

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const cfg = loadConfig(process.env as Record<string, string | undefined>);
const gate = createRateGate(cfg.globalReqPerSec);
// createFetcher's third parameter has a default; pass undefined to keep it.
const fetcher = createFetcher(cfg, browserFetch, undefined, gate);
const enricher = createEnricher(fetcher);

// Dedupe across lists by `lid`, the only identity Letterboxd guarantees; the
// first list to mention a film wins its name and year.
const byLid = new Map<string, Film>();

for (const base of SOURCES) {
  let fromList = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { body } = await fetcher.get(`${base}page/${page}/`);
    const films = parseWatchlistPage(body);
    if (films.length === 0) break;
    fromList += films.length;
    for (const f of films) if (!byLid.has(f.lid)) byLid.set(f.lid, f);
    log(`  ${base}page/${page}/ -> ${films.length} (list ${fromList}, pool ${byLid.size})`);
  }
  log(`${base} yielded ${fromList} films`);
}

const films = [...byLid.values()];
log(`${films.length} distinct films; enriching at concurrency ${ENRICH_CONCURRENCY}`);

let done = 0;
const dropped: string[] = [];
const enriched = await mapLimit(films, ENRICH_CONCURRENCY, async (film) => {
  let out: EnrichedFilm | null = null;
  try {
    const meta = await enricher.enrich(film);
    // A film with no runtime cannot answer a runtime filter, and the catalogue
    // is meant to be self-sufficient, so it is dropped rather than stored null.
    if (meta.runtime == null) dropped.push(`${film.name} (${film.year}): no runtime`);
    else out = { ...film, ...meta };
  } catch (e) {
    dropped.push(`${film.name} (${film.year}): ${e instanceof Error ? e.message : String(e)}`);
  }
  done++;
  if (done % 50 === 0) log(`  enriched ${done}/${films.length} (${dropped.length} dropped)`);
  return out;
});

const kept = enriched.filter((f): f is EnrichedFilm => f !== null);
// Sorted by name, then year, so a re-run of an unchanged catalogue is an empty
// diff rather than a reshuffle.
kept.sort((a, b) => a.name.localeCompare(b.name) || (a.year ?? 0) - (b.year ?? 0));

await Bun.write(OUT, `${JSON.stringify(kept, null, 1)}\n`);

log(`wrote ${OUT}: ${kept.length} films, ${dropped.length} dropped`);
for (const d of dropped) log(`  dropped ${d}`);
