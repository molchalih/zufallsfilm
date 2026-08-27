import type { Film } from "../api";
import type { Reel } from "../spin";

export const ANIMATIONS = ["shuffle", "roll", "montage", "void", "lastone"] as const;

export type Animation = (typeof ANIMATIONS)[number];

export type AnimProps = {
  reel: Reel;
  /** Decor films, in watchlist order. May be shorter than the watchlist. */
  pool: Film[];
  /** Total films in the watchlist, for the position readouts. */
  total: number;
  /** Watchlist position by film id. Built once per spin. */
  poolIndex: ReadonlyMap<string, number>;
  /**
   * The winner's own 1-based place in the watchlist. The server draws from the
   * whole watchlist while the pool is only its first page, so the winner is
   * frequently absent from `poolIndex` and this is the only place its number
   * can come from.
   */
  winnerPosition: number;
  /**
   * One 32-bit integer per spin. Every animation derives its own layout from
   * it, so a re-render mid-spin cannot reshuffle what is already on screen.
   */
  seed: number;
  /** Spin progress, 0 to 1. */
  t: number;
};

/** `background` shorthand for a poster, or the blank paper it falls back to. */
export function posterBackground(url: string | null | undefined): string {
  return url ? `var(--paper) url("${encodeURI(url)}") center/cover no-repeat` : "var(--paper-alt)";
}

/**
 * Integer hash of a film id, as a fraction. Positions driven by this stay put
 * while a film is on screen and jump when it changes, which is the intent.
 */
export function hashUnit(id: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0;
  }
  return ((h ^ (h >>> 15)) >>> 0) / 4294967295;
}

/**
 * The film a grid cell shows: the winner at its reserved cell, decor elsewhere.
 * Grids differ in size, so each animation reserves its own cell.
 */
export function cellFilm(props: AnimProps, winnerCell: number, cell: number): Film {
  if (cell === winnerCell || props.pool.length === 0) return props.reel.winner;
  return props.pool[cell % props.pool.length];
}

/**
 * The watchlist position readout for a film, padded to the width of the
 * largest position. Decor comes from the pool and knows its own index; the
 * winner usually does not appear in the pool at all and carries its position
 * from the server instead.
 */
export function positionLabel(props: AnimProps, film: Film): string {
  const at = props.poolIndex.get(film.lid);
  const position = at === undefined ? props.winnerPosition : at + 1;
  return String(position).padStart(String(props.total).length, "0");
}

/**
 * The design exposes the animation as a prop defaulting to "random". The web
 * app has no props, so the query string carries it: `?anim=roll` pins one,
 * anything else leaves the choice to the spin.
 */
export function animationFromSearch(search: string): Animation | null {
  const asked = new URLSearchParams(search).get("anim");
  return ANIMATIONS.find((a) => a === asked) ?? null;
}
