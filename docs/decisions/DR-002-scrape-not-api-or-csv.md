---
answers: why does this service scrape watchlist pages instead of using the official API or CSV exports
---

# DR-002 — Obtain watchlists by scraping, not via the API or CSV export

**Status:** accepted, 2026-08-26

## Context

Three ways exist to learn what is on a member's watchlist.

| Source | State |
|---|---|
| Official API | Every watchlist route returns 401. `/member/{lid}/watchlist` returns 401 rather than 404, so the capability is real and gated. Access is by application to `api@letterboxd.com`, with no guaranteed reply |
| CSV export | Complete and reliable, but the member must export a ZIP and upload it |
| Public watchlist HTML | HTTP 200; needs only a username |

The product requires that a visitor supply only a username. CSV upload
contradicts that; the API cannot satisfy it without a key we do not have.

What `robots.txt` actually says, since it bears on this decision:

| Path | Directive |
|---|---|
| `/<user>/watchlist/` | **Not** disallowed |
| `/*/by/*`, `/*/decade/*`, `/*/genre/*`, `/*/country/*`, `/*/language/*` | `Disallow` for `User-agent: *` |

## Decision

Scrape the plain paginated watchlist, which robots.txt does not disallow.
Do not fetch the disallowed sort and filter paths. Enrich film metadata from
`api.letterboxd.com/api/v0/search`, falling back to the film page.

## Consequences

- Works only for publicly visible watchlists. Private profiles are a named
  error, not a failure.
- The parser depends on markup that changes without notice. DESIGN.md mandates
  a whole-scrape integrity assertion so a break fails loudly.
- Filtering happens in this process. Not because Letterboxd's filter URLs are
  blocked, but because they are disallowed — the 403 and the directive agree,
  and the directive is the reason that governs.
- Every future filter (genre, country, language) must be sourced from the film
  page for the same reason.
- **The search endpoint is a risk, not a feature.** This record establishes
  that Letterboxd deliberately gates its API; the same wall has an unlocked
  side door. `api.letterboxd.com/robots.txt` returns 403, the endpoint is the
  website's own internal search, and its origin actively rate-limits it. It may
  be authenticated or removed without notice, and the enrichment path dies with
  it. The film-page fallback is what keeps that from being fatal.
- If an API key is granted later, `fetcher` is the only module that changes.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Apply for an API key and wait | No guaranteed reply. Worth doing in parallel; cannot be a dependency |
| CSV upload | Contradicts the username-only requirement. Remains the natural fallback for private profiles |
| RSS feed | Diary entries only, not the watchlist. `/watchlist/rss/` returns 403 |
