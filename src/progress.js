// Learning progress derived from the stored review history: what you have learned and when, what you forgot, and
// what to do next. Pure functions, tested in tests/progress.test.js.
import { newCard, review, dueCards } from './srs.js';
import { MATURE_DAYS } from './stats.js';
import { LEVELS, LEVEL_PASS, levelOf, estimateLevel, summarize } from './levels.js';

const DAY = 86400000;
export const MAX_DAYS = 365; // the over-time series shows at most the last year
const dayKey = (t, offset) => Math.floor((t + offset) / DAY);
const dayLabel = (k) => new Date(k * DAY).toISOString().slice(0, 10);

export const categoryOf = (word) => word.pos.split(' ')[0];

// Rebuild each word's scheduler history by replaying its stored grades through the real SM-2 code, so intervals are
// exact. Returns Map<wordId, [{ t, interval, lapse }]> where interval is the card's interval AFTER that review and
// lapse is true for an "again" on a card that had been remembered (at least one successful review before it).
export function replay(reviews) {
  const byWord = new Map();
  for (const r of reviews) {
    if (!byWord.has(r.wordId)) byWord.set(r.wordId, []);
    byWord.get(r.wordId).push(r);
  }
  const out = new Map();
  for (const [id, rs] of byWord) {
    rs.sort((a, b) => a.timestamp - b.timestamp);
    let card = newCard(id, rs[0].timestamp);
    out.set(id, rs.map((r) => {
      const remembered = card.reps > 0;
      card = review(card, r.grade, r.timestamp);
      return { t: r.timestamp, interval: card.interval, lapse: r.grade === 'again' && remembered };
    }));
  }
  return out;
}

// "Learned" = marked known, or a card whose interval has reached MATURE_DAYS.
export function learnedNow({ cards, known }) {
  const ids = new Set(known.map((k) => k.wordId));
  for (const c of cards) if (c.interval >= MATURE_DAYS) ids.add(c.wordId);
  return ids;
}

// One row per local day from the first activity: words learned that day, the estimated CEFR level and lapses.
export function progressSeries({ reviews, known }, words, now, offset = 0) {
  const timelines = replay(reviews);
  const knownAt = new Map(known.map((k) => [k.wordId, k.timestamp]));
  let first = Infinity; // no Math.min(...spread): that throws RangeError on ~100k rows
  for (const r of reviews) if (r.timestamp < first) first = r.timestamp;
  for (const k of known) if (k.timestamp < first) first = k.timestamp;
  if (!Number.isFinite(first)) return [];
  const last = dayKey(now, offset);
  const lapses = new Map();
  for (const tl of timelines.values()) for (const e of tl) if (e.lapse) lapses.set(dayKey(e.t, offset), (lapses.get(dayKey(e.t, offset)) ?? 0) + 1);
  // Levels are computed once; each day only counts learned words per level.
  const levelById = new Map(words.map((w) => [w.id, levelOf(w).level]));
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, { known: 0, total: 0 }]));
  for (const l of levelById.values()) byLevel[l].total++;
  // One cursor per word walks its timeline forward as the days advance.
  const states = [...new Set([...timelines.keys(), ...knownAt.keys()])].map((id) => ({ tl: timelines.get(id) ?? [], p: 0, interval: 0, knownAt: knownAt.get(id), level: levelById.get(id) }));
  const rows = [];
  for (let d = Math.max(dayKey(first, offset), last - MAX_DAYS + 1); d <= last; d++) {
    const end = (d + 1) * DAY - offset - 1; // last millisecond of this local day
    let learned = 0;
    for (const l of LEVELS) byLevel[l].known = 0;
    for (const s of states) {
      while (s.p < s.tl.length && s.tl[s.p].t <= end) s.interval = s.tl[s.p++].interval;
      if (s.interval >= MATURE_DAYS || (s.knownAt !== undefined && s.knownAt <= end)) {
        learned++;
        if (s.level) byLevel[s.level].known++;
      }
    }
    rows.push({ day: dayLabel(d), learned, level: estimateLevel(byLevel), lapses: lapses.get(d) ?? 0 });
  }
  return rows;
}

// Lapses in the last `days` days, the most-forgotten words, and lapses per week for the last 8 weeks (oldest first).
export function forgotten({ reviews }, now, days = 30, offset = 0) {
  const events = [];
  for (const [wordId, tl] of replay(reviews)) for (const e of tl) if (e.lapse) events.push({ wordId, t: e.t });
  const recent = events.filter((e) => e.t > now - days * DAY && e.t <= now);
  const counts = new Map();
  for (const e of recent) counts.set(e.wordId, { count: (counts.get(e.wordId)?.count ?? 0) + 1, last: Math.max(counts.get(e.wordId)?.last ?? 0, e.t) });
  const top = [...counts].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last).slice(0, 5).map(([wordId, v]) => ({ wordId, count: v.count }));
  const today = dayKey(now, offset);
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const from = today - (7 - i) * 7 - 6;
    return { label: dayLabel(from), lapses: events.filter((e) => dayKey(e.t, offset) >= from && dayKey(e.t, offset) <= from + 6).length };
  });
  return { lapses: recent.length, words: counts.size, top, weekly };
}

// Learned / learning (in the deck, not learned) / not started per key (e.g. part of speech or CEFR level).
export function breakdown(words, status, keyOf, order) {
  const rows = new Map((order ?? []).map((k) => [k, { key: k, learned: 0, learning: 0, notStarted: 0, total: 0 }]));
  for (const w of words) {
    const key = keyOf(w);
    if (!rows.has(key)) rows.set(key, { key, learned: 0, learning: 0, notStarted: 0, total: 0 });
    const row = rows.get(key);
    row.total++;
    if (status.known.has(w.id)) row.learned++;
    else if (status.deck.has(w.id)) row.learning++;
    else row.notStarted++;
  }
  const list = [...rows.values()];
  return order ? list : list.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Up to five ranked suggestions, each { id, text, href }.
export function recommend({ words, cards, reviews, known, now, offset = 0 }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const learned = learnedNow({ cards, known });
  const out = [];
  if (cards.length === 0 && known.length === 0) {
    return [{ id: 'start', text: 'Add some words to your review deck, or mark the ones you already know, to start learning.', href: '#/explore' }];
  }
  const due = dueCards(cards, now).length;
  if (due > 0) out.push({ id: 'due', text: `${plural(due, 'card is', 'cards are')} due. Reviewing now keeps those words from fading.`, href: '#/review' });
  const lastReview = reviews.reduce((m, r) => Math.max(m, r.timestamp), 0);
  const idleDays = Math.floor((now - lastReview) / DAY);
  if (due === 0 && cards.length > 0 && idleDays >= 3) out.push({ id: 'idle', text: `You have not reviewed for ${plural(idleDays, 'day', 'days')}. A short session keeps your streak and your words alive.`, href: '#/review' });

  const f = forgotten({ reviews }, now, 30, offset);
  const names = f.top.filter((x) => x.count >= 2 && byId.has(x.wordId)).slice(0, 3).map((x) => byId.get(x.wordId).lemma);
  if (names.length) out.push({ id: 'forgotten', text: `You keep forgetting ${names.join(', ')}. Open them in Words and read the context sentences.`, href: '#/explore' });

  const stats = new Map();
  let all = 0, allOk = 0;
  for (const r of reviews.filter((x) => x.timestamp > now - 60 * DAY && byId.has(x.wordId))) {
    const cat = categoryOf(byId.get(r.wordId));
    const s = stats.get(cat) ?? { n: 0, ok: 0 };
    s.n++;
    if (r.grade !== 'again') { s.ok++; allOk++; }
    all++;
    stats.set(cat, s);
  }
  const weak = [...stats].filter(([, s]) => s.n >= 10).map(([cat, s]) => ({ cat, rate: s.ok / s.n })).sort((a, b) => a.rate - b.rate)[0];
  if (weak && all > 0 && allOk / all - weak.rate >= 0.1) {
    out.push({ id: 'weak-category', text: `Your ${weak.cat} retention is ${pct(weak.rate)}, against ${pct(allOk / all)} overall. Give ${weak.cat}s extra review time.`, href: '#/review' });
  }

  const s = summarize(words, { known: learned, deck: new Set(cards.map((c) => c.wordId)) });
  const next = LEVELS.find((l) => s.byLevel[l].total > 0 && s.byLevel[l].known / s.byLevel[l].total < LEVEL_PASS);
  if (next) {
    const { known: k, total } = s.byLevel[next];
    out.push({ id: 'next-level', text: `Learn ${Math.ceil(LEVEL_PASS * total) - k} more ${next} words to reach ${next} (${pct(k / total)} learned so far).`, href: '#/explore' });
  }
  return out.slice(0, 5);
}
