/**
 * HTTP access to the Letterboxd API: OAuth2 client-credentials tokens, bearer
 * requests, and the pacing and retry rules in front of them.
 */

import type { Config } from "./config";

export type Classification =
  | "ok"
  | "notfound"
  | "forbidden"
  | "unauthorized"
  | "ratelimit"
  | "timeout"
  | "error";

/** An upstream failure, carrying the outcome its callers branch on. */
export class ApiError extends Error {
  readonly classification: Classification;
  readonly status: number;

  constructor(message: string, classification: Classification, status = 0) {
    super(message);
    this.name = "ApiError";
    this.classification = classification;
    this.status = status;
  }
}

/** Maps an HTTP status onto the outcomes the callers above actually branch on. */
export function classifyStatus(status: number): Classification {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notfound";
  if (status === 429 || status >= 500) return "ratelimit";
  return "error";
}

export type Params = Record<string, string | number | boolean | string[] | undefined>;

/** Builds a request URL, repeating array values rather than joining them. */
export function buildUrl(base: string, path: string, params: Params = {}): string {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, String(one));
    }
  }
  return url.toString();
}

// The global outbound ceiling lives in `fetcher.ts` as `createRateGate`, and
// `index.ts` hands one to whichever path it wires. A second implementation here
// would be a second ceiling that neither path could see.

type Token = { value: string; expiresAt: number };

const TOKEN_SKEW_MS = 60_000;
const RETRIES = 2;
/**
 * The longest a rate-limit wait may hold a request. `Retry-After` is chosen by
 * the API and can be hours; sleeping it would hold the caller, and the build it
 * belongs to, far past `BUILD_BUDGET_MS`. Two retries put the worst case at
 * twice this, still an order of magnitude inside the budget.
 */
const RETRY_WAIT_CAP_MS = 30_000;

/**
 * The API client: one cached token, signed GETs, and the retry rules around
 * them. `gate` paces every outbound call, `sleep` and `now` are test seams.
 */
export function createClient(
  cfg: Config,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  gate: () => Promise<void> = async () => {},
  now: () => number = () => Date.now(),
) {
  let token: Token | null = null;
  let pending: Promise<Token> | null = null;

  function retryAfterMs(res: Response): number | null {
    const raw = res.headers.get("retry-after");
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(raw);
    return Number.isNaN(at) ? null : Math.max(0, at - now());
  }

  async function requestToken(): Promise<Token> {
    if (!cfg.apiKey || !cfg.apiSecret) {
      throw new ApiError(
        "LETTERBOXD_API_KEY and LETTERBOXD_API_SECRET must be set",
        "unauthorized",
        401,
      );
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.apiKey,
      client_secret: cfg.apiSecret,
    });
    await gate();
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.apiBase}/auth/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      });
    } catch (e) {
      throw asTransportError(e, `${cfg.apiBase}/auth/token`);
    }
    if (res.status !== 200) {
      throw new ApiError(
        `Token request failed with ${res.status}`,
        classifyStatus(res.status),
        res.status,
      );
    }
    const parsed = (await readJson(res)) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") {
      throw new ApiError("Token response carried no access_token", "error", res.status);
    }
    const lifetime = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
    return {
      value: parsed.access_token,
      expiresAt: now() + Math.max(0, lifetime * 1000 - TOKEN_SKEW_MS),
    };
  }

  function asTransportError(e: unknown, url: string): ApiError {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return timedOut
      ? new ApiError(`Timed out after ${cfg.requestTimeoutMs}ms: ${url}`, "timeout")
      : new ApiError(`Network failure for ${url}: ${e}`, "error");
  }

  async function readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new ApiError(`Response was not JSON (${res.status})`, "error", res.status);
    }
  }

  // Concurrent callers share one token request; a burst on a cold start would
  // otherwise open a grant per in-flight page.
  async function bearer(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    if (!pending) {
      pending = requestToken().finally(() => {
        pending = null;
      });
    }
    token = await pending;
    return token.value;
  }

  return {
    /** Issues a signed GET and returns the parsed JSON body. */
    async get(path: string, params: Params = {}): Promise<unknown> {
      const url = buildUrl(cfg.apiBase, path, params);
      let refreshed = false;
      let delay = 250;

      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        const auth = await bearer();
        await gate();
        let res: Response;
        try {
          res = await fetchImpl(url, {
            headers: { authorization: `Bearer ${auth}`, accept: "application/json" },
            signal: AbortSignal.timeout(cfg.requestTimeoutMs),
          });
        } catch (e) {
          const err = asTransportError(e, url);
          if (err.classification === "timeout" || attempt === RETRIES) throw err;
          await sleep(delay);
          delay *= 2;
          continue;
        }

        const c = classifyStatus(res.status);
        if (c === "ok") return await readJson(res);
        // An expired token looks like any other 401, so spend one refresh
        // before believing the credentials are simply wrong.
        if (c === "unauthorized" && !refreshed) {
          refreshed = true;
          token = null;
          continue;
        }
        if (c === "notfound" || c === "forbidden" || c === "unauthorized" || c === "error") {
          throw new ApiError(`${res.status} for ${path}`, c, res.status);
        }
        if (attempt === RETRIES) {
          throw new ApiError(`Exhausted retries for ${path}`, "ratelimit", res.status);
        }
        // A wait longer than the cap is refused rather than slept: holding the
        // request would strand the build coalescing on it for the whole period,
        // and the caller is better served by a rate-limit failure it can report.
        const wait = retryAfterMs(res) ?? delay;
        if (wait > RETRY_WAIT_CAP_MS) {
          throw new ApiError(
            `Rate limited for ${wait}ms, beyond the ${RETRY_WAIT_CAP_MS}ms cap, for ${path}`,
            "ratelimit",
            res.status,
          );
        }
        await sleep(wait);
        delay *= 2;
      }
      throw new ApiError(`Exhausted retries for ${path}`, "error");
    },
  };
}

export type Client = ReturnType<typeof createClient>;
