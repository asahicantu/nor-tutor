import { GRADES } from './srs.js';

export const BACKUP_VERSION = 5;
export const STORES = ['cards', 'reviews', 'tests', 'known', 'unknown', 'phrases', 'awards', 'settings'];
// Stores that older backups predate: the version that introduced each one.
const ADDED_IN = { known: 2, unknown: 3, phrases: 3, awards: 4, settings: 5 };
// Field that identifies a row in the stores that hold one row per word/phrase.
export const KEY_FIELD = { cards: 'wordId', known: 'wordId', unknown: 'wordId', phrases: 'phraseId', awards: 'awardId', settings: 'key' };

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isId = (x) => typeof x === 'number' || typeof x === 'string';
const isGrade = (g) => typeof g === 'string' && Object.hasOwn(GRADES, g);

const ROW_CHECKS = {
  cards: (c) => isObj(c) && isId(c.wordId) && num(c.ease) && num(c.interval) && num(c.reps) && num(c.lapses) && num(c.due),
  reviews: (r) =>
    isObj(r) &&
    isId(r.wordId) &&
    num(r.timestamp) &&
    isGrade(r.grade) &&
    (r.ms === undefined || num(r.ms)) &&
    (r.prevInterval === undefined || num(r.prevInterval)),
  tests: (t) =>
    isObj(t) &&
    num(t.timestamp) &&
    num(t.estimate) &&
    num(t.ciLow) &&
    num(t.ciHigh) &&
    Array.isArray(t.bands) &&
    t.bands.every((b) => isObj(b) && typeof b.band === 'string' && num(b.pCorrected)),
  known: (k) => isObj(k) && isId(k.wordId) && num(k.timestamp),
  unknown: (u) => isObj(u) && isId(u.wordId) && num(u.count) && u.count >= 1 && num(u.firstAt) && num(u.lastAt),
  phrases: (p) => isObj(p) && isId(p.phraseId) && num(p.seen) && num(p.got) && num(p.lastAt),
  awards: (a) => isObj(a) && typeof a.awardId === 'string' && a.awardId !== '' && num(a.timestamp),
  settings: (s) => isObj(s) && typeof s.key === 'string' && s.key !== '' && s.key.length <= 40 && typeof s.value === 'string' && s.value.length <= 200,
};
const LABELS = { cards: 'card', reviews: 'review', tests: 'test', known: 'known word', unknown: 'unknown word', phrases: 'phrase', awards: 'award', settings: 'setting' };
const DUPLICATE = {
  cards: (id) => `Duplicate card for word ${id}`,
  known: (id) => `Duplicate known word ${id}`,
  unknown: (id) => `Duplicate unknown word ${id}`,
  phrases: (id) => `Duplicate phrase ${id}`,
  awards: (id) => `Duplicate award ${id}`,
  settings: (id) => `Duplicate setting ${id}`,
};

export const validRow = (store, row) => Object.hasOwn(ROW_CHECKS, store) && ROW_CHECKS[store](row);

export function serialize(state, now) {
  return JSON.stringify(
    { version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), ...Object.fromEntries(STORES.map((s) => [s, state[s]])) },
    null,
    2,
  );
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Backup is not valid JSON');
  }
  if (data === null || typeof data !== 'object') throw new Error('File is not a backup');
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION) throw new Error(`Unsupported backup version: ${data.version}`);
  data = { ...Object.fromEntries(STORES.filter((s) => data.version < (ADDED_IN[s] ?? 0)).map((s) => [s, []])), ...data };
  const out = {};
  for (const store of STORES) {
    const rows = data[store];
    if (!Array.isArray(rows)) throw new Error(`Backup field "${store}" must be an array`);
    const seen = new Set();
    rows.forEach((row, i) => {
      if (!validRow(store, row)) throw new Error(`Invalid ${LABELS[store]} at index ${i}`);
      if (!DUPLICATE[store]) return;
      if (seen.has(row[KEY_FIELD[store]])) throw new Error(DUPLICATE[store](row[KEY_FIELD[store]]));
      seen.add(row[KEY_FIELD[store]]);
    });
    out[store] = rows;
  }
  return out;
}
