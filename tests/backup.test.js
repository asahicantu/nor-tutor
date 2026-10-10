import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseBackup, BACKUP_VERSION } from '../src/backup.js';

const state = {
  cards: [{ wordId: 1, ease: 2.5, interval: 6, reps: 2, lapses: 0, due: 1000 }],
  reviews: [{ wordId: 1, timestamp: 900, grade: 'good', ms: 2500, prevInterval: 1 }],
  tests: [{ timestamp: 800, estimate: 4200, ciLow: 3900, ciHigh: 4500, bands: [] }],
};

test('round trip preserves data', () => {
  const text = serialize(state, Date.UTC(2026, 9, 10));
  assert.equal(JSON.parse(text).version, BACKUP_VERSION);
  assert.deepEqual(parseBackup(text), state);
});

test('rejects non-JSON', () => {
  assert.throws(() => parseBackup('not json {'), /not valid JSON/);
});

test('rejects wrong version and non-objects', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 99, cards: [], reviews: [], tests: [] })), /Unsupported backup version: 99/);
  assert.throws(() => parseBackup('[]'), /Unsupported backup version/);
  assert.throws(() => parseBackup('null'), /not a backup/);
});

test('rejects missing arrays', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 1, cards: [], reviews: [] })), /"tests" must be an array/);
});

test('rejects malformed rows', () => {
  const bad = (patch) => JSON.stringify({ version: 1, ...state, ...patch });
  assert.throws(() => parseBackup(bad({ cards: [{ wordId: 1 }] })), /card/);
  assert.throws(() => parseBackup(bad({ reviews: [{ wordId: 1, timestamp: 1, grade: 'wow' }] })), /review/);
  assert.throws(() => parseBackup(bad({ tests: [{ timestamp: 'x', estimate: 1 }] })), /test/);
});
