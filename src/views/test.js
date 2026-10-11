import { h, no, pref, setPref, onKeys, segmented } from '../dom.js';
import { sampleWords, scoreTest, bandSizes, bandLabel } from '../estimator.js';
import { add, getAll } from '../db.js';
import { buildStatus } from '../wordstatus.js';
import { markKnown, recordMiss, addToDeck } from '../actions.js';
import { meaning } from './wordui.js';

const COUNTS = [[10, '10'], [20, '20'], [40, '40'], [60, '60']];
const fmt = (n) => n.toLocaleString('en');
const pct = (x) => `${Math.round(x * 100)}%`;

export async function render(root, { words, db }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const status = buildStatus({
    known: await getAll(db, 'known'), unknown: await getAll(db, 'unknown'), cards: await getAll(db, 'cards'),
  });
  let count = Math.min(pref('testCount', 20), words.length);
  let keys = {}; // current shortcut map, swapped per screen
  onKeys(root, new Proxy({}, { get: (_, k) => keys[k] }));
  const page = (...kids) => root.replaceChildren(h('h1', {}, 'Vocabulary test'), ...kids.filter(Boolean));

  function intro() {
    keys = { enter: start };
    const counts = COUNTS.filter(([n]) => n <= words.length);
    const note = h('p', { class: 'muted' });
    const setNote = () => { note.textContent = `About ${Math.max(1, Math.round((count * 6) / 60))} min. Words are picked at random from all frequency levels.`; };
    setNote();
    page(h('div', { class: 'card' },
      h('h2', {}, 'How well do you know the most-used Norwegian words?'),
      h('p', {}, 'You will see real Norwegian words, one at a time. Say whether you know each one. If you do not, the app shows its meaning straight away and keeps a record of it.'),
      h('p', { class: 'muted' }, 'Be honest: answer "I know it" only if you could explain the word to someone.'),
      h('h3', {}, 'How many words?'),
      segmented('Number of words', counts.length ? counts : [[words.length, String(words.length)]], count, (n) => { count = n; setPref('testCount', n); setNote(); }),
      note,
      h('button', { class: 'primary', onclick: start }, 'Start test ⏎'),
    ));
  }

  function start() {
    const items = sampleWords(words, Math.random, count);
    const responses = [];
    const saves = [];
    const missed = [];
    let i = 0;

    const next = () => { i++; show(); };

    function reveal(item, w) {
      const deckBtn = h('button', {
        disabled: status.deck.has(w.id),
        onclick: async () => {
          deckBtn.disabled = true;
          try { await addToDeck(db, status, w.id); deckBtn.textContent = '✓ In review deck'; } catch { deckBtn.disabled = false; deckBtn.textContent = 'Could not add, retry'; }
        },
      }, status.deck.has(w.id) ? '✓ In review deck' : 'Add to review deck');
      keys = { enter: next, arrowright: next };
      page(
        progress(),
        h('div', { class: 'card testcard' },
          h('p', { class: 'badge review' }, 'Saved to your unknown words'),
          no(w.lemma, 'div', 'big'),
          h('p', { class: 'center' }, h('span', { class: 'chip' }, w.pos)),
          meaning(w),
          h('div', { class: 'row' }, deckBtn, h('button', { class: 'primary', onclick: next }, 'Next →'))),
      );
    }

    function progress() {
      return h('div', {},
        h('p', { class: 'muted' }, `Word ${Math.min(i + 1, items.length)} of ${items.length}`),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(items.length), 'aria-valuenow': String(i) }, h('span', { style: `width:${(i / items.length) * 100}%` })));
    }

    function show() {
      if (i >= items.length) return finish(items, responses, saves, missed);
      const item = items[i];
      const w = byId.get(item.wordId);
      const idx = i;
      const shownAt = performance.now();
      const answer = (known) => {
        if (i !== idx || performance.now() - shownAt < 250) return;
        responses.push({ kind: 'word', band: item.band, known });
        if (known) {
          saves.push(markKnown(db, status, w.id).catch((e) => e));
          return next();
        }
        missed.push(w);
        saves.push(recordMiss(db, status, w.id).catch((e) => e));
        reveal(item, w);
      };
      keys = { k: () => answer(true), arrowright: () => answer(true), d: () => answer(false), arrowleft: () => answer(false) };
      page(
        progress(),
        h('div', { class: 'card testcard' },
          no(w.lemma, 'div', 'big'),
          h('p', { class: 'center' }, h('span', { class: 'chip' }, w.pos)),
          h('div', { class: 'row center' },
            h('button', { class: 'primary', onclick: () => answer(true) }, 'I know it'),
            h('button', { onclick: () => answer(false) }, "I don't know it")),
          h('p', { class: 'muted center' }, 'Shortcuts: K = know, D = don\'t know'),
        ),
      );
    }
    show();
  }

  async function finish(items, responses, saves, missed) {
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
    const knownN = responses.filter((r) => r.known).length;
    const unique = [...new Map(missed.map((w) => [w.id, w])).values()];
    const addAll = h('button', {
      class: 'primary',
      onclick: async () => {
        addAll.disabled = true;
        try { for (const w of unique) await addToDeck(db, status, w.id); addAll.textContent = `✓ ${unique.length} added to your review deck`; } catch (e) { addAll.disabled = false; addAll.textContent = `Failed (${e.message}), retry`; }
      },
    }, `Add all ${unique.length} to review deck`);
    page(
      saveError ? h('p', { class: 'error' }, `Some results could not be saved (${saveError.message}).`) : null,
      h('div', { class: 'card hero' },
        h('p', { class: 'muted' }, `You knew ${knownN} of ${items.length} words (${pct(knownN / items.length)}).`),
        h('div', { class: 'big' }, `≈ ${fmt(result.estimate)} of ${fmt(result.listSize)}`),
        h('p', {}, `Estimated words you know from our list. Likely range: ${fmt(result.ciLow)} – ${fmt(result.ciHigh)}.`),
        h('p', { class: 'muted' }, 'It is an index for comparing your own tests over time, not an absolute vocabulary size. More words per test gives a tighter range.')),
      unique.length
        ? h('div', { class: 'card' },
            h('h2', {}, `Words to learn (${unique.length})`),
            h('p', { class: 'muted' }, 'These are saved as unknown words, and we count each time you miss one.'),
            h('ul', { class: 'plain missed' }, unique.map((w) => h('li', {}, no(w.lemma, 'strong'), ' ', h('span', { class: 'trans' }, w.gloss_en)))),
            addAll)
        : h('div', { class: 'card' }, h('p', {}, 'You knew every word. Try a longer test.')),
      h('details', {},
        h('summary', {}, 'Breakdown by how common the words are'),
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Frequency', 'Words in list', 'Tested', 'Known'].map((t) => h('th', {}, t)))),
          h('tbody', {}, result.bands.map((b) => h('tr', {}, h('td', {}, bandLabel(b.band)), h('td', {}, b.size), h('td', {}, b.sampled), h('td', {}, `${b.known} (${pct(b.known / b.sampled)})`))))))),
      h('div', { class: 'row' },
        h('button', { onclick: intro }, 'Take another test'),
        h('a', { class: 'btn', href: '#/explore' }, 'Browse words'),
        h('a', { class: 'btn quiet', href: '#/dashboard' }, 'See your progress →')),
    );
  }

  intro();
}
