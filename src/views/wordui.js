import { h, no } from '../dom.js';
import { levelOf, complexityOf } from '../levels.js';
import { markKnown, unmarkKnown, addToDeck } from '../actions.js';

// Translation in green, definition in blue (see .trans / .def in styles.css).
export const meaning = (w, { example = true } = {}) =>
  h('div', { class: 'meaning' },
    h('p', { class: 'trans' }, h('strong', {}, w.gloss_en)),
    h('p', { class: 'def' }, no(w.def_no)),
    example && w.examples[0] ? h('p', { class: 'ex' }, no(w.examples[0].no), h('span', { class: 'muted' }, w.examples[0].en)) : null);

export const contextPanel = (w) =>
  h('div', { class: 'context' },
    w.notes ? h('p', { class: 'note' }, no(w.notes)) : null,
    h('ul', { class: 'plain examples' }, w.examples.map((e) => h('li', {}, no(e.no, 'div', 'def'), h('div', { class: 'trans' }, e.en)))),
    w.collocations.length ? h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Common phrases'), w.collocations.map((c) => no(c, 'span', 'chip'))) : null,
    w.forms.length ? h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Forms'), w.forms.map((c) => no(c, 'span', 'chip'))) : null);

// One word in the Words list, with its three actions. Redraws itself when its status changes.
// onChange(card) fires after an action saved, so the list can drop the card if it left the active filter.
export function wordCard(w, { db, status, onChange }) {
  const card = h('article', { class: 'wcard' });
  const msg = h('p', { class: 'error', role: 'alert', hidden: true });
  let open = false;
  const run = (fn) => async () => {
    msg.hidden = true;
    let saved = true;
    try {
      await fn();
    } catch (e) {
      saved = false;
      msg.textContent = `Could not save (${e.message}). Please try again.`;
      msg.hidden = false;
    }
    draw();
    if (saved) onChange?.(card);
  };
  const draw = () => {
    const known = status.known.has(w.id);
    const inDeck = status.deck.has(w.id);
    const lv = levelOf(w);
    const cx = complexityOf(w);
    const missed = status.missed.get(w.id)?.count ?? 0;
    card.classList.toggle('is-known', known);
    card.replaceChildren(...[
      h('header', {},
        h('h2', {}, no(w.lemma)),
        h('span', { class: 'chip' }, w.pos),
        h('span', { class: 'lvl', title: lv.derived ? 'Estimated from word frequency' : 'Level' }, (lv.derived ? '≈' : '') + lv.level),
        h('span', { class: 'dots', role: 'img', 'aria-label': `Complexity ${cx} of 5` }, '●'.repeat(cx) + '○'.repeat(5 - cx)),
        known ? h('span', { class: 'badge known' }, '✓ Known') : null,
        inDeck ? h('span', { class: 'badge review' }, 'In review deck') : null,
        missed ? h('span', { class: 'badge' }, `Missed ${missed}×`) : null),
      h('div', { class: 'wbody' },
        h('p', { class: 'trans wtrans' }, h('strong', {}, w.gloss_en)),
        h('button', { class: 'peek quiet', onclick: () => card.classList.add('rev') }, 'Show translation'),
        h('p', { class: 'def wdef' }, no(w.def_no))),
      open ? contextPanel(w) : null,
      h('div', { class: 'actions' },
        h('button', { class: known ? 'on known' : 'known', 'aria-pressed': String(known), onclick: run(() => (known ? unmarkKnown(db, status, w.id) : markKnown(db, status, w.id))) },
          known ? '✓ I know this word' : 'I know this word'),
        h('button', { class: inDeck ? 'on review' : 'review', disabled: inDeck, onclick: run(() => addToDeck(db, status, w.id)) },
          inDeck ? '✓ In review deck' : 'Review it'),
        h('button', { class: 'context-btn', 'aria-expanded': String(open), onclick: () => { open = !open; draw(); } },
          open ? 'Hide context' : 'Explain context')),
      msg].filter(Boolean));
  };
  draw();
  return card;
}
