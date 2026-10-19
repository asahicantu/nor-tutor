import { BACKUP_VERSION, STORES } from './backup.js';

const OLD_DB = 'nor-tutor'; // IndexedDB name used before the SQLite switch

async function api(method, path, body) {
  const init = body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init).catch(() => {
    throw new Error('Cannot reach the local server. Start it with npm start and open http://127.0.0.1:5173');
  });
  if (res.ok) return res.status === 204 ? undefined : res.json();
  if (res.status === 401 && !/^\/api\/(me|login|signup)$/.test(path)) location.reload(); // session ended (server restarted): back to the login screen
  const err = new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  if (res.status === 409) err.name = 'ConstraintError'; // the name IndexedDB used; views rely on it
  throw err;
}

export const getAll = (db, store) => api('GET', `/api/${store}`);
export const add = (db, store, obj) => api('POST', `/api/${store}`, obj);
export const put = (db, store, obj) => api('PUT', `/api/${store}`, obj);
export const del = (db, store, wordId) => api('DELETE', `/api/${store}/${encodeURIComponent(JSON.stringify(wordId))}`);
export const me = () => api('GET', '/api/me');
export const login = (username, password) => api('POST', '/api/login', { username, password });
export const signup = (username, password) => api('POST', '/api/signup', { username, password });
export const changePassword = (current, next) => api('POST', '/api/password', { current, next });
export const logout = () => api('POST', '/api/logout');
export const loadState = (db) => api('GET', '/api/state');
export const replaceState = (db, state) => api('PUT', '/api/state', { version: BACKUP_VERSION, ...state });

// On first run after the switch, copy the old IndexedDB data into SQLite once. The old data is left in place.
export async function openDb(user) {
  const db = { notice: null };
  const state = await loadState(db);
  if (user !== 'default' || STORES.some((s) => state[s].length > 0)) return db; // only the default user (owner of the pre-accounts data) adopts old browser data
  const dbs = (await indexedDB.databases?.()) ?? [];
  if (!dbs.some((d) => d.name === OLD_DB)) return db;
  try {
    const old = await readOldDb();
    if (old.cards.length + old.reviews.length + old.tests.length === 0) return db;
    await replaceState(db, { ...old, known: [], unknown: [], phrases: [], awards: [], settings: [] });
    db.notice = `Moved your progress (${old.cards.length} cards, ${old.reviews.length} reviews, ${old.tests.length} tests) from the browser into data/nor-tutor.db.`;
  } catch (e) {
    db.notice = `Could not move your old browser data yet (${e.message}). It is still in the browser; the move will be retried next time.`;
  }
  return db;
}

function readOldDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OLD_DB);
    req.onupgradeneeded = () => req.transaction.abort(); // never create or change the old database
    req.onerror = () => reject(req.error ?? new Error('could not open old browser data'));
    req.onsuccess = () => {
      const idb = req.result;
      const out = { cards: [], reviews: [], tests: [] };
      const names = Object.keys(out).filter((n) => idb.objectStoreNames.contains(n));
      if (names.length === 0) {
        idb.close();
        resolve(out);
        return;
      }
      const t = idb.transaction(names);
      for (const n of names) {
        const r = t.objectStore(n).getAll();
        r.onsuccess = () => (out[n] = r.result);
      }
      t.oncomplete = () => {
        idb.close();
        resolve(out);
      };
      t.onerror = () => {
        idb.close();
        reject(t.error);
      };
    };
  });
}
