import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, shuffle } from '../src/rng.js';

test('mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('mulberry32 differs across seeds and stays in [0,1)', () => {
  const a = mulberry32(1), b = mulberry32(2);
  assert.notEqual(a(), b());
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test('shuffle keeps elements, does not mutate input, is deterministic', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const copy = input.slice();
  const out = shuffle(input, mulberry32(3));
  assert.deepEqual(input, copy);
  assert.deepEqual(out.slice().sort((x, y) => x - y), copy);
  assert.deepEqual(out, shuffle(input, mulberry32(3)));
});
