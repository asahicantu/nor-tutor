const ONSETS = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'sk', 'st', 'tr', 'kl', 'br', 'fr'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'y', 'æ', 'ø', 'å', 'ei', 'au'];
const END_CODAS = ['', 'n', 'r', 'l', 't', 'k', 'm', 's', 'g', 'nd', 'st', 'rk', 'ld'];
const MID_CODAS = ['', 'n', 'r', 'l', 't'];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export function generatePseudoWords(count, rng, realWords) {
  const real = new Set(realWords.map((w) => w.toLowerCase()));
  const out = new Set();
  let guard = 0;
  while (out.size < count) {
    if (++guard > count * 200 + 1000) throw new Error('could not generate enough pseudo-words');
    const syllables = 2 + Math.floor(rng() * 2);
    let w = '';
    for (let i = 0; i < syllables; i++) {
      w += pick(ONSETS, rng) + pick(VOWELS, rng) + pick(i === syllables - 1 ? END_CODAS : MID_CODAS, rng);
    }
    if (w.length < 4 || real.has(w)) continue;
    out.add(w);
  }
  return [...out];
}
