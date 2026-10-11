import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpTotal, reviewXp, levelInfo, streak, dailyQuest, badges, newBadges, DAILY_GOAL } from '../src/gamify.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 11, 12);
const none = { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [] };
const rv = (timestamp, grade = 'good') => ({ wordId: 1, timestamp, grade });
const card = (due) => ({ wordId: 1, ease: 2.5, interval: 0, reps: 0, lapses: 0, due });
const aTest = (timestamp) => ({ timestamp, estimate: 1, ciLow: 1, ciHigh: 1, bands: [] });

test('xpTotal adds every learning event', () => {
  const s = {
    ...none,
    reviews: [rv(1), rv(2, 'again')],
    tests: [aTest(1)],
    known: [{ wordId: 1, timestamp: 1 }, { wordId: 2, timestamp: 1 }],
    cards: [card(1)],
    phrases: [{ phraseId: 'p', seen: 4, got: 3, lastAt: 1 }],
  };
  assert.equal(xpTotal(s), 10 + 2 + 50 + 10 + 3 + 15);
  assert.equal(xpTotal(none), 0);
});

test('reviewXp matches the per-review rule', () => {
  assert.equal(reviewXp({ again: 1, hard: 1, good: 2, easy: 0 }), 3 * 10 + 2);
});

test('levelInfo: level n starts at 50*n*(n-1) XP, safe at 0', () => {
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, needed: 100, pct: 0 });
  assert.deepEqual(levelInfo(99), { level: 1, into: 99, needed: 100, pct: 99 });
  assert.deepEqual(levelInfo(100), { level: 2, into: 0, needed: 200, pct: 0 });
  assert.deepEqual(levelInfo(450), { level: 3, into: 150, needed: 300, pct: 50 });
});

test('streak counts reviews and tests on consecutive days; none means 0', () => {
  assert.equal(streak(none, NOW, 0), 0);
  const s = { ...none, reviews: [rv(NOW),rv(NOW - DAY)], tests: [aTest(NOW - 2 * DAY)] };
  assert.equal(streak(s, NOW, 0), 3);
});

test('dailyQuest: new learner has a completable goal of 1, no NaN', () => {
  assert.deepEqual(dailyQuest(none, NOW, 0), { done: 0, goal: 1, pct: 0, complete: false });
});

test('dailyQuest: goal shrinks to what is available, caps at DAILY_GOAL', () => {
  const s = { ...none, cards: [card(NOW - 1)], reviews: [rv(NOW - 1000), rv(NOW - 2000)] };
  assert.deepEqual(dailyQuest(s, NOW, 0), { done: 2, goal: 3, pct: 67, complete: false });
  const finished = { ...none, reviews: [rv(NOW - 1000)] };
  assert.deepEqual(dailyQuest(finished, NOW, 0), { done: 1, goal: 1, pct: 100, complete: true });
  const many = { ...none, cards: Array.from({ length: 30 }, () => card(NOW - 1)) };
  assert.equal(dailyQuest(many, NOW, 0).goal, DAILY_GOAL);
});

test('dailyQuest respects the local day boundary', () => {
  const now = Date.UTC(2026, 9, 11, 23, 30);
  const offset = 2 * 3600000; // local time is 01:30 on the 12th
  const s = { ...none, reviews: [rv(Date.UTC(2026, 9, 11, 21, 0)), rv(Date.UTC(2026, 9, 11, 22, 30))] };
  assert.equal(dailyQuest(s, now, offset).done, 1); // 21:00Z is still the 11th locally
});

test('badges report progress and earned state', () => {
  const b = Object.fromEntries(badges({ ...none, tests: [aTest(1)] }, NOW, 0).map((x) => [x.id, x]));
  assert.equal(b['first-test'].earned, true);
  assert.equal(b['first-review'].earned, false);
  assert.deepEqual([b['deck-10'].value, b['deck-10'].target], [0, 10]);
});

test('newBadges excludes ones already awarded', () => {
  const s = { ...none, tests: [aTest(1)], reviews: [rv(1)] };
  assert.deepEqual(newBadges(s, [], NOW, 0).map((x) => x.id).sort(), ['first-review', 'first-test']);
  assert.deepEqual(newBadges(s, [{ awardId: 'first-test', timestamp: 1 }], NOW, 0).map((x) => x.id), ['first-review']);
});
