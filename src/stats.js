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
