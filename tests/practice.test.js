import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/rng.js';
import { compareSentence } from '../src/typing.js';
import { genderOf, verbTask, choices, collocationItem, mistakesOf, skillBreakdown, mistakeCounts, accuracyByType, MODES, MISTAKES } from '../src/practice.js';

const word = (id, lemma, pos, extra = {}) => ({ id, lemma, rank: id, pos, gloss_en: `${lemma}-en`, def_no: 'x', forms: [lemma], collocations: [], examples: [], ...extra });
const hus = word(2, 'hus', 'noun (et)', { forms: ['hus', 'huset', 'hus', 'husene'], collocations: ['bygge hus', 'hus', 'kjøpe et nytt hus'] });
const gå = word(1, 'gå', 'verb', { forms: ['gå', 'går', 'gikk', 'gått'], collocations: ['gå tur', 'gikk i stykker'] });
const bok = word(3, 'bok', 'noun (en/ei)');
const bil = word(4, 'bil', 'noun (en)');
const klær = word(5, 'klær', 'noun (plural)');
const stor = word(6, 'stor', 'adjective');

test('genderOf reads the gender from the word type and accepts both for en/ei nouns', () => {
  assert.deepEqual(genderOf(hus), ['et']);
  assert.deepEqual(genderOf(bil), ['en']);
  assert.deepEqual(genderOf(bok), ['en', 'ei']);
  assert.equal(genderOf(klær), null);
  assert.equal(genderOf(gå), null);
});

test('verbTask asks for one of the present, past or participle forms, only for verbs', () => {
  const answers = new Set();
  const rng = mulberry32(7);
  for (let i = 0; i < 30; i++) answers.add(verbTask(gå, rng).answer);
  assert.deepEqual([...answers].sort(), ['gikk', 'går', 'gått']);
  assert.equal(verbTask(hus, rng), null);
});

test('choices holds the target once, prefers the same word type and never repeats a meaning', () => {
  const words = [hus, gå, bok, bil, klær, stor, word(7, 'hus', 'noun (et)'), word(8, 'hjem', 'noun (et)', { gloss_en: 'hus-en' })];
  const out = choices(words, hus, 4, mulberry32(1));
  assert.equal(out.length, 4);
  assert.equal(out.filter((w) => w === hus).length, 1);
  assert.ok(out.every((w) => w === hus || (w.lemma !== 'hus' && w.gloss_en !== hus.gloss_en)));
  assert.ok(out.filter((w) => w !== hus).every((w) => w.pos.startsWith('noun')), 'three other nouns exist, so no verb or adjective');
});

test('collocationItem blanks the word or one of its forms, skipping one-word collocations', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 20; i++) {
    const c = collocationItem(hus, rng);
    assert.notEqual(c.text, 'hus');
    assert.equal(c.tokens[c.blank].text, 'hus');
  }
  const g = collocationItem(word(1, 'gå', 'verb', { forms: gå.forms, collocations: ['gikk i stykker'] }), rng);
  assert.equal(g.tokens[g.blank].text, 'gikk');
  assert.equal(collocationItem(stor, rng), null);
});

test('mistakesOf names each kind of slip in a typed sentence once', () => {
  const forms = (w) => (['går', 'gikk'].includes(w) ? ['går', 'gikk'] : []);
  assert.deepEqual(mistakesOf(compareSentence('Jeg går til skolen', 'Jeg går til skolen').items), []);
  assert.deepEqual(mistakesOf(compareSentence('pa en bat', 'på en båt').items), ['letters']);
  assert.deepEqual(mistakesOf(compareSentence('jeg gikk hjem', 'jeg går hjem', { forms }).items), ['form']);
  assert.deepEqual(mistakesOf(compareSentence('jeg gaar til skolen nå', 'jeg går til skolen').items).sort(), ['letters', 'word']);
  assert.deepEqual(mistakesOf(compareSentence('husen', 'huset').items), ['typo']);
});

test('skillBreakdown sums practice answers per skill and counts review answers as reading', () => {
  const p = (mode, ok) => ({ timestamp: 1, mode, ok });
  const out = skillBreakdown([p('dictation', true), p('listen', false), p('gender', true), p('understand', true)], [{ grade: 'good' }, { grade: 'again' }]);
  const by = Object.fromEntries(out.map((s) => [s.key, s]));
  assert.deepEqual([by.reading.ok, by.reading.total], [2, 3]);
  assert.equal(by.listening.accuracy, 0.5);
  assert.equal(by.grammar.accuracy, 1);
  assert.equal(by.writing.accuracy, null);
  assert.equal(by.usage.total, 0);
  assert.ok(out.every((s) => s.label));
});

test('mistakeCounts tallies each kind, most frequent first, and skips kinds never made', () => {
  const rows = [{ mistakes: ['letters', 'word'] }, { mistakes: ['letters'] }, {}, { mistakes: ['gender'] }];
  assert.deepEqual(mistakeCounts(rows).map((r) => [r.kind, r.n]), [['letters', 2], ['gender', 1], ['word', 1]]);
  assert.deepEqual(mistakeCounts([]), []);
});

test('accuracyByType groups review and single-word practice answers by word type', () => {
  const out = accuracyByType([hus, gå, bil],
    [{ wordId: 2, grade: 'good' }, { wordId: 4, grade: 'again' }, { wordId: 1, grade: 'easy' }, { wordId: 99, grade: 'good' }],
    [{ mode: 'verb', wordId: 1, ok: false }, { mode: 'dictation', phraseId: 'p1', ok: true }]);
  assert.deepEqual(out, [
    { key: 'noun', ok: 1, total: 2, accuracy: 0.5 },
    { key: 'verb', ok: 1, total: 2, accuracy: 0.5 },
  ]);
});

test('every mode and mistake kind is unique', () => {
  assert.equal(new Set(MODES).size, MODES.length);
  assert.equal(new Set(MISTAKES).size, MISTAKES.length);
});
