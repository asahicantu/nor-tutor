import { h, no } from '../dom.js';
import { LEVELS, levelOf, summarize } from '../levels.js';
import { learnedNow, progressSeries, forgotten, breakdown, categoryOf, recommend } from '../progress.js';
import { barChart, lineChart, doughnutChart, token, accent } from '../charts.js';
import { cloudItems, strengthCounts, STRENGTHS } from '../strength.js';
import { wordCloud } from './wordcloud.js';
import { collapsible, expandControls } from './collapse.js';

const n = (x) => x.toLocaleString('en');
const LABELS = ['Learned', 'Learning', 'Not started'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (iso) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const plural = (c, one, many) => `${n(c)} ${c === 1 ? one : many}`;

// The "Review" page statistics: expandable cards (recommendations open, the rest collapsed), each chart with a "Show numbers" table.
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

  // One expandable chart card: one-line explanation, chart area (or empty message) and a numbers table. The chart is made
  // on first open (Chart.js cannot size a canvas inside a closed <details>); `after` goes below the numbers.
  function panel(meta, what, { empty, label, height, make, table, extra, after }) {
    const canvas = h('canvas', { role: 'img', 'aria-label': label });
    const kids = [h('p', { class: 'muted' }, what)];
    let onFirstOpen = null;
    if (empty) kids.push(h('p', { class: 'muted', role: 'status' }, empty));
    else {
      if (extra) kids.push(extra);
      if (noChart) kids.push(h('p', { class: 'muted', role: 'status' }, 'Charts need Chart.js from the internet, which could not be loaded.'));
      else {
        kids.push(h('div', { class: 'chart', style: height ? `height:${height}px` : false }, canvas));
        onFirstOpen = () => make(canvas);
      }
      kids.push(h('details', { class: 'wnums' }, h('summary', {}, 'Show numbers'), table));
    }
    if (after) kids.push(after);
    return collapsible({ ...meta, onFirstOpen }, kids);
  }

  const tbl = (caption, head, rows) => h('div', { class: 'tscroll' }, h('table', {},
    h('caption', {}, caption),
    h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map(([first, ...rest]) => h('tr', {}, h('th', { scope: 'row' }, first), rest.map((c) => h('td', {}, c)))))));

  // Stacked horizontal bars: learned / learning / not started per row of a breakdown().
  function stacked(meta, what, rows, noun, caption) {
    const title = meta.title;
    const c = [token('--known', '#0d6868'), token('--review', '#8a5200'), token('--muted', '#55536b')];
    const data = [(r) => r.learned, (r) => r.learning, (r) => r.notStarted];
    return panel(meta, what, {
      label: `${title}: learned, learning and not started words per ${noun}`,
      height: rows.length * 30 + 70,
      make: (canvas) => barChart(canvas, rows.map((r) => r.key), LABELS.map((label, i) => ({ label, data: rows.map(data[i]), backgroundColor: c[i], borderColor: token('--card', '#fff'), borderWidth: 1 })), { horizontal: true, stacked: true }),
      table: tbl(caption, [noun[0].toUpperCase() + noun.slice(1), ...LABELS, 'Total'], rows.map((r) => [r.key, n(r.learned), n(r.learning), n(r.notStarted), n(r.total)])),
    });
  }

  // (a) recommendations
  const recs = recommend({ words, cards, reviews, known, unknown, now, offset });
  const recCard = collapsible({ emoji: '💡', title: 'Recommendations', color: 'sounds', open: true, hint: recs.length ? plural(recs.length, 'suggestion', 'suggestions') : 'You are on track' },
    recs.length
      ? h('ul', { class: 'plain recs' }, recs.map((r) => h('li', {}, h('a', { href: r.href }, r.text))))
      : h('p', {}, 'You are on track. Nothing urgent right now.'));

  // (a2) deck strength: how many of the words you have met are weak / learning / solid / strong
  const sc = strengthCounts(words, { cards, reviews, known, unknown });
  const scolors = [token('--bad', '#b3261e'), token('--review', '#8a5200'), token('--def', '#1a56a0'), token('--known', '#0d6868')];
  const spct = sc.total ? Math.round(((sc.solid + sc.strong) / sc.total) * 100) : 0;
  const strengthCard = panel({ emoji: '💪', title: 'Deck strength', color: 'verbs', hint: sc.total ? `${n(sc.strong)} strong · ${n(sc.weak)} weak` : 'Nothing yet' },
    'How firmly you know the words you have met: weak (new or just missed), learning, solid (remembered for 6+ days) and strong (known, or remembered for 3+ weeks).', {
      empty: sc.total ? null : 'Review some cards or take the vocabulary test and your strength chart appears here.',
      label: 'Words by strength: weak, learning, solid, strong',
      extra: h('div', {},
        h('p', {}, h('strong', {}, `${spct}% of the words you have met are solid or strong.`)),
        h('ul', { class: 'plain wc-legend', 'aria-label': 'Legend' }, STRENGTHS.map((s) => h('li', {}, h('span', { class: `wc-key wc-${s.id}`, 'aria-hidden': 'true' }), `${s.label}: ${n(sc[s.id])}`)))),
      height: 240,
      make: (canvas) => {
        const chart = doughnutChart(canvas, STRENGTHS.map((s) => s.label), STRENGTHS.map((s) => sc[s.id]), scolors);
        chart.options.plugins.legend.display = false; // the text legend above already names and counts each slice
        chart.update();
        return chart;
      },
      table: tbl('Words by strength', ['Strength', 'Words'], [...STRENGTHS.map((s) => [s.label, n(sc[s.id])]), ['Total met', n(sc.total)]]),
    });

  // (b) + (c) learned by category / complexity
  const cats = breakdown(words, status, categoryOf);
  const learnedTotal = cats.reduce((t, r) => t + r.learned, 0);
  const topCat = cats.reduce((best, r) => (!best || r.learned > best.learned ? r : best), null);
  const byCat = stacked({ emoji: '🏷️', title: 'Learned by category', color: 'words', hint: learnedTotal ? `${n(learnedTotal)} of ${n(words.length)} words learned · most in ${topCat.key}` : 'Nothing learned yet' },
    'How many words of each part of speech you have learned (known, or remembered for 3+ weeks), are learning, or have not started.', cats, 'category', 'Learned by category');
  const lvls = breakdown(words, status, (w) => levelOf(w).level, LEVELS);
  const estLevel = summarize(words, status).estimatedLevel;
  const byLevel = stacked({ emoji: '🎓', title: 'Learned by complexity', color: 'sentences', hint: estLevel ? `Estimated level ≈${estLevel}` : 'No level reached yet' },
    'The same split for each CEFR level, from A1 (easiest) to C2.', lvls, 'level', 'Learned by complexity');

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
  const lastPt = series[series.length - 1];
  const over = panel({ emoji: '📈', title: 'Your progress over time', color: 'usage', hint: lastPt ? `${current ? `Level ${current} · ` : ''}${plural(lastPt.learned, 'word', 'words')} learned` : 'Nothing yet' },
    'Words you had learned at the end of each day.', {
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
  const forg = panel({ emoji: '🧠', title: 'Forgotten words', color: 'fuchsia', hint: reviews.length ? `${plural(f.lapses, 'lapse', 'lapses')} in 30 days (${plural(f.words, 'word', 'words')})` : 'Nothing yet' },
    'How many times you pressed "Again" on a card you had remembered, per week (last 8 weeks).', {
    empty: reviews.length ? null : 'Review some cards and this chart fills in.',
    label: 'Forgotten words per week',
    extra: h('div', {}, h('div', { class: 'wtiles' }, tile), !anyLapse && reviews.length ? h('p', { class: 'muted', role: 'status' }, 'No lapses in the last 8 weeks.') : null),
    make: (canvas) => barChart(canvas, f.weekly.map((w) => `from ${niceDay(w.label)}`), [{ label: 'Lapses', data: f.weekly.map((w) => w.lapses), backgroundColor: token('--review', '#8a5200') }]),
    table: tbl('Lapses per week', ['Week starting', 'Lapses'], f.weekly.map((w) => [niceDay(w.label), n(w.lapses)])),
    after: topList,
  });

  // (f) word strength cloud: size = how often a word was studied or reappeared, colour = how strong your knowledge is
  const met = cloudItems(words, { cards, reviews, known, unknown }, { limit: Infinity });
  const cloud = collapsible({ emoji: '☁️', title: 'Word strength cloud', color: 'places', hint: met.length ? `${plural(met.length, 'word', 'words')} met` : 'Nothing yet' },
    h('p', { class: 'muted' }, 'Bigger words are the ones you studied or met most often (reviews plus times a word reappeared as unknown). The colour shows how strong your knowledge of each word is.'),
    wordCloud(met.slice(0, 60), { empty: 'Review some cards or take the vocabulary test and your cloud grows here.' }));

  const root = h('div', { class: 'rstats' }, expandControls(() => root), recCard, strengthCard, byCat, byLevel, cloud, over, forg);
  return root;
}
