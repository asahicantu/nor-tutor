import { shuffle } from './rng.js';
import { generatePseudoWords } from './pseudowords.js';

export const BANDS = [
  { id: 'b1', from: 1, to: 1000 },
  { id: 'b2', from: 1001, to: 2000 },
  { id: 'b3', from: 2001, to: 4000 },
  { id: 'b4', from: 4001, to: 8000 },
  { id: 'b5', from: 8001, to: 16000 },
  { id: 'b6', from: 16001, to: 32000 },
  { id: 'b7', from: 32001, to: 64000 },
];

const Z95 = 1.96;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function bandOf(rank) {
  return BANDS.find((b) => rank >= b.from && rank <= b.to) ?? null;
}

export function bandSizes(words) {
  const sizes = Object.fromEntries(BANDS.map((b) => [b.id, 0]));
  for (const w of words) {
    const b = bandOf(w.rank);
    if (b) sizes[b.id]++;
  }
  return sizes;
}

export function sampleTest(words, rng, { perBand = 20, pseudoRatio = 0.2 } = {}) {
  if (words.length === 0) throw new Error('no words to sample');
  const items = [];
  for (const band of BANDS) {
    const pool = words.filter((w) => bandOf(w.rank)?.id === band.id);
    for (const w of shuffle(pool, rng).slice(0, perBand)) {
      items.push({ kind: 'word', band: band.id, wordId: w.id, text: w.lemma });
    }
  }
  const nPseudo = Math.round(items.length * pseudoRatio);
  const pseudo = generatePseudoWords(nPseudo, rng, words.map((w) => w.lemma));
  for (const text of pseudo) items.push({ kind: 'pseudo', band: null, text });
  return shuffle(items, rng);
}

export function scoreTest(responses, sizes) {
  const pseudo = responses.filter((r) => r.kind === 'pseudo');
  const f = pseudo.length ? pseudo.filter((r) => r.known).length / pseudo.length : 0;
  if (f >= 1) throw new RangeError('false-alarm rate is 100%: estimate is undefined');

  let estimate = 0;
  let variance = 0;
  let listSize = 0;
  const bands = [];
  for (const band of BANDS) {
    const size = sizes[band.id] ?? 0;
    if (size === 0) continue;
    listSize += size;
    const rs = responses.filter((r) => r.kind === 'word' && r.band === band.id);
    if (rs.length === 0) throw new Error(`no responses for band ${band.id}`);
    const n = rs.length;
    const k = rs.filter((r) => r.known).length;
    const p = k / n;
    const pCorrected = clamp((p - f) / (1 - f), 0, 1);
    estimate += size * pCorrected;
    const fpc = Math.max(0, 1 - n / size);
    variance += (size * size * ((p * (1 - p)) / n) * fpc) / (1 - f) ** 2;
    bands.push({ band: band.id, size, sampled: n, known: k, pCorrected });
  }
  const sd = Math.sqrt(variance);
  return {
    estimate: Math.round(estimate),
    ciLow: Math.round(clamp(estimate - Z95 * sd, 0, listSize)),
    ciHigh: Math.round(clamp(estimate + Z95 * sd, 0, listSize)),
    falseAlarmRate: f,
    pseudoTotal: pseudo.length,
    listSize,
    bands,
  };
}
