import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATEGORIES, STATUSES, progressKey, parseProgress, encodeProgress, progressTotals, splitEmoji, validateGrammar } from '../src/grammar.js';

const good = () => ({
  id: 'nouns', category: 'words', emoji: '🏠', title: 'Nouns', summary: 'Gender and plural.',
  blocks: [
    { type: 'p', text: 'Text with **bold**.' },
    { type: 'table', caption: 'Forms', head: ['Word', 'Plural'], rows: [['hus 🏠', 'hus']] },
    { type: 'list', items: ['one', 'two'] },
    { type: 'examples', items: [{ no: 'Et hus.', en: 'A house.' }] },
    { type: 'tip', text: 'A tip.' },
  ],
});

test('categories and statuses are fixed, labelled and carry an emoji', () => {
  assert.deepEqual(Object.keys(CATEGORIES), ['sounds', 'words', 'verbs', 'sentences', 'places', 'usage']);
  for (const c of Object.values(CATEGORIES)) assert.ok(c.label && c.emoji);
  assert.deepEqual(STATUSES.map((s) => s.id), ['new', 'learning', 'studied']);
});

test('progress rows round-trip through the settings store format', () => {
  assert.equal(progressKey('verbs'), 'grammar.verbs');
  assert.equal(encodeProgress('studied', 1700000000000), 'studied:1700000000000');
  const p = parseProgress([
    { key: 'grammar.verbs', value: 'studied:1700000000000' },
    { key: 'grammar.nouns', value: 'learning:5' },
    { key: 'profileName', value: 'Åse' }, // not a grammar row
    { key: 'grammar.bad1', value: 'nonsense' }, // unknown status
    { key: 'grammar.bad2', value: 'studied:abc' }, // bad timestamp
    { key: 'grammar.bad3', value: 'new:1' }, // "new" is the absence of a row, never stored
  ]);
  assert.deepEqual([...p], [['verbs', { status: 'studied', at: 1700000000000 }], ['nouns', { status: 'learning', at: 5 }]]);
});

test('progressTotals counts statuses and never divides by zero', () => {
  const secs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const p = new Map([['a', { status: 'studied', at: 1 }], ['b', { status: 'learning', at: 1 }], ['zzz', { status: 'studied', at: 1 }]]); // zzz no longer exists
  assert.deepEqual(progressTotals(secs, p), { total: 4, learning: 1, studied: 1, pct: 25 });
  assert.deepEqual(progressTotals([], new Map()), { total: 0, learning: 0, studied: 0, pct: 0 });
});

test('splitEmoji wraps emoji runs and leaves text alone', () => {
  assert.deepEqual(splitEmoji('hund 🐕'), [{ text: 'hund ', emoji: false }, { text: '🐕', emoji: true }]);
  assert.deepEqual(splitEmoji('plain text'), [{ text: 'plain text', emoji: false }]);
  assert.deepEqual(splitEmoji('1️⃣ en'), [{ text: '1️⃣', emoji: true }, { text: ' en', emoji: false }]);
  assert.deepEqual(splitEmoji('familie 👨‍👩‍👧'), [{ text: 'familie ', emoji: false }, { text: '👨‍👩‍👧', emoji: true }]);
  assert.deepEqual(splitEmoji('Norge 🇳🇴'), [{ text: 'Norge ', emoji: false }, { text: '🇳🇴', emoji: true }]);
  assert.deepEqual(splitEmoji('bra 👍🏽'), [{ text: 'bra ', emoji: false }, { text: '👍🏽', emoji: true }]);
  assert.deepEqual(splitEmoji('5 ting'), [{ text: '5 ting', emoji: false }]); // a bare digit is not an emoji
  assert.deepEqual(splitEmoji(''), []);
});

test('validateGrammar accepts a good section', () => assert.deepEqual(validateGrammar([good()]), []));

test('validateGrammar rejects structural problems', () => {
  const bad = (patch) => validateGrammar([{ ...good(), ...patch }]);
  assert.ok(validateGrammar({}).length > 0);
  assert.ok(validateGrammar([]).length > 0);
  assert.ok(bad({ id: 'Has Space' }).some((e) => /id/.test(e)));
  assert.ok(bad({ id: 'x'.repeat(31) }).some((e) => /id/.test(e)));
  assert.ok(bad({ category: 'nope' }).some((e) => /category/.test(e)));
  assert.ok(bad({ emoji: '' }).some((e) => /emoji/.test(e)));
  assert.ok(bad({ emoji: 'abc' }).some((e) => /emoji/.test(e)));
  assert.ok(bad({ title: ' ' }).some((e) => /title/.test(e)));
  assert.ok(bad({ blocks: [] }).some((e) => /blocks/.test(e)));
  assert.ok(bad({ blocks: [{ type: 'video' }] }).some((e) => /block/.test(e)));
  assert.ok(bad({ blocks: [{ type: 'table', head: ['a', 'b'], rows: [['only one']] }] }).some((e) => /row/.test(e)));
  assert.ok(bad({ blocks: [{ type: 'examples', items: [{ no: 'x' }] }] }).some((e) => /examples/.test(e)));
  assert.ok(validateGrammar([good(), good()]).some((e) => /duplicate id/.test(e)));
});

test('data/grammar.json is valid, has an emoji and category on every section and emoji on key terms', async () => {
  const secs = JSON.parse(await readFile(new URL('../data/grammar.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateGrammar(secs), []);
  assert.equal(secs.length, 16);
  const cells = secs.flatMap((s) => s.blocks.filter((b) => b.type === 'table').flatMap((b) => b.rows.flat()));
  const withEmoji = cells.filter((c) => splitEmoji(c).some((p) => p.emoji));
  assert.ok(withEmoji.length >= 60, `only ${withEmoji.length} table cells have an emoji`);
});
