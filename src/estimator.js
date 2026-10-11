import { shuffle } from './rng.js';
import { generatePseudoWords } from './pseudowords.js';

export const BANDS = [
  { id: 'b1', from: 1, to: 1000 },
  { id: 'b2', from: 1001, to: 2000 },
  { id: 'b3', from: 2001, to: 4000 },
  { id: 'b4', from: 4001, to: 8000 },
  { id: 'b5', from: 8001, to: 16000 },
  { id: 'b6', from: 16001, to: 32000 },
  { id: 'b7', from: 32001, to: Infinity },
];

const Z95 = 1.96;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const bandLabel = (id) => {
  const b = BANDS.find((x) => x.id === id);
  if (!b) return id;
  return b.to === Infinity ? `Rarer than ${(b.from - 1).toLocaleString('en')}` : `Rank ${b.from.toLocaleString('en')}–${b.to.toLocaleString('en')}`;
};

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
  const nPseudo = Math.ceil(items.length * pseudoRatio - 1e-9);
  const pseudo = generatePseudoWords(nPseudo, rng, words.map((w) => w.lemma));
  for (const text of pseudo) items.push({ kind: 'pseudo', band: null, text });
  return shuffle(items, rng);
}

// Real words only (no invented foils): about `count` words spread evenly over the non-empty bands,
// at least one per band so scoreTest has a response in every band. Fills spare slots from the rest.
export function sampleWords(words, rng, count) {
  if (words.length === 0) throw new Error('no words to sample');
  const pools = BANDS.map((b) => shuffle(words.filter((w) => bandOf(w.rank)?.id === b.id), rng)).filter((p) => p.length);
  const per = Math.max(1, Math.floor(count / pools.length));
  const picked = pools.flatMap((p) => p.slice(0, per));
  const rest = shuffle(pools.flatMap((p) => p.slice(per)), rng);
  const chosen = picked.length < count ? [...picked, ...rest.slice(0, count - picked.length)] : picked;
  return shuffle(chosen, rng).map((w) => ({ kind: 'word', band: bandOf(w.rank).id, wordId: w.id, text: w.lemma }));
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
    // Agresti-Coull variance: stays positive at k=0 and k=n. The interval is conditional on f
    // (false-alarm rate treated as known); variance is kept even when this band's estimate is clamped to 0.
    const pt = (k + 2) / (n + 4);
    variance += (size * size * ((pt * (1 - pt)) / (n + 4)) * fpc) / (1 - f) ** 2;
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
