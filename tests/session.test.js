import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStats, reviewSessionStats } from '../src/session.js';

const before = (rows) => new Map(rows.map(([id, count]) => [id, { wordId: id, count }]));

test('sessionStats splits known and unknown, and unknown into new words and words seen before', () => {
  const answers = [
    { wordId: 1, known: true }, { wordId: 2, known: false }, { wordId: 3, known: false }, { wordId: 4, known: false }, { wordId: 5, known: true },
  ];
  const s = sessionStats(answers, before([[3, 1], [4, 4]])); // 3 was missed once before, 4 four times, 2 never
  assert.deepEqual([s.total, s.known, s.unknown], [5, 2, 3]);
  assert.deepEqual([s.newWords, s.seenBefore], [1, 2]);
  assert.deepEqual(s.buckets, [
    { label: '1st time', n: 1 }, // word 2
    { label: '2nd time', n: 1 }, // word 3
    { label: '3rd time', n: 0 },
    { label: '4 times or more', n: 1 }, // word 4 (now the 5th)
  ]);
  assert.deepEqual(s.mostMissed, { wordId: 4, times: 5 });
});

test('sessionStats for a perfect session or no answers has zeros and no most-missed word', () => {
  const perfect = sessionStats([{ wordId: 1, known: true }, { wordId: 2, known: true }], before([]));
  assert.deepEqual([perfect.total, perfect.known, perfect.unknown, perfect.newWords, perfect.seenBefore], [2, 2, 0, 0, 0]);
  assert.equal(perfect.mostMissed, null);
  assert.deepEqual(perfect.buckets.map((b) => b.n), [0, 0, 0, 0]);
  const empty = sessionStats([], before([]));
  assert.deepEqual([empty.total, empty.known, empty.unknown], [0, 0, 0]);
});

test('sessionStats counts the same unknown word once even if it was answered twice', () => {
  const s = sessionStats([{ wordId: 7, known: false }, { wordId: 7, known: false }], before([]));
  assert.equal(s.unknown, 1);
  assert.equal(s.total, 1);
});

test('reviewSessionStats summarises grades and time for a review session', () => {
  const s = reviewSessionStats([
    { grade: 'good', ms: 4000 }, { grade: 'again', ms: 10000 }, { grade: 'easy', ms: 1000 }, { grade: 'hard', ms: 5000 }, { grade: 'good', ms: 0 },
  ]);
  assert.deepEqual([s.total, s.again, s.hard, s.good, s.easy], [5, 1, 1, 2, 1]);
  assert.equal(s.remembered, 4); // everything except "again"
  assert.equal(s.pctRemembered, 80);
  assert.equal(s.totalSeconds, 20);
  assert.equal(s.avgSeconds, 4);
});

test('reviewSessionStats on an empty session has zeros and no NaN', () => {
  const s = reviewSessionStats([]);
  assert.deepEqual([s.total, s.remembered, s.pctRemembered, s.totalSeconds, s.avgSeconds], [0, 0, 0, 0, 0]);
});
