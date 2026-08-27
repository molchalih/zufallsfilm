export type Film = {
  lid: string;
  slug: string;
  name: string;
  year: number | null;
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
