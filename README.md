<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img src="docs/assets/banner-light.svg" alt="zufallsfilm" width="560">
  </picture>
</p>

Pick a film from a public Letterboxd watchlist, at random, optionally capped by
runtime. Live at **[zufalls.film](https://zufalls.film)**.

Given a username, it draws from that member's public watchlist. Given none, it
draws from the house pool: 1,208 films merged from the [Letterboxd Top 500][1]
and from [They Shoot Pictures, Don't They? 1,000 Greatest Films (21st
edition)][2], shipped with the service.

The first page of a watchlist is served as soon as it is read. The rest
backfills in the background, and two requests for the same member share a
single build.

## API

| Route | Params | Returns |
|---|---|---|
| `GET /pick` | `user` (required), `maxRuntime` (minutes) | One film, plus `partial` and `pool` |
| `GET /watchlist/:user` | `page`, `perPage` (default and max 100) | `{count, complete, partial, films[]}` |
| `GET /progress/:user` | none | `{done, total}` for a read in flight |
| `GET /health` | none | `{status, version, egress, inFlight}` |
| `GET /metrics` | none | Counters and observations |

```bash
curl "https://zufalls.film/pick?user=examplemember&maxRuntime=100"
```

## Self-hosting

Needs Bun 1.3.14.

```bash
bun install
bun run src/index.ts
```

Or in a container:

```bash
cp .env.example .env
docker compose up -d --build
```

**Watchlists come from one of two places**, wired once at startup and chosen by
whether credentials exist. With `LETTERBOXD_API_KEY` and
`LETTERBOXD_API_SECRET` the official API is used; without them the public site
is read and each film is enriched from its own page. `WATCHLIST_SOURCE`
overrides the choice. See
`docs/decisions/DR-005-official-api-as-an-alternate-source.md`.

**On the site path some hosts are refused** by Letterboxd's origin, which
answers 403, 520 or 522 rather than the page. Such a deployment needs
`EGRESS_PROXY` pointed at an outbound HTTP proxy on a host that is not refused.
The API path issues no request to `letterboxd.com` and needs no proxy.

**`GET /` is served by `Bun.serve`, not by Hono**, so it never passes through
the middleware that sets the security headers. Whatever terminates TLS has to
set a policy for the document itself; the API, the error page and the preview
card carry their own.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `APP_VERSION` | the commit, baked at build | Stamp reported by `/health` |
| `DB_PATH` | `data/picker.sqlite` | SQLite file |
| `WATCHLIST_SOURCE` | credentials decide | `html` or `api` |
| `EGRESS_PROXY` | unset | Outbound HTTP proxy, `http://host:port`. No SOCKS. `html` only |
| `LETTERBOXD_API_KEY` / `LETTERBOXD_API_SECRET` | unset | Both together select the `api` path; one alone selects nothing |
| `LETTERBOXD_API_BASE` | the official API | Override, for testing |
| `TRUST_PROXY` | `false` | Read the caller's address from `X-Forwarded-For`. Only turn this on behind a proxy you control, or the rate limiter can be bypassed by varying the header |
| `MAX_WATCHLIST` | `6000` | Refuse watchlists above this size |
| `REQUEST_TIMEOUT_MS` | `20000` | Per-request timeout |
| `BUILD_BUDGET_MS` | `300000` | Total build budget |
| `RATE_PER_MIN` / `RATE_BURST` | `20` / `10` | Inbound limit per IP |
| `DISTINCT_USERS_PER_WINDOW` | `15` | Distinct usernames per IP per minute |
| `GLOBAL_REQ_PER_SEC` | `8` | Outbound ceiling, `html` path |
| `API_REQ_PER_SEC` | `8` | Outbound ceiling, `api` path |
| `FILM_CAP` | `200000` | Row cap before LRU eviction |

## Developing

```bash
bun run dev        # hot reload on :3000
bun run check      # typecheck, lint, bundle, tests: the whole gate
bun test           # tests only, no network required
LIVE=1 LIVE_MEMBER=<username> bun test   # adds the opt-in live smoke test
```

`bun run check` is enforced by a pre-commit hook and by CI. Activate the hook
once per clone with `git config core.hooksPath .githooks`.

Regenerate the house pool with `bun run house`, which rescrapes the two source
lists into `src/house.json`.

## Documentation

`docs/README.md` routes to the rest and records what is built and what is open.
`CONTRIBUTING.md` covers branching, commit style, the merge policy, and how a
push to `main` builds, signs and ships this service.

[1]: https://letterboxd.com/official/list/letterboxds-top-500-films/
[2]: https://letterboxd.com/tspdtfanaccount/list/the-1000-greatest-films-21st-edition-2026/
