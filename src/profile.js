// Numbers for the profile panel: words learned per day, pace, an estimated CEFR level and a time-to-next-level guess.
// Everything is derived from existing data; the level is estimated from vocabulary only (the app has no speaking data).
import { LEVELS, LEVEL_PASS, summarize } from './levels.js';
import { learnedNow, progressSeries, MAX_DAYS } from './progress.js';
import { levelInfo, xpTotal, streak, dailyQuest } from './gamify.js';
import { studyMinutes, trend } from './stats.js';

const DAY = 86400000;
export const MAX_NAME = 60;
const MIN_PACE = 0.05; // words/day below which a time estimate would be meaningless

const BLURBS = {
  A1: 'Basic phrases for everyday needs: introduce yourself and ask and answer simple personal questions.',
  A2: 'Simple routine exchanges: shopping, directions, family and work, in short and clear sentences.',
  B1: 'Handle most situations while travelling; describe experiences, plans and opinions in simple connected speech.',
  B2: 'Understand the main ideas of complex text and talk with a fair degree of fluency with native speakers.',
  C1: 'Use the language flexibly and fluently for social, academic and professional purposes.',
  C2: 'Understand virtually everything and express yourself precisely, even in complex situations.',
};
export const levelBlurb = (level) => BLURBS[level] ?? `Know about ${Math.round(LEVEL_PASS * 100)}% of the A1 words to reach your first level.`;

// Words newly learned per day, from the "learned at the end of each day" series. A lapse can lower the total, which is
// forgetting rather than negative learning, so a day's gain never goes below 0.
export function gainsPerDay(series) {
  // A full-length series is cut at MAX_DAYS, so its first row includes everything learned before the window.
  let prev = series.length >= MAX_DAYS ? series[0].learned : 0;
  return series.map((r) => {
    const gained = Math.max(0, r.learned - prev);
    prev = r.learned;
    return { day: r.day, gained };
  });
}

const shiftDay = (day, by) => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10);

// Today's, 7-day and 30-day averages, the best day, and the last 14 days (oldest first, zeros before the first activity).
export function paceStats(series) {
  const gains = gainsPerDay(series);
  const byDay = new Map(gains.map((g) => [g.day, g.gained]));
  const end = gains.length ? gains[gains.length - 1].day : new Date(0).toISOString().slice(0, 10);
  const lastN = (n) => Array.from({ length: n }, (_, i) => byDay.get(shiftDay(end, i - n + 1)) ?? 0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const best = gains.reduce((b, g) => (g.gained > (b?.gained ?? 0) ? g : b), null);
  return {
    today: gains.length ? gains[gains.length - 1].gained : 0,
    avg7: sum(lastN(7)) / 7,
    avg30: sum(lastN(30)) / 30,
    best,
    last14: lastN(14),
    total: sum(gains.map((g) => g.gained)),
  };
}

// The first level (that has words) still under LEVEL_PASS: how many more words it needs and about how many days at `pace`.
export function etaToNextLevel(byLevel, pace) {
  const level = LEVELS.find((l) => byLevel[l].total > 0 && byLevel[l].known / byLevel[l].total < LEVEL_PASS);
  if (!level) return null;
  const { known, total } = byLevel[level];
  const target = Math.ceil(LEVEL_PASS * total);
  const needed = target - known;
  return { level, known, needed, pct: Math.round((known / target) * 100), days: pace >= MIN_PACE ? Math.ceil(needed / pace) : null };
}

const cleanName = (rows) => {
  const raw = rows.find((r) => r.key === 'profileName')?.value ?? '';
  return raw.trim().slice(0, MAX_NAME) || 'Learner';
};

export function profileSummary({ words, state, now, offset = 0 }) {
  const ids = new Set(words.map((w) => w.id));
  const live = (rows) => rows.filter((r) => ids.has(r.wordId));
  const cards = live(state.cards), reviews = live(state.reviews), known = live(state.known);
  const learned = learnedNow({ cards, known });
  const status = { known: learned, deck: new Set(cards.map((c) => c.wordId)) };
  const s = summarize(words, status);
  const pace = paceStats(reviews.length || known.length ? progressSeries({ reviews, known }, words, now, offset) : []);
  const latestTest = [...state.tests].sort((a, b) => b.timestamp - a.timestamp)[0];
  const t7 = trend(reviews, now).current;
  return {
    name: cleanName(state.settings ?? []),
    hasName: (state.settings ?? []).some((r) => r.key === 'profileName' && typeof r.value === 'string' && r.value.trim() !== ''),
    level: levelInfo(xpTotal(state)),
    streak: streak(state, now, offset),
    quest: dailyQuest(state, now, offset),
    estimatedLevel: s.estimatedLevel,
    blurb: levelBlurb(s.estimatedLevel),
    eta: etaToNextLevel(s.byLevel, pace.avg30),
    pace,
    learnedTotal: learned.size,
    reviews: reviews.length,
    retention7: t7 ? t7.accuracy : null,
    minutes: Math.round(studyMinutes(reviews)),
    tests: state.tests.length,
    vocab: latestTest ? { estimate: latestTest.estimate, ciLow: latestTest.ciLow, ciHigh: latestTest.ciHigh, timestamp: latestTest.timestamp } : null,
  };
}
