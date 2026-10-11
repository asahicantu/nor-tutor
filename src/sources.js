import { LEVELS } from './levels.js';

export const GROUPS = ['News', 'Listening', 'Dictionaries and grammar', 'Courses', 'Watch and read'];
const LANGS = ['Norwegian', 'English', 'Norwegian and English'];
const ACCESS = ['Free', 'Partly free', 'Paywall'];
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
    if (!blank(s.id)) { if (ids.has(s.id)) err('duplicate id'); ids.add(s.id); }
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
