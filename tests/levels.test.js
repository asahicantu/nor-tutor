import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, levelOf, complexityOf, summarize } from '../src/levels.js';

const w = (id, rank, extra = {}) => ({ id, rank, lemma: `w${id}`, pos: 'noun', ...extra });
const status = (known = [], deck = []) => ({ known: new Set(known), deck: new Set(deck) });

test('levelOf derives the level from rank at every boundary', () => {
  const at = (rank) => levelOf(w(1, rank));
  assert.deepEqual(at(500), { level: 'A1', derived: true });
  assert.equal(at(501).level, 'A2');
  assert.equal(at(1500).level, 'A2');
  assert.equal(at(1501).level, 'B1');
  assert.equal(at(4000).level, 'B1');
  assert.equal(at(4001).level, 'B2');
  assert.equal(at(10000).level, 'B2');
  assert.equal(at(10001).level, 'C1');
  assert.equal(at(20000).level, 'C1');
  assert.equal(at(20001).level, 'C2');
});

test('a valid cefr override wins and is not marked derived; an invalid one is ignored', () => {
  assert.deepEqual(levelOf(w(1, 50, { cefr: 'C2' })), { level: 'C2', derived: false });
  assert.deepEqual(levelOf(w(1, 50, { cefr: 'D9' })), { level: 'A1', derived: true });
});

test('complexityOf is the level step, C1 and C2 both 5', () => {
  assert.deepEqual(LEVELS.map((l) => complexityOf(w(1, 1, { cefr: l }))), [1, 2, 3, 4, 5, 5]);
});

test('summarize on an empty list has no NaN and no estimated level', () => {
  const s = summarize([], status());
  assert.equal(s.total, 0);
  assert.equal(s.estimatedLevel, null);
  assert.equal(s.avgComplexity, null);
  assert.equal(s.hardestKnown, null);
  assert.deepEqual(Object.keys(s.byLevel), LEVELS);
});

test('summarize splits known, in review and not rated; toLearn includes in review', () => {
  const words = [w(1, 100), w(2, 200), w(3, 300), w(4, 400)];
  const s = summarize(words, status([1], [2, 1]));
  assert.deepEqual([s.total, s.known, s.inReview, s.notRated, s.toLearn], [4, 1, 1, 2, 3]);
  assert.deepEqual(s.byLevel.A1, { known: 1, inReview: 1, notRated: 2, total: 4 });
});

test('estimatedLevel: stops at the first level under 70%, skips empty levels', () => {
  const words = [
    w(1, 100), w(2, 200), // A1
    w(3, 1000), w(4, 1100), // A2
    w(5, 3000), w(6, 3100), w(7, 3200), w(8, 3300), // B1
  ];
  assert.equal(summarize(words, status([1, 2, 3, 4])).estimatedLevel, 'A2'); // B1 empty-handed, B2+ empty
  assert.equal(summarize(words, status([1, 2, 3, 5, 6, 7, 8])).estimatedLevel, 'A1'); // A2 only 50%
  assert.equal(summarize(words, status([1])).estimatedLevel, null); // A1 only 50%
  assert.equal(summarize(words, status([1, 2, 3, 4, 5, 6, 7])).estimatedLevel, 'B1'); // 3/4 = 75%
});

test('summarize with every word known: nothing to learn, highest non-empty level, average set', () => {
  const words = [w(1, 100), w(2, 1000), w(3, 3000)]; // A1, A2, B1
  const s = summarize(words, status([1, 2, 3]));
  assert.equal(s.toLearn, 0);
  assert.equal(s.estimatedLevel, 'B1');
  assert.equal(s.avgComplexity, 2);
});

test('summarize on a mixed list: level totals sum to total and statuses sum to each level total', () => {
  const words = [w(1, 100), w(2, 200), w(3, 1000), w(4, 3000), w(5, 9000), w(6, 30000)];
  const s = summarize(words, status([1, 3], [2, 3, 5]));
  assert.equal(LEVELS.reduce((a, l) => a + s.byLevel[l].total, 0), s.total);
  for (const l of LEVELS) {
    const r = s.byLevel[l];
    assert.equal(r.known + r.inReview + r.notRated, r.total);
  }
});

test('avgComplexity and hardestKnown cover known words only; ties go to the rarest word', () => {
  const words = [w(1, 100), w(2, 3000), w(3, 3500), w(4, 9000)];
  const s = summarize(words, status([1, 2, 3]));
  assert.equal(s.avgComplexity, (1 + 3 + 3) / 3);
  assert.equal(s.hardestKnown.id, 3); // B1 twice; rank 3500 is the rarest
});
