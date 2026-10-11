import { h, no } from '../dom.js';
import { LEVELS, levelOf } from '../levels.js';
import { learnedNow, progressSeries, forgotten, breakdown, categoryOf, recommend } from '../progress.js';
import { barChart, lineChart, token, accent } from '../charts.js';
import { cloudItems } from '../strength.js';
import { wordCloud } from './wordcloud.js';

const n = (x) => x.toLocaleString('en');
const LABELS = ['Learned', 'Learning', 'Not started'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (iso) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const plural = (c, one, many) => `${n(c)} ${c === 1 ? one : many}`;

// The "Review" page statistics: recommendations plus four charts, each with a "Show numbers" table.
export function renderReviewStats(input) {
  const { words, unknown, now } = input;
  const byId = new Map(words.map((w) => [w.id, w]));
  // Ignore rows for words that are no longer in words.json, so they do not inflate counts or recommendations.
  const live = (rows) => rows.filter((r) => byId.has(r.wordId));
  const cards = live(input.cards), reviews = live(input.reviews), known = live(input.known);
  const offset = -new Date().getTimezoneOffset() * 60000;
  const noChart = typeof Chart === 'undefined';
  const learnedSet = learnedNow({ cards, known });
  const status = { known: learnedSet, deck: new Set(cards.map((c) => c.wordId)) };

  // One chart section: heading, one-line explanation, chart area (or empty message) and a numbers table.
  function panel(title, what, { empty, label, height, make, table, extra }) {
    const canvas = h('canvas', { role: 'img', 'aria-label': label });
    const kids = [h('h2', {}, title), h('p', { class: 'muted' }, what)];
    if (empty) kids.push(h('p', { class: 'muted', role: 'status' }, empty));
    else {
      if (extra) kids.push(extra);
      if (noChart) kids.push(h('p', { class: 'muted', role: 'status' }, 'Charts need Chart.js from the internet, which could not be loaded.'));
      else {
        kids.push(h('div', { class: 'chart', style: height ? `height:${height}px` : false }, canvas));
        queueMicrotask(() => { if (canvas.isConnected) make(canvas); });
      }
      kids.push(h('details', { class: 'wnums' }, h('summary', {}, 'Show numbers'), table));
    }
    return h('div', { class: 'card' }, kids);
  }

  const tbl = (caption, head, rows) => h('div', { class: 'tscroll' }, h('table', {},
    h('caption', {}, caption),
    h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map(([first, ...rest]) => h('tr', {}, h('th', { scope: 'row' }, first), rest.map((c) => h('td', {}, c)))))));

  // Stacked horizontal bars: learned / learning / not started per row of a breakdown().
  function stacked(title, what, rows, noun, caption) {
    const c = [token('--known', '#0d6868'), token('--review', '#8a5200'), token('--muted', '#55536b')];
    const data = [(r) => r.learned, (r) => r.learning, (r) => r.notStarted];
    return panel(title, what, {
      label: `${title}: learned, learning and not started words per ${noun}`,
      height: rows.length * 30 + 70,
      make: (canvas) => barChart(canvas, rows.map((r) => r.key), LABELS.map((label, i) => ({ label, data: rows.map(data[i]), backgroundColor: c[i], borderColor: token('--card', '#fff'), borderWidth: 1 })), { horizontal: true, stacked: true }),
      table: tbl(caption, [noun[0].toUpperCase() + noun.slice(1), ...LABELS, 'Total'], rows.map((r) => [r.key, n(r.learned), n(r.learning), n(r.notStarted), n(r.total)])),
    });
  }

  // (a) recommendations
  const recs = recommend({ words, cards, reviews, known, unknown, now, offset });
  const recCard = h('div', { class: 'card' }, h('h2', {}, 'Recommendations'),
    recs.length
      ? h('ul', { class: 'plain recs' }, recs.map((r) => h('li', {}, h('a', { href: r.href }, r.text))))
      : h('p', {}, 'You are on track. Nothing urgent right now.'));

  // (b) + (c) learned by category / complexity
  const cats = breakdown(words, status, categoryOf);
  const byCat = stacked('Learned by category', 'How many words of each part of speech you have learned (known, or remembered for 3+ weeks), are learning, or have not started.', cats, 'category', 'Learned by category');
  const lvls = breakdown(words, status, (w) => levelOf(w).level, LEVELS);
  const byLevel = stacked('Learned by complexity', 'The same split for each CEFR level, from A1 (easiest) to C2.', lvls, 'level', 'Learned by complexity');

  // (d) progress over time
  const series = progressSeries({ reviews, known }, words, now, offset);
  const current = series.length ? series[series.length - 1].level : null;
  // Only the unbroken climb ending today (levels never going down within it), so the list can't contradict
  // "Current level" after a lapse dropped you to a lower level.
  const rank = (l) => (l ? LEVELS.indexOf(l) : -1);
  const changes = [];
  if (current) {
    let from = series.length - 1;
    while (from > 0 && rank(series[from - 1].level) <= rank(series[from].level)) from--;
    for (const r of series.slice(from)) if (r.level && !changes.some((c) => c.level === r.level)) changes.push({ level: r.level, day: r.day });
  }
  const levelText = h('p', {},
    changes.length ? changes.map((c) => `Level ${c.level} since ${niceDay(c.day)}`).join(' · ') : 'No level reached yet',
    h('br'), h('strong', {}, current ? `Current level: ${current}` : 'Current level: none yet'));
  const over = panel('Your progress over time', 'Words you had learned at the end of each day.', {
    empty: series.length ? null : 'Review some cards and this chart fills in.',
    label: 'Words learned per day',
    extra: levelText,
    make: (canvas) => lineChart(canvas, series.map((r) => niceDay(r.day)), [{ label: 'Words learned', data: series.map((r) => r.learned), borderColor: accent(), backgroundColor: accent(), tension: 0.25, pointRadius: series.length > 60 ? 0 : 3 }]),
    table: tbl('Words learned per day', ['Day', 'Words learned', 'Estimated level'], series.slice().reverse().map((r) => [niceDay(r.day), n(r.learned), r.level ?? '—'])),
  });

  // (e) forgotten words
  const f = forgotten({ reviews }, now, 30, offset);
  const anyLapse = f.weekly.some((w) => w.lapses > 0);
  const tile = h('div', { class: 'wtile' }, h('span', { class: 'wtile-l' }, 'Forgotten, last 30 days'),
    h('strong', { class: 'wtile-v' }, `${plural(f.lapses, 'lapse', 'lapses')} (${plural(f.words, 'word', 'words')})`),
    h('span', { class: 'muted wtile-c' }, 'An "Again" on a card you had remembered.'));
  const top = f.top.filter((t) => byId.has(t.wordId));
  const topList = top.length
    ? h('div', {}, h('h3', {}, 'Most forgotten'),
      h('ul', { class: 'plain' }, top.map((t) => h('li', {}, no(byId.get(t.wordId).lemma), ` · ${plural(t.count, 'time', 'times')}`))),
      h('a', { href: '#/explore' }, 'Open the Words page'))
    : null;
  const forg = panel('Forgotten words', 'How many times you pressed "Again" on a card you had remembered, per week (last 8 weeks).', {
    empty: reviews.length ? null : 'Review some cards and this chart fills in.',
    label: 'Forgotten words per week',
    extra: h('div', { class: 'wtiles' }, tile),
    make: (canvas) => barChart(canvas, f.weekly.map((w) => `from ${niceDay(w.label)}`), [{ label: 'Lapses', data: f.weekly.map((w) => w.lapses), backgroundColor: token('--review', '#8a5200') }]),
    table: tbl('Lapses per week', ['Week starting', 'Lapses'], f.weekly.map((w) => [niceDay(w.label), n(w.lapses)])),
  });
  if (!anyLapse && reviews.length) forg.insertBefore(h('p', { class: 'muted', role: 'status' }, 'No lapses in the last 8 weeks.'), forg.querySelector('.wtiles').nextSibling);
  if (topList) forg.append(topList);

  // (f) word strength cloud: size = how often a word was studied or reappeared, colour = how strong your knowledge is
  const cloud = h('div', { class: 'card' },
    h('h2', {}, '☁️ Word strength cloud'),
    h('p', { class: 'muted' }, 'Bigger words are the ones you studied or met most often (reviews plus times a word reappeared as unknown). The colour shows how strong your knowledge of each word is.'),
    wordCloud(cloudItems(words, { cards, reviews, known, unknown }), { empty: 'Review some cards or take the vocabulary test and your cloud grows here.' }));

  return h('div', { class: 'rstats' }, recCard, byCat, byLevel, cloud, over, forg);
}
