import { h, no, rich } from '../dom.js';

function block(b) {
  switch (b.type) {
    case 'p': return h('p', {}, rich(b.text));
    case 'list': return h('ul', {}, b.items.map((t) => h('li', {}, rich(t))));
    case 'tip': return h('aside', { class: 'tip' }, h('strong', {}, 'Tip: '), rich(b.text));
    case 'examples':
      return h('ul', { class: 'plain examples' }, b.items.map((e) => h('li', {}, no(e.no, 'div', 'def'), h('div', { class: 'trans' }, e.en))));
    case 'table':
      return h('div', { class: 'tablewrap' }, h('table', {},
        b.caption ? h('caption', {}, b.caption) : null,
        h('thead', {}, h('tr', {}, b.head.map((c) => h('th', { scope: 'col' }, rich(c))))),
        h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}, rich(c))))))));
    default: return null;
  }
}

export async function render(root) {
  const res = await fetch('data/grammar.json');
  if (!res.ok) throw new Error(`data/grammar.json: HTTP ${res.status}`);
  const sections = await res.json();
  const els = sections.map((s, i) =>
    h('section', { class: 'card gsec', id: `g-${s.id}` },
      h('h2', {}, `${i + 1}. ${s.title}`),
      h('p', { class: 'muted' }, s.summary),
      s.blocks.map(block)));
  const toc = sections.map((s, i) =>
    h('button', { class: 'chipbtn', onclick: () => els[i].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }) }, `${i + 1}. ${s.title}`));
  const filter = h('input', { type: 'search', placeholder: 'Filter topics…', 'aria-label': 'Filter grammar topics' });
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLocaleLowerCase();
    sections.forEach((s, i) => { els[i].hidden = toc[i].hidden = q !== '' && !`${s.title} ${s.summary} ${JSON.stringify(s.blocks)}`.toLocaleLowerCase().includes(q); });
  });
  root.replaceChildren(
    h('h1', {}, 'Grammar'),
    h('p', { class: 'muted' }, 'Norwegian Bokmål grammar in short sections with tables and examples. Norwegian is shown in blue, English in green.'),
    filter,
    h('nav', { class: 'chips toc', 'aria-label': 'Grammar topics' }, toc),
    ...els,
  );
}
