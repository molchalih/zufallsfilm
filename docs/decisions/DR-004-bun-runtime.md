---
answers: why does this service run on Bun rather than Node or an edge runtime
---

# DR-004 — Run on Bun

**Status:** accepted, 2026-08-26

## Context

A long-running API on self-managed infrastructure, needing an HTTP server,
SQLite, and a proxy-aware fetch.

| Runtime | Fit |
|---|---|
| Bun | SQLite and a test runner built in |
| Node | Viable; mature SOCKS5 ecosystem |
| Cloudflare Workers | Cannot open an outbound proxy connection, which DR-001 requires |

| Setting | Value |
|---|---|
| Version | Bun 1.3.14 |

## Decision

Bun as the runtime, with `bun:sqlite` for the store.

## Consequences

- `bun:sqlite` and the test runner are built in, so the dependency tree stays small.
- Bun's fetch constrains the proxy protocol to HTTP. See DR-003.
- Reversing this decision is possible without reversing DR-005.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Node | Viable, and the fallback if Bun's proxy support proves limiting. Bun preferred for built-in SQLite and test runner |
| Cloudflare Workers | Cannot perform proxied outbound requests |
| Deno | No advantage here over Bun; smaller SQLite story |
