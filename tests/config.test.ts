import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

test("defaults apply when env is empty", () => {
  const c = loadConfig({});
  expect(c.port).toBe(3000);
  expect(c.egressProxy).toBeUndefined();
  expect(c.maxWatchlist).toBe(6000);
  expect(c.requestTimeoutMs).toBe(20_000);
  expect(c.buildBudgetMs).toBe(300_000);
  // The behaviour this service already had: no new environment is needed.
  expect(c.source).toBe("html");
  expect(c.trustProxy).toBe(false);
});

test("env overrides are parsed as numbers", () => {
  const c = loadConfig({ PORT: "8080", MAX_WATCHLIST: "100" });
  expect(c.port).toBe(8080);
  expect(c.maxWatchlist).toBe(100);
});

test("egress proxy must be http, not socks", () => {
  expect(() => loadConfig({ EGRESS_PROXY: "socks5://127.0.0.1:1080" })).toThrow(/must be an http/i);
  expect(loadConfig({ EGRESS_PROXY: "http://127.0.0.1:3128" }).egressProxy).toBe(
    "http://127.0.0.1:3128",
  );
});

test("config is frozen", () => {
  const c = loadConfig({});
  expect(Object.isFrozen(c)).toBe(true);
});

test("the watchlist source defaults to the site and is otherwise explicit", () => {
  expect(loadConfig({ WATCHLIST_SOURCE: "" }).source).toBe("html");
  expect(loadConfig({ WATCHLIST_SOURCE: "html" }).source).toBe("html");
  expect(
    loadConfig({ WATCHLIST_SOURCE: "api", LETTERBOXD_API_KEY: "k", LETTERBOXD_API_SECRET: "s" })
      .source,
  ).toBe("api");
  expect(() => loadConfig({ WATCHLIST_SOURCE: "scrape" })).toThrow(/must be "html" or "api"/);
});

test("selecting the API without credentials fails at startup, not at the first request", () => {
  expect(() => loadConfig({ WATCHLIST_SOURCE: "api" })).toThrow(/LETTERBOXD_API_KEY/);
  expect(() => loadConfig({ WATCHLIST_SOURCE: "api", LETTERBOXD_API_KEY: "k" })).toThrow(
    /LETTERBOXD_API_SECRET/,
  );
  // A half-supplied pair does not silently select the API either.
  expect(loadConfig({ LETTERBOXD_API_KEY: "k" }).source).toBe("html");
});

test("proxy trust is off unless it is declared, and is declared as a boolean", () => {
  expect(loadConfig({}).trustProxy).toBe(false);
  expect(loadConfig({ TRUST_PROXY: "" }).trustProxy).toBe(false);
  expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
  expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
  expect(loadConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
  expect(loadConfig({ TRUST_PROXY: "0" }).trustProxy).toBe(false);
  // Not silently false: a typo that disables a security control must be loud.
  expect(() => loadConfig({ TRUST_PROXY: "yes" })).toThrow(/must be true or false/);
});

test("a limit that is not a number is refused at startup, not silently ignored", () => {
  for (const key of [
    "GLOBAL_REQ_PER_SEC",
    "RATE_PER_MIN",
    "RATE_BURST",
    "DISTINCT_USERS_PER_WINDOW",
  ]) {
    expect(() => loadConfig({ [key]: "fast" })).toThrow(new RegExp(key));
  }
});

test("credentials select the source when nothing overrides them", () => {
  expect(loadConfig({}).source).toBe("html");
  expect(loadConfig({ LETTERBOXD_API_KEY: "k" }).source).toBe("html");
  expect(loadConfig({ LETTERBOXD_API_SECRET: "s" }).source).toBe("html");
  expect(loadConfig({ LETTERBOXD_API_KEY: "k", LETTERBOXD_API_SECRET: "s" }).source).toBe("api");
});

test("an explicit source wins over the credentials", () => {
  const keyed = { LETTERBOXD_API_KEY: "k", LETTERBOXD_API_SECRET: "s" };
  expect(loadConfig({ ...keyed, WATCHLIST_SOURCE: "html" }).source).toBe("html");
  expect(() => loadConfig({ WATCHLIST_SOURCE: "api" })).toThrow(/LETTERBOXD_API_KEY/);
});
