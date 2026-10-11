import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { getAll, put, add } from '../db.js';
import { dueCards, review, GRADES } from '../srs.js';
import { dailyAccuracy, trend } from '../stats.js';
import { mixedChart, accent } from '../charts.js';
import { meaning } from './wordui.js';
import { reviewXp } from '../gamify.js';
import { confetti, reward } from '../gamui.js';
import { renderReviewStats } from './reviewstats.js';

const MAX_CARD_MS = 5 * 60 * 1000; // a card left open longer than this counts as 5 minutes
const COUNTS = [[5, '5'], [10, '10'], [20, '20'], [0, 'All due']];
const GRADE_HELP = { again: "Didn't remember", hard: 'Barely', good: 'Remembered', easy: 'Too easy' };
const pct = (x) => `${Math.round(x * 100)}%`;

export async function render(root, { words, db }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const [cards, reviews, known, unknown] = await Promise.all([getAll(db, 'cards'), getAll(db, 'reviews'), getAll(db, 'known'), getAll(db, 'unknown')]);
  const deck = cards.filter((c) => byId.has(c.wordId));
  let count = pref('reviewCount', 10);
  let keys = {};
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));
  const page = (...kids) => root.replaceChildren(h('h1', {}, 'Review'), ...kids.filter(Boolean));

  function setup() {
    keys = {};
    const due = dueCards(deck, Date.now());
    const pick = (n, pool) => (n === 0 ? pool : pool.slice(0, n));
    const startBtn = (label, pool, primary) =>
      h('button', { class: primary ? 'primary' : '', disabled: pool.length === 0, onclick: () => session(pick(count, pool)) }, label);
    const plan = h('p', { class: 'muted', role: 'status' });
    const upd = () => { plan.textContent = due.length ? `${due.length} due now. This session: ${Math.min(count || due.length, due.length)} card(s).` : 'Nothing is due right now.'; };
    upd();

    let body;
    if (deck.length === 0) {
      body = h('div', { class: 'card empty' },
        h('h2', {}, 'Your review deck is empty'),
        h('p', {}, 'Add words you want to practise: from the Words page ("Review it") or from words you miss in the vocabulary test.'),
        h('a', { class: 'btn primary', href: '#/explore' }, 'Choose words'));
    } else {
      const byDue = [...deck].sort((a, b) => a.due - b.due);
      body = h('div', { class: 'card' },
        h('h2', {}, due.length ? `${due.length} ${due.length === 1 ? 'card is' : 'cards are'} ready` : 'You are all caught up'),
        h('p', {}, 'How many cards do you want to study now?'),
        segmented('Number of cards', COUNTS, count, (n) => { count = n; setPref('reviewCount', n); upd(); }),
        plan,
        h('div', { class: 'row' },
          startBtn('Start review', due, true),
          due.length === 0 ? startBtn('Practise anyway', byDue, false) : null));
    }
    page(body, improvement(), renderReviewStats({ words, cards, reviews, known, unknown, now: Date.now() }));
  }

  function improvement() {
    const box = h('div', { class: 'card' }, h('h2', {}, 'Your improvement'));
    if (reviews.length === 0) {
      box.append(h('p', { class: 'muted' }, 'After your first review session a chart appears here: how many cards you studied each day and how many you remembered.'));
      return box;
    }
    const t = trend(reviews, Date.now());
    const mature = deck.filter((c) => c.interval >= 21).length;
    let line = `${reviews.length} reviews so far. ${mature} card(s) are solid (you will see them only every 3+ weeks).`;
    if (t.current && t.previous) {
      const d = Math.round((t.current.accuracy - t.previous.accuracy) * 100);
      line = `Last 7 days: ${pct(t.current.accuracy)} remembered (${d === 0 ? 'same as' : `${d > 0 ? '+' : ''}${d} points vs`} the week before). ${line}`;
    } else if (t.current) {
      line = `Last 7 days: ${pct(t.current.accuracy)} remembered. ${line}`;
    }
    box.append(h('p', {}, line));
    if (typeof Chart === 'undefined') {
      box.append(h('p', { class: 'muted' }, 'The chart needs Chart.js from the internet, which could not be loaded.'));
      return box;
    }
    const canvas = h('canvas', { role: 'img', 'aria-label': 'Reviews and share remembered per day' });
    box.append(h('div', { class: 'chart' }, canvas));
    queueMicrotask(() => {
      if (!canvas.isConnected) return;
      const days = dailyAccuracy(reviews, -new Date().getTimezoneOffset() * 60000);
      mixedChart(canvas, days.map((d) => d.day.slice(5)),
        { label: 'Cards reviewed', data: days.map((d) => d.reviews), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#ccc' },
        { label: 'Remembered (%)', data: days.map((d) => Math.round(d.accuracy * 100)), borderColor: accent(), backgroundColor: accent(), tension: 0.25 });
    });
    return box;
  }

  function session(queue) {
    const total = queue.length;
    const tally = { again: 0, hard: 0, good: 0, easy: 0 };
    let i = 0;

    function done() {
      keys = {};
      const gain = reviewXp(tally);
      const extra = h('div', { role: 'status' });
      page(h('div', { class: 'card hero celebrate' },
        confetti(),
        h('h2', {}, `Done: ${total} ${total === 1 ? 'card' : 'cards'} reviewed`),
        h('p', {}, `${tally.good + tally.easy + tally.hard} remembered, ${tally.again} to see again soon. `, h('strong', {}, `+${gain} XP`)),
        extra,
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => render(root, { words, db }) }, 'Back to Review'),
          h('a', { class: 'btn', href: '#/dashboard' }, 'Dashboard'))));
      reward(db, gain, extra).catch(() => {}); // the summary above is already complete; the extras are a bonus
    }

    function show() {
      if (i >= total) return done();
      const card = queue[i];
      const word = byId.get(card.wordId);
      const startedAt = Date.now();
      const errorBox = h('div');
      let graded = false; // set synchronously: blocks double activation
      let recorded = false;

      const gradeBtns = Object.keys(GRADES).map((g, n) =>
        h('button', { class: `grade ${g}`, onclick: () => grade(g) }, h('strong', {}, g[0].toUpperCase() + g.slice(1)), h('small', {}, `${GRADE_HELP[g]} · ${n + 1}`)));
      const revealed = h('div', { hidden: true }, meaning(word), h('div', { class: 'row grades' }, gradeBtns));
      const showBtn = h('button', { class: 'primary', onclick: reveal }, 'Show answer (Space)');
      function reveal() {
        revealed.hidden = false;
        showBtn.hidden = true;
        keys = Object.fromEntries(Object.keys(GRADES).map((g, n) => [String(n + 1), () => grade(g)]));
      }
      keys = { ' ': reveal, enter: reveal };

      async function grade(g) {
        if (graded) return;
        graded = true;
        const now = Date.now();
        try {
          if (!recorded) {
            await add(db, 'reviews', { wordId: card.wordId, timestamp: now, grade: g, ms: Math.min(now - startedAt, MAX_CARD_MS), prevInterval: card.interval });
            recorded = true;
          }
          await put(db, 'cards', review(card, g, now));
        } catch (e) {
          graded = false;
          errorBox.replaceChildren(h('p', { class: 'error' }, `Could not save this review (${e.message}). Please try again.`));
          return;
        }
        tally[g]++;
        i++;
        show();
      }

      page(
        h('p', { class: 'muted' }, `Card ${i + 1} of ${total}`),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(i) }, h('span', { style: `width:${(i / total) * 100}%` })),
        h('div', { class: 'card testcard' },
          no(word.lemma, 'div', 'big'),
          h('p', { class: 'center' }, h('span', { class: 'chip' }, word.pos)),
          h('div', { class: 'row center' }, showBtn), revealed),
        errorBox,
        h('p', { class: 'muted' }, h('button', { class: 'quiet', onclick: () => render(root, { words, db }) }, '← Stop and go back')),
      );
    }
    show();
  }

  setup();
}
