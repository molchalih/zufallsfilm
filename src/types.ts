export type Film = {
  lid: string;
  name: string;
  year: number | null;
  /**
   * The canonical Letterboxd page for the film, and the one representation both
   * read paths produce. The HTML path derives it from the page slug it parsed;
   * the API path takes `FilmSummary.link`, which is authoritative there and is
   * not always a `/film/<slug>/` URL.
   */
  url: string;
};

export type FilmMeta = {
  lid: string;
  runtime: number | null;
  rating: number | null;
  poster: string | null;
  /** Joined with ", " when a film has more than one. */
  director: string | null;
};

export type PickFilter = {
  maxRuntime?: number;
};
