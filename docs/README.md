---
answers: where does each kind of fact about this project live
---

# Documentation router

Authority order: **live system > code > docs.** If this repo disagrees with a
running service, the service is right and the document is a defect.

`DESIGN.md` is a specification, not a description: it states intent, and the
implementation is the authority on behaviour.

## Status

| Area | State |
|---|---|
| `parser`, `picker`, `store`, `fetcher`, `enricher`, `builder`, `app` | Built, under `src/` |
| `client`, `letterboxd`, `apiBuilder`: the official-API read path | Built, under `src/`. Selected automatically when both credentials are present; `WATCHLIST_SOURCE` overrides. See DR-007 |
| Cold-build model: page 1 served, remainder backfilled, builds coalesced | Built, on both paths |
| Interface: idle, five reveal animations, result, error | Built, under `src/web/`. See DR-006 |
| Runtime filter in the interface | **Not built, and not planned.** The design has no control for it; `maxRuntime` stays an API parameter. See `DESIGN.md` § Scope |
| Outbound proxy for the `html` path | Optional, one setting: `EGRESS_PROXY` |
| `watchlist_private` detection on the `html` path | **Open.** Mapped to 403 in `src/app.ts` and raised by `apiBuilder` from the API's documented 403, but no HTML code path raises it: the private-page marker has not been measured, and `DESIGN.md` forbids inferring privacy from a bare 403. Needs a captured private-watchlist fixture before implementation |

## Ownership table

| Kind of fact | Lives in | Extension rule |
|---|---|---|
| What we are building, module boundaries, API contract, store schema | `DESIGN.md` | Amend in place. Never append a contradicting note |
| A user-visible failure string | `src/web/copy.ts` | One row per API `reason`. Never inline in a component or a document |
| Why an architectural choice was made | `decisions/DR-<n>-<slug>.md` | A new decision is a new file with the next number. Supersede, never rewrite |
| Measured facts about Letterboxd's surface | `DESIGN.md` § Measured constraints | Replace the row; carry sample size and date |
| How work is branched, committed and merged | `../CONTRIBUTING.md` | Amend in place. The remote's merge settings are the enforcement; the document states the rule and its rationale |
| The outbound proxy for the `html` path | `../README.md` § Configuration, as the `EGRESS_PROXY` setting | One setting, and no more. Never restate deployment topology in a document |
| Which watchlist source is used, and what selecting it changes | `decisions/DR-007-official-api-as-an-alternate-source.md`; the variable itself in `../README.md` § Where watchlists come from | A third source is a new decision record and a new `WATCHLIST_SOURCE` value, never a flag inside an existing builder |

`DESIGN.md` § Extension points covers the classes it owns; this table covers the rest.

## Invariants

| Rule | Rationale, and the outcome that produced it |
|---|---|
| Every number lives in a table cell or labelled field, never in a sentence | Numbers in prose are lost during summarization. A prose `43 ms/film` in an earlier draft survived review as an unlabelled figure that was ambiguous between latency and throughput by a factor of 8 |
| Every measured claim carries its sample size and date | An earlier draft claimed a 100% enrichment match rate from `n=14`. At `n=742` the true figure was 99.2%, and the failures were a category the small sample could not contain |
| "Verified" means measured, with the command and value stated | An earlier draft asserted three modules were "verified" as testable without a network. None of the three existed |
| The fetch layer is the only module that performs I/O — `fetcher` on the `html` path, `client` on the `api` path | Keeps parser, picker, store, `letterboxd` and both builders testable without a proxy, a live site or credentials. Verified: `bun test` runs the whole suite with no network; the only networked test, `tests/live.test.ts`, is opt-in behind `LIVE=1` and skips by default |
| A second watchlist source is a second builder behind the same interface, never a branch inside the first | The two pagination models share no useful abstraction, and the path that works today must not change to make room for one that is off by default. See DR-007 |
| An animation is a pure function from progress to styles; the component only draws it | Frame logic that lives inside a component can only be tested through a DOM, and the interface's whole substance is its frames. Verified: `tests/web-anim.test.ts` asserts on frames directly, with no DOM |
| The interface holds no capability the API does not expose | The pick is drawn by `picker` on the server. The films flickering past a spin are decor; the film that lands is the server's. See DR-006 |
