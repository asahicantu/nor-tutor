import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, ConflictError } from '../tools/store.mjs';

const card = (wordId, reps = 0) => ({ wordId, ease: 2.5, interval: 0, reps, lapses: 0, due: 1 });

test('starts empty', () => {
  assert.deepEqual(openStore(':memory:').as(1).loadState(), { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [], settings: [] });
});

test('unkeyed stores keep insertion order', () => {
  const s = openStore(':memory:').as(1);
  s.add('reviews', { wordId: 1, timestamp: 2, grade: 'good' });
  s.add('reviews', { wordId: 1, timestamp: 1, grade: 'again' });
  assert.deepEqual(s.getAll('reviews').map((r) => r.timestamp), [2, 1]);
});

test('add on a keyed store refuses an existing key', () => {
  const s = openStore(':memory:').as(1);
  s.add('known', { wordId: 1, timestamp: 1 });
  assert.throws(() => s.add('known', { wordId: 1, timestamp: 2 }), ConflictError);
  assert.deepEqual(s.getAll('known'), [{ wordId: 1, timestamp: 1 }]);
});

test('numeric and string ids are different keys and round-trip exactly', () => {
  const s = openStore(':memory:').as(1);
  s.add('known', { wordId: 1, timestamp: 1 });
  s.add('known', { wordId: '1', timestamp: 2 });
  s.add('known', { wordId: 'a/b', timestamp: 3 });
  assert.deepEqual(s.getAll('known').map((k) => k.wordId), [1, '1', 'a/b']);
  s.del('known', '1');
  s.del('known', 'a/b');
  assert.deepEqual(s.getAll('known').map((k) => k.wordId), [1]);
});

test('put upserts keyed rows', () => {
  const s = openStore(':memory:').as(1);
  s.put('cards', card(1));
  s.put('cards', card(1, 3));
  assert.deepEqual(s.getAll('cards'), [card(1, 3)]);
});

test('put/del need a keyed store; unknown store names are refused', () => {
  const s = openStore(':memory:').as(1);
  assert.throws(() => s.put('reviews', { wordId: 1, timestamp: 1, grade: 'good' }), /keyed/);
  assert.throws(() => s.del('tests', 1), /keyed/);
  assert.throws(() => s.getAll('cards; DROP TABLE known'), /unknown store/);
});

test('replaceState swaps all stores', () => {
  const s = openStore(':memory:').as(1);
  s.add('known', { wordId: 9, timestamp: 1 });
  const next = { cards: [card(1)], reviews: [], tests: [], known: [{ wordId: 2, timestamp: 5 }], unknown: [], phrases: [], awards: [], settings: [] };
  s.replaceState(next);
  assert.deepEqual(s.loadState(), next);
});

test('replaceState rolls back on failure, keeping old data', () => {
  const s = openStore(':memory:').as(1);
  s.add('known', { wordId: 9, timestamp: 1 });
  assert.throws(() => s.replaceState({ cards: [card(1), card(1)], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [], settings: [] }), ConflictError);
  assert.deepEqual(s.loadState(), { cards: [], reviews: [], tests: [], known: [{ wordId: 9, timestamp: 1 }], unknown: [], phrases: [], awards: [], settings: [] });
});

test('data survives closing and reopening the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nor-tutor-'));
  try {
    const path = join(dir, 'test.db');
    const ra = openStore(path);
    const a = ra.as(1);
    a.add('known', { wordId: 7, timestamp: 1 });
    ra.close();
    const rb = openStore(path);
    const b = rb.as(1);
    assert.deepEqual(b.getAll('known'), [{ wordId: 7, timestamp: 1 }]);
    rb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings: put upserts by key and round-trips through loadState', () => {
  const s = openStore(':memory:').as(1);
  s.put('settings', { key: 'profileName', value: 'Asahi' });
  s.put('settings', { key: 'profileName', value: 'Åse' });
  assert.deepEqual(s.getAll('settings'), [{ key: 'profileName', value: 'Åse' }]);
  assert.deepEqual(s.loadState().settings, [{ key: 'profileName', value: 'Åse' }]);
});

test('awards: add refuses a duplicate id', () => {
  const s = openStore(':memory:').as(1);
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
    const r = openStore(path);
    const s = r.as(1);
    assert.deepEqual(s.loadState().awards, []);
    s.add('awards', { awardId: 'first-test', timestamp: 1 });
    assert.equal(s.getAll('awards').length, 1);
    r.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('users have separate data, even for the same word id', () => {
  const root = openStore(':memory:');
  const a = root.as(root.createUser('alice', 'secret1'));
  const b = root.as(root.createUser('bob', 'secret2'));
  a.add('cards', card(1, 5));
  b.add('cards', card(1, 9));
  a.add('reviews', { wordId: 1, timestamp: 1, grade: 'good' });
  assert.equal(a.getAll('cards')[0].reps, 5);
  assert.equal(b.getAll('cards')[0].reps, 9);
  assert.equal(b.getAll('reviews').length, 0);
  b.replaceState({ cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [], settings: [] });
  assert.equal(a.getAll('cards').length, 1);
  assert.equal(a.getAll('reviews').length, 1);
});

test('verifyUser checks the password; usernames are unique ignoring case', () => {
  const root = openStore(':memory:');
  const id = root.createUser('Alice', 'secret1');
  assert.equal(root.verifyUser('alice', 'secret1').id, id);
  assert.equal(root.verifyUser('alice', 'wrong'), null);
  assert.equal(root.verifyUser('nobody', 'secret1'), null);
  assert.throws(() => root.createUser('ALICE', 'other12'), ConflictError);
  assert.equal(root.verifyUser('default', 'default').id, 1);
});

test('legacy database: every row moves to the default user, order and ids kept, backup written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-'));
  const file = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE cards (word_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);`);
    old.prepare('INSERT INTO cards VALUES (?, ?)').run('2', JSON.stringify(card(2)));
    old.prepare('INSERT INTO cards VALUES (?, ?)').run('1', JSON.stringify(card(1)));
    old.prepare('INSERT INTO reviews (id, data) VALUES (7, ?)').run(JSON.stringify({ wordId: 2, timestamp: 9, grade: 'good' }));
    old.close();
    const root = openStore(file);
    const me = root.as(root.verifyUser('default', 'default').id);
    assert.deepEqual(me.getAll('cards').map((c) => c.wordId), [2, 1]);
    assert.equal(me.getAll('reviews').length, 1);
    me.add('reviews', { wordId: 1, timestamp: 10, grade: 'good' });
    assert.equal(me.getAll('reviews').length, 2);
    assert.equal(root.as(root.createUser('x1x', 'secret1')).getAll('cards').length, 0);
    root.close();
    assert.ok(existsSync(`${file}.pre-users.bak`));
    openStore(file).close(); // reopening must not migrate again
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
