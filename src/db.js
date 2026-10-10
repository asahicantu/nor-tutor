const DB_NAME = 'nor-tutor';
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cards', { keyPath: 'wordId' });
      db.createObjectStore('reviews', { autoIncrement: true });
      db.createObjectStore('tests', { autoIncrement: true });
    };
    req.onblocked = () => reject(new Error('Database upgrade is blocked: close other tabs of this app and reload'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function transact(db, stores, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = (ev) => reject(ev.target?.error ?? t.error ?? new Error('transaction error'));
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    fn(t);
  });
}

export const getAll = (db, store) => request(db.transaction(store).objectStore(store).getAll());
export const put = (db, store, obj) => transact(db, [store], (t) => t.objectStore(store).put(obj));
export const add = (db, store, obj) => transact(db, [store], (t) => t.objectStore(store).add(obj));

export async function loadState(db) {
  const [cards, reviews, tests] = await Promise.all(['cards', 'reviews', 'tests'].map((s) => getAll(db, s)));
  return { cards, reviews, tests };
}

export function replaceState(db, { cards, reviews, tests }) {
  return transact(db, ['cards', 'reviews', 'tests'], (t) => {
    try {
      for (const [name, rows] of [['cards', cards], ['reviews', reviews], ['tests', tests]]) {
        const store = t.objectStore(name);
        store.clear();
        rows.forEach((r) => store.add(r));
      }
    } catch (e) {
      t.abort();
      throw e;
    }
  });
}
