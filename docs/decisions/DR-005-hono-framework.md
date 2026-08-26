---
answers: why Hono as the HTTP framework rather than Elysia or Next.js
---

# DR-005 — Use Hono as the HTTP framework

**Status:** accepted, 2026-08-26

## Context

The service is an HTTP API with no user interface in this iteration. DR-004
selects Bun, whose fetch has already proven constrained in one respect
(DR-003), so the ability to change runtime without changing framework has
demonstrated value.

## Decision

Hono, running on `Bun.serve`.

## Consequences

- Runs unmodified on Node, so the DR-003 fallback is a runtime swap rather than
  a rewrite.
- This decision survives DR-004 being reversed, and vice versa.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Elysia | Marginally faster on Bun with better type inference, but Bun-only. Bun's fetch has already surprised us once on proxy support; portability is worth more than the benchmark difference |
| Next.js | Heavy for an API with no UI |
| Fastify | Node-oriented; no advantage over Hono, which runs on both |
