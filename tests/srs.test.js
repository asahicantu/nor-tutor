import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCard, review, dueCards, GRADES } from '../src/srs.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 10);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('new card is due immediately with default ease', () => {
  const c = newCard('w1', T0);
  assert.deepEqual(c, { wordId: 'w1', ease: 2.5, interval: 0, reps: 0, lapses: 0, due: T0 });
});

test('good: intervals go 1, 6, then multiply by ease', () => {
  let c = newCard('w1', T0);
  c = review(c, 'good', T0);
  assert.equal(c.interval, 1); assert.equal(c.reps, 1); assert.equal(c.due, T0 + DAY);
  c = review(c, 'good', T0 + DAY);
  assert.equal(c.interval, 6);
  c = review(c, 'good', T0 + 7 * DAY);
  assert.equal(c.interval, 15); // round(6 * 2.5)
  close(c.ease, 2.5);
});

test('easy raises ease, hard lowers it', () => {
  close(review(newCard('a', T0), 'easy', T0).ease, 2.6);
  close(review(newCard('a', T0), 'hard', T0).ease, 2.36);
});

test('again resets reps, counts a lapse, schedules 1 day, lowers ease', () => {
  let c = newCard('a', T0);
  c = review(c, 'good', T0);
  c = review(c, 'good', T0);
  c = review(c, 'again', T0);
  assert.equal(c.reps, 0); assert.equal(c.lapses, 1); assert.equal(c.interval, 1);
  close(c.ease, 2.3);
});

test('ease never drops below 1.3', () => {
  let c = newCard('a', T0);
  for (let i = 0; i < 20; i++) c = review(c, 'again', T0);
  close(c.ease, 1.3);
});

test('review does not mutate its input; unknown grade throws', () => {
  const c = newCard('a', T0);
  const snapshot = { ...c };
  review(c, 'good', T0);
  assert.deepEqual(c, snapshot);
  assert.throws(() => review(c, 'perfect', T0), RangeError);
  for (const g of ['constructor', 'toString', '__proto__']) assert.throws(() => review(c, g, T0), RangeError, g);
  assert.ok(Object.isFrozen(GRADES));
  assert.deepEqual(Object.keys(GRADES), ['again', 'hard', 'good', 'easy']);
});

test('dueCards returns only due cards, earliest first', () => {
  const a = { ...newCard('a', T0), due: T0 + 2 * DAY };
  const b = { ...newCard('b', T0), due: T0 - DAY };
  const c = { ...newCard('c', T0), due: T0 };
  assert.deepEqual(dueCards([a, b, c], T0).map((x) => x.wordId), ['b', 'c']);
});
