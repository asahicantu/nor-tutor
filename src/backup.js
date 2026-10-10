import { GRADES } from './srs.js';

export const BACKUP_VERSION = 1;

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isId = (x) => typeof x === 'number' || typeof x === 'string';
const isGrade = (g) => typeof g === 'string' && Object.hasOwn(GRADES, g);

export function serialize({ cards, reviews, tests }, now) {
  return JSON.stringify(
    { version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), cards, reviews, tests },
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
  if (data.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${data.version}`);
  for (const key of ['cards', 'reviews', 'tests']) {
    if (!Array.isArray(data[key])) throw new Error(`Backup field "${key}" must be an array`);
  }
  const seen = new Set();
  data.cards.forEach((c, i) => {
    const ok = isObj(c) && isId(c.wordId) && num(c.ease) && num(c.interval) && num(c.reps) && num(c.lapses) && num(c.due);
    if (!ok) throw new Error(`Invalid card at index ${i}`);
    if (seen.has(c.wordId)) throw new Error(`Duplicate card for word ${c.wordId}`);
    seen.add(c.wordId);
  });
  data.reviews.forEach((r, i) => {
    const ok =
      isObj(r) &&
      isId(r.wordId) &&
      num(r.timestamp) &&
      isGrade(r.grade) &&
      (r.ms === undefined || num(r.ms)) &&
      (r.prevInterval === undefined || num(r.prevInterval));
    if (!ok) throw new Error(`Invalid review at index ${i}`);
  });
  data.tests.forEach((t, i) => {
    if (!(isObj(t) && num(t.timestamp) && num(t.estimate))) throw new Error(`Invalid test at index ${i}`);
  });
  return { cards: data.cards, reviews: data.reviews, tests: data.tests };
}
