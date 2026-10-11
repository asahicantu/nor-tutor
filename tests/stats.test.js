import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocabSeries, dailyAccuracy, streakDays, retentionRate, studyMinutes, bandProfile, nextAction, gettingStarted } from '../src/stats.js';

const H = 3600000;
const at = (d, h = 12) => Date.UTC(2026, 9, d, h);
const rv = (timestamp, grade = 'good', extra = {}) => ({ wordId: 1, timestamp, grade, ms: 0, ...extra });

test('vocabSeries sorts by time and projects fields', () => {
  const s = vocabSeries([
    { timestamp: 20, estimate: 2, ciLow: 1, ciHigh: 3, bands: [] },
    { timestamp: 10, estimate: 1, ciLow: 0, ciHigh: 2, bands: [] },
  ]);
  assert.deepEqual(s, [
    { t: 10, estimate: 1, ciLow: 0, ciHigh: 2 },
    { t: 20, estimate: 2, ciLow: 1, ciHigh: 3 },
  ]);
  assert.deepEqual(vocabSeries([]), []);
});

test('dailyAccuracy groups by local day and excludes "again" from recall', () => {
  const out = dailyAccuracy([rv(at(9)), rv(at(9), 'again'), rv(at(10)), rv(at(10)), rv(at(10), 'easy')]);
  assert.deepEqual(out, [
    { day: '2026-10-09', reviews: 2, accuracy: 0.5 },
    { day: '2026-10-10', reviews: 3, accuracy: 1 },
  ]);
});

test('streakDays counts consecutive days ending today or yesterday', () => {
  assert.equal(streakDays([], at(10)), 0);
  assert.equal(streakDays([rv(at(9)), rv(at(10))], at(10)), 2);
  assert.equal(streakDays([rv(at(8)), rv(at(9))], at(10)), 2); // none today yet, yesterday counts
  assert.equal(streakDays([rv(at(8))], at(10)), 0); // two days missed
  assert.equal(streakDays([rv(at(8)), rv(at(10))], at(10)), 1); // gap breaks it
});

test('streakDays respects the timezone offset', () => {
  const reviews = [rv(Date.UTC(2026, 9, 9, 23)), rv(Date.UTC(2026, 9, 10, 1))];
  const now = Date.UTC(2026, 9, 10, 12);
  assert.equal(streakDays(reviews, now, 0), 2);
  assert.equal(streakDays(reviews, now, 2 * H), 1); // both fall on local Oct 10
});

test('retentionRate uses only mature reviews; null when none', () => {
  assert.equal(retentionRate([rv(1, 'good', { prevInterval: 5 })]), null);
  const reviews = [
    rv(1, 'good', { prevInterval: 30 }),
    rv(2, 'again', { prevInterval: 21 }),
    rv(3, 'easy', { prevInterval: 40 }),
    rv(4, 'again', { prevInterval: 3 }),
    rv(5, 'good'),
  ];
  assert.equal(retentionRate(reviews), 2 / 3);
});

test('studyMinutes sums milliseconds; tolerates missing ms', () => {
  assert.equal(studyMinutes([rv(1, 'good', { ms: 30000 }), rv(2, 'good', { ms: 90000 }), { timestamp: 3, grade: 'good' }]), 2);
});

test('bandProfile maps the latest test, empty for none', () => {
  assert.deepEqual(bandProfile(undefined), []);
  assert.deepEqual(bandProfile({}), []);
  assert.deepEqual(bandProfile({ bands: [{ band: 'b1', pCorrected: 0.9, size: 10, sampled: 5, known: 4 }] }), [{ band: 'b1', known: 0.9 }]);
});

const NOW = Date.UTC(2026, 9, 10, 12);
const card = (wordId, due) => ({ wordId, ease: 2.5, interval: 1, reps: 1, lapses: 0, due });
const aTest = { timestamp: 1, estimate: 1000, ciLow: 900, ciHigh: 1100, bands: [] };

test('nextAction: empty data points to the test', () => {
  assert.deepEqual(nextAction({ cards: [], reviews: [], tests: [] }, NOW), { kind: 'test', dueCount: 0 });
  assert.deepEqual(gettingStarted({ cards: [], reviews: [], tests: [] }), { test: false, deck: false, review: false });
});

test('nextAction: due cards beat exploring, and a card due exactly now counts', () => {
  const state = { cards: [card(1, NOW), card(2, NOW + 1)], reviews: [], tests: [aTest] };
  assert.deepEqual(nextAction(state, NOW), { kind: 'review', dueCount: 1 });
});

test('nextAction: tested but nothing due or no cards means explore', () => {
  assert.deepEqual(nextAction({ cards: [], reviews: [], tests: [aTest] }, NOW), { kind: 'explore', dueCount: 0 });
  assert.deepEqual(nextAction({ cards: [card(1, NOW + 1)], reviews: [], tests: [aTest] }, NOW), { kind: 'explore', dueCount: 0 });
});

test('nextAction: untested user is sent to the test even with due cards', () => {
  assert.equal(nextAction({ cards: [card(1, NOW - 1)], reviews: [], tests: [] }, NOW).kind, 'test');
});

test('gettingStarted ticks each step from the data', () => {
  assert.deepEqual(gettingStarted({ cards: [card(1, NOW)], reviews: [rv(NOW)], tests: [aTest] }), { test: true, deck: true, review: true });
  assert.deepEqual(gettingStarted({ cards: [card(1, NOW)], reviews: [], tests: [] }), { test: false, deck: true, review: false });
});

test('trend compares the last 7 days with the 7 before', async () => {
  const { trend } = await import('../src/stats.js');
  const now = Date.UTC(2026, 9, 20);
  const D = 86400000;
  const rv = (days, grade) => ({ wordId: 1, timestamp: now - days * D, grade });
  const t = trend([rv(1, 'good'), rv(2, 'again'), rv(9, 'again'), rv(10, 'again'), rv(11, 'good'), rv(30, 'good')], now);
  assert.deepEqual(t.current, { n: 2, accuracy: 0.5 });
  assert.equal(t.previous.n, 3);
  assert.equal(trend([], now).current, null);
});
