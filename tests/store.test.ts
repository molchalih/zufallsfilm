import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { openStore } from "../src/store";
import type { Film } from "../src/types";

const f = (lid: string): Film => ({ lid, slug: lid, name: lid, year: null });
const fresh = () => openStore(":memory:");

test("a complete scrape round-trips", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a"), f("b")], 2, 1000);
  const sc = s.getScrape("u")!;
  expect(sc.complete).toBe(true);
  expect(sc.expectedCount).toBe(2);
  expect(sc.actualCount).toBe(2);
  expect(s.getWatchlist("u").map((x) => x.lid)).toEqual(["a", "b"]);
  s.close();
});

test("a short scrape is marked incomplete", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a")], 2, 1000);
  expect(s.getScrape("u")!.complete).toBe(false);
  s.close();
});

test("replacing a watchlist deletes films that are gone", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a"), f("b")], 2, 1000);
  s.putWatchlist("u", [f("a")], 1, 2000);
  expect(s.getWatchlist("u").map((x) => x.lid)).toEqual(["a"]);
  s.close();
});

test("watchlists of different users do not interfere", () => {
  const s = fresh();
  s.putWatchlist("u", [f("a")], 1, 1000);
  s.putWatchlist("v", [f("b")], 1, 1000);
  s.putWatchlist("u", [f("c")], 1, 2000);
  expect(s.getWatchlist("v").map((x) => x.lid)).toEqual(["b"]);
  s.close();
});

test("watchlist order is preserved", () => {
  const s = fresh();
  s.putWatchlist("u", [f("c"), f("a"), f("b")], 3, 1000);
  expect(s.getWatchlist("u").map((x) => x.lid)).toEqual(["c", "a", "b"]);
  s.close();
});

test("a known runtime is served until the film TTL expires", () => {
  const s = fresh();
  s.putFilm({ lid: "a", runtime: 90, rating: 4, poster: null, director: null }, 1000);
  expect(s.getFilm("a", 1000 + 10, 100, 50)!.runtime).toBe(90);
  expect(s.getFilm("a", 1000 + 101, 100, 50)).toBeNull();
  s.close();
});

test("a null runtime expires on the short negative TTL", () => {
  const s = fresh();
  s.putFilm({ lid: "a", runtime: null, rating: null, poster: null, director: null }, 1000);
  expect(s.getFilm("a", 1000 + 10, 100, 50)).not.toBeNull();
  expect(s.getFilm("a", 1000 + 51, 100, 50)).toBeNull();
  s.close();
});

test("migrations are idempotent and stamp the schema version", () => {
  const path = `/tmp/picker-migrate-${Math.random().toString(36).slice(2)}.sqlite`;
  const a = openStore(path);
  a.putWatchlist("u", [f("a")], 1, 1000);
  a.close();
  // Reopening must not re-run migrations or lose data.
  const b = openStore(path);
  expect(b.getWatchlist("u").map((x) => x.lid)).toEqual(["a"]);
  expect(b.schemaVersion()).toBeGreaterThan(0);
  b.close();
});

test("eviction removes the least recently fetched films first", () => {
  const s = fresh();
  s.putFilm({ lid: "old", runtime: 1, rating: null, poster: null, director: null }, 1000);
  s.putFilm({ lid: "new", runtime: 2, rating: null, poster: null, director: null }, 5000);
  expect(s.evictFilms(1)).toBe(1);
  expect(s.getFilm("old", 5000, 1e9, 1e9)).toBeNull();
  expect(s.getFilm("new", 5000, 1e9, 1e9)).not.toBeNull();
  s.close();
});

test("posters and ratings are flagged stale before the film TTL expires", () => {
  const s = fresh();
  s.putFilm({ lid: "a", runtime: 90, rating: 4, poster: "p.jpg", director: null }, 1000);
  // Fresh: inside the 7-day staleness window.
  expect(s.getFilm("a", 1000 + 10, 1e9, 1e9, 100)!.metaStale).toBe(false);
  // Stale metadata, but the row is still served rather than discarded.
  const stale = s.getFilm("a", 1000 + 101, 1e9, 1e9, 100)!;
  expect(stale.metaStale).toBe(true);
  expect(stale.runtime).toBe(90);
  s.close();
});

// The schema as it stood before the director column, so the upgrade path is
// exercised against a real old database rather than a freshly migrated one.
const SCHEMA_V1 = `
CREATE TABLE scrape (
  username TEXT PRIMARY KEY, scraped_at INTEGER NOT NULL, expected_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL, complete INTEGER NOT NULL
);
CREATE TABLE watchlist_entry (
  username TEXT NOT NULL, lid TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
  year INTEGER, position INTEGER NOT NULL, PRIMARY KEY (username, lid)
);
CREATE TABLE film (
  lid TEXT PRIMARY KEY, runtime INTEGER, rating REAL, poster TEXT, fetched_at INTEGER NOT NULL
);
PRAGMA user_version = 1;
`;

async function withV1Database(
  seed: (db: Database) => void,
  run: (path: string) => void,
): Promise<void> {
  const path = `${import.meta.dir}/../.migrate-${Math.random().toString(36).slice(2)}.sqlite`;
  try {
    const raw = new Database(path);
    raw.exec(SCHEMA_V1);
    seed(raw);
    raw.close();
    run(path);
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) {
      await Bun.file(path + suffix)
        .delete()
        .catch(() => {});
    }
  }
}

test("a pre-director database gains the column and keeps every row", async () => {
  await withV1Database(
    (db) => {
      db.run(`INSERT INTO film (lid, runtime, rating, poster, fetched_at) VALUES (?,?,?,?,?)`, [
        "a",
        90,
        4,
        "p.jpg",
        Date.now(),
      ]);
    },
    (path) => {
      const store = openStore(path);
      expect(store.schemaVersion()).toBe(3);
      const row = store.getFilm("a", Date.now(), 30 * 24 * 60 * 60 * 1000, 60 * 60 * 1000);
      expect(row?.runtime).toBe(90);
      expect(row?.rating).toBe(4);
      expect(row?.director).toBeNull();
      store.close();
    },
  );
});

test("rows that predate the director column are handed to the background refresh", async () => {
  // Not expired — expiring them would make a pick wait on a re-fetch. Marked
  // stale, so the cached row is served now and refreshed out of band.
  await withV1Database(
    (db) => {
      db.run(`INSERT INTO film (lid, runtime, rating, poster, fetched_at) VALUES (?,?,?,?,?)`, [
        "a",
        90,
        4,
        "p.jpg",
        Date.now(),
      ]);
    },
    (path) => {
      const store = openStore(path);
      const row = store.getFilm("a", Date.now(), 30 * 24 * 60 * 60 * 1000, 60 * 60 * 1000);
      expect(row).not.toBeNull();
      expect(row?.runtime).toBe(90);
      expect(row?.metaStale).toBe(true);
      store.close();
    },
  );
});

test("a row that already has a director is left alone by the backfill", async () => {
  await withV1Database(
    (db) => {
      // Written before the column existed, then filled in by an earlier run.
      db.run(`INSERT INTO film (lid, runtime, rating, poster, fetched_at) VALUES (?,?,?,?,?)`, [
        "a",
        90,
        4,
        "p.jpg",
        Date.now(),
      ]);
    },
    (path) => {
      const store = openStore(path);
      store.putFilm(
        { lid: "a", runtime: 90, rating: 4, poster: "p.jpg", director: "Chantal Akerman" },
        Date.now(),
      );
      const row = store.getFilm("a", Date.now(), 30 * 24 * 60 * 60 * 1000, 60 * 60 * 1000);
      expect(row?.director).toBe("Chantal Akerman");
      expect(row?.metaStale).toBe(false);
      store.close();
    },
  );
});

test("closing checkpoints the write-ahead log into the database file", async () => {
  // The defect this guards: SQLite folds the WAL back only when the last
  // connection goes, so with anything else holding the file open a close left
  // every write since the last automatic checkpoint in `-wal` alone. A backup
  // or a volume snapshot of the database file then had none of it.
  const path = `${import.meta.dir}/../.wal-${Math.random().toString(36).slice(2)}.sqlite`;
  const copy = `${path}.copy`;
  const other = new Database(path);
  try {
    const store = openStore(path);
    store.putWatchlist("u", [f("a"), f("b")], 2, 1000);
    other.query("PRAGMA user_version").get();
    expect(Bun.file(`${path}-wal`).size).toBeGreaterThan(0);

    store.close();
    expect(Bun.file(`${path}-wal`).size).toBe(0);

    // The database file alone, without its log, carries the whole watchlist.
    await Bun.write(copy, Bun.file(path));
    const reopened = openStore(copy);
    expect(reopened.getWatchlist("u").map((x) => x.lid)).toEqual(["a", "b"]);
    reopened.close();
  } finally {
    other.close();
    for (const p of [path, copy]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        await Bun.file(p + suffix)
          .delete()
          .catch(() => {});
      }
    }
  }
});
