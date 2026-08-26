import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { classifyResponse, createFetcher, FetchError } from "../src/fetcher";

const H = (o: Record<string, string> = {}) => new Headers(o);
const cfg = loadConfig({ REQUEST_TIMEOUT_MS: "1000" });
const noSleep = async () => {};

test("200 is ok", () => {
  expect(classifyResponse(200, "<html></html>", H())).toBe("ok");
});

test("404 is notfound", () => {
  expect(classifyResponse(404, "", H())).toBe("notfound");
});

test("a Cloudflare challenge is detected by marker, not by status", () => {
  expect(classifyResponse(403, "x window._cf_chl_opt = {} y", H())).toBe("challenge");
  expect(classifyResponse(200, "window._cf_chl_opt", H())).toBe("challenge");
  expect(classifyResponse(403, "", H({ "cf-mitigated": "challenge" }))).toBe("challenge");
});

test("a bare nginx 403 is a transient rate limit, not a challenge", () => {
  const body =
    "<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><hr><center>nginx/1.31.3</center></body></html>";
  expect(classifyResponse(403, body, H())).toBe("ratelimit");
});

test("the English challenge string alone does not classify", () => {
  // Challenge pages are localised; only the marker is language-independent.
  expect(classifyResponse(403, "Just a moment...", H())).toBe("ratelimit");
});

test("a rate limit is retried and can succeed", async () => {
  let n = 0;
  const stub = (async () => {
    n++;
    return n < 3
      ? new Response("nginx", { status: 403 })
      : new Response("<html>ok</html>", { status: 200 });
  }) as unknown as typeof fetch;
  const f = createFetcher(cfg, stub, noSleep);
  const r = await f.get("https://letterboxd.com/u/watchlist/page/1/");
  expect(r.classification).toBe("ok");
  expect(n).toBe(3);
});

test("a challenge is never retried", async () => {
  let n = 0;
  const stub = (async () => {
    n++;
    return new Response("window._cf_chl_opt", { status: 403 });
  }) as unknown as typeof fetch;
  const f = createFetcher(cfg, stub, noSleep);
  await expect(f.get("https://letterboxd.com/x/")).rejects.toThrow(FetchError);
  expect(n).toBe(1);
});

test("letterboxd URLs must carry a trailing slash", async () => {
  const stub = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
  const f = createFetcher(cfg, stub, noSleep);
  await expect(f.get("https://letterboxd.com/u/watchlist/page/1")).rejects.toThrow(
    /trailing slash/i,
  );
});

test("robots-disallowed paths are refused before any request", async () => {
  let n = 0;
  const stub = (async () => {
    n++;
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const f = createFetcher(cfg, stub, noSleep);
  for (const bad of [
    "https://letterboxd.com/u/watchlist/by/shortest/",
    "https://letterboxd.com/u/watchlist/decade/1970s/",
    "https://letterboxd.com/u/watchlist/genre/horror/",
  ]) {
    await expect(f.get(bad)).rejects.toThrow(/robots/i);
  }
  expect(n).toBe(0);
});

test("the proxy is passed to fetch when configured", async () => {
  let seen: any = null;
  const stub = (async (_u: any, init: any) => {
    seen = init;
    return new Response("<html></html>", { status: 200 });
  }) as unknown as typeof fetch;
  const withProxy = loadConfig({ EGRESS_PROXY: "http://127.0.0.1:3128" });
  await createFetcher(withProxy, stub, noSleep).get("https://letterboxd.com/a/");
  expect(seen.proxy).toBe("http://127.0.0.1:3128");
});
