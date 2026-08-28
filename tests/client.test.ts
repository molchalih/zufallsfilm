import { expect, test } from "bun:test";
import { ApiError, buildUrl, classifyStatus, createClient } from "../src/client";
import { loadConfig } from "../src/config";
import { accessToken, json } from "./fixtures/api";

const cfg = loadConfig({
  LETTERBOXD_API_KEY: "key",
  LETTERBOXD_API_SECRET: "secret",
  LETTERBOXD_API_BASE: "https://api.example.test/api/v0",
});

const noSleep = async () => {};

type Call = { url: string; init: RequestInit | undefined };

function recorder(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const tokenUrl = "https://api.example.test/api/v0/auth/token";

test("classifies each status onto the outcome callers branch on", () => {
  expect(classifyStatus(200)).toBe("ok");
  expect(classifyStatus(204)).toBe("ok");
  expect(classifyStatus(401)).toBe("unauthorized");
  expect(classifyStatus(403)).toBe("forbidden");
  expect(classifyStatus(404)).toBe("notfound");
  expect(classifyStatus(429)).toBe("ratelimit");
  expect(classifyStatus(503)).toBe("ratelimit");
  expect(classifyStatus(418)).toBe("error");
});

test("array parameters are repeated, not joined", () => {
  const url = buildUrl("https://x.test/v0", "/search", {
    input: "a b",
    include: ["MemberSearchItem", "FilmSearchItem"],
    perPage: 100,
    excludeMemberFilmRelationships: true,
    cursor: undefined,
  });
  expect(url).toContain("include=MemberSearchItem&include=FilmSearchItem");
  expect(url).toContain("input=a+b");
  expect(url).toContain("perPage=100");
  expect(url).toContain("excludeMemberFilmRelationships=true");
  expect(url).not.toContain("cursor");
});

test("a request carries a bearer token obtained by client credentials", async () => {
  const { calls, fetchImpl } = recorder((url) =>
    url === tokenUrl ? json(accessToken()) : json({ ok: true }),
  );
  const client = createClient(cfg, fetchImpl, noSleep);
  await client.get("/search", { input: "x" });

  expect(calls[0].url).toBe(tokenUrl);
  expect(calls[0].init?.method).toBe("POST");
  const body = String(calls[0].init?.body);
  expect(body).toContain("grant_type=client_credentials");
  expect(body).toContain("client_id=key");
  expect(body).toContain("client_secret=secret");

  const headers = calls[1].init?.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer test-token");
});

test("one token serves many requests", async () => {
  const { calls, fetchImpl } = recorder((url) =>
    url === tokenUrl ? json(accessToken()) : json({ ok: true }),
  );
  const client = createClient(cfg, fetchImpl, noSleep);
  await client.get("/a");
  await client.get("/b");
  await client.get("/c");
  expect(calls.filter((c) => c.url === tokenUrl)).toHaveLength(1);
});

test("concurrent cold requests share a single grant", async () => {
  const { calls, fetchImpl } = recorder((url) =>
    url === tokenUrl ? json(accessToken()) : json({ ok: true }),
  );
  const client = createClient(cfg, fetchImpl, noSleep);
  await Promise.all([client.get("/a"), client.get("/b"), client.get("/c")]);
  expect(calls.filter((c) => c.url === tokenUrl)).toHaveLength(1);
});

test("a token is renewed once it is within the expiry skew", async () => {
  let t = 0;
  const { calls, fetchImpl } = recorder((url) =>
    url === tokenUrl ? json(accessToken("t", 120)) : json({ ok: true }),
  );
  const client = createClient(cfg, fetchImpl, noSleep, undefined, () => t);
  await client.get("/a");
  t += 61_000;
  await client.get("/b");
  expect(calls.filter((c) => c.url === tokenUrl)).toHaveLength(2);
});

test("a 401 buys exactly one refresh before it is believed", async () => {
  let n = 0;
  const { calls, fetchImpl } = recorder((url) => {
    if (url === tokenUrl) return json(accessToken(`t${n++}`));
    return json({ error: true }, 401);
  });
  const client = createClient(cfg, fetchImpl, noSleep);
  await expect(client.get("/a")).rejects.toThrow(/401/);
  expect(calls.filter((c) => c.url === tokenUrl)).toHaveLength(2);
});

test("a 429 waits for Retry-After when the header carries one", async () => {
  const slept: number[] = [];
  let hits = 0;
  const { fetchImpl } = recorder((url) => {
    if (url === tokenUrl) return json(accessToken());
    hits += 1;
    return hits === 1 ? json({}, 429, { "retry-after": "7" }) : json({ ok: true });
  });
  const client = createClient(cfg, fetchImpl, async (ms) => {
    slept.push(ms);
  });
  await client.get("/a");
  expect(slept).toEqual([7000]);
});

test("a 429 without Retry-After backs off exponentially, then gives up", async () => {
  const slept: number[] = [];
  const { fetchImpl } = recorder((url) => (url === tokenUrl ? json(accessToken()) : json({}, 429)));
  const client = createClient(cfg, fetchImpl, async (ms) => {
    slept.push(ms);
  });
  await expect(client.get("/a")).rejects.toThrow(/Exhausted retries/);
  expect(slept).toEqual([250, 500]);
});

test("a Retry-After beyond the cap fails fast instead of sleeping it off", async () => {
  // A day-long Retry-After used to be slept twice, holding the request — and
  // the build coalescing on it — for two days.
  const slept: number[] = [];
  let hits = 0;
  const { fetchImpl } = recorder((url) => {
    if (url === tokenUrl) return json(accessToken());
    hits += 1;
    return json({}, 429, { "retry-after": "86400" });
  });
  const client = createClient(cfg, fetchImpl, async (ms) => {
    slept.push(ms);
  });
  const err = await client.get("/a").catch((e) => e);
  expect((err as ApiError).classification).toBe("ratelimit");
  expect(slept).toEqual([]);
  expect(hits).toBe(1);
});

test("the sleep one rate-limited request can accumulate stays inside the build budget", async () => {
  const slept: number[] = [];
  const { fetchImpl } = recorder((url) =>
    url === tokenUrl ? json(accessToken()) : json({}, 429, { "retry-after": "25" }),
  );
  const client = createClient(cfg, fetchImpl, async (ms) => {
    slept.push(ms);
  });
  await expect(client.get("/a")).rejects.toThrow(/Exhausted retries/);
  expect(slept).toEqual([25_000, 25_000]);
  expect(slept.reduce((a, b) => a + b, 0)).toBeLessThan(cfg.buildBudgetMs);
});

test("404 and 403 are final, and are not retried", async () => {
  for (const [status, classification] of [
    [404, "notfound"],
    [403, "forbidden"],
  ] as const) {
    let hits = 0;
    const { fetchImpl } = recorder((url) => {
      if (url === tokenUrl) return json(accessToken());
      hits += 1;
      return json({}, status);
    });
    const client = createClient(cfg, fetchImpl, noSleep);
    const err = await client.get("/a").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).classification).toBe(classification);
    expect(hits).toBe(1);
  }
});

test("a timeout is never retried", async () => {
  let hits = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    if (String(input) === tokenUrl) return json(accessToken());
    hits += 1;
    const e = new Error("timed out");
    e.name = "TimeoutError";
    throw e;
  }) as unknown as typeof fetch;
  const client = createClient(cfg, fetchImpl, noSleep);
  const err = await client.get("/a").catch((e) => e);
  expect((err as ApiError).classification).toBe("timeout");
  expect(hits).toBe(1);
});

test("missing credentials fail before any request is made", async () => {
  // Reachable only where the API client is constructed without selecting the
  // API path; `WATCHLIST_SOURCE=api` is refused at startup without credentials.
  const bare = loadConfig({});
  const { calls, fetchImpl } = recorder(() => json({ ok: true }));
  const client = createClient(bare, fetchImpl, noSleep);
  const err = await client.get("/a").catch((e) => e);
  expect((err as ApiError).classification).toBe("unauthorized");
  expect(calls).toHaveLength(0);
});

test("a non-JSON body is an error, not a crash", async () => {
  const fetchImpl = (async (input: string | URL | Request) =>
    String(input) === tokenUrl
      ? json(accessToken())
      : new Response("<html>gateway</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as unknown as typeof fetch;
  const client = createClient(cfg, fetchImpl, noSleep);
  await expect(client.get("/a")).rejects.toThrow(/not JSON/);
});
