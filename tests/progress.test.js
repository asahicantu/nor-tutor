import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, learnedNow, progressSeries, forgotten, breakdown, categoryOf, recommend } from '../src/progress.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 11, 12);
const rv = (wordId, daysAgo, grade = 'good', prevInterval) => ({ wordId, timestamp: NOW - daysAgo * DAY, grade, ...(prevInterval === undefined ? {} : { prevInterval }) });
const w = (id, rank, pos = 'noun (en)') => ({ id, rank, pos, lemma: `ord${id}` });
const card = (wordId, interval, due = NOW + DAY) => ({ wordId, ease: 2.5, interval, reps: 3, lapses: 0, due });
const none = { cards: [], reviews: [], known: [], unknown: [] };

test('replay rebuilds the exact scheduler intervals from stored grades', () => {
  const t = replay([rv(1, 40), rv(1, 39), rv(1, 33), rv(1, 18)]).get(1);
  assert.deepEqual(t.map((e) => e.interval), [1, 6, 15, 38]);
  assert.ok(t.every((e) => !e.lapse));
});

test('replay marks an Again on a remembered card as a lapse, not on a brand-new card', () => {
  const t = replay([rv(1, 10, 'again'), rv(1, 9, 'good'), rv(1, 3, 'again')]).get(1);
  assert.deepEqual(t.map((e) => e.lapse), [false, false, true]);
});

test('replay: two consecutive Agains on a never-remembered card are not lapses', () => {
  const t = replay([rv(1, 10, 'again'), rv(1, 9, 'again')]).get(1);
  assert.deepEqual(t.map((e) => e.lapse), [false, false]);
});

test('progressSeries does not throw on 150,000 reviews', () => {
  const reviews = Array.from({ length: 150000 }, (_, i) => ({ wordId: 1, timestamp: NOW - 2 * DAY + i, grade: 'good' }));
  const rows = progressSeries({ reviews, known: [] }, [w(1, 100)], NOW, 0);
  assert.ok(rows.length >= 2);
});

test('replay sorts by time and ignores input order', () => {
  const a = replay([rv(1, 5), rv(1, 40)]).get(1);
  assert.deepEqual(a.map((e) => e.t), [NOW - 40 * DAY, NOW - 5 * DAY]);
});

test('learnedNow is known words plus cards with a 21-day interval, nothing else', () => {
  const s = learnedNow({ known: [{ wordId: 1, timestamp: 1 }], cards: [card(2, 21), card(3, 20), card(1, 30)] });
  assert.deepEqual([...s].sort(), [1, 2]);
  assert.equal(learnedNow(none).size, 0);
});

test('progressSeries: empty history gives no rows', () => {
  assert.deepEqual(progressSeries(none, [w(1, 100)], NOW, 0), []);
});

test('progressSeries counts a word as learned from the day its interval reaches 21, and drops it after a lapse', () => {
  const reviews = [rv(1, 40), rv(1, 39), rv(1, 33), rv(1, 18), rv(1, 2, 'again', 38)];
  const rows = progressSeries({ reviews, known: [] }, [w(1, 100)], NOW, 0);
  const at = (daysAgo) => rows.find((r) => r.day === new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10));
  assert.equal(rows[0].day, new Date(NOW - 40 * DAY).toISOString().slice(0, 10));
  assert.equal(at(40).learned, 0);
  assert.equal(at(33).learned, 0); // interval 15 so far
  assert.equal(at(18).learned, 1); // interval 38
  assert.equal(at(18).level, 'A1'); // 1 of 1 A1 words learned
  assert.equal(at(2).learned, 0); // lapsed: interval reset
  assert.equal(at(2).lapses, 1);
  assert.equal(rows.at(-1).day, new Date(NOW).toISOString().slice(0, 10));
});

test('progressSeries counts marked-known words from their timestamp and honours the timezone offset', () => {
  const known = [{ wordId: 1, timestamp: Date.UTC(2026, 9, 10, 23, 0) }]; // 23:00Z = 01:00 on the 11th at +2h
  const rows = progressSeries({ reviews: [], known }, [w(1, 100)], NOW, 2 * 3600000);
  assert.deepEqual(rows.map((r) => [r.day, r.learned]), [['2026-10-11', 1]]);
});

test('forgotten: lapses and distinct words in the window, most forgotten first, weekly buckets', () => {
  const reviews = [
    rv(1, 20, 'good'), rv(1, 3, 'again'), rv(1, 2.5, 'good'), rv(1, 2, 'again'),
    rv(2, 20, 'good'), rv(2, 10, 'again'),
    rv(3, 50, 'good'), rv(3, 40, 'again'), // word 3 is outside 30 days
    rv(4, 1, 'again'), // a new card, not a lapse
  ];
  const f = forgotten({ reviews }, NOW, 30, 0);
  assert.equal(f.lapses, 3);
  assert.equal(f.words, 2);
  assert.deepEqual(f.top, [{ wordId: 1, count: 2 }, { wordId: 2, count: 1 }]);
  assert.equal(f.weekly.length, 8);
  assert.equal(f.weekly.reduce((s, x) => s + x.lapses, 0), 4 - 0); // 3 in window + word 3 at 40 days (week 6)
});

test('forgotten on empty data has zeros and no NaN', () => {
  const f = forgotten(none, NOW, 30, 0);
  assert.deepEqual([f.lapses, f.words, f.top.length], [0, 0, 0]);
});

test('breakdown counts learned, learning (in deck, not learned) and not started per key', () => {
  const words = [w(1, 1, 'noun (en)'), w(2, 2, 'noun (et)'), w(3, 3, 'verb'), w(4, 4, 'verb')];
  const rows = breakdown(words, { known: new Set([1, 3]), deck: new Set([2, 4, 3]) }, categoryOf);
  assert.deepEqual(rows, [
    { key: 'noun', learned: 1, learning: 1, notStarted: 0, total: 2 },
    { key: 'verb', learned: 1, learning: 1, notStarted: 0, total: 2 },
  ]);
  assert.equal(categoryOf(w(1, 1, 'noun (en/ei)')), 'noun');
});

test('recommend on a brand-new learner points at the Words page and never throws', () => {
  const r = recommend({ ...none, words: [w(1, 100)], now: NOW, offset: 0 });
  assert.equal(r[0].id, 'start');
  assert.ok(r.every((x) => x.text && x.href));
});

test('recommend: due cards first, then idle, forgotten words, weakest category, next level', () => {
  const words = [w(1, 100, 'verb'), w(2, 200, 'verb'), w(3, 300, 'noun (en)'), w(4, 1000, 'noun (en)')];
  const reviews = [
    // verbs: 10 reviews, 3 remembered (oldest first: G A G A A A A A A G, two real lapses); nouns: 10 of 10 remembered
    ...[...'GAGAAAAAAG'].map((g, i) => rv(1, 14 - i, g === 'G' ? 'good' : 'again')),
    ...Array.from({ length: 10 }, (_, i) => rv(3, 5 + i, 'good')),
  ];
  const cards = [card(1, 3, NOW - 1), card(3, 6)];
  const r = recommend({ words, cards, reviews, known: [], unknown: [], now: NOW, offset: 0 });
  const ids = r.map((x) => x.id);
  assert.equal(ids[0], 'due');
  assert.ok(ids.includes('forgotten') && ids.includes('weak-category') && ids.includes('next-level'));
  assert.match(r.find((x) => x.id === 'weak-category').text, /verb/);
  assert.ok(r.length <= 5);
});

test('recommend: idle nudge when nothing was reviewed for 3+ days and nothing is due', () => {
  const r = recommend({ words: [w(1, 100)], cards: [card(1, 6)], reviews: [rv(1, 5)], known: [], unknown: [], now: NOW, offset: 0 });
  assert.ok(r.some((x) => x.id === 'idle'));
  assert.ok(!r.some((x) => x.id === 'due'));
});
