# letterboxd-picker

An HTTP API that returns a random film from a public Letterboxd watchlist,
optionally filtered by runtime.

A cold watchlist never blocks a request: page one is served immediately and the
remainder backfills in the background, with concurrent builds for the same user
coalesced onto a single read.

## Where watchlists come from

Two read paths, wired once at startup. Credentials choose between them: with a
key the official API is used, without one the site is read.

| Value | Path | Needs |
|---|---|---|
| `html` | Fetches the member's public watchlist pages and enriches each film for runtime, rating, poster and director | An outbound HTTP proxy where the origin refuses the deployment host |
| `api` | Reads `GET /member/{id}/watchlist` from the official API, where each film already carries all four | `LETTERBOXD_API_KEY` and `LETTERBOXD_API_SECRET` |

The API is the source this service prefers; reading the site is what it falls
back to while no key exists. Supply both credentials and the API is used with no
further configuration; supply neither and the site path runs exactly as it
always has. `WATCHLIST_SOURCE` overrides the choice in either direction, and
without credentials refuses to start rather than failing on the first request.
See `docs/decisions/DR-005-official-api-as-an-alternate-source.md`.

## Requirements

Bun 1.3.14. On the `html` path Letterboxd's origin refuses requests from some
hosts, answering 403, 520 or 522 rather than the page; a deployment on one of
them needs `EGRESS_PROXY` pointed at an outbound HTTP proxy on a host it does
not refuse. The `api` path issues no request to `letterboxd.com` and needs no
proxy.

## Running

```bash
bun install
bun run src/index.ts          # direct egress
```

In a container:

```bash
cp .env.example .env
docker compose up -d --build
```

## API

| Route | Params | Returns |
|---|---|---|
| `GET /health` | — | `{status, version, egress, inFlight}` |
| `GET /progress/:user` | — | `{done, total}` for a read in flight |
| `GET /pick` | `user` (required), `maxRuntime` (optional, minutes) | One film, plus `partial` and `pool` |
| `GET /watchlist/:user` | `page`, `perPage` (default 100, max 100) | `{count, complete, partial, films[]}` |
| `GET /metrics` | — | Counters and observations |
| `GET /og-red.png` | — | The 1200x630 link preview card |
| `GET /robots.txt` | — | Crawl rules. See § Security headers |

```bash
curl "http://localhost:3000/pick?user=examplemember&maxRuntime=100"
```

Error responses carry a machine-readable `reason`; the full table is in
`docs/DESIGN.md` § Error reasons.

## Development

```bash
bun run check      # typecheck, lint, bundle, tests
bun test           # the whole suite, no network required
LIVE=1 LIVE_MEMBER=<username> bun test   # adds the opt-in live smoke test
```

`bun run check` is enforced by a pre-commit hook (`git config core.hooksPath .githooks`)
and by CI. Only `tests/live.test.ts` touches the network, and it skips unless
`LIVE=1` is set.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `APP_VERSION` | the commit, baked at build | Stamp reported by `/health`. CI passes `github.sha` as a build argument; setting it at runtime overrides that |
| `DB_PATH` | `data/picker.sqlite` | SQLite file |
| `WATCHLIST_SOURCE` | credentials decide | `html` or `api`, overriding the automatic choice. See § Where watchlists come from |
| `EGRESS_PROXY` | unset | Outbound HTTP proxy, `http://host:port`. SOCKS is not supported. `html` path only |
| `LETTERBOXD_API_KEY` | unset | Issued by Letterboxd with API access. Set with the secret, it selects the API path |
| `LETTERBOXD_API_SECRET` | unset | The other half of the pair; one alone selects nothing |
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

## Security headers

Two things serve this site, and only one of them is Hono. `Bun.serve` routes
`GET /` straight to the bundle, so it never passes through middleware: the
headers below are set on the API, the error document and the preview card, and
**not** on the interface itself.

| Header | Set by |
|---|---|
| `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` | The service, on every route Hono answers |
| The same headers on `GET /` | Whatever terminates TLS. Nothing in this repository sets them |

`Cross-Origin-Resource-Policy` is deliberately unset. Hono defaults it to
`same-origin`, and a messenger rendering the preview card loads `/og-red.png` from
its own client — cross-origin, by definition.

A policy for the document has to allow what the interface actually loads: its
own bundle, posters from `a.ltrbxd.com`, the inline `data:` favicon, and inline
styles, which React writes as attributes.

```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://a.ltrbxd.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Content-Type-Options "nosniff" always;
```

`bun run dev` serves an inline script for hot reload, which `script-src 'self'`
blocks. That is a property of the dev server, not of the deployed container:
`development` is off unless `NODE_ENV=development`, and the production bundle
links its script rather than inlining it.

`robots.txt` disallows `/pick`, `/watchlist/`, `/progress/`, `/health` and
`/metrics`, and nothing else. Each of the first three names a member and reaches
Letterboxd on a cache miss, so an indexed URL under them converts a crawler's
budget into outbound scrape volume — all of it queued behind the one global
gate `GLOBAL_REQ_PER_SEC` sets. The interface and the card stay crawlable,
because a shared link is supposed to resolve to them.

## Documentation

`docs/README.md` routes to the rest and records what is built and what is open.
`CONTRIBUTING.md` covers branching, commit style, the merge policy, and **§Release** — how a push to
`main` builds, signs and ships this service, and why the workflow's filename is load-bearing.
