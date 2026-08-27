// Every user-visible failure string, in one place, because the same failure is
// rendered twice: server-side as a static document for a request that never
// reaches the bundle, and client-side by the React app. Two copies of the
// markup are unavoidable — two copies of the words are not.

export type Copy = { code: string; headline: string };

/**
 * `code` is always the status that actually came back; only the headline is
 * chosen by reason. Keeping a reason's own status in the row and preferring it
 * would print a number the response never carried the moment a reason is
 * returned under a status other than its documented one.
 */

// Keyed by the `reason` field of the API's error body. A new reason belongs
// here and in DESIGN.md § Error reasons; an unmapped one falls back by status.
const BY_REASON: Record<string, string> = {
  missing_user: "no name on the ticket.",
  bad_max_runtime: "that runtime makes no sense.",
  user_not_found: "no such member.",
  watchlist_empty: "an empty watchlist.",
  no_match: "nothing that short.",
  watchlist_private: "this one is private.",
  watchlist_too_large: "too many films to shuffle.",
  route_not_found: "scene missing.",
  throttled_rate: "too fast. take an intermission.",
  throttled_variety: "too many names at once.",
  upstream_blocked: "projector failure.",
  incomplete: "the print is damaged.",
  internal: "projector failure.",
  building: "still threading the reel.",
  upstream_timeout: "the reel ran long.",
};

/**
 * The fallback when there is no reason to key on. This is not a rare path: a
 * proxy in front of this service emits its own HTML error document, which
 * `api.ts` cannot parse as JSON, so it arrives here carrying a status and
 * nothing else. Every status the API can produce needs a row, or the caller
 * reads "something broke." where the app itself would have been specific.
 */
const BY_STATUS: Record<string, string> = {
  "400": "scene missing.",
  "403": "this one is private.",
  "404": "scene missing.",
  "413": "too many films to shuffle.",
  "429": "too fast. take an intermission.",
  "500": "projector failure.",
  "502": "projector failure.",
  "503": "intermission.",
  "504": "the reel ran long.",
};

export function copyFor(status: number, reason?: string): Copy {
  const code = String(status);
  const byReason = reason === undefined ? undefined : BY_REASON[reason];
  return { code, headline: byReason ?? BY_STATUS[code] ?? "something broke." };
}

// A network failure has no status at all: fetch rejected before a response.
export const OFFLINE: Copy = { code: "———", headline: "no signal." };

/**
 * Reasons that are a verdict on what the visitor typed rather than a failure of
 * the service. These belong on the field they came from: sending someone to a
 * full error page to be told they mistyped a username loses the username, the
 * page, and the thread of what they were doing.
 */
const INPUT_REJECTIONS = new Set([
  "missing_user",
  "user_not_found",
  "watchlist_empty",
  "watchlist_private",
  "watchlist_too_large",
]);

export function isInputRejection(reason: string | undefined): boolean {
  return reason !== undefined && INPUT_REJECTIONS.has(reason);
}
