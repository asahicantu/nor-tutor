import { h, no, rich } from '../dom.js';
import { getAll, put, del } from '../db.js';
import { CATEGORIES, STATUSES, progressKey, encodeProgress, parseProgress, progressTotals, splitEmoji, validateGrammar } from '../grammar.js';

// Emoji are decoration (the words carry the meaning), so screen readers skip them.
const emo = (text) => splitEmoji(text).map((p) => (p.emoji ? h('span', { class: 'emo', 'aria-hidden': 'true' }, p.text) : p.text));
const richEmoji = (text) => rich(text).flatMap((n) => (typeof n === 'string' ? emo(n) : h('strong', {}, emo(n.textContent))));

// Every string a section shows (no JSON keys or block types), so search only matches words the learner can see.
const strings = (v) => (typeof v === 'string' ? [v.replaceAll('**', '')] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => k !== 'type').flatMap(([, x]) => strings(x)) : []);
const AUTO_OPEN_MAX = 4; // a search opens its matches only when there are few enough to read

const COLS = 6; // table columns cycle through six colours so each column is easy to tell apart
const niceDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function block(b) {
  switch (b.type) {
    case 'p': return h('p', {}, richEmoji(b.text));
    case 'list': return h('ul', {}, b.items.map((t) => h('li', {}, richEmoji(t))));
    case 'tip': return h('aside', { class: 'tip' }, h('strong', {}, emo('💡 Tip: ')), richEmoji(b.text));
    case 'examples':
      return h('ul', { class: 'plain examples' }, b.items.map((e) => h('li', {}, no(e.no, 'div', 'def'), h('div', { class: 'trans' }, e.en))));
    case 'table':
      return h('div', { class: 'tablewrap' }, h('table', { class: 'gtable' },
        b.caption ? h('caption', {}, b.caption) : null,
        h('thead', {}, h('tr', {}, b.head.map((c, i) => h('th', { scope: 'col', class: `gcol gcol-${i % COLS}` }, richEmoji(c))))),
        h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c, i) => h(i === 0 ? 'th' : 'td', { ...(i === 0 ? { scope: 'row' } : {}), class: `gcol gcol-${i % COLS}` }, richEmoji(c))))))));
    default: return null;
  }
}

export async function render(root, { db }) {
  const res = await fetch('data/grammar.json');
  if (!res.ok) throw new Error(`data/grammar.json: HTTP ${res.status}`);
  const sections = await res.json();
  const errors = validateGrammar(sections);
  if (errors.length) throw new Error(`Invalid grammar data: ${errors.slice(0, 3).join('; ')}`);
  // The lessons don't need the database, so a failed progress load must not hide them.
  let progress = new Map();
  let loadError = null;
  try {
    progress = parseProgress(await getAll(db, 'settings'));
  } catch (e) {
    loadError = e;
  }
  let cat = 'all';
  let stat = 'all';
  let query = '';

  const statusOf = (id) => progress.get(id)?.status ?? 'new';
  const cards = [];

  function buildCard(s, i) {
    const chip = h('span', { class: 'gstatus' });
    const stamp = h('span', { class: 'muted gstamp' });
    const msg = h('p', { class: 'error', role: 'alert', hidden: true });
    let busy = false;
    const buttons = STATUSES.map((st) => h('button', { type: 'button', class: `gbtn gbtn-${st.id}`, 'aria-pressed': 'false', onclick: () => choose(st.id) }, emo(`${st.emoji} ${st.label}`)));

    function paint() {
      const st = STATUSES.find((x) => x.id === statusOf(s.id));
      chip.replaceChildren(...emo(`${st.emoji} ${st.label}`));
      chip.className = `gstatus gstatus-${st.id}`;
      buttons.forEach((b, n) => b.setAttribute('aria-pressed', String(STATUSES[n].id === st.id)));
      const p = progress.get(s.id);
      stamp.textContent = p ? `Updated ${niceDate(p.at)}` : 'Not started yet. Mark your progress as you study.';
    }

    async function choose(status) {
      if (busy || status === statusOf(s.id)) return;
      busy = true;
      buttons.forEach((b) => (b.disabled = true));
      msg.hidden = true;
      const before = progress.get(s.id);
      const at = Date.now();
      if (status === 'new') progress.delete(s.id);
      else progress.set(s.id, { status, at });
      paint();
      summary();
      try {
        if (status === 'new') await del(db, 'settings', progressKey(s.id));
        else await put(db, 'settings', { key: progressKey(s.id), value: encodeProgress(status, at) });
      } catch (e) {
        if (before) progress.set(s.id, before);
        else progress.delete(s.id);
        paint();
        summary();
        msg.textContent = `Could not save your progress (${e.message}). Please try again.`;
        msg.hidden = false;
      } finally {
        busy = false;
        buttons.forEach((b) => (b.disabled = false));
        apply();
        // A status filter can hide this card now: keep keyboard focus somewhere visible instead of losing it to <body>.
        if (el.hidden) count.focus();
        else buttons.find((b) => b.getAttribute('aria-pressed') === 'true')?.focus();
      }
    }

    const el = h('details', { class: `gcard gcat-${s.category}`, id: `g-${s.id}` },
      h('summary', {},
        h('h2', {}, h('span', { class: 'gemoji', 'aria-hidden': 'true' }, s.emoji), h('span', { class: 'gtitle' }, `${i + 1}. ${s.title}`)),
        h('span', { class: 'gline muted' }, s.summary),
        chip),
      h('div', { class: 'gbody' },
        s.blocks.map(block),
        h('footer', { class: 'gtrack' },
          h('strong', {}, emo('📈 My study progress')),
          h('div', { class: 'row', role: 'group', 'aria-label': `Study progress for ${s.title}` }, buttons),
          stamp, msg)));
    paint();
    return { s, el };
  }
  sections.forEach((s, i) => cards.push(buildCard(s, i)));

  // --- overview: progress, filters, expand/collapse
  const bar = h('div', { class: 'progress gprogress', role: 'progressbar', 'aria-label': 'Grammar sections studied', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'gdone' }), h('span', { class: 'glearn' }));
  const overview = h('p', { class: 'gover' });
  function summary() {
    const t = progressTotals(sections, progress);
    overview.replaceChildren(...emo(`🎯 ${t.studied} of ${t.total} sections studied (${t.pct}%) · 📖 ${t.learning} learning · ⬜ ${t.total - t.studied - t.learning} not started`));
    bar.setAttribute('aria-valuenow', String(t.pct));
    bar.setAttribute('aria-valuetext', `${t.studied} of ${t.total} sections studied`);
    bar.firstChild.style.width = `${(t.studied / t.total) * 100}%`;
    bar.lastChild.style.width = `${(t.learning / t.total) * 100}%`;
  }

  const input = h('input', { type: 'search', placeholder: 'Search topics, words, examples…', 'aria-label': 'Search grammar topics' });
  const count = h('p', { class: 'muted', role: 'status', tabindex: '-1' });
  const empty = h('p', { class: 'empty', hidden: true }, 'No topics match. Try another filter or search.');

  const catDefs = [['all', '📚 All topics', null], ...Object.entries(CATEGORIES).map(([k, v]) => [k, `${v.emoji} ${v.label}`, k])];
  const catBtns = catDefs.map(([key, label, c]) => h('button', { type: 'button', class: `chipbtn gchip${c ? ` gcat-${c}` : ''}`, 'aria-pressed': String(key === cat), onclick: () => { cat = key; apply(); } }));
  const statDefs = [['all', 'All'], ...STATUSES.map((s) => [s.id, `${s.emoji} ${s.label}`])];
  const statBtns = statDefs.map(([key]) => h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(key === stat), onclick: () => { stat = key; apply(); } }));

  const text = cards.map(({ s }) => [s.title, s.summary, CATEGORIES[s.category].label, ...strings(s.blocks)].join(' ').toLocaleLowerCase());
  const setAll = (open) => cards.forEach(({ el }) => { if (!el.hidden) el.open = open; });
  const autoOpened = new Set(); // cards a search opened, so clearing the search closes only those

  function apply() {
    const q = query.trim().toLocaleLowerCase();
    let shown = 0;
    cards.forEach(({ s, el }, i) => {
      const ok = (cat === 'all' || s.category === cat) && (stat === 'all' || statusOf(s.id) === stat) && (q === '' || text[i].includes(q));
      el.hidden = !ok;
      if (ok) shown++;
    });
    catBtns.forEach((b, i) => {
      const key = catDefs[i][0];
      const n = sections.filter((s) => key === 'all' || s.category === key).length;
      b.replaceChildren(...emo(`${catDefs[i][1]} (${n})`));
      b.setAttribute('aria-pressed', String(key === cat));
    });
    statBtns.forEach((b, i) => {
      const key = statDefs[i][0];
      const n = sections.filter((s) => key === 'all' || statusOf(s.id) === key).length;
      b.replaceChildren(...emo(`${statDefs[i][1]} (${n})`));
      b.setAttribute('aria-pressed', String(key === stat));
    });
    count.textContent = `${shown} of ${sections.length} topics`;
    empty.hidden = shown > 0;
  }
  input.addEventListener('input', () => {
    query = input.value;
    apply();
    if (query.trim() === '') {
      autoOpened.forEach((el) => { el.open = false; });
      autoOpened.clear();
      return;
    }
    const visible = cards.filter(({ el }) => !el.hidden);
    if (visible.length <= AUTO_OPEN_MAX) visible.forEach(({ el }) => { if (!el.open) { el.open = true; autoOpened.add(el); } });
  });

  root.replaceChildren(
    h('h1', {}, emo('📚 Grammar')),
    loadError ? h('p', { class: 'error', role: 'alert' }, `Could not load your study progress (${loadError.message}). You can still read every topic.`) : null,
    h('p', { class: 'muted' }, 'Norwegian Bokmål grammar in short sections with tables and examples. Open a topic, study it, then mark your progress. Norwegian is shown in blue, English in green, and every table column has its own colour.'),
    h('section', { class: 'card gtools' },
      overview, bar,
      input,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by topic group' }, catBtns),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by study status' }, h('span', { class: 'muted' }, 'Show:'), statBtns),
      h('div', { class: 'row between' }, count,
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => setAll(true) }, emo('⤵️ Expand all')),
          h('button', { type: 'button', onclick: () => setAll(false) }, emo('⤴️ Collapse all'))))),
    empty,
    h('div', { class: 'glist' }, cards.map((c) => c.el)),
  );
  summary();
  apply();
}
