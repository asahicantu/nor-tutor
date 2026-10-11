import { h, pref, setPref } from '../dom.js';
import { searchWords } from '../search.js';
import { getAll } from '../db.js';
import { buildStatus } from '../wordstatus.js';
import { wordCard } from './wordui.js';

const PAGE = 30;
const FILTERS = [
  ['all', 'All'],
  ['new', 'Not rated yet'],
  ['known', 'Known'],
  ['review', 'In review'],
  ['missed', 'Missed in test'],
];

export async function render(root, { words, db }) {
  const [known, unknown, cards] = await Promise.all(['known', 'unknown', 'cards'].map((s) => getAll(db, s)));
  const status = buildStatus({ known, unknown, cards });
  let filter = 'all';
  let pos = '';
  let shown = PAGE;

  const matches = {
    all: () => true,
    new: (w) => !status.known.has(w.id) && !status.deck.has(w.id) && !status.missed.has(w.id),
    known: (w) => status.known.has(w.id),
    review: (w) => status.deck.has(w.id),
    missed: (w) => status.missed.has(w.id) && !status.known.has(w.id),
  };
  const posOf = (w) => w.pos.split(' ')[0];
  const posList = [...new Set(words.map(posOf))].sort();

  const input = h('input', { type: 'search', placeholder: 'Search Norwegian or English…', 'aria-label': 'Search words' });
  const list = h('div', { class: 'wlist' });
  const count = h('p', { class: 'muted', role: 'status' });
  const more = h('button', { onclick: () => { shown += PAGE; draw(); } }, 'Show more');
  const toggle = (label, key, cls) => {
    const box = h('input', { type: 'checkbox' });
    box.checked = pref(key, true);
    const apply = () => list.classList.toggle(cls, !box.checked);
    box.addEventListener('change', () => { setPref(key, box.checked); apply(); });
    apply();
    return h('label', { class: 'switch' }, box, h('span', { class: 'track', 'aria-hidden': 'true' }), label);
  };
  const posSelect = h('select', { 'aria-label': 'Word type', onchange: (e) => { pos = e.target.value; shown = PAGE; draw(); } },
    h('option', { value: '' }, 'All types'), posList.map((p) => h('option', { value: p }, p)));
  const chips = FILTERS.map(([key, label]) =>
    h('button', {
      class: 'chipbtn', 'aria-pressed': String(key === filter),
      onclick: () => { filter = key; shown = PAGE; chips.forEach((b, i) => b.setAttribute('aria-pressed', String(FILTERS[i][0] === key))); draw(); },
    }, label));

  function draw() {
    const all = searchWords(words, input.value, words.length).filter((w) => matches[filter](w) && (!pos || posOf(w) === pos));
    const page = all.slice(0, shown);
    list.replaceChildren(...(page.length ? page.map((w) => wordCard(w, { db, status })) : [h('p', { class: 'empty' }, 'No words match. Try another filter or search.')]));
    count.textContent = `${Math.min(shown, all.length)} of ${all.length} words`;
    more.hidden = shown >= all.length;
  }

  input.addEventListener('input', () => { shown = PAGE; draw(); });
  root.replaceChildren(
    h('h1', {}, 'Words'),
    h('p', { class: 'muted' }, 'Mark what you already know, send tricky words to your review deck, or open the context to see them in sentences.'),
    h('div', { class: 'toolbar' }, input, posSelect),
    h('div', { class: 'toolbar' },
      toggle('Translations', 'showTrans', 'hide-trans'),
      toggle('Definitions', 'showDef', 'hide-def'),
      h('span', { class: 'legend' }, h('span', { class: 'trans' }, '■ English'), ' ', h('span', { class: 'def' }, '■ Norwegian definition'))),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, chips),
    count, list, h('div', { class: 'row center' }, more),
  );
  draw();
}
