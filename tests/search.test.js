import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWords } from '../src/search.js';

const w = (rank, lemma, gloss_en = '') => ({ id: rank, rank, lemma, gloss_en });
const words = [w(3, 'ørret', 'trout'), w(1, 'hus', 'house'), w(2, 'ære', 'honour'), w(4, 'åpen', 'open'), w(5, 'forhus', 'porch'), w(6, 'bolig', 'home; hus')];
const lemmas = (r) => r.map((x) => x.lemma);

test('blank query returns words by rank, respecting the limit', () => {
  assert.deepEqual(lemmas(searchWords(words, '  ', 3)), ['hus', 'ære', 'ørret']);
});

test('matches Norwegian letters case-insensitively (Review Focus 5)', () => {
  assert.deepEqual(lemmas(searchWords(words, 'Ø')), ['ørret']);
  assert.deepEqual(lemmas(searchWords(words, 'ÆRE')), ['ære']);
  assert.deepEqual(lemmas(searchWords(words, 'å')), ['åpen']);
});

test('orders prefix matches before contains before gloss matches', () => {
  assert.deepEqual(lemmas(searchWords(words, 'hus')), ['hus', 'forhus', 'bolig']);
});

test('no match returns an empty array', () => {
  assert.deepEqual(searchWords(words, 'zzz'), []);
});
