import { GRADES } from './srs.js';

export const BACKUP_VERSION = 1;

const num = (x) => typeof x === 'number' && Number.isFinite(x);

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
  data.cards.forEach((c, i) => {
    const ok = c && c.wordId !== undefined && c.wordId !== null && num(c.ease) && num(c.interval) && num(c.due);
    if (!ok) throw new Error(`Invalid card at index ${i}`);
  });
  data.reviews.forEach((r, i) => {
    const ok = r && r.wordId !== undefined && r.wordId !== null && num(r.timestamp) && r.grade in GRADES;
    if (!ok) throw new Error(`Invalid review at index ${i}`);
  });
  data.tests.forEach((t, i) => {
    if (!(t && num(t.timestamp) && num(t.estimate))) throw new Error(`Invalid test at index ${i}`);
  });
  return { cards: data.cards, reviews: data.reviews, tests: data.tests };
}
