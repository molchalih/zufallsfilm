# DR-006: the house pool ships with the service

## Status

Accepted. Supersedes nothing; it replaces an unrecorded default.

## Context

The interface offers "go completely random" to a visitor who has not named a
member. The service had no way to answer that: every read path is addressed by
a member, so the button was wired to one: Sight & Sound's watchlist, chosen
because it is public, curated and institutional rather than a private person's.

Measured 2026-09-03: that watchlist held **21 films**, all recent releases with
no canonical standing. The button therefore repeated itself within a handful of
presses and recommended nothing worth watching, and it paid for a cold build to
do it. Nothing about that is fixable by choosing a different member. A
watchlist is a record of what someone intends to watch, which is the wrong
thing to draw from when the question is "show me a good film", and it is a
third party's to empty, reorder or make private at any time.

## Decision

The house pool is not a watchlist. It is a catalogue this repository owns:
`src/house.json`, scraped by `scripts/build-house-pool.ts` and committed with
runtime, rating, poster and director already resolved. Its sources, measured
2026-09-03, are two published all-time lists, deduplicated by film identifier
to 1,208 entries from 1,500:

| List | Entries |
|---|---|
| Letterboxd Top 500, `https://letterboxd.com/official/list/letterboxds-top-500-films/` | 500 |
| They Shoot Pictures, Don't They? 1,000 Greatest Films, 21st edition, `https://letterboxd.com/tspdtfanaccount/list/the-1000-greatest-films-21st-edition-2026/` | 1000 |

`src/house.ts` wraps whichever builder `index.ts` wired and answers the
reserved name `.house` from that catalogue, delegating every other name
unchanged. Letterboxd usernames are alphanumeric with underscores, so the
leading dot cannot collide with a member.

## Consequences

- The button costs no upstream request and answers in one round trip, where
  before it paid for a cold scrape and an enrichment pass.
- It answers identically on both read paths. This is the reason the metadata is
  committed rather than resolved on demand: the API path enriches only what its
  own walk wrote, so a film it never walked would come back with every field
  null.
- The catalogue goes stale, deliberately and slowly. The canon moves in years,
  and `bun run house` rewrites the file when it does.
- It is generated, never hand-edited. A film added by hand would carry no
  guarantee that its identifier, runtime or poster are the ones the rest of the
  service would have produced.
