import { Database } from "bun:sqlite";
import type { Film, FilmMeta } from "./types";

export type ScrapeRow = {
  username: string;
  scrapedAt: number;
  expectedCount: number;
  actualCount: number;
  complete: boolean;
};

type ScrapeRecord = {
  username: string;
  scraped_at: number;
  expected_count: number;
  actual_count: number;
  complete: number;
};

type FilmRecord = {
  lid: string;
  runtime: number | null;
  rating: number | null;
  poster: string | null;
  fetched_at: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scrape (
  username TEXT PRIMARY KEY,
  scraped_at INTEGER NOT NULL,
  expected_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  complete INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist_entry (
  username TEXT NOT NULL,
  lid TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  year INTEGER,
  position INTEGER NOT NULL,
  PRIMARY KEY (username, lid)
);
CREATE TABLE IF NOT EXISTS film (
  lid TEXT PRIMARY KEY,
  runtime INTEGER,
  rating REAL,
  poster TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entry_user ON watchlist_entry(username, position);
CREATE INDEX IF NOT EXISTS idx_film_fetched ON film(fetched_at);
`;

// Ordered, append-only. `CREATE TABLE IF NOT EXISTS` alone silently skips
// schema changes on a database that already exists, so every change goes here
// as a new entry and the file's version is the index of the last one applied.
const MIGRATIONS: string[] = [SCHEMA];

function migrate(db: Database) {
  const { user_version: at } = db.query("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let v = at; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}

export function openStore(path: string) {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);

  const insertEntry = db.prepare(
    `INSERT INTO watchlist_entry (username, lid, slug, name, year, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const deleteEntries = db.prepare(`DELETE FROM watchlist_entry WHERE username = ?`);
  const upsertScrape = db.prepare(
    `INSERT INTO scrape (username, scraped_at, expected_count, actual_count, complete)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       scraped_at = excluded.scraped_at,
       expected_count = excluded.expected_count,
       actual_count = excluded.actual_count,
       complete = excluded.complete`,
  );

  // One transaction: a partial set must never be visible.
  const replace = db.transaction(
    (username: string, films: Film[], expected: number, now: number) => {
      deleteEntries.run(username);
      films.forEach((f, i) => {
        insertEntry.run(username, f.lid, f.slug, f.name, f.year, i);
      });
      upsertScrape.run(
        username,
        now,
        expected,
        films.length,
        films.length === expected && expected > 0 ? 1 : 0,
      );
    },
  );

  return {
    putWatchlist(username: string, films: Film[], expectedCount: number, now: number) {
      replace(username, films, expectedCount, now);
    },

    getScrape(username: string): ScrapeRow | null {
      const r = db
        .query(`SELECT * FROM scrape WHERE username = ?`)
        .get(username) as ScrapeRecord | null;
      if (!r) return null;
      return {
        username: r.username,
        scrapedAt: r.scraped_at,
        expectedCount: r.expected_count,
        actualCount: r.actual_count,
        complete: r.complete === 1,
      };
    },

    getWatchlist(username: string): Film[] {
      return db
        .query(
          `SELECT lid, slug, name, year FROM watchlist_entry
           WHERE username = ? ORDER BY position`,
        )
        .all(username) as Film[];
    },

    getFilm(lid: string, now: number, filmTtlMs: number, negativeTtlMs: number): FilmMeta | null {
      const r = db.query(`SELECT * FROM film WHERE lid = ?`).get(lid) as FilmRecord | null;
      if (!r) return null;
      // A miss is not a fact: unknown runtimes expire on the short TTL.
      const ttl = r.runtime === null ? negativeTtlMs : filmTtlMs;
      if (now - r.fetched_at >= ttl) return null;
      return { lid: r.lid, runtime: r.runtime, rating: r.rating, poster: r.poster };
    },

    putFilm(meta: FilmMeta, now: number) {
      db.prepare(
        `INSERT INTO film (lid, runtime, rating, poster, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(lid) DO UPDATE SET
           runtime = excluded.runtime, rating = excluded.rating,
           poster = excluded.poster, fetched_at = excluded.fetched_at`,
      ).run(meta.lid, meta.runtime, meta.rating, meta.poster, now);
    },

    evictFilms(cap: number): number {
      const { c } = db.query(`SELECT COUNT(*) AS c FROM film`).get() as { c: number };
      if (c <= cap) return 0;
      const n = c - cap;
      db.prepare(
        `DELETE FROM film WHERE lid IN
         (SELECT lid FROM film ORDER BY fetched_at ASC LIMIT ?)`,
      ).run(n);
      return n;
    },

    schemaVersion(): number {
      return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    },

    close() {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;
