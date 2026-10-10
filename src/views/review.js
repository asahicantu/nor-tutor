import { h } from '../dom.js';
import { getAll, put, add } from '../db.js';
import { dueCards, review, GRADES } from '../srs.js';

export async function render(root, { words, db }) {
  const byId = new Map(words.map((w) => [w.id, w]));
  const cards = await getAll(db, 'cards');

  if (cards.length === 0) {
    root.replaceChildren(
      h('h1', {}, 'Review'),
      h('p', {}, 'Your deck is empty. Open a word in ', h('a', { href: '#/explore' }, 'Words'), ' and choose "Add to review deck".'),
    );
    return;
  }

  const queue = dueCards(cards, Date.now()).filter((c) => byId.has(c.wordId));
  if (queue.length === 0) {
    root.replaceChildren(h('h1', {}, 'Review'), h('p', {}, `Nothing is due right now. ${cards.length} card(s) in your deck.`));
    return;
  }

  let i = 0;
  const total = queue.length;

  function show() {
    if (i >= total) {
      root.replaceChildren(h('h1', {}, 'Review'), h('p', {}, `Done: ${total} card(s) reviewed.`));
      return;
    }
    const card = queue[i];
    const word = byId.get(card.wordId);
    const startedAt = Date.now();
    const ex = word.examples && word.examples[0];
    const errorBox = h('div');
    let graded = false; // set synchronously: blocks double activation
    let recorded = false; // review record already written (avoid duplicate on retry)

    const revealed = h('div', { hidden: true },
      h('p', {}, h('strong', {}, word.gloss_en)),
      h('p', {}, word.def_no),
      ex ? h('p', { class: 'muted' }, `${ex.no} — ${ex.en}`) : null,
      h('div', { class: 'row' }, Object.keys(GRADES).map((g) =>
        h('button', { onclick: () => grade(g) }, g[0].toUpperCase() + g.slice(1)))),
    );
    const showBtn = h('button', { class: 'primary', onclick: () => { revealed.hidden = false; showBtn.hidden = true; } }, 'Show answer');

    async function grade(g) {
      if (graded) return;
      graded = true;
      const now = Date.now();
      try {
        if (!recorded) {
          await add(db, 'reviews', { wordId: card.wordId, timestamp: now, grade: g, ms: now - startedAt, prevInterval: card.interval });
          recorded = true;
        }
        await put(db, 'cards', review(card, g, now));
      } catch (e) {
        graded = false; // allow retry; card stays on screen
        errorBox.replaceChildren(h('p', { class: 'error' }, `Could not save this review (${e.message}). Please try again.`));
        return;
      }
      i++;
      show();
    }

    root.replaceChildren(
      h('h1', {}, 'Review'),
      h('p', { class: 'muted' }, `Card ${i + 1} of ${total}`),
      h('div', { class: 'card' }, h('div', { class: 'big' }, word.lemma), showBtn, revealed),
      errorBox,
    );
  }

  show();
}
