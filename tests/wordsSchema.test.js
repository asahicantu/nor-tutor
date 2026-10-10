import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWords } from '../src/wordsSchema.js';
import { BANDS, bandOf } from '../src/estimator.js';

const good = () => ({
  id: 1, lemma: 'hus', rank: 310, pos: 'noun', gloss_en: 'house', def_no: 'Bygning.',
  forms: ['hus'], notes: '', collocations: [], examples: [{ no: 'Et hus.', en: 'A house.' }],
});

test('data/words.json is valid and covers every band', async () => {
  const words = JSON.parse(await readFile(new URL('../data/words.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateWords(words), []);
  for (const b of BANDS) assert.ok(words.some((w) => bandOf(w.rank)?.id === b.id), `no word in ${b.id}`);
});

test('accepts a good record', () => assert.deepEqual(validateWords([good()]), []));

test('rejects non-array and empty list', () => {
  assert.ok(validateWords({}).length > 0);
  assert.ok(validateWords([]).length > 0);
});

test('rejects duplicate ids, duplicate ranks, bad ranks', () => {
  const a = good(), b = { ...good(), lemma: 'gå' };
  assert.ok(validateWords([a, b]).some((e) => /duplicate id/.test(e)));
  const c = { ...good(), id: 2, lemma: 'gå' };
  assert.ok(validateWords([a, c]).some((e) => /duplicate rank/.test(e)));
  assert.ok(validateWords([{ ...good(), rank: 0 }]).some((e) => /rank/.test(e)));
  assert.ok(validateWords([{ ...good(), rank: 1.5 }]).some((e) => /rank/.test(e)));
});

test('rejects missing glosses, definitions and examples', () => {
  assert.ok(validateWords([{ ...good(), gloss_en: '' }]).some((e) => /gloss_en/.test(e)));
  assert.ok(validateWords([{ ...good(), def_no: ' ' }]).some((e) => /def_no/.test(e)));
  assert.ok(validateWords([{ ...good(), examples: [] }]).some((e) => /examples/.test(e)));
  assert.ok(validateWords([{ ...good(), examples: [{ no: 'x' }] }]).some((e) => /examples/.test(e)));
});
