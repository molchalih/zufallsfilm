# AGENTS.md

A map of this repository for an agent working in it.

## What this is

A service that returns a random film from a public Letterboxd watchlist,
optionally one that fits a given runtime. A React interface is bundled and
served from the same process.

It reads watchlists two ways, and a running process holds exactly one of them:

| Source | How | Selected when |
|---|---|---|
| `html` | Fetches the member's public watchlist pages and enriches each film for runtime, rating, poster and director | No API credentials are set |
| `api` | Reads `GET /member/{id}/watchlist` from the official Letterboxd API, where every field already arrives on the film | `LETTERBOXD_API_KEY` and `LETTERBOXD_API_SECRET` are both set |

`WATCHLIST_SOURCE` overrides the choice in either direction, and refuses to
start rather than failing on the first request. See
`docs/decisions/DR-005-official-api-as-an-alternate-source.md`.

## Commands

| Command | What it does |
|---|---|
| `bun install` | Dependencies |
| `bun run check` | Typecheck, lint, production bundle, tests. The gate |
| `bun test` | The suite, offline, in well under a second |
| `LIVE=1 LIVE_MEMBER=<username> bun test` | Adds `tests/live.test.ts`, the only networked test |
| `bun run src/index.ts` | Serves the API and the interface on `PORT` (default 3000) |

`bun run check` is enforced by `.githooks/pre-commit` (activate once per clone
with `git config core.hooksPath .githooks`) and by `.github/workflows/ci.yml`.
Do not skip it with `--no-verify`.

## Where things live

| Path | Owns |
|---|---|
| `src/config.ts` | Environment-derived configuration, read and frozen once at startup, including `EGRESS_PROXY` and the source selection |
| `src/build.ts` | The `Builder` interface `src/app.ts` consumes, `BuildError`, and the set of reasons |
| `src/fetcher.ts` | `html` path. The only module there that calls `fetch`: the outbound proxy, timeouts, backoff, the shared request gate, 403 classification |
| `src/parser.ts` | `html` path. Watchlist HTML in, `Film[]` out. Pure |
| `src/enricher.ts` | `html` path. Runtime, rating, poster and director per film: search first, the film page on a miss |
| `src/builder.ts` | `html` path. Numbered pages against the declared total, the whole-scrape integrity check, coalescing, enrichment scoped by its caller |
| `src/client.ts` | `api` path. The only module there that calls `fetch`: OAuth2 client-credentials tokens, signed GETs, the outbound rate gate, retries |
| `src/letterboxd.ts` | `api` path. The endpoints this service reads, mapped onto its own `Film`. Pure over `client` |
| `src/apiBuilder.ts` | `api` path. The cursor walk, page one served immediately, the rest backfilled |
| `src/store.ts` | `bun:sqlite` persistence — three tables, ordered append-only migrations, TTLs |
| `src/picker.ts` | The draw, and the `maxRuntime` filter |
| `src/ratelimit.ts` | Inbound metering per client address: a token bucket, plus a distinct-username cap |
| `src/metrics.ts` | In-process counters and observations, served by `GET /metrics` |
| `src/types.ts` | The shapes shared across the modules above |
| `src/app.ts` | Hono routes, request logging, and the `STATUS` map of `reason` to HTTP status |
| `src/index.ts` | Wiring — it picks the builder — signal handling, the Bun server export |
| `src/web/` | The interface: `App.tsx`, `screens/`, `anim/`, `spin.ts` for the frame maths, `copy.ts` for every user-visible failure string, `api.ts`, `posters.ts`, `errorPage.ts` |
| `index.html` | The bundle entry `Bun.serve` imports. It sits at the root because Bun derives asset paths from the entry document's depth |
| `tests/` | One file per module. `tests/fixtures/` is hand-authored; `tests/live.test.ts` is the only networked test |
| `docs/DESIGN.md` | The specification: scope, measured constraints, module boundaries, build model, API contract, error reasons, store schema, egress, failure modes |
| `docs/decisions/` | Numbered decision records — why each architectural choice was made |
| `docs/README.md` | Which file owns which kind of fact, plus what is built and what is open |
| `CONTRIBUTING.md` | Branching, commit style, the gate, test rules |

## Authority

**Live system > code > docs.** A running service outranks this repository; the
code outranks any document describing it. A document that disagrees with the
code is a defect in the document — fix it in place rather than working around
it, and never leave a document asserting something the code does not do.

## Conventions

- A file in `src/` opens with a one-to-three-line header saying what it owns.
  Files under `tests/` are exempt.
- Every exported function in `src/` carries a one-line description of its
  contract.
- Inline comments only where a line is genuinely not obvious. This repository is
  deliberately sparse; a comment that restates the code does not belong.
- A number that encodes a decision gets a name, not a literal in a branch.
- Commit subjects are `type(scope): description` — lowercase, imperative, no
  trailing period, under 72 characters. The body stays empty, and no trailer or
  footer repeats the subject. The full rule and the type list are
  in `CONTRIBUTING.md`.
- A behaviour change arrives with the test that would have caught its absence.

## Hard constraints

- All I/O lives in the fetch layer — `src/fetcher.ts` on the `html` path,
  `src/client.ts` on the `api` path. Every other module stays testable without a
  network, and no caller reaches past `src/letterboxd.ts` for `client.get`.
- A route reaches a watchlist only through `build.Builder`, never through
  `builder` or `apiBuilder` directly. The two are not generalised over each
  other, and a second source is a third builder, never a flag inside one of
  these.
- On the `html` path, fetch only what `robots.txt` allows: the plain paginated
  watchlist and the film page. The sort and filter URLs under `/by/`,
  `/decade/`, `/genre/`, `/country/` and `/language/` are disallowed and
  `src/fetcher.ts` refuses them.
- A scrape that parses fewer films than `data-num-entries` is silent loss and is
  discarded, never written. See `docs/DESIGN.md` § Failure modes.
- No test may touch the network except `tests/live.test.ts`, which is gated on
  `LIVE=1` and skips without it.
- Fixtures are hand-authored, never captured from a live response. An HTML
  fixture carries only the attributes `src/parser.ts` reads.
- A new error `reason` goes into `STATUS` in `src/app.ts` first, then
  `src/web/copy.ts`, then the table in `docs/DESIGN.md` § Error reasons.
- No real account, member identifier or watchlist size belongs in this
  repository. Tests and examples use `examplemember`.
