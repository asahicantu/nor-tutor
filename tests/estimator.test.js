import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, bandOf, bandSizes, sampleTest, scoreTest } from '../src/estimator.js';
import { mulberry32 } from '../src/rng.js';

const near = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

function makeWords(perBand) {
  const words = [];
  for (const b of BANDS) {
    for (let i = 0; i < perBand; i++) {
      const rank = b.from + i;
      words.push({ id: `w${rank}`, lemma: `ord${rank}`, rank });
    }
  }
  return words;
}

function resp(band, n, known, kind = 'word') {
  return Array.from({ length: n }, (_, i) => ({ kind, band, known: i < known }));
}

test('bandOf maps ranks to bands and rejects out-of-range', () => {
  assert.equal(bandOf(1).id, 'b1');
  assert.equal(bandOf(1000).id, 'b1');
  assert.equal(bandOf(1001).id, 'b2');
  assert.equal(bandOf(64000).id, 'b7');
  assert.equal(bandOf(64001), null);
});

test('bandSizes counts words per band', () => {
  const s = bandSizes(makeWords(3));
  assert.deepEqual(Object.values(s), [3, 3, 3, 3, 3, 3, 3]);
});

test('sampleTest: perBand words per band, 20% pseudo, no duplicates, deterministic', () => {
  const words = makeWords(30);
  const items = sampleTest(words, mulberry32(9));
  const real = items.filter((i) => i.kind === 'word');
  const pseudo = items.filter((i) => i.kind === 'pseudo');
  assert.equal(real.length, 140);
  assert.equal(pseudo.length, 28);
  assert.equal(new Set(real.map((i) => i.wordId)).size, 140);
  for (const b of BANDS) assert.equal(real.filter((i) => i.band === b.id).length, 20);
  assert.deepEqual(items, sampleTest(words, mulberry32(9)));
});

test('sampleTest: a small band yields all its words; empty list throws', () => {
  const items = sampleTest(makeWords(5), mulberry32(1));
  assert.equal(items.filter((i) => i.kind === 'word' && i.band === 'b1').length, 5);
  assert.throws(() => sampleTest([], mulberry32(1)), /no words to sample/);
});

test('scoreTest: everything known, no nonsense words -> full list, zero-width CI', () => {
  const r = scoreTest([...resp('b1', 20, 20), ...resp('b2', 20, 20)], { b1: 100, b2: 100 });
  assert.equal(r.estimate, 200);
  assert.equal(r.ciLow, 200);
  assert.equal(r.ciHigh, 200);
  assert.equal(r.listSize, 200);
});

test('scoreTest: half known gives half the band with a symmetric 95% CI', () => {
  const r = scoreTest(resp('b1', 20, 10), { b1: 1000 });
  assert.equal(r.estimate, 500);
  near(r.ciLow, 283);
  near(r.ciHigh, 717);
});

test('scoreTest: guessing correction uses the false-alarm rate', () => {
  const responses = [...resp('b1', 20, 15), ...resp('', 8, 4, 'pseudo')];
  const r = scoreTest(responses, { b1: 1000 });
  assert.equal(r.falseAlarmRate, 0.5);
  assert.equal(r.estimate, 500); // (0.75 - 0.5) / 0.5 = 0.5
});

test('scoreTest: known rate below false-alarm rate clamps to zero', () => {
  const responses = [...resp('b1', 20, 2), ...resp('', 4, 2, 'pseudo')];
  assert.equal(scoreTest(responses, { b1: 1000 }).estimate, 0);
});

test('scoreTest: sampling the whole band has no sampling variance', () => {
  const r = scoreTest(resp('b1', 10, 5), { b1: 10 });
  assert.equal(r.estimate, 5);
  assert.equal(r.ciLow, 5);
  assert.equal(r.ciHigh, 5);
});

test('scoreTest: all nonsense words marked known -> RangeError (Review Focus 1)', () => {
  const responses = [...resp('b1', 20, 20), ...resp('', 5, 5, 'pseudo')];
  assert.throws(() => scoreTest(responses, { b1: 1000 }), RangeError);
});

test('scoreTest: empty bands are skipped, missing responses for a real band throw', () => {
  const r = scoreTest(resp('b1', 10, 10), { b1: 50, b2: 0 });
  assert.equal(r.bands.length, 1);
  assert.throws(() => scoreTest(resp('b1', 10, 10), { b1: 50, b2: 50 }), /no responses for band b2/);
});
