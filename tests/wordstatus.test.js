import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpUnknown, buildStatus, mostMissed } from '../src/wordstatus.js';

test('bumpUnknown starts at 1 then counts every miss, keeping firstAt', () => {
  const a = bumpUnknown(undefined, 7, 100);
  assert.deepEqual(a, { wordId: 7, count: 1, firstAt: 100, lastAt: 100 });
  assert.deepEqual(bumpUnknown(a, 7, 250), { wordId: 7, count: 2, firstAt: 100, lastAt: 250 });
});

test('mostMissed ranks by count, skips known words, honours the limit', () => {
  const unknown = [
    { wordId: 1, count: 2, firstAt: 1, lastAt: 5 },
    { wordId: 2, count: 5, firstAt: 1, lastAt: 3 },
    { wordId: 3, count: 5, firstAt: 1, lastAt: 9 },
    { wordId: 4, count: 9, firstAt: 1, lastAt: 9 },
  ];
  const s = buildStatus({ unknown, known: [{ wordId: 4, timestamp: 1 }], cards: [{ wordId: 1 }] });
  assert.deepEqual(mostMissed(s, 3).map((r) => r.wordId), [3, 2, 1]);
  assert.deepEqual(mostMissed(s, 1).map((r) => r.wordId), [3]);
  assert.ok(s.deck.has(1) && !s.deck.has(2));
});
