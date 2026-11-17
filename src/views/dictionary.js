import { h, no, pref, setPref } from '../dom.js';
import { searchWords } from '../search.js';
import { levelOf, complexityOf } from '../levels.js';

// Each sort compares ascending; rank breaks ties so the order is stable and meaningful.
const SORTS = {
  lemma: ['Word', (a, b) => a.lemma.localeCompare(b.lemma, 'nb')],
  rank: ['Usage rank', (a, b) => a.rank - b.rank],
  level: ['Level', (a, b) => complexityOf(a) - complexityOf(b) || a.rank - b.rank],
};

export async function render(root, { words }) {
  const saved = pref('dictSort', {});
  let key = saved.key in SORTS ? saved.key : 'rank';
  let dir = saved.dir === -1 ? -1 : 1;

  const input = h('input', { type: 'search', placeholder: 'Search Norwegian or English…', 'aria-label': 'Search the dictionary' });
  const count = h('p', { class: 'muted', role: 'status' });
  const body = h('tbody');
  const head = (k) => {
    const th = h('th', { scope: 'col' }, h('button', { class: 'sortbtn', onclick: () => {
      dir = k === key ? -dir : 1;
      key = k;
      setPref('dictSort', { key, dir });
      draw();
    } }, SORTS[k][0], h('span', { 'aria-hidden': 'true' })));
    th.dataset.key = k;
    return th;
  };
  const heads = [head('lemma'), h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Meaning'), head('rank'), head('level')];

  function draw() {
    const rows = searchWords(words, input.value, words.length).sort((a, b) => dir * SORTS[key][1](a, b));
    for (const th of heads) {
      if (!th.dataset.key) continue;
      const on = th.dataset.key === key;
      if (on) th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
      th.querySelector('span').textContent = on ? (dir === 1 ? ' ▲' : ' ▼') : '';
    }
    body.replaceChildren(...(rows.length
      ? rows.map((w) => h('tr', {},
          h('th', { scope: 'row' }, no(w.lemma)),
          h('td', { class: 'muted' }, w.pos),
          h('td', {}, w.gloss_en, h('div', { class: 'muted' }, no(w.def_no))),
          h('td', {}, w.rank.toLocaleString('en')),
          h('td', {}, levelOf(w).level)))
      : [h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'No words match.'))]));
    count.textContent = `${rows.length.toLocaleString('en')} of ${words.length.toLocaleString('en')} words`;
  }

  input.addEventListener('input', draw);
  root.replaceChildren(
    h('h1', {}, 'Dictionary'),
    h('p', { class: 'muted' }, 'Every word with its meaning. Lower usage rank means more common; level is the CEFR level (A1 easiest, C2 hardest). Click a column to sort.'),
    h('div', { class: 'toolbar' }, input),
    count,
    h('div', { class: 'tablewrap' }, h('table', { class: 'dict' }, h('thead', {}, h('tr', {}, heads)), body)),
  );
  draw();
}
