import { h, no } from '../dom.js';
import { loadState } from '../db.js';
import { vocabSeries, dailyAccuracy } from '../stats.js';
import { dueCards } from '../srs.js';
import { buildStatus, mostMissed } from '../wordstatus.js';
import { lineChart, barChart, accent, softAccent } from '../charts.js';
import { xpTotal, levelInfo, streak, dailyQuest, badges } from '../gamify.js';
import { ring, xpBar, badgeTile, claimBadges, toast, tzOffset } from '../gamui.js';

const fmt = (n) => Math.round(n).toLocaleString('en');
const link = (href, label, cls = 'btn primary') => h('a', { class: cls, href }, label);
const tile = (label, value, caption) =>
  h('div', { class: 'card tile' }, h('div', { class: 'num' }, value), h('div', {}, label), h('div', { class: 'label' }, caption));

const STEPS = [
  ['#/test', '1', 'Find your level', 'Take a 2-minute vocabulary test. Words you miss are saved so you can learn them.'],
  ['#/explore', '2', 'Browse words', 'Mark words you know, or send new ones to your review deck.'],
  ['#/phrases', '3', 'Read sentences', 'Practise whole sentences. Tap a word to see what it means.'],
  ['#/grammar', '4', 'Check the grammar', 'Tables and examples for nouns, verbs, word order and more.'],
];

export async function render(root, { words, phrases, db }) {
  const state = await loadState(db);
  const { cards, reviews, tests, known, unknown, phrases: phraseRows } = state;
  const status = buildStatus(state);
  const now = Date.now();
  const offset = tzOffset();
  const latest = [...tests].sort((a, b) => b.timestamp - a.timestamp)[0];
  const byId = new Map(words.map((w) => [w.id, w]));
  const due = dueCards(cards, now).length;
  const learning = [...status.missed.keys()].filter((id) => !status.known.has(id)).length;
  const fresh = known.length + cards.length + reviews.length + tests.length + unknown.length + phraseRows.length === 0;

  if (fresh) {
    root.replaceChildren(
      h('h1', {}, 'Welcome to Norsk Tutor'),
      h('section', { class: 'card hero' },
        h('h2', {}, 'Learn Norwegian words, sentences and grammar'),
        h('p', {}, `Your progress charts are empty because you have not studied yet. Start with the test: it takes about 2 minutes and fills this page with your first numbers.`),
        link('#/test', 'Take the vocabulary test')),
      h('h2', {}, 'Where to start'),
      h('div', { class: 'steps-grid' }, STEPS.map(([href, n, title, text]) =>
        h('a', { class: 'card step', href }, h('span', { class: 'step-mark', 'aria-hidden': 'true' }, n), h('strong', {}, title), h('span', { class: 'muted' }, text)))),
      h('p', { class: 'muted' }, `${words.length} words and ${phrases.length} sentences are ready for you. Everything you do is saved on this computer.`),
    );
    return;
  }

  const hero = !latest && known.length === 0
    ? { title: 'Find out where you stand', text: 'Take the vocabulary test to get a starting point.', label: 'Take the vocabulary test', href: '#/test' }
    : due > 0
      ? { title: `${due} ${due === 1 ? 'card is' : 'cards are'} ready to review`, text: 'A few minutes now keeps these words from fading.', label: `Review ${due} ${due === 1 ? 'card' : 'cards'}`, href: '#/review' }
      : learning > cards.filter((c) => status.missed.has(c.wordId)).length
        ? { title: 'You have words you missed', text: 'Add them to your review deck so they come back at the right time.', label: 'Open the missed words', href: '#/explore' }
        : { title: 'You are all caught up', text: 'Practise a few sentences or look for new words.', label: 'Practise sentences', href: '#/phrases' };

  const missed = mostMissed(status, 6).filter((r) => byId.has(r.wordId));
  const pct = Math.round((known.length / words.length) * 100);
  const quest = dailyQuest(state, now, offset);
  const level = levelInfo(xpTotal(state));
  const awarded = new Set(state.awards.map((a) => a.awardId));
  const all = badges(state, now, offset).map((b) => ({ ...b, earned: b.earned || awarded.has(b.id) }));
  const nextBadge = all.filter((b) => !b.earned).sort((a, b) => b.value / b.target - a.value / a.target)[0];

  const series = vocabSeries(tests);
  const days = dailyAccuracy(reviews, offset);
  const canvases = [h('canvas', { role: 'img', 'aria-label': 'Estimated vocabulary after each test' }), h('canvas', { role: 'img', 'aria-label': 'Share remembered per day' })];
  const chartCard = (title, explain, empty, cta, ready, canvas) =>
    h('section', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, explain),
      typeof Chart === 'undefined' ? h('p', { class: 'muted' }, 'Charts need Chart.js from the internet, which could not be loaded.')
        : ready ? h('div', { class: 'chart' }, canvas) : h('div', { class: 'empty' }, h('p', {}, empty), link(cta[0], cta[1], 'btn primary')));

  const today = h('div', { role: 'tabpanel', id: 'panel-0', 'aria-labelledby': 'tab-0' },
    h('section', { class: 'card hero' },
      h('div', { class: 'hero-main' },
        h('div', {}, h('h2', {}, hero.title), h('p', {}, hero.text), link(hero.href, hero.label)),
        h('div', { class: 'ringwrap' }, ring(quest.pct, "Today's quest"),
          h('div', { class: 'ringtext' }, h('strong', {}, `${quest.done}/${quest.goal}`), h('small', {}, quest.complete ? 'Quest done!' : 'reviews today'))))),
    h('section', { class: 'card' }, xpBar(level)),
    h('div', { class: 'tiles' },
      tile('Words you know', String(known.length), `of ${words.length} in the list`),
      tile('Still learning', String(learning), 'Words you missed'),
      tile('In review deck', String(cards.length), `${due} due now`),
      tile('Day streak', String(streak(state, now, offset)), 'Days in a row you studied')),
    nextBadge ? h('section', { class: 'card' }, h('h3', {}, 'Next badge'), badgeTile(nextBadge)) : null,
    h('details', {}, h('summary', {}, `All badges (${all.filter((b) => b.earned).length} of ${all.length} earned)`), h('div', { class: 'badges' }, all.map(badgeTile))),
    missed.length
      ? h('section', { class: 'card' },
          h('h3', {}, 'Words you miss most'),
          h('ul', { class: 'plain missed' }, missed.map((r) => {
            const w = byId.get(r.wordId);
            return h('li', {}, no(w.lemma, 'strong'), ' ', h('span', { class: 'trans' }, w.gloss_en), h('span', { class: 'badge' }, `${r.count}×`));
          })),
          link('#/explore', 'Work on these words', 'btn'))
      : null);

  const progress = h('div', { role: 'tabpanel', id: 'panel-1', 'aria-labelledby': 'tab-1', hidden: true },
    h('section', { class: 'card' },
      h('h3', {}, 'Vocabulary coverage'),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: `width:${pct}%` })),
      h('p', { class: 'muted' }, `${pct}% of the word list marked as known.` + (latest ? ` Your last test estimated about ${fmt(latest.estimate)} of ${fmt(latest.listSize ?? words.length)}.` : ''))),
    chartCard('How many words you know', 'Your test estimate after each test. Dashed lines show the likely range. Based on your own answers, so it can run high if you over-claim.', 'Take the test more than once to see how you improve.', ['#/test', 'Take the test'], series.length > 0, canvases[0]),
    chartCard('Answers you remembered each day', 'The share of review answers that were not "Again". Higher means the words are sticking.', 'Do a review session and your results will appear here.', ['#/review', 'Start a review'], days.length > 0, canvases[1]),
    h('details', {}, h('summary', {}, 'What do these numbers mean?'),
      h('p', {}, 'The estimate is how many words of the list you likely know, with a range because a test samples only some words. "Remembered" is the share of review answers that were not "Again". XP and levels only count real study: reviews, tests, words marked known, cards added and sentences you got right.')));

  const panels = [today, progress];
  let drawn = false;
  const tabs = ['Today', 'Progress'].map((label, i) =>
    h('button', { class: 'tab', role: 'tab', id: `tab-${i}`, 'aria-selected': String(i === 0), 'aria-controls': `panel-${i}`, onclick: () => select(i) }, label));
  function select(i) {
    tabs.forEach((t, n) => t.setAttribute('aria-selected', String(n === i)));
    panels.forEach((p, n) => (p.hidden = n !== i));
    if (i === 1 && !drawn) {
      drawn = true; // Chart.js sizes badly inside a hidden panel, so draw on first show
      drawCharts();
    }
  }

  root.replaceChildren(h('h1', {}, 'Your dashboard'), h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Dashboard sections' }, tabs), today, progress);

  function drawCharts() {
    if (typeof Chart === 'undefined') return;
    const main = accent();
    if (series.length) {
      const faint = { borderColor: softAccent(), borderDash: [5, 4], pointRadius: series.length === 1 ? 3 : 0 };
      lineChart(canvases[0], series.map((s) => new Date(s.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })), [
        { label: 'Estimate', data: series.map((s) => s.estimate), borderColor: main, backgroundColor: main, pointRadius: 4 },
        { label: 'Upper range', data: series.map((s) => s.ciHigh), ...faint },
        { label: 'Lower range', data: series.map((s) => s.ciLow), ...faint },
      ]);
    }
    if (days.length) {
      barChart(canvases[1], days.map((d) => d.day), [{ label: 'Remembered (%)', data: days.map((d) => Math.round(d.accuracy * 100)), backgroundColor: main }], { max: 100 });
    }
  }

  claimBadges(db, state, now, offset).then((got) => got.forEach((b) => toast(`Badge earned: ${b.title}`))).catch(() => {});
}
