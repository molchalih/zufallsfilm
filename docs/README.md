---
answers: where does each kind of fact about this project live
---

# Documentation router

Authority order: **live system > code > docs.** If this repo disagrees with a
running service, the service is right and the document is a defect.

No implementation exists yet. `DESIGN.md` is a specification, not a description.

## Ownership table

| Kind of fact | Lives in | Extension rule |
|---|---|---|
| What we are building, module boundaries, API contract, store schema | `DESIGN.md` | Amend in place. Never append a contradicting note |
| Why an architectural choice was made | `decisions/DR-<n>-<slug>.md` | A new decision is a new file with the next number. Supersede, never rewrite |
| Measured facts about Letterboxd's surface | `DESIGN.md` § Measured constraints | Replace the row; carry sample size and date |
| The outbound proxy for the `html` path | `../README.md` § Configuration, as the `EGRESS_PROXY` setting | One setting, and no more. Never restate deployment topology in a document |

`DESIGN.md` § Extension points covers the classes it owns; this table covers the rest.

## Invariants

| Rule | Rationale, and the outcome that produced it |
|---|---|
| Every number lives in a table cell or labelled field, never in a sentence | Numbers in prose are lost during summarization. A prose `43 ms/film` in an earlier draft survived review as an unlabelled figure that was ambiguous between latency and throughput by a factor of 8 |
| Every measured claim carries its sample size and date | An earlier draft claimed a 100% enrichment match rate from `n=14`. At `n=742` the true figure was 99.2%, and the failures were a category the small sample could not contain |
| "Verified" means measured, with the command and value stated | An earlier draft asserted three modules were "verified" as testable without a network. None of the three existed |
| The fetch layer is the only module that performs I/O | Keeps parser, picker and store testable without a proxy or a live site. Not yet verified — nothing is built |
