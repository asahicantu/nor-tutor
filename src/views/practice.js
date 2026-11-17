import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { getAll, add } from '../db.js';
import { shuffle } from '../rng.js';
import { speak, speechSupported } from '../speech.js';
import { isSlow, slowSwitch, audioNotice } from './speakui.js';
import { compareSentence, checkOptions } from '../typing.js';
import { typingPanel, diffView } from './typingui.js';
import { buildStatus } from '../wordstatus.js';
import { genderOf, verbTask, choices, collocationItem, mistakesOf } from '../practice.js';

const COUNTS = [[5, '5'], [10, '10'], [20, '20']];
const COMMON = 200; // words you have not met yet are drawn from this many of the most common ones
const canSpeak = speechSupported();
const ic = (emoji) => h('span', { class: 'icon', 'aria-hidden': 'true' }, emoji); // decoration: the words carry the meaning
const withIcon = (emoji, text) => [ic(emoji), ' ', text];
const BANNER = { correct: ['🎉', 'Correct!'], almost: ['👍', 'Almost right'], wrong: ['❌', 'Not quite'], gaveUp: ['👁️', 'Here is the answer'] };
const GENDERS = ['en', 'ei', 'et'];

export async function render(root, { words, phrases, db }) {
  const [known, unknown, cards] = await Promise.all(['known', 'unknown', 'cards'].map((s) => getAll(db, s)));
  const status = buildStatus({ known, unknown, cards });
  const checkOpts = checkOptions(words);
  let count = pref('practiceCount', 10);
  let keys = {};
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));

  const met = (w) => status.known.has(w.id) || status.deck.has(w.id) || status.missed.has(w.id);
  // Up to `count` words that `fits`: words matching `first` (by default, words you have met) in random order, then a random
  // pick of the most common other ones, so every drill is useful from day one.
  function pickWords(fits, first = met) {
    const pool = words.filter(fits);
    const mine = shuffle(pool.filter(first), Math.random);
    const common = shuffle(pool.filter((w) => !first(w)).sort((a, b) => a.rank - b.rank).slice(0, COMMON), Math.random);
    return [...mine, ...common].slice(0, count);
  }

  const page = (...kids) => root.replaceChildren(h('h1', {}, ...withIcon('🏋️', 'Practice')), ...kids.filter(Boolean));
  const listenBtn = (text, label = 'Listen') => (canSpeak ? h('button', { type: 'button', onclick: () => speak(text, { slow: isSlow() }) }, ...withIcon('🔊', label)) : null);
  const slowBtn = (text) => (canSpeak ? h('button', { type: 'button', class: 'quiet', onclick: () => speak(text, { slow: true }) }, ...withIcon('🐢', 'Slowly')) : null);
  const wordLine = (w) => h('p', {}, no(w.lemma, 'strong'), ' ', h('span', { class: 'chip' }, w.pos), ' ', h('span', { class: 'trans' }, w.gloss_en));

  // ---------- menu
  function menu() {
    keys = {};
    const modes = [
      ['🎧', 'Dictation', 'Listen to a sentence and type what you hear.', dictation, canSpeak],
      ['👂', 'Listening quiz', 'Hear a word and pick what it means.', listenQuiz, canSpeak],
      ['✍️', 'Spell it', 'See the English and type the Norwegian word. Words from your review deck come first.', spell, true],
      ['🧩', 'Noun gender', 'En, ei or et? Pick the gender of each noun.', gender, true],
      ['🔁', 'Verb forms', 'Type the present, past or perfect form of a verb.', verbs, true],
      ['🔗', 'Word combinations', 'Pick the word that completes a common combination, like “gå ___ tur”.', colloc, true],
    ];
    page(
      h('p', { class: 'muted' }, 'Short drills for listening, writing and grammar. Every answer feeds the skill and mistake charts on the Home page.'),
      h('div', { class: 'pmodes' }, modes.map(([emoji, title, text, run, ok]) =>
        h('button', { type: 'button', class: 'pmode', disabled: !ok, onclick: run },
          h('span', { class: 'pmode-icon', 'aria-hidden': 'true' }, emoji), h('strong', {}, title),
          h('span', { class: 'muted' }, ok ? text : `${text} Needs speech, which this browser does not offer.`)))),
      h('div', { class: 'card' },
        h('h3', {}, ...withIcon('🎚️', 'Practice settings')),
        h('p', { class: 'muted' }, 'Questions per drill'),
        segmented('Number of questions', COUNTS, count, (c) => { count = c; setPref('practiceCount', c); }),
        h('div', { class: 'row' }, slowSwitch()),
        audioNotice()));
  }

  // ---------- one drill: a card per item, a verdict with Next, then a summary
  // `show(item, body, finish)` fills `body` and calls finish({ result, key, label, mistakes, detail }) once answered:
  // result is correct | almost | wrong | gaveUp, key is { wordId } or { phraseId }, label is the answer for the summary.
  // `again` starts a fresh round of the same drill.
  function drill(mode, title, items, show, again) {
    if (!items.length) return menu();
    let i = 0;
    const results = [];
    function next() {
      if (i >= items.length) return summary();
      keys = {};
      const body = h('div', { class: 'card testcard' });
      const feedback = h('div', { class: 'pfeedback' });
      const live = h('p', { class: 'sr', role: 'status' }); // announces the verdict only
      let done = false;
      const finish = ({ result, key, label, mistakes = [], detail = [] }) => {
        if (done) return;
        done = true;
        keys = {};
        const ok = result === 'correct' || result === 'almost';
        results.push({ ok, label });
        add(db, 'practice', { timestamp: Date.now(), mode, ...key, ok, ...(mistakes.length ? { mistakes } : {}) }).catch(() => { /* only the statistic is lost */ });
        const [icon, text] = BANNER[result];
        live.textContent = text;
        const last = i === items.length - 1;
        const nextBtn = h('button', { type: 'button', class: 'primary', onclick: () => { i++; next(); } }, ...withIcon(last ? '🏁' : '▶️', last ? 'See results' : 'Next'));
        feedback.replaceChildren(h('p', { class: `pbanner ${result}` }, ...withIcon(icon, text)), ...detail.filter(Boolean), h('div', { class: 'row' }, nextBtn));
        nextBtn.focus();
      };
      page(
        h('div', { class: 'backbar' }, h('button', { type: 'button', class: 'backbtn', title: 'Stop this drill and go back to the practice menu', onclick: menu },
          h('span', { class: 'backarrow', 'aria-hidden': 'true' }, '←'), h('span', {}, 'Stop'))),
        h('h2', {}, title),
        h('p', { class: 'muted' }, ...withIcon('🧭', `Question ${i + 1} of ${items.length}`)),
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Drill progress', 'aria-valuemin': '0', 'aria-valuemax': String(items.length), 'aria-valuenow': String(i) },
          h('span', { style: `width:${(i / items.length) * 100}%` })),
        body);
      show(items[i], body, finish);
      body.append(feedback, live);
    }
    function summary() {
      keys = {};
      const right = results.filter((r) => r.ok).length;
      const wrong = results.filter((r) => !r.ok);
      page(
        h('div', { class: 'card hero' },
          h('h2', {}, ...withIcon('🎉', `${title}: ${right} of ${results.length} right`)),
          h('p', {}, wrong.length ? 'Look over the ones you missed, then try another round.' : 'Perfect. Try a longer round or another drill.')),
        wrong.length ? h('div', { class: 'card' }, h('h3', {}, ...withIcon('🔁', 'To revisit')), h('ul', { class: 'plain' }, wrong.map((r) => h('li', {}, no(r.label, 'strong'))))) : null,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'primary', onclick: again }, ...withIcon('🔁', 'New round')),
          h('button', { type: 'button', onclick: menu }, ...withIcon('🗂️', 'Other drills'))));
    }
    next();
  }

  // A typed answer checked word by word against `target` (forgiving case, punctuation, æ ø å in ASCII and one small typo).
  function typed(body, finish, { prompt, target, label, key, detail = [], multiline = false }) {
    const panel = typingPanel({ multiline, label, onSubmit: check });
    const nudge = h('p', { class: 'muted', role: 'status', hidden: true });
    const giveBtn = h('button', { type: 'button', class: 'quiet', onclick: () => settle('', { result: 'gaveUp', items: [] }) }, ...withIcon('👁️', 'Show answer'));
    function check() {
      const text = panel.value();
      if (!text.trim()) {
        nudge.textContent = 'Type your answer first, or press “Show answer”.';
        nudge.hidden = false;
        panel.focus();
        return;
      }
      settle(text, compareSentence(text, target, checkOpts));
    }
    function settle(text, res) {
      panel.lock(true);
      giveBtn.disabled = true;
      nudge.hidden = true;
      finish({
        result: res.result, key, label: target, mistakes: text ? mistakesOf(res.items) : [],
        detail: [text && res.result !== 'correct' ? h('div', {}, h('p', { class: 'muted' }, 'Word by word:'), diffView(res.items)) : null, ...detail],
      });
    }
    body.append(...prompt, h('div', { class: 'typing' }, panel.input, h('div', { class: 'row between' }, panel.keys, panel.button)), nudge, h('div', { class: 'row' }, giveBtn));
    panel.focus();
  }

  // Multiple choice: buttons numbered 1..n (keys 1..n pick). The right one and a wrong pick are marked with an icon and a word.
  function choose(body, opts, labelOf, rightIndex, onPick) {
    const btns = opts.map((o, k) => h('button', { type: 'button', class: 'qopt', onclick: () => pick(k) },
      h('span', { class: 'qkey', 'aria-hidden': 'true' }, String(k + 1)), labelOf(o)));
    function pick(k) {
      if (btns[k].disabled) return;
      btns.forEach((b) => (b.disabled = true));
      btns[rightIndex].classList.add('ok');
      btns[rightIndex].append(h('span', { class: 'qmark' }, ' ✔ right answer'));
      if (k !== rightIndex) {
        btns[k].classList.add('bad');
        btns[k].append(h('span', { class: 'qmark' }, ' ✖ your pick'));
      }
      onPick(k);
    }
    keys = Object.fromEntries(opts.map((_, k) => [String(k + 1), () => pick(k)]));
    body.append(h('div', { class: 'qopts', role: 'group', 'aria-label': 'Answers' }, btns));
    btns[0].focus();
  }

  // ---------- 1. dictation: hear a sentence, type it
  function dictation() {
    drill('dictation', '🎧 Dictation', shuffle(phrases, Math.random).slice(0, count), (p, body, finish) => {
      body.append(h('p', { class: 'muted' }, ...withIcon('🎧', 'Type the sentence you hear.')), h('div', { class: 'row' }, listenBtn(p.no, 'Play again'), slowBtn(p.no)));
      typed(body, finish, {
        prompt: [], target: p.no, label: 'The sentence you heard', key: { phraseId: p.id }, multiline: true,
        detail: [h('p', { class: 'muted' }, 'The sentence:'), no(p.no, 'p', 'sentence big-s'), h('p', { class: 'trans' }, p.en)],
      });
      speak(p.no, { slow: isSlow() });
    }, dictation);
  }

  // ---------- 2. listening quiz: hear a word, pick its meaning
  function listenQuiz() {
    drill('listen', '👂 Listening quiz', pickWords(() => true), (w, body, finish) => {
      const opts = choices(words, w, 4, Math.random);
      body.append(h('p', { class: 'muted' }, ...withIcon('👂', 'What does the word you hear mean?')), h('div', { class: 'row' }, listenBtn(w.lemma, 'Play again'), slowBtn(w.lemma)));
      choose(body, opts, (o) => o.gloss_en, opts.indexOf(w), (k) =>
        finish({ result: opts[k] === w ? 'correct' : 'wrong', key: { wordId: w.id }, label: w.lemma, detail: [wordLine(w)] }));
      speak(w.lemma, { slow: isSlow() });
    }, listenQuiz);
  }

  // ---------- 3. spell it: English to Norwegian, review-deck words first
  function spell() {
    drill('spell', '✍️ Spell it', pickWords(() => true, (w) => status.deck.has(w.id)), (w, body, finish) => {
      typed(body, finish, {
        prompt: [h('p', { class: 'muted' }, ...withIcon('✍️', 'Write this in Norwegian:')), h('p', { class: 'trans sentence big-s' }, w.gloss_en), h('p', {}, h('span', { class: 'chip' }, w.pos))],
        target: w.lemma, label: 'The Norwegian word', key: { wordId: w.id },
        detail: [h('div', { class: 'row' }, wordLine(w), listenBtn(w.lemma)), no(w.def_no, 'p', 'def')],
      });
    }, spell);
  }

  // ---------- 4. noun gender
  function gender() {
    drill('gender', '🧩 Noun gender', pickWords((w) => genderOf(w) !== null), (w, body, finish) => {
      const right = genderOf(w);
      body.append(h('p', { class: 'muted' }, ...withIcon('🧩', 'Which gender does this noun have?')),
        h('div', { class: 'row' }, no(w.lemma, 'p', 'sentence big-s'), listenBtn(w.lemma)), h('p', { class: 'trans' }, w.gloss_en));
      // Several genders can be right (en/ei nouns): the first right one is shown as the answer, any right one counts.
      choose(body, GENDERS, (g) => no(g), GENDERS.indexOf(right[0]), (k) => {
        const ok = right.includes(GENDERS[k]);
        finish({
          result: ok ? 'correct' : 'wrong', key: { wordId: w.id }, label: `${right.join('/')} ${w.lemma}`, mistakes: ok ? [] : ['gender'],
          detail: [h('p', {}, no(`${right.join(' / ')} ${w.lemma}`, 'strong'), ' — the ', no(w.forms[1] ?? w.lemma, 'strong'), ` (${w.gloss_en})`),
            right.includes('ei') ? h('p', { class: 'muted' }, 'In Bokmål, feminine (ei) nouns can also be used with en.') : null],
        });
      });
    }, gender);
  }

  // ---------- 5. verb forms
  function verbs() {
    const items = pickWords((w) => verbTask(w, () => 0) !== null).map((w) => ({ w, task: verbTask(w, Math.random) }));
    drill('verb', '🔁 Verb forms', items, ({ w, task }, body, finish) => {
      typed(body, finish, {
        prompt: [h('p', { class: 'muted' }, ...withIcon('🔁', `Type the ${task.label}:`)), wordLine(w), no(task.frame.replace('___', '_____'), 'p', 'sentence big-s')],
        target: task.answer, label: `The ${task.label} of ${w.lemma}`, key: { wordId: w.id },
        detail: [h('p', {}, 'All forms: ', no(`${w.forms[0]} – ${w.forms[1]} – ${w.forms[2]} – har ${w.forms[3]}`, 'strong')), no(task.frame.replace('___', task.answer), 'p', 'def')],
      });
    }, verbs);
  }

  // ---------- 6. word combinations (collocations)
  function colloc() {
    const items = pickWords((w) => collocationItem(w, () => 0) !== null).map((w) => ({ w, c: collocationItem(w, Math.random) }));
    drill('collocation', '🔗 Word combinations', items, ({ w, c }, body, finish) => {
      const opts = choices(words, w, 4, Math.random);
      const gap = c.tokens.map((t, k) => (k === c.blank ? '_____' : t.text)).join('');
      body.append(h('p', { class: 'muted' }, ...withIcon('🔗', 'Which word completes it? It may need another form.')), no(gap, 'p', 'sentence big-s'));
      choose(body, opts, (o) => no(o.lemma), opts.indexOf(w), (k) =>
        finish({ result: opts[k] === w ? 'correct' : 'wrong', key: { wordId: w.id }, label: c.text, detail: [h('div', { class: 'row' }, no(c.text, 'p', 'sentence'), listenBtn(c.text)), wordLine(w)] }));
    }, colloc);
  }

  menu();
}
