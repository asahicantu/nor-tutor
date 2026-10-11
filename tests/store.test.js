import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, ConflictError } from '../tools/store.mjs';

const card = (wordId, reps = 0) => ({ wordId, ease: 2.5, interval: 0, reps, lapses: 0, due: 1 });

test('starts empty', () => {
  assert.deepEqual(openStore(':memory:').loadState(), { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [] });
});

test('unkeyed stores keep insertion order', () => {
  const s = openStore(':memory:');
  s.add('reviews', { wordId: 1, timestamp: 2, grade: 'good' });
  s.add('reviews', { wordId: 1, timestamp: 1, grade: 'again' });
  assert.deepEqual(s.getAll('reviews').map((r) => r.timestamp), [2, 1]);
});

test('add on a keyed store refuses an existing key', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 1, timestamp: 1 });
  assert.throws(() => s.add('known', { wordId: 1, timestamp: 2 }), ConflictError);
  assert.deepEqual(s.getAll('known'), [{ wordId: 1, timestamp: 1 }]);
});

test('numeric and string ids are different keys and round-trip exactly', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 1, timestamp: 1 });
  s.add('known', { wordId: '1', timestamp: 2 });
  s.add('known', { wordId: 'a/b', timestamp: 3 });
  assert.deepEqual(s.getAll('known').map((k) => k.wordId), [1, '1', 'a/b']);
  s.del('known', '1');
  s.del('known', 'a/b');
  assert.deepEqual(s.getAll('known').map((k) => k.wordId), [1]);
});

test('put upserts keyed rows', () => {
  const s = openStore(':memory:');
  s.put('cards', card(1));
  s.put('cards', card(1, 3));
  assert.deepEqual(s.getAll('cards'), [card(1, 3)]);
});

test('put/del need a keyed store; unknown store names are refused', () => {
  const s = openStore(':memory:');
  assert.throws(() => s.put('reviews', { wordId: 1, timestamp: 1, grade: 'good' }), /keyed/);
  assert.throws(() => s.del('tests', 1), /keyed/);
  assert.throws(() => s.getAll('cards; DROP TABLE known'), /unknown store/);
});

test('replaceState swaps all stores', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 9, timestamp: 1 });
  const next = { cards: [card(1)], reviews: [], tests: [], known: [{ wordId: 2, timestamp: 5 }], unknown: [], phrases: [], awards: [] };
  s.replaceState(next);
  assert.deepEqual(s.loadState(), next);
});

test('replaceState rolls back on failure, keeping old data', () => {
  const s = openStore(':memory:');
  s.add('known', { wordId: 9, timestamp: 1 });
  assert.throws(() => s.replaceState({ cards: [card(1), card(1)], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [] }), ConflictError);
  assert.deepEqual(s.loadState(), { cards: [], reviews: [], tests: [], known: [{ wordId: 9, timestamp: 1 }], unknown: [], phrases: [], awards: [] });
});

test('data survives closing and reopening the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nor-tutor-'));
  try {
    const path = join(dir, 'test.db');
    const a = openStore(path);
    a.add('known', { wordId: 7, timestamp: 1 });
    a.close();
    const b = openStore(path);
    assert.deepEqual(b.getAll('known'), [{ wordId: 7, timestamp: 1 }]);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('awards: add refuses a duplicate id', () => {
  const s = openStore(':memory:');
  s.add('awards', { awardId: 'first-test', timestamp: 1 });
  assert.throws(() => s.add('awards', { awardId: 'first-test', timestamp: 2 }), ConflictError);
  assert.deepEqual(s.getAll('awards'), [{ awardId: 'first-test', timestamp: 1 }]);
});

test('opens a database created before the awards table existed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-'));
  try {
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec('CREATE TABLE cards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    old.close();
    const s = openStore(path);
    assert.deepEqual(s.loadState().awards, []);
    s.add('awards', { awardId: 'first-test', timestamp: 1 });
    assert.equal(s.getAll('awards').length, 1);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
