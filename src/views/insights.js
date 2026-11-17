// Extra cards for the Home "Progress" tab: text coverage, study calendar, review forecast, accuracy by word type, skills
// and common mistakes. Plain HTML/CSS bars (no Chart.js), so they also work offline. Numbers come from stats.js and practice.js.
import { h } from '../dom.js';
import { textCoverage, activityByDay, dueForecast } from '../stats.js';
import { learnedNow } from '../progress.js';
import { skillBreakdown, mistakeCounts, accuracyByType } from '../practice.js';
import { collapsible } from './collapse.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (iso) => new Date(`${iso}T00:00:00Z`);
const niceDay = (iso) => { const d = dateOf(iso); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const pct = (x) => `${Math.round(x * 100)}%`;
const n = (x) => x.toLocaleString('en');
const link = (href, label) => h('a', { class: 'btn', href }, label);
const TIPS = {
  letters: 'Use the æ ø å buttons under each answer box, or learn the keyboard shortcuts for them.',
  typo: 'Slow down a little and read your answer once before checking.',
  form: 'Revise verb tenses and noun endings on the Grammar page, and try the Verb forms drill.',
  gender: 'Learn each noun together with en / ei / et, and try the Noun gender drill.',
  word: 'Listen to whole sentences again and try Dictation: it trains word order and small words.',
};

// Horizontal bars: each row shows its name, a bar (value 0..1, decoration) and the number as text.
const bars = (label, rows) => h('ul', { class: 'hbars', 'aria-label': label }, rows.map(({ name, value, text }) =>
  h('li', {}, h('span', { class: 'hb-l' }, name),
    h('span', { class: 'hb-t', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` })),
    h('span', { class: 'hb-v' }, text))));

const empty = (text, href, label) => h('div', { class: 'empty' }, h('p', {}, text), href ? link(href, label) : null);

export function insightCards({ words, state, now, offset }) {
  const { cards, reviews, tests, known, practice } = state;

  // A. text coverage
  const learned = learnedNow({ cards, known });
  const cover = textCoverage(words, learned);
  const coverage = collapsible({ emoji: '📖', title: 'How much of a text you understand', color: 'words', open: true, hint: `≈${pct(cover)} of running text` },
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Estimated share of a typical text you understand', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(cover * 100)) },
      h('span', { style: `width:${pct(cover)}` })),
    h('p', {}, `You would recognise about ${pct(cover)} of the words in a typical Norwegian text.`),
    h('p', { class: 'muted' }, `Common words make up most of any text, so each word counts by how often it is used: knowing “og” helps far more than a rare word. Based on the ${n(learned.size)} words you have learned (marked known, or remembered in reviews for 3 weeks). An estimate: real texts vary.`));

  // B. study calendar
  const days = activityByDay([...reviews, ...tests, ...practice].map((r) => r.timestamp), now, offset, 26 * 7);
  const active = days.filter((d) => d.n > 0);
  const max = Math.max(1, ...days.map((d) => d.n));
  const best = active.reduce((a, d) => (d.n > (a?.n ?? 0) ? d : a), null);
  const pad = (dateOf(days[0].day).getUTCDay() + 6) % 7; // weeks start on Monday
  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
  const calendar = collapsible({ emoji: '🗓️', title: 'Study calendar', color: 'sentences', open: true, hint: `${active.length} of the last ${days.length} days` },
    h('p', { class: 'muted' }, 'Each square is a day, each column a week (Monday at the top). Darker means more reviews, tests and practice answers.'),
    h('div', { class: 'heatwrap' },
      h('div', { class: 'heat', role: 'img', 'aria-label': `Studied on ${active.length} of the last ${days.length} days${best ? `, most on ${niceDay(best.day)} (${best.n})` : ''}.` },
        Array.from({ length: pad }, () => h('span', { class: 'hc pad' })),
        days.map((d) => h('span', { class: `hc l${level(d.n)}`, title: `${niceDay(d.day)}: ${d.n}` })))),
    h('p', { class: 'heatkey muted', 'aria-hidden': 'true' }, 'Less ', [0, 1, 2, 3, 4].map((l) => h('span', { class: `hc l${l}` })), ' More'),
    h('p', {}, active.length ? `You studied on ${active.length} days${best ? `; your busiest day was ${niceDay(best.day)} with ${best.n}` : ''}.` : 'Nothing yet: study a little and your days will fill in.'));

  // C. review forecast
  const forecast = dueForecast(cards, now, offset, 30);
  const week = forecast.slice(0, 7);
  const weekMax = Math.max(1, ...week.map((d) => d.n));
  const month = forecast.reduce((s, d) => s + d.n, 0);
  const busy = week.reduce((a, d) => (d.n > a.n ? d : a), week[0]);
  const ahead = collapsible({ emoji: '📅', title: 'Reviews coming up', color: 'usage', open: true, hint: cards.length ? `${n(week.reduce((s, d) => s + d.n, 0))} in the next 7 days` : 'No cards yet' },
    cards.length
      ? [h('p', { class: 'muted' }, 'Cards that come due each day (cards already due count for today). Plan a longer session for the busy days.'),
        bars('Cards due per day, next 7 days', week.map((d, i) => ({ name: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : niceDay(d.day), value: d.n / weekMax, text: n(d.n) }))),
        h('p', {}, `${n(month)} reviews in the next 30 days.${busy.n ? ` Busiest this week: ${busy === week[0] ? 'today' : niceDay(busy.day)} (${busy.n}).` : ''}`)]
      : empty('Add words to your review deck and their schedule shows here.', '#/explore', 'Browse words'));

  // D. accuracy by word type
  const types = accuracyByType(words, reviews, practice);
  const byType = collapsible({ emoji: '🏷️', title: 'Accuracy by word type', color: 'verbs', open: true, hint: types.length ? `weakest: ${[...types].sort((a, b) => a.accuracy - b.accuracy)[0].key}` : 'Nothing yet' },
    types.length
      ? [h('p', { class: 'muted' }, 'Share of review and practice answers you got right, by type of word. The lowest bar is the one to drill.'),
        bars('Accuracy by word type', types.map((t) => ({ name: t.key, value: t.accuracy, text: `${pct(t.accuracy)} of ${n(t.total)}` })))]
      : empty('Review some cards or practise words to see this.', '#/practice', 'Open Practice'));

  // E. skills
  const skills = skillBreakdown(practice, reviews);
  const tried = skills.filter((s) => s.total > 0);
  const skillCard = collapsible({ emoji: '🎯', title: 'Your skills', color: 'sounds', open: true, hint: tried.length ? `${tried.length} of ${skills.length} skills practised` : 'Nothing yet' },
    h('p', { class: 'muted' }, 'Share right per skill. Reading counts review cards and “Understand” in Phrases; listening, writing and grammar come from the drills.'),
    bars('Accuracy per skill', skills.map((s) => ({ name: s.label, value: s.accuracy ?? 0, text: s.total ? `${pct(s.accuracy)} of ${n(s.total)}` : 'not tried' }))),
    skills.some((s) => s.total === 0) ? link('#/practice', 'Try the skills you have not practised') : null);

  // F. common mistakes
  const slips = mistakeCounts(practice);
  const slipMax = Math.max(1, ...slips.map((s) => s.n));
  const mistakes = collapsible({ emoji: '🔍', title: 'Your most common mistakes', color: 'fuchsia', open: true, hint: slips.length ? slips[0].label : 'Nothing yet' },
    slips.length
      ? [h('p', { class: 'muted' }, 'Slips found in what you typed or picked in drills and in Phrases, counted once per answer.'),
        bars('Mistakes by kind', slips.map((s) => ({ name: s.label, value: s.n / slipMax, text: n(s.n) }))),
        h('p', {}, h('strong', {}, 'Tip: '), TIPS[slips[0].kind])]
      : empty('Practise writing or grammar and your typical slips show up here.', '#/practice', 'Open Practice'));

  return [coverage, calendar, ahead, byType, skillCard, mistakes];
}
