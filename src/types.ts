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
};

export type PickFilter = {
  maxRuntime?: number;
};
