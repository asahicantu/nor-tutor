import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gainsPerDay, paceStats, etaToNextLevel, levelBlurb, profileSummary, MAX_NAME } from '../src/profile.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 11, 12);
const row = (day, learned) => ({ day, learned, level: null, lapses: 0 });
const w = (id, rank, pos = 'noun (en)') => ({ id, rank, pos, lemma: `ord${id}` });
const none = { cards: [], reviews: [], tests: [], known: [], unknown: [], phrases: [], awards: [], settings: [] };

test('gainsPerDay counts newly learned words per day and never goes negative after a lapse', () => {
  const g = gainsPerDay([row('2026-10-09', 3), row('2026-10-10', 7), row('2026-10-11', 5)]);
  assert.deepEqual(g, [{ day: '2026-10-09', gained: 3 }, { day: '2026-10-10', gained: 4 }, { day: '2026-10-11', gained: 0 }]);
  assert.deepEqual(gainsPerDay([]), []);
});

test('gainsPerDay: a full 365-day series does not count pre-window learning as one day', () => {
  const start = Date.UTC(2025, 9, 12);
  const series = Array.from({ length: 365 }, (_, i) => row(new Date(start + i * DAY).toISOString().slice(0, 10), 500 + i));
  const g = gainsPerDay(series);
  assert.equal(g[0].gained, 0);
  assert.equal(g.reduce((s, x) => s + x.gained, 0), 364);
  assert.equal(paceStats(series).best.gained, 1);
  assert.equal(gainsPerDay([row('2026-10-11', 500)])[0].gained, 500); // short series: first row is real
});

test('paceStats: today, 7- and 30-day averages, best day and a 14-day sparkline ending today', () => {
  const series = [row('2026-10-05', 2), row('2026-10-06', 2), row('2026-10-07', 9), row('2026-10-08', 9), row('2026-10-09', 12), row('2026-10-10', 12), row('2026-10-11', 14)];
  const p = paceStats(series);
  assert.equal(p.today, 2);
  assert.equal(p.avg7, 14 / 7);
  assert.equal(p.avg30, 14 / 30);
  assert.deepEqual(p.best, { day: '2026-10-07', gained: 7 });
  assert.equal(p.last14.length, 14);
  assert.deepEqual(p.last14.slice(-7), [2, 0, 7, 0, 3, 0, 2]);
  assert.equal(p.last14[0], 0); // days before the first activity are zero
  assert.equal(p.total, 14);
});

test('paceStats on no history is all zeros with no best day (no NaN)', () => {
  const p = paceStats([]);
  assert.deepEqual([p.today, p.avg7, p.avg30, p.best, p.total], [0, 0, 0, null, 0]);
  assert.equal(p.last14.length, 14);
});

test('etaToNextLevel: words still needed for the first level under 70%, and days at the current pace', () => {
  const byLevel = { A1: { known: 10, total: 10 }, A2: { known: 3, total: 10 }, B1: { known: 0, total: 10 }, B2: { known: 0, total: 0 }, C1: { known: 0, total: 0 }, C2: { known: 0, total: 0 } };
  const e = etaToNextLevel(byLevel, 2);
  assert.deepEqual(e, { level: 'A2', known: 3, needed: 4, pct: 43, days: 2 }); // need ceil(7)=7 known, 4 more, 4/2 = 2 days
  assert.equal(etaToNextLevel(byLevel, 0).days, null); // no pace, no estimate
  assert.equal(etaToNextLevel(byLevel, 0.04).days, null); // too slow to be meaningful
  const done = Object.fromEntries(Object.keys(byLevel).map((l) => [l, { known: 5, total: 5 }]));
  assert.equal(etaToNextLevel(done, 3), null); // every level reached
});

test('levelBlurb covers every CEFR level and the no-level case', () => {
  for (const l of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) assert.ok(levelBlurb(l).length > 20, l);
  assert.match(levelBlurb(null), /A1/);
});

test('profileSummary for a brand-new learner has safe defaults', () => {
  const s = profileSummary({ words: [w(1, 100)], state: none, now: NOW, offset: 0 });
  assert.equal(s.name, 'Learner');
  assert.equal(s.hasName, false);
  assert.equal(s.estimatedLevel, null);
  assert.deepEqual([s.learnedTotal, s.reviews, s.minutes, s.tests], [0, 0, 0, 0]);
  assert.equal(s.retention7, null);
  assert.equal(s.vocab, null);
  assert.equal(s.pace.total, 0);
});

test('profileSummary uses the saved name (trimmed, capped), levels from learned words and the latest test', () => {
  const words = [w(1, 100), w(2, 200), w(3, 1000)];
  const state = {
    ...none,
    settings: [{ key: 'profileName', value: '  Åse  ' }],
    known: [{ wordId: 1, timestamp: NOW - DAY }, { wordId: 2, timestamp: NOW - 2 * DAY }, { wordId: 99, timestamp: NOW }], // 99 no longer exists
    tests: [{ timestamp: NOW - 9 * DAY, estimate: 1000, ciLow: 900, ciHigh: 1100, bands: [] }, { timestamp: NOW - DAY, estimate: 1500, ciLow: 1300, ciHigh: 1700, bands: [] }],
    reviews: [{ wordId: 1, timestamp: NOW - 1000, grade: 'good', ms: 60000 }],
  };
  const s = profileSummary({ words, state, now: NOW, offset: 0 });
  assert.equal(s.name, 'Åse');
  assert.equal(s.hasName, true);
  assert.equal(s.estimatedLevel, 'A1'); // both A1 words known, A2 word not
  assert.equal(s.learnedTotal, 2);
  assert.equal(s.tests, 2);
  assert.equal(s.vocab.estimate, 1500);
  assert.equal(s.minutes, 1);
  assert.equal(s.retention7, 1);
  assert.equal(s.eta.level, 'A2');
  assert.equal(profileSummary({ words, state: { ...none, settings: [{ key: 'profileName', value: 'x'.repeat(MAX_NAME + 50) }] }, now: NOW, offset: 0 }).name.length, MAX_NAME);
});
