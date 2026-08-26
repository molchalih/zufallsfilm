---
answers: what is the backend, how are its modules bounded, and what does its API return
status: specification; implemented under src/ except watchlist_private detection
---

# Random film picker — backend design

Present tense denotes intent. Where the implementation under `src/` differs
from this document, the implementation is authoritative; see `README.md`
§ Status for what is built and what is still open.

## Scope

An HTTP API that returns a random film from a public Letterboxd watchlist,
optionally constrained by runtime.

| In scope | Out of scope (this iteration) |
|---|---|
| HTTP JSON API | Any user interface |
| Public watchlists, by username | Private watchlists; authenticated members |
| Runtime filter | Genre, decade, rating filters |
| Watchlist and film-metadata caching | Multi-user accounts, stored preferences |

## Measured constraints

Every fact this project measured, on 2026-08-26, against the live site. This is
not a complete description of Letterboxd's behaviour — it is what was probed.
Rows marked *derived* are computed from a measurement, not observed.

| Fact | Value | Sample | Consequence |
|---|---|---|---|
| Watchlist page size | 28 films; `perPage` ignored | 2 watchlists | — |
| Page count | `ceil(total / 28)` | *derived* | — |
| Watchlist total | `data-num-entries`, exact | 350 and 5269, both exact | Trust it as the integrity target |
| Item identity | `data-item-slug`, `data-item-name`, `data-postered-identifier` | 2 watchlists | `data-film-slug` no longer exists |
| Attribute encoding | HTML-escaped. `data-postered-identifier` is **single-quoted** with `&quot;`-escaped JSON. `data-item-name` embeds `(YYYY)` | 2 watchlists | Decode entities and strip the year before searching. A `="`-matching parser finds zero `lid`s |
| Poster URLs in watchlist HTML | Absent | 2 watchlists | Posters come from enrichment |
| Trailing slash | `/watchlist/page/1` (no slash) returns 403, not a redirect | — | `fetcher` must always emit the trailing slash |
| Username case | Case-insensitive; three casings return the same watchlist | 3 casings | Lowercase at the API boundary or cache 3× |
| Over-range page | HTTP 200, 0 items, `data-num-entries` still populated | 2 watchlists | 0 items is **not** proof of a markup break |
| Plain watchlist pagination | HTTP 200, ~0.31 s, 133 KB | many | Viable |
| `/watchlist/by/*`, `/watchlist/decade/*` | HTTP 403 **and** `Disallow` in robots.txt | — | Publisher directive, not just infrastructure. See DR-002 |
| `robots.txt` disallows | `/*/by/*`, `/*/decade/*`, `/*/genre/*`, `/*/country/*`, `/*/language/*` | — | Plain `/<user>/watchlist/` is **not** disallowed |
| `api.letterboxd.com/api/v0/search` | HTTP 200, no key, no signature | many | See DR-002 for why this is a risk, not a feature |
| Search result pollution | `perPage` counts non-film items: `perPage=8` → 6 films | — | **`&include=FilmSearchItem` is mandatory**, and makes the endpoint ~3× faster |
| Endpoints probed on `api.letterboxd.com` returning 401 | `/film/{id}`, `/films`, `/list`, `/lists`, `/member/{id}`, `/member/{id}/watchlist`, `/log-entries`, `/members`, `/news` | 19 probed | No watchlist route is reachable without a key |
| Origin rate limit | HTTP 403 from `nginx`, no `Retry-After`, no challenge markers, **clears on retry** | 150 req | Transient. Must not be treated as a block |
| CORS headers | None on any host probed | 3 hosts | A browser cannot call Letterboxd directly |
| Hosts the origin refuses | HTTP 403 / 520 / 522 | 3 hosts | A deployment on such a host needs an outbound HTTP proxy |
| Enrichment throughput (search, `include=FilmSearchItem`, concurrency 8) | 69 ms/film amortized | n=200 | 350 films ≈ 23 s |
| Enrichment coverage (search only) | 99.2% resolve; 0.81% yield no runtime | n=742 adversarial | Failures are punctuation and non-Latin script — **not** duplicate titles, which are 0.0% |
| Correct film's rank in search results | as low as index 7 of 8 | n=742 | `perPage=8` is at its limit, not comfortably above it |
| Film page `/film/<slug>/` | HTTP 200. JSON-LD `duration`, `image`, `genre`, `countryOfOrigin`; `production:identifier` carries `lid` | n=120 | Exact by construction — no search, no ranking, no miss |
| Film page vs search runtime agreement | 120/120 | n=120 | Drop-in fallback |
| Film page size | ~260 KB (177–333 KB) | 4 films | ~15× a search call. Fallback only |
| `/film/<slug>/json/` | 403 | — | The HTML page is the working route |

## Architecture

Five modules. The boundary that matters: **only `fetcher` performs I/O.**

| Module | Responsibility | Depends on |
|---|---|---|
| `fetcher` | URL in, body out. Owns proxy, timeouts, backoff, 403 classification | Egress config |
| `parser` | HTML in, `Film[]` out. Pure | Nothing |
| `enricher` | `Film[]` in, runtimes out. Search first, film page on miss | `fetcher` |
| `store` | Scrapes, entries, film metadata, TTL | SQLite |
| `picker` | `Film[]` + filter in, one `Film` out. Pure | Nothing |

### Build model

A cold watchlist build is **not** performed inside a request. Measured cold cost:
350 films ≈ 26 s; 5269 films ≈ 6 min. Both exceed common proxy timeouts (nginx
60 s, Cloudflare 100 s), and a timed-out build discards all its upstream work.

```
GET /pick?user=U&maxRuntime=M
  │
  ├─ store.scrape(U) complete and fresh? ──yes─→ picker.pick(...) → 200
  │
  └─ no → is a build already in flight for U?          (coalesce; see below)
           ├─ yes → join it
           └─ no  → start it
         fetch page 1 → parse → enrich 28 films → serve a pick from page 1
         continue pages 2..n in the background
```

Serving from page 1 while backfilling makes a cold request answerable in ~2 s.
A pick drawn from 28 films is still a valid random pick; the response carries
`partial: true` so a client can say so.

**Coalescing is mandatory, not an optimisation.** Concurrent cold requests for
the same user must share one build, keyed on the lowercased username. Without
it, ten requests for a 5269-film watchlist send ~52,000 upstream requests
from a single address — the outcome the ceilings and the inbound rate limit exist to avoid.

## API contract

| Route | Params | Returns |
|---|---|---|
| `GET /health` | — | `{status, egress, version}` |
| `GET /pick` | `user` (required), `maxRuntime` (optional, minutes) | One film, plus `partial` |
| `GET /watchlist/:user` | `page`, `perPage` (default 100, max 500), `refresh` | `{count, complete, scrapedAt, films[]}` |

`GET /watchlist/:user` is paginated because a watchlist may hold thousands of
films; returning a 5269-element array is not an acceptable response.

Film shape:

```json
{ "lid": "eCrQ", "slug": "kill-bill-the-whole-bloody-affair",
  "name": "Kill Bill: The Whole Bloody Affair", "year": 2004,
  "runtime": 254, "rating": 4.54,
  "url": "https://letterboxd.com/film/kill-bill-the-whole-bloody-affair/",
  "poster": "https://a.ltrbxd.com/resized/..." }
```

### Error reasons

`reason` is the machine-readable field. A new reason is a row here plus a branch
in the module that raises it.

| Reason | HTTP | Cause |
|---|---|---|
| `user_not_found` | 404 | Profile 404s |
| `watchlist_empty` | 404 | `data-num-entries` is 0 |
| `watchlist_private` | 403 | Positive private-marker in the body — never inferred from a bare 403 |
| `watchlist_too_large` | 413 | Above the configured cap |
| `no_match` | 404 | Filter excluded every film |
| `upstream_blocked` | 502 | Cloudflare challenge, confirmed by marker |
| `upstream_timeout` | 504 | Egress or total-build timeout |
| `building` | 202 | Only when page 1 itself is not yet available |

## Store

SQLite via `bun:sqlite`. Freshness is a property of a **scrape**, never of a row:
a per-row TTL cannot express deletion, so a removed film would linger inside its
own unexpired window and remain pickable.

| Table | Key | TTL | Rationale |
|---|---|---|---|
| `scrape` | `username` | 24 h | Owns `scraped_at`, `expected_count`, `actual_count`, `complete` |
| `watchlist_entry` | `(username, lid)` | none — lifetime bound to its scrape | Written only by an atomic replace |
| `film` | `lid` | 30 d | Shared across users. Not immutable: runtimes are community-editable and unreleased films carry `null` |
| `film` negative result | `lid` | 1 h | A miss is not a fact. Keyed by `last_attempt_at` |

Rules the schema exists to enforce:

- `putWatchlist` is a single transaction: delete every prior row for the user,
  insert the new set, write the `scrape` row. A partial set must never land.
- Only `complete = 1` scrapes are served.
- An enrichment **error** is never stored as an enrichment **miss**.
- `poster_url` and `rating` do change. They carry `refreshed_at` and are
  re-fetched when older than 7 days, on read. They never gate a pick.
- `film` is bounded by an LRU eviction at a configured row cap.

## Egress

`fetcher` reads its proxy from configuration and knows nothing of what is
behind it. Some hosts are refused by the origin, so an outbound HTTP proxy may
be required; Bun's fetch takes `http://` and not SOCKS, so the proxy has to
expose an HTTP inbound.

| Setting | Value |
|---|---|
| Env var | `EGRESS_PROXY` |
| Format | `http://host:port` |
| Unset | Direct connection |
| Per-request timeout | 20 s |
| Total build budget | 300 s |
| Retries | 2, exponential backoff from 250 ms |
| Concurrency, letterboxd.com | 4 |
| Concurrency, api.letterboxd.com | 8 |
| Global request ceiling | 8 req/s across all users |
| Watchlist size cap | 6000 films |

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| Cloudflare challenge | `window._cf_chl_opt` in body, or `cf-mitigated` header. **Not** a bare 403, which is the transient case below | `upstream_blocked`. Do not retry |
| Origin rate limit | 403 with an `nginx` body and no challenge marker | Retry with backoff. Transient |
| Incomplete scrape | `films.length !== data-num-entries` | Discard. Never write a partial scrape |
| Markup change | Total yield is 0 across the whole scrape while `data-num-entries > 0` | Fail loudly. Per-*page* zero is normal on over-range pages |
| Mid-scrape mutation | Duplicate `lid`, or count off by a few | Re-read page 1 for a fresh total and retry once. Not a hard error |
| Enrichment miss | No result whose `film.id` equals the `lid` | Fall back to `/film/<slug>/`. Only then store `null`, with the 1 h negative TTL |
| Proxy down | Connection refused to `EGRESS_PROXY` | `upstream_blocked`; `/health` reports egress separately from liveness |

The whole-scrape assertion replaces an earlier per-page check that was
structurally unable to detect loss: a review reproduced a **44% silent loss**
(2329 of 5269 films) in which all 189 pages returned 200 and every page parsed
28 films. Per-page checks pass in exactly that scenario.

## Operational requirements

| Requirement | Reason |
|---|---|
| Rate limit on **our** API, per inbound IP and per distinct username per window | Without it the service is an unauthenticated amplifier. Cold cost is `ceil(N/28)` page fetches plus one search per film absent from the global `film` cache: 348 upstream requests for a 350-film watchlist, 5,458 for a 5,269-film one. The global cache collapses the enrichment term at steady state, but **distinct usernames defeat both the cache and the coalescer**, and pagination alone is unavoidable per username |
| Structured logs and metrics: parse yield, enrichment miss rate, 403 rate by class, scrape completeness | The 44% loss above would be invisible in production without them |
| `film` row cap with LRU eviction | The table otherwise grows monotonically forever |
| Global request ceiling toward Letterboxd | Politeness, and self-preservation of the exit IP |

## Testing

| Layer | Method | Network |
|---|---|---|
| `parser` | Fixtures: normal page, over-range page, 0-entry watchlist, challenge page, entity-heavy titles, single-quoted identifier | None |
| `picker` | Property test: result is drawn from the input and satisfies the filter | None |
| `store` | In-memory SQLite: TTL boundaries, atomic replace, removed-film deletion | None |
| `enricher` | Stubbed `fetcher`: search hit, search miss into film-page fallback, error-not-miss | None |
| `fetcher` | Local stub HTTP proxy asserting `CONNECT` was received; 403 classification | Loopback |
| End-to-end | One live smoke test, opt-in by env var | Live |

Only the last needs working egress, so a broken proxy cannot block the suite.

## Extension points

| A new fact of this kind | Goes here |
|---|---|
| A new filter (genre, decade, country) | A `picker` filter field, a `film` column, a row in § Store. Source it from the **film page** — robots.txt disallows the corresponding Letterboxd filter URLs |
| A new data source | A function in `fetcher`. Nothing else may perform I/O |
| A new error reason | A row in § Error reasons plus the raising branch |
| A new cache table or TTL | A row in § Store, with its rationale |
| A new egress setting | A row in § Egress |
| A new failure mode | A row in § Failure modes, with its detection predicate |
| A new module | A row in § Architecture, stating what it depends on |
| A new architectural decision | `docs/decisions/DR-<next>-<slug>.md` |
| A measured fact about Letterboxd | A row in § Measured constraints, with sample size and date |
| A measured fact about a third-party service | The same table, named as third-party |
