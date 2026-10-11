import { dueCards } from './srs.js';
import { streakDays } from './stats.js';

const DAY = 86400000;
export const DAILY_GOAL = 20;
const XP = { remembered: 10, forgotten: 2, test: 50, known: 5, card: 3, phrase: 5 };
const start = (n) => 50 * n * (n - 1); // XP at which level n begins

export function xpTotal({ reviews, tests, known, cards, phrases }) {
  const remembered = reviews.filter((r) => r.grade !== 'again').length;
  return (
    remembered * XP.remembered + (reviews.length - remembered) * XP.forgotten +
    tests.length * XP.test + known.length * XP.known + cards.length * XP.card +
    phrases.reduce((sum, p) => sum + p.got * XP.phrase, 0)
  );
}

export const reviewXp = ({ again, hard, good, easy }) => (hard + good + easy) * XP.remembered + again * XP.forgotten;

export function levelInfo(xp) {
  let level = 1;
  while (xp >= start(level + 1)) level++;
  const into = xp - start(level);
  const needed = start(level + 1) - start(level);
  return { level, into, needed, pct: Math.round((into / needed) * 100) };
}

export const streak = ({ reviews, tests }, now, offset = 0) => streakDays([...reviews, ...tests], now, offset);

export function dailyQuest({ cards, reviews }, now, offset = 0) {
  const today = Math.floor((now + offset) / DAY);
  const done = reviews.filter((r) => Math.floor((r.timestamp + offset) / DAY) === today).length;
  const goal = Math.min(DAILY_GOAL, Math.max(1, done + dueCards(cards, now).length));
  return { done, goal, pct: Math.min(100, Math.round((done / goal) * 100)), complete: done >= goal };
}

const BADGES = [
  { id: 'first-test', title: 'First test', text: 'Take the vocabulary test', metric: 'tests', target: 1 },
  { id: 'first-review', title: 'First review', text: 'Review a card', metric: 'reviews', target: 1 },
  { id: 'deck-10', title: 'Deck builder', text: 'Add 10 cards to your deck', metric: 'cards', target: 10 },
  { id: 'known-50', title: 'Word collector', text: 'Mark 50 words as known', metric: 'known', target: 50 },
  { id: 'streak-3', title: 'On a roll', text: 'Study 3 days in a row', metric: 'streak', target: 3 },
  { id: 'streak-7', title: 'Week warrior', text: 'Study 7 days in a row', metric: 'streak', target: 7 },
  { id: 'reviews-100', title: 'Century', text: 'Answer 100 reviews', metric: 'reviews', target: 100 },
  { id: 'level-5', title: 'Level 5', text: 'Reach level 5', metric: 'level', target: 5 },
];

export function badges(state, now, offset = 0) {
  const m = {
    tests: state.tests.length, reviews: state.reviews.length, cards: state.cards.length, known: state.known.length,
    streak: streak(state, now, offset), level: levelInfo(xpTotal(state)).level,
  };
  return BADGES.map(({ metric, ...b }) => ({ ...b, value: Math.min(m[metric], b.target), earned: m[metric] >= b.target }));
}

export function newBadges(state, awards, now, offset = 0) {
  const have = new Set(awards.map((a) => a.awardId));
  return badges(state, now, offset).filter((b) => b.earned && !have.has(b.id));
}
