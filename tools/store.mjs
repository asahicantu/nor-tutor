import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { STORES, KEY_FIELD } from '../src/backup.js';
import { hashPassword, checkPassword } from './auth.mjs';

export const KEYED = new Set(Object.keys(KEY_FIELD));
// Owner of all data that predates user accounts.
export const DEFAULT_USER = 'default';
export const DEFAULT_PASSWORD = 'default';

export class ConflictError extends Error {
  name = 'ConflictError';
}

const tableSql = (s) =>
  KEYED.has(s)
    ? `CREATE TABLE IF NOT EXISTS ${s} (user_id INTEGER NOT NULL, word_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, word_id))`
    : `CREATE TABLE IF NOT EXISTS ${s} (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, data TEXT NOT NULL)`;

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL)`);

  const createUser = (username, password) => {
    const { salt, hash } = hashPassword(password);
    try {
      return Number(db.prepare('INSERT INTO users (username, salt, hash, created) VALUES (?, ?, ?, ?)').run(username, salt, hash, Date.now()).lastInsertRowid);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ConflictError('That username is taken');
      throw e;
    }
  };
  // Returns { id, username } for a correct login, else null.
  const verifyUser = (username, password) => {
    const u = db.prepare('SELECT id, username, salt, hash FROM users WHERE username = ?').get(username);
    return u && checkPassword(password, u) ? { id: u.id, username: u.username } : null;
  };
  // False when the current password is wrong.
  const changePassword = (id, current, next) => {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
    if (!u || !verifyUser(u.username, current)) return false;
    const { salt, hash } = hashPassword(next);
    db.prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?').run(salt, hash, id);
    return true;
  };
  const getUser = (id) => db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);

  if (!db.prepare('SELECT 1 FROM users').get()) createUser(DEFAULT_USER, DEFAULT_PASSWORD); // id 1

  // Pre-accounts tables have no user_id: give every existing row to the default user, keeping row order and ids.
  const hasCol = (s) => db.prepare(`PRAGMA table_info(${s})`).all().some((c) => c.name === 'user_id');
  const old = STORES.filter((s) => db.prepare(`PRAGMA table_info(${s})`).all().length && !hasCol(s));
  if (old.length) {
    if (path !== ':memory:' && !existsSync(`${path}.pre-users.bak`)) copyFileSync(path, `${path}.pre-users.bak`);
    const owner = db.prepare('SELECT id FROM users WHERE username = ?').get(DEFAULT_USER).id;
    db.exec('BEGIN');
    try {
      for (const s of old) {
        db.exec(`ALTER TABLE ${s} RENAME TO ${s}_old`);
        db.exec(tableSql(s));
        db.exec(
          KEYED.has(s)
            ? `INSERT INTO ${s} (user_id, word_id, data) SELECT ${owner}, word_id, data FROM ${s}_old ORDER BY rowid`
            : `INSERT INTO ${s} (id, user_id, data) SELECT id, ${owner}, data FROM ${s}_old ORDER BY id`,
        );
        db.exec(`DROP TABLE ${s}_old`);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  for (const s of STORES) db.exec(tableSql(s));

  // Rows are only ever read or written for one user: as(userId) returns that user's view of the data.
  function as(uid) {
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
      db.prepare(`SELECT data FROM ${table(store)} WHERE user_id = ? ORDER BY ${KEYED.has(store) ? 'rowid' : 'id'}`).all(uid).map((r) => JSON.parse(r.data));

    function add(store, row) {
      if (!KEYED.has(table(store))) {
        db.prepare(`INSERT INTO ${store} (user_id, data) VALUES (?, ?)`).run(uid, JSON.stringify(row));
        return;
      }
      const { changes } = db
        .prepare(`INSERT INTO ${store} (user_id, word_id, data) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
        .run(uid, key(row[KEY_FIELD[store]]), JSON.stringify(row));
      if (changes === 0) throw new ConflictError(`${store} already has ${row[KEY_FIELD[store]]}`);
    }

    const put = (store, row) => {
      db.prepare(`INSERT INTO ${keyed(store)} (user_id, word_id, data) VALUES (?, ?, ?) ON CONFLICT (user_id, word_id) DO UPDATE SET data = excluded.data`)
        .run(uid, key(row[KEY_FIELD[store]]), JSON.stringify(row));
    };

    const del = (store, wordId) => {
      db.prepare(`DELETE FROM ${keyed(store)} WHERE user_id = ? AND word_id = ?`).run(uid, key(wordId));
    };

    const loadState = () => Object.fromEntries(STORES.map((s) => [s, getAll(s)]));

    function replaceState(state) {
      db.exec('BEGIN');
      try {
        for (const s of STORES) db.prepare(`DELETE FROM ${s} WHERE user_id = ?`).run(uid);
        for (const s of STORES) for (const row of state[s]) add(s, row);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }

    return { getAll, add, put, del, loadState, replaceState };
  }

  return { as, createUser, verifyUser, changePassword, getUser, close: () => db.close() };
}
