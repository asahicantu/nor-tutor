// CEFR level and complexity of a word. The level comes from an optional `cefr` field on the word, otherwise it is
// derived from the frequency rank (an approximation: tune LIMITS if it feels off).
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LIMITS = [['A1', 500], ['A2', 1500], ['B1', 4000], ['B2', 10000], ['C1', 20000]]; // C2 is everything rarer
const STEP = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 5 };
export const LEVEL_PASS = 0.7; // share of a level's words that must be known to count as "reached"

export function levelOf(word) {
  if (LEVELS.includes(word.cefr)) return { level: word.cefr, derived: false };
  const level = LIMITS.find(([, max]) => word.rank <= max)?.[0] ?? 'C2';
  return { level, derived: true };
}

export const complexityOf = (word) => STEP[levelOf(word).level];

// Highest level reached: walk up through the levels that have words and stop at the first one under LEVEL_PASS.
// `byLevel` is { A1: { known, total }, ... }.
export function estimateLevel(byLevel) {
  let estimated = null;
  for (const l of LEVELS) {
    const { known, total } = byLevel[l];
    if (total === 0) continue;
    if (known / total < LEVEL_PASS) break;
    estimated = l;
  }
  return estimated;
}

// `status.known` is the set of word ids to count as known (the Words page passes "marked known",
// the Review page passes "learned"); `status.deck` is the set of ids in the review deck.
export function summarize(words, status) {
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, { known: 0, inReview: 0, notRated: 0, total: 0 }]));
  let known = 0, inReview = 0, complexitySum = 0, hardestKnown = null;
  for (const w of words) {
    const level = levelOf(w).level;
    const row = byLevel[level];
    row.total++;
    if (status.known.has(w.id)) {
      row.known++;
      known++;
      const c = STEP[level];
      complexitySum += c;
      if (!hardestKnown || c > complexityOf(hardestKnown) || (c === complexityOf(hardestKnown) && w.rank > hardestKnown.rank)) hardestKnown = w;
    } else if (status.deck.has(w.id)) {
      row.inReview++;
      inReview++;
    } else {
      row.notRated++;
    }
  }
  return {
    total: words.length, known, inReview, notRated: words.length - known - inReview, toLearn: words.length - known,
    byLevel, estimatedLevel: estimateLevel(byLevel), avgComplexity: known ? complexitySum / known : null, hardestKnown,
  };
}
