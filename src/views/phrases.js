import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { getAll, put } from '../db.js';
import { shuffle } from '../rng.js';
import { speak, speechSupported } from '../speech.js';
import { isSlow, slowSwitch, audioNotice } from './speakui.js';
import { compareSentence, checkWord, pickBlank, hintLetters, tokenize } from '../typing.js';
import { typingPanel, letterKeys } from './typingui.js';

const COUNTS = [[5, '5'], [10, '10'], [20, '20'], [0, 'All']];
const canSpeak = speechSupported(); // the shared speech module picks a Norwegian voice and honours the slow-speech setting
const TOPIC_EMOJI = {
  'Greetings & politeness': '👋', 'Daily life': '🏠', 'Travel & directions': '🧭', 'Food & shopping': '🛒',
  'Work & study': '💼', 'Opinions & feelings': '💭', Health: '🩺', Weather: '⛅',
};
const ic = (emoji) => h('span', { class: 'icon', 'aria-hidden': 'true' }, emoji); // decoration: the words carry the meaning
const withIcon = (emoji, text) => [ic(emoji), ' ', text];

// How each word of a typed sentence compares with the right one (icon + colour + words, never colour alone).
const DIFF = { ok: ['✔', 'ok'], diacritic: ['≈', 'near'], typo: ['≈', 'near'], form: ['✖', 'bad'], wrong: ['✖', 'bad'], missing: ['✖', 'bad'], extra: ['✖', 'extra'] };
const BANNER = { correct: ['🎉', 'Correct!'], almost: ['👍', 'Almost right'], wrong: ['❌', 'Not quite'], gaveUp: ['👁️', 'Here is the answer'] };

export async function render(root, { words, phrases, db }) {
  const stats = new Map((await getAll(db, 'phrases')).map((r) => [r.phraseId, r]));
  const topics = [...new Set(phrases.map((p) => p.topic))];
  // Any form or lemma -> word, so a tapped word in a sentence can show its meaning.
  const index = new Map();
  for (const w of [...words].reverse()) for (const f of [w.lemma, ...w.forms]) index.set(f.toLocaleLowerCase('nb'), w);
  // A word that is itself a lemma wins over a form of another word (lett: "easy", not a form of lete).
  const lemmas = new Set();
  for (const w of words) { const k = w.lemma.toLocaleLowerCase('nb'); if (!lemmas.has(k)) { lemmas.add(k); index.set(k, w); } }
  const lookup = (token) => index.get(token.toLocaleLowerCase('nb'));
  // Every spelling of the same word (lemma and forms), under each of its spellings: used to tell "another form" from a typo.
  const family = new Map();
  for (const w of words) {
    const all = [w.lemma, ...w.forms].map((f) => f.toLocaleLowerCase('nb'));
    for (const f of all) family.set(f, new Set([...(family.get(f) ?? []), ...all]));
  }
  const checkOpts = { forms: (w) => [...(family.get(w) ?? [])], isWord: (w) => index.has(w) };

  let topic = pref('phraseTopic', '');
  let count = pref('phraseCount', 10);
  if (topic && !topics.includes(topic)) topic = '';
  let keys = {};
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));
  const page = (...kids) => root.replaceChildren(h('h1', {}, ...withIcon('💬', 'Phrases')), ...kids.filter(Boolean));
  const pool = () => phrases.filter((p) => !topic || p.topic === topic);
  const understood = (p) => stats.get(p.id)?.got > 0;
  // Sentences you have not got right yet come first.
  const ordered = () => shuffle(pool(), Math.random).sort((a, b) => understood(a) - understood(b));

  // A sentence whose words can be tapped for their meaning (shown in `lookup` below it).
  function sentence(p, cls = 'sentence') {
    const info = h('p', { class: 'lookup', role: 'status', hidden: true });
    const tokens = tokenize(p.no).map(({ text, word }) => {
      if (!word) return text;
      return h('button', {
        class: 'tok', type: 'button',
        onclick: () => {
          const w = lookup(text);
          info.hidden = false;
          info.replaceChildren(...(w
            ? [no(w.lemma, 'strong'), ' ', h('span', { class: 'chip' }, w.pos), ' ', h('span', { class: 'trans' }, w.gloss_en), ' ', no(w.def_no, 'span', 'def')]
            : [no(text, 'strong'), h('span', { class: 'muted' }, ' is not in the word list yet.')]));
        },
      }, text);
    });
    return h('div', {}, h('p', { class: `${cls} sfree`, lang: 'nb' }, tokens), info);
  }

  const listenBtn = (text) => (canSpeak ? h('button', { type: 'button', class: 'quiet', onclick: () => speak(text, { slow: isSlow() }), 'aria-label': 'Listen to the sentence' }, ...withIcon('🔊', 'Listen')) : null);
  // Counts an answer the learner says was right after all (a valid alternative translation): one more `got`, `seen` unchanged.
  const credit = async (p) => {
    const prev = stats.get(p.id);
    if (!prev) return;
    const row = { ...prev, got: prev.got + 1, lastAt: Date.now() };
    await put(db, 'phrases', row);
    stats.set(p.id, row);
  };
  const record = async (p, got) => {
    const prev = stats.get(p.id);
    const row = { phraseId: p.id, seen: (prev?.seen ?? 0) + 1, got: (prev?.got ?? 0) + (got ? 1 : 0), lastAt: Date.now() };
    await put(db, 'phrases', row);
    stats.set(p.id, row);
  };

  // ---------- menu
  function menu() {
    keys = {};
    const total = phrases.length;
    const done = phrases.filter(understood).length;
    const inTopic = pool();
    const chip = (value, label, n) => h('button', {
      type: 'button', class: 'chipbtn', 'aria-pressed': String(value === topic),
      onclick: () => { topic = value; setPref('phraseTopic', topic); menu(); },
    }, ...withIcon(label[0], `${label[1]} (${n})`));
    const modes = [
      ['👀', 'Read', 'Browse the sentences, tap any word for its meaning and listen.', read],
      ['🧠', 'Understand', 'See the Norwegian, then the translation, and rate yourself.', understand],
      ['✍️', 'Write the sentence', 'Read the English and type the sentence in Norwegian.', () => typingSession('write')],
      ['🔤', 'Fill the blank', 'One word is missing: type it in Norwegian.', () => typingSession('fill')],
      ['📝', 'Free writing', 'Write anything in Norwegian and tap your words to look them up.', freeWrite],
    ];
    page(
      h('div', { class: 'card pover' },
        h('h2', {}, ...withIcon('🎯', `You have got ${done} of ${total} phrases right`)),
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Phrases got right', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) }, h('span', { style: `width:${total ? (done / total) * 100 : 0}%` })),
        h('p', { class: 'muted' }, 'Read whole sentences, then practise them: understand them, write them, or fill in the missing word.')),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Topic' },
        chip('', ['🌐', 'All topics'], total),
        topics.map((t) => chip(t, [TOPIC_EMOJI[t] ?? '💬', t], phrases.filter((p) => p.topic === t).length))),
      h('p', { class: 'muted' }, `${inTopic.length} sentences in this selection.`),
      h('div', { class: 'pmodes' }, modes.map(([emoji, title, text, run]) =>
        h('button', { type: 'button', class: 'pmode', disabled: inTopic.length === 0, onclick: run },
          h('span', { class: 'pmode-icon', 'aria-hidden': 'true' }, emoji), h('strong', {}, title), h('span', { class: 'muted' }, text)))),
      h('div', { class: 'card' },
        h('h3', {}, ...withIcon('🎚️', 'Practice settings')),
        h('p', { class: 'muted' }, 'Sentences per practice'),
        segmented('Number of sentences', COUNTS, count, (c) => { count = c; setPref('phraseCount', c); }),
        h('div', { class: 'row' }, slowSwitch()),
        audioNotice()),
    );
  }

  // ---------- read
  function read() {
    keys = {};
    const showTr = h('input', { type: 'checkbox' });
    showTr.checked = pref('phraseShowTr', true);
    const list = h('div', { class: 'plist' }, pool().map((p) =>
      h('article', { class: 'card pitem' },
        h('div', { class: 'row between' }, h('span', { class: 'chip' }, `${TOPIC_EMOJI[p.topic] ?? '💬'} ${p.topic} · ${p.level}`), listenBtn(p.no)),
        sentence(p),
        h('p', { class: 'trans ptr' }, p.en),
        p.hint ? h('p', { class: 'muted ptr' }, p.hint) : null)));
    const apply = () => list.classList.toggle('hide-tr', !showTr.checked);
    showTr.addEventListener('change', () => { setPref('phraseShowTr', showTr.checked); apply(); });
    apply();
    page(
      h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: menu }, ...withIcon('←', 'Back')), h('label', { class: 'switch' }, showTr, h('span', { class: 'track', 'aria-hidden': 'true' }), 'Show translations')),
      list);
  }

  // ---------- understand (see the sentence, then the translation, rate yourself)
  function understand() {
    const all = ordered();
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
          h('button', { class: 'grade good', onclick: () => answer(true) }, h('strong', {}, ...withIcon('✅', 'Got it')), h('small', {}, 'G')),
          h('button', { class: 'grade again', onclick: () => answer(false) }, h('strong', {}, ...withIcon('🔁', 'Not yet')), h('small', {}, 'N'))));
      const showBtn = h('button', { class: 'primary', onclick: reveal }, ...withIcon('👁️', 'Show translation (Space)'));
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
        progressHead(i, queue.length, 'Sentence'),
        h('div', { class: 'card testcard' },
          h('p', { class: 'chip' }, `${TOPIC_EMOJI[p.topic] ?? '💬'} ${p.topic}`),
          sentence(p, 'sentence big-s'),
          h('div', { class: 'row center' }, listenBtn(p.no), showBtn),
          tr),
        h('p', {}, h('button', { type: 'button', class: 'quiet', onclick: menu }, ...withIcon('←', 'Stop'))));
    }

    function finish() {
      keys = {};
      page(
        h('div', { class: 'card hero' },
          h('h2', {}, ...withIcon('🎉', `You understood ${got} of ${queue.length} sentences`)),
          h('p', {}, got === queue.length ? 'Perfect. Try a longer set or another topic.' : 'The sentences you missed will come up first next time.')),
        missed.length ? h('div', { class: 'card' }, h('h3', {}, ...withIcon('🔁', 'To revisit')), missed.map((p) => h('div', { class: 'pitem' }, no(p.no, 'p', 'def'), h('p', { class: 'trans' }, p.en)))) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: understand }, ...withIcon('🔁', 'Practise again')), h('button', { type: 'button', onclick: menu }, ...withIcon('🗂️', 'Change topic'))));
    }
    show();
  }

  const progressHead = (i, n, noun) => h('div', {},
    h('p', { class: 'muted' }, ...withIcon('🧭', `${noun} ${Math.min(i + 1, n)} of ${n}`)),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(n), 'aria-valuenow': String(i) }, h('span', { style: `width:${(i / n) * 100}%` })));

  // ---------- write the sentence / fill the blank
  function typingSession(kind) {
    const picked = count ? ordered().slice(0, count) : ordered();
    const items = picked.map((p) => ({ p, blank: kind === 'fill' ? pickBlank(p.no, lookup, Math.random) : null })).filter((it) => kind === 'write' || it.blank);
    if (items.length === 0) return menu();
    let i = 0;
    const results = [];

    function show() {
      if (i >= items.length) return finish();
      const { p, blank } = items[i];
      let done = false;
      const feedback = h('div', { class: 'pfeedback' });
      const live = h('p', { class: 'sr', role: 'status' }); // announces just the verdict, not the whole breakdown
      const nudge = h('p', { class: 'muted', role: 'status', hidden: true });
      const hint = h('p', { class: 'phint muted', hidden: true });
      const panel = typingPanel({
        multiline: kind === 'write', label: kind === 'write' ? 'Your Norwegian sentence' : 'The missing word', onSubmit: check,
        widthCh: blank ? Math.max(7, blank.answer.length + 3) : null,
      });
      const hintBtn = h('button', {
        type: 'button', class: 'quiet',
        onclick: () => {
          hint.hidden = !hint.hidden;
          hint.textContent = kind === 'write' ? `First letters: ${hintLetters(p.no)}` : `Meaning: ${blank.entry.gloss_en} (${blank.entry.pos}). It starts with “${blank.answer[0]}”.`;
        },
      }, ...withIcon('💡', 'Hint'));
      const giveBtn = h('button', { type: 'button', class: 'quiet', onclick: () => settle({ result: 'gaveUp' }, '') }, ...withIcon('👁️', 'Show answer'));

      function check() {
        if (done) return;
        const typed = panel.value();
        if (!typed.trim()) {
          nudge.textContent = 'Type your answer first, or press “Show answer”.';
          nudge.hidden = false;
          panel.focus();
          return;
        }
        settle(kind === 'write' ? compareSentence(typed, p.no, checkOpts) : checkWord(typed, blank.answer, [...(family.get(blank.answer.toLocaleLowerCase('nb')) ?? [])]), typed);
      }

      function settle(res, typed) {
        if (done) return;
        done = true;
        panel.lock(true);
        hintBtn.disabled = giveBtn.disabled = true;
        nudge.hidden = true;
        const got = res.result === 'correct' || res.result === 'almost';
        const saved = record(p, got).catch(() => { /* progress still counts for this session */ });
        const entry = { p, got, typed, answer: kind === 'write' ? p.no : blank.answer };
        results.push(entry);
        const [bIcon, bText] = BANNER[res.result];
        live.textContent = bText;
        const last = i === items.length - 1;
        const next = () => { i++; show(); };
        // Enter presses the focused Next button itself: no global Enter shortcut here, so Enter on Listen, a word or Stop keeps its own meaning.
        const nextBtn = h('button', { type: 'button', class: 'primary', onclick: next }, ...withIcon(last ? '🏁' : '▶️', last ? 'See results' : 'Next'));
        // A phrase has one target sentence, so a valid alternative can be marked wrong: let the learner say so.
        const banner = h('p', { class: `pbanner ${res.result}` }, ...withIcon(bIcon, bText));
        const alsoBtn = !got && res.result !== 'gaveUp' ? h('button', {
          type: 'button', class: 'quiet',
          onclick: async () => {
            alsoBtn.disabled = true;
            entry.got = true;
            banner.className = 'pbanner correct';
            banner.replaceChildren(...withIcon('👍', 'Counted as right'));
            live.textContent = 'Counted as right';
            await saved;
            try { await credit(p); } catch { /* the session still counts it */ }
          },
        }, ...withIcon('👍', 'My answer is also correct')) : null;
        const detail = kind === 'write'
          ? [res.items && typed.trim() ? h('div', {}, h('p', { class: 'muted' }, 'Word by word:'), diffView(res.items)) : null,
            h('p', { class: 'muted' }, 'The sentence:'), sentence(p, 'sentence big-s')]
          : [answerSentence(p, blank, res), res.note ? h('p', { class: 'muted' }, res.note) : null,
            h('p', { class: 'trans' }, ...withIcon('📖', `${blank.entry.gloss_en} (${blank.entry.pos})`))];
        // replaceChildren turns arrays and null into text, so every child is passed individually and null ones are dropped
        feedback.replaceChildren(...[
          banner,
          ...detail,
          h('p', { class: 'trans' }, p.en),
          p.hint ? h('p', { class: 'muted' }, p.hint) : null,
          h('div', { class: 'row' }, listenBtn(p.no), alsoBtn, nextBtn)].filter(Boolean));
        nextBtn.focus();
      }

      const prompt = kind === 'write'
        ? h('div', {}, h('p', { class: 'muted' }, ...withIcon('✍️', 'Write this in Norwegian:')), h('p', { class: 'trans sentence big-s' }, p.en), // the hint waits until after the answer: some hints give the Norwegian away
          h('div', { class: 'typing' }, panel.input, h('div', { class: 'row between' }, panel.keys, panel.button)))
        : h('div', {}, h('p', { class: 'muted' }, ...withIcon('🔤', 'Type the missing word:')),
          h('p', { class: 'sentence big-s fillrow', lang: 'nb' }, tokenize(p.no).map((tok, idx) => (idx === blank.tokenIndex ? panel.input : tok.text))),
          h('p', { class: 'trans' }, p.en),
          h('div', { class: 'row between' }, panel.keys, panel.button));
      keys = {};
      page(
        progressHead(i, items.length, 'Sentence'),
        h('div', { class: 'card testcard' },
          h('p', { class: 'chip' }, `${TOPIC_EMOJI[p.topic] ?? '💬'} ${p.topic} · ${p.level}`),
          prompt, nudge,
          h('div', { class: 'row' }, hintBtn, giveBtn), hint,
          live, feedback),
        h('p', {}, h('button', { type: 'button', class: 'quiet', onclick: menu }, ...withIcon('←', 'Stop'))));
      panel.focus();
    }

    function finish() {
      keys = {};
      const right = results.filter((r) => r.got).length;
      const wrong = results.filter((r) => !r.got);
      page(
        h('div', { class: 'card hero' },
          h('h2', {}, ...withIcon('🎉', `You got ${right} of ${results.length} right`)),
          h('p', {}, wrong.length === 0 ? 'Perfect. Try a longer set or another topic.' : 'The sentences you missed will come up first next time.')),
        wrong.length ? h('div', { class: 'card' }, h('h3', {}, ...withIcon('🔁', 'To revisit')),
          wrong.map((r) => h('div', { class: 'pitem' },
            no(kind === 'write' ? r.p.no : r.answer, 'p', 'def'),
            r.typed.trim() ? h('p', { class: 'muted' }, 'You wrote: ', no(r.typed)) : null,
            h('p', { class: 'trans' }, r.p.en)))) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => typingSession(kind) }, ...withIcon('🔁', 'Practise again')), h('button', { type: 'button', onclick: menu }, ...withIcon('🗂️', 'Change topic'))));
    }
    show();
  }

  // The typed sentence word by word, each marked with an icon and a note, so colour is never the only signal.
  function diffView(items) {
    return h('p', { class: 'pdiff', lang: 'nb' }, items.map((it) => {
      const [icon, cls] = DIFF[it.status];
      const detail = it.status === 'ok' ? null : it.status === 'missing' ? 'missing' : it.status === 'extra' ? 'not needed' : it.status === 'form' ? `you wrote “${it.typed}”, another form of the word` : `you wrote “${it.typed}”`;
      return h('span', { class: `pw ${cls}` }, h('span', { 'aria-hidden': 'true' }, icon), ' ', it.target ?? it.typed, detail ? h('small', {}, ` (${detail})`) : null);
    }));
  }

  // The sentence with the blank filled in with the right word (what was typed stays visible in the locked field above).
  function answerSentence(p, blank, res) {
    const ok = res.result === 'correct' || res.result === 'almost';
    return h('p', { class: 'sentence big-s', lang: 'nb' }, tokenize(p.no).map((tok, idx) =>
      (idx === blank.tokenIndex ? h('span', { class: `pw ${ok ? 'ok' : 'bad'}` }, h('span', { 'aria-hidden': 'true' }, ok ? '✔' : '✖'), ' ', tok.text) : tok.text)));
  }

  // ---------- free writing
  function freeWrite() {
    keys = {};
    const area = h('textarea', {
      class: 'tinput tarea', rows: '4', lang: 'nb', 'aria-label': 'Write in Norwegian', placeholder: 'Skriv noe på norsk…', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
    });
    const out = h('div', { class: 'fw-out' });
    const stat = h('p', { class: 'muted' }); // not a live region: it would be announced on every keystroke
    const lkeys = letterKeys(area);
    function update() {
      const text = area.value;
      const toks = tokenize(text).filter((t) => t.word);
      const inList = toks.filter((t) => lookup(t.text)).length;
      stat.textContent = toks.length ? `${toks.length} words · ${inList} found in your word list` : '';
      out.replaceChildren(text.trim() ? sentence({ no: text }, 'sentence') : h('p', { class: 'muted' }, 'Your words appear here. Tap a word to see its meaning.'));
    }
    area.addEventListener('input', update);
    update();
    page(
      h('div', { class: 'card' },
        h('h2', {}, ...withIcon('📝', 'Write in Norwegian')),
        h('p', { class: 'muted' }, 'Write a word, a sentence or a few lines. Your words become tappable below, and you can listen to what you wrote.'),
        area,
        h('div', { class: 'row between' }, lkeys,
          h('div', { class: 'row' }, listenBtn2(area), h('button', { type: 'button', onclick: () => { area.value = ''; update(); area.focus(); } }, ...withIcon('🧹', 'Clear')))),
        stat, out),
      h('p', {}, h('button', { type: 'button', class: 'quiet', onclick: menu }, ...withIcon('←', 'Back'))));
    area.focus();
  }
  // Listen to whatever is in the field right now.
  const listenBtn2 = (area) => (canSpeak ? h('button', { type: 'button', onclick: () => area.value.trim() && speak(area.value, { slow: isSlow() }), 'aria-label': 'Listen to what you wrote' }, ...withIcon('🔊', 'Listen')) : null);

  menu();
}
