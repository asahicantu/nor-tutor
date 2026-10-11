import { DatabaseSync } from 'node:sqlite';
import { STORES, KEY_FIELD } from '../src/backup.js';

export const KEYED = new Set(Object.keys(KEY_FIELD));

export class ConflictError extends Error {
  name = 'ConflictError';
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS known (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS unknown (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS phrases (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS awards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tests (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
  `);
  // Store names are interpolated into SQL, so they must come from the fixed list.
  const table = (store) => {
    if (!STORES.includes(store)) throw new Error(`unknown store: ${store}`);
    return store;
  };
  const keyed = (store) => {
    if (!KEYED.has(table(store))) throw new Error(`${store} is not a keyed store`);
    return store;
  };
  // JSON keeps 1 and '1' apart, matching how the browser compares ids.
  const key = (wordId) => JSON.stringify(wordId);

  const getAll = (store) =>
    db.prepare(`SELECT data FROM ${table(store)} ORDER BY rowid`).all().map((r) => JSON.parse(r.data));

  function add(store, row) {
    if (!KEYED.has(table(store))) {
      db.prepare(`INSERT INTO ${store} (data) VALUES (?)`).run(JSON.stringify(row));
      return;
    }
    const { changes } = db
      .prepare(`INSERT INTO ${store} (word_id, data) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(key(row[KEY_FIELD[store]]), JSON.stringify(row));
    if (changes === 0) throw new ConflictError(`${store} already has ${row[KEY_FIELD[store]]}`);
  }

  const put = (store, row) => {
    db.prepare(`INSERT INTO ${keyed(store)} (word_id, data) VALUES (?, ?) ON CONFLICT (word_id) DO UPDATE SET data = excluded.data`)
      .run(key(row[KEY_FIELD[store]]), JSON.stringify(row));
  };

  const del = (store, wordId) => {
    db.prepare(`DELETE FROM ${keyed(store)} WHERE word_id = ?`).run(key(wordId));
  };

  const loadState = () => Object.fromEntries(STORES.map((s) => [s, getAll(s)]));

  function replaceState(state) {
    db.exec('BEGIN');
    try {
      for (const s of STORES) db.exec(`DELETE FROM ${s}`);
      for (const s of STORES) for (const row of state[s]) add(s, row);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return { getAll, add, put, del, loadState, replaceState, close: () => db.close() };
}
