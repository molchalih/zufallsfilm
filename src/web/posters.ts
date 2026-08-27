/**
 * Poster images are referenced from CSS backgrounds, so the browser only
 * begins fetching one when a frame that shows it is rendered. Measured on the
 * shuffle animation: 34 posters starting 50 ms apart, one per reel frame, each
 * racing the frame that needs it. On any real latency the reel shows blank
 * paper and the reveal shows a placeholder.
 *
 * Requesting them the moment the film list arrives puts every poster in the
 * browser's cache well before the frame that references it, and the CSS
 * background then resolves from cache instead of from the network.
 */

// Module-level: a poster fetched for one spin is still cached for the next, and
// a reroll shares the pool with the spin before it.
const requested = new Set<string>();

export type ImageFactory = () => { src: string; decoding: string };

/**
 * Starts a fetch for each poster not already requested, in the order given, so
 * the caller can put the one it needs soonest first. Fire and forget: nothing
 * waits on these, and a poster that fails to load is already handled by the
 * placeholder the design draws for a film that has none.
 */
export function prefetchPosters(
  urls: Array<string | null | undefined>,
  makeImage: ImageFactory = () => new Image(),
): number {
  let started = 0;
  for (const url of urls) {
    if (!url || requested.has(url)) continue;
    requested.add(url);
    const img = makeImage();
    img.decoding = "async";
    img.src = url;
    started += 1;
  }
  return started;
}

/** Test seam: the cache is module state and would otherwise leak between tests. */
export function resetPrefetchCache(): void {
  requested.clear();
}
