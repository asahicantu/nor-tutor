import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePseudoWords } from '../src/pseudowords.js';
import { mulberry32 } from '../src/rng.js';

test('generates the requested number of unique lowercase words', () => {
  const words = generatePseudoWords(30, mulberry32(1), ['hus']);
  assert.equal(words.length, 30);
  assert.equal(new Set(words).size, 30);
  for (const w of words) {
    assert.match(w, /^[a-zæøå]{4,}$/);
  }
});

test('is deterministic for a seed', () => {
  assert.deepEqual(generatePseudoWords(10, mulberry32(5), []), generatePseudoWords(10, mulberry32(5), []));
});

test('never returns a word from the real list', () => {
  const first = generatePseudoWords(20, mulberry32(1), []);
  const second = generatePseudoWords(20, mulberry32(1), first);
  assert.equal(second.length, 20);
  for (const w of second) assert.ok(!first.includes(w));
});
