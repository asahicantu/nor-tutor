import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, normalizeWords, fold, editDistance, compareSentence, checkWord, pickBlank, hintLetters } from '../src/typing.js';

test('normalizeWords ignores case, punctuation, quotes and extra spaces but keeps æ ø å and inner hyphens', () => {
  assert.deepEqual(normalizeWords('God morgen! Hvordan har du det?'), ['god', 'morgen', 'hvordan', 'har', 'du', 'det']);
  assert.deepEqual(normalizeWords('  Jeg   heter «Ola».  '), ['jeg', 'heter', 'ola']);
  assert.deepEqual(normalizeWords('ÆØÅ, e-post; -ny-'), ['æøå', 'e-post', 'ny']);
  assert.deepEqual(normalizeWords('   '), []);
});

test('fold maps ASCII spellings of æ ø å onto the same letters', () => {
  assert.equal(fold('hør'), fold('hoer'));
  assert.equal(fold('båt'), fold('baat'));
  assert.equal(fold('bær'), fold('baer'));
  assert.equal(fold('katt'), 'katt');
});

test('editDistance counts single-letter edits', () => {
  assert.equal(editDistance('katt', 'katt'), 0);
  assert.equal(editDistance('katt', 'kat'), 1);
  assert.equal(editDistance('katt', 'kitt'), 1);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('hus', 'bil'), 3);
});

test('compareSentence: a correct answer ignores case, punctuation and spacing', () => {
  const r = compareSentence('god MORGEN,  hvordan har du det', 'God morgen! Hvordan har du det?');
  assert.equal(r.result, 'correct');
  assert.equal(r.got, true);
  assert.ok(r.items.every((i) => i.status === 'ok'));
});

test('compareSentence: ASCII for æ ø å is almost right and still counts', () => {
  const r = compareSentence('Jeg har en baat.', 'Jeg har en båt.');
  assert.equal(r.result, 'almost');
  assert.equal(r.got, true);
  assert.deepEqual(r.items.find((i) => i.status !== 'ok'), { status: 'diacritic', target: 'båt', typed: 'baat' });
});

test('compareSentence: one small typo is almost right, two are wrong', () => {
  const typo = compareSentence('Hvordann har du det?', 'Hvordan har du det?');
  assert.equal(typo.result, 'almost');
  assert.deepEqual(typo.items[0], { status: 'typo', target: 'hvordan', typed: 'hvordann' });
  const two = compareSentence('Hvordann har du dett?', 'Hvordan har du det?');
  assert.equal(two.result, 'wrong');
  assert.equal(two.got, false);
  const twoTypos = compareSentence('God morgenn! Hvordann har du det?', 'God morgen! Hvordan har du det?');
  assert.deepEqual(twoTypos.items.filter((i) => i.status === 'typo').length, 2); // both are small slips in long words...
  assert.equal(twoTypos.result, 'wrong'); // ...but two of them in one sentence is too many
});

test('compareSentence marks missing, extra and wrong words in order', () => {
  const missing = compareSentence('Jeg heter', 'Jeg heter Ola');
  assert.equal(missing.result, 'wrong');
  assert.deepEqual(missing.items.map((i) => i.status), ['ok', 'ok', 'missing']);
  assert.equal(missing.items[2].target, 'ola');
  const extra = compareSentence('Jeg heter nå Ola', 'Jeg heter Ola');
  assert.deepEqual(extra.items.map((i) => i.status), ['ok', 'ok', 'extra', 'ok']);
  assert.equal(extra.items[2].typed, 'nå');
  assert.equal(extra.result, 'wrong');
  const swapped = compareSentence('Jeg heter Per', 'Jeg heter Ola');
  assert.deepEqual(swapped.items.map((i) => i.status), ['ok', 'ok', 'wrong']);
  assert.deepEqual(swapped.items[2], { status: 'wrong', target: 'ola', typed: 'per' });
});

test('compareSentence on empty input is wrong with every word missing', () => {
  const r = compareSentence('   ', 'God morgen!');
  assert.equal(r.result, 'wrong');
  assert.equal(r.got, false);
  assert.deepEqual(r.items.map((i) => i.status), ['missing', 'missing']);
});

test('checkWord: exact, ASCII spelling, another form of the word, a typo in a long word, and wrong', () => {
  assert.equal(checkWord('Båt', 'båt').result, 'correct');
  assert.equal(checkWord('baat', 'båt').result, 'almost');
  const form = checkWord('båten', 'båt', ['båt', 'båten', 'båter']);
  assert.equal(form.result, 'wrong'); // right word, wrong form for this sentence
  assert.match(form.note, /form/);
  assert.equal(checkWord('hvordann', 'hvordan').result, 'almost');
  assert.equal(checkWord('dat', 'det').result, 'wrong'); // too short to forgive a typo
  assert.equal(checkWord('', 'det').result, 'wrong');
});

test('compareSentence treats another form of the right word as wrong, not as a typo', () => {
  const forms = (w) => (['snakker', 'snakke', 'snakket'].includes(w) ? ['snakker', 'snakke', 'snakket'] : []);
  const r = compareSentence('Jeg snakke norsk', 'Jeg snakker norsk', { forms });
  assert.equal(r.result, 'wrong');
  assert.equal(r.got, false);
  assert.deepEqual(r.items[1], { status: 'form', target: 'snakker', typed: 'snakke' });
  assert.equal(compareSentence('Jeg snakker norsk', 'Jeg snakker norsk', { forms }).result, 'correct');
  assert.equal(compareSentence('Jeg snakke norsk', 'Jeg snakker norsk').result, 'almost'); // without word knowledge it is only a slip
});

test('compareSentence does not forgive ASCII spellings or typos that turn into a different real word', () => {
  const isWord = (w) => ['for', 'før', 'har', 'hår', 'snakke'].includes(w);
  assert.equal(compareSentence('Jeg kom for deg', 'Jeg kom før deg', { isWord }).result, 'wrong'); // for is a word of its own
  assert.equal(compareSentence('Jeg har bl hår', 'Jeg har bl hår', { isWord }).result, 'correct');
  assert.equal(compareSentence('Jeg snakke', 'Jeg snakker', { isWord }).result, 'wrong'); // the typo is itself a real word
  assert.equal(compareSentence('Jeg har en baat', 'Jeg har en båt', { isWord }).result, 'almost'); // baat is not a word
});

test('pickBlank never blanks a word that appears twice (the answer would still be visible)', () => {
  const lookup = (t) => ({ det: { pos: 'pronoun' }, var: { pos: 'verb' }, kort: { pos: 'adjective' }, varsel: { pos: 'noun (et)' } })[t.toLowerCase()];
  for (let r = 0; r < 20; r++) {
    const b = pickBlank('Det var hyggelig selv om det var kort varsel', lookup, () => r / 20);
    assert.ok(b && !['var', 'det'].includes(b.answer.toLowerCase()), b?.answer);
  }
  assert.equal(pickBlank('var var', lookup, () => 0), null);
});

test('tokenize splits a sentence into words and the text between them', () => {
  assert.deepEqual(tokenize('Hei, du!'), [
    { text: 'Hei', word: true }, { text: ', ', word: false }, { text: 'du', word: true }, { text: '!', word: false },
  ]);
});

test('pickBlank picks a list word of at least 3 letters, preferring content words', () => {
  const entries = new Map([
    ['jeg', { pos: 'pronoun' }], ['bor', { pos: 'verb' }], ['i', { pos: 'preposition' }], ['oslo', undefined], ['byen', { pos: 'noun (en)' }],
  ]);
  const lookup = (t) => entries.get(t.toLocaleLowerCase('nb'));
  const first = pickBlank('Jeg bor i Oslo byen', lookup, () => 0);
  assert.equal(first.answer, 'bor'); // content words (verb, noun) come before pronouns
  assert.equal(first.tokenIndex, 2);
  const last = pickBlank('Jeg bor i Oslo byen', lookup, () => 0.99);
  assert.equal(last.answer, 'byen');
  const onlyFunction = pickBlank('Jeg i', (t) => entries.get(t.toLowerCase()), () => 0);
  assert.equal(onlyFunction.answer, 'Jeg'); // falls back to any list word of 3+ letters, as written in the sentence
  assert.equal(pickBlank('Oslo', lookup, () => 0), null);
  assert.equal(pickBlank('', lookup, () => 0), null);
});

test('hintLetters keeps the first letter of each word and the punctuation', () => {
  assert.equal(hintLetters('God morgen! Hvordan har du det?'), 'G__ m_____! H______ h__ d_ d__?');
  assert.equal(hintLetters('å'), 'å');
  assert.equal(hintLetters(''), '');
});
