// How strongly you know a word, and the data for the word cloud: a word's SIZE is how often you have met it (times you
// studied it plus times it reappeared as an unknown word), its COLOUR is how strong your knowledge of it is.
// Pure; tested in tests/strength.test.js.
import { MATURE_DAYS } from './stats.js';

export const STRENGTHS = [
  { id: 'weak', label: 'Weak' },
  { id: 'learning', label: 'Learning' },
  { id: 'solid', label: 'Solid' },
  { id: 'strong', label: 'Strong' },
];

const SOLID_DAYS = 6; // the second SM-2 step: a card remembered twice

// `known`: marked as known (at `knownAt`); `card`: its review card (or undefined); `missed`: times it was missed as an unknown
// word (last at `lastMissAt`). Whichever came last wins: a word you marked known and then missed again is not strong.
export function wordStrength({ known = false, knownAt = 0, card, missed = 0, lastMissAt = 0 }) {
  if (known && (missed === 0 || knownAt >= lastMissAt)) return 'strong';
  if (card) {
    if (card.interval >= MATURE_DAYS) return 'strong';
    if (card.interval >= SOLID_DAYS) return 'solid';
    return card.reps >= 1 && card.interval >= 1 ? 'learning' : 'weak';
  }
  return missed > 0 ? 'weak' : null;
}

// Words with their exposure counts and strength. By default the most-met words (limit); with `ids` (e.g. one test session)
// exactly those words, each at least size 1. Words that no longer exist in the word list are ignored.
export function cloudItems(words, { cards, reviews, known, unknown }, { limit = 60, ids = null } = {}) {
  const studied = new Map();
  for (const r of reviews) studied.set(r.wordId, (studied.get(r.wordId) ?? 0) + 1);
  const missed = new Map(unknown.map((u) => [u.wordId, u]));
  const cardOf = new Map(cards.map((c) => [c.wordId, c]));
  const knownAt = new Map(known.map((k) => [k.wordId, k.timestamp]));
  const items = [];
  for (const w of words) {
    if (ids && !ids.has(w.id)) continue;
    const s = studied.get(w.id) ?? 0;
    const miss = missed.get(w.id);
    const m = miss?.count ?? 0;
    const count = s + m;
    if (!ids && count === 0) continue;
    items.push({
      id: w.id, text: w.lemma, gloss: w.gloss_en, studied: s, missed: m, count: Math.max(1, count),
      strength: wordStrength({ known: knownAt.has(w.id), knownAt: knownAt.get(w.id), card: cardOf.get(w.id), missed: m, lastMissAt: miss?.lastAt ?? 0 }),
    });
  }
  items.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'nb'));
  return ids ? items : items.slice(0, limit);
}

const MIN_REM = 0.95;
const MAX_REM = 2.6;
// Font size in rem for a word met `count` times when the most-met word was met `max` times (square-root scale, so a few
// very frequent words do not shrink everything else to nothing).
export function fontSize(count, max) {
  if (max <= 0) return MIN_REM;
  return Math.round((MIN_REM + (MAX_REM - MIN_REM) * Math.sqrt(Math.min(count, max) / max)) * 100) / 100;
}

// How many of the words you have met are weak, learning, solid or strong (words never met are not counted).
export function strengthCounts(words, state) {
  const counts = { weak: 0, learning: 0, solid: 0, strong: 0, total: 0 };
  for (const item of cloudItems(words, state, { ids: new Set(words.map((w) => w.id)) })) {
    if (item.strength) { counts[item.strength]++; counts.total++; }
  }
  return counts;
}
