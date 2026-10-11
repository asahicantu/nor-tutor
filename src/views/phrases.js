import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { getAll, put } from '../db.js';
import { shuffle } from '../rng.js';
import { speak, speechSupported } from '../speech.js';
import { isSlow } from './speakui.js';

const COUNTS = [[5, '5'], [10, '10'], [20, '20'], [0, 'All']];
const canSpeak = speechSupported(); // the shared speech module picks a Norwegian voice and honours the slow-speech setting

export async function render(root, { words, phrases, db }) {
  const stats = new Map((await getAll(db, 'phrases')).map((r) => [r.phraseId, r]));
  const topics = [...new Set(phrases.map((p) => p.topic))];
  // Any form or lemma -> word, so a tapped word in a sentence can show its meaning.
  const index = new Map();
  for (const w of [...words].reverse()) for (const f of [w.lemma, ...w.forms]) index.set(f.toLocaleLowerCase('nb'), w);

  let topic = pref('phraseTopic', '');
  let count = pref('phraseCount', 10);
  if (topic && !topics.includes(topic)) topic = '';
  let keys = {};
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));
  const page = (...kids) => root.replaceChildren(h('h1', {}, 'Phrases'), ...kids.filter(Boolean));
  const pool = () => phrases.filter((p) => !topic || p.topic === topic);

  // A sentence whose words can be tapped for their meaning (shown in `lookup`).
  function sentence(p, cls = 'sentence') {
    const lookup = h('p', { class: 'lookup', role: 'status', hidden: true });
    const tokens = p.no.split(/([\p{L}'-]+)/u).map((t) => {
      if (!/\p{L}/u.test(t)) return t;
      return h('button', {
        class: 'tok', type: 'button',
        onclick: () => {
          const w = index.get(t.toLocaleLowerCase('nb'));
          lookup.hidden = false;
          lookup.replaceChildren(...(w
            ? [no(w.lemma, 'strong'), ' ', h('span', { class: 'chip' }, w.pos), ' ', h('span', { class: 'trans' }, w.gloss_en), ' ', no(w.def_no, 'span', 'def')]
            : [no(t, 'strong'), h('span', { class: 'muted' }, ' is not in the word list yet.')]));
        },
      }, t);
    });
    return h('div', {}, h('p', { class: cls, lang: 'nb' }, tokens), lookup);
  }

  const listenBtn = (p) => (canSpeak ? h('button', { class: 'quiet', onclick: () => speak(p.no, { slow: isSlow() }), 'aria-label': 'Listen to the sentence' }, '🔊 Listen') : null);
  const record = async (p, got) => {
    const prev = stats.get(p.id);
    const row = { phraseId: p.id, seen: (prev?.seen ?? 0) + 1, got: (prev?.got ?? 0) + (got ? 1 : 0), lastAt: Date.now() };
    await put(db, 'phrases', row);
    stats.set(p.id, row);
  };

  function menu() {
    keys = {};
    const known = phrases.filter((p) => stats.get(p.id)?.got > 0).length;
    const topicSel = h('select', { 'aria-label': 'Topic', onchange: (e) => { topic = e.target.value; setPref('phraseTopic', topic); n.textContent = info(); } },
      h('option', { value: '' }, 'All topics'),
      topics.map((t) => h('option', { value: t, selected: t === topic ? 'selected' : false }, t)));
    const info = () => `${pool().length} sentences in this selection. You have understood ${known} of ${phrases.length} at least once.`;
    const n = h('p', { class: 'muted' }, info());
    page(
      h('div', { class: 'card' },
        h('h2', {}, 'Read and practise whole sentences'),
        h('p', {}, 'Tap any word to see its meaning. Practice shows a sentence first, then the translation, and you say whether you understood it.'),
        h('label', {}, h('span', { class: 'muted' }, 'Topic '), topicSel),
        n,
        h('h3', {}, 'Sentences per practice'),
        segmented('Number of sentences', COUNTS, count, (c) => { count = c; setPref('phraseCount', c); }),
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: practice }, 'Start practice'),
          h('button', { onclick: read }, 'Just read'))),
    );
  }

  function read() {
    keys = {};
    const showTr = h('input', { type: 'checkbox' });
    showTr.checked = pref('phraseShowTr', true);
    const list = h('div', { class: 'plist' }, pool().map((p) =>
      h('article', { class: 'card pitem' },
        h('div', { class: 'row between' }, h('span', { class: 'chip' }, `${p.topic} · ${p.level}`), listenBtn(p)),
        sentence(p),
        h('p', { class: 'trans ptr' }, p.en),
        p.hint ? h('p', { class: 'muted ptr' }, p.hint) : null)));
    const apply = () => list.classList.toggle('hide-tr', !showTr.checked);
    showTr.addEventListener('change', () => { setPref('phraseShowTr', showTr.checked); apply(); });
    apply();
    page(
      h('div', { class: 'toolbar' }, h('button', { onclick: menu }, '← Back'), h('label', { class: 'switch' }, showTr, h('span', { class: 'track', 'aria-hidden': 'true' }), 'Show translations')),
      list);
  }

  function practice() {
    // Sentences you have not understood yet come first.
    const all = shuffle(pool(), Math.random).sort((a, b) => (stats.get(a.id)?.got > 0) - (stats.get(b.id)?.got > 0));
    const queue = count ? all.slice(0, count) : all;
    if (queue.length === 0) return menu();
    let i = 0;
    let got = 0;
    const missed = [];

    function show() {
      if (i >= queue.length) return finish();
      const p = queue[i];
      let answered = false;
      const tr = h('div', { hidden: true },
        h('p', { class: 'trans sentence' }, p.en),
        p.hint ? h('p', { class: 'muted' }, p.hint) : null,
        h('p', { class: 'muted' }, 'Did you understand it?'),
        h('div', { class: 'row center' },
          h('button', { class: 'grade good', onclick: () => answer(true) }, h('strong', {}, 'Got it'), h('small', {}, 'G')),
          h('button', { class: 'grade again', onclick: () => answer(false) }, h('strong', {}, 'Not yet'), h('small', {}, 'N'))));
      const showBtn = h('button', { class: 'primary', onclick: reveal }, 'Show translation (Space)');
      function reveal() {
        tr.hidden = false;
        showBtn.hidden = true;
        keys = { g: () => answer(true), n: () => answer(false) };
      }
      async function answer(ok) {
        if (answered) return;
        answered = true;
        if (ok) got++; else missed.push(p);
        try { await record(p, ok); } catch { /* progress still counts for this session */ }
        i++;
        show();
      }
      keys = { ' ': reveal, enter: reveal };
      page(
        h('p', { class: 'muted' }, `Sentence ${i + 1} of ${queue.length}`),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(queue.length), 'aria-valuenow': String(i) }, h('span', { style: `width:${(i / queue.length) * 100}%` })),
        h('div', { class: 'card testcard' },
          h('p', { class: 'chip' }, p.topic),
          sentence(p, 'sentence big-s'),
          h('div', { class: 'row center' }, listenBtn(p), showBtn),
          tr),
        h('p', {}, h('button', { class: 'quiet', onclick: menu }, '← Stop')));
    }

    function finish() {
      keys = {};
      page(
        h('div', { class: 'card hero' },
          h('h2', {}, `You understood ${got} of ${queue.length} sentences`),
          h('p', {}, got === queue.length ? 'Perfect. Try a longer set or another topic.' : 'The sentences you missed will come up first next time.')),
        missed.length ? h('div', { class: 'card' }, h('h3', {}, 'To revisit'), missed.map((p) => h('div', { class: 'pitem' }, no(p.no, 'p', 'def'), h('p', { class: 'trans' }, p.en)))) : null,
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: practice }, 'Practise again'), h('button', { onclick: menu }, 'Change topic')));
    }
    show();
  }

  menu();
}
