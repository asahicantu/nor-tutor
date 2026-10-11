import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRENGTHS, wordStrength, cloudItems, fontSize } from '../src/strength.js';

const w = (id, lemma = `ord${id}`) => ({ id, lemma, gloss_en: `gloss${id}`, rank: id * 10, pos: 'noun (en)' });
const card = (wordId, interval, reps = 1) => ({ wordId, ease: 2.5, interval, reps, lapses: 0, due: 1 });
const rv = (wordId, t = 1) => ({ wordId, timestamp: t, grade: 'good' });
const none = { cards: [], reviews: [], known: [], unknown: [] };

test('STRENGTHS are ordered weak to strong with labels', () => {
  assert.deepEqual(STRENGTHS.map((s) => s.id), ['weak', 'learning', 'solid', 'strong']);
  assert.ok(STRENGTHS.every((s) => s.label));
});

test('wordStrength: marked known or a 21-day card is strong, then solid, learning, weak, and null when never met', () => {
  assert.equal(wordStrength({ known: true }), 'strong');
  assert.equal(wordStrength({ card: card(1, 21) }), 'strong');
  assert.equal(wordStrength({ card: card(1, 20) }), 'solid');
  assert.equal(wordStrength({ card: card(1, 6) }), 'solid');
  assert.equal(wordStrength({ card: card(1, 5) }), 'learning');
  assert.equal(wordStrength({ card: card(1, 1) }), 'learning');
  assert.equal(wordStrength({ card: card(1, 0, 0) }), 'weak'); // a fresh card, never answered
  assert.equal(wordStrength({ missed: 2 }), 'weak');
  assert.equal(wordStrength({ missed: 2, card: card(1, 10) }), 'solid'); // learning beats an old miss
  assert.equal(wordStrength({}), null);
});

test('a word marked known and then missed again is weak (the later event wins), and known after a miss is strong', () => {
  assert.equal(wordStrength({ known: true, knownAt: 10, missed: 1, lastMissAt: 20 }), 'weak');
  assert.equal(wordStrength({ known: true, knownAt: 10, missed: 4, lastMissAt: 20, card: card(1, 8) }), 'solid'); // judged by its card then
  assert.equal(wordStrength({ known: true, knownAt: 30, missed: 4, lastMissAt: 20 }), 'strong'); // marked known after the misses
  assert.equal(wordStrength({ known: true, knownAt: 10, missed: 0, lastMissAt: 0 }), 'strong');
});

test('cloudItems colours a known word you just missed as weak, not strong', () => {
  const words = [w(1), w(2)];
  const state = { ...none, known: [{ wordId: 1, timestamp: 10 }, { wordId: 2, timestamp: 10 }], unknown: [{ wordId: 1, count: 1, firstAt: 20, lastAt: 20 }] };
  const items = cloudItems(words, state, { ids: new Set([1, 2]) });
  assert.equal(items.find((i) => i.id === 1).strength, 'weak'); // marked known at 10, missed at 20
  assert.equal(items.find((i) => i.id === 2).strength, 'strong');
});

test('cloudItems sizes by how often a word was studied or reappeared and sorts the biggest first', () => {
  const words = [w(1), w(2), w(3), w(4)];
  const state = {
    ...none,
    reviews: [rv(1), rv(1), rv(1)],
    unknown: [{ wordId: 1, count: 2, firstAt: 1, lastAt: 2 }, { wordId: 3, count: 1, firstAt: 1, lastAt: 1 }],
    known: [{ wordId: 2, timestamp: 1 }, { wordId: 99, timestamp: 1 }], // 99 no longer exists
    cards: [card(1, 8)],
  };
  const items = cloudItems(words, state);
  assert.deepEqual(items.map((i) => [i.id, i.count, i.strength]), [[1, 5, 'solid'], [3, 1, 'weak']]); // 3 reviews + 2 misses; word 2 was never seen again
  assert.deepEqual([items[0].studied, items[0].missed], [3, 2]);
  assert.equal(items[0].text, 'ord1');
});

test('cloudItems honours limit and always includes the requested session words', () => {
  const words = Array.from({ length: 6 }, (_, i) => w(i + 1));
  const state = { ...none, reviews: [rv(1), rv(1), rv(2), rv(3)], known: [{ wordId: 5, timestamp: 1 }] };
  assert.deepEqual(cloudItems(words, state, { limit: 2 }).map((i) => i.id), [1, 2]);
  const session = cloudItems(words, state, { ids: new Set([5, 6]) });
  assert.deepEqual(session.map((i) => i.id).sort(), [5, 6]); // only this session's words
  assert.ok(session.every((i) => i.count >= 1)); // never zero-sized
  assert.equal(session.find((i) => i.id === 5).strength, 'strong');
  assert.equal(session.find((i) => i.id === 6).strength, null);
});

test('fontSize grows with the count, stays in range and is safe for empty input', () => {
  assert.equal(fontSize(100, 100), 2.6);
  assert.ok(fontSize(1, 100) >= 0.95 && fontSize(1, 100) < fontSize(25, 100));
  assert.ok(fontSize(25, 100) < fontSize(100, 100));
  assert.equal(fontSize(1, 1), 2.6); // everything the same count: all at the top size
  assert.equal(fontSize(0, 0), 0.95);
});
