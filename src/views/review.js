import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { getAll, put, add } from '../db.js';
import { dueCards, review, GRADES } from '../srs.js';
import { dailyAccuracy, trend } from '../stats.js';
import { mixedChart, doughnutChart, barChart, accent, token } from '../charts.js';
import { levelOf, complexityOf } from '../levels.js';
import { reviewSessionStats } from '../session.js';
import { cloudItems } from '../strength.js';
import { speak } from '../speech.js';
import { meaning, contextPanel } from './wordui.js';
import { speakButton, slowSwitch, audioNotice, isSlow } from './speakui.js';
import { collapsible } from './collapse.js';
import { wordCloud } from './wordcloud.js';
import { reviewXp } from '../gamify.js';
import { confetti, reward } from '../gamui.js';
import { renderReviewStats } from './reviewstats.js';

const MAX_CARD_MS = 5 * 60 * 1000; // a card left open longer than this counts as 5 minutes
const COUNTS = [[5, '5'], [10, '10'], [20, '20'], [0, 'All due']];
const GRADE_HELP = { again: "Didn't remember", hard: 'Barely', good: 'Remembered', easy: 'Too easy' };
const GRADE_ICON = { again: '❌', hard: '😬', good: '✅', easy: '🚀' };
const pct = (x) => `${Math.round(x * 100)}%`;
const fmt = (n) => n.toLocaleString('en');
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const ic = (e) => h('span', { class: 'ic', 'aria-hidden': 'true' }, e); // decorative emoji
const withIc = (e, text) => [ic(e), h('span', {}, text)];
const heading = (tag, e, text) => h(tag, {}, ic(e), ' ', text);
const noChart = () => typeof Chart === 'undefined';
const chartNotice = () => h('p', { class: 'muted', role: 'status' }, 'Charts need Chart.js from the internet, which could not be loaded. The numbers below show the same information.');
const tile = (label, value, cap) => h('div', { class: 'wtile' }, h('span', { class: 'wtile-l' }, label), h('strong', { class: 'wtile-v' }, value), cap ? h('span', { class: 'muted wtile-c' }, cap) : null);
const colors3 = () => [token('--known', '#0d6868'), token('--review', '#8a5200'), token('--line', '#dcdaea')];

// Segmented bar + doughnut for three counts [remembered, again, to go]. update() changes both in place (the chart is created once).
function statPanel(labels, canvasLabel) {
  const segs = ['k', 'u', 'n'].map((c) => h('span', { class: `tseg ${c}` }));
  const text = h('p', { class: 'tcounts' });
  const canvas = h('canvas', { role: 'img', 'aria-label': canvasLabel });
  let donut = null;
  const el = h('div', { class: 'tstat' }, h('div', { class: 'tstat-text' }, h('div', { class: 'tbar', 'aria-hidden': 'true' }, segs), text), noChart() ? null : h('div', { class: 'tdonut' }, canvas));
  function update(parts, content) {
    const total = parts.reduce((a, b) => a + b, 0);
    segs.forEach((s, i) => { s.style.width = `${total ? (parts[i] / total) * 100 : 0}%`; });
    text.textContent = content;
    if (noChart()) return;
    if (donut) { donut.data.datasets[0].data = parts; donut.update(); }
    else if (canvas.isConnected) {
      donut = doughnutChart(canvas, labels, parts, colors3());
      donut.options.plugins = { legend: { display: false } }; // the counts next to it are the legend
      donut.update();
    }
  }
  return { el, update };
}

const sideBtn = (g, onclick) =>
  h('button', { type: 'button', class: `tbtn rg ${g}`, disabled: true, onclick, title: GRADE_HELP[g], 'aria-keyshortcuts': String(Object.keys(GRADES).indexOf(g) + 1) },
    ic(GRADE_ICON[g]), h('strong', {}, g[0].toUpperCase() + g.slice(1)), h('small', {}, h('span', { class: 'rhelp' }, `${GRADE_HELP[g]} · `), String(Object.keys(GRADES).indexOf(g) + 1)));

export async function render(root, { words, db }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const [cards, reviews, known, unknown] = await Promise.all([getAll(db, 'cards'), getAll(db, 'reviews'), getAll(db, 'known'), getAll(db, 'unknown')]);
  const deck = cards.filter((c) => byId.has(c.wordId));
  let count = pref('reviewCount', 10);
  let keys = {};
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));
  const page = (...kids) => root.replaceChildren(heading('h1', '🔁', 'Review'), ...kids.filter(Boolean));

  function setup() {
    keys = {};
    const now = Date.now();
    const due = dueCards(deck, now);
    const pick = (n, pool) => (n === 0 ? pool : pool.slice(0, n));
    const startBtn = (emoji, label, pool, primary) =>
      h('button', { type: 'button', class: primary ? 'primary tstart' : 'tstart', disabled: pool.length === 0, onclick: () => session(pick(count, pool)) }, ...withIc(emoji, label));
    const plan = h('p', { class: 'muted', role: 'status' });
    const upd = () => { plan.textContent = due.length ? `This session: ${Math.min(count || due.length, due.length)} ${Math.min(count || due.length, due.length) === 1 ? 'card' : 'cards'}.` : 'Nothing is due right now. You can still practise your deck.'; };
    upd();

    let body;
    if (deck.length === 0) {
      body = h('div', { class: 'card empty' },
        heading('h2', '📭', 'Your review deck is empty'),
        h('p', {}, 'Add words you want to practise: from the Words page ("Review it") or from words you miss in the vocabulary test.'),
        h('a', { class: 'btn primary', href: '#/explore' }, ...withIc('📚', 'Choose words')));
    } else {
      const byDue = [...deck].sort((a, b) => a.due - b.due);
      const solid = deck.filter((c) => c.interval >= 21).length;
      const autoBox = h('input', { type: 'checkbox' });
      autoBox.checked = pref('reviewAutoplay', false);
      autoBox.addEventListener('change', () => setPref('reviewAutoplay', autoBox.checked));
      body = h('div', { class: 'card rsetup' },
        h('div', { class: 'rdue' },
          h('div', { class: 'rdue-n', 'aria-hidden': 'true' }, String(due.length)),
          h('div', {},
            h('h2', {}, due.length ? `${due.length} ${due.length === 1 ? 'card is' : 'cards are'} due now` : '🎉 You are all caught up'),
            plan)),
        heading('h3', '🔢', 'How many cards?'),
        segmented('Number of cards', COUNTS, count, (n) => { count = n; setPref('reviewCount', n); upd(); }),
        heading('h3', '🔊', 'Listening'),
        h('div', { class: 'row topts' },
          slowSwitch(),
          h('label', { class: 'switch', title: 'Say each word aloud when its card appears' }, autoBox, h('span', { class: 'track', 'aria-hidden': 'true' }), ic('▶️'), 'Auto-play each card')),
        audioNotice(),
        h('div', { class: 'row' },
          startBtn('▶️', 'Start review', due, true),
          due.length === 0 ? startBtn('🔁', 'Practise anyway', byDue, false) : null), // only when nothing is due: early reviews would inflate intervals
        h('div', { class: 'wtiles rtiles' },
          tile('⏰ Due now', fmt(due.length)),
          tile('📚 In your deck', fmt(deck.length)),
          tile('🏆 Solid cards', fmt(solid), 'interval 21 days or more'),
          tile('🔁 Reviews so far', fmt(reviews.length))));
    }
    page(body, improvement(), renderReviewStats({ words, cards, reviews, known, unknown, now }));
  }

  function improvement() {
    const kids = [];
    let onFirstOpen = null;
    if (reviews.length === 0) {
      kids.push(h('p', { class: 'muted' }, 'After your first review session a chart appears here: how many cards you studied each day and how many you remembered.'));
    } else {
      const t = trend(reviews, Date.now());
      const mature = deck.filter((c) => c.interval >= 21).length;
      let line = `${reviews.length} reviews so far. ${mature} card(s) are solid (you will see them only every 3+ weeks).`;
      if (t.current && t.previous) {
        const d = Math.round((t.current.accuracy - t.previous.accuracy) * 100);
        line = `Last 7 days: ${pct(t.current.accuracy)} remembered (${d === 0 ? 'same as' : `${d > 0 ? '+' : ''}${d} points vs`} the week before). ${line}`;
      } else if (t.current) {
        line = `Last 7 days: ${pct(t.current.accuracy)} remembered. ${line}`;
      }
      kids.push(h('p', {}, line));
      if (noChart()) {
        kids.push(h('p', { class: 'muted' }, 'The chart needs Chart.js from the internet, which could not be loaded.'));
      } else {
        const canvas = h('canvas', { role: 'img', 'aria-label': 'Reviews and share remembered per day' });
        kids.push(h('div', { class: 'chart' }, canvas));
        onFirstOpen = () => { // a chart cannot be sized inside a closed card
          const days = dailyAccuracy(reviews, -new Date().getTimezoneOffset() * 60000);
          mixedChart(canvas, days.map((d) => d.day.slice(5)),
            { label: 'Cards reviewed', data: days.map((d) => d.reviews), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#ccc' },
            { label: 'Remembered (%)', data: days.map((d) => Math.round(d.accuracy * 100)), borderColor: accent(), backgroundColor: accent(), tension: 0.25 });
        };
      }
    }
    return collapsible({ emoji: '📈', title: 'Your improvement', color: 'verbs', open: false, onFirstOpen }, ...kids);
  }

  function session(queue) {
    const total = queue.length;
    const tally = { again: 0, hard: 0, good: 0, easy: 0 };
    const graded = []; // [{ grade, ms }] for the results
    const againWords = [];
    const sessionWordIds = queue.map((c) => c.wordId);
    const live = statPanel(['Remembered', 'Again', 'To go'], 'Your answers so far');
    const livePanel = h('div', { class: 'card tlive' }, heading('h2', '📊', 'Your answers so far'), live.el);
    let i = 0;

    const updateLive = () => {
      const again = tally.again;
      const ok = tally.hard + tally.good + tally.easy;
      const rest = total - again - ok;
      live.update([ok, again, rest], `✅ ${ok} remembered · ❌ ${again} again · ⏳ ${rest} to go`);
    };

    async function done() {
      keys = {};
      const gain = reviewXp(tally);
      const ss = reviewSessionStats(graded);
      const extra = h('div', { role: 'status' });
      const donutCanvas = h('canvas', { role: 'img', 'aria-label': 'Remembered versus again in this session' });
      const barCanvas = h('canvas', { role: 'img', 'aria-label': 'Number of cards per grade in this session' });
      const gradeNames = ['Again', 'Hard', 'Good', 'Easy'];
      const gradeCounts = [ss.again, ss.hard, ss.good, ss.easy];
      const sessionCard = h('div', { class: 'card tsession' },
        heading('h2', '🧾', 'Your session'),
        noChart() ? chartNotice() : null,
        h('div', { class: 'tcharts' },
          h('section', {}, heading('h3', '🎯', 'Remembered vs again'), noChart() ? null : h('div', { class: 'tdonut tbig' }, donutCanvas)),
          h('section', {}, heading('h3', '📶', 'How you graded the cards'), noChart() ? null : h('div', { class: 'tbars' }, barCanvas))),
        h('div', { class: 'wtiles' },
          tile('🃏 Cards reviewed', String(ss.total)),
          tile('✅ Remembered', `${ss.pctRemembered}%`, `${ss.remembered} of ${ss.total}`),
          tile('⏱️ Average per card', `${ss.avgSeconds} s`),
          tile('⌛ Total time', mmss(ss.totalSeconds), 'minutes:seconds')),
        h('details', { class: 'wnums' },
          h('summary', {}, 'Show numbers'),
          h('table', {}, h('caption', {}, 'Cards by grade in this session'), h('thead', {}, h('tr', {}, ['Grade', 'Cards'].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', {}, gradeNames.map((n, k) => h('tr', {}, h('th', { scope: 'row' }, n), h('td', {}, String(gradeCounts[k]))))),
            h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'Remembered (hard, good, easy)'), h('td', {}, String(ss.remembered)))))));
      const uniqAgain = [...new Map(againWords.map((w) => [w.id, w])).values()];
      const again = collapsible({ emoji: '🔁', title: 'To see again soon', hint: uniqAgain.length ? `${uniqAgain.length} ${uniqAgain.length === 1 ? 'word' : 'words'}` : '', color: 'verbs', open: uniqAgain.length > 0 },
        uniqAgain.length
          ? h('ul', { class: 'plain ragain' }, uniqAgain.map((w) => h('li', {}, speakButton(w.lemma, { label: w.lemma }), h('div', {}, no(w.lemma, 'strong'), ' ', h('span', { class: 'trans' }, w.gloss_en)))))
          : h('p', {}, '🎉 You remembered every card. Nothing to see again soon.'));
      const cloudBox = h('div', { class: 'card' },
        heading('h2', '☁️', 'How strong are these words now?'),
        h('p', { class: 'muted' }, 'Size = how often you studied or met the word, colour = how strong your knowledge of it is.'),
        h('p', { class: 'muted', role: 'status' }, 'Loading…'));
      page(
        h('div', { class: 'card hero celebrate' },
          confetti(),
          h('h2', {}, `Done: ${total} ${total === 1 ? 'card' : 'cards'} reviewed`),
          h('p', {}, `${ss.remembered} remembered, ${tally.again} to see again soon. `, h('strong', {}, `+${gain} XP`)),
          extra,
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'primary', onclick: () => render(root, { words, db }) }, ...withIc('🔙', 'Back to Review')),
            h('a', { class: 'btn', href: '#/dashboard' }, ...withIc('🏠', 'Dashboard')))),
        sessionCard, again, cloudBox);
      if (!noChart()) {
        const c = colors3();
        doughnutChart(donutCanvas, ['Remembered', 'Again'], [ss.remembered, ss.again], [c[0], c[1]]);
        const b = barChart(barCanvas, gradeNames, [{ label: 'Cards', data: gradeCounts, backgroundColor: [token('--bad', '#b3261e'), c[1], c[0], token('--def', '#1a56a0')] }]);
        b.options.scales.y.ticks = { precision: 0 };
        b.options.plugins = { legend: { display: false } };
        b.update();
      }
      reward(db, gain, extra).catch(() => {}); // the summary above is already complete; the extras are a bonus
      let cloud;
      try {
        const state = { cards: await getAll(db, 'cards'), reviews: await getAll(db, 'reviews'), known: await getAll(db, 'known'), unknown: await getAll(db, 'unknown') };
        cloud = wordCloud(cloudItems(words, state, { ids: new Set(sessionWordIds) }), { empty: 'No words to show for this session.' });
      } catch {
        cloud = h('p', { class: 'error' }, 'The saved state could not be loaded, so the word cloud is not available.');
      }
      if (cloudBox.isConnected) cloudBox.lastElementChild.replaceWith(cloud);
    }

    function show() {
      if (i >= total) return done();
      const card = queue[i];
      const word = byId.get(card.wordId);
      const startedAt = Date.now();
      const errorBox = h('div', { role: 'alert' });
      let isGraded = false; // set synchronously: blocks double activation
      let recorded = false;
      let revealedNow = false;

      const sides = { left: ['again', 'hard'], right: ['good', 'easy'] };
      const btns = {};
      for (const g of Object.keys(GRADES)) btns[g] = sideBtn(g, () => grade(g));
      const showBtn = h('button', { type: 'button', class: 'primary rshow', onclick: reveal }, ...withIc('👁️', 'Show answer (Space)'));
      const ctx = h('div', { class: 'rctx' });
      const answer = h('div', { class: 'ranswer', tabindex: '-1' }, showBtn);
      const mid = h('div', { class: 'tmid rmid' },
        h('div', { class: 'tword' }, no(word.lemma, 'span', 'big'), speakButton(word.lemma, { label: word.lemma })),
        h('p', { class: 'center rmeta' },
          h('span', { class: 'chip' }, word.pos),
          h('span', { class: 'lvl', title: levelOf(word).derived ? 'Estimated from word frequency' : 'Level' }, (levelOf(word).derived ? '≈' : '') + levelOf(word).level),
          h('span', { class: 'dots', role: 'img', 'aria-label': `Complexity ${complexityOf(word)} of 5` }, '●'.repeat(complexityOf(word)) + '○'.repeat(5 - complexityOf(word)))),
        answer);

      function reveal() {
        if (revealedNow) return;
        revealedNow = true;
        answer.replaceChildren(
          meaning(word, { listen: true }));
        answer.focus({ preventScroll: true }); // the revealed button is gone; keep keyboard focus (not on a grade button: Space keyup would grade it)
        ctx.replaceChildren(collapsible({ emoji: '💬', title: 'Context and forms', color: 'sentences', open: false }, contextPanel(word)));
        Object.values(btns).forEach((b) => { b.disabled = false; });
        keys = Object.fromEntries(Object.keys(GRADES).map((g, n) => [String(n + 1), () => grade(g)]));
      }
      keys = { ' ': reveal, enter: reveal };

      async function grade(g) {
        if (isGraded) return;
        isGraded = true;
        const now = Date.now();
        const ms = Math.min(now - startedAt, MAX_CARD_MS);
        try {
          if (!recorded) {
            await add(db, 'reviews', { wordId: card.wordId, timestamp: now, grade: g, ms, prevInterval: card.interval });
            recorded = true;
          }
          await put(db, 'cards', review(card, g, now));
        } catch (e) {
          isGraded = false;
          errorBox.replaceChildren(h('p', { class: 'error' }, `Could not save this review (${e.message}). Please try again.`));
          return;
        }
        tally[g]++;
        graded.push({ grade: g, ms });
        if (g === 'again') againWords.push(word);
        i++;
        show();
      }

      page(
        h('div', { class: 'tprog' },
          h('p', { class: 'tprog-t' }, ic('🧭'), h('strong', {}, `Card ${i + 1} of ${total}`)),
          h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Review progress', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(i) }, h('span', { style: `width:${(i / total) * 100}%` }))),
        h('div', { class: 'card testcard tgrid rgrid' },
          h('div', { class: 'tside rside' }, sides.left.map((g) => btns[g])),
          mid,
          h('div', { class: 'tside rside' }, sides.right.map((g) => btns[g])),
          ctx),
        errorBox,
        livePanel,
        h('p', { class: 'muted' }, h('button', { type: 'button', class: 'quiet', onclick: () => render(root, { words, db }) }, ...withIc('←', 'Stop and go back'))),
      );
      updateLive();
      if (i > 0) showBtn.focus({ preventScroll: true }); // keyboard users keep their place after every card
      if (pref('reviewAutoplay', false)) {
        try { Promise.resolve(speak(word.lemma, { slow: isSlow() })).catch(() => {}); } catch { /* audio is optional */ }
      }
    }
    show();
  }

  setup();
}
