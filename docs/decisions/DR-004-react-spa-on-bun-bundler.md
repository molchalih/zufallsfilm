---
answers: why the interface is a React SPA served by Bun's own bundler, and why the pick still happens on the server
---

# DR-004 — Serve the interface as a React SPA from Bun's bundler

**Status:** accepted, 2026-08-27

## Context

DR-003 chose Hono for an API with no user interface, and `DESIGN.md` § Scope
put "any user interface" out of scope for that iteration. There is now a
design: an idle field, five reveal animations, a result, and an error page.

The animations are the constraint, not the layout. Four of the five compute
per-frame styles for between eighty and a hundred and twelve elements at
display refresh rate, driven by one progress value. That is a rendering
problem, and the design was authored as a class component with a `renderVals()`
producing a style object per element — a React component in all but name.

Hono runs on `Bun.serve`, which bundles an imported `.html` entry and registers
its asset routes itself. So the framework choice and the build-tool choice are
separable, and only the first is interesting.

## Decision

React, bundled by `Bun.serve`'s HTML import, mounted at `/`. Hono keeps the
API, the 404 document and everything the bundler does not claim.

**The pick stays on the server.** The client fetches two things: `/pick` for
the answer, and one page of `/watchlist/:user` as raw material for the
animation. The films flickering past during a spin are decor; the film that
lands is the one `picker.pick` chose. This is why `Reel` carries `tease` and
`winner` as separate fields rather than an index into a list.

## Consequences

- React and React DOM are the first runtime dependencies beyond Hono.
- Frame state lives in one `t` value per spin, so every animation is a pure
  function from `t` to styles and is unit-tested without a DOM.
- The client is a second consumer of the API's error `reason` field, so
  `src/web/copy.ts` is the single source of the words and both the React app
  and the server-rendered error document read from it.
- No separate build step, dev server or bundler config to keep in sync with the
  API's. `bun run src/index.ts` serves both.
- A watchlist page is enriched only where it is returned, because the client
  asks for one page and the spin cannot start until it lands. See
  `DESIGN.md` § Build model.

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Vanilla TypeScript, no framework | Avoids two dependencies. But the five animations are a hundred-element diff per frame against a five-state machine; hand-written DOM reconciliation for that is the framework, written worse |
| Server-rendered HTML, no client bundle | The interface is an animation. There is nothing to render on the server but the first frame |
| Vite, or any separate frontend build | A second build system, a second dev server, and a proxy config between them, to replace one `import index from "./web/index.html"` |
| Client-side picking from a fetched watchlist | One request instead of two, but it moves `picker` into the browser, makes `maxRuntime` unenforceable, and would need the whole watchlist — thousands of films — in the client |
