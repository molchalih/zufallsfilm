---
answers: why Prometheus metrics live on a separate internal listener bound 0.0.0.0, not on the public app
---

# DR-005 — Prometheus metrics on a separate internal listener

**Status:** accepted, 2026-11-09

## Context

The service needs to be monitored by the deployment's Prometheus. It previously
exposed a JSON counter snapshot at `GET /metrics` on the public app port
(3000), `Disallow`ed in `robots.txt`. A `Disallow` is not an access control:
the endpoint still leaked internal counts — cache sizes, user totals, error
rates — to anyone who requested it. The deployment reaches workloads over an
mTLS metrics sidecar (`ghostunnel`) that runs as a **separate container** on a
private, per-uid Podman network; only the sidecar's mTLS port is ever published
off the host.

## Decision

Serve Prometheus text exposition from a **second `Bun.serve` listener**
dedicated to metrics, on `METRICS_PORT` (default `9091`), and **remove** the
public JSON `/metrics` from the Hono app. The listener answers only
`GET /metrics`; everything else is a 404.

Bind it to **`0.0.0.0`, not `127.0.0.1`.** The sidecar scrapes it from a
different container and reaches it over the container network, where the app
container's loopback is unreachable. Non-exposure is provided by the
deployment, not the bind address: the metrics port is never `PublishPort`'d to
the host or the VLAN, and the per-uid network is private to the workload, so
inside the container `0.0.0.0:9091` is reachable only by the sidecar.

Use `prom-client`, one isolated `Registry` per `createMetrics()` instance
(never the library's process-global default), so the app can be constructed
repeatedly — every test builds its own set — without double-registration or
cross-test bleed.

## Consequences

- No metrics ride the public route. The public surface is `pick`, `watchlist`,
  `progress`, `health`, the preview card and `robots.txt` — nothing else.
- The safety of the `0.0.0.0` bind is **load-bearing on the deployment**: if the
  metrics port were ever published, or the workload moved onto a shared network,
  the endpoint would be exposed. The non-publish is asserted in the `Dockerfile`
  comment and `.env.example`; the infra side owns `PublishPort`, the `ufw`
  rules, and the mTLS hop.
- A future reader must not "harden" the bind to `127.0.0.1`: that silently
  breaks the sidecar's scrape, because the two live in different containers.
- `items_cached` and `users` are read from SQLite on each scrape, so they are
  live table counts, not values a writer must remember to refresh.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Keep `/metrics` on the public app (3000), `Disallow`ed | A `Disallow` is advisory; the data was still served to any caller. This is exactly the exposure being closed |
| Bind the metrics listener to `127.0.0.1` | Unreachable from the sidecar container, which scrapes over the container network, not loopback |
| Hand-roll the Prometheus text from the existing counter map | Error-prone escaping, histogram buckets and `# TYPE`/`# HELP` lines; `prom-client` is the de-facto standard and gives Node process metrics for free |
| One shared global registry | `prom-client`'s default register is process-global; constructing the app more than once (every test) would throw on re-registration and share state across cases |
