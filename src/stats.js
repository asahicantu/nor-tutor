import { dueCards } from './srs.js';

const DAY = 86400000;
export const MATURE_DAYS = 21;

const dayKey = (t, off) => Math.floor((t + off) / DAY);

export function vocabSeries(tests) {
  return [...tests]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t) => ({ t: t.timestamp, estimate: t.estimate, ciLow: t.ciLow, ciHigh: t.ciHigh }));
}

export function dailyAccuracy(reviews, tzOffsetMs = 0) {
  const byDay = new Map();
  for (const r of reviews) {
    const k = dayKey(r.timestamp, tzOffsetMs);
    const e = byDay.get(k) ?? { reviews: 0, recalled: 0 };
    e.reviews++;
    if (r.grade !== 'again') e.recalled++;
    byDay.set(k, e);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, e]) => ({
      day: new Date(k * DAY).toISOString().slice(0, 10),
      reviews: e.reviews,
      accuracy: e.recalled / e.reviews,
    }));
}

export function streakDays(reviews, now, tzOffsetMs = 0) {
  const days = new Set(reviews.map((r) => dayKey(r.timestamp, tzOffsetMs)));
  let d = dayKey(now, tzOffsetMs);
  if (!days.has(d)) d -= 1;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

export function retentionRate(reviews) {
  const mature = reviews.filter((r) => (r.prevInterval ?? 0) >= MATURE_DAYS);
  if (mature.length === 0) return null;
  return mature.filter((r) => r.grade !== 'again').length / mature.length;
}

export function studyMinutes(reviews) {
  return reviews.reduce((sum, r) => sum + (r.ms ?? 0), 0) / 60000;
}

export function bandProfile(test) {
  return test ? (test.bands ?? []).map((b) => ({ band: b.band, known: b.pCorrected })) : [];
}

export function nextAction({ cards, tests }, now) {
  if (tests.length === 0) return { kind: 'test', dueCount: 0 };
  const dueCount = dueCards(cards, now).length;
  return dueCount > 0 ? { kind: 'review', dueCount } : { kind: 'explore', dueCount: 0 };
}

export const gettingStarted = ({ cards, reviews, tests }) => ({
  test: tests.length > 0,
  deck: cards.length > 0,
  review: reviews.length > 0,
});

// Recall rate over the last 7 days vs the 7 days before, for a plain "am I improving?" line.
export function trend(reviews, now) {
  const DAYS7 = 7 * DAY;
  const rate = (from, to) => {
    const rs = reviews.filter((r) => r.timestamp > from && r.timestamp <= to);
    return rs.length ? { n: rs.length, accuracy: rs.filter((r) => r.grade !== 'again').length / rs.length } : null;
  };
  return { current: rate(now - DAYS7, now), previous: rate(now - 2 * DAYS7, now - DAYS7) };
}

// Estimated share of the words in a typical Norwegian text that you know. Word frequency roughly follows Zipf's law (the
// word of rank r makes up about 1/r of the total, scaled), so each known word adds 1/rank out of the sum over all ranks.
// shortcut: assumes the ranks reach the size of the language (the rarest rank in the list); swap in real corpus counts if they get added to words.json.
export function textCoverage(words, knownIds) {
  const maxRank = Math.max(0, ...words.map((w) => w.rank));
  let all = 0;
  for (let r = 1; r <= maxRank; r++) all += 1 / r;
  const known = words.reduce((sum, w) => sum + (knownIds.has(w.id) ? 1 / w.rank : 0), 0);
  return all ? known / all : 0;
}

// How many things you did on each of the last `days` local days, today last: [{ day, n }] with day as YYYY-MM-DD.
export function activityByDay(timestamps, now, tzOffsetMs = 0, days = 182) {
  const today = dayKey(now, tzOffsetMs);
  const counts = new Map();
  for (const t of timestamps) {
    const k = dayKey(t, tzOffsetMs);
    if (k > today - days && k <= today) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const k = today - days + 1 + i;
    return { day: new Date(k * DAY).toISOString().slice(0, 10), n: counts.get(k) ?? 0 };
  });
}

// Cards coming due on each of the next `days` local days, starting today; cards already overdue count for today.
export function dueForecast(cards, now, tzOffsetMs = 0, days = 14) {
  const today = dayKey(now, tzOffsetMs);
  const out = Array.from({ length: days }, (_, i) => ({ day: new Date((today + i) * DAY).toISOString().slice(0, 10), n: 0 }));
  for (const c of cards) {
    const i = Math.max(0, dayKey(c.due, tzOffsetMs) - today);
    if (i < days) out[i].n++;
  }
  return out;
}
