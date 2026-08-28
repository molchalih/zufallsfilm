# letterboxd-picker

An HTTP API that returns a random film from a public Letterboxd watchlist,
optionally filtered by runtime.

A cold watchlist never blocks a request: page one is served immediately and the
remainder backfills in the background, with concurrent builds for the same user
coalesced onto a single read.

## Where watchlists come from

Two read paths, chosen by `WATCHLIST_SOURCE` and wired once at startup.

| Value | Path | Needs |
|---|---|---|
| `html` (default) | Fetches the member's public watchlist pages and enriches each film for runtime, rating, poster and director | An outbound HTTP proxy where the origin refuses the deployment host |
| `api` | Reads `GET /member/{id}/watchlist` from the official API, where each film already carries all four | `LETTERBOXD_API_KEY` and `LETTERBOXD_API_SECRET` |

The default is the site: this service works today without any new environment,
and nothing about that changes until the variable is set. Selecting `api`
without credentials refuses to start rather than failing on the first request.
See `docs/decisions/DR-007-official-api-as-an-alternate-source.md`.

## Requirements

Bun 1.3.14. On the default path Letterboxd's origin refuses some hosts, so anything
but local development needs an outbound HTTP proxy — see
`docs/DESIGN.md`. The API path issues no request to
`letterboxd.com` and needs no exit.

## Running

```bash
bun install
bun run src/index.ts          # direct egress, for development
```

In a container:

```bash
cp .env.example .env
docker compose up -d --build
```

The proxy's own configuration is deployment-specific and is not in this
repository.

## API

| Route | Params | Returns |
|---|---|---|
| `GET /health` | — | `{status, egress, inFlight}` |
| `GET /progress/:user` | — | `{done, total}` for a read in flight |
| `GET /pick` | `user` (required), `maxRuntime` (optional, minutes) | One film, plus `partial` and `pool` |
| `GET /watchlist/:user` | `page`, `perPage` (default 100, max 500) | `{count, complete, partial, films[]}` |
| `GET /metrics` | — | Counters and observations |

```bash
curl "http://localhost:3000/pick?user=examplemember&maxRuntime=100"
```

Error responses carry a machine-readable `reason`; the full table is in
`docs/DESIGN.md` § Error reasons.

## Development

```bash
bun run check      # typecheck, lint, bundle, tests
bun test           # the whole suite, no network required
LIVE=1 bun test    # adds the opt-in live smoke test
```

`bun run check` is enforced by a pre-commit hook (`git config core.hooksPath .githooks`)
and by CI. Only `tests/live.test.ts` touches the network, and it skips unless
`LIVE=1` is set.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `DB_PATH` | `data/picker.sqlite` | SQLite file |
| `WATCHLIST_SOURCE` | `html` | `html` or `api`. See § Where watchlists come from |
| `EGRESS_PROXY` | unset | `http://host:port`. SOCKS is not supported. `html` path only |
| `LETTERBOXD_API_KEY` | unset | Required by `WATCHLIST_SOURCE=api`. Issued by Letterboxd with API access |
| `LETTERBOXD_API_SECRET` | unset | Required by `WATCHLIST_SOURCE=api` |
| `LETTERBOXD_API_BASE` | `https://api.letterboxd.com/api/v0` | Override, for testing |
| `API_REQ_PER_SEC` | `8` | Outbound request ceiling, `api` path |
| `TRUST_PROXY` | `false` | Read the caller's address from `X-Forwarded-For`. See § Inbound addresses |
| `MAX_WATCHLIST` | `6000` | Refuse watchlists above this size |
| `REQUEST_TIMEOUT_MS` | `20000` | Per-request timeout |
| `BUILD_BUDGET_MS` | `300000` | Total build budget |
| `RATE_PER_MIN` / `RATE_BURST` | `20` / `10` | Inbound limit per IP |
| `DISTINCT_USERS_PER_WINDOW` | `15` | Distinct usernames per IP per minute |
| `GLOBAL_REQ_PER_SEC` | `8` | Outbound request ceiling, `html` path |
| `FILM_CAP` | `200000` | Row cap before LRU eviction |

## Inbound addresses

The inbound rate limiter meters by caller address, and what that address is
depends on what sits in front of the service.

| Deployment | `TRUST_PROXY` | Address used |
|---|---|---|
| Exposed directly | `false` (default) | The connecting peer |
| Behind a reverse proxy you control | `true` | The first entry of `X-Forwarded-For`, falling back to the peer |

It is off by default because `X-Forwarded-For` is a request header like any
other: with nothing in front of the service, trusting it lets a caller mint a
fresh bucket per request by varying it, which is the whole limiter gone. Turn it
on only where a proxy you control sets the header, since a proxy that appends to
a client-supplied value is no safer than trusting the client.

## Documentation

`docs/README.md` routes to the rest and records what is built and what is open.
`CONTRIBUTING.md` covers branching, commit style and the merge policy.
