import { h, no } from '../dom.js';
import { loadState } from '../db.js';
import { learnedNow } from '../progress.js';
import { summarize } from '../levels.js';
import { GROUPS, GROUP_META, groupSources, filterSources, matchesLevel, validateSources } from '../sources.js';
import { splitEmoji } from '../grammar.js';

const date = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const host = (url) => new URL(url).hostname.replace(/^www\./, '');
// Emoji are decoration (the name and group carry the meaning), so screen readers skip them.
const emo = (text) => splitEmoji(text).map((p) => (p.emoji ? h('span', { class: 'emo', 'aria-hidden': 'true' }, p.text) : p.text));
const gcls = (group) => `srcg-${GROUP_META[group].slug}`;

// The site's bundled logo on a white plate; if the file is missing or broken the entry's emoji takes its place.
function logo(s) {
  const fallback = () => h('span', { class: 'src-emoji', 'aria-hidden': 'true' }, s.emoji);
  const plate = h('span', { class: 'src-logo' });
  if (!s.logo) {
    plate.append(fallback());
    return plate;
  }
  const img = h('img', { src: s.logo, alt: '', width: '40', height: '40', decoding: 'async' }); // local and tiny: no lazy loading, so a missing file falls back at once
  img.addEventListener('error', () => plate.replaceChildren(fallback()));
  plate.append(img);
  return plate;
}

export async function render(root, { words, db }) {
  let list;
  try {
    const res = await fetch('data/sources.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
    const problems = validateSources(list);
    if (problems.length) throw new Error(`invalid data: ${problems.slice(0, 2).join('; ')}`);
  } catch (e) {
    root.replaceChildren(h('h1', {}, 'Sources'), h('p', { role: 'alert' }, `Could not load the list of sources (${e.message}).`));
    return;
  }
  let level = null;
  try {
    const state = await loadState(db);
    level = summarize(words, { known: learnedNow(state), deck: new Set(state.cards.map((c) => c.wordId)) }).estimatedLevel;
  } catch { /* the list works without a level; only the "good for your level" help is lost */ }

  let query = '';
  let group = 'all';
  let goodFor = false;
  let freeOnly = false;

  const card = (s) => {
    const good = matchesLevel(s, level);
    return h('li', { class: `card src-card ${gcls(s.group)}` },
      logo(s),
      h('div', { class: 'src-main' },
        h('a', { class: 'src-link', href: s.url, target: '_blank', rel: 'noopener noreferrer' },
          s.siteLanguage === 'Norwegian' ? no(s.name) : s.name, ' ', h('span', { 'aria-hidden': 'true' }, '↗'), h('span', { class: 'sr' }, ' (opens in a new tab)')),
        h('p', { class: 'muted src-host' }, host(s.url)),
        h('p', { class: 'src-desc' }, s.description),
        h('p', { class: 'src-badges' },
          good ? h('span', { class: 'badge src-good' }, 'Good for your level') : null,
          h('span', { class: 'badge' }, s.levels[0] === s.levels[1] ? s.levels[0] : `${s.levels[0]}–${s.levels[1]}`),
          h('span', { class: 'badge' }, s.access),
          h('span', { class: 'badge' }, s.siteLanguage),
          h('span', { class: 'muted src-checked' }, `Checked ${date(s.checked)}`))));
  };
  const sort = (items) => [...items].sort((a, b) => matchesLevel(b, level) - matchesLevel(a, level) || a.name.localeCompare(b.name, 'nb'));

  const input = h('input', { type: 'search', placeholder: 'Search sites, e.g. grammar, podcast, corpus…', 'aria-label': 'Search sources' });
  const toggle = (label, onChange, disabled = false, hint = null) => {
    const box = h('input', { type: 'checkbox', disabled });
    box.addEventListener('change', () => { onChange(box.checked); draw(); });
    return h('label', { class: `switch${disabled ? ' disabled' : ''}`, title: hint }, box, h('span', { class: 'track', 'aria-hidden': 'true' }), label);
  };
  const goodSwitch = toggle(level ? `Good for my level (≈${level})` : 'Good for my level', (v) => { goodFor = v; }, !level, level ? null : 'Mark some words as known to see your estimated level');
  const freeSwitch = toggle('Free only', (v) => { freeOnly = v; });
  const chipDefs = [['all', '🌐 All', null], ...GROUPS.map((g) => [g, `${GROUP_META[g].emoji} ${g}`, g])];
  const chips = chipDefs.map(([key, , g]) => h('button', { type: 'button', class: `chipbtn gchip${g ? ` ${gcls(g)}` : ''}`, 'aria-pressed': String(key === group), onclick: () => { group = key; draw(); } }));
  const count = h('p', { class: 'muted', role: 'status' });
  const results = h('div', { class: 'src-results' });

  function draw() {
    const base = { query, goodFor, level, freeOnly };
    const shown = filterSources(list, { ...base, group });
    chips.forEach((b, i) => {
      const [key, label] = chipDefs[i];
      b.replaceChildren(...emo(`${label} (${filterSources(list, { ...base, group: key }).length})`));
      b.setAttribute('aria-pressed', String(key === group));
    });
    count.textContent = `${shown.length} of ${list.length} sources`;
    results.replaceChildren(...(shown.length
      ? groupSources(shown).map(({ group: g, items }) =>
        h('section', { class: `src-section ${gcls(g)}` },
          h('div', { class: 'src-head' },
            h('span', { class: 'gemoji', 'aria-hidden': 'true' }, GROUP_META[g].emoji),
            h('div', {}, h('h2', {}, `${g} `, h('span', { class: 'muted src-n' }, `(${items.length})`)), h('p', { class: 'muted' }, GROUP_META[g].blurb))),
          h('ul', { class: 'plain src-grid' }, sort(items).map(card))))
      : [h('p', { class: 'empty' }, 'No sources match. Try another search or turn a filter off.')]));
  }
  input.addEventListener('input', () => { query = input.value; draw(); });

  root.replaceChildren(
    h('h1', {}, emo('🌐 Sources')),
    h('p', { class: 'muted' }, "Sites to keep learning outside the app. Links open in a new tab. Levels are CEFR ranges; 'Good for your level' uses your estimated level. Level and access labels are our own judgement from the date each site was checked: sites change, and some video may be limited by country."),
    h('p', {}, level ? `Your estimated level: ≈${level}` : 'Mark some words as known to see your estimated level here.'),
    h('section', { class: 'card src-tools' },
      input,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by category' }, chips),
      h('div', { class: 'row between' }, h('div', { class: 'row' }, goodSwitch, freeSwitch), count)),
    results,
    h('p', { class: 'muted src-legal' }, 'Logos are trademarks of their owners and are shown only to identify each site.'),
  );
  draw();
}
