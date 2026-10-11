import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { sampleWords, scoreTest, bandSizes, bandLabel } from '../estimator.js';
import { add, getAll } from '../db.js';
import { buildStatus } from '../wordstatus.js';
import { markKnown, recordMiss, addToDeck } from '../actions.js';
import { doughnutChart, barChart, token } from '../charts.js';
import { sessionStats } from '../session.js';
import { cloudItems } from '../strength.js';
import { speak } from '../speech.js';
import { meaning } from './wordui.js';
import { speakButton, slowSwitch, audioNotice, isSlow } from './speakui.js';
import { wordCloud } from './wordcloud.js';

const COUNTS = [[10, '10'], [20, '20'], [40, '40'], [60, '60']];
const fmt = (n) => n.toLocaleString('en');
const pct = (x) => `${Math.round(x * 100)}%`;
const ic = (e) => h('span', { class: 'ic', 'aria-hidden': 'true' }, e); // decorative emoji
const withIc = (e, text) => [ic(e), h('span', {}, text)];
const heading = (tag, e, text) => h(tag, {}, ic(e), ' ', text);
const noChart = () => typeof Chart === 'undefined';
const chartNotice = () => h('p', { class: 'muted', role: 'status' }, 'Charts need Chart.js from the internet, which could not be loaded. The numbers below show the same information.');
const colors3 = () => [token('--known', '#0d6868'), token('--review', '#8a5200'), token('--line', '#dcdaea')];

// Segmented bar + doughnut for three counts [known, unknown, rest]. update() changes both in place (the chart is created once).
function statPanel(labels, canvasLabel) {
  const segs = ['k', 'u', 'n'].map((c) => h('span', { class: `tseg ${c}` }));
  const bar = h('div', { class: 'tbar', 'aria-hidden': 'true' }, segs);
  const text = h('p', { class: 'tcounts', 'aria-live': 'polite' });
  const canvas = h('canvas', { role: 'img', 'aria-label': canvasLabel });
  let donut = null;
  const el = h('div', { class: 'tstat' }, h('div', { class: 'tstat-text' }, bar, text), noChart() ? null : h('div', { class: 'tdonut' }, canvas));
  function update(parts, content) {
    const total = parts.reduce((a, b) => a + b, 0);
    segs.forEach((s, i) => { s.style.width = `${total ? (parts[i] / total) * 100 : 0}%`; });
    text.replaceChildren(...[content].flat());
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

const sideBtn = (cls, emoji, label, onclick, disabled = false) =>
  h('button', { type: 'button', class: `tbtn ${cls}`, disabled: disabled || false, onclick }, ic(emoji), h('span', {}, label));

export async function render(root, { words, db }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const status = buildStatus({
    known: await getAll(db, 'known'), unknown: await getAll(db, 'unknown'), cards: await getAll(db, 'cards'),
  });
  let count = Math.min(pref('testCount', 20), words.length);
  let keys = {}; // current shortcut map, swapped per screen
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));
  const page = (...kids) => {
    // Each screen replaces the whole page. If an answer button had the keyboard focus, hand it to the matching button on the
    // new screen, so a keyboard or screen-reader user is not dropped back to the top of the page after every word.
    const had = document.activeElement?.closest?.('.tbtn');
    root.replaceChildren(heading('h1', '📝', 'Vocabulary test'), ...kids.filter(Boolean));
    if (had) (root.querySelector(`.${had.classList.contains('tyes') ? 'tyes' : 'tno'}:not([disabled])`) ?? root.querySelector('.tyes:not([disabled])'))?.focus();
  };

  function intro() {
    keys = { enter: start };
    const counts = COUNTS.filter(([n]) => n <= words.length);
    const note = h('p', { class: 'muted' });
    const setNote = () => { note.textContent = `About ${Math.max(1, Math.round((count * 6) / 60))} min. Words are picked at random from all frequency levels.`; };
    setNote();
    const autoBox = h('input', { type: 'checkbox' });
    autoBox.checked = pref('testAutoplay', false);
    autoBox.addEventListener('change', () => setPref('testAutoplay', autoBox.checked));
    const knownN = [...status.known].filter((id) => byId.has(id)).length;
    const unknownN = [...status.missed.keys()].filter((id) => byId.has(id) && !status.known.has(id)).length;
    const restN = Math.max(0, words.length - knownN - unknownN);
    const overview = statPanel(['Known words', 'Unknown words', 'Not tested yet'], 'Known and unknown words in the whole list');
    page(h('div', { class: 'card' },
      heading('h2', '🎯', 'How well do you know the most-used Norwegian words?'),
      h('p', {}, 'You will see real Norwegian words, one at a time. Say whether you know each one. If you do not, the app shows its meaning straight away, keeps a record of it and adds it to your review deck.'),
      h('p', { class: 'muted' }, 'Be honest: answer "I know it" only if you could explain the word to someone.'),
      heading('h3', '🔢', 'How many words?'),
      segmented('Number of words', counts.length ? counts : [[words.length, String(words.length)]], count, (n) => { count = n; setPref('testCount', n); setNote(); }),
      note,
      heading('h3', '🔊', 'Listening'),
      h('div', { class: 'row topts' },
        slowSwitch(),
        h('label', { class: 'switch', title: 'Say each word aloud when it appears' }, autoBox, h('span', { class: 'track', 'aria-hidden': 'true' }), ic('▶️'), 'Auto-play each word')),
      audioNotice(),
      h('p', { class: 'row' }, h('button', { class: 'primary tstart', onclick: start }, ...withIc('▶️', 'Start test'), h('span', { class: 'muted-on' }, '⏎')))),
      h('div', { class: 'card' },
        heading('h2', '📊', 'Where you stand now'),
        overview.el));
    overview.update([knownN, unknownN, restN], h('ul', { class: 'plain tlegend' },
      h('li', {}, h('span', { class: 'tkey k', 'aria-hidden': 'true' }), `✅ ${fmt(knownN)} known words`),
      h('li', {}, h('span', { class: 'tkey u', 'aria-hidden': 'true' }), `❌ ${fmt(unknownN)} unknown words (missed, not known yet)`),
      h('li', {}, h('span', { class: 'tkey n', 'aria-hidden': 'true' }), `❓ ${fmt(restN)} not tested yet`)));
  }

  function start() {
    // The unknown counts BEFORE this session: recordMiss updates the live counts as the test runs.
    const before = new Map([...status.missed].map(([id, r]) => [id, { count: r.count }]));
    const items = sampleWords(words, Math.random, count);
    const responses = [];
    const answers = [];
    const saves = [];
    const missed = [];
    const live = statPanel(['Know', "Don't know", 'To go'], 'Your answers so far');
    const livePanel = h('div', { class: 'card tlive' }, heading('h2', '📊', 'Your answers so far'), live.el);
    let i = 0;

    const next = () => { i++; show(); };
    const updateLive = () => {
      const k = responses.filter((r) => r.known).length;
      const u = responses.length - k;
      const rest = items.length - responses.length;
      live.update([k, u, rest], `✅ ${k} know · ❌ ${u} don't know · ⏳ ${rest} to go`);
    };

    function reveal(item, w) {
      keys = { enter: next, arrowright: next };
      page(
        progress(),
        h('div', { class: 'card testcard tgrid' },
          h('div', { class: 'tside' }, sideBtn('tno', '💾', 'Saved', null, true)),
          h('div', { class: 'tmid' },
            h('p', { class: 'badge review' }, '💾 Saved to your unknown words and added to your review deck'),
            h('div', { class: 'tword' }, no(w.lemma, 'span', 'big'), speakButton(w.lemma, { label: w.lemma })),
            h('p', { class: 'center' }, h('span', { class: 'chip' }, w.pos)),
            meaning(w, { listen: true }),
            h('p', { class: 'muted center' }, 'Enter or → for the next word')),
          h('div', { class: 'tside' }, sideBtn('tyes primary', '▶️', 'Next', next))),
        livePanel,
      );
      updateLive();
    }

    function progress() {
      return h('div', { class: 'tprog' },
        h('p', { class: 'tprog-t' }, ic('🧭'), h('strong', {}, `Word ${Math.min(i + 1, items.length)} of ${items.length}`)),
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Test progress', 'aria-valuemin': '0', 'aria-valuemax': String(items.length), 'aria-valuenow': String(i) }, h('span', { style: `width:${(i / items.length) * 100}%` })));
    }

    function show() {
      if (i >= items.length) return finish(items, responses, answers, before, saves, missed);
      const item = items[i];
      const w = byId.get(item.wordId);
      const idx = i;
      const shownAt = performance.now();
      const answer = (known) => {
        if (i !== idx || performance.now() - shownAt < 250) return;
        responses.push({ kind: 'word', band: item.band, known });
        answers.push({ wordId: w.id, known });
        if (known) {
          saves.push(markKnown(db, status, w.id).catch((e) => e));
          return next();
        }
        missed.push(w);
        saves.push(recordMiss(db, status, w.id).catch((e) => e), addToDeck(db, status, w.id).catch((e) => e));
        reveal(item, w);
      };
      keys = { k: () => answer(true), arrowright: () => answer(true), d: () => answer(false), arrowleft: () => answer(false) };
      page(
        progress(),
        h('div', { class: 'card testcard tgrid' },
          h('div', { class: 'tside' }, sideBtn('tno', '❌', "I don't know it", () => answer(false))),
          h('div', { class: 'tmid' },
            h('div', { class: 'tword' }, no(w.lemma, 'span', 'big'), speakButton(w.lemma, { label: w.lemma })),
            h('p', { class: 'center' }, h('span', { class: 'chip' }, w.pos)),
            h('p', { class: 'muted center tkeys' }, 'Shortcuts: K or → know · D or ← don\'t know')),
          h('div', { class: 'tside' }, sideBtn('tyes primary', '✅', 'I know it', () => answer(true)))),
        livePanel,
      );
      updateLive();
      if (pref('testAutoplay', false)) {
        try { Promise.resolve(speak(w.lemma, { slow: isSlow() })).catch(() => {}); } catch { /* audio is optional */ }
      }
    }
    show();
  }

  async function finish(items, responses, answers, before, saves, missed) {
    keys = {};
    page(h('p', { class: 'muted' }, 'Saving…'));
    const failed = (await Promise.all(saves)).filter((r) => r instanceof Error);
    let result;
    try {
      result = scoreTest(responses, bandSizes(words));
    } catch (e) {
      page(h('p', { class: 'error' }, `Result not available: ${e.message}`), h('button', { onclick: intro }, 'Back'));
      return;
    }
    let saveError = failed[0] ?? null;
    try {
      await add(db, 'tests', { timestamp: Date.now(), ...result });
    } catch (e) {
      saveError = e;
    }
    let state = null;
    try {
      state = { cards: await getAll(db, 'cards'), reviews: await getAll(db, 'reviews'), known: await getAll(db, 'known'), unknown: await getAll(db, 'unknown') };
    } catch { /* the cloud just shows a notice */ }
    const knownN = responses.filter((r) => r.known).length;
    const unique = [...new Map(missed.map((w) => [w.id, w])).values()];
    const ss = sessionStats(answers, before);
    const lemmaOf = (id) => byId.get(id)?.lemma ?? '—';
    const tile = (label, value, cap) => h('div', { class: 'wtile' }, h('span', { class: 'wtile-l' }, label), h('strong', { class: 'wtile-v' }, value), h('span', { class: 'muted wtile-c' }, cap));
    const donutCanvas = h('canvas', { role: 'img', 'aria-label': 'Known versus unknown answers in this test' });
    const barCanvas = h('canvas', { role: 'img', 'aria-label': 'How many times each unknown word has now appeared' });
    const mm = ss.mostMissed;
    const session = h('div', { class: 'card tsession' },
      heading('h2', '🧾', 'Your session'),
      noChart() ? chartNotice() : null,
      h('div', { class: 'tcharts' },
        h('section', {}, heading('h3', '🎯', 'Known vs unknown'), noChart() ? null : h('div', { class: 'tdonut tbig' }, donutCanvas)),
        h('section', {}, heading('h3', '🔁', 'How often each unknown word has appeared'),
          noChart() ? null : ss.unknown === 0 ? h('p', { class: 'muted' }, 'No unknown words this time.') : h('div', { class: 'tbars' }, barCanvas))),
      h('div', { class: 'wtiles' },
        tile('🌱 New words', String(ss.newWords), 'never missed before'),
        tile('🔄 Seen before', String(ss.seenBefore), 'missed in an earlier session'),
        tile('🏆 Most missed', mm && mm.times > 1 ? no(lemmaOf(mm.wordId)) : '—', mm && mm.times > 1 ? `${mm.times} times` : mm ? 'no word missed more than once' : 'no unknown words')),
      h('details', { class: 'wnums' },
        h('summary', {}, 'Show numbers'),
        h('table', {}, h('caption', {}, 'Answers in this test'), h('thead', {}, h('tr', {}, ['Answer', 'Words'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, h('tr', {}, h('th', { scope: 'row' }, 'Know'), h('td', {}, String(ss.known))), h('tr', {}, h('th', { scope: 'row' }, "Don't know"), h('td', {}, String(ss.unknown))))),
        h('table', {}, h('caption', {}, 'How often each unknown word has now appeared'), h('thead', {}, h('tr', {}, ['Appearance', 'Words'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, ss.buckets.map((b) => h('tr', {}, h('th', { scope: 'row' }, b.label), h('td', {}, String(b.n))))))));
    const cloud = h('div', { class: 'card' },
      heading('h2', '☁️', 'How strong is your knowledge of these words?'),
      h('p', { class: 'muted' }, 'Size = how often you studied or met the word, colour = how strong your knowledge of it is.'),
      state
        ? wordCloud(cloudItems(words, state, { ids: new Set(items.map((it) => it.wordId)) }), { empty: 'No words to show for this test.' })
        : h('p', { class: 'error' }, 'The saved state could not be loaded, so the word cloud is not available.'));
    page(
      saveError ? h('p', { class: 'error' }, `Some results could not be saved (${saveError.message}).`) : null,
      h('div', { class: 'card hero' },
        h('p', { class: 'muted' }, `You knew ${knownN} of ${items.length} words (${pct(knownN / items.length)}).`),
        h('div', { class: 'big' }, `≈ ${fmt(result.estimate)} of ${fmt(result.listSize)}`),
        h('p', {}, `Estimated words you know from our list. Likely range: ${fmt(result.ciLow)} – ${fmt(result.ciHigh)}.`),
        h('p', { class: 'muted' }, 'It is an index for comparing your own tests over time, not an absolute vocabulary size. More words per test gives a tighter range.')),
      session,
      unique.length
        ? h('div', { class: 'card' },
            heading('h2', '📚', `Words to learn (${unique.length})`),
            h('p', { class: 'muted' }, 'These were saved as unknown words and added to your review deck. We count each time you miss one.'),
            h('ul', { class: 'plain missed' }, unique.map((w) => h('li', {}, no(w.lemma, 'strong'), ' ', h('span', { class: 'trans' }, w.gloss_en)))))
        : h('div', { class: 'card' }, h('p', {}, '🎉 You knew every word. Try a longer test.')),
      cloud,
      h('details', {},
        h('summary', {}, 'Breakdown by how common the words are'),
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Frequency', 'Words in list', 'Tested', 'Known'].map((t) => h('th', {}, t)))),
          h('tbody', {}, result.bands.map((b) => h('tr', {}, h('td', {}, bandLabel(b.band)), h('td', {}, b.size), h('td', {}, b.sampled), h('td', {}, `${b.known} (${pct(b.known / b.sampled)})`))))))),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: intro }, ...withIc('🔁', 'Take another test')),
        h('a', { class: 'btn', href: '#/explore' }, ...withIc('📚', 'Browse words')),
        h('a', { class: 'btn quiet', href: '#/dashboard' }, ...withIc('📈', 'See your progress'))),
    );
    if (!noChart()) {
      const c = colors3();
      doughnutChart(donutCanvas, ['Know', "Don't know"], [ss.known, ss.unknown], [c[0], c[1]]);
      if (barCanvas.isConnected) {
        const b = barChart(barCanvas, ss.buckets.map((x) => x.label), [{ label: 'Unknown words', data: ss.buckets.map((x) => x.n), backgroundColor: c[1] }]);
        b.options.scales.y.ticks = { precision: 0 };
        b.options.plugins = { legend: { display: false } };
        b.update();
      }
    }
  }

  intro();
}
