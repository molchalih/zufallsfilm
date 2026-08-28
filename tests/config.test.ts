import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

test("defaults apply when env is empty", () => {
  const c = loadConfig({});
  expect(c.port).toBe(3000);
  expect(c.egressProxy).toBeUndefined();
  expect(c.maxWatchlist).toBe(6000);
  expect(c.requestTimeoutMs).toBe(20_000);
  expect(c.buildBudgetMs).toBe(300_000);
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
