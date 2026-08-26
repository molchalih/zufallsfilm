import { expect, test } from "bun:test";
import { createBuilder } from "../src/builder";
import { loadConfig } from "../src/config";
import { createEnricher } from "../src/enricher";
import { createFetcher } from "../src/fetcher";
import { openStore } from "../src/store";

// Opt-in: requires working egress to letterboxd.com, direct or through EGRESS_PROXY.
const live = process.env.LIVE === "1" ? test : test.skip;
const USER = process.env.LIVE_USER ?? "examplemember";

live(
  "builds a real watchlist end to end",
  async () => {
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
    const known = full.films.filter((f) => f.runtime !== null).length;
    expect(known / full.films.length).toBeGreaterThan(0.95);

    store.close();
  },
  300_000,
);
