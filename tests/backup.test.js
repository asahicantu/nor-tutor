import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseBackup, BACKUP_VERSION } from '../src/backup.js';

const state = {
  cards: [{ wordId: 1, ease: 2.5, interval: 6, reps: 2, lapses: 0, due: 1000 }],
  reviews: [{ wordId: 1, timestamp: 900, grade: 'good', ms: 2500, prevInterval: 1 }],
  tests: [{ timestamp: 800, estimate: 4200, ciLow: 3900, ciHigh: 4500, bands: [{ band: 'b1', pCorrected: 0.9 }] }],
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
  assert.throws(() => parseBackup(bad({ cards: [{ wordId: 1 }] })), /Invalid card at index 0/);
  assert.throws(() => parseBackup(bad({ reviews: [{ wordId: 1, timestamp: 1, grade: 'wow' }] })), /Invalid review at index 0/);
  assert.throws(() => parseBackup(bad({ tests: [{ timestamp: 'x', estimate: 1 }] })), /Invalid test at index 0/);
  const t = state.tests[0];
  for (const row of [{ ...t, bands: undefined }, { ...t, bands: [5] }, { ...t, bands: [{ band: 'b1' }] }, { ...t, ciLow: undefined }]) {
    assert.throws(() => parseBackup(bad({ tests: [row] })), /Invalid test at index 0/);
  }
  const real = { timestamp: 800, estimate: 4200, ciLow: 3900, ciHigh: 4500, falseAlarmRate: 0.1, pseudoTotal: 10, listSize: 60,
    bands: [{ band: 'b1', size: 100, sampled: 10, known: 9, pCorrected: 0.9 }] };
  assert.deepEqual(parseBackup(bad({ tests: [real] })).tests, [real]);
});

const good = (patch) => JSON.stringify({ version: 1, ...state, ...patch });
const goodCard = { wordId: 2, ease: 2.5, interval: 1, reps: 1, lapses: 0, due: 5 };
const goodReview = { wordId: 1, timestamp: 900, grade: 'good' };

test('rejects prototype-inherited grade names', () => {
  for (const grade of ['constructor', 'toString', '__proto__', ['good']]) {
    assert.throws(() => parseBackup(good({ reviews: [{ ...goodReview, grade }] })), /Invalid review/, String(grade));
  }
});

test('rejects bad wordId values', () => {
  for (const wordId of [null, {}, true, undefined]) {
    assert.throws(() => parseBackup(good({ cards: [{ ...goodCard, wordId }] })), /Invalid card at index 0/, String(wordId));
  }
});

test('rejects non-object rows', () => {
  assert.throws(() => parseBackup(good({ cards: [5] })), /Invalid card at index 0/);
  assert.throws(() => parseBackup(good({ reviews: [null] })), /Invalid review at index 0/);
  assert.throws(() => parseBackup(good({ tests: [[]] })), /Invalid test at index 0/);
});

test('rejects cards missing reps or with non-numeric lapses', () => {
  const { reps, ...noReps } = goodCard;
  assert.throws(() => parseBackup(good({ cards: [noReps] })), /Invalid card at index 0/);
  assert.throws(() => parseBackup(good({ cards: [{ ...goodCard, lapses: 'x' }] })), /Invalid card at index 0/);
});

test('review ms and prevInterval are optional but must be numbers when present', () => {
  assert.throws(() => parseBackup(good({ reviews: [{ ...goodReview, ms: 'fast' }] })), /Invalid review at index 0/);
  assert.throws(() => parseBackup(good({ reviews: [{ ...goodReview, prevInterval: null }] })), /Invalid review at index 0/);
  assert.equal(parseBackup(good({ reviews: [goodReview] })).reviews.length, 1);
});

test('rejects duplicate card wordIds', () => {
  assert.throws(() => parseBackup(good({ cards: [goodCard, { ...goodCard }] })), /Duplicate card/);
});
