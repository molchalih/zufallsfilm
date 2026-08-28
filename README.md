# letterboxd-picker

An HTTP API that returns a random film from a public Letterboxd watchlist,
optionally filtered by runtime.

A cold watchlist never blocks a request: page one is served immediately and the
remainder backfills in the background, with concurrent builds for the same user
coalesced onto a single scrape.

## Requirements

Bun 1.3.14. Letterboxd's origin refuses some hosts, so anything but local development
needs an outbound HTTP proxy — see `docs/DESIGN.md`.

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
bun test           # 80 tests, no network required
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
| `EGRESS_PROXY` | unset | `http://host:port`. SOCKS is not supported |
| `MAX_WATCHLIST` | `6000` | Refuse watchlists above this size |
| `REQUEST_TIMEOUT_MS` | `20000` | Per-request timeout |
| `BUILD_BUDGET_MS` | `300000` | Total build budget |
| `TRUST_PROXY` | `false` | Read the caller's address from `X-Forwarded-For`. See § Inbound addresses |
| `RATE_PER_MIN` / `RATE_BURST` | `20` / `10` | Inbound limit per IP |
| `DISTINCT_USERS_PER_WINDOW` | `15` | Distinct usernames per IP per minute |
| `GLOBAL_REQ_PER_SEC` | `8` | Shared ceiling toward Letterboxd |
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
