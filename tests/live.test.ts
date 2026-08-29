import { expect, test } from "bun:test";
import { createBuilder } from "../src/builder";
import { loadConfig } from "../src/config";
import { createEnricher } from "../src/enricher";
import { createFetcher } from "../src/fetcher";
import { openStore } from "../src/store";

// Opt-in: needs working egress to letterboxd.com, direct or through
// EGRESS_PROXY, and a member whose watchlist is public.
const live = process.env.LIVE === "1" ? test : test.skip;
const USER = process.env.LIVE_MEMBER;

live(
  "builds a real watchlist end to end",
  async () => {
    if (!USER) throw new Error("LIVE_MEMBER must name a member with a public watchlist");
    const cfg = loadConfig(process.env as Record<string, string | undefined>);
    const store = openStore(":memory:");
    const fetcher = createFetcher(cfg);
    const builder = createBuilder({
      fetcher,
      enricher: createEnricher(fetcher),
      store,
      cfg,
    });

    const first = await builder.getWatchlist(USER);
    expect(first.films.length).toBeGreaterThan(0);

    await builder.whenSettled(USER);
    const sc = store.getScrape(USER.toLowerCase())!;
    expect(sc.complete).toBe(true);
    expect(sc.actualCount).toBe(sc.expectedCount);

    const full = await builder.getWatchlist(USER);
    expect(full.partial).toBe(false);
    expect(full.films).toHaveLength(sc.expectedCount);

    // Enrichment coverage was measured at 99.2%; allow a small miss margin.
    // One page, not the whole watchlist: `enrich` is scoped by its caller, and
    // a live suite that enriched thousands of films would run for minutes.
    const page = await builder.enrich(USER, full.films.slice(0, 28));
    const known = page.filter((f) => f.runtime !== null).length;
    expect(known / page.length).toBeGreaterThan(0.95);

    store.close();
  },
  300_000,
);
