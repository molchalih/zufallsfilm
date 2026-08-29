---
answers: why the official Letterboxd API is a second watchlist source rather than the only one, and what selecting it changes
---

# DR-007 — The official API as an alternate watchlist source

**Status:** accepted, 2026-08-28

Supplements DR-002, which chose reading the site over the API and CSV export.
It does not supersede it: DR-002's reasoning stands, and reading the site
remains what this service does whenever no key is available.

## Context

DR-002 rejected the official API on availability — `GET /member/{id}/watchlist`
answers 401 without a key, and a key is granted per consumer by application to
Letterboxd, which was not something the project could assume. That constraint is
about access, not about which source is better. Where a key exists, the API
answers the exact question this service asks, and answers it far more cheaply:

| | `html` | `api` |
|---|---|---|
| Requests for a 350-film watchlist | 12 pages + 350 enrichments = 348 | 2 to resolve the member + 4 pages = 6 |
| Runtime, rating, poster, director | One request per film, from search or the film page | Already on `FilmSummary` |
| Pagination | Numbered pages against `data-num-entries`, four at a time | A sequential cursor, no reliable total |
| Egress | May need an outbound HTTP proxy | Any host |
| Failure surface | Cloudflare challenges, markup drift, silent partial pages | Documented status codes |

## Decision

Both paths exist. `WATCHLIST_SOURCE` picks one at startup, and the default is
`html`.

The default is not a preference between the two — it is that this service runs
today, unattended, with no credentials, and a release that changed which
upstream it talks to on nothing but an upgrade would be a change nobody asked
for. Selecting `api` is a deliberate act, and the configuration refuses to start
without the credentials it needs rather than serving `/health` happily and
failing every pick.

They are two builders, not one builder with a flag. The pagination models have
no useful common ancestor: one computes its page count up front and fetches four
at a time, the other can only ask for the next page by handing back the cursor
the last one gave it, and cannot know how many are left. `src/build.ts` holds
the interface `src/app.ts` consumes, `src/builder.ts` and `src/apiBuilder.ts`
each satisfy it, and `src/index.ts` wires exactly one. Nothing in the working
path changed to make room for the new one.

## Consequences

Selecting `api` changes these, and only these:

- Watchlists come from `GET /member/{id}/watchlist`, and the member is resolved
  by an exact, case-insensitive username match against `/search`. A fuzzy hit on
  a display name is not a match.
- Nothing is enriched. `FilmSummary` carries runtime, rating, poster and
  directors, so `Builder.enrich` on this path reads the `film` table the walk
  itself wrote and issues no request at all. The measured 69 ms per uncached
  film disappears, and so does the film-page fallback.
- No request is made to `letterboxd.com`, so `EGRESS_PROXY` is
  unused. An outbound proxy is a requirement of the `html`
  path only.
- `watchlist_private` becomes reachable: the API returns a documented 403 for a
  private watchlist, which is the positive signal `DESIGN.md` § Error reasons
  requires and the HTML path has never had.
- A completed walk is authoritative even where it disagrees with the member's
  own `counts.watchlist`, which counts entries the watchlist endpoint filters
  out. The HTML path's opposite rule — a page short of `data-num-entries` is
  silent loss and is discarded — stays as it is.
- Film metadata is TMDB-derived, and Letterboxd grants no redistribution rights
  to it. Anything built on this path carries the TMDB attribution.

Both paths produce the same `Film`, whose identity is `lid` and whose address is
a canonical `url`. The page slug the HTML path parses is turned into that URL
where it is read and is not carried further: the API's own `link` is
authoritative there and is not always a `/film/<slug>/` URL, so a slug is not
something both paths can produce.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Make the API the only source, deleting the HTML path | Ends the service the moment a key lapses, and throws away a working path to gain nothing the flag does not already give |
| Make the API the default when credentials happen to be present | An upgrade would silently change which upstream a running deployment talks to. Presence of a credential is not an instruction to use it |
| One builder generalised over both pagination models | The abstraction that fits both is "ask for more until there is no more", which discards the declared total the HTML path needs to detect silent loss and the cursor bookkeeping the API path needs to detect a walk that cannot finish |
| Fall back from `api` to `html` on failure | A fallback makes every failure two failures deep and doubles the surface a reader has to hold. The paths also disagree on what "complete" means, so a fallback would silently change the completeness rule mid-request |
| Fail on the first request instead of at startup | A server that answers `/health` and fails every pick is harder to diagnose than one that will not start, and the credentials are knowable at boot |
