import { h, no } from '../dom.js';
import { loadState } from '../db.js';
import { learnedNow } from '../progress.js';
import { summarize } from '../levels.js';
import { groupSources, matchesLevel } from '../sources.js';

const date = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export async function render(root, { words, db }) {
  let list;
  try {
    const res = await fetch('data/sources.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch (e) {
    root.replaceChildren(h('h1', {}, 'Sources'), h('p', { role: 'alert' }, `Could not load the list of sources (${e.message}).`));
    return;
  }
  const state = await loadState(db);
  const learned = learnedNow(state);
  const level = summarize(words, { known: learned, deck: new Set(state.cards.map((c) => c.wordId)) }).estimatedLevel;

  const card = (s) => {
    const good = matchesLevel(s, level);
    return h('li', { class: 'card src-card' },
      h('a', { class: 'src-link', href: s.url, target: '_blank', rel: 'noopener noreferrer' },
        s.siteLanguage === 'Norwegian' ? no(s.name) : s.name),
      h('p', {}, s.description),
      h('p', { class: 'src-badges' },
        good ? h('span', { class: 'badge src-good' }, 'Good for your level') : null,
        h('span', { class: 'badge' }, s.levels[0] === s.levels[1] ? s.levels[0] : `${s.levels[0]}–${s.levels[1]}`),
        h('span', { class: 'badge' }, s.access),
        h('span', { class: 'badge' }, s.siteLanguage),
        h('span', { class: 'muted src-checked' }, `Checked ${date(s.checked)}`)));
  };
  const sort = (items) => [...items].sort((a, b) => matchesLevel(b, level) - matchesLevel(a, level) || a.name.localeCompare(b.name, 'nb'));

  root.replaceChildren(
    h('h1', {}, 'Sources'),
    h('p', { class: 'muted' }, "Sites to keep learning outside the app. Links open in a new tab. Levels are CEFR ranges; 'Good for your level' uses your estimated level. Level and access labels are our own judgement from the date each site was checked: sites change, and some video may be limited by country."),
    h('p', {}, level ? `Your estimated level: ≈${level}` : 'Mark some words as known to see your estimated level here.'),
    ...groupSources(list).map(({ group, items }) =>
      h('section', {}, h('h2', {}, group), h('ul', { class: 'plain src-grid' }, sort(items).map(card)))));
}
