// Word cloud of how strongly you know your words: SIZE = how often a word was studied or reappeared, COLOUR = strength.
// Built from cloudItems() in src/strength.js. Meaning is never colour-only: a legend, a hover title and a table carry it.
import { h, no } from '../dom.js';
import { STRENGTHS, fontSize } from '../strength.js';

const labelOf = (strength) => STRENGTHS.find((s) => s.id === strength)?.label ?? 'Not yet';

// Biggest words in the middle, smaller ones towards the edges, so the cloud reads as a cloud and not as a sorted list.
function centred(items) {
  const out = [];
  items.forEach((it, i) => (i % 2 ? out.push(it) : out.unshift(it)));
  return out;
}

export function wordCloud(items, { empty = 'Nothing to show yet.' } = {}) {
  if (items.length === 0) return h('p', { class: 'empty' }, empty);
  const max = Math.max(...items.map((i) => i.count));
  return h('div', { class: 'wc' },
    h('ul', { class: 'plain wc-legend', 'aria-label': 'Legend' },
      STRENGTHS.map((s) => h('li', {}, h('span', { class: `wc-key wc-${s.id}`, 'aria-hidden': 'true' }), s.label)),
      h('li', { class: 'muted' }, 'Bigger word = studied or met more often')),
    h('ul', { class: 'plain wordcloud', 'aria-label': 'Word cloud' },
      centred(items).map((i) => h('li', {
        class: `wc-word wc-${i.strength ?? 'none'}`,
        style: `font-size:${fontSize(i.count, max)}rem`,
        title: `${i.text} (${i.gloss}): studied ${i.studied}×, missed ${i.missed}×, ${labelOf(i.strength).toLowerCase()}`,
      }, no(i.text)))),
    h('details', {},
      h('summary', {}, 'Show as a table'),
      h('div', { class: 'tablewrap tscroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Word', 'Meaning', 'Times studied', 'Times missed', 'Strength'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, items.map((i) => h('tr', {}, h('th', { scope: 'row' }, no(i.text)), h('td', {}, i.gloss), h('td', {}, String(i.studied)), h('td', {}, String(i.missed)), h('td', {}, labelOf(i.strength)))))))));
}
