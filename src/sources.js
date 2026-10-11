import { LEVELS } from './levels.js';
import { splitEmoji } from './grammar.js';

// Display order, an emoji and a one-line purpose for each group. `slug` names the colour class (.srcg-<slug>).
export const GROUP_META = {
  'News': { emoji: '📰', slug: 'news', blurb: 'Read current events at natural speed.' },
  'Listening': { emoji: '🎧', slug: 'listening', blurb: 'Train your ear with podcasts and audio.' },
  'Watch and read': { emoji: '📺', slug: 'watch', blurb: 'Video, books and articles for immersion.' },
  'Courses': { emoji: '🎓', slug: 'courses', blurb: 'Structured lessons and exam preparation.' },
  'Dictionaries': { emoji: '📖', slug: 'dictionaries', blurb: 'Look words up and see how they are used.' },
  'Grammar and reference': { emoji: '🧩', slug: 'grammar', blurb: 'Official rules and clear explanations.' },
  'Corpora and data': { emoji: '🗃️', slug: 'corpora', blurb: 'Real usage, word frequencies and language data.' },
  'Practice and community': { emoji: '🗣️', slug: 'practice', blurb: 'Talk, write and practise with other people.' },
};
export const GROUPS = Object.keys(GROUP_META);
// Bundled logo files live under assets/logos and are named after the entry id.
const LOGO = /^assets\/logos\/([a-z0-9-]+)\.(png|svg|ico|webp|jpg)$/; // compared by parts: the id never becomes part of a pattern
const logoOk = (s) => typeof s.logo === 'string' && LOGO.exec(s.logo)?.[1] === s.id;
const LANGS = ['Norwegian', 'English', 'Norwegian and English'];
const ACCESS = ['Free', 'Partly free', 'Paywall', 'Check the site']; // "Check the site" = cost or availability was not stated on the page we checked
const blank = (v) => typeof v !== 'string' || v.trim() === '';

export function validateSources(list) {
  if (!Array.isArray(list) || list.length === 0) return ['sources must be a non-empty array'];
  const errors = [];
  const ids = new Set();
  const urls = new Set();
  list.forEach((s, i) => {
    const at = `#${i + 1} (${s?.id ?? '?'})`;
    const err = (m) => errors.push(`${at}: ${m}`);
    if (!s || typeof s !== 'object') return err('not an object');
    for (const f of ['id', 'name', 'url', 'group', 'description', 'siteLanguage', 'access', 'checked']) {
      if (blank(s[f])) err(`missing ${f}`);
    }
    if (!blank(s.id)) {
      if (!/^[a-z0-9-]+$/.test(s.id)) err('id must be kebab-case (a-z, 0-9, -): it becomes a file name');
      if (ids.has(s.id)) err('duplicate id');
      ids.add(s.id);
    }
    if (!blank(s.url)) {
      let u = null;
      try { u = new URL(s.url); } catch { err('url is not parseable'); }
      if (u && u.protocol !== 'https:') err('url must be https');
      if (urls.has(s.url)) err('duplicate url');
      urls.add(s.url);
    }
    if (!blank(s.checked) && !(/^\d{4}-\d{2}-\d{2}$/.test(s.checked) && !Number.isNaN(Date.parse(s.checked)) && new Date(`${s.checked}T00:00:00Z`).toISOString().slice(0, 10) === s.checked)) err('checked must be a valid YYYY-MM-DD date');
    if (!blank(s.group) && !GROUPS.includes(s.group)) err(`bad group ${s.group}`);
    if (!blank(s.siteLanguage) && !LANGS.includes(s.siteLanguage)) err(`bad siteLanguage ${s.siteLanguage}`);
    if (!blank(s.access) && !ACCESS.includes(s.access)) err(`bad access ${s.access}`);
    const e = typeof s.emoji === 'string' ? splitEmoji(s.emoji) : [];
    if (e.length !== 1 || !e[0].emoji) err('emoji must be a single emoji');
    if (s.logo !== undefined && !logoOk(s)) err('logo must be assets/logos/<id>.<png|svg|ico|webp|jpg>');
    const [lo, hi] = Array.isArray(s.levels) && s.levels.length === 2 ? s.levels.map((l) => LEVELS.indexOf(l)) : [-1, -1];
    if (lo < 0 || hi < 0 || lo > hi) err('levels must be [min, max] within A1..C2 with min <= max');
  });
  return errors;
}

export function matchesLevel(source, level) {
  const i = LEVELS.indexOf(level);
  return i >= 0 && i >= LEVELS.indexOf(source.levels[0]) && i <= LEVELS.indexOf(source.levels[1]);
}

export const groupSources = (list) =>
  GROUPS.map((group) => ({ group, items: list.filter((s) => s.group === group) })).filter((g) => g.items.length);

const norm = (t) => t.toLocaleLowerCase('nb');

// Search, group, level and access filters for the Sources page. `level` is the learner's estimated level (or null).
export function filterSources(list, { query = '', group = 'all', goodFor = false, level = null, freeOnly = false } = {}) {
  const q = norm(query.trim());
  return list.filter((s) =>
    (group === 'all' || s.group === group) &&
    (!goodFor || matchesLevel(s, level)) &&
    (!freeOnly || s.access === 'Free') &&
    (q === '' || norm(`${s.name} ${s.description} ${s.group} ${s.siteLanguage}`).includes(q)));
}
