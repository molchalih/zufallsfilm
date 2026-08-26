import type { Config } from "./config";

export type Classification = "ok" | "challenge" | "ratelimit" | "notfound" | "error";

export class FetchError extends Error {
  readonly classification: Classification;

  constructor(message: string, classification: Classification) {
    super(message);
    this.name = "FetchError";
    this.classification = classification;
  }
}

// robots.txt Disallow list for User-agent: *
const DISALLOWED = [/\/by\//, /\/decade\//, /\/genre\//, /\/country\//, /\/language\//];

export function classifyResponse(status: number, body: string, headers: Headers): Classification {
  // Language-independent challenge markers. Never classify on status alone.
  if (body.includes("_cf_chl_opt") || headers.get("cf-mitigated")) return "challenge";
  if (status === 200) return "ok";
  if (status === 404) return "notfound";
  if (status === 403 || status === 429 || status >= 500) return "ratelimit";
  return "error";
}

export function createFetcher(
  cfg: Config,
  fetchImpl: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
) {
  async function get(url: string) {
    const u = new URL(url);
    if (u.hostname.endsWith("letterboxd.com") && !u.hostname.startsWith("api.")) {
      if (!u.pathname.endsWith("/")) {
        throw new FetchError(`URL needs a trailing slash: ${url}`, "error");
      }
      if (DISALLOWED.some((re) => re.test(u.pathname))) {
        throw new FetchError(`Path is robots.txt-disallowed: ${u.pathname}`, "error");
      }
    }

    let delay = 250;
    let last: Classification = "error";
    for (let attempt = 0; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: { "User-Agent": "letterboxd-picker/1.0" },
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
          ...(cfg.egressProxy ? { proxy: cfg.egressProxy } : {}),
        } as RequestInit);
      } catch (e) {
        last = "error";
        if (attempt === 2) throw new FetchError(`Network failure for ${url}: ${e}`, "error");
        await sleep(delay);
        delay *= 2;
        continue;
      }
      const body = await res.text();
      const c = classifyResponse(res.status, body, res.headers);
      if (c === "ok" || c === "notfound") return { status: res.status, body, classification: c };
      // A challenge does not clear on retry; a rate limit does.
      if (c === "challenge") throw new FetchError(`Blocked by challenge: ${url}`, "challenge");
      last = c;
      if (attempt < 2) {
        await sleep(delay);
        delay *= 2;
      }
    }
    throw new FetchError(`Exhausted retries for ${url}`, last);
  }

  return { get };
}

export type Fetcher = ReturnType<typeof createFetcher>;
